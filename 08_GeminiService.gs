// ======================================================
// 08_GeminiService.gs
// 小浣 LINE Bot v1.13.0 AI Routing & Project Architecture Edition
//
// 主要責任：
// 1. 保留 dormant Gemini provider transport：authentication、endpoint、payload、HTTP、response 與 usage parsing。
// 2. 將 Gemini candidates / usageMetadata 轉為和其他 provider 相同的 provider result contract。
// 3. 只有 19_AiProfiles.gs 的 task route 明確選到 Gemini 時，才讀取 GEMINI_API_KEY。
//
// 明確不負責：
// 1. v1.13.0 正常 runtime 不使用 Gemini；Gemini 也不是 DeepSeek 的自動 fallback。
// 2. 不保存 NewsInbox、快讀摘要或 raw HTML extraction 的 Prompt、schema、normalizer、validator。
// 3. 不決定 task route，不寫 Sheet，不處理 memory、Queue retry 或 LINE 排版。
//
// 保留原因與維護注意：
// 1. 保留 provider 是為了未來模型價格/能力競爭、快速重新啟用與可能的多模態用途。
// 2. 缺少 GEMINI_API_KEY 不影響 DeepSeek runtime；key 只在 callGeminiProvider_() 真正被 dispatch 時讀取。
// 3. 重新啟用前必須核對當時最新 Gemini API、model ID、thinking 與 payload 規格；
//    本檔不保證 v1.13.0 保存的 v1beta generateContent 格式永遠有效。
// 4. 本版 adapter 僅允許 non-thinking route。未來若要把 thinking task 切到 Gemini，
//    必須先明確實作並驗證 Gemini 當時的推理參數，不可靜默忽略 execution profile。
// ======================================================

const GEMINI_API_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Gemini dormant adapter 正式入口，只供 AiService provider dispatch。
 * 輸入是 provider-neutral request；只有進入此函式後才 lazy-load GEMINI_API_KEY。
 */
function callGeminiProvider_(request) {
  const startedAt = Date.now();
  const safeRequest = request || {};

  try {
    if (String(safeRequest.thinking && safeRequest.thinking.type || '') !== 'disabled') {
      return buildGeminiProviderFailure_(
        'ai_configuration_error',
        'Dormant Gemini adapter requires a reviewed non-thinking route before reactivation.',
        0,
        false,
        Date.now() - startedAt
      );
    }

    const apiKey = getRequiredScriptProperty_('GEMINI_API_KEY');
    const endpoint = GEMINI_API_ENDPOINT_BASE +
      encodeURIComponent(safeRequest.model) +
      ':generateContent?key=' +
      encodeURIComponent(apiKey);
    const payload = buildGeminiProviderPayload_(safeRequest);
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      timeoutSeconds: Math.max(1, Number(safeRequest.timeoutSeconds || 60))
    };
    const response = UrlFetchApp.fetch(endpoint, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return classifyGeminiHttpFailure_(statusCode, responseText, Date.now() - startedAt);
    }

    let json = null;
    try {
      json = JSON.parse(responseText);
    } catch (parseError) {
      return buildGeminiProviderFailure_(
        'ai_invalid_provider_response',
        'Gemini returned a non-JSON HTTP response.',
        statusCode,
        true,
        Date.now() - startedAt
      );
    }

    const candidate = json.candidates && json.candidates[0];
    if (!candidate) {
      return buildGeminiProviderFailure_(
        'ai_invalid_provider_response',
        'Gemini response is missing candidates[0].',
        statusCode,
        true,
        Date.now() - startedAt,
        normalizeGeminiUsage_(json.usageMetadata)
      );
    }

    return {
      ok: true,
      text: extractGeminiText(json),
      finishReason: normalizeGeminiFinishReason_(candidate.finishReason),
      usage: normalizeGeminiUsage_(json.usageMetadata),
      elapsedMs: Date.now() - startedAt,
      httpStatus: statusCode
    };

  } catch (error) {
    const message = String(error && error.message ? error.message : error || 'Gemini request failed.');
    const lower = message.toLowerCase();
    let errorType = String(error && error.errorType || '') || 'ai_unknown_error';
    let retryable = error && typeof error.retryable === 'boolean' ? error.retryable : true;
    if (!error || !error.errorType) {
      if (lower.indexOf('missing gemini_api_key') >= 0) {
        errorType = 'ai_configuration_error';
        retryable = false;
      } else if (lower.indexOf('timed out') >= 0 || lower.indexOf('timeout') >= 0) {
        errorType = 'ai_timeout';
      }
    }
    return buildGeminiProviderFailure_(errorType, message, 0, retryable, Date.now() - startedAt);
  }
}

/**
 * 將 OpenAI-style messages 轉為 Gemini generateContent 協議。
 * system message 合併為 systemInstruction；assistant role 轉為 model。
 * JSON mode 只處理 API mime type，業務 Prompt 與 schema 必須由功能模組提供。
 */
