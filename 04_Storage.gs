// ======================================================
// 04_Storage.gs
// Google Sheet 資料層。負責表頭建立、讀寫 ConversationLog / WebSummary / WeeklySummary / Queue 等資料。
//
// 小浣 LINE Bot v1.12.0 Silent URL Status & News Archive Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
// 5. v1.12.0 起，WeeklySummary 追加 ArchiveType / PeriodStart / PeriodEnd / SourceItemCount，
//    用來區分 #封存本週話題 與 #封存本週新聞 的長期記憶來源。
// ======================================================

// ======================================================
// Script Properties 與 Spreadsheet 入口
// ======================================================

function getRequiredScriptProperty_(propertyName) {
  const value = PropertiesService
    .getScriptProperties()
    .getProperty(propertyName);

  if (!value) {
    throw new Error('Missing ' + propertyName + ' in Script Properties');
  }

  return value;
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(getRequiredScriptProperty_('SPREADSHEET_ID'));
}

// ======================================================
// Sheet 表頭與欄位工具
// ======================================================

function ensureSheetWithHeaders_(sheetName, headers) {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  const currentLastColumn = Math.max(sheet.getLastColumn(), headers.length);
  const firstRow = sheet.getRange(1, 1, 1, currentLastColumn).getValues()[0];

  const hasHeader = firstRow.some(function(value) {
    return String(value || '').trim() !== '';
  });

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return sheet;
  }

  // 相容舊版：
  // 如果舊 Sheet 已經有表頭，只補上缺少的新欄位，不重排舊欄位。
  const existingHeaders = firstRow.map(function(value) {
    return String(value || '').trim();
  });

  let nextColumn = existingHeaders.length + 1;

  headers.forEach(function(header) {
    if (existingHeaders.indexOf(header) === -1) {
      sheet.getRange(1, nextColumn).setValue(header);
      existingHeaders.push(header);
      nextColumn++;
    }
  });

  sheet.setFrozenRows(1);

  return sheet;
}

function getHeaderMap_(sheet) {
  const lastColumn = sheet.getLastColumn();

  if (lastColumn <= 0) {
    return {};
  }

  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};

  headers.forEach(function(header, index) {
    const key = String(header || '').trim();

    if (key) {
      map[key] = index + 1;
    }
  });

  return map;
}

function getRowValueByHeader_(row, headerMap, headerName) {
  const columnIndex = headerMap[headerName];

  if (!columnIndex) {
    return '';
  }

  return row[columnIndex - 1];
}

function setCellByHeader_(sheet, rowNumber, headerMap, headerName, value) {
  const columnIndex = headerMap[headerName];

  if (!columnIndex) {
    return;
  }

  sheet.getRange(rowNumber, columnIndex).setValue(value);
}

// ======================================================
// 各資料表初始化
// ======================================================

function ensureLogSheet_() {
  const headers = [
    'Timestamp',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'Role',
    'Mode',
    'MessageId',
    'Text'
  ];

  return ensureSheetWithHeaders_(SHEET_NAME, headers);
}

function ensureWeeklySummarySheet_() {
  const headers = [
    'ArchivedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'TopicTitle',
    'Keywords',
    'Summary',
    'ReusableAngles',
    'FollowUpQuestions',
    'RawMessageCount',
    'ArchiveType',
    'PeriodStart',
    'PeriodEnd',
    'SourceItemCount'
  ];

  return ensureSheetWithHeaders_(WEEKLY_SUMMARY_SHEET_NAME, headers);
}

