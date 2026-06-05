// ======================================================
// 01_Main.gs
// 主要入口、首次設定、Trigger 安裝、Webhook 事件主流程。
//
// 小浣 LINE Bot v1.9.2 Humanized System Reply Edition
//
// 維護原則：
// 1. 本檔負責 LINE webhook 主流程與事件分流。
// 2. v1.9.2 起，不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. Google Apps Script 會把同一專案內的 .gs 檔視為同一個全域命名空間。
// 4. 因此函式可跨檔案直接呼叫，但函式名稱不可重複。
// ======================================================

function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();
  const webTaskSheet = ensureWebTaskQueueSheet_();
  const pendingReplySheet = ensurePendingRepliesSheet_();
  const webSummarySheet = ensureWebSummarySheet_();

  return [
    'Sheet setup completed:',
    logSheet.getName(),
    weeklySheet.getName(),
    webTaskSheet.getName(),
    pendingReplySheet.getName(),
    webSummarySheet.getName()
  ].join(', ');
}


function installWebTaskQueueTrigger() {
  const triggers = ScriptApp.getProjectTriggers();

  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'processWebTaskQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('processWebTaskQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  return 'processWebTaskQueue trigger installed.';
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

    // LINE webhook 驗證重點是 HTTP 200。
    // 即使內部錯誤，也盡量回 OK，避免 webhook 被判定失敗。
    return HtmlService.createHtmlOutput('OK');
  }
}


