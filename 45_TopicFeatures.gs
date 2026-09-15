// ======================================================
// 45_TopicFeatures.gs
// 用途：Topic／material workflows：節目分析、素材統整與兩種週封存。
//
// 職責與協作：
// 1. 管理功能 Prompt、素材選取、封存業務驗證與 WeeklySummary 寫入；模型工作透過 AiService。
// 2. 節目分析與統整可參考人工重點、快讀及封存；統整另讀新聞大綱，缺 Outline 時退回 Brief。
//
// 維護注意：
// 1. ConversationLog 素材只取 user；#封存本週話題 只讀使用者對話，#封存本週新聞 只讀 NewsInbox。
// 2. 新聞封存保留事件名稱、特殊主題、辨識實體與 StoryKey，供後續回查。
// 3. 封存須先通過 schema 與業務 validator；LINE router、Sheet 初始化及 provider payload 各由所屬層處理。
// 4. 同步 execution context 只能縮短 timeout，背景或手動 caller 維持既有預算。
// ======================================================

// ======================================================
// #節目話題分析：無網址時從近期脈絡判斷主題
// ======================================================

function analyzeProgramTopicFromRecentContext(event, conversationId, userPrompt, aiExecutionContext) {
  const recentConversationText = getRecentConversationText(
    conversationId,
    DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC,
    false
  );

  const recentHighlightText = getRecentTopicHighlightsText(
    conversationId,
    DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT
  );

  const recentWebSummaryText = getRecentWebSummariesText(
    conversationId,
    DEFAULT_RECENT_WEB_SUMMARY_COUNT
  );

  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentHighlightText && !recentWebSummaryText && !recentWeeklySummaryText) {
    return getBotTextNoTopicContextForAnalysis_();
  }

  const prompt = [
    '使用者下了 #節目話題分析，但沒有貼網址。',
    '',
    '請根據最近使用者聊天內容、TopicHighlights 人工畫重點、WebSummary 網址快讀摘要，以及 WeeklySummary 封存記憶，自行判斷使用者最可能想分析的是：',
    '1. 剛剛聊天正在討論的內容',
    '2. 使用者正在寫的內容',
    '3. 使用者手動畫重點的內容',
    '4. 最近貼過且最有節目潛力的網址素材',
    '5. 或近期群組累積出的共同主題',
    '',
    '重要規則：',
    '1. ConversationLog 只提供使用者訊息，不包含小浣回覆。',
    '2. TopicHighlights 是使用者手動畫出的高優先級素材，分析時應優先考慮。',
    '3. 不可無中生有，沒有資料就明確說需要補查。',
    '',
    '使用者補充需求：',
    userPrompt || '無',
    '',
    '最近使用者 ConversationLog：',
    recentConversationText || '無',
    '',
    '最近 TopicHighlights：',
    recentHighlightText || '無',
    '',
    '最近 WebSummary：',
    recentWebSummaryText || '無',
    '',
    '最近 WeeklySummary：',
    recentWeeklySummaryText || '無',
    '',
    '請輸出：',
    '1. 我判斷你現在要分析的是哪個主題',
    '2. 這個主題的核心脈絡',
    '3. 可聊價值',
    '4. 爭議焦點或社群情緒分歧',
    '5. 可以拆成哪些節目段落',
    '6. 需要補查的資料',
    '7. 適不適合做成節目主題：高 / 中 / 低，並說明理由',
    '',
    '請使用繁體中文。',
    '不要使用 Markdown 語法。不要用表格。請用純文字、短段落、簡單編號和換行整理。'
  ].join('\n');

  // 跨近期多層素材判斷節目價值，固定使用 program_topic_analysis 的 thinking_high profile。
  return requireAiText_(runAiMemoryTask(
    'program_topic_analysis',
    conversationId,
    '#節目話題分析',
    prompt,
    requireAiCallOptionsForExecutionContext_(aiExecutionContext)
  ));
}