function appendWeeklySummaryRow_(item) {
  const sheet = ensureWeeklySummarySheet_();
  const archivedAt = item.archivedAt || new Date();
  const sourceItemCount = Number(item.sourceItemCount || item.rawMessageCount || 0);

  const valuesByHeader = {
    ArchivedAt: archivedAt,
    ConversationId: item.conversationId || '',
    SourceType: item.sourceType || '',
    UserId: item.userId || '',
    GroupId: item.groupId || '',
    RoomId: item.roomId || '',
    TopicTitle: truncateForSheet(item.topicTitle || ''),
    Keywords: truncateForSheet(item.keywords || ''),
    Summary: truncateForSheet(item.summary || ''),
    ReusableAngles: truncateForSheet(item.reusableAngles || ''),
    FollowUpQuestions: truncateForSheet(item.followUpQuestions || ''),
    RawMessageCount: Number(item.rawMessageCount || sourceItemCount || 0),
    ArchiveType: item.archiveType || WEEKLY_ARCHIVE_TYPE_TOPIC,
    PeriodStart: item.periodStart || '',
    PeriodEnd: item.periodEnd || '',
    SourceItemCount: sourceItemCount
  };

  // v1.12.0 起 WeeklySummary 同時保存話題封存與新聞封存。
  // 這裡依實際表頭寫入，讓既有 Sheet 只追加新欄位，不需要重排或 migration。
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function(header) {
    const key = String(header || '').trim();
    return Object.prototype.hasOwnProperty.call(valuesByHeader, key)
      ? valuesByHeader[key]
      : '';
  });

  sheet.appendRow(row);
}

function ensureWebTaskQueueSheet_() {
  const headers = [
    'TaskId',
    'CreatedAt',
    'UpdatedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'UserPrompt',
    'Urls',
    'Status',
    'ResultText',
    'ErrorText',
    'StartedAt',
    'FinishedAt',
    'TaskType'
  ];

  return ensureSheetWithHeaders_(WEB_TASK_QUEUE_SHEET_NAME, headers);
}

function ensurePendingRepliesSheet_() {
  const headers = [
    'PendingId',
    'CreatedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'ReplyText',
    'Status',
    'DeliveredAt',
    'ReplyMode'
  ];

  return ensureSheetWithHeaders_(PENDING_REPLIES_SHEET_NAME, headers);
}

function ensureWebSummarySheet_() {
  const headers = [
    'SummaryId',
    'CreatedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'OriginalMessage',
    'Url',
    'Title',
    'SiteName',
    'Author',
    'PublishedAt',
    'Summary',
    'KeyPoints',
    'ContentType',
    'TopicPotential',
    'ExtractionConfidence',
    'Warnings',
    'Status',
    'ErrorText'
  ];

  return ensureSheetWithHeaders_(WEB_SUMMARY_SHEET_NAME, headers);
}

// ======================================================
// ConversationLog 寫入
// ======================================================

function logMessageToSheet(data) {
  try {
    const event = data.event || {};
    const source = event.source || {};
    const message = event.message || {};

    const sheet = ensureLogSheet_();

    const timestamp = event.timestamp
      ? new Date(event.timestamp)
      : new Date();

    const row = [
      timestamp,
      data.conversationId || '',
      source.type || '',
      source.userId || '',
      source.groupId || '',
      source.roomId || '',
      data.role || '',
      data.mode || '',
      message.id || '',
      truncateForSheet(data.text || '')
    ];

    sheet.appendRow(row);

  } catch (error) {
    console.error('logMessageToSheet error:', error);
  }
}

function logAssistantReplyToSheet(event, conversationId, text, mode) {
  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'assistant',
    text: text,
    mode: mode || 'reply'
  });
}

// ======================================================
// WebSummary 寫入
// ======================================================

function saveWebSummary_(task, summaryResult) {
  try {
    const sheet = ensureWebSummarySheet_();

    const summaryId = createSimpleId('websummary');
    const now = new Date();

    const keyPointsText = summaryResult.keyPoints && summaryResult.keyPoints.length > 0
      ? summaryResult.keyPoints.join('\n')
      : '';

    const warningsText = summaryResult.warnings && summaryResult.warnings.length > 0
      ? summaryResult.warnings.join('\n')
      : '';

    sheet.appendRow([
      summaryId,
      now,
      task.conversationId || '',
      task.sourceType || '',
      task.userId || '',
      task.groupId || '',
      task.roomId || '',
      truncateForSheet(task.userPrompt || ''),
      summaryResult.url || '',
      summaryResult.title || '',
      summaryResult.siteName || '',
      summaryResult.author || '',
      summaryResult.publishedAt || '',
      truncateForSheet(summaryResult.summary || ''),
      truncateForSheet(keyPointsText),
      summaryResult.contentTypeLabel || '',
      summaryResult.topicPotential || '',
      summaryResult.extractionConfidence || 0,
      truncateForSheet(warningsText),
      summaryResult.ok ? 'ok' : 'failed',
      truncateForSheet(summaryResult.error || '')
    ]);

  } catch (error) {
    console.error('saveWebSummary_ error:', error && error.stack ? error.stack : error);
  }
}

