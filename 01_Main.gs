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
// 1. Pending Reply 優先交付；群組普通網址先靜默收件，再視情況點評。
// 2. 私訊與明確指令保留各自回覆路徑；圖片／網址研究須維持已定義的收件例外。
// 3. 公開入口名稱、二段清理確認及同一 webhook 共用 deadline 都是維護邊界。
// ======================================================

/**
 * 公開管理入口：初始化活躍資料表，回傳完成的 Sheet 名稱。
 * 這是維護者可能在 GAS editor 直接執行的函式；名稱與既有 schema 都是相容性邊界，
 * 不新增 AI Log Sheet，也不進行資料 migration。
 */
function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();
  const newsQueueSheet = ensureNewsUrlQueueSheet_();
  const newsInboxSheet = ensureNewsInboxSheet_();
  const pendingReplySheet = ensurePendingRepliesSheet_();
  const memberMemory = withDataMutationLock_(function() {
    const sheet = ensureMemberMemorySheet_();
    SpreadsheetApp.flush();
    return { name: sheet.getName() };
  });
  if (!memberMemory.name) throw createAiExecutionBudgetError_('Member memory sheet setup is busy.');

  return [
    'Sheet setup completed:',
    logSheet.getName(),
    weeklySheet.getName(),
    newsQueueSheet.getName(),
    newsInboxSheet.getName(),
    pendingReplySheet.getName(),
    memberMemory.name
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

    let dailyStateDeadline = 0;
    events.forEach(function(event) {
      try { dailyStateDeadline = handleLineEvent(event, webhookStartedAtMs, true) || dailyStateDeadline; }
      catch (ignore) { console.error('LINE_EVENT_FAILED'); }
    });
    // 先交付整批事件，再用剩餘預算準備角色日常，避免第一則的輔助呼叫延誤後面的主回覆。
    if (dailyStateDeadline) maybeGenerateBotDailyState_(dailyStateDeadline);

    return HtmlService.createHtmlOutput('OK');

  } catch (error) {
    console.error('LINE_WEBHOOK_FAILED');
    return HtmlService.createHtmlOutput('OK');
  }
}

/**
 * 單一 LINE event router。負責固定指令、Queue、Reader 與 AI task 分流，並寫入既有對話紀錄。
 * 不直接選 DeepSeek/Gemini；一般聊天使用 general_chat memory task，其餘交給各功能模組。
 * webhookStartedAtMs 由 doPost 對同批 events 共用；省略時會以目前時間 fallback，
 * 保留 GAS 手動診斷及舊測試直接呼叫 handleLineEvent(event) 的相容性。
 */
