// ======================================================
// 11_AiProfiles.gs
// 用途：AI configuration：provider／model 能力、execution profiles 與 task routes。
//
// 職責與協作：
// 1. 集中 provider、model、capabilities、thinking、輸出模式、token／timeout 與 route override。
// 2. resolver 驗證 provider/model 歸屬、能力需求與預期 thinking，交給 AiService 執行。
//
// 維護注意：
// 1. 此處不讀 key、不呼叫 API；business schema 在 13_AiSchemas.gs，payload 在 provider adapter。
// 2. 任務 reasoning effort 依 model 能力驗證；相容旗標由 capability list 推導。
// 3. profile timeout 是上限，同步 caller 另受 webhook cap 約束；retryPolicy 僅描述 caller-owned 策略。
// 4. Gemini 是唯一 active provider；DeepSeek 保留 dormant，不提供自動 fallback。
// ======================================================

const AI_PROVIDER_REGISTRY = {
  deepseek: {
    id: 'deepseek',
    // 函式只在 dispatch 時呼叫；不依賴 GAS 檔案載入順序或做 top-level 初始化。
    adapter: function(request) { return callDeepSeekProvider_(request); },
    validateRequest: function(request) { return validateDeepSeekRequest_(request); },
    status: 'dormant'
  },
  gemini: {
    id: 'gemini',
    adapter: function(request) { return callGeminiProvider_(request); },
    validateRequest: function(request) { return validateGeminiRequest_(request); },
    quotaPolicy: {
      scope: function(request) { return getGeminiQuotaScope_(request); },
      read: function(scope) { return readGeminiQuotaBlocks_(scope); },
      record: function(scope, model, result, startedAtMs) { return recordGeminiQuotaBlock_(scope, model, result, startedAtMs); }
    },
    status: 'active'
  }
};

const GEMINI_MODEL_CAPABILITIES = ['text', 'thinking', 'vision', 'structuredOutput', 'webSearch', 'clientTools'];

const AI_MODEL_REGISTRY = {
  deepseek_flash: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    capabilities: ['text', 'thinking', 'vision', 'structuredOutput', 'webSearch', 'clientTools'],
    // 這是本專案已驗證的 model policy，不是所有 provider 的 reasoning 限制。
    reasoning: { modes: ['enabled', 'disabled'], efforts: ['high', 'max'], samplingWhileThinking: false }
  },
  gemini_4_hydrogen: {
    provider: 'gemini', model: 'gemini-4-hydrogen', capabilities: GEMINI_MODEL_CAPABILITIES,
    reasoning: { modes: ['enabled'], efforts: ['low', 'medium', 'high', 'xhigh'], samplingWhileThinking: false }
  },
  gemini_38_flash: {
    provider: 'gemini', model: 'gemini-3.8-flash', capabilities: GEMINI_MODEL_CAPABILITIES,
    reasoning: { modes: ['enabled'], efforts: ['low', 'medium', 'high'], samplingWhileThinking: false }
  },
  gemini_35_flash_lite: {
    provider: 'gemini', model: 'gemini-3.5-flash-lite', capabilities: GEMINI_MODEL_CAPABILITIES,
    reasoning: { modes: ['enabled'], efforts: ['minimal', 'low', 'medium', 'high'], samplingWhileThinking: false }
  }
};

const AI_RETRYABLE_ERROR_TYPES = [
  'ai_rate_limit',
  'ai_timeout',
  'ai_provider_http_error',
  'ai_empty_response',
  'ai_invalid_json',
  'ai_invalid_provider_response',
  'ai_unknown_error'
];

