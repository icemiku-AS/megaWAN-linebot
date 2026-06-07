// ======================================================
// 10_TopicFeatures.gs
// 節目企劃功能層。負責 #節目話題分析、#統整話題、#封存本週話題。
//
// 小浣 LINE Bot v1.10.3 Highlight & Cleanup Edition
//
// 維護重點：
// 1. v1.10.3 起，節目整理相關功能從 ConversationLog 只讀 role=user。
// 2. TopicHighlights 是 #畫重點 的人工釘選素材，統整、分析、封存時優先參考。
// 3. WeeklySummary 是封存結果；封存來源是 user-only ConversationLog + TopicHighlights + WebSummary。
// ======================================================

function analyzeProgramTopicFromRecentContext(event, conversationId, userPrompt) {
  const recentConversationText = getRecentConversationText(conversationId, DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC, false);
  const recentWebSummaryText = getRecentWebSummariesText(conversationId, DEFAULT_RECENT_WEB_SUMMARY_COUNT);
  const recentHighlightText = getRecentTopicHighlightsText(conversationId, DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT);
  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentWebSummaryText && !recentHighlightText && !recentWeeklySummaryText) {
    return getBotTextNoTopicContextForAnalysis_();
  }

  const prompt = [
    '使用者下了 #節目話題分析，但沒有貼網址。',
    '請根據以下資料判斷最值得分析的節目話題。',
    '',
    '規則：',
    '1. ConversationLog 只含使用者訊息，不含小浣回覆。',
    '2. TopicHighlights 是使用者手動畫出的高優先級素材。',
    '3. WebSummary 是網址快讀摘要。',
    '4. WeeklySummary 是過去封存記憶。',
    '5. 不要補不存在的資訊，資料不足就列出待查證點。',
    '',
    '使用者補充需求：', userPrompt || '無',
    '',
    'ConversationLog：', recentConversationText || '無',
    '',
    'TopicHighlights：', recentHighlightText || '無',
    '',
    'WebSummary：', recentWebSummaryText || '無',
    '',
    'WeeklySummary：', recentWeeklySummaryText || '無',
    '',
    '請輸出：主題判斷、核心脈絡、可聊價值、爭議焦點、節目段落、待查證資料、適合程度。',
    '請使用繁體中文，純文字短段落，不要表格。'
  ].join('\n');

  return callDeepSeekWithMemoryPayload(conversationId, '#節目話題分析', prompt, 'program_topic_analysis');
}

function integrateRecentTopics(event, conversationId, userPrompt) {
  const recentConversationText = getRecentConversationText(conversationId, DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC, false);
  const recentWebSummaryText = getRecentWebSummariesText(conversationId, DEFAULT_RECENT_WEB_SUMMARY_COUNT);
  const recentHighlightText = getRecentTopicHighlightsText(conversationId, DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT);
  const recentWeeklySummaryText = getRecentWeeklySummaryText(conversationId, 8);

  if (!recentConversationText && !recentWebSummaryText && !recentHighlightText && !recentWeeklySummaryText) {
    return getBotTextNoTopicContextForIntegration_();
  }

  const prompt = [
    '使用者下了 #統整話題。',
    '請把近期素材整理成節目話題地圖。',
    '',
    '規則：',
    '1. ConversationLog 只含使用者訊息，不含小浣回覆。',
    '2. TopicHighlights 是使用者手動畫出的高優先級素材，請優先參考。',
    '3. WebSummary 是網址快讀摘要。',
    '4. WeeklySummary 是過去封存記憶。',
    '',
    '使用者補充需求：', userPrompt || '無',
    '',
    'ConversationLog：', recentConversationText || '無',
    '',
    'TopicHighlights：', recentHighlightText || '無',
    '',
    'WebSummary：', recentWebSummaryText || '無',
    '',
    'WeeklySummary：', recentWeeklySummaryText || '無',
    '',
    '請輸出：主要話題、對應素材、背景資料、可做節目段落、優先處理建議、主軸切角風險延伸問題、缺少資料。',
    '請使用繁體中文，純文字短段落，不要表格。'
  ].join('\n');

  return callDeepSeekWithMemoryPayload(conversationId, '#統整話題 ' + (userPrompt || ''), prompt, 'integrate_topics');
}

function archiveWeeklyTopics(event, conversationId) {
  const recentItems = getRecentConversationItems(conversationId, 200, false);
  const recentText = recentItems.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');

  const recentWebSummaryText = getRecentWebSummariesText(conversationId, 20);
  const recentHighlightItems = getRecentTopicHighlightItems_(conversationId, DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT);
  const recentHighlightText = formatTopicHighlightItems_(recentHighlightItems);

  if (!recentText && !recentWebSummaryText && !recentHighlightText) {
    return getBotTextArchiveNoData_();
  }

  const rawMaterialCount = recentItems.length + recentHighlightItems.length;

  const prompt = [
    '請把以下近期素材整理成極度精簡版長期記憶。',
    '用途是讓未來 AI 助手判斷這個話題以前是否討論過，以及當時有哪些觀點。',
    '',
    '資料來源：ConversationLog 只含使用者訊息；TopicHighlights 是人工畫重點；WebSummary 是網址快讀摘要。',
    '',
    '請只輸出 JSON，不要加解釋。',
    '格式：{"topicTitle":"一句話主題標題","keywords":["關鍵字1"],"summary":"150到300字摘要","reusableAngles":["切角1"],"followUpQuestions":["問題1"]}',
    '',
    '要求：繁體中文；不要空泛心得；不要捏造；零散時整理最有價值主題。',
    '',
    '使用者對話：', recentText || '無',
    '',
    '人工畫重點：', recentHighlightText || '無',
    '',
    '網址快讀摘要：', recentWebSummaryText || '無'
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

  if (parsed) return parsed;

  console.error('parseArchiveJson error:', raw);

  return {
    topicTitle: '未能解析的封存摘要',
    keywords: [],
    summary: raw.slice(0, 1000),
    reusableAngles: [],
    followUpQuestions: []
  };
}
