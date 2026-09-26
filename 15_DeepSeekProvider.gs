// ======================================================
// 15_DeepSeekProvider.gs
// 用途：AI provider adapter：DeepSeek transport 選擇與協議轉譯。
//
// 職責與協作：
// 1. 依能力選 Chat Completions、Responses 或 Anthropic Messages，dispatch 時才讀 DEEPSEEK_API_KEY。
// 2. 將共用 request 轉成 payload，將文字、usage、finish reason、Search metadata 與錯誤轉回共用結果。
// 3. 工具回合所需 thinking 與原始 assistant turn 僅在 provider closure 暫存。
//
// 維護注意：
// 1. 能力不支援時在 HTTP 前失敗；thinking 顯式設定，enabled 時不送 sampling。
// 2. Search 成功僅認正式 server metadata；Responses 用於 structured output，不作 server Search。
// 3. 圖片只在 adapter 編碼；原始 payload、reasoning、工具內容及 secret 不得外流或保存。
// 4. 不處理業務 validator、memory、LINE 排版或自動 retry；舊 callDeepSeek wrappers 保留相容。
// ======================================================

const DEEPSEEK_API_ENDPOINT = 'https://api.deepseek.com/chat/completions';
const DEEPSEEK_RESPONSES_API_ENDPOINT = 'https://api.deepseek.com/responses';
const DEEPSEEK_ANTHROPIC_MESSAGES_API_ENDPOINT = 'https://api.deepseek.com/anthropic/v1/messages';
// 低於官方 48 MiB body / GAS 50 MB POST 上限；一張 4 MiB raw 圖約佔 5.34 MiB。
const DEEPSEEK_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

/** 能力組合由 adapter 決定 transport；不支援的組合在讀 key／HTTP 之前失敗。 */
function resolveDeepSeekTransport_(request) {
  const capabilities = request.capabilities || [];
  if (!Array.isArray(capabilities) || capabilities.some(function(capability) {
    return ['text', 'thinking', 'vision', 'structuredOutput', 'webSearch', 'clientTools'].indexOf(capability) < 0;
  })) throw createAiConfigurationError_('Unknown DeepSeek capability.');
  const structured = !!request.outputSchema || capabilities.indexOf('structuredOutput') >= 0;
  const search = !!request.webSearchMode || capabilities.indexOf('webSearch') >= 0;
  const tools = (request.tools || []).length > 0 || capabilities.indexOf('clientTools') >= 0;
  const vision = capabilities.indexOf('vision') >= 0 || (request.messages || []).some(function(message) { return Array.isArray(message.content); });
  if (search && !request.webSearchMode) throw createAiConfigurationError_('Search capability requires a mode.');
  if (structured && (search || tools || vision || !request.outputSchema || request.outputMode !== 'json')) {
    throw createAiConfigurationError_('Unsupported structured output capability combination.');
  }
  if (structured) return 'responses';
  if (search || tools) return 'anthropic_messages';
  return 'chat_completions';
}

/** 已驗證的 DeepSeek policy；純檢查，不讀 key 或組 payload。不能把限制套到其他 provider。 */
function validateDeepSeekRequest_(request) {
  const transport = resolveDeepSeekTransport_(request);
  const mode = String(request.thinking && request.thinking.type || '');
  const effort = String(request.reasoningEffort || '');
  if (['enabled', 'disabled'].indexOf(mode) < 0 ||
      (mode === 'enabled' && ['high', 'max'].indexOf(effort) < 0) ||
      (mode === 'disabled' && effort) || (mode === 'enabled' && request.allowSampling === true)) {
    throw createAiConfigurationError_('Unsupported DeepSeek reasoning requirement.');
  }
  if (['text', 'json'].indexOf(request.outputMode) < 0 ||
      ['', 'auto', 'required'].indexOf(request.webSearchMode || '') < 0 ||
      (transport !== 'chat_completions' && mode !== 'enabled') ||
      (transport === 'anthropic_messages' && request.outputMode !== 'text') ||
      ((request.capabilities || []).indexOf('thinking') >= 0 && mode !== 'enabled') ||
      ((request.capabilities || []).indexOf('clientTools') >= 0 && !(request.tools || []).length)) {
    throw createAiConfigurationError_('Unsupported DeepSeek capability combination.');
  }
  return transport;
}

