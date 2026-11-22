// ======================================================
// 01_Main.gs
// 用途：Core／LINE transport：公開入口、首次設定、Trigger 安裝與 webhook 事件分流。
//
// 職責與協作：
// 1. doPost() 接收 LINE events；setupLogSheet() 與 Trigger 安裝函式供維護者手動執行。
// 2. 指令解析與 Reply API 交給 02_LineCommands.gs，固定文案交給 03_ResponseTexts.gs。
// 3. 新聞、圖片與清理交由各功能檔處理；模型工作透過 AiService，不在此組 provider payload。
//
// 維護注意：
// 1. Pending Reply 優先交付；群組無 trigger 的一般訊息保持安靜，普通網址走靜默收件。
// 2. 私訊與明確指令保留各自回覆路徑；圖片／網址研究須維持已定義的收件例外。
// 3. 公開入口名稱、二段清理確認及同一 webhook 共用 deadline 都是維護邊界。
// ======================================================

/**
 * 公開管理入口：初始化五張活躍資料表，回傳完成的 Sheet 名稱。
 * 這是維護者可能在 GAS editor 直接執行的函式；名稱與既有 schema 都是相容性邊界，
 * 不新增 AI Log Sheet，也不進行資料 migration。
 */
function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();
  const newsQueueSheet = ensureNewsUrlQueueSheet_();
  const newsInboxSheet = ensureNewsInboxSheet_();
  const pendingReplySheet = ensurePendingRepliesSheet_();

  return [
    'Sheet setup completed:',
    logSheet.getName(),
    weeklySheet.getName(),
    newsQueueSheet.getName(),
    newsInboxSheet.getName(),
    pendingReplySheet.getName()
  ].join(', ');
}

/** 相容入口：移除舊快讀排程，再重建新聞分鐘排程。 */
function installWebTaskQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'processWebTaskQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  return installNewsUrlQueueTrigger();
}