// ======================================================
// #統整話題：整合近期素材成節目話題地圖
// ======================================================

function integrateRecentTopics(event, conversationId, userPrompt, aiExecutionContext) {
  const recentConversationText = getRecentConversationText(
    conversationId,
    DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC,
    false
  );

  const recentHighlightText = getRecentTopicHighlightsText(
    conversationId,
    DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT
  );

  const recentWebSummaryText = getRecentWebSummariesText(
    conversationId,
    DEFAULT_RECENT_WEB_SUMMARY_COUNT
  );

  const recentNewsInboxText = getRecentNewsInboxTextForTopics_(
    conversationId,
    DEFAULT_WEEKLY_NEWS_DAYS,
    DEFAULT_RECENT_NEWS_INBOX_COUNT
  );

  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentHighlightText && !recentNewsInboxText && !recentWebSummaryText && !recentWeeklySummaryText) {
    return getBotTextNoTopicContextForIntegration_();
  }

  const prompt = [
    '使用者下了 #統整話題。',
    '',
    '你的任務是把最近使用者聊天內容、人工畫重點、NewsInbox 新聞素材、網址快讀摘要、封存記憶整合成「近期可用節目話題地圖」。',
    '',
    '這不是單篇分析。',
    '這是把一批素材整理成：哪些可以聊、哪些只是背景資料、哪些可以合併成同一段、哪些值得追蹤。',
    '',
    '重要規則：',
    '1. ConversationLog 只包含使用者訊息，不包含小浣回覆。',
    '2. TopicHighlights 是使用者手動畫出的高優先級素材，統整時應優先參考。',
    '3. NewsInbox 是直接貼網址收進來的新聞素材；請優先讀取其中 100～200 字 Outline，舊資料沒有 Outline 時才使用 Brief。',
    '4. WebSummary 是使用者明確要求 #懶人包 或分析網址後留下的素材。',
    '5. WeeklySummary 是過去封存記憶，可用來判斷是否曾經討論過。',
    '',
    '使用者補充需求：',
    userPrompt || '無',
    '',
    '最近使用者 ConversationLog：',
    recentConversationText || '無',
    '',
    '最近 TopicHighlights：',
    recentHighlightText || '無',
    '',
    '最近 NewsInbox：',
    recentNewsInboxText || '無',
    '',
    '最近 WebSummary：',
    recentWebSummaryText || '無',
    '',
    '最近 WeeklySummary：',
    recentWeeklySummaryText || '無',
    '',
    '請輸出：',
    '1. 最近累積出的主要話題',
    '2. 每個話題對應到哪些網址素材、畫重點或聊天脈絡',
    '3. 哪些只是背景資料',
    '4. 哪些有機會變成節目段落',
    '5. 建議本週優先處理的 1 到 3 個話題',
    '6. 每個建議話題的主軸、切角、風險、延伸問題',
    '7. 如果素材不足，請指出還缺什麼資料',
    '',
    '請使用繁體中文。',
    '不要使用 Markdown 語法。不要用表格。請用純文字、短段落、簡單編號和換行整理。'
  ].join('\n');

  // 統整跨 ConversationLog / Highlights / NewsInbox / WebSummary / 封存記憶，固定 thinking_high。
  return requireAiText_(runAiMemoryTask(
    'integrate_topics',
    conversationId,
    '#統整話題 ' + (userPrompt || ''),
    prompt,
    requireAiCallOptionsForExecutionContext_(aiExecutionContext)
  ));
}

// ======================================================
// #封存本週話題：寫入 WeeklySummary 長期記憶
// ======================================================