/**
 * DeepSeek adapter 正式入口。
 * 輸入是 AiService 已解析的 provider-neutral request；回傳 provider result contract。
 * API key 只在真的 dispatch 到 DeepSeek 時讀取，adapter 不會自行 retry。
 */
function callDeepSeekProvider_(request, privateContinuation) {
  const startedAt = Date.now();
  const safeRequest = request || {};
  let transport = '';
  let modelCalls = 0;
  let statusCode = 0;

  try {
    transport = validateDeepSeekRequest_(safeRequest);
    const payload = buildDeepSeekPayload_(safeRequest);
    if (privateContinuation) {
      // 原始 thinking / tool blocks 只存在這個 closure，從不交給 feature 或永久儲存。
      payload.messages = payload.messages.concat(privateContinuation.messages);
      const hasPendingSearch = Object.keys(privateContinuation.searchState.useIds).some(function(id) {
        return !privateContinuation.searchState.resultIds[id];
      });
      // Pending Search 需原 tools 與完整 turn；auto 續接，不重新強制呼叫 web_search。
      payload.tool_choice = { type: hasPendingSearch ? 'auto' : 'none' };
    }
    const serializedPayload = JSON.stringify(payload);
    if (Utilities.newBlob(serializedPayload).getBytes().length > DEEPSEEK_REQUEST_MAX_BYTES) {
      throw createAiConfigurationError_('DeepSeek request exceeds the local 8 MiB body limit.');
    }
    // 設定、圖片編碼、body ceiling 與 deadline 都先檢查，只有可 dispatch 才讀 secret。
    resolveAiRequestTimeoutSeconds_(safeRequest.timeoutSeconds, safeRequest);
    const apiKey = getRequiredScriptProperty_('DEEPSEEK_API_KEY');
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: transport === 'anthropic_messages'
        ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
        : { Authorization: 'Bearer ' + apiKey },
      payload: serializedPayload,
      muteHttpExceptions: true,
      followRedirects: false,
      // 編碼與序列化可能耗時；真正 fetch 前再扣同一 absolute deadline。
      timeoutSeconds: resolveAiRequestTimeoutSeconds_(safeRequest.timeoutSeconds, {
        executionDeadlineAtMs: safeRequest.executionDeadlineAtMs,
        minimumRequestSeconds: safeRequest.minimumRequestSeconds
      })
    };
    modelCalls = 1;
    const response = UrlFetchApp.fetch(
      transport === 'anthropic_messages' ? DEEPSEEK_ANTHROPIC_MESSAGES_API_ENDPOINT :
        (transport === 'responses' ? DEEPSEEK_RESPONSES_API_ENDPOINT : DEEPSEEK_API_ENDPOINT),
      options
    );
    statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return classifyDeepSeekHttpFailure_(statusCode, responseText, Date.now() - startedAt, transport);
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
        Date.now() - startedAt,
        null,
        '',
        transport
      );
    }

    if (transport === 'anthropic_messages') {
      const searchState = privateContinuation ? privateContinuation.searchState : {
        useIds: Object.create(null), resultIds: Object.create(null), tools: safeRequest.tools || []
      };
      const result = normalizeDeepSeekAnthropicMessagesResult_(json, statusCode,
        safeRequest.webSearchMode, Date.now() - startedAt, searchState, !!privateContinuation);
      if (result.ok && result.toolCalls && result.toolCalls.length) {
        // 可呼叫但不可序列化的 continuation，service 不需要也不能讀 vendor state。
        let continued = false;
        const originalDeadline = isFinite(safeRequest.executionDeadlineAtMs) && Number(safeRequest.executionDeadlineAtMs) > 0
          ? Number(safeRequest.executionDeadlineAtMs) : startedAt + Number(safeRequest.timeoutSeconds) * 1000;
        result.continueWithToolResults = function(toolResults, deadlineAtMs) {
          if (continued) return buildDeepSeekProviderFailure_('ai_tool_round_limit', '', 0, false, 0, null, '', transport);
          continued = true;
          return callDeepSeekProvider_(Object.assign({}, safeRequest, {
            executionDeadlineAtMs: isFinite(deadlineAtMs) && Number(deadlineAtMs) > 0
              ? Math.min(originalDeadline, Number(deadlineAtMs)) : originalDeadline,
            minimumRequestSeconds: AI_TOOL_FINAL_RESERVE_SECONDS
          }), { searchState: searchState, messages: [
            { role: 'assistant', content: json.content },
            { role: 'user', content: toolResults.map(function(item) {
              return { type: 'tool_result', tool_use_id: item.id, content: JSON.stringify(item.data) };
            }) }
          ] });
        };
      }
      return result;
    }
    if (transport === 'responses') return normalizeDeepSeekResponsesResult_(json, statusCode, Date.now() - startedAt);

    const choice = json && json.choices && json.choices[0];
    if (!choice || !choice.message || (choice.message.content != null && typeof choice.message.content !== 'string')) {
      return buildDeepSeekProviderFailure_(
        'ai_invalid_provider_response',
        'DeepSeek response has missing or invalid message content.',
        statusCode,
        true,
        Date.now() - startedAt,
        normalizeDeepSeekUsage_(json && json.usage),
        '',
        transport
      );
    }

    const finishReason = String(choice.finish_reason || '');
    // metadata 也需驗證；未知內容不可原樣穿透 console。null content 仍交由 finish/empty 檢查，
    // 尤其 reasoning 用完 budget 時，length 必須維持既有不可重試的截斷契約。
    if (['', 'stop', 'length', 'tool_calls', 'content_filter', 'insufficient_system_resource', 'aborted'].indexOf(finishReason) < 0) {
      return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek returned an unknown finish reason.', statusCode, true, Date.now() - startedAt, null, '', transport);
    }
    if (finishReason === 'insufficient_system_resource' || finishReason === 'aborted') {
      // 這是 DeepSeek protocol 的暫時性停止原因，必須在 adapter 轉成 retryable typed failure，
      // 避免 provider-neutral AiService 依賴供應商專屬字串。
      return buildDeepSeekProviderFailure_(
        'ai_provider_http_error',
        'DeepSeek generation was interrupted (' + finishReason + ').',
        statusCode,
        true,
        Date.now() - startedAt,
        normalizeDeepSeekUsage_(json.usage),
        'error',
        transport
      );
    }

    if (containsDeepSeekToolProtocolMarkup_(choice.message.content)) {
      return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek returned internal protocol markup.', statusCode, true, Date.now() - startedAt, null, '', transport);
    }
    return buildAiProviderResult_({
      ok: true,
      text: String(choice.message.content || ''),
      finishReason: finishReason,
      usage: normalizeDeepSeekUsage_(json.usage),
      elapsedMs: Date.now() - startedAt,
      httpStatus: statusCode,
      transport: transport,
      usedWebSearch: false,
      sources: []
    });

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
    return Object.assign(buildDeepSeekProviderFailure_(errorType, '', statusCode, retryable, Date.now() - startedAt, null, '', transport), { modelCalls: modelCalls });
  }
}

