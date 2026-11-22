// ======================================================
// 16_GeminiProvider.gs
// 用途：Gemini generateContent adapter，負責能力驗證、雙 Key 與協議轉譯。
// ======================================================

const GEMINI_API_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
// 與既有本機 body 上限一致，容納一張 4 MiB 圖片的 base64 與剩餘上下文。
const GEMINI_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

function isGeminiObject_(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isGeminiSchema_(schema) {
  const keywords = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum',
    'minimum', 'maximum', 'maxLength', 'maxItems', 'description'];
  if (!isGeminiObject_(schema) || Object.keys(schema).some(function(key) { return keywords.indexOf(key) < 0; }) ||
      ['object', 'array', 'string', 'number', 'integer', 'boolean'].indexOf(schema.type) < 0) return false;
  if (['minimum', 'maximum'].some(function(key) { return schema[key] !== undefined && !Number.isFinite(schema[key]); }) ||
      ['maxLength', 'maxItems'].some(function(key) { return schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0); }) ||
      (schema.description !== undefined && typeof schema.description !== 'string')) return false;
  if (schema.type === 'object') {
    return isGeminiObject_(schema.properties) &&
      (schema.additionalProperties === undefined || typeof schema.additionalProperties === 'boolean') &&
      (schema.required === undefined || (Array.isArray(schema.required) && schema.required.every(function(key) {
        return typeof key === 'string' && Object.prototype.hasOwnProperty.call(schema.properties, key);
      }))) &&
      Object.keys(schema.properties).every(function(key) { return isGeminiSchema_(schema.properties[key]); });
  }
  if (schema.type === 'array') return isGeminiSchema_(schema.items);
  return schema.enum === undefined || (Array.isArray(schema.enum) && schema.enum.length > 0);
}

/** 純檢查；沿用共用圖片與工具契約，驗證期間不讀 Key 或編碼。 */
function validateGeminiRequest_(request) {
  const model = Object.keys(AI_MODEL_REGISTRY).map(function(key) { return AI_MODEL_REGISTRY[key]; }).find(function(entry) {
    return entry.provider === 'gemini' && !entry.dormant && entry.model === request.model;
  });
  const capabilities = request.capabilities;
  if (!model || !Array.isArray(capabilities) ||
      capabilities.some(function(capability) { return model.capabilities.indexOf(capability) < 0; })) {
    throw createAiConfigurationError_('Unsupported Gemini model or capability.');
  }
  if (model.reasoning.modes.indexOf(request.thinking && request.thinking.type) < 0 ||
      model.reasoning.efforts.indexOf(request.reasoningEffort) < 0 ||
      (request.allowSampling === true && !model.reasoning.samplingWhileThinking)) {
    throw createAiConfigurationError_('Unsupported Gemini thinking level or sampling.');
  }
  const messages = normalizeAiMessages_(request.messages);
  const hasImage = messages.some(function(message) {
    return Array.isArray(message.content) && message.content.some(function(part) { return part.type === 'image'; });
  });
  if (!messages.some(function(message) { return message.role === 'user'; }) ||
      (hasImage && capabilities.indexOf('vision') < 0) ||
      !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
    throw createAiConfigurationError_('Invalid Gemini message, vision capability or output limit.');
  }

  const search = request.webSearchMode;
  const tools = request.tools || [];
  const schema = request.outputSchema;
  if ((search !== undefined && search !== '' && search !== 'required') ||
      (search && capabilities.indexOf('webSearch') < 0) ||
      !Array.isArray(tools) || (tools.length > 0) !== (capabilities.indexOf('clientTools') >= 0)) {
    throw createAiConfigurationError_('Invalid Gemini Search or client tool configuration.');
  }
  const allowed = getAiReadOnlyToolDefinitions_();
  if (tools.some(function(tool, index) {
    return !tool || typeof tool.description !== 'string' || !allowed.some(function(item) { return item.name === tool.name; }) ||
      tools.findIndex(function(item) { return item && item.name === tool.name; }) !== index ||
      !tool.parameters || tool.parameters.type !== 'object' || !isGeminiSchema_(tool.parameters);
  })) throw createAiConfigurationError_('Invalid Gemini function declaration.');

  const json = request.outputMode === 'json';
  const structured = capabilities.indexOf('structuredOutput') >= 0;
  if ((!json && request.outputMode !== 'text') || (json && model.capabilities.indexOf('structuredOutput') < 0) ||
      (structured && (!json || !schema || schema.type !== 'object' || !isGeminiSchema_(schema))) ||
      (!structured && schema)) {
    throw createAiConfigurationError_('Invalid Gemini response schema or output mode.');
  }
  return messages;
}

