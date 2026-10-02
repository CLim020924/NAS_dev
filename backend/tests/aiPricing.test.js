const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateAiTokenCost } = require('../aiPricing');

test('gpt-4.1-mini 표준 단가로 비캐시·캐시 입력과 출력을 각각 계산한다', () => {
  const billing = calculateAiTokenCost('gpt-4.1-mini', {
    inputTokens: 1_000_000,
    cachedInputTokens: 250_000,
    outputTokens: 500_000,
  });

  assert.equal(billing.estimatedUsd, 1.125);
  assert.deepEqual(billing.ratesPerMillion, { input: 0.4, cachedInput: 0.1, output: 1.6 });
  assert.deepEqual(billing.usage, { inputTokens: 1_000_000, cachedInputTokens: 250_000, outputTokens: 500_000 });
});

test('날짜 고정 gpt-4.1-mini 별칭도 같은 표준 단가를 사용한다', () => {
  const billing = calculateAiTokenCost('gpt-4.1-mini-2025-04-14', {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(billing.estimatedUsd, 2);
  assert.equal(billing.model, 'gpt-4.1-mini-2025-04-14');
});

test('캐시 입력은 전체 입력을 넘지 못하고 알 수 없는 모델은 비용을 꾸며내지 않는다', () => {
  const billing = calculateAiTokenCost('gpt-4.1-mini', {
    inputTokens: 100,
    cachedInputTokens: 300,
    outputTokens: 0,
  });
  assert.equal(billing.usage.cachedInputTokens, 100);
  assert.equal(billing.estimatedUsd, 0.00001);
  assert.equal(calculateAiTokenCost('unknown-model', { inputTokens: 10, outputTokens: 5 }), null);
  assert.equal(calculateAiTokenCost('gpt-4.1-mini', {}), null);
});
