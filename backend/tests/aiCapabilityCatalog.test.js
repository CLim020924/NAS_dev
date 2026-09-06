const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOL_DEFINITIONS, selectToolDefinitions, isReadOnlyTool, _test } = require('../aiAgentRuntime');
const fs = require('node:fs');
const path = require('node:path');
const { buildCapabilityCatalog, classifyPlatformRoute } = require('../aiCapabilityCatalog');

test('모든 AI 도구는 정확히 한 제품 기능 영역에 등록된다', () => {
  const catalog = buildCapabilityCatalog(TOOL_DEFINITIONS);
  const names = catalog.surfaces.flatMap((surface) => surface.tools.map((tool) => tool.name));
  assert.equal(names.length, TOOL_DEFINITIONS.length);
  assert.equal(new Set(names).size, names.length);
  assert.equal(catalog.toolCount, TOOL_DEFINITIONS.length);
});

test('모든 변경 도구는 실행 계획과 사용자 의도 규칙을 함께 가진다', () => {
  _test.MUTATION_TOOL_NAMES.forEach((name) => {
    assert.ok(TOOL_DEFINITIONS.some((tool) => tool.name === name), `${name}: definition`);
    assert.ok(_test.actionSpec(name, {}), `${name}: action spec`);
  });
});

test('모든 변경 실행 계획은 실제 실행 분기에도 연결된다', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'aiAgentRuntime.js'), 'utf8');
  const executeStart = source.indexOf('const executeAction =');
  const runToolStart = source.indexOf('const runTool =');
  assert.ok(executeStart >= 0 && runToolStart > executeStart);
  const specs = new Set(_test.MUTATION_TOOL_NAMES.map((name) => _test.actionSpec(name, {}).actionType));
  const executionSource = source.slice(executeStart, runToolStart);
  const missing = [...specs].filter((actionType) => !executionSource.includes(`'${actionType}'`));
  assert.deepEqual(missing, []);
  assert.ok(specs.size >= 50, `action inventory unexpectedly small: ${specs.size}`);
});

test('보안상 직접 위임하지 않는 기능은 누락이 아니라 사유와 함께 명시된다', () => {
  const catalog = buildCapabilityCatalog(TOOL_DEFINITIONS);
  assert.ok(catalog.intentionallyRestricted.length >= 7);
  catalog.intentionallyRestricted.forEach((item) => {
    assert.ok(item.capability);
    assert.ok(item.reason.length >= 20);
  });
});

test('프로덕션 REST 라우트는 AI 연결 또는 명시된 UI·보안 경계로 분류된다', () => {
  const files = ['index.js', 'nasRoutes.js', 'friendsRoutes.js', 'chatRoutes.js', 'chatAttachmentRoutes.js', 'notificationsRoutes.js', 'shareRoutes.js', 'aiAgentRoutes.js'];
  const routes = [];
  const pattern = /\b(app|router)\.(get|post|put|patch|delete)\(\s*['"](\/[^'"]+)['"]/g;
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    let match;
    while ((match = pattern.exec(source))) routes.push({ file, method: match[2].toUpperCase(), route: match[3] });
  });
  const missing = routes.filter((item) => !classifyPlatformRoute(item.route, item.method));
  assert.deepEqual(missing, []);
  assert.ok(routes.length >= 140, `route inventory unexpectedly small: ${routes.length}`);
});

test('요청별 도구 선택은 무관한 변경 도구와 토큰 비용을 노출하지 않는다', () => {
  const hello = selectToolDefinitions('안녕하세요', []).map((tool) => tool.name);
  assert.deepEqual(hello, ['get_agent_capabilities']);
  const fileSend = selectToolDefinitions('민수에게 이 파일을 보내줘', ['send_file_to_user']).map((tool) => tool.name);
  assert.ok(fileSend.includes('send_file_to_user'));
  assert.ok(fileSend.includes('search_files'));
  assert.ok(fileSend.includes('list_chat_conversations'));
  assert.ok(!fileSend.includes('delete_group_chat'));
  assert.ok(fileSend.length < 20);
  assert.equal(isReadOnlyTool('list_chat_messages'), true);
  assert.equal(isReadOnlyTool('send_chat_message'), false);
});
