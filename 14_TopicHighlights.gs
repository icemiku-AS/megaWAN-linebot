// ======================================================
// 14_TopicHighlights.gs
// v1.10.3 Highlight Layer Edition：人工重點資料層。
//
// 維護原則：
// 1. #畫重點 會將使用者手動標記的內容寫入 TopicHighlights。
// 2. TopicHighlights 是「人工釘選素材」，不是一般聊天紀錄。
// 3. #統整話題、無網址版 #節目話題分析、#封存本週話題 會優先參考此資料。
// 4. 本版只新增重點資料層，不處理多 Sheet 清理；清理功能留待後續版本。
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
