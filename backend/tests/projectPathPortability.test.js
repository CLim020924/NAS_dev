'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createPlan,
  applyPlan,
  undoTransaction,
  extractAbsolutePaths
} = require('../agents/windows-node/project-path-portability');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-path-portability-'));
try {
  const drive = path.join(temp, 'NAS Drive');
  const project = path.join(drive, 'workspace', 'sample-project');
  const state = path.join(temp, 'state');
  fs.mkdirSync(path.join(project, 'data'), { recursive: true });
  fs.writeFileSync(path.join(project, 'data', 'input.csv'), 'a,b\n1,2\n');
  const codeFile = path.join(project, 'main.py');
  const oldInternal = 'C:\\Users\\beginner\\Desktop\\sample-project\\data\\input.csv';
  fs.writeFileSync(codeFile, `INPUT = r"${oldInternal}"\nURL = "https://example.com/api/files"\n`, 'utf8');

  const plan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(plan.summary.safe, 1, 'project-relative suffix should be safe');
  assert.strictEqual(plan.summary.unresolved, 0, 'URL must not be treated as an absolute path');
  const candidate = plan.candidates[0];
  assert.strictEqual(candidate.selectedByDefault, true);
  assert.strictEqual(candidate.suggestedPath, path.join(project, 'data', 'input.csv'));

  const transaction = applyPlan({ plan, candidateIds: [candidate.id], stateDir: state });
  assert.ok(fs.readFileSync(codeFile, 'utf8').includes(path.join(project, 'data', 'input.csv')));
  assert.strictEqual(transaction.files.length, 1);
  assert.strictEqual(undoTransaction(transaction).restored, 1);
  assert.ok(fs.readFileSync(codeFile, 'utf8').includes(oldInternal));

  const changedPlan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  fs.appendFileSync(codeFile, '# changed after preview\n');
  assert.throws(() => applyPlan({ plan: changedPlan, candidateIds: [changedPlan.candidates[0].id], stateDir: state }), /미리보기 이후 변경/);

  const externalA = path.join(drive, 'shared-a', 'reference', 'labels.json');
  fs.mkdirSync(path.dirname(externalA), { recursive: true });
  fs.writeFileSync(externalA, '{}');
  fs.writeFileSync(codeFile, 'LABELS = "/srv/reference/labels.json"\n');
  const externalPlan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(externalPlan.summary.review, 1, 'unique external path must require review');
  assert.strictEqual(externalPlan.candidates[0].selectedByDefault, false);

  const externalB = path.join(drive, 'shared-b', 'reference', 'labels.json');
  fs.mkdirSync(path.dirname(externalB), { recursive: true });
  fs.writeFileSync(externalB, '{}');
  const ambiguousPlan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.strictEqual(ambiguousPlan.summary.unresolved, 1, 'ambiguous external path must not be suggested');

  fs.writeFileSync(path.join(project, '.env'), 'SECRET_FILE=C:\\keys\\token.txt\n');
  const secretPlan = createPlan({ projectRoot: project, allowedRoots: [drive], stateDir: state });
  assert.ok(!secretPlan.candidates.some(item => item.file === '.env'), 'secret files must not enter preview/log data');

  const extracted = extractAbsolutePaths('x="C:\\old\\project\\a.txt" url="https://example.com/a"');
  assert.deepStrictEqual(extracted.map(item => item.value), ['C:\\old\\project\\a.txt']);
  console.log('projectPathPortability tests passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