/** 首輪和續接共用同一個模型、金鑰和絕對截止時間，續接資料只保留在本次呼叫。 */
function callGeminiProvider_(request) {
  const startedAt = Date.now();
  try {
    const messages = validateGeminiRequest_(request || {});
    resolveAiRequestTimeoutSeconds_(request.timeoutSeconds, request);
    const callerDeadline = Number(request.executionDeadlineAtMs);
    const deadlineAtMs = Math.min(callerDeadline > 0 ? callerDeadline : Infinity, startedAt + request.timeoutSeconds * 1000);
    const payload = buildGeminiProviderPayload_(Object.assign({}, request, { messages: messages }));
    const search = (payload.tools || []).some(function(tool) { return !!tool.google_search; });
    const keyProperty = search ? 'GEMINI_SEARCH_API_KEY' : 'GEMINI_API_KEY';
    const endpoint = GEMINI_API_ENDPOINT_BASE + encodeURIComponent(request.model) + ':generateContent';
    let apiKey = '';

    return dispatch(payload, deadlineAtMs, false, startedAt);

    function dispatch(body, deadline, continuation, turnStartedAt) {
      const observed = { transport: 'generate_content', modelCalls: 0, httpStatus: 0 };
      try {
        const serialized = JSON.stringify(body);
        if (Utilities.newBlob(serialized).getBytes().length > GEMINI_REQUEST_MAX_BYTES) {
          throw createAiConfigurationError_('Gemini request exceeds the local 8 MiB body limit.');
        }
        const timing = { executionDeadlineAtMs: deadline, minimumRequestSeconds: continuation
          ? Math.max(Number(request.minimumRequestSeconds) || 0, AI_TOOL_FINAL_RESERVE_SECONDS)
          : request.minimumRequestSeconds };
        resolveAiRequestTimeoutSeconds_(request.timeoutSeconds, timing);
        if (!apiKey) {
          try {
            apiKey = getRequiredScriptProperty_(keyProperty);
          } catch (error) {
            if (!error || error.message !== 'Missing ' + keyProperty + ' in Script Properties') throw error;
            return failure('ai_configuration_error', false, 'missing_' + keyProperty.toLowerCase());
          }
        }
        const options = {
          method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': apiKey }, payload: serialized,
          muteHttpExceptions: true, followRedirects: false,
          timeoutSeconds: resolveAiRequestTimeoutSeconds_(request.timeoutSeconds, timing)
        };
        observed.modelCalls = 1;
        observed.keyScope = search ? 'search_paid' : 'free';
        const response = UrlFetchApp.fetch(endpoint, options);
        observed.httpStatus = response.getResponseCode();
        const status = observed.httpStatus;
        if (status < 200 || status >= 300) {
          if (status === 401 || status === 403) return failure('ai_auth_error', false);
          if (status === 408) return failure('ai_timeout', true);
          if (status === 429) {
            const quota = readGeminiQuotaFailure_(response, request.model, Date.now());
            observed.retryNotBeforeMs = quota.retryNotBeforeMs;
            return failure('ai_rate_limit', true, quota.errorReason);
          }
          return failure('ai_provider_http_error', status >= 500 || status === 0, status === 0 ? 'api_no_response' : '');
        }
        let json;
        try { json = JSON.parse(response.getContentText()); }
        catch (error) { return failure('ai_invalid_provider_response', true, 'api_response_not_json'); }
        observed.elapsedMs = Date.now() - turnStartedAt;
        return normalizeGeminiResponse_(json, observed, search, request.tools || [], continuation ? null :
          function(content, calls) {
            return buildGeminiContinuation_(content, calls, deadline, function(turn, nextDeadline) {
              const next = Object.assign({}, payload, { contents: payload.contents.concat(turn) });
              return dispatch(next, nextDeadline, true, Date.now());
            });
          });
      } catch (error) {
        const errorType = error && error.errorType;
        if (errorType) return failure(errorType, error.retryable === true, error.errorReason);
        if (/timed out|timeout/i.test(String(error && error.message || ''))) return failure('ai_timeout', true);
        return failure('ai_unknown_error', true, observed.modelCalls === 1 && !observed.httpStatus ? 'api_no_response' : '');
      }

      function failure(errorType, retryable, errorReason) {
        return buildAiProviderResult_(Object.assign(observed, {
          ok: false, errorType: errorType, errorReason: errorReason, retryable: retryable, elapsedMs: Date.now() - turnStartedAt
        }));
      }
    }
  } catch (error) {
    return buildAiProviderResult_({
      ok: false, errorType: error && error.errorType, errorReason: error && error.errorReason,
      retryable: !!(error && error.retryable), elapsedMs: Date.now() - startedAt, transport: 'generate_content', modelCalls: 0
    });
  }
}

