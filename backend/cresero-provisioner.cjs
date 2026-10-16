'use strict';
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const invalid=reason=>Object.assign(new Error(reason),{reason});
const personId=value=>typeof value==='string'&&/^person:[a-f0-9-]{36}$/.test(value);
const validId=value=>typeof value==='string'&&value.length>=2&&value.length<=64&&/^[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(value)&&!/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(value);

function createStaffProvisioner(options){
 const {getUsers,getRequests,saveMembers,normalizeUser,ensureStorage,getCapacity,directory,emit=()=>{},storageExists=()=>false}=options;
 function reconcile(user){directory.approveUser(user,{accountType:'INTERNAL',contactEmail:user.contactEmail},'cresero-bridge');if(directory.updateIdentity)directory.updateIdentity(user.userUid,{accountType:'INTERNAL',mailLocalPart:user.contactEmail.slice(0,-12)},'cresero-bridge',{isMaster:true});}
 function processJob(job){
  if(!personId(job?.personId)||!validId(job.login)||typeof job.email!=='string'||!job.email.endsWith('@cresero.com')||!validId(job.email.slice(0,-12))||!['ENSURE','SUSPEND'].includes(job.kind))throw invalid('INVALID_ID');
  let users=getUsers(),user=users.find(u=>u.creseroPersonId===job.personId);
  if(!user&&job.kind==='ENSURE'&&job.existingNasUid){
   const existing=users.find(u=>u.userUid===job.existingNasUid);
   if(!existing||existing.creseroPersonId||existing.disabled||existing.loginId!==job.login||existing.status!=='ACTIVE')throw invalid('OWNER_VERIFICATION');
   const before={...existing};Object.assign(existing,{creseroPersonId:job.personId,accountType:'INTERNAL',contactEmail:job.email});
   try{saveMembers();}catch(e){Object.assign(existing,before);throw e;}user=existing;
  }
  if(user&&job.existingNasUid&&user.userUid!==job.existingNasUid)throw invalid('OWNER_VERIFICATION');
  if(job.kind==='SUSPEND'){
   if(!user)return {nasUid:null};
   const before={...user};Object.assign(user,{disabled:true,status:'DISABLED',creseroSuspended:true,activeSessions:[],activeSessionId:'',activeSessionIssuedAt:'',activeSessionDeviceId:''});
   try{saveMembers();}catch(e){Object.assign(user,before);throw e;}emit(user,true);return {nasUid:user.userUid};
  }
  if(user){
   if(user.loginId!==job.login||user.accountType!=='INTERNAL'||user.disabled&&!user.creseroSuspended)throw invalid('OWNER_VERIFICATION');
   const before={...user};if(user.creseroSuspended)Object.assign(user,{disabled:false,status:'ACTIVE',creseroSuspended:false});
   ensureStorage(user);try{saveMembers();}catch(e){Object.assign(user,before);throw e;}reconcile(user);return {nasUid:user.userUid};
  }
  // Never attach another account, a pending signup or an orphan storage directory by name.
  if(job.existingNasUid||[...users,...getRequests()].some(u=>String(u.loginId||u.id||'').toLowerCase()===job.login)||storageExists(job.login))throw invalid('ID_CONFLICT');
  if(users.some(u=>String(u.nickname||u.displayName||'').normalize('NFKC').trim().toLowerCase()===String(job.nickname||'').normalize('NFKC').trim().toLowerCase()))throw invalid('ID_CONFLICT');
  if(!getCapacity().signupAvailable)throw invalid('CAPACITY');
  const userUid='cresero_'+crypto.createHash('sha256').update(job.personId).digest('hex').slice(0,32);
  user=normalizeUser({id:job.login,loginId:job.login,username:job.login,userUid,nickname:job.nickname,displayName:job.nickname,accountType:'INTERNAL',contactEmail:job.email,creseroPersonId:job.personId,role:'USER',Masters:false,Managers:false,globalAccess:false,disabled:false,status:'ACTIVE',password:crypto.randomBytes(48).toString('hex'),loginPersistenceEnabled:false,activeSessions:[]});
  ensureStorage(user);users.push(user);
  try{saveMembers();}catch(e){const at=users.indexOf(user);if(at>=0)users.splice(at,1);throw e;}
  reconcile(user);emit(user,false);return {nasUid:userUid};
 }
 return {processJob,reconcileExisting(){for(const user of getUsers())if(personId(user.creseroPersonId)&&user.accountType==='INTERNAL'&&!user.disabled&&user.status==='ACTIVE'&&typeof user.contactEmail==='string'&&user.contactEmail.endsWith('@cresero.com')&&validId(user.contactEmail.slice(0,-12)))reconcile(user);}};
}

function startCreseroProvisioner(options){
 const env=options.env||process.env,token=env.CRESERO_NAS_BRIDGE_TOKEN;
 if(typeof token!=='string'||token.length<32)return {enabled:false,stop(){},async tick(){}};
 const endpoint='https://cresero.com/api/company/';
 const fetcher=options.fetcher||fetch,provisioner=createStaffProvisioner(options);
 provisioner.reconcileExisting();
 let busy=false,stopped=false;
 async function call(action,data){const r=await fetcher(endpoint+'nas/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Cresero bridge unavailable');return r.json();}
 async function tick(){if(busy||stopped)return;busy=true;try{for(let count=0;count<8;count++){
  const {job}=await call('claim',{});if(!job)break;
  let outcome;try{outcome={ok:true,...provisioner.processJob(job)};}catch(e){outcome={ok:false,reason:['ID_CONFLICT','OWNER_VERIFICATION','INVALID_ID','CAPACITY'].includes(e.reason)?e.reason:'RETRY'};}
  await call('complete',{personId:job.personId,lease:job.lease,...outcome});
 }}catch{options.onUnavailable?.();}finally{busy=false;}}
 if(options.app&&options.issueSession){
  const app=options.app;
  if(options.authenticatedUser)app.get('/api/cresero/profile',async(req,res)=>{
   if(req.headers.origin&&req.headers.origin!=='https://filemanager-nas.com')return res.status(403).json({error:'허용되지 않은 출처입니다.'});
   res.set('Cache-Control','no-store');let user;try{user=options.authenticatedUser(req);}catch{}
   if(!user||user.disabled||user.status!=='ACTIVE')return res.status(401).json({error:'로그인이 필요합니다.'});
   try{return res.json(await call('identity',{uid:user.userUid}));}catch{return res.status(503).json({error:'Cresero 계정 연결 상태를 확인하지 못했습니다.'});}
  });
  if(options.authenticatedUser)app.get('/api/cresero/connect',async(req,res)=>{
   res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});let user;try{user=options.authenticatedUser(req);}catch{}
   if(!user||user.disabled||user.status!=='ACTIVE')return res.status(401).send('NAS에 로그인한 다음 프로필에서 다시 연결해 주세요.');
   const state=req.query?.state;if(typeof state!=='string'||!/^[a-f0-9]{64}$/.test(state))return res.status(400).send('NAS 프로필에서 다시 시작해 주세요.');
   try{const result=await call('connect-ticket',{uid:user.userUid,login:user.loginId||user.id,state});return res.redirect(result.url);}catch{return res.status(503).send('Cresero 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.');}
  });
  app.get('/api/cresero/signin',(_req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.type('html').send('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cresero NAS 연결</title><main><h1>직원 NAS 연결</h1><p id="status" role="status">Cresero 계정을 확인하고 있습니다. 현재 다른 NAS 로그인은 유지됩니다.</p><a href="https://cresero.com/staff">직원 공간으로 돌아가기</a></main><script src="/api/cresero/signin.js" defer></script></html>');});
  app.get('/api/cresero/signin.js',(_req,res)=>{res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.type('application/javascript').send(`(()=>{const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'',location.pathname);if(!ticket){document.getElementById('status').textContent='Cresero 직원 공간에서 NAS 연결을 다시 시작해 주세요.';return;}fetch('/api/cresero/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket})}).then(async r=>{const j=await r.json();if(!r.ok)throw Error(j.error||'NAS 연결에 실패했습니다.');location.replace('/nas');}).catch(e=>{document.getElementById('status').textContent=e.message;});})();`);});
  app.post('/api/cresero/session',async(req,res)=>{
   if(req.headers.origin!=='https://filemanager-nas.com')return res.status(403).json({error:'허용되지 않은 출처입니다.'});
   const ticket=req.body?.ticket;if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))return res.status(400).json({error:'Cresero 연결을 다시 시작해 주세요.'});
   try{const verified=await call('redeem',{ticket});const user=options.getUsers().find(u=>u.userUid===verified.nasUid&&u.creseroPersonId===verified.personId&&u.accountType==='INTERNAL'&&!u.disabled&&u.status==='ACTIVE');if(!user)return res.status(403).json({error:'연결된 활성 직원 계정을 찾을 수 없습니다.'});return options.issueSession(req,res,user);}catch{return res.status(401).json({error:'연결 정보가 만료되었거나 계정을 확인할 수 없습니다. Cresero 직원 공간에서 다시 시작해 주세요.'});}
  });
 }
 const timer=setInterval(tick,30000);timer.unref?.();void tick();
 return {enabled:true,tick,stop(){stopped=true;clearInterval(timer);}};
}
module.exports={createStaffProvisioner,startCreseroProvisioner};