/**
 * 建立 DeepSeek 專屬 payload。
 * 所有 task 都送出 thinking；只有 disabled profile 才能送 sampling 欄位。
 * legacy JSON 使用 response_format；schema 與研究需求交給各自 transport builder。
 */
function buildDeepSeekPayload_(request) {
  const transport = validateDeepSeekRequest_(request);
  if (transport === 'anthropic_messages') return buildDeepSeekAnthropicMessagesPayload_(request);
  if (transport === 'responses') return buildDeepSeekResponsesPayload_(request);

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

/** 一般聊天／多模態研究：將 provider-neutral messages 翻成 DeepSeek Anthropic Messages。 */
function buildDeepSeekAnthropicMessagesPayload_(request) {
  const searchMode = String(request.webSearchMode || '');
  const thinkingType = String(request.thinking && request.thinking.type || '');
  const effort = String(request.reasoningEffort || '');
  if (['', 'auto', 'required'].indexOf(searchMode) < 0) {
    throw createAiConfigurationError_('Invalid Web Search mode.');
  }
  if (request.outputMode !== 'text') {
    throw createAiConfigurationError_('Search/tools with structured output is not supported by this adapter.');
  }
  if (thinkingType !== 'enabled' || (effort !== 'high' && effort !== 'max')) {
    throw createAiConfigurationError_('DeepSeek Anthropic Search request requires thinking enabled with effort high or max.');
  }

  const systemParts = [];
  const messages = [];
  request.messages.forEach(function(message) {
    if (message.role === 'system') {
      systemParts.push(String(message.content || ''));
      return;
    }
    messages.push({ role: message.role, content: Array.isArray(message.content) ? message.content.map(function(part) {
      return part.type === 'text' ? { type: 'text', text: part.text } : {
        type: 'image', source: { type: 'base64', media_type: part.mimeType, data: Utilities.base64Encode(part.bytes) }
      };
    }) : message.content });
  });

  return {
    model: request.model,
    max_tokens: Number(request.maxOutputTokens),
    system: systemParts.join('\n\n'),
    messages: messages,
    thinking: { type: 'enabled' },
    output_config: { effort: effort },
    // 一般問題已可能觸發兩次 server Search；保留三次成本上限，不 retry 或另建 Queue。
    tools: (searchMode ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] : []).concat((request.tools || []).map(function(tool) {
      return { name: tool.name, description: tool.description, input_schema: tool.parameters };
    })),
    tool_choice: searchMode === 'required'
      ? { type: 'tool', name: 'web_search' }
      : { type: 'auto' },
    stream: false
  };
}

