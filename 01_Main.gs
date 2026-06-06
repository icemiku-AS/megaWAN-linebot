// ======================================================
// 01_Main.gs
// 主要入口、首次設定、Trigger 安裝、Webhook 事件主流程。
//
// 小浣 LINE Bot v1.10.0 News Inbox Edition
//
// 維護原則：
// 1. 本檔負責 LINE webhook 主流程與事件分流。
// 2. 不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. v1.10.0 起，群組直接貼網址改成 NewsInbox 收件分類；#讀網址 / #懶人包 才走快讀摘要。
// 4. Google Apps Script 會把同一專案內的 .gs 檔視為同一個全域命名空間。
// ======================================================

function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();
  const webTaskSheet = ensureWebTaskQueueSheet_();
  const newsQueueSheet = ensureNewsUrlQueueSheet_();
  const newsInboxSheet = ensureNewsInboxSheet_();
  const pendingReplySheet = ensurePendingRepliesSheet_();
  const webSummarySheet = ensureWebSummarySheet_();

  return [
    'Sheet setup completed:',
    logSheet.getName(),
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

  // v1.10.0：同一個安裝函式同時管理舊 WebTaskQueue 與新 NewsUrlQueue 的排程。
  // 保留函式名稱 installWebTaskQueueTrigger()，避免既有使用習慣失效。
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
  //
  // v1.10.0：如果使用者這次訊息本身也貼了網址，會先把新網址收進 NewsInbox queue，
  // 再交付舊 pending。這樣舊結果不會被新收件中斷。
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
  // 群組一般訊息：沒有觸發詞但含網址 → NewsInbox 收件分類
  // ======================================================

  if (isGroupLike && !hasTriggerPrefix(userText)) {
    if (shouldUseWebReading(userText)) {
      const enqueueResult = enqueueNewsUrlTasks(event, conversationId, userText);
      const replyText = enqueueResult.ok
        ? getBotTextNewsInboxAccepted_(enqueueResult.urls.length)
        : enqueueResult.error || getBotTextNoReadableUrl_();

      replyToLine(event.replyToken, replyText);
      logAssistantReplyToSheet(event, conversationId, replyText, 'news_inbox_accepted');
      return;
    }

    return;
  }

  if (userText === '#help' || userText === '#小浣 help') {
    const helpText = getHelpText();
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

  if (userText === '#清空紀錄') {
    const warningText = getBotTextClearWarning_();
    replyToLine(event.replyToken, warningText);
    logAssistantReplyToSheet(event, conversationId, warningText, 'clear_warning');
    return;
  }

  if (userText === '#清空紀錄 確認') {
    const deletedCount = deleteConversationLogs(conversationId);
    clearConversationHistory(conversationId);
    const doneText = getBotTextClearDone_(deletedCount);
    replyToLine(event.replyToken, doneText);
    logAssistantReplyToSheet(event, conversationId, doneText, 'clear_done');
    return;
  }

  if (userText.startsWith('#記錄')) {
    const noteText = userText.replace('#記錄', '').trim();
    const replyText = noteText ? getBotTextNoteSaved_() : getBotTextNoteEmpty_();
    replyToLine(event.replyToken, replyText);
    logAssistantReplyToSheet(event, conversationId, replyText, 'note');
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

  try {
    if (commandInfo.mode === 'summary_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount, false);
      aiReply = recentText
        ? callDeepSeekWithMemory(conversationId, '請根據以下最近對話紀錄進行摘要：\n\n' + recentText, 'summary')
        : getBotTextNoRecentSummaryData_();

    } else if (commandInfo.mode === 'review_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount, false);
      aiReply = recentText
        ? callDeepSeekWithMemory(conversationId, '請根據以下最近對話紀錄，整理出討論回顧、關鍵決策、可延伸話題：\n\n' + recentText, 'review')
        : getBotTextNoRecentReviewData_();

    } else if (commandInfo.mode === 'integrate_topics') {
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
      // v1.10.0：有觸發詞的一般指令若含網址，仍保留舊「快讀摘要」行為。
      // 無觸發詞的群組直接貼網址，才會改進 NewsInbox。
      if (shouldUseWebReading(commandInfo.userPrompt)) {
        const enqueueResult = enqueueWebTask(event, conversationId, commandInfo.userPrompt, TASK_TYPE_WEB_LAZY_SUMMARY);
        aiReply = enqueueResult.ok
          ? buildWebTaskAcceptedText_(TASK_TYPE_WEB_LAZY_SUMMARY, enqueueResult.urls.length)
          : enqueueResult.error || getBotTextNoReadableUrl_();
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
  logAssistantReplyToSheet(event, conversationId, aiReply, commandInfo.mode);
}
