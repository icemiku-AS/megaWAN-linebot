// ======================================================
// 01_Main.gs
// 主要入口、首次設定、Trigger 安裝、Webhook 事件主流程。
//
// 小浣 LINE Bot v1.10.3 Highlight & Cleanup Edition
//
// 維護原則：
// 1. 本檔負責 LINE webhook 主流程與高階事件分流。
// 2. 固定文字集中於 12_ResponseTexts.gs。
// 3. 指令解析集中於 02_LineCommands.gs。
// 4. TopicHighlights 與資料維護工具集中於 14_HighlightsCleanup.gs。
// 5. 群組與個人聊天室直接貼網址都走 NewsInbox；明確下 #懶人包 才做快讀摘要。
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

  const pendingReply = getAndDeletePendingReply(conversationId);

  if (pendingReply && pendingReply.text) {
    const enqueueResult = enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText);
    const deliveryText = getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok));

    replyToLine(event.replyToken, deliveryText);
    logAssistantReplyToSheet(event, conversationId, deliveryText, pendingReply.replyMode || 'pending_reply_delivery');
    return;
  }

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

  if (handleBuiltInCommandIfNeeded_(event, conversationId, userText)) {
    return;
  }

  const commandInfo = parseCommand(userText);
  let aiReply = '';

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
        const enqueueResult = enqueueNewsUrlTasks(event, conversationId, commandInfo.userPrompt);
        aiReply = enqueueResult.ok
          ? getBotTextNewsInboxAccepted_(enqueueResult.urls.length)
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
