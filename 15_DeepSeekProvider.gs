// ======================================================
// 15_DeepSeekProvider.gs
// AI provider adapter：DeepSeek transport 與 provider protocol translation。
// 小浣 LINE Bot v1.14.0 DeepSeek Flash Multimodal Edition
//
// 主要責任：
// 1. 作為 DeepSeek provider adapter，lazy-load DEEPSEEK_API_KEY 並呼叫 Chat Completions。
// 2. 將 provider-neutral request 轉成 DeepSeek payload，解析 choices、finish reason 與 usage。
// 3. 將 HTTP、rate limit、timeout、auth 與 provider response 錯誤映射為穩定 typed error。
//
// 明確不負責：
// 1. 不決定 task route/profile，不保存功能 Prompt、memory、Sheet 或 LINE 排版。
// 2. 不做 JSON schema/business validation、不做 retry、不做跨 provider fallback。
// 3. 不讓功能層接觸 choices、reasoning_content 或 DeepSeek 原始 usage 欄位。
//
// 檔案關係與維護注意：
// 1. 10_AiService.gs 是正式 service 入口；本檔主要入口 callDeepSeekProvider_() 只供其 dispatch。
// 2. 11_AiProfiles.gs 保證每個 task 顯式指定 thinking；本檔仍會防守缺值，避免依賴 API 預設。
// 3. 本專案 thinking request 不送 sampling；官方 2026-09-10 雖允許 top_p，本版不需調整。
//    正式 route 固定 high；多模態的 image_url/data URL 只在此 adapter 產生，不流入記憶。
// 4. 下方舊 callDeepSeek... 函式是 v1.13.0 compatibility wrapper，不是正式 runtime 首選。
// ======================================================

const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
// 低於官方 48 MiB body / GAS 50 MB POST 上限；一張 4 MiB raw 圖約佔 5.34 MiB。
const DEEPSEEK_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

/**
 * DeepSeek adapter 正式入口。
 * 輸入是 AiService 已解析的 provider-neutral request；回傳 provider result contract。
 * API key 只在真的 dispatch 到 DeepSeek 時讀取，adapter 不會自行 retry。
 */
function callDeepSeekProvider_(request) {
  const startedAt = Date.now();
  const safeRequest = request || {};

  try {
    const apiKey = getRequiredScriptProperty_('DEEPSEEK_API_KEY');
    const thinkingType = String(safeRequest.thinking && safeRequest.thinking.type || '');
    if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
      return buildDeepSeekProviderFailure_(
        'ai_configuration_error',
        'DeepSeek request must explicitly set thinking enabled or disabled.',
        0,
        false,
        Date.now() - startedAt
      );
    }

    const payload = buildDeepSeekPayload_(safeRequest);
    const serializedPayload = JSON.stringify(payload);
    if (Utilities.newBlob(serializedPayload).getBytes().length > DEEPSEEK_REQUEST_MAX_BYTES) {
      throw createAiConfigurationError_('DeepSeek request exceeds the local 8 MiB body limit.');
    }
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: serializedPayload,
      muteHttpExceptions: true,
      // 編碼與序列化可能耗時；真正 fetch 前再扣同一 absolute deadline。
      timeoutSeconds: resolveAiRequestTimeoutSeconds_(safeRequest.timeoutSeconds, {
        executionDeadlineAtMs: safeRequest.executionDeadlineAtMs,
        minimumRequestSeconds: safeRequest.minimumRequestSeconds
      })
    };
    const response = UrlFetchApp.fetch(DEEPSEEK_API_ENDPOINT, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return classifyDeepSeekHttpFailure_(statusCode, responseText, Date.now() - startedAt);
    }

    let json = null;
    try {
      json = JSON.parse(responseText);
    } catch (parseError) {
      return buildDeepSeekProviderFailure_(
        'ai_invalid_provider_response',
        'DeepSeek returned a non-JSON HTTP response.',
        statusCode,
        true,
        Date.now() - startedAt
      );
    }

    const choice = json && json.choices && json.choices[0];
    if (!choice || !choice.message || (choice.message.content != null && typeof choice.message.content !== 'string')) {
      return buildDeepSeekProviderFailure_(
        'ai_invalid_provider_response',
        'DeepSeek response has missing or invalid message content.',
        statusCode,
        true,
        Date.now() - startedAt,
        normalizeDeepSeekUsage_(json && json.usage)
      );
    }

    const finishReason = String(choice.finish_reason || '');
    // metadata 也需驗證；未知內容不可原樣穿透 console。null content 仍交由 finish/empty 檢查，
    // 尤其 reasoning 用完 budget 時，length 必須維持既有不可重試的截斷契約。
    if (['', 'stop', 'length', 'tool_calls', 'content_filter', 'insufficient_system_resource'].indexOf(finishReason) < 0) {
      return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek returned an unknown finish reason.', statusCode, true, Date.now() - startedAt);
    }
    if (finishReason === 'insufficient_system_resource') {
      // 這是 DeepSeek protocol 的暫時性停止原因，必須在 adapter 轉成 retryable typed failure，
      // 避免 provider-neutral AiService 依賴供應商專屬字串。
      return buildDeepSeekProviderFailure_(
        'ai_provider_http_error',
        'DeepSeek stopped because of insufficient system resources.',
        statusCode,
        true,
        Date.now() - startedAt,
        normalizeDeepSeekUsage_(json.usage),
        finishReason
      );
    }

    return {
      ok: true,
      text: String(choice.message.content || ''),
      finishReason: finishReason,
      usage: normalizeDeepSeekUsage_(json.usage),
      elapsedMs: Date.now() - startedAt,
      httpStatus: statusCode
    };

  } catch (error) {
    const message = String(error && error.message ? error.message : error || 'DeepSeek request failed.');
    const lower = message.toLowerCase();
    let errorType = String(error && error.errorType || '') || 'ai_unknown_error';
    let retryable = error && typeof error.retryable === 'boolean' ? error.retryable : true;

    if (!error || !error.errorType) {
      if (lower.indexOf('missing deepseek_api_key') >= 0) {
        errorType = 'ai_configuration_error';
        retryable = false;
      } else if (lower.indexOf('timed out') >= 0 || lower.indexOf('timeout') >= 0) {
        errorType = 'ai_timeout';
        retryable = true;
      }
    }

    // GAS/供應商例外可能夾帶 request、binary 或 secret；只輸出固定技術訊息。
    return buildDeepSeekProviderFailure_(errorType, 'DeepSeek request failed (' + errorType + ').', 0, retryable, Date.now() - startedAt);
  }
}