function handleLineEvent(event) {
  if (!event || !event.replyToken) {
    return;
  }

  const sourceType = event.source && event.source.type
    ? event.source.type
    : 'unknown';

  const isGroupLike = sourceType === 'group' || sourceType === 'room';
  const conversationId = getConversationId(event);

  // 只處理文字訊息
  if (event.type !== 'message' || !event.message || event.message.type !== 'text') {
    if (!isGroupLike) {
      replyToLine(event.replyToken, getBotTextUnsupportedMessage_());
    }
    return;
  }

  const userText = String(event.message.text || '').trim();

  if (!userText) {
    return;
  }

  // 所有文字訊息先寫入 ConversationLog
  // v1.7 中，一般貼網址的訊息也會被記錄，方便未來 #統整話題 判斷「你們貼網址時說了什麼」。
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
  // 有 pending reply 時，任何文字訊息都會觸發交付。
  // 如果使用者這次訊息本身也貼了網址，會先把新網址 enqueue，
  // 然後把「舊 pending 交付」與「新網址已收到」合併成同一則回覆。
  // ======================================================

  const pendingReply = getAndDeletePendingReply(conversationId);

  if (pendingReply && pendingReply.text) {
    const enqueueResult = enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText);
    const deliveryText = getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok));

    replyToLine(event.replyToken, deliveryText);
    logAssistantReplyToSheet(
      event,
      conversationId,
      deliveryText,
      pendingReply.replyMode || 'pending_reply_delivery'
    );

    return;
  }

  // ======================================================
  // 群組一般訊息如果沒有觸發詞，但含網址，也會自動進入快讀摘要。
  // ======================================================

  if (isGroupLike && !hasTriggerPrefix(userText)) {
    if (shouldUseWebReading(userText)) {
      const enqueueResult = enqueueWebTask(
        event,
        conversationId,
        userText,
        TASK_TYPE_WEB_LAZY_SUMMARY
      );

      const replyText = enqueueResult.ok
        ? buildWebTaskAcceptedText_(TASK_TYPE_WEB_LAZY_SUMMARY, enqueueResult.urls.length)
        : enqueueResult.error || getBotTextNoReadableUrl_();

      replyToLine(event.replyToken, replyText);
      logAssistantReplyToSheet(event, conversationId, replyText, 'web_lazy_summary_accepted');

      return;
    }

    // 群組裡沒有指令、沒有網址就安靜，只記錄不回覆
    return;
  }

  // #help 指令
  if (userText === '#help' || userText === '#小浣 help') {
    const helpText = getHelpText();

    replyToLine(event.replyToken, helpText);
    logAssistantReplyToSheet(event, conversationId, helpText, 'help');

    return;
  }

  // #版本：回覆目前版本與本版新增功能，不呼叫 LLM。
  if (userText === '#版本' || userText === '#小浣 版本') {
    const versionText = getBotVersionText_();

    replyToLine(event.replyToken, versionText);
    logAssistantReplyToSheet(event, conversationId, versionText, 'version');

    return;
  }

  // #版本紀錄：回覆主要版本更新摘要，不呼叫 LLM。
  if (userText === '#版本紀錄' || userText === '#小浣 版本紀錄') {
    const versionHistoryText = getBotVersionHistoryText_();

    replyToLine(event.replyToken, versionHistoryText);
    logAssistantReplyToSheet(event, conversationId, versionHistoryText, 'version_history');

    return;
  }

  // #reset：只清除短期多輪記憶，不刪 Google Sheet
  if (userText === '#reset' || userText === '#小浣 reset') {
    clearConversationHistory(conversationId);

    const resetText = getBotTextResetDone_();

    replyToLine(event.replyToken, resetText);
    logAssistantReplyToSheet(event, conversationId, resetText, 'reset');

    return;
  }

  // #清空紀錄：先提示，不直接刪除
  if (userText === '#清空紀錄') {
    const warningText = getBotTextClearWarning_();

    replyToLine(event.replyToken, warningText);
    logAssistantReplyToSheet(event, conversationId, warningText, 'clear_warning');

    return;
  }

  // #清空紀錄 確認：刪除目前聊天室 ConversationLog
  if (userText === '#清空紀錄 確認') {
    const deletedCount = deleteConversationLogs(conversationId);
    clearConversationHistory(conversationId);

    const doneText = getBotTextClearDone_(deletedCount);

    replyToLine(event.replyToken, doneText);
    logAssistantReplyToSheet(event, conversationId, doneText, 'clear_done');

    return;
  }

  // #記錄：只做重點標記，不呼叫 AI
  if (userText.startsWith('#記錄')) {
    const noteText = userText.replace('#記錄', '').trim();

    const replyText = noteText
      ? getBotTextNoteSaved_()
      : getBotTextNoteEmpty_();

    replyToLine(event.replyToken, replyText);
    logAssistantReplyToSheet(event, conversationId, replyText, 'note');

    return;
  }

  // #封存本週話題：整理最近對話，寫入 WeeklySummary
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

  // 一般 AI 指令處理
  const commandInfo = parseCommand(userText);

  let aiReply = '';

  try {
    if (commandInfo.mode === 'summary_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount, false);

      if (!recentText) {
        aiReply = getBotTextNoRecentSummaryData_();
      } else {
        aiReply = callDeepSeekWithMemory(
          conversationId,
          '請根據以下最近對話紀錄進行摘要：\n\n' + recentText,
          'summary'
        );
      }

    } else if (commandInfo.mode === 'review_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount, false);

      if (!recentText) {
        aiReply = getBotTextNoRecentReviewData_();
      } else {
        aiReply = callDeepSeekWithMemory(
          conversationId,
          '請根據以下最近對話紀錄，整理出討論回顧、關鍵決策、可延伸話題：\n\n' + recentText,
          'review'
        );
      }

    } else if (commandInfo.mode === 'integrate_topics') {
      aiReply = integrateRecentTopics(event, conversationId, commandInfo.userPrompt);

    } else if (commandInfo.mode === 'program_topic_analysis') {
      const urls = extractUrls(commandInfo.userPrompt);

      if (urls.length > 0) {
        const enqueueResult = enqueueWebTask(
          event,
          conversationId,
          commandInfo.userPrompt,
          TASK_TYPE_PROGRAM_TOPIC_ANALYSIS
        );

        aiReply = enqueueResult.ok
          ? buildWebTaskAcceptedText_(TASK_TYPE_PROGRAM_TOPIC_ANALYSIS, enqueueResult.urls.length)
          : enqueueResult.error || getBotTextNoReadableUrl_();

      } else {
        // 沒貼網址時，讓 LLM 根據最近對話、網址快讀與封存記憶判斷要分析哪個主題。
        aiReply = analyzeProgramTopicFromRecentContext(event, conversationId, commandInfo.userPrompt);
      }

    } else {
      // 任何含網址的一般指令，預設走「快讀摘要」。
      // 只有 #節目話題分析 才走深度分析。
      if (shouldUseWebReading(commandInfo.userPrompt)) {
        const enqueueResult = enqueueWebTask(
          event,
          conversationId,
          commandInfo.userPrompt,
          TASK_TYPE_WEB_LAZY_SUMMARY
        );

        aiReply = enqueueResult.ok
          ? buildWebTaskAcceptedText_(TASK_TYPE_WEB_LAZY_SUMMARY, enqueueResult.urls.length)
          : enqueueResult.error || getBotTextNoReadableUrl_();

      } else {
        aiReply = callDeepSeekWithMemory(
          conversationId,
          commandInfo.userPrompt,
          commandInfo.mode
        );
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
