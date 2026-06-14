// ======================================================
// 01_Main.gs
// 主要入口、首次設定、Trigger 安裝、Webhook 事件主流程。
//
// 小浣 LINE Bot v1.11.0 Direct URL Summary Edition
//
// 維護原則：
// 1. 本檔負責 LINE webhook 主流程與事件分流。
// 2. 不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. 群組與個人聊天室「直接貼網址」都走相同 NewsInbox 收件流程。
// 4. 只有 #懶人包 才走快讀摘要；只有 #節目話題分析 + 網址 才走深度網址分析。
// 5. v1.10.4 將資料清理統一交給 15_DataCleanup.gs，所有清理都需二段確認。
// 6. v1.10.9 起，X / Twitter 非單篇 status 網址不入隊；Facebook / Threads 會先交給 Jina Reader。
// 7. v1.11.0 起，單一直接網址會同步產生 100～200 字大綱並寫入 NewsInbox；
//    多網址、Reader 過慢或同步分析失敗時，才退回 NewsUrlQueue 背景處理。
// ======================================================

function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const highlightSheet = ensureTopicHighlightsSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();
  const webTaskSheet = ensureWebTaskQueueSheet_();
  const newsQueueSheet = ensureNewsUrlQueueSheet_();
  const newsInboxSheet = ensureNewsInboxSheet_();
  const pendingReplySheet = ensurePendingRepliesSheet_();
  const webSummarySheet = ensureWebSummarySheet_();

  return [
    'Sheet setup completed:',
    logSheet.getName(),
    highlightSheet.getName(),
    weeklySheet.getName(),
    webTaskSheet.getName(),
    newsQueueSheet.getName(),
    newsInboxSheet.getName(),
    pendingReplySheet.getName(),
    webSummarySheet.getName()
  ].join(', ');
}