function handleLineEvent(event, webhookStartedAtMs, fromWebhook) {
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
  const chatKey = getLineChatStateKey_(conversationId);
  // 只有舊的本機診斷入口可省略事件 ID。正式 webhook 的登記失敗一律停止。
  if (fromWebhook || event.webhookEventId !== undefined) {
    const eventClaim = claimLineWebhookEvent_(chatKey, event.webhookEventId);
    if (eventClaim !== 'accepted') {
      if (eventClaim !== 'duplicate') console.warn('LINE_EVENT_NOT_CLAIMED');
      return;
    }
  }
  const before = Number(event.timestamp) || Date.now();
  const turnContext = {
    currentUserId: event.source && event.source.userId,
    currentMessageId: event.message && isExactLineMessageId_(event.message.id) ? event.message.id : '',
    beforeTimestampMs: before, lineChatKey: chatKey, lineChatState: readLineChatState_(chatKey),
    onMemoryTurn: function(commit) { turnContext.commitMemory = commit; }
  };
  aiExecutionContext.conversationContext = turnContext;

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
    const pendingReceipt = {};
    const pendingImageDelivery = deliverPendingReply_(conversationId, event.replyToken, function(pendingReply) {
      return getBotTextPendingDelivery_(pendingReply.text, false) + '\n\n這張圖片尚未分析，請再傳一次。';
    }, pendingReceipt);
    if (pendingImageDelivery) {
      logAssistantReplyToSheet(event, conversationId, pendingImageDelivery.text, pendingImageDelivery.replyMode || 'pending_reply_delivery', pendingReceipt);
      rememberLineReply_(chatKey, turnContext.lineChatState, event, pendingReceipt, false);
      return;
    }
    if (pendingReceipt.busy) return;
    const reserved = reserveLineAutoReply_(chatKey, turnContext.lineChatState, aiExecutionContext.deadlineAtMs, before, 'explicit');
    if (!reserved.id) return;
    try {
      // 舊版 LINE 可能只提供 imageSet.id，不能把每張都誤當第一張。
      const imageMetadata = {};
      const imageReply = imageSet && imageSet.index !== 1 ? getBotTextImageError_('image_album_unknown_index')
        : analyzeLineImage_(event, conversationId, event.message.id, '', aiExecutionContext, false, imageMetadata) +
          (imageSet && Number(imageSet.total) > 1 ? '\n\n這次只分析多圖中的第一張；其他圖片請分次傳送。' : '');
      sendLineReplyWithLog_(event, conversationId, turnContext, {
        text: imageReply, mode: 'image_analysis', followUp: imageMetadata.ok, leaseId: reserved.id
      });
    } finally {
      finishLineAutoReply_(chatKey, reserved.id);
    }
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
  const directCall = userText.includes('#小浣') || isLineBotMention_(event.message);
  const canRunFixedCommands = sourceType === 'user' || hasTriggerPrefix(userText);
  const helpText = canRunFixedCommands && getHelpTextByCommand_(userText);
  const cleanupInfo = canRunFixedCommands && getCleanupCommandInfo_(userText);
  const quotedMessageId = event.message.quotedMessageId;
  const quoteLookup = createTextQuoteLookup_(conversationId, aiExecutionContext, before);
  let textQuote = quotedMessageId === undefined ? { status: 'none' }
    : quotedMessageId === event.message.id ? { status: 'failed', reason: 'self_cycle' } : quoteLookup(quotedMessageId);
  const recentReplies = turnContext.lineChatState && turnContext.lineChatState.replies;
  const confirmedTarget = isExactLineMessageId_(quotedMessageId) && Array.isArray(recentReplies) &&
    recentReplies.find(function(reply) { return reply.at <= before && reply.ids.includes(quotedMessageId); });
  if (textQuote.status !== 'text_found' && textQuote.reason !== 'assistant_message' && confirmedTarget) {
    textQuote = { status: 'unsupported', reason: 'assistant_message', messageId: quotedMessageId, sentAtMs: confirmedTarget.at };
  }
  turnContext.textQuote = textQuote;
  turnContext.quoteLookup = quoteLookup;
  const quotesBot = isLineQuoteOfDeliveredBot_(event, turnContext.lineChatState, textQuote, before);
  const quoteFastLane = quotesBot && !isLineChatClosingNoise_(userText);
  const playfulFastLane = isGroupLike && commandInfo.mode === 'chat' && isDirectLinePlayfulRequest_(userText);
  const memberRequest = commandInfo.mode === 'chat' && !helpText && !cleanupInfo
    ? getLineMemberMemoryRequest_(event.message.text, event.message, sourceType === 'user' || directCall || quoteFastLane) : null;
  turnContext.memberMemoryRequest = memberRequest;
  // 可信文字先走文字路徑；包括誤用舊「看圖」指令的文字引用，也不下載它。
  const quoteIsText = textQuote.status === 'text_found' || textQuote.reason === 'assistant_message';
  if (quoteIsText && commandInfo.mode === 'image_analysis') commandInfo.mode = 'chat';
  // LINE quote 不附原訊息型別。只有私訊或明確點名才探測未知引用的圖片。
  // 明確的其他 # 指令仍照原功能執行；沒有 quotedMessageId 就絕不猜上一張圖片。
  const isNaturalQuoteRequest = commandInfo.mode === 'chat' && !!quotedMessageId &&
    !/^#小浣\s+(?:版本(?:紀錄)?|reset)$/.test(userText) && !helpText && !cleanupInfo && (
    sourceType === 'user'
      ? (!hasTriggerPrefix(userText) || userText.startsWith('#小浣'))
      : (isGroupLike && directCall)
  );
  const isNaturalQuotedImageRequest = !memberRequest && !quoteIsText && isNaturalQuoteRequest;
  const isTextQuoteRequest = !memberRequest && quoteIsText && (isNaturalQuoteRequest || quoteFastLane);
  const isQuotedImageRequest = commandInfo.mode === 'image_analysis' || isNaturalQuotedImageRequest;
  let asksForNote = !memberRequest && commandInfo.mode === 'chat' && isWeeklyNoteRequest_(commandInfo.userPrompt);
  if (!memberRequest && !asksForNote && commandInfo.mode === 'chat' && hasWeeklyNoteAction_(commandInfo.userPrompt)) {
    loadLineAmbientContext_(conversationId, aiExecutionContext);
    asksForNote = isWeeklyNoteRequest_(commandInfo.userPrompt, turnContext);
  }
  turnContext.weeklyNoteRequested = asksForNote;
  turnContext.weeklyNoteResearch = asksForNote ? getWeeklyNoteResearchIntent_(commandInfo.userPrompt) : null;
  const isResearchUrlRequest = commandInfo.mode === 'chat' && (memberRequest ? isLineUrlResearchRequest_(memberRequest.question, true)
    : asksForNote ? turnContext.weeklyNoteResearch.url
    : isLineUrlResearchRequest_(commandInfo.userPrompt, sourceType === 'user' || directCall || quoteFastLane || playfulFastLane));
  // 看圖問題也屬圖片輸入；先遮蔽編碼，再交給 Sheet 或 Pending Reply 流程。
  if (isQuotedImageRequest) {
    userText = redactAiMediaText_(userText);
    commandInfo.userPrompt = redactAiMediaText_(commandInfo.userPrompt);
  }

  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'user',
    text: memberRequest ? '[個人記憶操作]' : isQuotedImageRequest ? redactAiMediaText_(event.message.text) : String(event.message.text || ''),
    mode: memberRequest ? 'member_memory_command' : getUserLogMode(userText),
    textQuote: textQuote
  });

  // ======================================================
  // Pending Reply 優先交付
  // ======================================================

  // 沿用任何文字都可交付 pending 的例外；是否追加引用提醒另由當前 request 判斷。
  const pendingReceipt = {};
  const pendingHot = isGroupLike && getLineHotChat_(turnContext.lineChatState, before, Date.now());
  const pendingChain = pendingHot ? pendingHot.chain : 0;
  const pendingDelivery = deliverPendingReply_(conversationId, event.replyToken, function(pendingReply) {
    // 引用／網址研究不趁交付舊結果時轉成新聞收件；保留 Pending Reply 優先交付。
    const enqueueResult = isTextQuoteRequest || isQuotedImageRequest || isResearchUrlRequest || asksForNote || memberRequest || !shouldUseWebReading(userText)
      ? null : handleSilentNewsUrlMessage_(event, conversationId, userText);
    return getBotTextPendingDelivery_(pendingReply.text, !!(enqueueResult && enqueueResult.ok)) +
      (isTextQuoteRequest ? '\n\n這則引用問題尚未處理，請重新引用再問一次。' :
        isQuotedImageRequest ? (commandInfo.mode === 'image_analysis' ? '\n\n這張圖片尚未分析，請重新回覆圖片再問一次。' : '\n\n這則引用尚未處理，請重新引用再問一次。') :
        isResearchUrlRequest ? '\n\n這個網址問題尚未研究，請再問一次。' :
        memberRequest ? '\n\n這則個人記憶指令尚未處理，請再叫我一次。' :
        asksForNote && (directCall || sourceType === 'user' || quoteFastLane) ? '\n\n這筆註記尚未處理，請再叫我一次。' : '');
  }, pendingReceipt);

  if (pendingDelivery) {
    logAssistantReplyToSheet(event, conversationId, pendingDelivery.text, pendingDelivery.replyMode || 'pending_reply_delivery', pendingReceipt);
    rememberLineReply_(chatKey, turnContext.lineChatState, event, pendingReceipt, false);
    if (isGroupLike && commandInfo.mode === 'chat') logLineChatWakeStatus_('skipped_pending_delivery', null, pendingChain);
    return;
  }

  // ======================================================
  // 群組一般訊息：沒有觸發詞但含網址 → 靜默進 NewsUrlQueue
  // ======================================================

  if (isGroupLike && !canRunFixedCommands && !directCall) {
    if (shouldUseWebReading(userText) && !isResearchUrlRequest && !asksForNote && !memberRequest && !quoteFastLane) {
      let intake;
      try {
        intake = handleSilentNewsUrlMessage_(event, conversationId, userText);
      } catch (error) {
        console.error('DIRECT_GROUP_URL_FAILED');
        createPendingReplyForNewsUrlIntake_(
          event,
          conversationId,
          getBotTextAiError_(error),
          'news_url_intake_error'
        );
      }
      const commented = intake && intake.ok && intake.queued && !pendingReceipt.busy &&
        handleLineNewsUrlComment_(event, conversationId, userText, intake, aiExecutionContext);
      logLineChatWakeStatus_(commented ? 'news_url_comment' : 'skipped_url_intake', null, commented ? 0 : pendingChain);
      return;
    }

    if (pendingReceipt.busy) return logLineChatWakeStatus_('skipped_pending_busy', null, pendingChain);
    const fastOutcome = quoteFastLane ? 'quote_fast_lane' : memberRequest ? 'member_memory_fast_lane' :
      playfulFastLane ? 'playful_fast_lane' : '';
    const deliveredChat = handleGatedLineChat_(event, conversationId, commandInfo.userPrompt, aiExecutionContext, fastOutcome);
    return finishLineDailyState_(deliveredChat, aiExecutionContext.deadlineAtMs, fromWebhook);
  }

  // 資料控制指令可作廢正在執行的舊回合，不等待舊回合完成。
  if (userText === '#reset' || userText === '#小浣 reset') {
    try { clearConversationHistory(conversationId); }
    catch (error) {
      replyToLine(event.replyToken, getBotTextAiError_(error));
      return;
    }
    const resetText = getBotTextResetDone_();
    sendLineReplyWithLog_(event, conversationId, turnContext, { text: resetText, mode: 'reset' });
    return;
  }

  if (cleanupInfo) {
    if (!cleanupInfo.isConfirm) {
      const warningText = getBotTextCleanupWarning_(cleanupInfo);
      sendLineReplyWithLog_(event, conversationId, turnContext, { text: warningText, mode: 'cleanup_warning' });
      return;
    }

    let cleanupResult;
    try {
      cleanupResult = performDataCleanup_(cleanupInfo.key, conversationId);
    } catch (cleanupError) {
      const failedText = '本次清理未完成，請稍後再試，並用狀態指令確認目前資料。';
      sendLineReplyWithLog_(event, conversationId, turnContext, { text: failedText, mode: 'cleanup_failed' });
      console.error('DATA_CLEANUP_FAILED');
      return;
    }

    const doneText = getBotTextCleanupDone_(cleanupInfo, cleanupResult);
    sendLineReplyWithLog_(event, conversationId, turnContext, { text: doneText, mode: 'cleanup_done' });
    return;
  }

  let fixedReply;
  if (helpText) fixedReply = { text: helpText, mode: 'help' };
  else if (userText === '#版本' || userText === '#小浣 版本') fixedReply = { text: getBotVersionText_(), mode: 'version' };
  else if (userText === '#版本紀錄' || userText === '#小浣 版本紀錄') {
    fixedReply = { text: getBotVersionHistoryText_(), mode: 'version_history' };
  }
  const reportsWake = isGroupLike && commandInfo.mode === 'chat' && !fixedReply;
  const route = { userText: userText, isNaturalQuotedImageRequest: isNaturalQuotedImageRequest,
    isTextQuoteRequest: isTextQuoteRequest, isResearchUrlRequest: isResearchUrlRequest };
  // 固定指令與明示聊天共用同房資格，均不受一般自動接話間隔限制。
  if (pendingReceipt.busy) {
    if (reportsWake) logLineChatWakeStatus_('skipped_pending_busy', null, pendingChain);
    return;
  }
  const reserved = reserveLineAutoReply_(chatKey, turnContext.lineChatState, aiExecutionContext.deadlineAtMs, before, 'explicit');
  if (!reserved.id) {
    if (reportsWake) logLineChatWakeStatus_(reserved.outcome, null, pendingChain);
    return;
  }
  let deliveredChat;
  try {
    if (fixedReply) {
      fixedReply.leaseId = reserved.id;
      sendLineReplyWithLog_(event, conversationId, turnContext, fixedReply);
    } else {
      deliveredChat = handleRequestedLineReply_(event, conversationId, commandInfo, aiExecutionContext, route, reserved.id);
      if (reportsWake) logLineChatWakeStatus_('explicit_fast_lane', { triggerType: 'direct_call' });
    }
  } finally {
    finishLineAutoReply_(chatKey, reserved.id);
  }
  return finishLineDailyState_(deliveredChat, aiExecutionContext.deadlineAtMs, fromWebhook);
}

