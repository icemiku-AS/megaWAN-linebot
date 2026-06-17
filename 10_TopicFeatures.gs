// ======================================================
// 10_TopicFeatures.gs
// 節目企劃功能層。負責 #節目話題分析、#統整話題、#封存本週話題 等高階功能。
//
// 小浣 LINE Bot v1.12.0 Silent URL Status & News Archive Edition
//
// 設計說明：
// 1. 本檔專注在節目企劃邏輯，不直接處理 LINE reply 或 Sheet 初始化細節。
// 2. v1.10.3 起，節目整理相關功能從 ConversationLog 只讀 role=user，避免小浣回覆污染素材。
// 3. v1.10.3 起，TopicHighlights 是人工畫重點資料，統整、分析、封存時都要優先參考。
// 4. v1.12.0 起，#封存本週話題 只讀 user-only ConversationLog；#封存本週新聞 另讀 NewsInbox。
// 5. v1.11.1 起，#統整話題會額外讀取 NewsInbox 的完整 Outline；舊資料沒有 Outline 時退回 Brief。
// ======================================================

// ======================================================
// #節目話題分析：無網址時從近期脈絡判斷主題
// ======================================================

function analyzeProgramTopicFromRecentContext(event, conversationId, userPrompt) {
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

  return callDeepSeekWithMemoryPayload(
    conversationId,
    '#節目話題分析',
    prompt,
    'program_topic_analysis'
  );
}

// ======================================================
// #統整話題：整合近期素材成節目話題地圖
// ======================================================

function integrateRecentTopics(event, conversationId, userPrompt) {
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

  return callDeepSeekWithMemoryPayload(
    conversationId,
    '#統整話題 ' + (userPrompt || ''),
    prompt,
    'integrate_topics'
  );
}

// ======================================================
// #封存本週話題：寫入 WeeklySummary 長期記憶
// ======================================================

function archiveWeeklyTopics(event, conversationId) {
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

  const archiveText = callDeepSeekDirect(prompt, 'archive');
  const archiveJson = parseArchiveJson(archiveText);

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

function archiveWeeklyNews(event, conversationId) {
  const items = getRecentNewsInboxItems_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);

  if (!items.length) {
    return getBotTextNewsArchiveNoData_();
  }

  const period = getWeeklyArchivePeriod_(DEFAULT_WEEKLY_NEWS_DAYS);
  const newsText = formatNewsInboxItemsForArchivePrompt_(items);

  const prompt = [
    '請把以下 NewsInbox 新聞素材整理成「本週新聞封存記憶」。',
    '',
    '用途：',
    '這份摘要未來會被 #本週新聞 讀取，用來判斷新一週新聞和過去新聞脈絡是否有延續、反轉或可合併討論的關聯。',
    '',
    '資料來源說明：',
    '1. NewsInbox 是群組貼網址或 #新聞補充 收進來的新聞素材。',
    '2. Outline 是完整大綱，Brief 是短簡介；請優先使用 Outline，沒有 Outline 時才使用 Brief。',
    '3. 不要加入外部資料，也不要捏造新聞之間沒有呈現的關聯。',
    '',
    '請輸出成 JSON，且只輸出 JSON，不要加任何解釋文字。',
    '',
    'JSON 格式如下：',
    '{',
    '  "topicTitle": "一句話概括本週新聞主軸",',
    '  "keywords": ["關鍵字1", "關鍵字2", "關鍵字3"],',
    '  "summary": "150到300字摘要，整理本週新聞共同脈絡、主要事件與可追蹤方向",',
    '  "reusableAngles": ["未來比對本週新聞時可重用的脈絡1", "可重用脈絡2", "可重用脈絡3"],',
    '  "followUpQuestions": ["後續可追蹤問題1", "後續可追蹤問題2", "後續可追蹤問題3"]',
    '}',
    '',
    '要求：',
    '1. 使用繁體中文。',
    '2. 重點是建立可供未來比對的新聞記憶，不要寫成節目逐字稿。',
    '3. 若本週新聞分散，請整理出 2 到 4 個共同主軸。',
    '4. 保留有助於未來辨識延續事件的關鍵人物、公司、平台、政策或作品名稱。',
    '',
    '封存期間：' + period.start + ' ～ ' + period.end,
    '',
    '以下是本週 NewsInbox：',
    newsText
  ].join('\n');

  const archiveText = callDeepSeekDirect(prompt, 'archive');
  const archiveJson = parseArchiveJson(archiveText);
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
      '分類：' + (item.category || '待分類'),
      '標題：' + (item.title || '未取得標題'),
      '網址：' + (item.url || ''),
      '內容：' + (item.outline || item.brief || '無'),
      '切角：' + (item.angle || '無')
    ].join('\n');
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

function parseArchiveJson(text) {
  const raw = String(text || '').trim();
  const parsed = parseJsonObjectLoose(raw);

  if (parsed) {
    return parsed;
  }

  console.error('parseArchiveJson error:', raw);

  return {
    topicTitle: '未能解析的封存摘要',
    keywords: [],
    summary: raw.slice(0, 1000),
    reusableAngles: [],
    followUpQuestions: []
  };
}