/** Responses 專供結構化輸出；官方 built-in Search ignored，不能作 Search transport。 */
function buildDeepSeekResponsesPayload_(request) {
  const effort = String(request.reasoningEffort || '');
  if (request.webSearchMode || !request.outputSchema || request.outputMode !== 'json' ||
      request.messages.some(function(message) { return Array.isArray(message.content); })) {
    throw createAiConfigurationError_('Invalid structured output capability combination.');
  }
  if (effort !== 'high' && effort !== 'max') {
    throw createAiConfigurationError_('DeepSeek Responses request requires reasoning effort high or max.');
  }

  return {
    model: request.model,
    input: request.messages.map(function(message) {
      return { role: message.role, content: message.content };
    }),
    reasoning: { effort: effort },
    max_output_tokens: Number(request.maxOutputTokens),
    text: { format: { type: 'json_schema', name: request.task, schema: request.outputSchema } },
    stream: false
  };
}

function normalizeDeepSeekAnthropicMessagesResult_(json, statusCode, searchMode, elapsedMs, privateSearchState, isContinuation) {
  const usage = normalizeDeepSeekAnthropicUsage_(json && json.usage);
  const content = json && json.content;
  const stopReason = String(json && json.stop_reason || '');
  if (!json || json.type !== 'message' || json.role !== 'assistant' || !Array.isArray(content) || !stopReason) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek Anthropic response is malformed.', statusCode, true, elapsedMs, usage, '', 'anthropic_messages');
  }
  if (['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded'].indexOf(stopReason) < 0) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek Anthropic response has an unknown stop reason.', statusCode, true, elapsedMs, usage, '', 'anthropic_messages');
  }
  if (content.some(function(block) {
    return !block || ['text', 'thinking', 'tool_use', 'server_tool_use', 'web_search_tool_result'].indexOf(block.type) < 0 ||
      (block.type === 'text' && typeof block.text !== 'string') ||
      (block.type === 'server_tool_use' && (block.name !== 'web_search' || typeof block.id !== 'string' ||
        !block.input || typeof block.input.query !== 'string' || !block.input.query.trim())) ||
      (block.type === 'tool_use' && (!block.input || typeof block.input !== 'object' || Array.isArray(block.input))) ||
      (block.type === 'web_search_tool_result' && typeof block.tool_use_id !== 'string');
  })) return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'Invalid message content blocks.', statusCode, false, elapsedMs, usage, '', 'anthropic_messages');
  const clientBlocks = content.filter(function(block) { return block && block.type === 'tool_use'; });
  if ((stopReason === 'tool_use') !== (clientBlocks.length > 0)) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'Inconsistent client tool stop reason.', statusCode, false, elapsedMs, usage, '', 'anthropic_messages');
  }
  if (isContinuation && clientBlocks.length) {
    return buildDeepSeekProviderFailure_('ai_tool_round_limit', 'Only one client tool continuation is allowed.', statusCode, false, elapsedMs, usage, 'tool_calls', 'anthropic_messages');
  }
  const toolCalls = clientBlocks.map(function(block) { return { id: block.id, name: block.name, arguments: block.input }; });

  const searchUses = content.filter(function(block) {
    return block && block.type === 'server_tool_use' && block.name === 'web_search' && typeof block.id === 'string';
  });
  const searchResults = content.filter(function(block) {
    return block && block.type === 'web_search_tool_result' && typeof block.tool_use_id === 'string';
  });
  const searchState = privateSearchState || { useIds: Object.create(null), resultIds: Object.create(null), tools: [] };
  const searchUseIds = searchState.useIds;
  const searchResultIds = searchState.resultIds;
  searchUses.forEach(function(block) { searchUseIds[block.id] = (searchUseIds[block.id] || 0) + 1; });
  searchResults.forEach(function(block) { searchResultIds[block.tool_use_id] = (searchResultIds[block.tool_use_id] || 0) + 1; });
  const pendingIds = Object.keys(searchUseIds).filter(function(id) { return !searchResultIds[id]; });
  // Mixed tool_use 可先回 client 結果，再完成 server Search；其他缺結果情況仍失敗。
  const canDeferSearch = !isContinuation && stopReason === 'tool_use' && clientBlocks.length > 0;
  const searchFailed = searchResults.some(function(block) {
    // 官方成功形態一定是 result array；單一 object 是 tool error，其他非陣列也不可當成功。
    return !Array.isArray(block.content) || block.content.some(function(item) { return !item || item.type !== 'web_search_result'; });
  }) || Object.keys(searchUseIds).some(function(id) { return !id || searchUseIds[id] !== 1; }) ||
    Object.keys(searchResultIds).some(function(id) { return !id || searchUseIds[id] !== 1 || searchResultIds[id] !== 1; }) ||
    (pendingIds.length > 0 && !canDeferSearch);
  if (searchFailed) {
    return buildDeepSeekProviderFailure_('ai_web_search_failed', 'DeepSeek Web Search did not complete.', statusCode, true, elapsedMs, usage, 'error', 'anthropic_messages');
  }

  if (pendingIds.length) validateAiToolCalls_(toolCalls, searchState.tools);
  const usedWebSearch = Object.keys(searchResultIds).length > 0;
  const sources = usedWebSearch ? collectDeepSeekAnthropicWebSearchSources_(searchResults) : [];
  const text = content.reduce(function(parts, block) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    return parts;
  }, []).join('\n').trim();
  const finishReason = stopReason === 'end_turn' || stopReason === 'stop_sequence'
    ? 'stop'
    : (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded' ? 'length'
      : stopReason === 'tool_use' ? 'tool_calls' : stopReason === 'refusal' ? 'content_filter' : 'incomplete');

  // 不能只相信 text block：供應商內部 DSML／tool／reasoning protocol 不得進 LINE 或 memory。
  if (containsDeepSeekToolProtocolMarkup_(text)) {
    const errorType = searchMode === 'required' || /\bweb_search\b/i.test(text)
      ? 'ai_web_search_failed'
      : 'ai_invalid_provider_response';
    return buildDeepSeekProviderFailure_(errorType, 'DeepSeek returned internal tool protocol markup.', statusCode, true, elapsedMs, usage, finishReason, 'anthropic_messages');
  }
  if (searchMode === 'required' && !usedWebSearch && !pendingIds.length) {
    return buildDeepSeekProviderFailure_('ai_web_search_failed', 'DeepSeek did not execute the required Web Search.', statusCode, true, elapsedMs, usage, finishReason, 'anthropic_messages');
  }
  if (stopReason === 'pause_turn') {
    return buildDeepSeekProviderFailure_(usedWebSearch ? 'ai_web_search_failed' : 'ai_provider_http_error', 'DeepSeek Anthropic request did not complete in one response.', statusCode, true, elapsedMs, usage, finishReason, 'anthropic_messages');
  }

  return buildAiProviderResult_({
    ok: true,
    text: text,
    finishReason: finishReason,
    usage: usage,
    elapsedMs: elapsedMs,
    httpStatus: statusCode,
    transport: 'anthropic_messages',
    usedWebSearch: usedWebSearch,
    sources: sources,
    toolCalls: toolCalls
  });
}