function archiveWeeklyTopics(event, conversationId, aiExecutionContext) {
  const recentCount = 200;
  const recentItems = getRecentConversationItems(conversationId, recentCount, false);

  if (!recentItems || recentItems.length === 0) {
    return getBotTextArchiveNoData_();
  }

  const recentText = recentItems.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');

  const rawMaterialCount = recentItems.length;
  const period = getWeeklyArchivePeriod_(DEFAULT_WEEKLY_NEWS_DAYS);

  const prompt = [
    '請把以下近期使用者對話整理成「極度精簡版長期記憶」。',
    '',
    '用途：',
    '這份摘要未來會被 AI 助手讀取，用來判斷這個話題以前是否討論過，以及當時有哪些觀點。',
    '',
    '資料來源說明：',
    '1. ConversationLog 僅包含使用者訊息，不包含小浣回覆。',
    '2. 本指令只封存群組對話脈絡，不讀 TopicHighlights、WebSummary 或 NewsInbox。',
    '',
    '請輸出成 JSON，且只輸出 JSON，不要加任何解釋文字。',
    '',
    'JSON 格式如下：',
    '{',
    '  "topicTitle": "一句話主題標題",',
    '  "keywords": ["關鍵字1", "關鍵字2", "關鍵字3"],',
    '  "summary": "150到300字摘要，保留核心觀點與脈絡",',
    '  "reusableAngles": ["未來可重用切角1", "未來可重用切角2", "未來可重用切角3"],',
    '  "followUpQuestions": ["後續可追問問題1", "後續可追問問題2", "後續可追問問題3"]',
    '}',
    '',
    '要求：',
    '1. 使用繁體中文。',
    '2. 不要寫空泛心得。',
    '3. 不要捏造對話中沒有的資訊。',
    '4. 如果討論很零散，請整理出最有價值的主題即可。',
    '5. 這份內容是給未來 AI 助手參考，所以要精煉、可重用、好檢索。',
    '',
    '以下是最近使用者對話紀錄：',
    recentText || '無'
  ].join('\n');

  const archiveJson = validateArchiveJsonContract_(
    requireAiJson_(runAiJsonTask(
      'archive_topics',
      prompt,
      requireAiCallOptionsForExecutionContext_(aiExecutionContext)
    )),
    'topic_archive'
  );

  const source = event.source || {};
  appendWeeklySummaryRow_({
    conversationId: conversationId,
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    topicTitle: archiveJson.topicTitle || '',
    keywords: Array.isArray(archiveJson.keywords) ? archiveJson.keywords.join(', ') : '',
    summary: archiveJson.summary || '',
    reusableAngles: Array.isArray(archiveJson.reusableAngles) ? archiveJson.reusableAngles.join('\n') : '',
    followUpQuestions: Array.isArray(archiveJson.followUpQuestions) ? archiveJson.followUpQuestions.join('\n') : '',
    rawMessageCount: rawMaterialCount,
    archiveType: WEEKLY_ARCHIVE_TYPE_TOPIC,
    periodStart: period.start,
    periodEnd: period.end,
    sourceItemCount: rawMaterialCount
  });

  return getBotTextArchiveDone_(archiveJson, rawMaterialCount);
}

// ======================================================
// #封存本週新聞：將 NewsInbox 週摘要寫入 WeeklySummary
// ======================================================