function finishLineDailyState_(deliveredChat, deadline, fromWebhook) {
  if (!deliveredChat) return;
  if (fromWebhook) return deadline;
  maybeGenerateBotDailyState_(deadline);
}

function handleRequestedLineReply_(event, conversationId, commandInfo, aiExecutionContext, route, lease) {
  const turnContext = aiExecutionContext.conversationContext;
  const userText = route.userText;
  const asksForNote = turnContext.weeklyNoteRequested;
  if (route.isNaturalQuotedImageRequest && !asksForNote && !turnContext.memberMemoryRequest) {
    const imageReplyMetadata = {};
    const naturalImageQuestion = userText.startsWith('#小浣')
      ? userText.replace(/^#小浣\s*/, '').trim()
      : userText;
    const naturalImageReply = analyzeLineImage_(
      event,
      conversationId,
      event.message.quotedMessageId,
      naturalImageQuestion,
      aiExecutionContext,
      true,
      imageReplyMetadata
    );
    if (naturalImageReply !== null) {
      sendLineReplyWithLog_(event, conversationId, turnContext, { text: naturalImageReply, mode: 'image_analysis',
        finalMessage: imageReplyMetadata.finalMessage, followUp: imageReplyMetadata.ok, leaseId: lease });
      return;
    }
  }

  let aiReply = '';
  let aiReplyMode = commandInfo.mode;
  let aiFinalMessage = '';
  let imageSuccess = false;
  let chatReply = null;

  try {
    if (commandInfo.mode === 'image_analysis') {
      // ID 只取 LINE 原生 quotedMessageId，不接受使用者輸入任意 message ID 或圖片網址。
      const imageReplyMetadata = {};
      aiReply = analyzeLineImage_(event, conversationId, event.message.quotedMessageId, commandInfo.userPrompt, aiExecutionContext, false, imageReplyMetadata);
      aiFinalMessage = imageReplyMetadata.finalMessage || '';
      imageSuccess = imageReplyMetadata.ok;

    } else if (commandInfo.mode === 'weekly_news') {
      aiReply = handleWeeklyNewsDigest_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);

    } else if (commandInfo.mode === 'news_status_report') {
      aiReply = handleNewsStatusReport_(event, conversationId);

    } else if (commandInfo.mode === 'manual_news_supplement') {
      aiReply = handleManualNewsSupplement_(event, conversationId, userText, aiExecutionContext);

    } else if (commandInfo.mode === 'archive_weekly_news') {
      aiReply = archiveWeeklyNews(event, conversationId, aiExecutionContext);

    } else {
      if (shouldUseWebReading(commandInfo.userPrompt) && !route.isResearchUrlRequest && !asksForNote &&
          !route.isTextQuoteRequest && !turnContext.memberMemoryRequest) {
        const directNewsResult = handleDirectNewsUrlMessage_(event, conversationId, commandInfo.userPrompt, aiExecutionContext);
        aiReply = directNewsResult.replyText || getBotTextNoReadableUrl_();
        aiReplyMode = directNewsResult.replyMode || commandInfo.mode;
      } else {
        chatReply = buildLineChatReply_(event, conversationId, commandInfo.userPrompt, aiExecutionContext, null, lease);
      }
    }

  } catch (error) {
    console.error('LINE_CHAT_FAILED');
    aiReply = commandInfo.mode === 'archive_weekly_news' ? getBotTextNewsArchiveError_(error) : getBotTextAiError_(error);
  }

  const reply = chatReply || { text: aiReply, mode: aiReplyMode, finalMessage: aiFinalMessage, followUp: imageSuccess };
  reply.leaseId = lease;
  const sent = sendLineReplyWithLog_(event, conversationId, turnContext, reply);
  return sent && chatReply && chatReply.mode === 'chat';
}