const AI_EXECUTION_PROFILES = {
  // 結構化 profile 共用 JSON 與 timeout；任務可指定 reasoning effort。
  // 一般 8000，短補充／封存另縮小，週編輯台另擴大；背景 timeout 保持 60 秒。
  thinking_json: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'low',
    allowSampling: false,
    outputMode: 'json',
    maxOutputTokens: 8000,
    timeoutSeconds: 60,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 長文抽取保留原本 24000-token 正文空間，另加 4000 給 reasoning；90 秒上限不變。
  // 獨立 profile 避免一般 JSON 取得長文預算；同步 caller 仍受共同 deadline 約束。
  long_extraction_json: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'low',
    allowSampling: false,
    outputMode: 'json',
    maxOutputTokens: 28000,
    timeoutSeconds: 90,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 一般聊天、圖片與脈絡比對共用文字 profile，webhook 另套 30 秒 cap。
  thinking_text: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'low',
    allowSampling: false,
    outputMode: 'text',
    maxOutputTokens: 8000,
    timeoutSeconds: 120,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },
  image_caption_fast: {
    thinking: { type: 'enabled' }, reasoningEffort: 'minimal', allowSampling: false, outputMode: 'text',
    // 保留短回答與 MINIMAL thinking 的輸出餘裕。
    maxOutputTokens: 1024, timeoutSeconds: 10, requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },
  gatekeeper_json: {
    thinking: { type: 'enabled' }, reasoningEffort: 'minimal', allowSampling: false, outputMode: 'json',
    maxOutputTokens: 256, timeoutSeconds: 8, requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },
  daily_state_text: {
    thinking: { type: 'enabled' }, reasoningEffort: 'minimal', allowSampling: false, outputMode: 'text',
    maxOutputTokens: 256, timeoutSeconds: 4, requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  }
};

const AI_TASK_ROUTES = {
  chat_gatekeeper: {
    provider: 'gemini', model: 'gemini_35_flash_lite', profile: 'gatekeeper_json',
    expectedThinking: 'enabled', expectedReasoningEffort: 'minimal'
  },
  bot_daily_state: {
    provider: 'gemini', model: 'gemini_35_flash_lite', profile: 'daily_state_text',
    expectedThinking: 'enabled', expectedReasoningEffort: 'minimal'
  },
  // 兩種 Key 共用模型候選；只有明確搜尋才會掛 Search。
  general_chat: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_text', expectedThinking: 'enabled', fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'], expectedReasoningEffort: 'low',
    maxOutputTokens: 4800, timeoutSeconds: 45, capabilities: ['webSearch', 'clientTools']
  },
  news_analysis: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_json', expectedThinking: 'enabled', fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'], expectedReasoningEffort: 'low',
    maxOutputTokens: 8000, timeoutSeconds: 60
  },
  raw_html_extraction: {
    provider: 'gemini', model: 'gemini_38_flash', profile: 'long_extraction_json', expectedThinking: 'enabled', fallbackModels: ['gemini_35_flash_lite'], expectedReasoningEffort: 'low', legacyJson: true
  },
  archive_news: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_json', expectedThinking: 'enabled',
    fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'],
    reasoningEffort: 'medium', expectedReasoningEffort: 'medium', maxOutputTokens: 7000, timeoutSeconds: 60
  },
  weekly_editorial_digest: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_json', expectedThinking: 'enabled',
    fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'],
    reasoningEffort: 'medium', expectedReasoningEffort: 'medium', maxOutputTokens: 10000, timeoutSeconds: 60
  },
  manual_news_supplement: {
    provider: 'gemini', model: 'gemini_35_flash_lite', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'low',
    maxOutputTokens: 5000, timeoutSeconds: 60
  },
  news_memory_bridge: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_text', expectedThinking: 'enabled', fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'], expectedReasoningEffort: 'low',
    maxOutputTokens: 5000, timeoutSeconds: 90
  },
  multimodal_research: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_text', expectedThinking: 'enabled', fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'],
    reasoningEffort: 'medium', expectedReasoningEffort: 'medium',
    maxOutputTokens: 8000, timeoutSeconds: 60, capabilities: ['vision', 'webSearch', 'clientTools']
  },
  image_analysis: {
    provider: 'gemini', model: 'gemini_4_hydrogen', profile: 'thinking_text', expectedThinking: 'enabled', fallbackModels: ['gemini_38_flash', 'gemini_35_flash_lite'], expectedReasoningEffort: 'low',
    maxOutputTokens: 8000, timeoutSeconds: 60, capabilities: ['vision']
  },
  image_semantic_caption: {
    provider: 'gemini', model: 'gemini_35_flash_lite', profile: 'image_caption_fast', expectedThinking: 'enabled', expectedReasoningEffort: 'minimal',
    capabilities: ['vision']
  }
};