/**
 * 建立 DeepSeek 專屬 payload。
 * 所有 task 都送出 thinking；只有 disabled profile 才能送 sampling 欄位。
 * JSON mode 使用 response_format，max output 使用 Chat Completions 的 max_tokens。
 */
function buildDeepSeekPayload_(request) {
  const thinkingType = String(request.thinking && request.thinking.type || '');
  if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
    throw createAiConfigurationError_('DeepSeek request must explicitly set thinking.');
  }
  const payload = {
    model: request.model,
    messages: request.messages.map(function(message) {
      return { role: message.role, content: Array.isArray(message.content)
        ? message.content.map(function(part) {
          return part.type === 'text' ? { type: 'text', text: part.text } : {
            type: 'image_url',
            image_url: { url: 'data:' + part.mimeType + ';base64,' + Utilities.base64Encode(part.bytes) }
          };
        })
        : message.content };
    }),
    thinking: { type: thinkingType },
    max_tokens: Number(request.maxOutputTokens),
    stream: false
  };

  if (thinkingType === 'enabled') {
    const effort = String(request.reasoningEffort || '');
    if (effort !== 'high' && effort !== 'max') {
      throw createAiConfigurationError_('DeepSeek thinking request requires reasoning_effort high or max.');
    }
    payload.reasoning_effort = effort;
  } else if (request.allowSampling === true) {
    if (typeof request.temperature === 'number') payload.temperature = request.temperature;
    if (typeof request.topP === 'number') payload.top_p = request.topP;
  }

  if (request.outputMode === 'json') {
    payload.response_format = { type: 'json_object' };
  }

  return payload;
}

/**
 * 將 DeepSeek usage 轉成 provider-neutral 欄位。
 * reasoning token 位於 completion_tokens_details.reasoning_tokens；cache hit/miss 為 optional。
 */
function normalizeDeepSeekUsage_(usage) {
  const source = usage || {};
  const details = source.completion_tokens_details || {};
  return {
    inputTokens: source.prompt_tokens,
    cachedInputTokens: source.prompt_cache_hit_tokens,
    uncachedInputTokens: source.prompt_cache_miss_tokens,
    outputTokens: source.completion_tokens,
    reasoningTokens: details.reasoning_tokens,
    totalTokens: source.total_tokens
  };
}