function loadLineAmbientContext_(conversationId, executionContext) {
  const context = executionContext.conversationContext;
  if (!context.ambientContext) context.ambientContext = context.lineChatState ? getRecentAmbientConversationContext_(conversationId, {
    beforeTimestampMs: context.beforeTimestampMs, excludeMessageId: context.currentMessageId,
    resetAtMs: context.lineChatState.resetAtMs, deadlineAtMs: executionContext.deadlineAtMs, quoteLookup: context.quoteLookup
  }) : [];
  return context.ambientContext;
}

function handleLineNewsUrlComment_(event, conversationId, text, intake, executionContext) {
  if (!ENABLE_NEWS_URL_COMMENT || intake.urls.length !== 1 || intake.skippedUnsupportedUrls.length ||
      extractUrls(text).length !== 1 || !isSafePublicUrl(intake.urls[0])) return false;

  const context = executionContext.conversationContext;
  const key = context.lineChatKey;
  const deadline = Math.min(executionContext.deadlineAtMs, Date.now() + NEWS_COMMENT_TOTAL_BUDGET_MS);
  const aiDeadline = deadline - LINE_REPLY_TIMEOUT_SECONDS * 1000;
  const readerDeadline = Math.min(aiDeadline - executionContext.aiMinimumRequestSeconds * 1000,
    Date.now() + NEWS_COMMENT_READER_TIMEOUT_CAP_SECONDS * 1000);
  if (readerDeadline - Date.now() < 1000) return false;
  const lease = reserveLineAutoReply_(key, context.lineChatState, deadline, context.beforeTimestampMs, 'news_url_comment').id;
  if (!lease) return false;

  try {
    const caption = stripUrlsForWeeklyEditorial_(text.replace(/(https?)[:：][/／]{2}/gi, '$1://'));
    const web = fetchAndExtractWebPageByReaderLayer_(intake.urls[0], {
      deadlineAtMs: readerDeadline, readerTimeoutCapSeconds: NEWS_COMMENT_READER_TIMEOUT_CAP_SECONDS,
      noAi: true, allowTitleOnly: true
    });
    // 逾時結果不進主模型，其他讀取失敗仍可使用貼文者提供的附言。
    if (Date.now() >= readerDeadline || web && !web.ok && (
      /(?:budget_exhausted|fetch_exception|timeout)$/.test(web.errorType || '') || [408, 504].includes(web.httpStatus)
    )) return false;
    const answer = getLineShortBanterText_(runAiNewsUrlComment_(caption, web, {
      deadlineAtMs: aiDeadline, aiTimeoutCapSeconds: executionContext.aiTimeoutCapSeconds,
      aiMinimumRequestSeconds: executionContext.aiMinimumRequestSeconds
    }));
    if (!answer || Date.now() >= aiDeadline) return false;
    // Reader 或模型執行期間，背景任務可能剛完成一筆待回覆。
    const pendingSheet = getSpreadsheet_().getSheetByName(PENDING_REPLIES_SHEET_NAME);
    if (pendingSheet && findPendingReply_(pendingSheet, conversationId)) return false;
    if (!authorizeLineAutoReply_(key, lease, aiDeadline, 'news_url_comment') || Date.now() >= aiDeadline) return false;
    return sendLineReplyWithLog_(event, conversationId, context, {
      text: answer, mode: 'news_url_comment', followUp: true, leaseId: lease, triggerType: 'news_url_comment'
    });
  } catch (ignore) {
    // 收件已完成，點評失敗不產生新的待回覆。
    return false;
  } finally {
    finishLineAutoReply_(key, lease);
  }
}

