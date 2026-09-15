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
// 2. active routes 明確指定 HIGH；相容旗標由 capability list 推導，不能另成一套能力來源。
// 3. profile timeout 是上限，同步 caller 另受 webhook cap 約束；retryPolicy 僅描述 caller-owned 策略。
// 4. Gemini 保持 dormant；切換 provider 須先驗證 adapter 能力，不提供自動 fallback。
// ======================================================

const AI_PROVIDER_REGISTRY = {
  deepseek: {
    id: 'deepseek',
    adapter: 'deepseek',
    status: 'active'
  },
  gemini: {
    id: 'gemini',
    adapter: 'gemini',
    status: 'dormant'
  }
};

const AI_MODEL_REGISTRY = {
  deepseek_flash: {
    provider: 'deepseek',
    model: 'deepseek-flash',
    capabilities: ['text', 'thinking', 'vision', 'structuredOutput', 'webSearch', 'clientTools']
  },
  gemini_flash_lite_dormant: {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    dormant: true,
    capabilities: ['text']
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
  // 結構化 HIGH：max_tokens 同時計入 reasoning 與最終 JSON；欄位 validator 仍屬功能層。
  // 一般 8000，短補充／封存另縮小，週編輯台另擴大；背景 timeout 保持 60 秒。
  thinking_json: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
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
    reasoningEffort: 'high',
    allowSampling: false,
    outputMode: 'json',
    maxOutputTokens: 28000,
    timeoutSeconds: 90,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 一般聊天、圖片與跨素材分析共用 HIGH 文字 profile，token/timeout 差異由 task 決定。
  // 不送 sampling 欄位；8000 包含 reasoning 與最終文字，webhook 另套 30 秒 cap。
  thinking_high: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
    allowSampling: false,
    outputMode: 'text',
    maxOutputTokens: 8000,
    timeoutSeconds: 120,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  }
};

const AI_TASK_ROUTES = {
  // 短回覆原有 1200 加 3600 reasoning 空間；不放大同步 timeout。
  general_chat: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 4800, timeoutSeconds: 45, capabilities: ['webSearch', 'clientTools']
  },

  // 3200 → 8000，為分類稽核與 StoryKey 推理留空間；schema/normalizer 不變。
  news_analysis: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 60
  },

  // 4000 → 8000，保留原摘要 JSON 空間並加入 reasoning；validator 留在 WebTaskQueue。
  web_lazy_summary: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 60
  },

  // legacy raw HTML 需要保留大量 mainText，使用獨立長輸出 profile。
  raw_html_extraction: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'long_extraction_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high', legacyJson: true
  },

  // 新聞問答需跨多筆 NewsInbox 素材推理，固定使用 high。
  // 原本已包含 reasoning 的 token/timeout 維持不變。
  news_question: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 7000, timeoutSeconds: 90
  },

  // 節目分析需要同時判斷脈絡、爭議與節目切角，固定使用 high thinking。
  program_topic_analysis: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 120
  },

  // 統整話題跨 ConversationLog、Highlights、NewsInbox、WebSummary 與封存記憶。
  integrate_topics: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 9000, timeoutSeconds: 120
  },

  // 封存從 1800/2600 增至 6000/7000，兼顧來源統整的 reasoning 與短 JSON。
  archive_topics: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 6000, timeoutSeconds: 60
  },
  archive_news: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 7000, timeoutSeconds: 60
  },

  // 3200 → 10000：最多 30 則新聞聚類及對話去重，需要比單篇 JSON 更多 reasoning。
  weekly_editorial_digest: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 10000, timeoutSeconds: 60
  },

  // 1800 → 5000：短輸入只保留較小 reasoning 空間，既有人工 fallback 不變。
  manual_news_supplement: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 5000, timeoutSeconds: 60
  },

  // memory bridge 要判斷跨週延續與反轉，屬跨素材推理，但失敗只回空字串。
  news_memory_bridge: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 5000, timeoutSeconds: 90
  },

  // 圖片研究與普通分析都保留 8000-token 空間；僅 research route 提供 Search／tools。
  // 同步仍受 30 秒 cap 與下載耗時扣除。
  multimodal_research: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 60, capabilities: ['vision', 'webSearch', 'clientTools']
  },
  image_analysis: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 60, capabilities: ['vision']
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
  if (!provider || !provider.adapter) throw createAiConfigurationError_('AI provider is not registered: ' + route.provider);
  if (!modelEntry || modelEntry.provider !== route.provider) throw createAiConfigurationError_('AI model route mismatch: ' + route.model);
  if (!profile) throw createAiConfigurationError_('Unknown AI execution profile: ' + route.profile);

  const thinkingType = String(profile.thinking && profile.thinking.type || '');
  if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
    throw createAiConfigurationError_('AI profile must explicitly set thinking enabled or disabled: ' + route.profile);
  }
  if (thinkingType !== route.expectedThinking) {
    throw createAiConfigurationError_('AI task thinking/profile mismatch: ' + taskName);
  }
  if (profile.reasoningEffort !== route.expectedReasoningEffort) {
    throw createAiConfigurationError_('AI task reasoning effort/profile mismatch: ' + taskName);
  }
  if (['text', 'json'].indexOf(profile.outputMode) < 0) {
    throw createAiConfigurationError_('AI profile output mode must be text or json: ' + route.profile);
  }
  if (thinkingType === 'enabled' && ['high', 'max'].indexOf(profile.reasoningEffort) < 0) {
    throw createAiConfigurationError_('Thinking profile requires reasoning effort high or max: ' + route.profile);
  }
  if (thinkingType === 'enabled' && profile.allowSampling === true) {
    throw createAiConfigurationError_('Thinking profile cannot enable sampling parameters: ' + route.profile);
  }
  if (thinkingType === 'disabled' && profile.reasoningEffort) {
    throw createAiConfigurationError_('Non-thinking profile must not set reasoning effort: ' + route.profile);
  }

  // hasOwnProperty 可讓 0 / NaN route override 被驗證拒絕，不會因 `||` 靜默退回 profile。
  const maxOutputTokens = Number(Object.prototype.hasOwnProperty.call(route, 'maxOutputTokens')
    ? route.maxOutputTokens
    : profile.maxOutputTokens);
  const timeoutSeconds = Number(Object.prototype.hasOwnProperty.call(route, 'timeoutSeconds')
    ? route.timeoutSeconds
    : profile.timeoutSeconds);
  if (!isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
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
    reasoningEffort: profile.reasoningEffort || '',
    allowSampling: profile.allowSampling === true,
    outputMode: profile.outputMode,
    temperature: typeof route.temperature === 'number' ? route.temperature : profile.temperature,
    topP: typeof route.topP === 'number' ? route.topP : profile.topP,
    maxOutputTokens: maxOutputTokens,
    timeoutSeconds: timeoutSeconds,
    requiredFinishReason: route.requiredFinishReason || profile.requiredFinishReason || 'stop',
    // 僅提供 Queue/caller 判斷；10_AiService.gs 不讀此欄位執行 retry。
    retryPolicy: route.retryPolicy || profile.retryPolicy || { strategy: 'caller_owned', maxAttemptsInService: 1 }
  };
}

/**
 * 判斷穩定 typed error 是否可由 Queue / caller 重試。
 * AiService 自己不 sleep、不 retry；這份清單只是讓既有 Queue 在不解析錯誤文字的前提下做決策。
 */
function isAiErrorTypeRetryable_(errorType) {
  return AI_RETRYABLE_ERROR_TYPES.indexOf(String(errorType || '').trim()) >= 0;
}