/**
 * DeepSeek HTTP 錯誤分類。401/403 與其他 4xx 通常需修設定，不應讓 Queue 無效重試；
 * 408/429/5xx 才視為暫時性。error body 不外傳，防止供應商把圖片或 request 反射進 log。
 */
function classifyDeepSeekHttpFailure_(statusCode, responseText, elapsedMs) {
  const status = Number(statusCode || 0);
  const providerMessage = 'DeepSeek HTTP request failed (' + status + ').';
  if (status === 401 || status === 403) {
    return buildDeepSeekProviderFailure_('ai_auth_error', providerMessage, status, false, elapsedMs);
  }
  if (status === 408) {
    return buildDeepSeekProviderFailure_('ai_timeout', providerMessage, status, true, elapsedMs);
  }
  if (status === 429) {
    return buildDeepSeekProviderFailure_('ai_rate_limit', providerMessage, status, true, elapsedMs);
  }
  return buildDeepSeekProviderFailure_(
    'ai_provider_http_error',
    providerMessage,
    status,
    status >= 500,
    elapsedMs
  );
}

function extractDeepSeekErrorMessage_(responseText) {
  // 保留舊 helper 名稱；原始錯誤 body 可能包含敏感 request，不回傳其片段。
  return 'DeepSeek HTTP request failed.';
}

function buildDeepSeekProviderFailure_(errorType, errorMessage, httpStatus, retryable, elapsedMs, usage, finishReason) {
  return {
    ok: false,
    text: '',
    finishReason: String(finishReason || ''),
    usage: usage || {},
    elapsedMs: Number(elapsedMs || 0),
    errorType: errorType || 'ai_unknown_error',
    errorMessage: String(errorMessage || 'DeepSeek provider request failed.'),
    httpStatus: Number(httpStatus || 0),
    retryable: retryable === true
  };
}

// ======================================================
// v1.13.0 compatibility wrappers
// ======================================================

/**
 * v1.13.0 compatibility wrapper：正式 runtime 已無 caller。
 * 保留給 GAS 手動診斷或尚未搜尋到的外部呼叫，轉交 Reader Layer + runAiMemoryTask()。
 * 待一個正式版本確認部署專案與 repo 都沒有 caller 後，才可列入移除評估。
 */
function callDeepSeekWithWebReading(conversationId, userText, mode) {
  const task = resolveLegacyAiTask_(mode);
  const urls = extractUrls(userText).slice(0, MAX_URLS_PER_MESSAGE);
  if (!urls.length) return callDeepSeekWithMemory(conversationId, userText, mode);
  const webResults = urls.map(function(url) { return fetchAndExtractWebPageByReaderLayer_(url); });
  const prompt = buildWebReadingPrompt(userText, webResults, task);
  return requireAiText_(runAiMemoryTask(task, conversationId, userText, prompt));
}

/**
 * v1.13.0 compatibility wrapper：正式一般聊天已改呼叫 runAiMemoryTask()。
 * 保留原名稱避免 GAS 手動測試或外部腳本立刻失效；它不再直接組 DeepSeek payload。
 * 未來確認至少一版無外部依賴後可移除。
 */
function callDeepSeekWithMemory(conversationId, userText, mode) {
  return requireAiText_(runAiMemoryTask(resolveLegacyAiTask_(mode), conversationId, userText, userText));
}

/**
 * v1.13.0 compatibility wrapper：正式 runtime 已改用 runAiMemoryTask() 傳入 history text 與 AI content。
 * 本版保留是為避免舊診斷 caller 中斷；未來確認部署端無 caller 後可移除。
 */
function callDeepSeekWithMemoryPayload(conversationId, userTextForHistory, deepSeekUserContent, mode) {
  return requireAiText_(runAiMemoryTask(
    resolveLegacyAiTask_(mode),
    conversationId,
    userTextForHistory,
    deepSeekUserContent
  ));
}

/**
 * v1.13.0 compatibility wrapper：正式功能已改用 runAiTextTask / runAiJsonTask。
 * 保留原回傳字串以相容舊手動測試；它轉交 AiService，不再是 provider 直連。
 * JSON caller 不應使用本 wrapper；部署端確認無 caller 後可移除。
 */
function callDeepSeekDirect(userText, mode) {
  const task = resolveLegacyAiTask_(mode);
  const config = resolveAiTaskConfig_(task);
  const result = config.outputMode === 'json'
    ? runAiJsonTask(task, userText)
    : runAiTextTask(task, userText);
  return config.outputMode === 'json' ? JSON.stringify(requireAiJson_(result)) : requireAiText_(result);
}
