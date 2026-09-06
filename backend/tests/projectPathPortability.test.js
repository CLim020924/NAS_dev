'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createPlan: rawCreatePlan, applyPlan, undoTransaction, updatePlanMapping, extractAbsolutePaths, CHANGE_REPORT_NAME } = require('../agents/windows-node/project-path-portability');
const createPlan = options => rawCreatePlan({ ...options, availabilityVerified: true });

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-path-portability-'));
const write = (file, value, encoding = 'utf8') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value, encoding); };
try {
  const drive = path.join(temp, 'NAS Drive');
  const project = path.join(drive, 'workspace', 'sample-project');
  const state = path.join(temp, 'state');
  const target = path.join(project, 'data', 'input.csv');
  write(target, 'a,b\n1,2\n');
  const oldInternal = 'C:\\Users\\beginner\\Desktop\\sample-project\\data\\input.csv';

  const codeFile = path.join(project, 'main.py');
  write(codeFile, `INPUT = r"${oldInternal}"\nURL = "https://example.com/api/files"\n`);
  let plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(plan.summary.safe, 1);
  assert.strictEqual(plan.summary.unresolved, 0, 'URL must not be treated as a path');
  assert.strictEqual(plan.candidates[0].replacementDisplay, target);
  let tx = applyPlan({ plan, candidateIds: [plan.candidates[0].id], stateDir: state });
  assert.ok(fs.readFileSync(codeFile, 'utf8').includes(target));
  assert.strictEqual(tx.files.length, 2, 'source and public change report are transactional');
  const report = fs.readFileSync(path.join(project, CHANGE_REPORT_NAME), 'utf8');
  assert.ok(report.includes('main.py:1'));
  assert.ok(!report.includes(oldInternal) && !report.includes(target), 'report must not disclose absolute paths');
  assert.strictEqual(undoTransaction(tx).restored, 2);
  assert.ok(fs.readFileSync(codeFile, 'utf8').includes(oldInternal));
  assert.ok(!fs.existsSync(path.join(project, CHANGE_REPORT_NAME)));

  const launch = path.join(project, '.vscode', 'launch.json');
  write(launch, JSON.stringify({ configurations: [{ program: oldInternal }] }, null, 2));
  const tasks = path.join(project, '.vscode', 'tasks.json');
  write(tasks, JSON.stringify({ tasks: [{ command: oldInternal, label: oldInternal }] }, null, 2));
  const workspace = path.join(project, 'sample.code-workspace');
  write(workspace, JSON.stringify({ folders: [{ path: oldInternal }] }, null, 2));
  const jetbrains = path.join(project, '.run', 'sample.run.xml');
  write(jetbrains, `<configuration><option name="SCRIPT_NAME" value="${oldInternal}" /></configuration>`);
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const launchCandidate = plan.candidates.find(item => item.file === '.vscode\\launch.json');
  const taskCandidates = plan.candidates.filter(item => item.file === '.vscode\\tasks.json');
  const workspaceCandidate = plan.candidates.find(item => item.file === 'sample.code-workspace');
  const jetbrainsCandidate = plan.candidates.find(item => item.file.includes('sample.run.xml'));
  assert.strictEqual(launchCandidate.replacementDisplay, '${workspaceFolder}/data/input.csv');
  assert.ok(taskCandidates.some(item => item.replacementDisplay === '${workspaceFolder}/data/input.csv'));
  assert.ok(taskCandidates.some(item => item.replacementDisplay === target), 'unsupported JSON fields retain an explicit local path');
  assert.strictEqual(workspaceCandidate.replacementDisplay, 'data/input.csv');
  assert.strictEqual(jetbrainsCandidate.replacementDisplay, '$PROJECT_DIR$/data/input.csv');

  const bomFile = path.join(project, 'bom.py');
  write(bomFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`P = r"${oldInternal}"\n`)]));
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const bomCandidate = plan.candidates.find(item => item.file === 'bom.py');
  tx = applyPlan({ plan, candidateIds: [bomCandidate.id], stateDir: state });
  assert.deepStrictEqual([...fs.readFileSync(bomFile).subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM must be preserved');
  undoTransaction(tx);

  const first = path.join(project, 'a.py');
  const second = path.join(project, 'b.py');
  write(first, `P = r"${oldInternal}"\n`); write(second, `P = r"${oldInternal}"\n`);
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const pair = plan.candidates.filter(item => item.file === 'a.py' || item.file === 'b.py');
  const firstBefore = fs.readFileSync(first);
  fs.appendFileSync(second, '# changed after preview\n');
  assert.throws(() => applyPlan({ plan, candidateIds: pair.map(item => item.id), stateDir: state }), /미리보기 이후 변경/);
  assert.deepStrictEqual(fs.readFileSync(first), firstBefore, 'preflight failure must leave earlier files unchanged');
  write(second, `P = r"${oldInternal}"\n`);
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const pair2 = plan.candidates.filter(item => item.file === 'a.py' || item.file === 'b.py');
  tx = applyPlan({ plan, candidateIds: pair2.map(item => item.id), stateDir: state });
  const firstApplied = fs.readFileSync(first);
  fs.appendFileSync(second, '# edited after apply\n');
  assert.throws(() => undoTransaction(tx), /적용 후 다시 변경/);
  assert.deepStrictEqual(fs.readFileSync(first), firstApplied, 'undo conflict must not partially restore earlier files');

  const outside = path.join(temp, 'outside.txt'); write(outside, 'x');
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const tampered = plan.candidates.find(item => item.file === 'a.py');
  tampered.targetPath = outside;
  assert.throws(() => applyPlan({ plan, candidateIds: [tampered.id], stateDir: state }), /NAS Drive 밖/);
  const manualFile = path.join(project, 'manual.py'); write(manualFile, 'P = "/missing/reference/labels.json"\n');
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  const unresolved = plan.candidates.find(item => item.file === 'manual.py');
  assert.throws(() => updatePlanMapping({ plan, candidateId: unresolved.id, targetPath: outside }), /NAS Drive 밖/);
  updatePlanMapping({ plan, candidateId: unresolved.id, targetPath: target });
  assert.strictEqual(unresolved.confidence, 'review');

  const utf16 = path.join(project, 'utf16.py'); write(utf16, Buffer.from(`P = "${oldInternal}"`, 'utf16le'));
  write(path.join(project, 'cloud.py'), `P = r"${oldInternal}"\n`);
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state, unavailableRelativePaths: ['cloud.py'] });
  assert.ok(plan.summary.skippedEncoding >= 1);
  assert.strictEqual(plan.summary.skippedUnavailable, 1);
  write(path.join(project, '.env'), `SECRET_FILE=${oldInternal}\n`);
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.ok(!plan.candidates.some(item => item.file === '.env'));

  const externalA = path.join(drive, 'shared-a', 'reference', 'labels.json'); write(externalA, '{}');
  write(manualFile, 'P = "/srv/reference/labels.json"\n');
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(plan.candidates.find(item => item.file === 'manual.py').confidence, 'review');
  const externalB = path.join(drive, 'shared-b', 'reference', 'labels.json'); write(externalB, '{}');
  plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(plan.candidates.find(item => item.file === 'manual.py').confidence, 'unresolved');

  const extracted = extractAbsolutePaths('x="C:\\old folder\\project\\a.txt" json="C:\\\\old\\\\project\\\\a.txt" url="https://example.com/a"');
  assert.deepStrictEqual(extracted.map(item => item.value), ['C:\\old folder\\project\\a.txt', 'C:\\old\\project\\a.txt']);
  console.log('projectPathPortability tests passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
