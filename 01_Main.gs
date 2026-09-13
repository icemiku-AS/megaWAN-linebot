// ======================================================
// 01_Main.gs
// Core／LINE transport：主要入口、首次設定、Trigger 安裝與 Webhook 事件主流程。
//
// 小浣 LINE Bot v1.14.2 Natural Search & Vision Edition
//
// 維護原則：
// 1. 對外入口是 doPost()、setupLogSheet() 與 Trigger 安裝函式；公開 handler 名稱不得因分檔調整而改變。
// 2. 本檔負責 LINE webhook 主流程與事件分流；指令與 Reply API 交給 02_LineCommands.gs。
// 3. 不經過 LLM 的固定回覆與版本資訊集中於 03_ResponseTexts.gs。
// 4. 群組「直接貼網址」走靜默 NewsUrlQueue；個人聊天室與明確指令保留同步回覆，方便維護測試。
// 5. 只有 #懶人包 才走快讀摘要；只有 #節目話題分析 + 網址 才走深度網址分析。
// 6. 資料清理統一交給 50_DataCleanup.gs，所有清理都需二段確認。
// 7. v1.10.9 起，X / Twitter 非單篇 status 網址不入隊；Facebook / Threads 會先交給 Jina Reader。
// 8. v1.12.0 起，群組非 trigger 網址不再回覆 Brief；失敗或不支援網址改由 PendingReplies 回報。
// 9. #新聞問答與 NewsUrlQueue 交給 30_NewsInbox.gs；本檔不擁有新聞資料契約。
// 10. 所有模型工作都交給 provider-neutral AiService；本檔不選 provider、model 或組 payload。
// ======================================================

/**
 * 公開管理入口：建立或補齊既有資料表，回傳完成的 Sheet 名稱。
 * 這是維護者可能在 GAS editor 直接執行的函式；名稱與既有 schema 都是相容性邊界，
 * 不新增 AI Log Sheet，也不進行資料 migration。
 */
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

/**
 * 公開 Trigger 安裝入口：重建既有 WebTaskQueue / NewsUrlQueue 每分鐘排程。
 * 副作用是刪除同名 handler 的舊 trigger 後重建；保留函式名稱避免維護流程失效。
 * Source layout 版本不新增 trigger，也不改變任何 handler 名稱。
 */
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

/**
 * LINE Messaging API webhook 公開入口。
 * 輸入為 LINE post event，固定回傳 OK；事件內錯誤只記安全 log，避免平台重送造成重複寫入。
 * 此名稱由外部 webhook 直接依賴，任何架構重構都不得改名。
 */
function doPost(e) {
  // 同一批 LINE webhook events 是同時送達；必須共用這個 absolute start time，
  // 避免後處理的 event 在前一個 event 已耗時後又重新取得完整同步預算。
  const webhookStartedAtMs = Date.now();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return HtmlService.createHtmlOutput('OK');
    }

    const body = JSON.parse(e.postData.contents);
    const events = body.events || [];

    events.forEach(function(event) {
      handleLineEvent(event, webhookStartedAtMs);
    });

    return HtmlService.createHtmlOutput('OK');

  } catch (error) {
    console.error('doPost error:', error && error.stack ? error.stack : error);
    return HtmlService.createHtmlOutput('OK');
  }
}

/**
 * 單一 LINE event router。負責固定指令、Queue、Reader 與 AI task 分流，並寫入既有對話紀錄。
 * 不直接選 DeepSeek/Gemini；一般聊天使用 general_chat memory task，其餘交給各功能模組。
 * webhookStartedAtMs 由 doPost 對同批 events 共用；省略時會以目前時間 fallback，
 * 保留 GAS 手動診斷及舊測試直接呼叫 handleLineEvent(event) 的相容性。
 */
