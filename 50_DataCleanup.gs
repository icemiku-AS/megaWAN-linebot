// ======================================================
// 50_DataCleanup.gs
// 用途：Data operations／maintenance：目前聊天室的受控多表清理。
//
// 職責與協作：
// 1. 解析清理指令與確認狀態，依指定範圍刪除目前 conversationId 的資料列。
// 2. 01_Main.gs 負責顯示警告與回覆；本檔只管理清理規則及執行，不呼叫 AI。
//
// 維護注意：
// 1. 執行前須二段確認，例如 #清空新聞 → #清空新聞 確認。
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
    '#清空封存': {
      key: 'weekly_summary',
      label: 'WeeklySummary 封存記憶',
      sheets: ['WeeklySummary'],
      description: '清除目前聊天室的話題與新聞封存記憶；已設定固定週期者，同時取消執行中工作並停止回補舊週期，下個新週期照常。'
    },
    '#清空新聞': {
      key: 'news_data',
      label: '新聞素材、網址佇列與本週手動註記',
      sheets: ['NewsInbox', 'NewsUrlQueue'],
      description: '清除目前聊天室的新聞素材、網址佇列及本週手動註記。處理中的舊任務會取消。'
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
  const result = withDataMutationLock_(function() {
    try {
      return { count: deleteConversationRowsLocked_(sheet, conversationId, conversationIdHeaderName) };
    } finally { SpreadsheetApp.flush(); }
  });
  if (result.status === 'busy') throw createAiExecutionBudgetError_('Data cleanup lock is busy.');
  return result.count;
}

// 僅供已持有 ScriptLock 的清理入口使用，避免讀取列號後被另一個聊天室刪列移位。
function deleteConversationRowsLocked_(sheet, conversationId, conversationIdHeaderName) {
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
  const lockedResult = withDataMutationLock_(function() {
    try { return performDataCleanupLocked_(cleanupKey, conversationId); }
    finally { SpreadsheetApp.flush(); }
  });
  if (lockedResult.status === 'busy') throw createAiExecutionBudgetError_('Data cleanup lock is busy.');
  return lockedResult;
}

function performDataCleanupLocked_(cleanupKey, conversationId) {
  const result = {
    total: 0,
    details: []
  };

  function addDetail(sheetName, count) {
    result.details.push({ sheetName: sheetName, count: count });
    result.total += count;
  }

  if (cleanupKey === 'conversation_log') {
    const sheet = ensureLogSheet_();
    clearConversationHistoryLocked_(conversationId);
    addDetail(SHEET_NAME, deleteConversationRowsLocked_(sheet, conversationId));

  } else if (cleanupKey === 'weekly_summary') {
    clearNewsArchiveProgress_(conversationId);
    addDetail(WEEKLY_SUMMARY_SHEET_NAME, deleteConversationRowsLocked_(ensureWeeklySummarySheet_(), conversationId));

  } else if (cleanupKey === 'news_data') {
    addDetail(NEWS_INBOX_SHEET_NAME, deleteConversationRowsLocked_(ensureNewsInboxSheet_(), conversationId));
    addDetail(NEWS_URL_QUEUE_SHEET_NAME, deleteConversationRowsLocked_(ensureNewsUrlQueueSheet_(), conversationId));
    addDetail('本週手動註記', clearWeeklyNotesLocked_(conversationId));

  } else if (cleanupKey === 'pending_replies') {
    addDetail(PENDING_REPLIES_SHEET_NAME, deleteConversationRowsLocked_(ensurePendingRepliesSheet_(), conversationId));

  } else {
    throw new Error('Unknown cleanup key: ' + cleanupKey);
  }

  return result;
}
