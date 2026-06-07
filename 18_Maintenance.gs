function normalizeMaintenanceText_(text) {
  let normalized = String(text || '').trim();
  if (normalized.startsWith('#小浣')) normalized = normalized.replace('#小浣', '').trim();
  if (normalized && normalized.charAt(0) !== '#') normalized = '#' + normalized;
  return normalized;
}

function getCleanupCommandInfo_(text) {
  const normalized = normalizeMaintenanceText_(text);
  const isConfirm = normalized.endsWith(' 確認');
  const baseCommand = isConfirm ? normalized.replace(/\s+確認$/, '').trim() : normalized;
  const map = {
    '#清空紀錄': { key: 'conversation_log', label: 'ConversationLog', sheets: ['ConversationLog'] },
    '#清空重點': { key: 'topic_highlights', label: 'TopicHighlights', sheets: ['TopicHighlights'] },
    '#清空快讀': { key: 'web_data', label: 'WebSummary / WebTaskQueue', sheets: ['WebSummary', 'WebTaskQueue'] },
    '#清空封存': { key: 'weekly_summary', label: 'WeeklySummary', sheets: ['WeeklySummary'] },
    '#清空新聞': { key: 'news_data', label: 'NewsInbox / NewsUrlQueue', sheets: ['NewsInbox', 'NewsUrlQueue'] },
    '#清空待回覆': { key: 'pending_replies', label: 'PendingReplies', sheets: ['PendingReplies'] }
  };
  const info = map[baseCommand];
  if (!info) return null;
  return { key: info.key, label: info.label, affectedSheets: info.sheets, command: baseCommand, confirmCommand: baseCommand + ' 確認', isConfirm: isConfirm };
}

function deleteRowsByConversationIdFromSheet_(sheet, conversationId, conversationIdHeaderName) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;
  const headerMap = getHeaderMap_(sheet);
  const columnIndex = headerMap[conversationIdHeaderName || 'ConversationId'];
  if (!columnIndex) throw new Error('Missing ConversationId column in sheet: ' + sheet.getName());
  const values = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  let deletedCount = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] === conversationId) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }
  return deletedCount;
}

function performDataCleanup_(cleanupKey, conversationId) {
  const result = { total: 0, details: [] };
  function addDetail(sheetName, count) {
    result.details.push({ sheetName: sheetName, count: count });
    result.total += count;
  }
  if (cleanupKey === 'conversation_log') addDetail(SHEET_NAME, deleteConversationLogs(conversationId));
  else if (cleanupKey === 'topic_highlights') addDetail(TOPIC_HIGHLIGHTS_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureTopicHighlightsSheet_(), conversationId));
  else if (cleanupKey === 'web_data') {
    addDetail(WEB_SUMMARY_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWebSummarySheet_(), conversationId));
    addDetail(WEB_TASK_QUEUE_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWebTaskQueueSheet_(), conversationId));
  } else if (cleanupKey === 'weekly_summary') addDetail(WEEKLY_SUMMARY_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWeeklySummarySheet_(), conversationId));
  else if (cleanupKey === 'news_data') {
    addDetail(NEWS_INBOX_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureNewsInboxSheet_(), conversationId));
    addDetail(NEWS_URL_QUEUE_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureNewsUrlQueueSheet_(), conversationId));
  } else if (cleanupKey === 'pending_replies') addDetail(PENDING_REPLIES_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensurePendingRepliesSheet_(), conversationId));
  else throw new Error('Unknown cleanup key: ' + cleanupKey);
  return result;
}