/**
 * 解析 task route 與 execution profile，回傳不含 provider API 格式的執行設定。
 * 這裡同時驗證 provider/model 歸屬與 expectedThinking，讓錯誤設定在發出 HTTP 前失敗。
 */
function resolveAiTaskConfig_(task) {
  const taskName = String(task || '').trim();
  const route = AI_TASK_ROUTES[taskName];
  if (!route) {
    throw createAiConfigurationError_('Unknown AI task route: ' + taskName);
  }

  const provider = AI_PROVIDER_REGISTRY[route.provider];
  const modelEntry = AI_MODEL_REGISTRY[route.model];
  const profile = AI_EXECUTION_PROFILES[route.profile];
  // dormant 代表「目前沒有正式 route」，不是刪除 adapter；維護者明確切 route 即視為人工重新啟用。
  if (!provider || typeof provider.adapter !== 'function' || typeof provider.validateRequest !== 'function') {
    throw createAiConfigurationError_('AI provider adapter contract is not registered.');
  }
  if (!modelEntry || modelEntry.provider !== route.provider || typeof modelEntry.model !== 'string' || !modelEntry.model.trim()) {
    throw createAiConfigurationError_('AI model route mismatch or missing model name.');
  }
  if (!profile) throw createAiConfigurationError_('Unknown AI execution profile: ' + route.profile);
  if (!Array.isArray(modelEntry.capabilities) || !Array.isArray(route.capabilities || [])) {
    throw createAiConfigurationError_('AI model/task capabilities must be arrays.');
  }

  const thinkingType = String(profile.thinking && profile.thinking.type || '');
  if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
    throw createAiConfigurationError_('AI profile must explicitly set thinking enabled or disabled: ' + route.profile);
  }
  if (thinkingType !== route.expectedThinking) {
    throw createAiConfigurationError_('AI task thinking/profile mismatch: ' + taskName);
  }
  const reasoningEffort = Object.prototype.hasOwnProperty.call(route, 'reasoningEffort') ? route.reasoningEffort : profile.reasoningEffort;
  if (reasoningEffort !== route.expectedReasoningEffort) {
    throw createAiConfigurationError_('AI task reasoning effort/profile mismatch: ' + taskName);
  }
  if (['text', 'json'].indexOf(profile.outputMode) < 0) {
    throw createAiConfigurationError_('AI profile output mode must be text or json: ' + route.profile);
  }
  const reasoning = modelEntry.reasoning || {};
  if (!Array.isArray(reasoning.modes) || !Array.isArray(reasoning.efforts) || reasoning.modes.indexOf(thinkingType) < 0 ||
      (thinkingType === 'enabled' && (reasoning.efforts || []).indexOf(reasoningEffort) < 0)) {
    throw createAiConfigurationError_('Model does not support the requested reasoning mode/effort.');
  }
  if (thinkingType === 'enabled' && profile.allowSampling === true && reasoning.samplingWhileThinking !== true) {
    throw createAiConfigurationError_('Model does not support sampling while thinking.');
  }
  if (thinkingType === 'disabled' && reasoningEffort) {
    throw createAiConfigurationError_('Non-thinking profile must not set reasoning effort: ' + route.profile);
  }

  // hasOwnProperty 可讓 0 / NaN route override 被驗證拒絕，不會因 `||` 靜默退回 profile。
  const maxOutputTokens = Number(Object.prototype.hasOwnProperty.call(route, 'maxOutputTokens')
    ? route.maxOutputTokens
    : profile.maxOutputTokens);
  const timeoutSeconds = Number(Object.prototype.hasOwnProperty.call(route, 'timeoutSeconds')
    ? route.timeoutSeconds
    : profile.timeoutSeconds);
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
    throw createAiConfigurationError_('AI task max output tokens must be positive: ' + taskName);
  }
  if (!isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw createAiConfigurationError_('AI task timeout must be positive: ' + taskName);
  }

  const capabilities = ['text'];
  if (thinkingType === 'enabled') capabilities.push('thinking');
  (route.capabilities || []).forEach(function(capability) {
    if (capabilities.indexOf(capability) < 0) capabilities.push(capability);
  });
  if (profile.outputMode === 'json' && !route.legacyJson) capabilities.push('structuredOutput');
  if (capabilities.some(function(capability) { return (modelEntry.capabilities || []).indexOf(capability) < 0; })) {
    throw createAiConfigurationError_('Model/adapter does not support the required capabilities.');
  }

  return {
    task: taskName,
    provider: route.provider,
    providerAdapter: provider.adapter,
    validateProviderRequest: provider.validateRequest,
    quotaPolicy: provider.quotaPolicy || null,
    fallbackModels: Array.isArray(route.fallbackModels) ? route.fallbackModels.slice() : [],
    model: modelEntry.model,
    modelRegistryKey: route.model,
    // 舊 callers 可繼續讀相容旗標，source of truth 是 capability list。
    supportsImages: (modelEntry.capabilities || []).indexOf('vision') >= 0,
    allowsWebSearch: capabilities.indexOf('webSearch') >= 0,
    allowsClientTools: capabilities.indexOf('clientTools') >= 0,
    capabilities: capabilities,
    modelCapabilities: modelEntry.capabilities || [],
    profile: route.profile,
    thinking: { type: thinkingType },
    reasoningEffort: reasoningEffort || '',
    allowSampling: profile.allowSampling === true,
    outputMode: profile.outputMode,
    temperature: typeof route.temperature === 'number' ? route.temperature : profile.temperature,
    topP: typeof route.topP === 'number' ? route.topP : profile.topP,
    maxOutputTokens: maxOutputTokens,
    timeoutSeconds: timeoutSeconds,
    requiredFinishReason: route.requiredFinishReason || profile.requiredFinishReason || 'stop',
    // 一般失敗仍由 Queue/caller 處理；Gemini 快切另外遵守 quotaPolicy。
    retryPolicy: route.retryPolicy || profile.retryPolicy || { strategy: 'caller_owned', maxAttemptsInService: 1 }
  };
}

