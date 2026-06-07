function ensureTopicHighlightsSheet_() {
  const headers = ['HighlightId', 'CreatedAt', 'ConversationId', 'SourceType', 'UserId', 'GroupId', 'RoomId', 'OriginalMessage', 'HighlightText', 'Tags', 'Status', 'UsedInWeeklyArchive', 'ArchivedAt', 'Note'];
  return ensureSheetWithHeaders_(TOPIC_HIGHLIGHTS_SHEET_NAME, headers);
}

function saveTopicHighlight_(event, conversationId, originalMessage, highlightText) {
  const source = event.source || {};
  ensureTopicHighlightsSheet_().appendRow([
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
    if (lastRow <= 1) return [];
    const headerMap = getHeaderMap_(sheet);
    const readRows = Math.min(lastRow - 1, 300);
    const values = sheet.getRange(lastRow - readRows + 1, 1, readRows, sheet.getLastColumn()).getValues();
    const matched = [];
    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
      const status = String(getRowValueByHeader_(row, headerMap, 'Status') || '').trim();
      const highlightText = String(getRowValueByHeader_(row, headerMap, 'HighlightText') || '').trim();
      if (rowConversationId !== conversationId || !highlightText || (status && status !== 'active')) continue;
      matched.push({ highlightText: highlightText });
      if (matched.length >= limit) break;
    }
    matched.reverse();
    return matched;
  } catch (error) {
    console.error('getRecentTopicHighlightItems_ error:', error && error.stack ? error.stack : error);
    return [];
  }
}

function getRecentTopicHighlightsText(conversationId, limit) {
  const items = getRecentTopicHighlightItems_(conversationId, limit);
  if (!items.length) return '';
  return items.map(function(item, index) {
    return '【畫重點 ' + (index + 1) + '】\n內容：' + item.highlightText;
  }).join('\n\n');
}
