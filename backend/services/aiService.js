const config = require('../config/env');

const isAiConfigured = () => (
  config.AI_PROVIDER === 'openai' &&
  !!config.OPENAI_API_KEY &&
  !!config.OPENAI_MODEL
);

const getAiStatus = () => ({
  provider: config.AI_PROVIDER,
  model: config.OPENAI_MODEL,
  enabled: config.AI_ENABLED,
  configured: isAiConfigured(),
});

const extractResponsesText = (data = {}) => {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === 'string') parts.push(content.text);
      if (typeof content.output_text === 'string') parts.push(content.output_text);
    }
  }
  return parts.join('\n').trim();
};

const extractChatText = (data = {}) => {
  const content = data.choices?.[0]?.message?.content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part.text || part.content || '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return String(content || '').trim();
};

const fetchJson = async (url, body) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'AI 요청에 실패했습니다.');
    error.status = response.status;
    error.openaiPayload = data;
    throw error;
  }
  return data;
};

const callOpenAIResponses = async ({ systemPrompt, userPrompt, temperature = 0.2 }) => {
  if (!isAiConfigured()) {
    const error = new Error('AI 설정이 필요합니다.');
    error.status = 503;
    throw error;
  }

  const responseBody = {
    model: config.OPENAI_MODEL,
    instructions: systemPrompt,
    input: userPrompt,
    temperature,
  };

  try {
    const data = await fetchJson('https://api.openai.com/v1/responses', responseBody);
    const text = extractResponsesText(data);
    if (text) return text;
  } catch (err) {
    const message = String(err.message || '');
    if (!message.toLowerCase().includes('temperature')) {
      try {
        const fallback = await fetchJson('https://api.openai.com/v1/chat/completions', {
          model: config.OPENAI_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
        });
        const fallbackText = extractChatText(fallback);
        if (fallbackText) return fallbackText;
      } catch (chatErr) {
        throw err;
      }
      throw err;
    }
  }

  const data = await fetchJson('https://api.openai.com/v1/responses', {
    model: config.OPENAI_MODEL,
    instructions: systemPrompt,
    input: userPrompt,
  });
  const text = extractResponsesText(data);
  if (text) return text;

  const fallback = await fetchJson('https://api.openai.com/v1/chat/completions', {
    model: config.OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  const fallbackText = extractChatText(fallback);
  if (fallbackText) return fallbackText;

  const error = new Error('AI 응답이 비어 있습니다.');
  error.status = 502;
  throw error;
};

const callOpenAIResponsesLegacy = async ({ systemPrompt, userPrompt, temperature = 0.2 }) => {
  if (!isAiConfigured()) {
    const error = new Error('AI 설정이 필요합니다.');
    error.status = 503;
    throw error;
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      temperature,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'AI 요청에 실패했습니다.');
    error.status = response.status;
    throw error;
  }

  return data.output_text || '';
};

const summarizeMeetingMessages = async (messages = []) => {
  const compactMessages = messages
    .slice(-300)
    .map((message) => {
      const speaker = message.displayName || message.nickname || message.userId || 'unknown';
      const at = message.createdAt || '';
      const text = String(message.text || message.content || '').trim();
      return `[${at}] ${speaker}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');

  return callOpenAIResponses({
    systemPrompt: [
      '너는 NAS 화상회의 기록을 정리하는 한국어 회의 비서다.',
      '대화의 주제, 결정사항, 할 일, 미해결 질문을 간결하게 정리한다.',
      '발화자를 가능한 한 보존하고, 추측은 추측이라고 표시한다.',
    ].join('\n'),
    userPrompt: compactMessages || '회의 메시지가 없습니다.',
  });
};

module.exports = {
  isAiConfigured,
  getAiStatus,
  callOpenAIResponses,
  summarizeMeetingMessages,
};
