// ======================================================
// 14_HighlightsCleanup.gs
// v1.10.3 Highlight & Cleanup Edition：TopicHighlights 重點資料表與各 Sheet 清理工具。
//
// 維護重點：
// 1. #畫重點 不再只是寫進 ConversationLog，而是額外寫入 TopicHighlights，成為人工釘選素材。
// 2. TopicHighlights 會被 #統整話題、#節目話題分析、#封存本週話題 優先參考。
// 3. 清理指令一律只清「目前 conversationId」的資料，不刪整張 Sheet，也不刪表頭。
// 4. 所有清理都採二段式確認：先顯示影響範圍，再輸入「確認」才會刪除。
// 5. 本檔依賴 04_Storage.gs 的 ensureSheetWithHeaders_、getHeaderMap_、getRowValueByHeader_、truncateForSheet 等共用工具。
// ======================================================

// ======================================================
// TopicHighlights Sheet 初始化與寫入
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
  const now = new Date();

  sheet.appendRow([
    createSimpleId('highlight'),
    now,
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

// ======================================================
// TopicHighlights 讀取
// ======================================================

function getRecentTopicHighlightItems_(conversationId, limit) {
  try {
    const sheet = ensureTopicHighlightsSheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return [];
    }

    const headerMap = getHeaderMap_(sheet);
    const lastCol = sheet.getLastColumn();

    // TopicHighlights 是人工釘選資料，數量通常不會像 ConversationLog 一樣爆量；
    // 但仍限制最多往回讀 300 列，避免長期使用後一次拉太多資料。
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

// ======================================================
// 清理指令解析
// ======================================================

function normalizeCleanupCommandText_(text) {
  const raw = String(text || '').trim();

  // 群組中允許「#小浣 清空快讀」與「#清空快讀」兩種寫法。
  if (raw.startsWith('#小浣')) {
    return raw.replace('#小浣', '').trim();
  }

  return raw;
}

function getCleanupCommandInfo_(text) {
  const normalized = normalizeCleanupCommandText_(text);
  const isConfirm = normalized.endsWith(' 確認');
  const baseCommand = isConfirm ? normalized.replace(/\s+確認$/, '').trim() : normalized;

  const commandMap = {
    '#清空紀錄': {
      key: 'conversation_log',
      label: 'ConversationLog 對話紀錄',
      description: '清除目前聊天室的原始對話紀錄，並同步清除短期記憶。',
      affectedSheets: ['ConversationLog']
    },
    '#清空重點': {
      key: 'topic_highlights',
      label: 'TopicHighlights 畫重點資料',
      description: '清除目前聊天室手動畫重點的人工釘選素材。',
      affectedSheets: ['TopicHighlights']
    },
    '#清空快讀': {
      key: 'web_data',
      label: 'WebSummary / WebTaskQueue 快讀資料',
      description: '清除目前聊天室的網址快讀摘要與尚在 WebTaskQueue 裡的快讀 / 分析任務。',
      affectedSheets: ['WebSummary', 'WebTaskQueue']
    },
    '#清空封存': {
      key: 'weekly_summary',
      label: 'WeeklySummary 封存記憶',
      description: '清除目前聊天室已封存的長期記憶摘要。',
      affectedSheets: ['WeeklySummary']
    },
    '#清空新聞': {
      key: 'news_data',
      label: 'NewsInbox / NewsUrlQueue 新聞素材',
      description: '清除目前聊天室的新聞素材池與尚在處理中的新聞網址佇列。',
      affectedSheets: ['NewsInbox', 'NewsUrlQueue']
    },
    '#清空待回覆': {
      key: 'pending_replies',
      label: 'PendingReplies 待交付回覆',
      description: '清除目前聊天室背景任務已完成但尚未交付的回覆。',
      affectedSheets: ['PendingReplies']
    }
  };

  const info = commandMap[baseCommand];
  if (!info) return null;

  return {
    key: info.key,
    label: info.label,
    description: info.description,
    affectedSheets: info.affectedSheets,
    command: baseCommand,
    confirmCommand: baseCommand + ' 確認',
    isConfirm: isConfirm
  };
}

// ======================================================
// 通用刪除工具
// ======================================================

function deleteRowsByConversationIdFromSheet_(sheet, conversationId, conversationIdHeaderName) {
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return 0;
  }

  const headerMap = getHeaderMap_(sheet);
  const columnIndex = headerMap[conversationIdHeaderName || 'ConversationId'];

  if (!columnIndex) {
    throw new Error('Missing ConversationId column in sheet: ' + sheet.getName());
  }

  const values = sheet.getRange(2, columnIndex, lastRow - 1, 1).getValues();
  let deletedCount = 0;

  // 從下往上刪，避免刪除列後 row index 位移。
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
    addDetail(SHEET_NAME, deleteConversationLogs(conversationId));

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
