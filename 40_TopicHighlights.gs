// ======================================================
// 40_TopicHighlights.gs
// 用途：Topic／material workflows：人工重點寫入、讀取與格式化。
//
// 職責與協作：
// 1. #畫重點 將使用者明確標記的內容保存至 TopicHighlights。
// 2. 45_TopicFeatures.gs 的統整話題與無網址節目分析讀取人工重點；話題封存只讀使用者對話。
//
// 維護注意：
// 1. 人工重點是釘選素材，不是一般聊天紀錄；headers、conversationId 與人工標記語意須保持相容。
// 2. 跨 Sheet 清理由 50_DataCleanup.gs 管理；本檔不執行清理。
// 3. 既有讀取 helper 可能 ensure 表格，internal tools 使用 14_AiTools.gs 的無建表讀取路徑。
// ======================================================

function ensureTopicHighlightsSheet_() {
  const headers = [
    'HighlightId',
    'CreatedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'OriginalMessage',
    'HighlightText',
    'Tags',
    'Status',
    'UsedInWeeklyArchive',
    'ArchivedAt',
    'Note'
  ];

  return ensureSheetWithHeaders_(TOPIC_HIGHLIGHTS_SHEET_NAME, headers);
}

function saveTopicHighlight_(event, conversationId, originalMessage, highlightText) {
  const source = event.source || {};
  const sheet = ensureTopicHighlightsSheet_();

  sheet.appendRow([
    createSimpleId('highlight'),
    new Date(),
    conversationId || '',
    source.type || '',
    source.userId || '',
    source.groupId || '',
    source.roomId || '',
    truncateForSheet(originalMessage || ''),
    truncateForSheet(highlightText || ''),
    '',
    'active',
    '',
    '',
    ''
  ]);
}

function getRecentTopicHighlightItems_(conversationId, limit) {
  try {
    const sheet = ensureTopicHighlightsSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return [];
    }

    const headerMap = getHeaderMap_(sheet);
    const lastCol = sheet.getLastColumn();
    const readRows = Math.min(lastRow - 1, 300);
    const startRow = lastRow - readRows + 1;
    const values = sheet.getRange(startRow, 1, readRows, lastCol).getValues();
    const matched = [];

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
      const status = String(getRowValueByHeader_(row, headerMap, 'Status') || '').trim();
      const highlightText = String(getRowValueByHeader_(row, headerMap, 'HighlightText') || '').trim();

      if (rowConversationId !== conversationId) continue;
      if (!highlightText) continue;
      if (status && status !== 'active') continue;

      matched.push({
        createdAt: getRowValueByHeader_(row, headerMap, 'CreatedAt'),
        highlightText: highlightText,
        tags: getRowValueByHeader_(row, headerMap, 'Tags'),
        note: getRowValueByHeader_(row, headerMap, 'Note')
      });

      if (matched.length >= limit) break;
    }

    matched.reverse();
    return matched;
  } catch (error) {
    console.error('getRecentTopicHighlightItems_ error:', error && error.stack ? error.stack : error);
    return [];
  }
}

function formatTopicHighlightItems_(items) {
  if (!items || !items.length) return '';

  return items.map(function(item, index) {
    const lines = [
      '【畫重點 ' + (index + 1) + '】',
      '內容：' + item.highlightText
    ];

    if (item.tags) lines.push('標籤：' + item.tags);
    if (item.note) lines.push('備註：' + item.note);

    return lines.join('\n');
  }).join('\n\n');
}

function getRecentTopicHighlightsText(conversationId, limit) {
  return formatTopicHighlightItems_(getRecentTopicHighlightItems_(conversationId, limit));
}