function handleLineEvent(event, webhookStartedAtMs) {
  if (!event || !event.replyToken) {
    return;
  }

  // 同一個 webhook payload 的 Reader 與所有 events／AI call 共用 absolute deadline；
  // 功能層只收到 provider-neutral context，
  // 不接觸 DeepSeek/Gemini payload。背景 Queue 不會經過此入口，因此仍使用完整 profile timeout。
  const aiExecutionContext = createLineWebhookExecutionContext_(webhookStartedAtMs);

  const sourceType = event.source && event.source.type ? event.source.type : 'unknown';
  const isGroupLike = sourceType === 'group' || sourceType === 'room';
  const conversationId = getConversationId(event);

  if (event.type === 'message' && event.message && event.message.type === 'image') {
    // 群組貼圖完全靜默；需另用原生引用 + #小浣 觸發，無需保存圖片或建立配對狀態。
    if (sourceType !== 'user') return;
    const imageSet = event.message.imageSet;
    // ponytail: 私訊一次多圖只看第一張；需要跨圖分析時再擴充 request contract。
    if (imageSet && Number.isInteger(imageSet.index) && imageSet.index > 1) return;
    const pendingImageDelivery = deliverPendingReply_(conversationId, event.replyToken, function(pendingReply) {
      return getBotTextPendingDelivery_(pendingReply.text, false) + '\n\n這張圖片尚未分析，請再傳一次。';
    });
    if (pendingImageDelivery) {
      logAssistantReplyToSheet(event, conversationId, pendingImageDelivery.text, pendingImageDelivery.replyMode || 'pending_reply_delivery');
      return;
    }
    // 舊版 LINE 可能只提供 imageSet.id，不能把每張都誤當第一張。
    const imageReply = imageSet && imageSet.index !== 1 ? getBotTextImageError_('image_album_unknown_index')
      : analyzeLineImage_(event, conversationId, event.message.id, '', aiExecutionContext) +
        (imageSet && Number(imageSet.total) > 1 ? '\n\n這次只分析多圖中的第一張；其他圖片請分次傳送。' : '');
    replyToLine(event.replyToken, imageReply);
    logAssistantReplyToSheet(event, conversationId, imageReply, 'image_analysis');
    return;
  }

  if (event.type !== 'message' || !event.message || event.message.type !== 'text') {
    if (!isGroupLike) {
      replyToLine(event.replyToken, getBotTextUnsupportedMessage_());
    }
    return;
  }

  let userText = String(event.message.text || '').trim();
  if (!userText) return;

  const commandInfo = parseCommand(userText);
  const quotedMessageId = event.message.quotedMessageId;
  // LINE quote 不附原訊息型別：私訊自然文字可探測圖片；群組只有明確 #小浣 才探測，維持安靜原則。
  // 明確的其他 # 指令仍照原功能執行；沒有 quotedMessageId 就絕不猜上一張圖片。
  const isNaturalQuotedImageRequest = commandInfo.mode === 'chat' && !!quotedMessageId &&
    !/^#小浣\s+(?:版本(?:紀錄)?|reset)$/.test(userText) && (
    sourceType === 'user'
      ? (!hasTriggerPrefix(userText) || userText.startsWith('#小浣'))
      : (isGroupLike && userText.startsWith('#小浣'))
  );
  const isQuotedImageRequest = commandInfo.mode === 'image_analysis' || isNaturalQuotedImageRequest;
  // 看圖問題也屬圖片輸入；先遮蔽編碼，再交給 Sheet 或 Pending Reply 流程。
  if (isQuotedImageRequest) userText = redactAiMediaText_(userText);

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

  const pendingDelivery = deliverPendingReply_(conversationId, event.replyToken, function(pendingReply) {
    // 看圖問題中的網址不是新聞收件；交付舊結果後請使用者重送圖片問題。
    const enqueueResult = isQuotedImageRequest ? null
      : enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText);
    return getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok)) +
      (isQuotedImageRequest ? '\n\n這張圖片尚未分析，請重新回覆圖片再問一次。' : '');
  });

  if (pendingDelivery) {
    logAssistantReplyToSheet(event, conversationId, pendingDelivery.text, pendingDelivery.replyMode || 'pending_reply_delivery');
    return;
  }

  // ======================================================
  // 群組一般訊息：沒有觸發詞但含網址 → 靜默進 NewsUrlQueue
  // ======================================================

  if (isGroupLike && !hasTriggerPrefix(userText)) {
    if (shouldUseWebReading(userText)) {
      try {
        handleSilentNewsUrlMessage_(event, conversationId, userText);
      } catch (error) {
        console.error('Direct group news URL error:', error && error.stack ? error.stack : error);
        createPendingReplyForNewsUrlIntake_(
          event,
          conversationId,
          getBotTextAiError_(),
          'news_url_intake_error'
        );
      }
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
      archiveReply = archiveWeeklyTopics(event, conversationId, aiExecutionContext);
    } catch (error) {
      console.error('archiveWeeklyTopics error:', error && error.stack ? error.stack : error);
      archiveReply = getBotTextArchiveError_();
    }

    replyToLine(event.replyToken, archiveReply);
    logAssistantReplyToSheet(event, conversationId, archiveReply, 'archive_weekly');
    return;
  }

  if (userText === '#封存本週新聞') {
    let archiveNewsReply = '';
    try {
      archiveNewsReply = archiveWeeklyNews(event, conversationId, aiExecutionContext);
    } catch (error) {
      console.error('archiveWeeklyNews error:', error && error.stack ? error.stack : error);
      archiveNewsReply = getBotTextNewsArchiveError_();
    }

    replyToLine(event.replyToken, archiveNewsReply);
    logAssistantReplyToSheet(event, conversationId, archiveNewsReply, 'archive_weekly_news');
    return;
  }

  if (isNaturalQuotedImageRequest) {
    const naturalImageQuestion = userText.startsWith('#小浣')
      ? userText.replace(/^#小浣\s*/, '').trim()
      : userText;
    const naturalImageReply = analyzeLineImage_(
      event,
      conversationId,
      quotedMessageId,
      naturalImageQuestion,
      aiExecutionContext,
      true
    );
    if (naturalImageReply !== null) {
      replyToLine(event.replyToken, naturalImageReply);
      logAssistantReplyToSheet(event, conversationId, naturalImageReply, 'image_analysis');
      return;
    }
  }

  let aiReply = '';
  let aiReplyMode = commandInfo.mode;
  let aiFinalMessage = '';

  try {
    if (commandInfo.mode === 'image_analysis') {
      // ID 只取 LINE 原生 quotedMessageId，不接受使用者輸入任意 message ID 或圖片網址。
      aiReply = analyzeLineImage_(event, conversationId, event.message.quotedMessageId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'integrate_topics') {
      aiReply = integrateRecentTopics(event, conversationId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'weekly_news') {
      aiReply = handleWeeklyNewsDigest_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'news_question') {
      aiReply = handleNewsQuestion_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'news_status_report') {
      aiReply = handleNewsStatusReport_(event, conversationId);

    } else if (commandInfo.mode === 'manual_news_supplement') {
      aiReply = handleManualNewsSupplement_(event, conversationId, userText, aiExecutionContext);

    } else if (commandInfo.mode === 'archive_weekly_news') {
      aiReply = archiveWeeklyNews(event, conversationId, aiExecutionContext);

    } else if (commandInfo.mode === 'program_topic_analysis') {
      const urls = extractUrls(commandInfo.userPrompt);
      if (urls.length > 0) {
        const enqueueResult = enqueueWebTask(event, conversationId, commandInfo.userPrompt, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
        aiReply = enqueueResult.ok
          ? buildWebTaskAcceptedText_(TASK_TYPE_PROGRAM_TOPIC_ANALYSIS, enqueueResult.urls.length)
          : enqueueResult.error || getBotTextNoReadableUrl_();
      } else {
        aiReply = analyzeProgramTopicFromRecentContext(event, conversationId, commandInfo.userPrompt, aiExecutionContext);
      }

    } else if (commandInfo.mode === 'web_read') {
      const enqueueResult = enqueueWebTask(event, conversationId, commandInfo.userPrompt, TASK_TYPE_WEB_LAZY_SUMMARY);
      aiReply = enqueueResult.ok
        ? buildWebTaskAcceptedText_(TASK_TYPE_WEB_LAZY_SUMMARY, enqueueResult.urls.length)
        : enqueueResult.error || getBotTextNoReadableUrl_();

    } else {
      if (shouldUseWebReading(commandInfo.userPrompt)) {
        const directNewsResult = handleDirectNewsUrlMessage_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);
        aiReply = directNewsResult.replyText || getBotTextNoReadableUrl_();
        aiReplyMode = directNewsResult.replyMode || commandInfo.mode;
      } else {
        const explicitWebSearch = isExplicitWebSearchRequest_(commandInfo.userPrompt);
        const generalChatResult = runAiMemoryTask(
          'general_chat',
          conversationId,
          commandInfo.userPrompt,
          commandInfo.userPrompt,
          requireAiCallOptionsForExecutionContext_(aiExecutionContext, { forceWebSearch: explicitWebSearch })
        );
        if (!generalChatResult.ok) {
          const isSearchFailure = explicitWebSearch || generalChatResult.errorType === 'ai_web_search_failed';
          aiReply = isSearchFailure ? getBotTextWebSearchError_(generalChatResult.errorType) : getBotTextAiError_();
          aiReplyMode = isSearchFailure ? 'web_search_error' : 'general_chat_error';
        } else {
          aiReply = generalChatResult.text;
          if (generalChatResult.usedWebSearch) {
            aiFinalMessage = buildWebSearchSourcesBubble_(generalChatResult.sources);
            aiReplyMode = 'general_chat_search';
          }
        }
      }
    }

  } catch (error) {
    console.error('AI call error stack:', error && error.stack ? error.stack : error);
    console.error('AI call error message:', error && error.message ? error.message : String(error));
    aiReply = getBotTextAiError_();
  }

  replyToLine(event.replyToken, aiReply, false, aiFinalMessage);
  logAssistantReplyToSheet(event, conversationId, aiReply, aiReplyMode);
}

/**
 * 建立單一 LINE webhook payload 共用的同步執行預算。
 * doPost 傳入整批 events 的共同起點；沒有合法起點時才使用目前時間，保留舊 direct call。
 * deadline 防止後續 event、Reader 或第二次 AI call 各自重新取得完整 cap。
 */
function createLineWebhookExecutionContext_(startedAtMs) {
  const safeStartedAtMs = Number(startedAtMs);
  const baseTime = isFinite(safeStartedAtMs) && safeStartedAtMs > 0 ? safeStartedAtMs : Date.now();
  return {
    deadlineAtMs: baseTime + LINE_WEBHOOK_SYNC_WORK_BUDGET_MS,
    aiTimeoutCapSeconds: LINE_WEBHOOK_SYNC_AI_TIMEOUT_CAP_SECONDS,
    aiMinimumRequestSeconds: LINE_WEBHOOK_SYNC_AI_MIN_REQUEST_SECONDS,
    readerTimeoutCapSeconds: LINE_WEBHOOK_SYNC_READER_TIMEOUT_CAP_SECONDS
  };
}
