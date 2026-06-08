// ======================================================
// 07_WebTaskQueue.gs
// WebTaskQueue 與 PendingReplies 任務層。負責網址任務排程、背景處理、結果暫存與下次訊息交付。
//
// 小浣 LINE Bot v1.10.5 Reader Layer Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
// 5. v1.10.5 起，#懶人包 先透過 16_ReaderLayer.gs 取得可用正文，再交給 Gemini 做快讀摘要。
// ======================================================

// ======================================================
// 建立網址任務
// ======================================================

function enqueueWebTask(event, conversationId, userPrompt, taskType) {
  const urls = extractUrls(userPrompt);

  if (!urls || urls.length === 0) {
    return {
      ok: false,
      error: getBotTextNoReadableUrl_()
    };
  }

  const source = event.source || {};
  const sheet = ensureWebTaskQueueSheet_();

  const now = new Date();
  const taskId = createSimpleId('webtask');

  // v1.7 欄位：
  // TaskType 放最後，避免舊 V6 Sheet 欄位順序需要大搬家。
  sheet.appendRow([
    taskId,
    now,
    now,
    conversationId,
    source.type || '',
    source.userId || '',
    source.groupId || '',
    source.roomId || '',
    userPrompt,
    urls.slice(0, MAX_URLS_PER_MESSAGE).join('\n'),
    'pending',
    '',
    '',
    '',
    '',
    taskType || TASK_TYPE_WEB_LAZY_SUMMARY
  ]);

  return {
    ok: true,
    taskId: taskId,
    urls: urls.slice(0, MAX_URLS_PER_MESSAGE),
    taskType: taskType || TASK_TYPE_WEB_LAZY_SUMMARY
  };
}

function enqueueWebReadTask(event, conversationId, userPrompt) {
  return enqueueWebTask(event, conversationId, userPrompt, TASK_TYPE_WEB_LAZY_SUMMARY);
}

// ======================================================
// 排程處理 WebTaskQueue
// ======================================================

function processWebTaskQueue() {
  const queueLock = LockService.getScriptLock();

  // 避免排程重疊執行
  if (!queueLock.tryLock(1000)) {
    console.log('processWebTaskQueue skipped: lock busy');
    return;
  }

  let tasksToProcess = [];

  try {
    const sheet = ensureWebTaskQueueSheet_();
    const headerMap = getHeaderMap_(sheet);
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      console.log('processWebTaskQueue: no tasks');
      return;
    }

    const lastCol = sheet.getLastColumn();
    const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();

    for (let i = 0; i < values.length; i++) {
      if (tasksToProcess.length >= MAX_WEB_TASKS_PER_RUN) {
        break;
      }

      const row = values[i];
      const sheetRowNumber = i + 2;

      const status = getRowValueByHeader_(row, headerMap, 'Status');

      if (status !== 'pending') {
        continue;
      }

      const now = new Date();

      // 先標記 processing，避免下一輪排程重複處理
      setCellByHeader_(sheet, sheetRowNumber, headerMap, 'UpdatedAt', now);
      setCellByHeader_(sheet, sheetRowNumber, headerMap, 'Status', 'processing');
      setCellByHeader_(sheet, sheetRowNumber, headerMap, 'StartedAt', now);

      tasksToProcess.push({
        sheetRowNumber: sheetRowNumber,
        taskId: getRowValueByHeader_(row, headerMap, 'TaskId'),
        conversationId: getRowValueByHeader_(row, headerMap, 'ConversationId'),
        sourceType: getRowValueByHeader_(row, headerMap, 'SourceType'),
        userId: getRowValueByHeader_(row, headerMap, 'UserId'),
        groupId: getRowValueByHeader_(row, headerMap, 'GroupId'),
        roomId: getRowValueByHeader_(row, headerMap, 'RoomId'),
        userPrompt: getRowValueByHeader_(row, headerMap, 'UserPrompt'),
        urls: getRowValueByHeader_(row, headerMap, 'Urls'),
        taskType: getRowValueByHeader_(row, headerMap, 'TaskType') || TASK_TYPE_WEB_LAZY_SUMMARY
      });
    }

  } finally {
    queueLock.releaseLock();
  }

  if (tasksToProcess.length === 0) {
    console.log('processWebTaskQueue: no pending tasks');
    return;
  }

  // 真正耗時的 AI 呼叫放在 lock 外面，
  // 避免跟 callDeepSeekWithMemoryPayload() 內部 lock 互相卡住。
  tasksToProcess.forEach(function(task) {
    processSingleWebTask_(task);
  });
}

function processSingleWebTask_(task) {
  const sheet = ensureWebTaskQueueSheet_();
  const headerMap = getHeaderMap_(sheet);

  const taskRowData = {
    taskId: task.taskId,
    conversationId: task.conversationId,
    sourceType: task.sourceType,
    userId: task.userId,
    groupId: task.groupId,
    roomId: task.roomId,
    userPrompt: task.userPrompt,
    taskType: task.taskType
  };

  try {
    console.log('Processing web task:', task.taskId, 'taskType:', task.taskType);

    let resultText = '';

    if (task.taskType === TASK_TYPE_PROGRAM_TOPIC_ANALYSIS) {
      resultText = processProgramTopicAnalysisTask_(task);

    } else {
      // 預設全部走快讀摘要
      resultText = processWebLazySummaryTask_(task);
    }

    // 任務成功：寫入 PendingReplies，等待下次訊息交付
    createPendingReplyFromTask(taskRowData, resultText, task.taskType);

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', new Date());
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'done');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'ResultText', truncateForSheet(resultText));
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', new Date());

    console.log('Web task done:', task.taskId);

  } catch (taskError) {
    console.error('processSingleWebTask_ error:', taskError && taskError.stack ? taskError.stack : taskError);

    const errorText = getBotTextWebTaskFailed_(taskError && taskError.message ? taskError.message : taskError);

    // 任務失敗也寫入 PendingReplies，讓使用者下次知道失敗原因
    createPendingReplyFromTask(taskRowData, errorText, task.taskType);

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', new Date());
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'failed');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'ErrorText', truncateForSheet(errorText));
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', new Date());
  }
}