// ======================================================
// 最近資料讀取
// ======================================================

function getRecentConversationText(conversationId, limit, includeAssistant) {
  const items = getRecentConversationItems(conversationId, limit, includeAssistant);

  return items.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');
}

function getRecentConversationItems(conversationId, limit, includeAssistant) {
  const sheet = ensureLogSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const lastCol = sheet.getLastColumn();

  // 為了效能，最多往回讀最近 500 列
  const readRows = Math.min(lastRow - 1, 500);
  const startRow = lastRow - readRows + 1;

  const values = sheet
    .getRange(startRow, 1, readRows, lastCol)
    .getValues();

  const matched = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];

    const rowConversationId = row[1];
    const role = row[6];
    const mode = row[7];
    const text = row[9];

    if (rowConversationId !== conversationId) {
      continue;
    }

    if (!text) {
      continue;
    }

    if (!includeAssistant && role !== 'user') {
      continue;
    }

    if (includeAssistant && role !== 'user' && role !== 'assistant') {
      continue;
    }

    // 避免把純系統指令大量納入封存摘要。
    // 但保留 #記錄，因為它通常是使用者刻意標記的重要內容。
    const textString = String(text);
    const isCommand = textString.startsWith('#');
    const isImportantNote = textString.startsWith('#記錄');

    if (isCommand && !isImportantNote) {
      continue;
    }

    matched.push({
      role: role,
      mode: mode,
      text: textString
    });

    if (matched.length >= limit) {
      break;
    }
  }

  matched.reverse();

  return matched;
}

function getRecentWebSummariesText(conversationId, limit) {
  try {
    const sheet = ensureWebSummarySheet_();
    const headerMap = getHeaderMap_(sheet);
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return '';
    }

    const lastCol = sheet.getLastColumn();

    // 最多往回讀最近 200 筆 WebSummary
    const readRows = Math.min(lastRow - 1, 200);
    const startRow = lastRow - readRows + 1;

    const values = sheet
      .getRange(startRow, 1, readRows, lastCol)
      .getValues();

    const matched = [];

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];

      const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
      const status = getRowValueByHeader_(row, headerMap, 'Status');

      if (rowConversationId !== conversationId) {
        continue;
      }

      const url = getRowValueByHeader_(row, headerMap, 'Url');
      const title = getRowValueByHeader_(row, headerMap, 'Title');
      const summary = getRowValueByHeader_(row, headerMap, 'Summary');
      const keyPoints = getRowValueByHeader_(row, headerMap, 'KeyPoints');
      const contentType = getRowValueByHeader_(row, headerMap, 'ContentType');
      const topicPotential = getRowValueByHeader_(row, headerMap, 'TopicPotential');
      const originalMessage = getRowValueByHeader_(row, headerMap, 'OriginalMessage');
      const errorText = getRowValueByHeader_(row, headerMap, 'ErrorText');

      if (!url && !summary && !errorText) {
        continue;
      }

      matched.push({
        status: status,
        url: url,
        title: title,
        summary: summary,
        keyPoints: keyPoints,
        contentType: contentType,
        topicPotential: topicPotential,
        originalMessage: originalMessage,
        errorText: errorText
      });

      if (matched.length >= limit) {
        break;
      }
    }

    matched.reverse();

    return matched.map(function(item, index) {
      if (item.status === 'failed') {
        return [
          '【網址快讀 ' + (index + 1) + '】',
          '狀態：讀取失敗',
          '網址：' + item.url,
          '錯誤：' + item.errorText,
          '原始訊息：' + item.originalMessage
        ].join('\n');
      }

      return [
        '【網址快讀 ' + (index + 1) + '】',
        '標題：' + (item.title || '未取得標題'),
        '網址：' + item.url,
        '類型：' + (item.contentType || '未分類'),
        '節目潛力：' + (item.topicPotential || '未判斷'),
        '摘要：' + (item.summary || '無摘要'),
        '重點：' + (item.keyPoints || '無'),
        '原始訊息：' + (item.originalMessage || '無')
      ].join('\n');
    }).join('\n\n');

  } catch (error) {
    console.error('getRecentWebSummariesText error:', error);
    return '';
  }
}