function archiveWeeklyNews(event, conversationId, aiExecutionContext) {
  const items = getRecentNewsInboxItems_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);

  if (!items.length) {
    return getBotTextNewsArchiveNoData_();
  }

  const period = getWeeklyArchivePeriod_(DEFAULT_WEEKLY_NEWS_DAYS);
  const newsText = formatNewsInboxItemsForArchivePrompt_(items);

  const prompt = [
    '請把以下 NewsInbox 新聞素材整理成「本週新聞週報索引」。',
    '',
    '用途：',
    '這份索引未來會被 #本週新聞 讀取，用來判斷新一週新聞和過去新聞脈絡是否有延續、反轉或可合併討論的關聯。',
    '它不是短心得，也不是只挑一個主題；它要像本週新聞週報目錄，讓未來可以快速想起這週有哪些代表素材。',
    '',
    '資料來源說明：',
    '1. NewsInbox 是群組貼網址或 #新聞補充 收進來的新聞素材。',
    '2. Outline 是完整大綱，Brief 是短簡介；請優先使用 Outline，沒有 Outline 時才使用 Brief。',
    '3. Category、Angle 與 TopicPotential 可協助判斷素材用途，但不得覆蓋原始新聞事實。',
    '4. SpecialTopic 與 MatchedEntities 用來保留人物、公司、平台、政策、作品、產品或事件名稱；若有 ClassificationWarning，請保守看待該素材分類。',
    '5. 不要加入外部資料，也不要捏造新聞之間沒有呈現的關聯。',
    '',
    '請輸出成 JSON，且只輸出 JSON，不要加任何解釋文字。',
    '',
    'JSON 格式如下：',
    '{',
    '  "topicTitle": "一句話概括本週新聞索引主軸；若素材分散，請寫成多主軸索引標題",',
    '  "keywords": ["代表性事件、人物、公司、平台、政策、作品或主題關鍵字1", "關鍵字2", "關鍵字3"],',
    '  "summary": "180到260字週報索引，保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡；素材分散時可用分號串起 2 到 4 個主軸",',
    '  "reusableAngles": ["40字內可重用事件索引或脈絡1", "40字內可重用事件索引或脈絡2", "40字內可重用事件索引或脈絡3"],',
    '  "followUpQuestions": ["40字內後續追蹤問題1", "40字內後續追蹤問題2", "40字內後續追蹤問題3"]',
    '}',
    '',
    '要求：',
    '1. 使用繁體中文。',
    '2. 重點是建立可供未來比對的新聞索引，不要寫成節目逐字稿，也不要只寫抽象趨勢。',
    '3. 不要因為追求精簡而漏掉代表性素材；同一主軸下可合併，但應留下可辨識的事件名稱或主角。',
    '4. 若本週新聞分散，請整理出 2 到 4 個共同主軸，並保留每個主軸的代表素材。',
    '5. keywords 最多 8 個；reusableAngles 與 followUpQuestions 各最多 3 個，每個項目 40 字內。',
    '6. 整個 JSON 請控制在 1000 個中文字內，避免輸出被截斷。',
    '7. 保留有助於未來辨識延續事件的關鍵人物、公司、平台、政策、作品名稱、產品名稱或事件名稱。',
    '8. 若某些素材沒有明顯共同主軸，也請以「其他值得追蹤」形式納入摘要，不要直接丟掉。',
    '',
    '封存期間：' + period.start + ' ～ ' + period.end,
    '',
    '以下是本週 NewsInbox：',
    newsText
  ].join('\n');

  const archiveJson = validateArchiveJsonContract_(
    requireAiJson_(runAiJsonTask(
      'archive_news',
      prompt,
      requireAiCallOptionsForExecutionContext_(aiExecutionContext)
    )),
    'news_archive'
  );
  const source = event.source || {};

  appendWeeklySummaryRow_({
    conversationId: conversationId,
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    topicTitle: archiveJson.topicTitle || '',
    keywords: Array.isArray(archiveJson.keywords) ? archiveJson.keywords.join(', ') : '',
    summary: archiveJson.summary || '',
    reusableAngles: Array.isArray(archiveJson.reusableAngles) ? archiveJson.reusableAngles.join('\n') : '',
    followUpQuestions: Array.isArray(archiveJson.followUpQuestions) ? archiveJson.followUpQuestions.join('\n') : '',
    rawMessageCount: items.length,
    archiveType: WEEKLY_ARCHIVE_TYPE_NEWS,
    periodStart: period.start,
    periodEnd: period.end,
    sourceItemCount: items.length
  });

  return getBotTextNewsArchiveDone_(archiveJson, items.length);
}

