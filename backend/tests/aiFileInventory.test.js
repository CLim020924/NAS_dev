const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('사진 목록 페이지와 ZIP 계획은 계정 밖·숨김 경로를 제외하고 변경된 원본을 거절한다', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nas-ai-inventory-'));
  const runtimePath = path.resolve(__dirname, '..', 'aiAgentRuntime.js');
  const script = `
    const fs = require('node:fs');
    const path = require('node:path');
    const runtime = require(${JSON.stringify(runtimePath)});
    const user = { loginId: 'tester', userUid: 'tester', role: 'USER' };
    const base = path.join(process.env.NAS_ROOT, 'users', 'tester');
    fs.mkdirSync(path.join(base, 'photos', 'child'), { recursive: true });
    fs.writeFileSync(path.join(base, 'photos', 'a.jpg'), 'a');
    fs.writeFileSync(path.join(base, 'photos', 'child', 'b.png'), 'b');
    fs.writeFileSync(path.join(base, 'photos', '.secret.jpg'), 'hidden');
    fs.writeFileSync(path.join(base, 'photos', 'note.txt'), 'text');
    fs.writeFileSync(path.join(base, 'photos', 'credentials.json'), '{}');
    (async () => {
    if (runtime.listFiles(user, '/photos').some((item) => item.name === 'credentials.json')) process.exit(12);
    if (runtime.searchFiles(user, 'credentials', '/photos').length !== 0) process.exit(13);
    const first = runtime.listImageFiles(user, '/photos', 0, 1);
    const second = runtime.listImageFiles(user, '/photos', 1, 1);
    if (!first.complete || first.matchedCount !== 2 || first.nextOffset !== 1 || second.items.length !== 1) process.exit(2);
    const bundle = runtime.buildBundleManifest(user, ['/photos']);
    if (bundle.files.length !== 3 || bundle.files.some((item) => item.name.includes('.secret') || item.name.includes('credentials'))) process.exit(3);
    if (runtime.resolveBundleManifest(user, bundle.files).length !== 3) process.exit(4);
    try { runtime.resolveBundleManifest(user, [{ ...bundle.files[0], name: '../escape.txt' }]); process.exit(16); }
    catch (err) { if (err.status !== 400) process.exit(17); }
    if (process.platform === 'linux') {
      const ambiguous = path.join(base, 'photos', 'visible' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'escape.jpg');
      fs.writeFileSync(ambiguous, 'ambiguous');
      try { runtime.buildBundleManifest(user, ['/photos']); process.exit(14); }
      catch (err) { if (err.status !== 400) process.exit(15); }
      fs.unlinkSync(ambiguous);
    }
    const planned = await runtime.runTool(user, 'create_zip_bundle', { paths: ['/photos'], file_name: '시험 자료' }, {
      authorizedMutationTools: ['create_zip_bundle'], userIntentText: '사진 폴더를 ZIP으로 묶어서 만들어줘',
      platformCall: async () => { throw new Error('ZIP 계획은 외부 API를 호출하지 않는다'); },
    });
    if (planned.status !== 'pending_approval') process.exit(7);
    fs.writeFileSync(path.join(base, 'photos', 'added-after-approval.jpg'), 'new');
    try { await runtime.executeAction(user, planned.actionId, { platformCall: async () => ({}) }); process.exit(10); }
    catch (err) { if (err.status !== 409) process.exit(11); }
    fs.unlinkSync(path.join(base, 'photos', 'added-after-approval.jpg'));
    const replanned = await runtime.runTool(user, 'create_zip_bundle', { paths: ['/photos'], file_name: '시험 자료' }, {
      authorizedMutationTools: ['create_zip_bundle'], userIntentText: '사진 폴더를 ZIP으로 묶어서 만들어줘',
      platformCall: async () => { throw new Error('ZIP 계획은 외부 API를 호출하지 않는다'); },
    });
    const completed = await runtime.executeAction(user, replanned.actionId, { platformCall: async () => ({}) });
    if (completed.status !== 'completed' || completed.result.fileCount !== 3 || !completed.result.downloadUrl.includes(replanned.actionId)) process.exit(8);
    fs.writeFileSync(path.join(base, 'photos', 'a.jpg'), 'changed');
    try { runtime.resolveBundleManifest(user, bundle.files); process.exit(5); }
    catch (err) { if (err.status !== 409) process.exit(6); }
    })().catch((err) => { console.error(err); process.exit(9); });
  `;
  try {
    const result = spawnSync(process.execPath, ['-e', script], { env: { ...process.env, NAS_ROOT: root, AI_AGENT_DATA_ROOT: path.join(root, 'ai-data') }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
