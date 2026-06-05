// ======================================================
// 10_TopicFeatures.gs
// 節目企劃功能層。負責 #節目話題分析、#統整話題、#封存本週話題 等高階功能。
//
// 小浣 LINE Bot v1.9 Service Split Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
// ======================================================

// ======================================================
// #節目話題分析：無網址時從近期脈絡判斷主題
// ======================================================

function analyzeProgramTopicFromRecentContext(event, conversationId, userPrompt) {
  const recentConversationText = getRecentConversationText(
    conversationId,
    DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC,
    true
  );

  const recentWebSummaryText = getRecentWebSummariesText(
    conversationId,
    DEFAULT_RECENT_WEB_SUMMARY_COUNT
  );

  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentWebSummaryText && !recentWeeklySummaryText) {
    return '目前還沒有足夠的對話紀錄、網址快讀摘要或封存記憶可以分析。';
  }

  const prompt = [
    '使用者下了 #節目話題分析，但沒有貼網址。',
    '',
    '請根據最近聊天內容、WebSummary 網址快讀摘要，以及 WeeklySummary 封存記憶，自行判斷使用者最可能想分析的是：',
    '1. 剛剛聊天正在討論的內容',
    '2. 使用者正在寫的內容',
    '3. 最近貼過且最有節目潛力的網址素材',
    '4. 或近期群組累積出的共同主題',
    '',
    '使用者補充需求：',
    userPrompt || '無',
    '',
    '最近 ConversationLog：',
    recentConversationText || '無',
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
    true
  );

  const recentWebSummaryText = getRecentWebSummariesText(
    conversationId,
    DEFAULT_RECENT_WEB_SUMMARY_COUNT
  );

  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentWebSummaryText && !recentWeeklySummaryText) {
    return '目前還沒有足夠的聊天紀錄、網址快讀摘要或封存記憶可以統整。';
  }

  const prompt = [
    '使用者下了 #統整話題。',
    '',
    '你的任務是把最近聊天內容、網址快讀摘要、封存記憶整合成「近期可用節目話題地圖」。',
    '',
    '這不是單篇分析。',
    '這是把一批素材整理成：哪些可以聊、哪些只是背景資料、哪些可以合併成同一段、哪些值得追蹤。',
    '',
    '使用者補充需求：',
    userPrompt || '無',
    '',
    '最近 ConversationLog：',
    recentConversationText || '無',
    '',
    '最近 WebSummary：',
    recentWebSummaryText || '無',
    '',
    '最近 WeeklySummary：',
    recentWeeklySummaryText || '無',
    '',
    '請輸出：',
    '1. 最近累積出的主要話題',
    '2. 每個話題對應到哪些網址素材或聊天脈絡',
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
    return '目前還沒有足夠的對話紀錄可以封存。';
  }

  const recentText = recentItems.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');

  const recentWebSummaryText = getRecentWebSummariesText(conversationId, 20);

  const prompt = [
    '請把以下 LINE 群組最近討論整理成「極度精簡版長期記憶」。',
    '',
    '用途：',
    '這份摘要未來會被 AI 助手讀取，用來判斷這個話題以前是否討論過，以及當時有哪些觀點。',
    '',
    'v1.7 補充：',
    '如果近期 WebSummary 中有與對話相關的網址快讀摘要，也可以納入封存脈絡。',
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
    '以下是最近對話紀錄：',
    recentText,
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
    recentItems.length
  ]);

  return [
    '已封存本週話題到 WeeklySummary。',
    '',
    '主題：' + (archiveJson.topicTitle || '未命名主題'),
    '',
    '摘要：',
    archiveJson.summary || '已建立摘要，但內容較短。',
    '',
    '封存訊息數：' + recentItems.length,
    '',
    '之後我可以把這些封存摘要當成極簡長期記憶使用。'
  ].join('\n');
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
