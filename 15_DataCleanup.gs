// ======================================================
// 15_DataCleanup.gs
// v1.10.4：目前聊天室範圍內的資料維護工具。
// 只依 ConversationId 處理資料列；不處理其他聊天室，也不動表頭。
// ======================================================

function normalizeCleanupCommandText_(text) {
  let normalized = String(text || '').trim();
  if (normalized.startsWith('#小浣')) normalized = normalized.replace('#小浣', '').trim();
  if (normalized && normalized.charAt(0) !== '#') normalized = '#' + normalized;
  return normalized;
}

function getCleanupCommandInfo_(text) {
  const normalized = normalizeCleanupCommandText_(text);
  const isConfirm = normalized.endsWith(' 確認');
  const baseCommand = isConfirm ? normalized.replace(/\s+確認$/, '').trim() : normalized;
  const p = '#清空';

  const map = {};
  map[p + '紀錄'] = { key: 'conversation_log', label: 'ConversationLog 對話紀錄', sheets: ['ConversationLog'], description: '處理目前聊天室的原始對話紀錄，並清除短期記憶。' };
  map[p + '重點'] = { key: 'topic_highlights', label: 'TopicHighlights 人工重點', sheets: ['TopicHighlights'], description: '處理目前聊天室用 #畫重點 釘選的人工重點素材。' };
  map[p + '快讀'] = { key: 'web_data', label: 'WebSummary / WebTaskQueue 快讀資料', sheets: ['WebSummary', 'WebTaskQueue'], description: '處理目前聊天室的網址快讀摘要與快讀任務。' };
  map[p + '封存'] = { key: 'weekly_summary', label: 'WeeklySummary 封存記憶', sheets: ['WeeklySummary'], description: '處理目前聊天室由 #封存本週話題 產生的長期封存記憶。' };
  map[p + '新聞'] = { key: 'news_data', label: 'NewsInbox / NewsUrlQueue 新聞素材', sheets: ['NewsInbox', 'NewsUrlQueue'], description: '處理目前聊天室收集到的新聞素材與待處理網址。' };
  map[p + '待回覆'] = { key: 'pending_replies', label: 'PendingReplies 待交付回覆', sheets: ['PendingReplies'], description: '處理目前聊天室尚未交付的背景任務回覆。' };

  const info = map[baseCommand];
  if (!info) return null;
  return { key: info.key, label: info.label, affectedSheets: info.sheets, description: info.description, command: baseCommand, confirmCommand: baseCommand + ' 確認', isConfirm: isConfirm };
}

function removeRowsByConversationIdFromSheet_(sheet, conversationId, conversationIdHeaderName) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const headerMap = getHeaderMap_(sheet);
  const columnIndex = headerMap[conversationIdHeaderName || 'ConversationId'];
  if (!columnIndex) throw new Error('Missing ConversationId column in sheet: ' + sheet.getName());

  const values = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  let count = 0;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i][0] === conversationId) {
      sheet.deleteRow(i + 2);
      count++;
    }
  }
  return count;
}

function performDataCleanup_(cleanupKey, conversationId) {
  const result = { total: 0, details: [] };
  function addDetail(sheetName, count) {
    result.details.push({ sheetName: sheetName, count: count });
    result.total += count;
  }

  if (cleanupKey === 'conversation_log') {
    addDetail(SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureLogSheet_(), conversationId));
  } else if (cleanupKey === 'topic_highlights') {
    addDetail(TOPIC_HIGHLIGHTS_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureTopicHighlightsSheet_(), conversationId));
  } else if (cleanupKey === 'web_data') {
    addDetail(WEB_SUMMARY_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureWebSummarySheet_(), conversationId));
    addDetail(WEB_TASK_QUEUE_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureWebTaskQueueSheet_(), conversationId));
  } else if (cleanupKey === 'weekly_summary') {
    addDetail(WEEKLY_SUMMARY_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureWeeklySummarySheet_(), conversationId));
  } else if (cleanupKey === 'news_data') {
    addDetail(NEWS_INBOX_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureNewsInboxSheet_(), conversationId));
    addDetail(NEWS_URL_QUEUE_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensureNewsUrlQueueSheet_(), conversationId));
  } else if (cleanupKey === 'pending_replies') {
    addDetail(PENDING_REPLIES_SHEET_NAME, removeRowsByConversationIdFromSheet_(ensurePendingRepliesSheet_(), conversationId));
  } else {
    throw new Error('Unknown cleanup key: ' + cleanupKey);
  }

  return result;
}