function getRecentWeeklySummaryText(conversationId, limit, archiveType) {
  try {
    const sheet = ensureWeeklySummarySheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return '';
    }

    const lastCol = sheet.getLastColumn();
    const headerMap = getHeaderMap_(sheet);

    // 最多往回讀最近 100 筆 WeeklySummary
    const readRows = Math.min(lastRow - 1, 100);
    const startRow = lastRow - readRows + 1;

    const values = sheet
      .getRange(startRow, 1, readRows, lastCol)
      .getValues();

    const matched = [];

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];

      const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
      const rowArchiveType = getRowValueByHeader_(row, headerMap, 'ArchiveType') || WEEKLY_ARCHIVE_TYPE_TOPIC;
      const topicTitle = getRowValueByHeader_(row, headerMap, 'TopicTitle');
      const keywords = getRowValueByHeader_(row, headerMap, 'Keywords');
      const summary = getRowValueByHeader_(row, headerMap, 'Summary');
      const reusableAngles = getRowValueByHeader_(row, headerMap, 'ReusableAngles');
      const followUpQuestions = getRowValueByHeader_(row, headerMap, 'FollowUpQuestions');
      const periodStart = getRowValueByHeader_(row, headerMap, 'PeriodStart');
      const periodEnd = getRowValueByHeader_(row, headerMap, 'PeriodEnd');
      const sourceItemCount = getRowValueByHeader_(row, headerMap, 'SourceItemCount') ||
        getRowValueByHeader_(row, headerMap, 'RawMessageCount');

      if (rowConversationId !== conversationId) {
        continue;
      }

      if (archiveType && rowArchiveType !== archiveType) {
        continue;
      }

      if (!summary) {
        continue;
      }

      matched.push({
        topicTitle: topicTitle,
        keywords: keywords,
        summary: summary,
        reusableAngles: reusableAngles,
        followUpQuestions: followUpQuestions,
        archiveType: rowArchiveType,
        periodStart: periodStart,
        periodEnd: periodEnd,
        sourceItemCount: sourceItemCount
      });

      if (matched.length >= limit) {
        break;
      }
    }

    matched.reverse();

    return matched.map(function(item, index) {
      return [
        '【封存記憶 ' + (index + 1) + '】',
        '類型：' + getWeeklyArchiveTypeLabel_(item.archiveType),
        item.periodStart || item.periodEnd ? '期間：' + (item.periodStart || '未記錄') + ' ～ ' + (item.periodEnd || '未記錄') : '',
        item.sourceItemCount ? '來源筆數：' + item.sourceItemCount : '',
        '主題：' + item.topicTitle,
        '關鍵字：' + item.keywords,
        '摘要：' + item.summary,
        '可重用切角：' + item.reusableAngles,
        '後續問題：' + item.followUpQuestions
      ].filter(function(line) { return line !== ''; }).join('\n');
    }).join('\n\n');

  } catch (error) {
    console.error('getRecentWeeklySummaryText error:', error);
    return '';
  }
}

function getWeeklyArchiveTypeLabel_(archiveType) {
  if (archiveType === WEEKLY_ARCHIVE_TYPE_NEWS) return '新聞封存';
  return '話題封存';
}

// ======================================================
// 資料刪除與 Sheet 安全工具
// ======================================================

function deleteConversationLogs(conversationId) {
  const sheet = ensureLogSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return 0;
  }

  const conversationIdColumn = 2; // B 欄：ConversationId

  const values = sheet
    .getRange(2, conversationIdColumn, lastRow - 1, 1)
    .getValues();

  let deletedCount = 0;

  // 從下面往上刪，避免刪除列後 row index 位移
  for (let i = values.length - 1; i >= 0; i--) {
    const rowConversationId = values[i][0];

    if (rowConversationId === conversationId) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount;
}

function truncateForSheet(text) {
  const safeText = String(text || '');
  return safeText.slice(0, 30000);
}