/** 依本任務的白名單保持等級或就近降低，跳過不合能力契約的模型。 */
function resolveAiFallbackCandidates_(config, request) {
  const levels = ['minimal', 'low', 'medium', 'high', 'xhigh'];
  const candidates = [{ model: request.model, reasoningEffort: request.reasoningEffort }];
  if (!config.quotaPolicy) return candidates;
  for (const key of config.fallbackModels) {
    const target = AI_MODEL_REGISTRY[key];
    if (!target || target.provider !== config.provider || target.dormant || typeof target.model !== 'string' ||
        candidates.some(function(candidate) { return candidate.model === target.model; }) ||
        !Array.isArray(target.capabilities) || request.capabilities.some(function(capability) {
          return target.capabilities.indexOf(capability) < 0;
        })) continue;
    const reasoning = target.reasoning || {};
    if (!Array.isArray(reasoning.modes) || reasoning.modes.indexOf(request.thinking.type) < 0 ||
        !Array.isArray(reasoning.efforts) || (request.allowSampling && !reasoning.samplingWhileThinking)) continue;
    const effort = levels.slice(0, levels.indexOf(request.reasoningEffort) + 1).reverse().find(function(level) {
      return reasoning.efforts.indexOf(level) >= 0;
    });
    if (request.thinking.type === 'enabled' && !effort) continue;
    candidates.push({ model: target.model, reasoningEffort: effort || '' });
  }
  return candidates;
}

/**
 * 判斷穩定 typed error 是否可由 Queue / caller 重試。
 * 既有 Queue 用這份清單決定是否重試；Gemini 的單次快切另由 AiService 配額規則決定。
 */
function isAiErrorTypeRetryable_(errorType) {
  return AI_RETRYABLE_ERROR_TYPES.indexOf(String(errorType || '').trim()) >= 0;
}
