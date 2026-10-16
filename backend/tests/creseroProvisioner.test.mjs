import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createStaffProvisioner,startCreseroProvisioner}=require('../cresero-provisioner.cjs');
const personId='person:11111111-1111-4111-8111-111111111111';
const job={personId,login:'123',email:'123@cresero.com',nickname:'직원 하나',kind:'ENSURE',lease:'lease1',existingNasUid:null};
function setup(){const users=[],requests=[];const options={getUsers:()=>users,getRequests:()=>requests,saveMembers(){},normalizeUser:u=>({...u,password:'hashed-placeholder'}),ensureStorage(){},getCapacity:()=>({signupAvailable:true}),directory:{approveUser(){}},emit(){},storageExists:()=>false};return {users,requests,options};}
test('NAS employee provisioning is idempotent and always starts as ordinary USER',()=>{
 const s=setup(),p=createStaffProvisioner(s.options);const first=p.processJob({...job,role:'MASTER',Masters:true});assert.equal(s.users.length,1);assert.equal(s.users[0].role,'USER');assert.equal(s.users[0].Masters,false);assert.equal(s.users[0].Managers,false);assert.equal(s.users[0].globalAccess,false);assert.equal(s.users[0].accountType,'INTERNAL');assert.equal(s.users[0].password,'hashed-placeholder');assert.deepEqual(p.processJob(job),first);assert.equal(s.users.length,1);
});
test('existing NAS user, pending signup and orphan storage are never silently adopted',()=>{
 for(const mode of ['existing','pending','orphan']){const s=setup();if(mode==='existing')s.users.push({id:'123',loginId:'123',userUid:'unrelated',role:'MASTER'});if(mode==='pending')s.requests.push({id:'123'});if(mode==='orphan')s.options.storageExists=()=>true;assert.throws(()=>createStaffProvisioner(s.options).processJob(job),e=>e.reason==='ID_CONFLICT');if(mode==='existing')assert.equal(s.users[0].role,'MASTER');}
});
test('verified existing UID links an employee while preserving NAS password, root and role',()=>{
 const s=setup();s.users.push({userUid:'usr_'+'a'.repeat(32),loginId:'admin',role:'MASTER',Masters:true,Managers:true,status:'ACTIVE',disabled:false,password:'original-hash',rootPath:'/users/admin'});
 const p=createStaffProvisioner(s.options);const target={...job,login:'admin',email:'staff.admin@cresero.com',existingNasUid:s.users[0].userUid};
 assert.equal(p.processJob(target).nasUid,s.users[0].userUid);assert.equal(s.users.length,1);assert.equal(s.users[0].password,'original-hash');assert.equal(s.users[0].role,'MASTER');assert.equal(s.users[0].rootPath,'/users/admin');assert.equal(s.users[0].creseroPersonId,personId);assert.equal(s.users[0].contactEmail,'staff.admin@cresero.com');
 assert.equal(p.processJob(target).nasUid,s.users[0].userUid);
 assert.throws(()=>p.processJob({...target,personId:'person:22222222-2222-4222-8222-222222222222'}),e=>e.reason==='OWNER_VERIFICATION');
});
test('capacity failure leaves account pending and creates no NAS user',()=>{const s=setup();s.options.getCapacity=()=>({signupAvailable:false});assert.throws(()=>createStaffProvisioner(s.options).processJob(job),e=>e.reason==='CAPACITY');assert.equal(s.users.length,0);});
test('storage failure and persistence failure cannot acknowledge an account',()=>{
 const s=setup();s.options.ensureStorage=()=>{throw Error('disk offline');};assert.throws(()=>createStaffProvisioner(s.options).processJob(job));assert.equal(s.users.length,0);
 const t=setup();t.options.saveMembers=()=>{throw Error('disk full');};assert.throws(()=>createStaffProvisioner(t.options).processJob(job));assert.equal(t.users.length,0);
});
test('deactivation clears sessions; only a Cresero suspension can be automatically resumed',()=>{
 const s=setup(),p=createStaffProvisioner(s.options);p.processJob(job);s.users[0].activeSessions=[{sessionId:'old'}];p.processJob({...job,kind:'SUSPEND'});assert.equal(s.users[0].disabled,true);assert.deepEqual(s.users[0].activeSessions,[]);p.processJob(job);assert.equal(s.users[0].disabled,false);
 s.users[0].disabled=true;s.users[0].creseroSuspended=false;assert.throws(()=>p.processJob(job),e=>e.reason==='OWNER_VERIFICATION');
});
test('unconfigured bridge is dormant and offline server retries without deleting work',async()=>{
 const s=setup();assert.equal(startCreseroProvisioner({...s.options,env:{}}).enabled,false);
 let requests=0;const bridge=startCreseroProvisioner({...s.options,env:{CRESERO_NAS_BRIDGE_TOKEN:'x'.repeat(64)},fetcher:async()=>{requests++;throw Error('offline');}});await new Promise(r=>setTimeout(r,5));await bridge.tick();bridge.stop();assert.ok(requests>=2);assert.equal(s.users.length,0);
});
test('lost acknowledgement can retry without a duplicate NAS account',async()=>{
 const s=setup();let first=true,acks=0;const bridge=startCreseroProvisioner({...s.options,env:{CRESERO_NAS_BRIDGE_TOKEN:'x'.repeat(64)},fetcher:async url=>{if(url.endsWith('/claim'))return Response.json({job:acks<2?job:null});acks++;if(first){first=false;throw Error('lost response');}return Response.json({ok:true});}});await new Promise(r=>setTimeout(r,15));await bridge.tick();bridge.stop();assert.equal(s.users.length,1);assert.equal(acks,2);
});