function buildGeminiProviderPayload_(request) {
  const systemParts = [];
  const contents = [];
  (request.messages || []).forEach(function(message) {
    if (message.role === 'system') {
      systemParts.push(String(message.content || ''));
      return;
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }]
    });
  });

  const generationConfig = {
    maxOutputTokens: Number(request.maxOutputTokens)
  };
  if (request.allowSampling === true) {
    if (typeof request.temperature === 'number') generationConfig.temperature = request.temperature;
    if (typeof request.topP === 'number') generationConfig.topP = request.topP;
  }
  if (request.outputMode === 'json') generationConfig.responseMimeType = 'application/json';

  const payload = {
    contents: contents,
    generationConfig: generationConfig
  };
  if (systemParts.length) {
    payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };
  }
  return payload;
}

function extractGeminiText(json) {
  try {
    const candidate = json.candidates && json.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    if (!parts || !Array.isArray(parts)) return '';
    return parts.map(function(part) { return part.text || ''; }).join('').trim();
  } catch (error) {
    return '';
  }
}

/**
 * Gemini usage 欄位不是所有模型都完整提供，因此全部視為 optional。
 * thoughtsTokenCount 映射到 reasoningTokens，避免 provider 差異污染功能層。
 */
function normalizeGeminiUsage_(usageMetadata) {
  const source = usageMetadata || {};
  const inputTokens = source.promptTokenCount;
  const cachedTokens = source.cachedContentTokenCount;
  const uncachedTokens = typeof inputTokens === 'number' && typeof cachedTokens === 'number'
    ? Math.max(0, inputTokens - cachedTokens)
    : null;
  return {
    inputTokens: inputTokens,
    cachedInputTokens: cachedTokens,
    uncachedInputTokens: uncachedTokens,
    outputTokens: source.candidatesTokenCount,
    reasoningTokens: source.thoughtsTokenCount,
    totalTokens: source.totalTokenCount
  };
}

function normalizeGeminiFinishReason_(finishReason) {
  const reason = String(finishReason || '').trim().toUpperCase();
  if (reason === 'STOP') return 'stop';
  if (reason === 'MAX_TOKENS') return 'length';
  if (reason === 'SAFETY' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') return 'content_filter';
  return reason.toLowerCase();
}

function classifyGeminiHttpFailure_(statusCode, responseText, elapsedMs) {
  const status = Number(statusCode || 0);
  const message = extractGeminiErrorMessage_(responseText);
  if (status === 401 || status === 403) return buildGeminiProviderFailure_('ai_auth_error', message, status, false, elapsedMs);
  if (status === 408) return buildGeminiProviderFailure_('ai_timeout', message, status, true, elapsedMs);
  if (status === 429) return buildGeminiProviderFailure_('ai_rate_limit', message, status, true, elapsedMs);
  return buildGeminiProviderFailure_('ai_provider_http_error', message, status, status >= 500, elapsedMs);
}

function extractGeminiErrorMessage_(responseText) {
  const raw = String(responseText || '');
  try {
    const parsed = JSON.parse(raw);
    return String(parsed && parsed.error && parsed.error.message || 'Gemini HTTP request failed.').slice(0, 500);
  } catch (error) {
    return ('Gemini HTTP request failed: ' + raw.slice(0, 300)).trim();
  }
}

function buildGeminiProviderFailure_(errorType, errorMessage, httpStatus, retryable, elapsedMs, usage) {
  return {
    ok: false,
    text: '',
    finishReason: '',
    usage: usage || {},
    elapsedMs: Number(elapsedMs || 0),
    errorType: errorType || 'ai_unknown_error',
    errorMessage: String(errorMessage || 'Gemini provider request failed.'),
    httpStatus: Number(httpStatus || 0),
    retryable: retryable === true
  };
}

// ======================================================
// v1.13.0 compatibility wrappers
// ======================================================

/**
 * v1.13.0 compatibility wrapper：repo 正式 runtime 已無 caller。
 * 舊名稱雖含 Gemini，現在轉交 07_WebTaskQueue.gs 的 provider-neutral 快讀入口，
 * 因此不會讀 GEMINI_API_KEY。保留一版供 GAS 手動測試相容；確認部署端無 caller 後可移除。
 */
function callGeminiWebLazySummary(url, rawHtml, contentType, originalMessage) {
  return runWebLazySummaryAi_(url, rawHtml, contentType, originalMessage, {});
}

/**
 * v1.13.0 compatibility wrapper：正式 legacy reader 已直接呼叫 06_WebReader.gs 的
 * extractRawHtmlWithAi_()。保留原回傳 webResult contract 供舊部署診斷，不是 Gemini fallback。
 * 確認部署端與外部手動函式至少一版無 caller 後可移除。
 */
function callGeminiWebExtractor(url, rawHtml, contentType) {
  return extractRawHtmlWithAi_(url, rawHtml, contentType);
}