/** 只保留正式 tool result 的 title／URL；raw result、encrypted content 與 cited text 不穿透 adapter。 */
function collectDeepSeekAnthropicWebSearchSources_(searchResults) {
  const sources = [];
  const seen = {};
  (searchResults || []).forEach(function(block) {
    (Array.isArray(block && block.content) ? block.content : []).forEach(function(result) {
      if (!result || result.type !== 'web_search_result') return;
      const url = String(result.url || '').trim();
      if (!url || url.length > 2048 || seen[url] || !isSafePublicUrl(url)) return;
      seen[url] = true;
      sources.push({
        title: redactAiMediaText_(result.title).replace(/\s+/g, ' ').trim().slice(0, 160),
        url: url
      });
    });
  });
  return sources.slice(0, 3);
}

function normalizeDeepSeekAnthropicUsage_(usage) {
  const source = usage || {};
  const inputTokens = normalizeAiOptionalNumber_(source.input_tokens);
  const outputTokens = normalizeAiOptionalNumber_(source.output_tokens);
  return normalizeAiUsage_({
    inputTokens: inputTokens,
    cachedInputTokens: null,
    uncachedInputTokens: null,
    outputTokens: outputTokens,
    reasoningTokens: null,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null
  });
}

function normalizeDeepSeekResponsesResult_(json, statusCode, elapsedMs) {
  const responseStatus = String(json && json.status || '');
  const output = json && json.output;
  const usage = normalizeDeepSeekResponsesUsage_(json && json.usage);
  if (!json || json.object !== 'response' || !Array.isArray(output) ||
      ['completed', 'incomplete', 'failed'].indexOf(responseStatus) < 0) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek Responses payload is malformed.', statusCode, true, elapsedMs, usage, '', 'responses');
  }
  if (responseStatus === 'failed') {
    return buildDeepSeekProviderFailure_('ai_provider_http_error', 'DeepSeek Responses request failed.', statusCode, true, elapsedMs, usage, '', 'responses');
  }

  if (output.some(function(item) { return !item || ['message', 'reasoning'].indexOf(item.type) < 0; })) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'Unexpected structured response item.', statusCode, false, elapsedMs, usage, '', 'responses');
  }
  const text = output.reduce(function(parts, item) {
    if (!item || item.type !== 'message' || !Array.isArray(item.content)) return parts;
    item.content.forEach(function(part) {
      if (part && part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    });
    return parts;
  }, []).join('\n').trim();
  const incompleteReason = String(json.incomplete_details && json.incomplete_details.reason || '');
  const finishReason = responseStatus === 'completed'
    ? 'stop'
    : (incompleteReason === 'max_output_tokens' ? 'length' : 'incomplete');

  // 結構化 output_text 也可能夾帶內部協議；整份拒絕，不解析或執行文字裡的工具。
  if (containsDeepSeekToolProtocolMarkup_(text)) {
    return buildDeepSeekProviderFailure_('ai_invalid_provider_response', 'DeepSeek returned internal tool protocol markup.', statusCode, true, elapsedMs, usage, finishReason, 'responses');
  }

  return buildAiProviderResult_({
    ok: true,
    text: text,
    finishReason: finishReason,
    usage: usage,
    elapsedMs: elapsedMs,
    httpStatus: statusCode,
    transport: 'responses',
    usedWebSearch: false,
    sources: []
  });
}