function handleGatedLineChat_(event, conversationId, text, executionContext, fastOutcome) {
  const context = executionContext.conversationContext;
  const key = context.lineChatKey;
  const signals = getLineChatWakeSignals_(event, key, context.lineChatState, text, context.textQuote, context.weeklyNoteRequested);
  const chain = signals.followUpChain;
  if (!fastOutcome) {
    if (signals.noise || signals.otherAction) {
      closeLineHotChat_(context, signals.hot);
      return logLineChatWakeStatus_('skipped_no_signal', null, chain);
    }
    if (!signals.named && !(signals.teasing && !signals.hot) && !signals.work && !signals.followUp &&
        !signals.easterEggAvailable && !signals.ambientBanterAvailable) {
      return logLineChatWakeStatus_(chain >= CHAT_MAX_FOLLOW_UP_CHAIN ? 'skipped_chain_limit' :
        signals.interjectionThrottled ? 'skipped_cooldown' : context.lineChatState ? 'skipped_no_signal' : 'skipped_budget_or_error', null, chain);
    }
  }
  const lane = fastOutcome ? 'fast' : signals.followUp ? 'follow_up' : 'auto';
  const reserved = reserveLineAutoReply_(key, context.lineChatState, executionContext.deadlineAtMs, context.beforeTimestampMs, lane);
  const lease = reserved.id;
  if (!lease) return logLineChatWakeStatus_(reserved.outcome, null, chain);
  let outcome = 'skipped_budget_or_error';
  let scored;
  let updatedChain = chain;
  try {
    const evaluation = fastOutcome ? { outcome: fastOutcome, decision: { triggerType: 'direct_call', fastLane: true,
      noteAction: context.weeklyNoteRequested ? 'save_weekly_note' : 'none' } }
      : classifyLineChatWake_(text, signals, loadLineAmbientContext_(conversationId, executionContext), executionContext);
    scored = evaluation.decision || evaluation.scored;
    const decision = evaluation.decision;
    if (!decision) {
      outcome = evaluation.outcome;
      if (signals.followUp && outcome === 'gatekeeper_ignore') closeLineHotChat_(context, signals.hot, lease);
      return;
    }
    const reply = buildLineChatReply_(event, conversationId, text, executionContext, decision, lease);
    if (reply) reply.triggerType = decision.triggerType;
    if (reply && authorizeLineAutoReply_(key, lease, executionContext.deadlineAtMs, decision.triggerType) &&
        sendLineReplyWithLog_(event, conversationId, context, reply)) {
      outcome = evaluation.outcome;
      if (reply.followUp) updatedChain = decision.triggerType === 'follow_up' ? chain + 1 : 0;
      return reply.mode === 'chat' && !reply.easterEgg;
    }
  } catch (ignore) { /* 自動接話錯誤時維持安靜。 */ }
  finally {
    finishLineAutoReply_(key, lease);
    logLineChatWakeStatus_(outcome, scored, updatedChain);
  }
}