// ======================================================
// 快讀摘要任務
// ======================================================

function processWebLazySummaryTask_(task) {
  const urls = String(task.urls || '')
    .split('\n')
    .map(function(url) { return String(url || '').trim(); })
    .filter(function(url) { return url !== ''; })
    .slice(0, MAX_URLS_PER_MESSAGE);

  if (urls.length === 0) {
    throw new Error('任務中沒有可處理的網址。');
  }

  const summaryResults = [];

  urls.forEach(function(url, index) {
    const result = createLazySummaryForUrl_(task, url);

    summaryResults.push(result);

    // 無論成功或失敗，都寫入 WebSummary。
    // 這樣未來回顧時可以知道某篇網址抓失敗，而不是完全消失。
    saveWebSummary_(task, result);
  });

  return formatLazySummaryResultsForReply_(summaryResults);
}

function createLazySummaryForUrl_(task, url) {
  try {
    const webResult = fetchAndExtractWebPageByReaderLayer_(url);

    if (!webResult.ok) {
      return {
        ok: false,
        url: url,
        title: webResult.title || '',
        siteName: webResult.siteName || '',
        author: '',
        publishedAt: '',
        summary: '',
        keyPoints: [],
        contentTypeLabel: '',
        topicPotential: '',
        extractionConfidence: 0,
        warnings: webResult.warnings || [],
        error: webResult.error || '讀取網址失敗'
      };
    }

    const summary = callGeminiReadableTextLazySummary_(
      url,
      webResult.mainText,
      webResult.contentType,
      task.userPrompt,
      webResult
    );

    return {
      ok: true,
      url: url,
      title: summary.title || webResult.title || '',
      siteName: summary.siteName || webResult.siteName || '',
      author: summary.author || webResult.author || '',
      publishedAt: summary.publishedAt || webResult.publishedAt || '',
      summary: summary.summary || '',
      keyPoints: summary.keyPoints || [],
      contentTypeLabel: summary.contentTypeLabel || '',
      topicPotential: summary.topicPotential || '',
      extractionConfidence: summary.extractionConfidence || webResult.extractionConfidence || 0,
      warnings: summary.warnings || webResult.warnings || [],
      error: ''
    };

  } catch (error) {
    return {
      ok: false,
      url: url,
      title: '',
      siteName: '',
      author: '',
      publishedAt: '',
      summary: '',
      keyPoints: [],
      contentTypeLabel: '',
      topicPotential: '',
      extractionConfidence: 0,
      warnings: [],
      error: String(error && error.message ? error.message : error)
    };
  }
}

function formatLazySummaryResultsForReply_(summaryResults) {
  const blocks = summaryResults.map(function(result, index) {
    if (!result.ok) {
      return getBotTextSingleUrlFailed_(index, result.url, result.error);
    }

    const keyPointsText = result.keyPoints && result.keyPoints.length > 0
      ? result.keyPoints.map(function(point, pointIndex) {
          return (pointIndex + 1) + '. ' + point;
        }).join('\n')
      : '目前沒有翻到明確重點。';

    const meta = [
      result.siteName ? '來源：' + result.siteName : '',
      result.publishedAt ? '時間：' + result.publishedAt : '',
      result.contentTypeLabel ? '類型：' + result.contentTypeLabel : '',
      result.topicPotential ? '節目潛力：' + result.topicPotential : ''
    ].filter(function(line) {
      return line !== '';
    }).join('\n');

    return getBotTextLazySummaryBlock_(result, index, keyPointsText, meta);
  });

  return blocks.join('\n\n');
}

// ======================================================
// 節目話題網址分析任務
// ======================================================

function processProgramTopicAnalysisTask_(task) {
  return callDeepSeekWithWebReading(
    task.conversationId,
    task.userPrompt,
    'program_topic_analysis'
  );
}

// ======================================================
// PendingReplies 交付機制
// ======================================================

function createPendingReplyFromTask(taskRowData, replyText, replyMode) {
  const sheet = ensurePendingRepliesSheet_();

  const pendingId = createSimpleId('pending');
  const now = new Date();

  sheet.appendRow([
    pendingId,
    now,
    taskRowData.conversationId || '',
    taskRowData.sourceType || '',
    taskRowData.userId || '',
    taskRowData.groupId || '',
    taskRowData.roomId || '',
    truncateForSheet(replyText || ''),
    'pending',
    '',
    replyMode || taskRowData.taskType || ''
  ]);

  return pendingId;
}

function getAndDeletePendingReply(conversationId) {
  const sheet = ensurePendingRepliesSheet_();
  const headerMap = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return null;
  }

  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  // 從上往下找最早完成的 pending reply
  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
    const replyText = getRowValueByHeader_(row, headerMap, 'ReplyText');
    const status = getRowValueByHeader_(row, headerMap, 'Status');
    const replyMode = getRowValueByHeader_(row, headerMap, 'ReplyMode');

    if (rowConversationId === conversationId && status === 'pending' && replyText) {
      const sheetRowNumber = i + 2;

      // 直接刪除，避免下次重複交付
      sheet.deleteRow(sheetRowNumber);

      return {
        text: String(replyText || ''),
        replyMode: String(replyMode || '')
      };
    }
  }

  return null;
}