/**
 * 只攔明確的 tag/protocol 形態；一般文字提到 DSML 或 web_search 不會命中。
 * DeepSeek 的正式 DSML 會帶全形分隔符，但 production 也曾出現省略分隔符的 invoke 形態。
 */
function containsDeepSeekToolProtocolMarkup_(text) {
  const value = String(text || '');
  return /<\s*(?:[|｜]\s*)?DSML(?:\s*[|｜])?\s*(?:tool_calls?|function_calls?|invoke|parameter)?\b[^>]*>/i.test(value) ||
    /<\s*(?:tool_calls?|function_calls?)\b[^>]*>/i.test(value) ||
    /<\s*invoke\b[^>]*\bname\s*=\s*["'][^"']+["'][^>]*>/i.test(value) ||
    /<\s*(?:think|reasoning)\s*>[\s\S]*<\s*\/\s*(?:think|reasoning)\s*>/i.test(value);
}

function normalizeDeepSeekResponsesUsage_(usage) {
  const source = usage || {};
  const inputDetails = source.input_tokens_details || {};
  const outputDetails = source.output_tokens_details || {};
  const input = normalizeAiOptionalNumber_(source.input_tokens);
  const cached = normalizeAiOptionalNumber_(inputDetails.cached_tokens);
  return normalizeAiUsage_({
    inputTokens: source.input_tokens,
    cachedInputTokens: inputDetails.cached_tokens,
    uncachedInputTokens: input !== null && cached !== null && cached <= input ? input - cached : null,
    outputTokens: source.output_tokens,
    reasoningTokens: outputDetails.reasoning_tokens,
    totalTokens: source.total_tokens
  });
}

