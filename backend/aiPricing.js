const PRICING_SOURCE = 'https://developers.openai.com/api/docs/pricing';
const PRICING_VERIFIED_AT = '2026-10-02';
const TOKENS_PER_MILLION = 1_000_000;

// Standard API pricing in USD per 1M tokens. Keep this deliberately narrow:
// an unknown model must omit the estimate instead of silently using the wrong rate.
const STANDARD_TOKEN_PRICING = Object.freeze({
  'gpt-4.1-mini': Object.freeze({ input: 0.40, cachedInput: 0.10, output: 1.60 }),
});

const normalizeTokenCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const resolvePricing = (modelValue) => {
  const model = String(modelValue || '').trim().toLowerCase();
  if (!model) return null;
  if (STANDARD_TOKEN_PRICING[model]) return { model, rates: STANDARD_TOKEN_PRICING[model] };
  if (/^gpt-4\.1-mini-\d{4}-\d{2}-\d{2}$/.test(model)) {
    return { model, rates: STANDARD_TOKEN_PRICING['gpt-4.1-mini'] };
  }
  return null;
};

const calculateAiTokenCost = (modelValue, usageValue = {}) => {
  const pricing = resolvePricing(modelValue);
  if (!pricing) return null;

  const inputTokens = normalizeTokenCount(usageValue.inputTokens);
  const outputTokens = normalizeTokenCount(usageValue.outputTokens);
  const cachedInputTokens = Math.min(inputTokens, normalizeTokenCount(usageValue.cachedInputTokens));
  if (inputTokens + outputTokens === 0) return null;

  const uncachedInputTokens = inputTokens - cachedInputTokens;
  const estimatedUsd = (
    (uncachedInputTokens * pricing.rates.input)
    + (cachedInputTokens * pricing.rates.cachedInput)
    + (outputTokens * pricing.rates.output)
  ) / TOKENS_PER_MILLION;

  return {
    currency: 'USD',
    estimatedUsd,
    model: pricing.model,
    usage: { inputTokens, cachedInputTokens, outputTokens },
    ratesPerMillion: { ...pricing.rates },
    pricingTier: 'standard',
    pricingVerifiedAt: PRICING_VERIFIED_AT,
    pricingSource: PRICING_SOURCE,
  };
};

module.exports = {
  PRICING_SOURCE,
  PRICING_VERIFIED_AT,
  STANDARD_TOKEN_PRICING,
  calculateAiTokenCost,
};