/** 公開管理入口：獨立重建 NewsUrlQueue 的每分鐘排程。 */
function installNewsUrlQueueTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'processNewsUrlQueue') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('processNewsUrlQueue')
    .timeBased()
    .everyMinutes(1)
    .create();

  return 'processNewsUrlQueue trigger installed.';
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
    // 群組仍不回覆；有預算且通過限頻時，當次 webhook 只留下文字語意。
    if (isGroupLike) {
      captureSilentLineImage_(event, conversationId, aiExecutionContext);
      return;
    }
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
  const quoteLookup = createTextQuoteLookup_(conversationId, aiExecutionContext, event.timestamp);
  const textQuote = quotedMessageId === undefined ? { status: 'none' }
    : quotedMessageId === event.message.id ? { status: 'failed', reason: 'self_cycle' } : quoteLookup(quotedMessageId);
  aiExecutionContext.conversationContext = {
    currentUserId: event.source && event.source.userId,
    currentMessageId: isExactLineMessageId_(event.message.id) ? event.message.id : '',
    textQuote: textQuote, quoteLookup: quoteLookup
  };
  // 可信文字先走文字路徑；包括誤用舊「看圖」指令的文字引用，也不下載它。
  if (textQuote.status === 'text_found' && commandInfo.mode === 'image_analysis') commandInfo.mode = 'chat';
  // LINE quote 不附原訊息型別：私訊自然文字可探測圖片；群組只有明確 #小浣 才探測，維持安靜原則。
  // 明確的其他 # 指令仍照原功能執行；沒有 quotedMessageId 就絕不猜上一張圖片。
  const isNaturalQuoteRequest = commandInfo.mode === 'chat' && !!quotedMessageId &&
    !/^#小浣\s+(?:版本(?:紀錄)?|reset)$/.test(userText) && !getHelpTextByCommand_(userText) && (
    sourceType === 'user'
      ? (!hasTriggerPrefix(userText) || userText.startsWith('#小浣'))
      : (isGroupLike && userText.startsWith('#小浣'))
  );
  const isNaturalQuotedImageRequest = textQuote.status !== 'text_found' && isNaturalQuoteRequest;
  const isTextQuoteRequest = textQuote.status === 'text_found' && isNaturalQuoteRequest;
  const isQuotedImageRequest = commandInfo.mode === 'image_analysis' || isNaturalQuotedImageRequest;
  // 只有可觸發回答的自然研究問題才跳過收件；群組非 trigger 網址仍保持原靜默收件。
  const explicitWebSearch = commandInfo.mode === 'chat' && isExplicitWebSearchRequest_(commandInfo.userPrompt);
  const isResearchUrlRequest = commandInfo.mode === 'chat' && (sourceType === 'user' || hasTriggerPrefix(userText)) &&
    shouldUseWebReading(commandInfo.userPrompt) &&
    (explicitWebSearch || /重複|收過|之前|比對|查證|聊過|討論過|封存|重點|內容|讀取|閱讀/.test(commandInfo.userPrompt));
  // 看圖問題也屬圖片輸入；先遮蔽編碼，再交給 Sheet 或 Pending Reply 流程。
  if (isQuotedImageRequest) userText = redactAiMediaText_(userText);

  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'user',
    text: isQuotedImageRequest ? redactAiMediaText_(event.message.text) : String(event.message.text || ''),
    mode: getUserLogMode(userText),
    textQuote: textQuote
  });

  // ======================================================
  // Pending Reply 優先交付
  // ======================================================

  // 沿用任何文字都可交付 pending 的例外；是否追加引用提醒另由當前 request 判斷。
  const pendingDelivery = deliverPendingReply_(conversationId, event.replyToken, function(pendingReply) {
    // 引用／網址研究不趁交付舊結果時轉成新聞收件；保留 Pending Reply 優先交付。
    const enqueueResult = isTextQuoteRequest || isQuotedImageRequest || isResearchUrlRequest || !shouldUseWebReading(userText)
      ? null : handleSilentNewsUrlMessage_(event, conversationId, userText);
    return getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok)) +
      (isTextQuoteRequest ? '\n\n這則引用問題尚未處理，請重新引用再問一次。' :
        isQuotedImageRequest ? (commandInfo.mode === 'image_analysis' ? '\n\n這張圖片尚未分析，請重新回覆圖片再問一次。' : '\n\n這則引用尚未處理，請重新引用再問一次。') :
        isResearchUrlRequest ? '\n\n這個網址問題尚未研究，請再問一次。' : '');
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
          getBotTextAiError_(error),
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
    try { clearConversationHistory(conversationId); }
    catch (error) {
      replyToLine(event.replyToken, getBotTextAiError_(error));
      return;
    }
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

    let cleanupResult;
    try {
      cleanupResult = performDataCleanup_(cleanupInfo.key, conversationId);
    } catch (cleanupError) {
      const failedText = '本次清理未完成，請稍後再試，並用狀態指令確認目前資料。';
      replyToLine(event.replyToken, failedText);
      logAssistantReplyToSheet(event, conversationId, failedText, 'cleanup_failed');
      console.error('DATA_CLEANUP_FAILED');
      return;
    }

    const doneText = getBotTextCleanupDone_(cleanupInfo, cleanupResult);
    replyToLine(event.replyToken, doneText);
    logAssistantReplyToSheet(event, conversationId, doneText, 'cleanup_done');
    return;
  }

  if (userText === '#封存本週新聞') {
    let archiveNewsReply = '';
    try {
      archiveNewsReply = archiveWeeklyNews(event, conversationId, aiExecutionContext);
    } catch (error) {
      console.error('archiveWeeklyNews error:', error && error.stack ? error.stack : error);
      archiveNewsReply = getBotTextNewsArchiveError_(error);
    }

    replyToLine(event.replyToken, archiveNewsReply);
    logAssistantReplyToSheet(event, conversationId, archiveNewsReply, 'archive_weekly_news');
    return;
  }

  if (isNaturalQuotedImageRequest) {
    const imageReplyMetadata = {};
    const naturalImageQuestion = userText.startsWith('#小浣')
      ? userText.replace(/^#小浣\s*/, '').trim()
      : userText;
    const naturalImageReply = analyzeLineImage_(
      event,
      conversationId,
      quotedMessageId,
      naturalImageQuestion,
      aiExecutionContext,
      true,
      imageReplyMetadata
    );
    if (naturalImageReply !== null) {
      replyToLine(event.replyToken, naturalImageReply, false, imageReplyMetadata.finalMessage || '');
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
      const imageReplyMetadata = {};
      aiReply = analyzeLineImage_(event, conversationId, event.message.quotedMessageId, commandInfo.userPrompt, aiExecutionContext, false, imageReplyMetadata);
      aiFinalMessage = imageReplyMetadata.finalMessage || '';

    } else if (commandInfo.mode === 'weekly_news') {
      aiReply = handleWeeklyNewsDigest_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'news_status_report') {
      aiReply = handleNewsStatusReport_(event, conversationId);

    } else if (commandInfo.mode === 'manual_news_supplement') {
      aiReply = handleManualNewsSupplement_(event, conversationId, userText, aiExecutionContext);

    } else if (commandInfo.mode === 'archive_weekly_news') {
      aiReply = archiveWeeklyNews(event, conversationId, aiExecutionContext);

    } else {
      if (shouldUseWebReading(commandInfo.userPrompt) && !isResearchUrlRequest) {
        const directNewsResult = handleDirectNewsUrlMessage_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);
        aiReply = directNewsResult.replyText || getBotTextNoReadableUrl_();
        aiReplyMode = directNewsResult.replyMode || commandInfo.mode;
      } else {
        const generalChatResult = runAiMemoryTask(
          'general_chat',
          conversationId,
          commandInfo.userPrompt,
          commandInfo.userPrompt,
          requireAiCallOptionsForExecutionContext_(aiExecutionContext, { forceWebSearch: explicitWebSearch,
            excludeMessageId: event.message.id, beforeTimestampMs: event.timestamp })
        );
        if (!generalChatResult.ok) {
          const isSearchFailure = generalChatResult.errorType === 'ai_web_search_failed';
          aiReply = generalChatResult.errorType === 'ai_required_evidence_failed' ? getBotTextRequiredEvidenceError_(generalChatResult)
            : isSearchFailure ? getBotTextWebSearchError_(generalChatResult) : getBotTextAiError_(generalChatResult);
          aiReplyMode = isSearchFailure ? 'web_search_error' : 'general_chat_error';
        } else {
          aiReply = generalChatResult.text;
          if (generalChatResult.usedWebSearch || generalChatResult.sources.length) {
            aiFinalMessage = buildWebSearchSourcesBubble_(generalChatResult.sources);
            aiReplyMode = 'general_chat_search';
          }
        }
      }
    }

  } catch (error) {
    console.error('AI call error stack:', error && error.stack ? error.stack : error);
    console.error('AI call error message:', error && error.message ? error.message : String(error));
    aiReply = getBotTextAiError_(error);
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
