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