function installWebTaskQueueTrigger() {
  const triggers = ScriptApp.getProjectTriggers();

  // 同一個安裝函式同時管理舊 WebTaskQueue 與新 NewsUrlQueue 的排程。
  // 保留函式名稱 installWebTaskQueueTrigger()，避免既有維護習慣失效。
  triggers.forEach(function(trigger) {
    const handler = trigger.getHandlerFunction();
    if (handler === 'processWebTaskQueue' || handler === 'processNewsUrlQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('processWebTaskQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  ScriptApp.newTrigger('processNewsUrlQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  return 'processWebTaskQueue and processNewsUrlQueue triggers installed.';
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return HtmlService.createHtmlOutput('OK');
    }

    const body = JSON.parse(e.postData.contents);
    const events = body.events || [];

    events.forEach(function(event) {
      handleLineEvent(event);
    });

    return HtmlService.createHtmlOutput('OK');

  } catch (error) {
    console.error('doPost error:', error && error.stack ? error.stack : error);
    return HtmlService.createHtmlOutput('OK');
  }
}

function handleLineEvent(event) {
  if (!event || !event.replyToken) {
    return;
  }

  const sourceType = event.source && event.source.type ? event.source.type : 'unknown';
  const isGroupLike = sourceType === 'group' || sourceType === 'room';
  const conversationId = getConversationId(event);

  if (event.type !== 'message' || !event.message || event.message.type !== 'text') {
    if (!isGroupLike) {
      replyToLine(event.replyToken, getBotTextUnsupportedMessage_());
    }
    return;
  }

  const userText = String(event.message.text || '').trim();
  if (!userText) return;

  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'user',
    text: userText,
    mode: getUserLogMode(userText)
  });

  // ======================================================
  // Pending Reply 優先交付
  // ======================================================

  const pendingReply = getAndDeletePendingReply(conversationId);

  if (pendingReply && pendingReply.text) {
    const enqueueResult = enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText);
    const deliveryText = getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok));

    replyToLine(event.replyToken, deliveryText);
    logAssistantReplyToSheet(event, conversationId, deliveryText, pendingReply.replyMode || 'pending_reply_delivery');
    return;
  }

  // ======================================================
  // 群組一般訊息：沒有觸發詞但含網址 → NewsInbox 同步收件或 queue fallback
  // ======================================================

  if (isGroupLike && !hasTriggerPrefix(userText)) {
    if (shouldUseWebReading(userText)) {
      let directNewsResult = null;
      try {
        directNewsResult = handleDirectNewsUrlMessage_(event, conversationId, userText);
      } catch (error) {
        console.error('Direct group news URL error:', error && error.stack ? error.stack : error);
        directNewsResult = {
          replyText: getBotTextAiError_(),
          replyMode: 'news_inbox_sync_error'
        };
      }

      const replyText = directNewsResult.replyText || getBotTextNoReadableUrl_();

      replyToLine(event.replyToken, replyText);
      logAssistantReplyToSheet(event, conversationId, replyText, directNewsResult.replyMode || 'news_inbox_url');
      return;
    }

    return;
  }

  const helpText = getHelpTextByCommand_(userText);
  if (helpText) {
    replyToLine(event.replyToken, helpText);
    logAssistantReplyToSheet(event, conversationId, helpText, 'help');
    return;
  }

  if (userText === '#版本' || userText === '#小浣 版本') {
    const versionText = getBotVersionText_();
    replyToLine(event.replyToken, versionText);
    logAssistantReplyToSheet(event, conversationId, versionText, 'version');
    return;
  }

  if (userText === '#版本紀錄' || userText === '#小浣 版本紀錄') {
    const versionHistoryText = getBotVersionHistoryText_();
    replyToLine(event.replyToken, versionHistoryText);
    logAssistantReplyToSheet(event, conversationId, versionHistoryText, 'version_history');
    return;
  }

  if (userText === '#reset' || userText === '#小浣 reset') {
    clearConversationHistory(conversationId);
    const resetText = getBotTextResetDone_();
    replyToLine(event.replyToken, resetText);
    logAssistantReplyToSheet(event, conversationId, resetText, 'reset');
    return;
  }

  const cleanupInfo = getCleanupCommandInfo_(userText);
  if (cleanupInfo) {
    if (!cleanupInfo.isConfirm) {
      const warningText = getBotTextCleanupWarning_(cleanupInfo);
      replyToLine(event.replyToken, warningText);
      logAssistantReplyToSheet(event, conversationId, warningText, 'cleanup_warning');
      return;
    }

    const cleanupResult = performDataCleanup_(cleanupInfo.key, conversationId);

    if (cleanupInfo.key === 'conversation_log') {
      clearConversationHistory(conversationId);
    }

    const doneText = getBotTextCleanupDone_(cleanupInfo, cleanupResult);
    replyToLine(event.replyToken, doneText);
    logAssistantReplyToSheet(event, conversationId, doneText, 'cleanup_done');
    return;
  }

  if (userText.startsWith('#畫重點')) {
    const highlightText = userText.replace('#畫重點', '').trim();
    if (!highlightText) {
      const emptyText = getBotTextHighlightEmpty_();
      replyToLine(event.replyToken, emptyText);
      logAssistantReplyToSheet(event, conversationId, emptyText, 'highlight_empty');
      return;
    }

    saveTopicHighlight_(event, conversationId, userText, highlightText);
    const savedText = getBotTextHighlightSaved_();
    replyToLine(event.replyToken, savedText);
    logAssistantReplyToSheet(event, conversationId, savedText, 'highlight_saved');
    return;
  }

  if (userText === '#封存本週話題') {
    let archiveReply = '';
    try {
      archiveReply = archiveWeeklyTopics(event, conversationId);
    } catch (error) {
      console.error('archiveWeeklyTopics error:', error && error.stack ? error.stack : error);
      archiveReply = getBotTextArchiveError_();
    }

    replyToLine(event.replyToken, archiveReply);
    logAssistantReplyToSheet(event, conversationId, archiveReply, 'archive_weekly');
    return;
  }

  const commandInfo = parseCommand(userText);
  let aiReply = '';
  let aiReplyMode = commandInfo.mode;

  try {
    if (commandInfo.mode === 'integrate_topics') {
      aiReply = integrateRecentTopics(event, conversationId, commandInfo.userPrompt);

    } else if (commandInfo.mode === 'weekly_news') {
      aiReply = handleWeeklyNewsDigest_(event, conversationId, commandInfo.userPrompt);

    } else if (commandInfo.mode === 'manual_news_supplement') {
      aiReply = handleManualNewsSupplement_(event, conversationId, userText);

    } else if (commandInfo.mode === 'program_topic_analysis') {
      const urls = extractUrls(commandInfo.userPrompt);
      if (urls.length > 0) {
        const enqueueResult = enqueueWebTask(event, conversationId, commandInfo.userPrompt, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
        aiReply = enqueueResult.ok
          ? buildWebTaskAcceptedText_(TASK_TYPE_PROGRAM_TOPIC_ANALYSIS, enqueueResult.urls.length)
          : enqueueResult.error || getBotTextNoReadableUrl_();
      } else {
        aiReply = analyzeProgramTopicFromRecentContext(event, conversationId, commandInfo.userPrompt);
      }

    } else if (commandInfo.mode === 'web_read') {
      const enqueueResult = enqueueWebTask(event, conversationId, commandInfo.userPrompt, TASK_TYPE_WEB_LAZY_SUMMARY);
      aiReply = enqueueResult.ok
        ? buildWebTaskAcceptedText_(TASK_TYPE_WEB_LAZY_SUMMARY, enqueueResult.urls.length)
        : enqueueResult.error || getBotTextNoReadableUrl_();

    } else {
      if (shouldUseWebReading(commandInfo.userPrompt)) {
        const directNewsResult = handleDirectNewsUrlMessage_(event, conversationId, commandInfo.userPrompt);
        aiReply = directNewsResult.replyText || getBotTextNoReadableUrl_();
        aiReplyMode = directNewsResult.replyMode || commandInfo.mode;
      } else {
        aiReply = callDeepSeekWithMemory(conversationId, commandInfo.userPrompt, commandInfo.mode);
      }
    }

  } catch (error) {
    console.error('AI call error stack:', error && error.stack ? error.stack : error);
    console.error('AI call error message:', error && error.message ? error.message : String(error));
    aiReply = getBotTextAiError_();
  }

  replyToLine(event.replyToken, aiReply);
  logAssistantReplyToSheet(event, conversationId, aiReply, aiReplyMode);
}