function buildLineChatReply_(event, conversationId, text, executionContext, decision, lease) {
  const context = executionContext.conversationContext;
  const memberRequest = context.memberMemoryRequest;
  const memberReply = memberRequest ? {
    text: applyLineMemberMemoryRequest_(conversationId, context.currentUserId, memberRequest, lease, executionContext.deadlineAtMs),
    mode: 'member_memory', leaseId: lease
  } : null;
  if (memberReply && !memberRequest.question) return memberReply;
  if (memberReply) text = memberRequest.question;
  loadLineAmbientContext_(conversationId, executionContext);
  const easterEgg = !!decision && decision.triggerType === 'easter_egg';
  const note = !easterEgg && context.weeklyNoteRequested && (!decision || decision.noteAction === 'save_weekly_note')
    ? saveLineWeeklyNotes_(event, conversationId, text, executionContext, context.lineChatKey, lease) : null;
  const noteAck = note ? formatWeeklyNoteAcknowledgement_(note) : '';
  const research = noteAck ? context.weeklyNoteResearch : null;
  const search = !easterEgg && (research ? research.search : isExplicitWebSearchRequest_(text));
  const noteReply = noteAck ? { text: noteAck, mode: 'weekly_note', followUp: true, leaseId: lease,
    weeklyNotesBoundary: note.clearedAtMs } : null;
  if (noteReply && !research.question) {
    if (note.status === 'ok' && note.saved.length && !shouldUseWebReading(text)) {
      noteReply.text += '\n\n有原帖再丟，之後比較好對來源。';
    }
    stageLineNoteMemory_(conversationId, text, noteReply.text, executionContext);
    return noteReply;
  }
  const options = buildAiCallOptionsForExecutionContext_(executionContext, {
    forceWebSearch: search, maxModelCalls: decision && !decision.fastLane ? 1 : 2,
    disableClientResearch: easterEgg,
    weeklyNoteResult: note, weeklyNoteQuestion: research && research.question,
    easterEggReply: easterEgg, excludeMessageId: context.currentMessageId
  });
  const failed = function(result) {
    if (memberReply) return memberReply;
    if (noteReply) {
      stageLineNoteMemory_(conversationId, text, noteReply.text, executionContext);
      return noteReply;
    }
    if (decision) return null;
    const searchFailure = result && result.errorType === 'ai_web_search_failed';
    return { text: result && result.errorType === 'ai_required_evidence_failed' ? getBotTextRequiredEvidenceError_(result)
      : searchFailure ? getBotTextWebSearchError_(result) : getBotTextAiError_(result || createAiExecutionBudgetError_()),
    mode: searchFailure ? 'web_search_error' : 'general_chat_error' };
  };
  if (!options) return failed(null);
  const result = runAiMemoryTask('general_chat', conversationId, text, text, options);
  if (!result.ok) return failed(result);
  let answer = result.text;
  if (easterEgg) {
    answer = getLineShortBanterText_(answer);
    if (!answer) return null;
  }
  // 儲存回執由程式定稿，混合請求同時保留模型回答的研究內容。
  if (noteReply) answer = noteReply.text + '\n\n' + answer;
  const sources = result.usedWebSearch || result.sources.length ? buildWebSearchSourcesBubble_(result.sources) : '';
  if (memberReply) return Object.assign(memberReply, { text: memberReply.text + '\n\n' + answer,
    memoryText: answer, finalMessage: sources, followUp: true });
  return { text: answer, mode: note ? 'weekly_note' : sources ? 'general_chat_search' : 'chat',
    finalMessage: sources, followUp: true, leaseId: lease, easterEgg: easterEgg,
    weeklyNotesBoundary: noteReply ? noteReply.weeklyNotesBoundary : undefined };
}

