// ======================================================
// 19_AiProfiles.gs
// 小浣 LINE Bot v1.13.0 AI Routing & Project Architecture Edition
//
// 主要責任：
// 1. 集中登記 AI provider、model、execution profile 與 task route。
// 2. 將 task 的 provider / model / profile 選擇，和 profile 的 thinking、輸出模式、
//    token、timeout、sampling、finish reason 與 retry policy 分開管理。
// 3. 解析 route override，輸出 provider-neutral 的執行設定給 18_AiService.gs。
//
// 明確不負責：
// 1. 不呼叫任何 provider API，也不讀取 API key。
// 2. 不保存功能 Prompt、JSON schema、normalizer、Sheet 寫入或 LINE 排版。
// 3. 不實作跨 provider fallback；切換 provider 必須由維護者明確調整 task route。
//
// 檔案關係與設計原則：
// 1. 18_AiService.gs 是唯一正式調度入口；08 / 09 只轉譯各 provider 協議。
// 2. 功能檔只傳 task 與 Prompt/messages，不應自行組 DeepSeek 或 Gemini options。
// 3. 每個 task route 都重複標示 expectedThinking，並由 resolver 驗證它和 profile
//    一致。這項刻意的少量重複是安全稽核，避免未來換 profile 後意外改變成本與延遲。
// 4. v1.13.0 不綁定 thinking_max；它只保留給未來明確指定的高價值低頻任務。
// 5. DeepSeek 最新官方規格只有 high / max 是正式 reasoning_effort；不要新增
//    low / medium profile，因為供應商只會把它們相容映射為 high。
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
  deepseek_v4_flash: {
    provider: 'deepseek',
    model: 'deepseek-v4-flash'
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
  // 一般聊天與簡單文字整理：不需要額外推理，保留適度語氣彈性。
  // 1200 tokens 足以涵蓋 LINE 日常回覆；45 秒避免 webhook 長時間等待。
  // 它不能與 thinking_high 合併，否則一般聊天會無謂增加 reasoning token 與延遲。
  fast_text: {
    thinking: { type: 'disabled' },
    reasoningEffort: '',
    allowSampling: true,
    outputMode: 'text',
    temperature: 0.7,
    maxOutputTokens: 1200,
    timeoutSeconds: 45,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 固定結構 JSON：關閉 thinking 以提高格式穩定性，低溫度減少 enum 與欄位漂移。
  // 4000 tokens 涵蓋一般結構化任務；60 秒容納 Queue 與文件摘要的正常延遲。
  // 它不能與 long_extraction_json 合併，否則日常 JSON 會普遍取得過高輸出預算。
  fast_json: {
    thinking: { type: 'disabled' },
    reasoningEffort: '',
    allowSampling: true,
    outputMode: 'json',
    temperature: 0.1,
    maxOutputTokens: 4000,
    timeoutSeconds: 60,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // raw HTML 正文抽取：任務是保留原文而非推理，因此 thinking 關閉、溫度為 0。
  // 24000 tokens 是為長文 mainText 留空間，90 秒則兼顧 UrlFetch 與 GAS 六分鐘上限。
  // 它不能與 fast_json 合併，否則長文會被一般 4000-token 上限截斷。
  long_extraction_json: {
    thinking: { type: 'disabled' },
    reasoningEffort: '',
    allowSampling: true,
    outputMode: 'json',
    temperature: 0,
    maxOutputTokens: 24000,
    timeoutSeconds: 90,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 跨多筆素材的分析與統整：thinking 開啟並使用官方 high effort。
  // thinking 模式不得送 temperature / top_p 等無效採樣欄位；8000 tokens 同時涵蓋
  // reasoning 與最終文字，120 秒提供複雜任務足夠時間。
  // 它不能與 fast_text 合併，因為兩者的成本、延遲與 payload 相容規則不同。
  thinking_high: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'high',
    allowSampling: false,
    outputMode: 'text',
    maxOutputTokens: 8000,
    timeoutSeconds: 120,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  },

  // 未來高價值、低頻率深度任務的預留 profile；v1.13.0 沒有 task 綁定。
  // max effort 與 16000 tokens 可能顯著提高延遲與成本，180 秒也不適合 webhook 日常流量。
  // 保留獨立 profile 是為了讓未來啟用時必須經過明確 route review。
  thinking_max: {
    thinking: { type: 'enabled' },
    reasoningEffort: 'max',
    allowSampling: false,
    outputMode: 'text',
    maxOutputTokens: 16000,
    timeoutSeconds: 180,
    requiredFinishReason: 'stop',
    retryPolicy: { strategy: 'caller_owned', maxAttemptsInService: 1 }
  }
};

const AI_TASK_ROUTES = {
  // 一般聊天以低延遲為優先，不需要 thinking。
  general_chat: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_text', expectedThinking: 'disabled'
  },

  // NewsInbox 分析已有完整 schema、normalizer 與分類稽核，使用 non-thinking JSON。
  news_analysis: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 3200, timeoutSeconds: 60
  },

  // 快讀摘要是固定結構整理，不需要推理；validator 留在 WebTaskQueue 功能層。
  web_lazy_summary: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 4000, timeoutSeconds: 60
  },

  // legacy raw HTML 需要保留大量 mainText，使用獨立長輸出 profile。
  raw_html_extraction: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'long_extraction_json', expectedThinking: 'disabled'
  },

  // 新聞問答需跨多筆 NewsInbox 素材推理；本版不另建複雜度分類器，因此固定 high。
  // 輸出維持文字，避免 thinking 與 JSON mode 在本版同時承擔格式風險。
  news_question: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'thinking_high', expectedThinking: 'enabled',
    maxOutputTokens: 7000, timeoutSeconds: 90
  },

  // 節目分析需要同時判斷脈絡、爭議與節目切角，固定使用 high thinking。
  program_topic_analysis: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'thinking_high', expectedThinking: 'enabled',
    maxOutputTokens: 8000, timeoutSeconds: 120
  },

  // 統整話題跨 ConversationLog、Highlights、NewsInbox、WebSummary 與封存記憶。
  integrate_topics: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'thinking_high', expectedThinking: 'enabled',
    maxOutputTokens: 9000, timeoutSeconds: 120
  },

  // 封存契約固定且低頻，strict JSON validator 比額外 thinking 更重要。
  archive_topics: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 1800, timeoutSeconds: 60
  },
  archive_news: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 2600, timeoutSeconds: 60
  },

  // 週編輯台已有 itemId、partition 與 rendered coverage validator；先用 fast JSON。
  weekly_editorial_digest: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 3200, timeoutSeconds: 60
  },

  // 人工補充是短固定 JSON；失敗時功能層仍保留既有人工 fallback。
  manual_news_supplement: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'fast_json', expectedThinking: 'disabled',
    maxOutputTokens: 1800, timeoutSeconds: 60
  },

  // memory bridge 要判斷跨週延續與反轉，屬跨素材推理，但失敗只回空字串。
  news_memory_bridge: {
    provider: 'deepseek', model: 'deepseek_v4_flash', profile: 'thinking_high', expectedThinking: 'enabled',
    maxOutputTokens: 5000, timeoutSeconds: 90
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
    throw new Error('Unknown AI task route: ' + taskName);
  }

  const provider = AI_PROVIDER_REGISTRY[route.provider];
  const modelEntry = AI_MODEL_REGISTRY[route.model];
  const profile = AI_EXECUTION_PROFILES[route.profile];
  // dormant 代表「目前沒有正式 route」，不是刪除 adapter；維護者明確切 route 即視為人工重新啟用。
  if (!provider || !provider.adapter) throw new Error('AI provider is not registered: ' + route.provider);
  if (!modelEntry || modelEntry.provider !== route.provider) throw new Error('AI model route mismatch: ' + route.model);
  if (!profile) throw new Error('Unknown AI execution profile: ' + route.profile);

  const thinkingType = String(profile.thinking && profile.thinking.type || '');
  if (thinkingType !== 'enabled' && thinkingType !== 'disabled') {
    throw new Error('AI profile must explicitly set thinking enabled or disabled: ' + route.profile);
  }
  if (thinkingType !== route.expectedThinking) {
    throw new Error('AI task thinking/profile mismatch: ' + taskName);
  }
  if (['text', 'json'].indexOf(profile.outputMode) < 0) {
    throw new Error('AI profile output mode must be text or json: ' + route.profile);
  }
  if (thinkingType === 'enabled' && ['high', 'max'].indexOf(profile.reasoningEffort) < 0) {
    throw new Error('Thinking profile requires reasoning effort high or max: ' + route.profile);
  }
  if (thinkingType === 'enabled' && profile.allowSampling === true) {
    throw new Error('Thinking profile cannot enable sampling parameters: ' + route.profile);
  }
  if (thinkingType === 'disabled' && profile.reasoningEffort) {
    throw new Error('Non-thinking profile must not set reasoning effort: ' + route.profile);
  }

  const maxOutputTokens = Number(route.maxOutputTokens || profile.maxOutputTokens);
  const timeoutSeconds = Number(route.timeoutSeconds || profile.timeoutSeconds);
  if (!isFinite(maxOutputTokens) || maxOutputTokens <= 0) {
    throw new Error('AI task max output tokens must be positive: ' + taskName);
  }
  if (!isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error('AI task timeout must be positive: ' + taskName);
  }

  return {
    task: taskName,
    provider: route.provider,
    providerAdapter: provider.adapter,
    model: modelEntry.model,
    modelRegistryKey: route.model,
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