/**
 * 將 DeepSeek usage 轉成 provider-neutral 欄位。
 * reasoning token 位於 completion_tokens_details.reasoning_tokens；cache hit/miss 為 optional。
 */
function normalizeDeepSeekUsage_(usage) {
  const source = usage || {};
  const details = source.completion_tokens_details || {};
  return normalizeAiUsage_({
    inputTokens: source.prompt_tokens,
    cachedInputTokens: source.prompt_cache_hit_tokens,
    uncachedInputTokens: source.prompt_cache_miss_tokens,
    outputTokens: source.completion_tokens,
    reasoningTokens: details.reasoning_tokens,
    totalTokens: source.total_tokens
  });
}

/**
 * DeepSeek HTTP 錯誤分類。401/403 與其他 4xx 通常需修設定，不應讓 Queue 無效重試；
 * 408/429/5xx 才視為暫時性。error body 不外傳，防止供應商把圖片或 request 反射進 log。
 */
function classifyDeepSeekHttpFailure_(statusCode, responseText, elapsedMs, transport) {
  const status = Number(statusCode || 0);
  const providerMessage = 'DeepSeek HTTP request failed (' + status + ').';
  if (status === 401 || status === 403) {
    return buildDeepSeekProviderFailure_('ai_auth_error', providerMessage, status, false, elapsedMs, null, '', transport);
  }
  if (status === 408) {
    return buildDeepSeekProviderFailure_('ai_timeout', providerMessage, status, true, elapsedMs, null, '', transport);
  }
  if (status === 429) {
    return buildDeepSeekProviderFailure_('ai_rate_limit', providerMessage, status, true, elapsedMs, null, '', transport);
  }
  return buildDeepSeekProviderFailure_(
    'ai_provider_http_error',
    providerMessage,
    status,
    status >= 500,
    elapsedMs,
    null,
    '',
    transport
  );
}

function extractDeepSeekErrorMessage_(responseText) {
  // 保留舊 helper 名稱；原始錯誤 body 可能包含敏感 request，不回傳其片段。
  return 'DeepSeek HTTP request failed.';
}

function buildDeepSeekProviderFailure_(errorType, errorMessage, httpStatus, retryable, elapsedMs, usage, finishReason, transport) {
  return buildAiProviderResult_({
    ok: false,
    text: '',
    finishReason: String(finishReason || ''),
    usage: usage || {},
    elapsedMs: Number(elapsedMs || 0),
    errorType: errorType || 'ai_unknown_error',
    errorMessage: String(errorMessage || 'DeepSeek provider request failed.'),
    httpStatus: Number(httpStatus || 0),
    retryable: retryable === true,
    transport: String(transport || ''),
    usedWebSearch: false,
    sources: []
  });
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