function buildGeminiProviderPayload_(request) {
  const systemParts = [];
  const contents = [];
  request.messages.forEach(function(message) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      return;
    }
    const role = message.role === 'assistant' ? 'model' : 'user';
    // Gemini 從 user 回合開始。舊快取截斷後可能剩下沒有對應提問的助理回覆。
    if (!contents.length && role === 'model') return;
    const parts = Array.isArray(message.content) ? message.content.map(function(part) {
      return part.type === 'text' ? { text: part.text } :
        { inline_data: { mime_type: part.mimeType, data: Utilities.base64Encode(part.bytes) } };
    }) : [{ text: message.content }];
    const previous = contents[contents.length - 1];
    // 引用、證據與提問維持 part 順序，同角色合成 Gemini 的同一回合。
    if (previous && previous.role === role) previous.parts = previous.parts.concat(parts);
    else contents.push({ role: role, parts: parts });
  });
  const generationConfig = {
    maxOutputTokens: request.maxOutputTokens,
    thinkingConfig: { thinkingLevel: request.reasoningEffort.toUpperCase() }
  };
  if (request.outputMode === 'json') {
    generationConfig.responseMimeType = 'application/json';
    if (request.outputSchema) generationConfig.responseJsonSchema = request.outputSchema;
  }
  const payload = { contents: contents, generationConfig: generationConfig };
  if (systemParts.length) payload.systemInstruction = { parts: [{ text: systemParts.join('\n\n') }] };

  const tools = [];
  const search = request.webSearchMode === 'required';
  const clientTools = request.tools || [];
  if (search) tools.push({ google_search: {} });
  if (clientTools.length) tools.push({ functionDeclarations: clientTools.map(function(tool) {
    return { name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters };
  }) });
  if (tools.length) payload.tools = tools;
  // 混用時循環原樣傳回伺服器工具的 context；REST 此模式不接受 AUTO。
  if (search && clientTools.length) {
    payload.toolConfig = { includeServerSideToolInvocations: true, functionCallingConfig: { mode: 'VALIDATED' } };
  }
  return payload;
}

