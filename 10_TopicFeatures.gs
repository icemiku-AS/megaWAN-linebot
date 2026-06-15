// ======================================================
// 10_TopicFeatures.gs
// 節目企劃功能層。負責 #節目話題分析、#統整話題、#封存本週話題 等高階功能。
//
// 小浣 LINE Bot v1.11.1 Compact News Brief Edition
//
// 設計說明：
// 1. 本檔專注在節目企劃邏輯，不直接處理 LINE reply 或 Sheet 初始化細節。
// 2. v1.10.3 起，節目整理相關功能從 ConversationLog 只讀 role=user，避免小浣回覆污染素材。
// 3. v1.10.3 起，TopicHighlights 是人工畫重點資料，統整、分析、封存時都要優先參考。
// 4. WeeklySummary 仍是封存結果；封存來源是 user-only ConversationLog + TopicHighlights + WebSummary。
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
  const recentHighlightItems = getRecentTopicHighlightItems_(conversationId, DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT);
  const recentHighlightText = formatTopicHighlightItems_(recentHighlightItems);
  const recentWebSummaryText = getRecentWebSummariesText(conversationId, 20);

  if ((!recentItems || recentItems.length === 0) && (!recentHighlightItems || recentHighlightItems.length === 0) && !recentWebSummaryText) {
    return getBotTextArchiveNoData_();
  }

  const recentText = recentItems.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');

  const rawMaterialCount = recentItems.length + recentHighlightItems.length;

  const prompt = [
    '請把以下近期素材整理成「極度精簡版長期記憶」。',
    '',
    '用途：',
    '這份摘要未來會被 AI 助手讀取，用來判斷這個話題以前是否討論過，以及當時有哪些觀點。',
    '',
    '資料來源說明：',
    '1. ConversationLog 僅包含使用者訊息，不包含小浣回覆。',
    '2. TopicHighlights 是使用者手動畫出的重點，應優先保留。',
    '3. WebSummary 是網址快讀摘要，可作為補充脈絡。',
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
    recentText || '無',
    '',
    '以下是最近人工畫重點：',
    recentHighlightText || '無',
    '',
    '以下是最近網址快讀摘要：',
    recentWebSummaryText || '無'
  ].join('\n');

  const archiveText = callDeepSeekDirect(prompt, 'archive');
  const archiveJson = parseArchiveJson(archiveText);

  const source = event.source || {};
  const sheet = ensureWeeklySummarySheet_();

  sheet.appendRow([
    new Date(),
    conversationId,
    source.type || '',
    source.userId || '',
    source.groupId || '',
    source.roomId || '',
    archiveJson.topicTitle || '',
    Array.isArray(archiveJson.keywords) ? archiveJson.keywords.join(', ') : '',
    archiveJson.summary || '',
    Array.isArray(archiveJson.reusableAngles) ? archiveJson.reusableAngles.join('\n') : '',
    Array.isArray(archiveJson.followUpQuestions) ? archiveJson.followUpQuestions.join('\n') : '',
    rawMaterialCount
  ]);

  return getBotTextArchiveDone_(archiveJson, rawMaterialCount);
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