function formatNewsInboxItemsForArchivePrompt_(items) {
  return items.map(function(item, index) {
    return [
      '【新聞 ' + (index + 1) + '】',
      '故事線：' + normalizeStoryKey_(item.storyKey, item),
      '分類：' + (item.category || '待分類'),
      item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : '',
      item.matchedEntities && item.matchedEntities !== '無' ? '辨識實體：' + item.matchedEntities : '',
      '標題：' + (item.title || '未取得標題'),
      '網址：' + (item.url || ''),
      '節目潛力：' + (item.topicPotential || '中'),
      '內容：' + (item.outline || item.brief || '無'),
      '切角：' + (item.angle || '無'),
      item.classificationWarning ? '分類警告：' + item.classificationWarning : ''
    ].filter(function(line) { return line !== ''; }).join('\n');
  }).join('\n\n');
}

function getWeeklyArchivePeriod_(days) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000);

  return {
    start: formatArchiveDate_(start),
    end: formatArchiveDate_(end)
  };
}

function formatArchiveDate_(date) {
  try {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * v1.13.0 compatibility parser：正式封存 runtime 已改由 runAiJsonTask() 與
 * validateArchiveJsonContract_() 處理，不再呼叫本函式。
 * 保留原名稱一版是為了 GAS 手動診斷相容；確認部署端無 caller 後可和 strict 版本一起移除。
 */
function parseArchiveJson(text) {
  const raw = String(text || '').trim();
  const parsed = parseJsonObjectLoose(raw);

  if (parsed) {
    return parsed;
  }

  console.error('parseArchiveJson error: invalid legacy archive JSON; length=' + raw.length);

  return {
    topicTitle: '未能解析的封存摘要',
    keywords: [],
    summary: raw.slice(0, 1000),
    reusableAngles: [],
    followUpQuestions: []
  };
}

/**
 * v1.13.0 compatibility strict parser：repo 正式 runtime 已無 caller。
 * 不記錄模型原文，避免舊手動測試把 response text 寫進 console；未來移除條件同 parseArchiveJson()。
 */
function parseArchiveJsonStrict_(text, sourceLabel) {
  const raw = String(text || '').trim();
  const parsed = parseJsonObjectLoose(raw);

  if (parsed && String(parsed.summary || '').trim()) {
    return parsed;
  }

  // #封存本週新聞 若 AI JSON 被 max_tokens 截斷，不能把半截 JSON 當摘要寫入 WeeklySummary。
  // 直接丟錯讓 01_Main.gs 回 getBotTextNewsArchiveError_()，維護者可重試，不會污染長期記憶。
  console.error('parseArchiveJsonStrict_ failed:', sourceLabel || '', 'length=' + raw.length);
  throw createAiValidationError_('archive_json_parse_failed: AI returned invalid or truncated JSON', false);
}

/**
 * 兩種封存共用的功能契約 validator。
 * AiService 只檢查合法 JSON object；本函式負責必要欄位與陣列型別，避免不完整長期記憶寫入 WeeklySummary。
 * 封存驗證失敗不自動 retry，讓維護者稍後重試並保留可觀察的錯誤邊界。
 */
function validateArchiveJsonContract_(parsed, sourceLabel) {
  const value = parsed || {};
  const required = ['topicTitle', 'keywords', 'summary', 'reusableAngles', 'followUpQuestions'];
  const missingFields = required.filter(function(field) {
    return !Object.prototype.hasOwnProperty.call(value, field);
  });
  if (missingFields.length || !String(value.summary || '').trim()) {
    throw createAiValidationError_(
      String(sourceLabel || 'archive') + ' missing required fields or summary: ' + missingFields.join(', '),
      false
    );
  }
  if (!Array.isArray(value.keywords) || !Array.isArray(value.reusableAngles) || !Array.isArray(value.followUpQuestions)) {
    throw createAiValidationError_(String(sourceLabel || 'archive') + ' array contract is invalid.', false);
  }
  return value;
}