function normalizeGeminiResponse_(json, observed, search, tools, makeContinuation) {
  observed.usage = normalizeGeminiUsage_(json && json.usageMetadata);
  const fail = function(errorType, retryable, errorReason) {
    return buildAiProviderResult_(Object.assign(observed, { ok: false, errorType: errorType, errorReason: errorReason, retryable: retryable }));
  };
  const block = json && json.promptFeedback && json.promptFeedback.blockReason;
  if (typeof block === 'string' && block && block !== 'BLOCK_REASON_UNSPECIFIED') {
    observed.finishReason = 'content_filter';
    return fail('ai_finish_reason_error', false);
  }
  const candidate = json && Array.isArray(json.candidates) && json.candidates[0];
  if (!isGeminiObject_(candidate) || (block !== undefined && typeof block !== 'string')) {
    return fail('ai_invalid_provider_response', true);
  }
  if (search) {
    const grounded = readGeminiGrounding_(candidate.groundingMetadata);
    if (grounded.errorReason) return fail('ai_web_search_failed', true, grounded.errorReason);
    observed.sources = grounded.sources;
    observed.usedWebSearch = grounded.sources.length > 0;
  }
  const reason = candidate.finishReason;
  observed.finishReason = normalizeGeminiFinishReason_(reason);
  if (observed.finishReason === 'length') return fail('ai_finish_reason_length', false);
  if (observed.finishReason === 'content_filter') return fail('ai_finish_reason_error', false);
  if (reason === 'MALFORMED_FUNCTION_CALL') return fail('ai_invalid_tool_call', false);
  if (reason === 'UNEXPECTED_TOOL_CALL') return fail('ai_tool_not_allowed', false);
  if (reason === 'TOO_MANY_TOOL_CALLS') return fail('ai_tool_limit', false);
  if (!observed.finishReason || observed.finishReason === 'error') return fail('ai_invalid_provider_response', true);

  const content = candidate.content;
  const parts = content === undefined ? [] : content && content.parts;
  if (!Array.isArray(parts) || parts.some(function(part) { return !isGeminiResponsePart_(part); })) {
    return fail('ai_invalid_provider_response', true);
  }
  const calls = parts.filter(function(part) { return part.functionCall; }).map(function(part) { return part.functionCall; });
  if (!calls.length) return buildAiProviderResult_(Object.assign(observed, { ok: true, text: extractGeminiText(json) }));
  if (!makeContinuation) return fail('ai_tool_round_limit', false);
  if (!tools.length || content.role !== 'model') return fail('ai_invalid_tool_call', false);
  const providerIds = new Set();
  if (calls.some(function(call) {
    if (typeof call.name !== 'string' || !call.name ||
        (call.args !== undefined && !isGeminiObject_(call.args)) ||
        (call.id !== undefined && (typeof call.id !== 'string' || !call.id || providerIds.has(call.id)))) return true;
    if (call.id !== undefined) providerIds.add(call.id);
    return false;
  })) return fail('ai_invalid_tool_call', false);
  const toolCalls = calls.map(function(call, index) {
    return { id: 'gemini_call_' + index, name: call.name, arguments: call.args || {} };
  });
  return buildAiProviderResult_(Object.assign(observed, {
    ok: true, finishReason: 'tool_calls', toolCalls: toolCalls, continueWithToolResults: makeContinuation(content, calls)
  }));
}

function isGeminiResponsePart_(part) {
  if (!isGeminiObject_(part) ||
      (part.thought !== undefined && typeof part.thought !== 'boolean') ||
      (part.thoughtSignature !== undefined && typeof part.thoughtSignature !== 'string')) return false;
  const fields = ['text', 'functionCall', 'toolCall', 'toolResponse'].filter(function(key) { return part[key] !== undefined; });
  if (!fields.length) return typeof part.thoughtSignature === 'string';
  return fields.length === 1 && (fields[0] === 'text' ? typeof part.text === 'string' : isGeminiObject_(part[fields[0]]));
}

function buildGeminiContinuation_(content, calls, originalDeadline, send) {
  let used = false;
  return function(results, deadlineAtMs) {
    const fail = function(errorType) {
      return buildAiProviderResult_({ ok: false, errorType: errorType, transport: 'generate_content', modelCalls: 0 });
    };
    if (used) return fail('ai_tool_round_limit');
    used = true;
    if (!Array.isArray(results) || results.length !== calls.length) return fail('ai_invalid_tool_call');

    const responses = [];
    for (let index = 0; index < calls.length; index++) {
      const call = calls[index];
      const result = results.find(function(item) { return item && item.id === 'gemini_call_' + index; });
      if (!result || !isGeminiObject_(result.data)) return fail('ai_invalid_tool_call');
      const functionResponse = { name: call.name, response: result.data };
      if (call.id !== undefined) functionResponse.id = call.id;
      responses.push({ functionResponse: functionResponse });
    }
    const deadline = typeof deadlineAtMs === 'number' && isFinite(deadlineAtMs) && deadlineAtMs > 0
      ? Math.min(originalDeadline, deadlineAtMs) : originalDeadline;
    // Gemini 的 signature 可附在任何 part；原樣保留 model 回合的次序與伺服器工具結果。
    return send([content, { role: 'user', parts: responses }], deadline);
  };
}