function stageLineNoteMemory_(conversationId, text, replyText, executionContext) {
  const context = executionContext.conversationContext;
  if (!context.lineChatState || typeof context.onMemoryTurn !== 'function') return;
  try {
    const deadline = executionContext.deadlineAtMs;
    const snapshot = snapshotConversationMemory_(conversationId, deadline, context.beforeTimestampMs);
    if (!snapshot.generation || (snapshot.chatState.resetId || '') !== (context.lineChatState.resetId || '')) return;
    // 與模型回覆共用 LINE 確認送出後的記憶提交。
    context.onMemoryTurn(buildConversationTurnCommit_(conversationId, snapshot.generation, text, replyText, context, deadline));
  } catch (ignore) { console.warn('CONVERSATION_MEMORY_STAGE_FAILED'); }
}

function sendLineReplyWithLog_(event, conversationId, context, reply) {
  let commitMemory = context.commitMemory;
  if (reply.weeklyNotesBoundary !== undefined && !isWeeklyNotesBoundaryCurrent_(conversationId, reply.weeklyNotesBoundary)) {
    reply = { text: '這筆手動註記在送出前已無法確認，請重新註記一次。', mode: 'weekly_note', leaseId: reply.leaseId };
    commitMemory = null;
  } else if (reply.mode === 'weekly_news' && context.recheckWeeklyReport) {
    reply.text = context.recheckWeeklyReport();
  }
  const receipt = {};
  if (replyToLine(event.replyToken, reply.text, false, reply.finalMessage || '', receipt) === false) return false;
  if (reply.leaseId) {
    const state = readLineChatState_(context.lineChatKey);
    if (!state || !state.lease || state.lease.id !== reply.leaseId) return false;
  }
  if (receipt.sentAtMs && commitMemory) commitMemory(receipt, reply.memoryText || reply.text);
  logAssistantReplyToSheet(event, conversationId, reply.mode === 'member_memory' ? '[個人記憶操作回覆]' : reply.text, reply.mode, receipt);
  rememberLineReply_(context.lineChatKey, context.lineChatState, event, receipt, reply.followUp, reply.leaseId, reply.triggerType);
  return !!receipt.sentAtMs;
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
