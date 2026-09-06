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

const fetchJson = async (url, body, fetchImpl = fetch) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutError = new Error('AI 응답 시간이 초과되었습니다. 같은 요청을 자동 재실행하지 않았습니다.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'AI 요청에 실패했습니다.');
    error.status = response.status;
    error.openaiPayload = data;
    throw error;
  }
  return data;
};

const normalizeUsage = (usage = {}) => ({
  inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
  outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
  totalTokens: Number(usage.total_tokens ?? 0),
});

const addUsage = (left, right) => ({
  inputTokens: left.inputTokens + right.inputTokens,
  outputTokens: left.outputTokens + right.outputTokens,
  totalTokens: left.totalTokens + right.totalTokens,
});

const callOpenAIAgent = async ({
  systemPrompt,
  input,
  resumeState = null,
  resumeOutputs = [],
  tools = [],
  onToolCall,
  onProgress,
  maxTurns = config.AI_MAX_AGENT_TURNS,
  maxOutputTokens = config.AI_MAX_OUTPUT_TOKENS,
  fetchImpl = fetch,
}) => {
  if (!isAiConfigured()) {
    const error = new Error('AI 설정이 필요합니다.');
    error.status = 503;
    throw error;
  }

  let responseInput = resumeState?.responseInput || (
    Array.isArray(input) ? input : [{ role: 'user', content: String(input || '') }]
  );
  if (!Array.isArray(responseInput)) {
    const error = new Error('저장된 AI 작업 상태가 올바르지 않습니다.');
    error.status = 409;
    throw error;
  }
  if (Array.isArray(resumeOutputs) && resumeOutputs.length > 0) {
    responseInput = [...responseInput, ...resumeOutputs];
  }
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const events = [];
  let toolCallCount = Number(resumeState?.toolCallCount || 0);
  const firstTurn = Number(resumeState?.nextTurn || 0);
  const notifyProgress = async (event) => {
    if (typeof onProgress !== 'function') return;
    try { await onProgress(event); } catch (err) {}
  };

  for (let turn = firstTurn; turn < maxTurns; turn += 1) {
    await notifyProgress({ type: 'model_request', turn: turn + 1, toolCallCount });
    let data;
    try {
      data = await fetchJson('https://api.openai.com/v1/responses', {
        model: config.OPENAI_MODEL,
        instructions: systemPrompt,
        input: responseInput,
        tools,
        parallel_tool_calls: false,
        max_output_tokens: maxOutputTokens,
        store: false,
      }, fetchImpl);
    } catch (err) {
      err.usage = usage;
      throw err;
    }
    usage = addUsage(usage, normalizeUsage(data.usage));

    const calls = (data.output || []).filter((item) => item.type === 'function_call');
    if (calls.length === 0) {
      await notifyProgress({ type: 'model_response', turn: turn + 1, toolCallCount });
      const text = extractResponsesText(data);
      if (!text) {
        const error = new Error('AI 응답이 비어 있습니다.');
        error.status = 502;
        error.usage = usage;
        throw error;
      }
      return { text, usage, events };
    }

    if (toolCallCount + calls.length > config.AI_MAX_TOOL_CALLS) {
      const error = new Error('AI 도구 호출 상한에 도달했습니다. 요청을 더 작은 단위로 나눠주세요.');
      error.status = 429;
      error.usage = usage;
      throw error;
    }
    toolCallCount += calls.length;

    const outputs = [];
    const interruptions = [];
    for (const call of calls) {
      let args = {};
      try {
        args = JSON.parse(call.arguments || '{}');
        if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('arguments must be an object');
      } catch (err) {
        const failure = { error: '도구 인자가 올바른 JSON 객체가 아니어서 실행하지 않았습니다.', code: 'AI_TOOL_ARGUMENTS_INVALID' };
        events.push({ callId: call.call_id, name: call.name, ok: false, result: failure });
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, ...failure }) });
        continue;
      }
      try {
        await notifyProgress({ type: 'tool_start', name: call.name, callId: call.call_id, toolCallCount });
        const result = await onToolCall(call.name, args, call.call_id);
        events.push({ callId: call.call_id, name: call.name, ok: true, result });
        await notifyProgress({ type: 'tool_complete', name: call.name, callId: call.call_id, toolCallCount, resultStatus: result?.status || 'completed' });
        if (result?.status === 'pending_approval' && result?.actionId) {
          interruptions.push({
            callId: call.call_id,
            name: call.name,
            actionId: result.actionId,
            title: result.title || result.action?.title || call.name,
          });
        } else {
          outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: true, result }) });
        }
      } catch (err) {
        const failure = { error: err.message || '도구 실행에 실패했습니다.', code: err.code || null };
        events.push({ callId: call.call_id, name: call.name, ok: false, result: failure });
        await notifyProgress({ type: 'tool_complete', name: call.name, callId: call.call_id, toolCallCount, ok: false });
        outputs.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, ...failure }) });
      }
    }
    if (interruptions.length > 0) {
      return {
        paused: true,
        interruptions,
        continuation: {
          version: 1,
          responseInput: [...responseInput, ...(data.output || []), ...outputs],
          nextTurn: turn + 1,
          toolCallCount,
        },
        usage,
        events,
      };
    }
    responseInput = [...responseInput, ...(data.output || []), ...outputs];
  }

  const error = new Error('AI 도구 실행 횟수 제한에 도달했습니다. 요청을 더 작은 단위로 나눠주세요.');
  error.status = 429;
  error.usage = usage;
  throw error;
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
  callOpenAIAgent,
  summarizeMeetingMessages,
  _test: { extractResponsesText, normalizeUsage },
};
