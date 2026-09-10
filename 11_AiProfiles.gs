// ======================================================
// 11_AiProfiles.gs
// AI configuration：provider/model registry、execution profiles、task routes 與 retry metadata。
// 小浣 LINE Bot v1.14.0 DeepSeek Flash Multimodal Edition
//
// 主要責任：
// 1. 集中登記 AI provider、model、execution profile 與 task route。
// 2. 將 task 的 provider / model / profile 選擇，和 profile 的 thinking、輸出模式、
//    token、timeout、sampling、finish reason 與 retry policy 分開管理。
// 3. 解析 route override，輸出 provider-neutral 的執行設定給 10_AiService.gs。
//
// 明確不負責：
// 1. 不呼叫任何 provider API，也不讀取 API key。
// 2. 不保存功能 Prompt、JSON schema、normalizer、Sheet 寫入或 LINE 排版。
// 3. 不實作跨 provider fallback；切換 provider 必須由維護者明確調整 task route。
//
// 檔案關係與設計原則：
// 1. 10_AiService.gs 是唯一正式調度入口；15 / 16 只轉譯各 provider 協議。
// 2. 功能檔只傳 task 與 Prompt/messages，不應自行組 DeepSeek 或 Gemini options。
// 3. 每個 task route 都重複標示 expectedThinking，並由 resolver 驗證它和 profile
//    一致。這項刻意的少量重複是安全稽核，避免未來換 profile 後意外改變成本與延遲。
// 4. v1.14.0 全部正式 task 固定 HIGH；移除未使用的 thinking_max 與誤導的 fast 命名。
// 5. model registry key 不綁世代；DeepSeek Flash 在 2026-09-10 對應 V4.1 Flash。
// 6. profile/route timeout 是任務最大預算；LINE webhook 會在 AiService 再套較短同步 cap。
// 7. retryPolicy 目前只是 caller-owned 描述資料，AiService 不會據此 sleep 或自動重試。
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
    supportsImages: true
  },
  gemini_flash_lite_dormant: {
    provider: 'gemini',
    model: 'gemini-3.1-flash-lite',
    dormant: true
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
    maxOutputTokens: 4800, timeoutSeconds: 45
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
    provider: 'deepseek', model: 'deepseek_flash', profile: 'long_extraction_json', expectedThinking: 'enabled', expectedReasoningEffort: 'high'
  },

  // 新聞問答需跨多筆 NewsInbox 素材推理；本版不另建複雜度分類器，因此固定 high。
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

  // 單張圖片辨識／OCR／問題分析：8000 包含 reasoning；同步仍受 30 秒 cap 與下載耗時扣除。
  image_analysis: {
    provider: 'deepseek', model: 'deepseek_flash', profile: 'thinking_high', expectedThinking: 'enabled', expectedReasoningEffort: 'high',
    maxOutputTokens: 8000, timeoutSeconds: 60
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

  return {
    task: taskName,
    provider: route.provider,
    providerAdapter: provider.adapter,
    model: modelEntry.model,
    modelRegistryKey: route.model,
    supportsImages: modelEntry.supportsImages === true,
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
