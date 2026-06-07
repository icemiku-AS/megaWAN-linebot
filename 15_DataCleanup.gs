// ======================================================
// 15_DataCleanup.gs
// v1.10.4 Data Cleanup Edition：資料清理層。
//
// 維護原則：
// 1. 所有清理都只處理目前 conversationId，不跨私訊 / 群組 / room。
// 2. 清理時只刪符合 ConversationId 的資料列，不刪整張 Sheet，也不刪表頭。
// 3. 真正執行前必須由 01_Main.gs 做二段式確認，例如：#清空重點 → #清空重點 確認。
// 4. 本檔只放資料清理規則與執行，不處理 LINE reply，不呼叫 LLM。
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