/** 只承認有 support 指向有效 HTTPS 網頁的 grounding，不取 query、HTML 或轉址目的地。 */
function readGeminiGrounding_(metadata) {
  const noGrounding = { sources: [], errorReason: '' };
  if (metadata === undefined) return noGrounding;
  const invalid = { sources: [], errorReason: 'search_result_invalid' };
  if (!isGeminiObject_(metadata)) return invalid;
  const chunks = metadata.groundingChunks;
  const supports = metadata.groundingSupports;
  if ((chunks !== undefined && !Array.isArray(chunks)) || (supports !== undefined && !Array.isArray(supports))) return invalid;
  if (!chunks || !supports || !supports.length) return noGrounding;
  const referenced = new Set();
  for (const support of supports) {
    if (!isGeminiObject_(support)) return invalid;
    const indices = support.groundingChunkIndices;
    if (indices === undefined) continue;
    if (!Array.isArray(indices) || indices.some(function(index) {
      return !Number.isInteger(index) || index < 0 || index >= chunks.length;
    })) return invalid;
    indices.forEach(function(index) { referenced.add(index); });
  }

  const sources = [];
  for (let index = 0; index < chunks.length; index++) {
    if (!referenced.has(index)) continue;
    const chunk = chunks[index];
    if (!isGeminiObject_(chunk)) return invalid;
    if (chunk.web === undefined) continue;
    const web = chunk.web;
    if (!isGeminiObject_(web)) return invalid;
    if (typeof web.uri !== 'string' || web.uri.length > 2048 || !/^https:\/\/\S+$/i.test(web.uri) || !isSafePublicUrl(web.uri)) {
      return { sources: [], errorReason: 'search_source_url_invalid' };
    }
    if (web.title !== undefined && typeof web.title !== 'string') return { sources: [], errorReason: 'search_source_title_invalid' };
    sources.push({ url: web.uri, title: web.title || '' });
  }
  return { sources: sources, errorReason: '' };
}

function extractGeminiText(json) {
  const candidate = json && json.candidates && json.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts;
  if (!Array.isArray(parts)) return '';
  return parts.filter(function(part) { return part && part.thought !== true && typeof part.text === 'string'; })
    .map(function(part) { return part.text; }).join('').trim();
}

/**
 * Gemini usage 欄位不是所有模型都完整提供，因此全部視為 optional。
 * thoughtsTokenCount 映射到 reasoningTokens，避免 provider 差異污染功能層。
 */
function normalizeGeminiUsage_(usageMetadata) {
  const source = usageMetadata || {};
  const inputTokens = normalizeAiOptionalNumber_(source.promptTokenCount);
  const cachedTokens = normalizeAiOptionalNumber_(source.cachedContentTokenCount);
  const uncachedTokens = inputTokens !== null && cachedTokens !== null && cachedTokens <= inputTokens
    ? inputTokens - cachedTokens
    : null;
  return normalizeAiUsage_({
    inputTokens: inputTokens,
    cachedInputTokens: cachedTokens,
    uncachedInputTokens: uncachedTokens,
    outputTokens: source.candidatesTokenCount,
    reasoningTokens: source.thoughtsTokenCount,
    totalTokens: source.totalTokenCount
  });
}

function normalizeGeminiFinishReason_(finishReason) {
  if (finishReason === 'STOP') return 'stop';
  if (finishReason === 'MAX_TOKENS') return 'length';
  if (['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION', 'IMAGE_SAFETY',
    'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION', 'ESCALATION', 'PUP_LIMITED_DISABLED'].indexOf(finishReason) >= 0) return 'content_filter';
  return !finishReason || finishReason === 'FINISH_REASON_UNSPECIFIED' ? '' : 'error';
}

// ======================================================
// v1.13.0 compatibility wrappers
// ======================================================

/**
 * v1.13.0 compatibility wrapper：正式 legacy reader 已直接呼叫 21_WebReader.gs 的
 * extractRawHtmlWithAi_()。保留原回傳 webResult contract 供舊部署診斷，不是 Gemini fallback。
 * 確認部署端與外部手動函式至少一版無 caller 後可移除。
 */
function callGeminiWebExtractor(url, rawHtml, contentType) {
  return extractRawHtmlWithAi_(url, rawHtml, contentType);
}
