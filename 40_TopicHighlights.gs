// ======================================================
// 40_TopicHighlights.gs
// Topic／material workflows：人工重點資料層與 TopicHighlights Sheet contract。
//
// 小浣 LINE Bot v1.13.1 Source Layout & File Ordering Edition
//
// 維護原則：
// 1. #畫重點 會將使用者手動標記的內容寫入 TopicHighlights。
// 2. TopicHighlights 是「人工釘選素材」，不是一般聊天紀錄。
// 3. 45_TopicFeatures.gs 的 #統整話題、無網址版 #節目話題分析、#封存本週話題會優先讀取此資料。
// 4. 本檔只管理重點寫入與讀取，不執行跨 Sheet 清理；清理規則由 50_DataCleanup.gs 負責。
// 5. Sheet headers、conversationId 隔離與人工標記語意都是相容性 contract。
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
