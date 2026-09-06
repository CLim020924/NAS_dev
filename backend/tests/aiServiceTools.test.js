const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config/env');
const { callOpenAIAgent } = require('../services/aiService');

test('Responses function call을 실행하고 결과를 다음 응답에 전달한다', async () => {
  const previousKey = config.OPENAI_API_KEY;
  config.OPENAI_API_KEY = 'test-only-key';
  const bodies = [];
  let count = 0;
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    count += 1;
    const payload = count === 1
      ? { output: [{ type: 'function_call', name: 'search_files', call_id: 'call_1', arguments: '{"query":"보고서","path":"/"}' }], usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } }
      : { output_text: '보고서 1개를 찾았습니다.', output: [], usage: { input_tokens: 10, output_tokens: 7, total_tokens: 17 } };
    return { ok: true, json: async () => payload };
  };

  try {
    const result = await callOpenAIAgent({
      systemPrompt: 'test',
      input: [{ role: 'user', content: '보고서 찾아줘' }],
      tools: [],
      fetchImpl,
      onToolCall: async (name, args, callId) => ({ name, args, callId, count: 1 }),
    });
    assert.equal(result.text, '보고서 1개를 찾았습니다.');
    assert.equal(result.events.length, 1);
    assert.equal(result.usage.totalTokens, 42);
    assert.ok(bodies[1].input.some((item) => item.type === 'function_call_output' && item.call_id === 'call_1'));
    assert.equal(bodies[0].store, false);
  } finally {
    config.OPENAI_API_KEY = previousKey;
  }
});

test('형식이 깨진 도구 인자는 실행하지 않고 실패 결과로 모델에 돌려준다', async () => {
  const previousKey = config.OPENAI_API_KEY;
  config.OPENAI_API_KEY = 'test-only-key';
  let count = 0;
  let called = false;
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    count += 1;
    const payload = count === 1
      ? { output: [{ type: 'function_call', name: 'trash_item', call_id: 'bad_1', arguments: '{not-json' }], usage: {} }
      : { output_text: '잘못된 요청을 실행하지 않았습니다.', output: [], usage: {} };
    return { ok: true, json: async () => payload };
  };

  try {
    const result = await callOpenAIAgent({
      systemPrompt: 'test', input: 'test', tools: [], fetchImpl,
      onToolCall: async () => { called = true; },
    });
    assert.equal(called, false);
    assert.equal(result.events[0].ok, false);
    assert.equal(result.events[0].result.code, 'AI_TOOL_ARGUMENTS_INVALID');
    assert.match(bodies[1].input.find((item) => item.type === 'function_call_output').output, /AI_TOOL_ARGUMENTS_INVALID/);
  } finally {
    config.OPENAI_API_KEY = previousKey;
  }
});

test('승인 필요한 도구는 모델에 성공으로 보고하지 않고 정확한 call id 상태로 일시 정지한다', async () => {
  const previousKey = config.OPENAI_API_KEY;
  config.OPENAI_API_KEY = 'test-only-key';
  let requestCount = 0;
  const fetchImpl = async () => {
    requestCount += 1;
    return {
      ok: true,
      json: async () => ({
        output: [{ type: 'function_call', name: 'move_item', call_id: 'approval_1', arguments: '{"source_path":"/a","destination_path":"/b"}' }],
        usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 },
      }),
    };
  };

  try {
    const result = await callOpenAIAgent({
      systemPrompt: 'test', input: 'move', tools: [], fetchImpl,
      onToolCall: async () => ({ status: 'pending_approval', actionId: 'aiact_1', title: '파일 이동' }),
    });
    assert.equal(requestCount, 1);
    assert.equal(result.paused, true);
    assert.equal(result.interruptions[0].callId, 'approval_1');
    assert.equal(result.interruptions[0].actionId, 'aiact_1');
    assert.equal(result.continuation.nextTurn, 1);
    assert.equal(result.continuation.responseInput.some((item) => item.type === 'function_call_output' && item.call_id === 'approval_1'), false);
  } finally {
    config.OPENAI_API_KEY = previousKey;
  }
});

test('승인 결과를 같은 call id로 주입해 저장된 요청을 이어간다', async () => {
  const previousKey = config.OPENAI_API_KEY;
  config.OPENAI_API_KEY = 'test-only-key';
  let sentBody;
  const fetchImpl = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ output_text: '승인된 이동을 완료했습니다.', output: [], usage: { total_tokens: 3 } }),
    };
  };
  const state = {
    version: 1,
    responseInput: [
      { role: 'user', content: 'move' },
      { type: 'function_call', name: 'move_item', call_id: 'approval_1', arguments: '{}' },
    ],
    nextTurn: 1,
    toolCallCount: 1,
  };

  try {
    const result = await callOpenAIAgent({
      systemPrompt: 'test', resumeState: state, tools: [], fetchImpl,
      resumeOutputs: [{ type: 'function_call_output', call_id: 'approval_1', output: '{"ok":true,"status":"completed"}' }],
      onToolCall: async () => { throw new Error('호출되면 안 됨'); },
    });
    assert.equal(result.text, '승인된 이동을 완료했습니다.');
    assert.ok(sentBody.input.some((item) => item.type === 'function_call_output' && item.call_id === 'approval_1'));
  } finally {
    config.OPENAI_API_KEY = previousKey;
  }
});
