// ======================================================
// 50_DataCleanup.gs
// 用途：Data operations／maintenance：目前聊天室的受控多表清理。
//
// 職責與協作：
// 1. 解析清理指令與確認狀態，依指定範圍刪除目前 conversationId 的資料列。
// 2. 01_Main.gs 負責顯示警告與回覆；本檔只管理清理規則及執行，不呼叫 AI。
//
// 維護注意：
// 1. 執行前須二段確認，例如 #清空重點 → #清空重點 確認。
// 2. 保留其他聊天室、Sheet 與表頭；不得把資料列清理擴大為全表刪除。
// 3. 指令、目標 Sheet 集合與刪除範圍皆屬高風險契約，修改時須追蹤主流程 caller。
// ======================================================

function normalizeCleanupCommandText_(text) {
  let normalized = String(text || '').trim();

  if (normalized.startsWith('#小浣')) {
    normalized = normalized.replace('#小浣', '').trim();
  }

  if (normalized && normalized.charAt(0) !== '#') {
    normalized = '#' + normalized;
  }

  return normalized;
}

function getCleanupCommandInfo_(text) {
  const normalized = normalizeCleanupCommandText_(text);
  const isConfirm = normalized.endsWith(' 確認');
  const baseCommand = isConfirm ? normalized.replace(/\s+確認$/, '').trim() : normalized;

  const commandMap = {
    '#清空紀錄': {
      key: 'conversation_log',
      label: 'ConversationLog 對話紀錄',
      sheets: ['ConversationLog'],
      description: '清除目前聊天室的原始對話紀錄，並清除短期記憶。'
    },
    '#清空重點': {
      key: 'topic_highlights',
      label: 'TopicHighlights 人工重點',
      sheets: ['TopicHighlights'],
      description: '清除目前聊天室用 #畫重點 釘選的人工重點素材。'
    },
    '#清空快讀': {
      key: 'web_data',
      label: 'WebSummary / WebTaskQueue 快讀資料',
      sheets: ['WebSummary', 'WebTaskQueue'],
      description: '清除目前聊天室的網址快讀摘要，以及尚未完成或歷史保留的快讀任務。'
    },
    '#清空封存': {
      key: 'weekly_summary',
      label: 'WeeklySummary 封存記憶',
      sheets: ['WeeklySummary'],
      description: '清除目前聊天室由 #封存本週話題 產生的長期封存記憶。'
    },
    '#清空新聞': {
      key: 'news_data',
      label: 'NewsInbox / NewsUrlQueue 新聞素材',
      sheets: ['NewsInbox', 'NewsUrlQueue'],
      description: '清除目前聊天室直接貼網址收集到的新聞素材，以及尚未處理的新聞網址佇列。'
    },
    '#清空待回覆': {
      key: 'pending_replies',
      label: 'PendingReplies 待交付回覆',
      sheets: ['PendingReplies'],
      description: '清除目前聊天室背景任務完成後，尚未交付的待回覆內容。'
    }
  };

  const info = commandMap[baseCommand];
  if (!info) return null;

  return {
    key: info.key,
    label: info.label,
    affectedSheets: info.sheets,
    description: info.description,
    command: baseCommand,
    confirmCommand: baseCommand + ' 確認',
    isConfirm: isConfirm
  };
}

function deleteRowsByConversationIdFromSheet_(sheet, conversationId, conversationIdHeaderName) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return 0;

  const headerMap = getHeaderMap_(sheet);
  const columnIndex = headerMap[conversationIdHeaderName || 'ConversationId'];

  if (!columnIndex) {
    throw new Error('Missing ConversationId column in sheet: ' + sheet.getName());
  }

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
  const result = {
    total: 0,
    details: []
  };

  function addDetail(sheetName, count) {
    result.details.push({ sheetName: sheetName, count: count });
    result.total += count;
  }

  if (cleanupKey === 'conversation_log') {
    addDetail(SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureLogSheet_(), conversationId));

  } else if (cleanupKey === 'topic_highlights') {
    addDetail(TOPIC_HIGHLIGHTS_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureTopicHighlightsSheet_(), conversationId));

  } else if (cleanupKey === 'web_data') {
    addDetail(WEB_SUMMARY_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWebSummarySheet_(), conversationId));
    addDetail(WEB_TASK_QUEUE_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWebTaskQueueSheet_(), conversationId));

  } else if (cleanupKey === 'weekly_summary') {
    addDetail(WEEKLY_SUMMARY_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureWeeklySummarySheet_(), conversationId));

  } else if (cleanupKey === 'news_data') {
    addDetail(NEWS_INBOX_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureNewsInboxSheet_(), conversationId));
    addDetail(NEWS_URL_QUEUE_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensureNewsUrlQueueSheet_(), conversationId));

  } else if (cleanupKey === 'pending_replies') {
    addDetail(PENDING_REPLIES_SHEET_NAME, deleteRowsByConversationIdFromSheet_(ensurePendingRepliesSheet_(), conversationId));

  } else {
    throw new Error('Unknown cleanup key: ' + cleanupKey);
  }

  return result;
}
