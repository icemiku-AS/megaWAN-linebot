// ======================================================
// 13_NewsInbox.gs
// v1.12.1 Weekly News Query & Help Focus Edition：新聞素材池、靜默網址收件、狀態回報、新聞封存脈絡。
//
// 維護重點：
// 1. v1.12.0 起，群組直接貼網址會靜默進 NewsUrlQueue，不再回覆 Brief；私訊與明確指令保留同步回覆路徑。
// 2. 多網址、Reader 過慢、同步 API 失敗或結果不足時，退回 NewsUrlQueue；time-driven trigger 每次最多處理 2 筆。
// 3. v1.10.5 起，自動網址入庫會先透過 16_ReaderLayer.gs 取得 mainText，再交給 Gemini 整理。
// 4. v1.10.9 起，X / Twitter 非單篇 status 網址會在入隊前直接攔截；Facebook / Threads 先交給 Jina Reader。
// 5. v1.10.7 起，背景處理若遇到永久性錯誤，會直接 failed 並建立 PendingReplies，不再無效重試三次。
// 6. DeepSeek 負責 #新聞補充 解析。
// 7. v1.10.8 修正 #新聞補充 的 JSON parser 名稱錯誤，讓 DeepSeek 解析結果真的能被使用，而不是每次靜默 fallback。
// 8. v1.10.1 起，#本週新聞 改由程式端固定排版，確保 LINE 內換行穩定。
// 8.1 v1.12.1 起，#本週新聞 支援高潛力、詳細、精簡、24 小時與分類篩選模式。
// 9. 本檔盡量不改動舊 WebTaskQueue，避免影響 #懶人包 / #節目話題分析。
// 10. NewsInbox 在既有欄位最右側新增 Outline；舊資料若沒有 Outline，#統整話題會退回 Brief。
// ======================================================

const NEWS_INBOX_CATEGORIES = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '生活文化', '馬斯克', '川普', '待分類'];
const NEWS_TOPIC_POTENTIAL_VALUES = ['低', '中', '高'];
const MAX_NEWS_QUEUE_TASKS_PER_RUN = 2;
const MAX_NEWS_URLS_PER_MESSAGE = 10;
const MAX_NEWS_QUEUE_RETRY_COUNT = 3;
const DEFAULT_WEEKLY_NEWS_DAYS = 7;
const DEFAULT_WEEKLY_NEWS_ARCHIVE_MEMORY_COUNT = 4;

// NewsUrlQueue 永久性錯誤清單。
//
// 維護說明：
// 1. 這些錯誤不是暫時性網路錯誤，重試通常不會成功。
// 2. 例如 unsupported_social_platform 代表平台目前尚未導入 Apify / ByCrawl / 官方 API。
// 3. 這類錯誤應立即 failed 並通知使用者，不應浪費 3 次 trigger 重試。
const NEWS_URL_PERMANENT_ERROR_TYPES = ['unsupported_social_platform', 'unsafe_url'];

function ensureNewsUrlQueueSheet_() {
  const headers = ['TaskId', 'CreatedAt', 'UpdatedAt', 'ConversationId', 'SourceType', 'UserId', 'GroupId', 'RoomId', 'UserPrompt', 'Url', 'Status', 'RetryCount', 'NextRunAt', 'LastErrorType', 'LastErrorText', 'StartedAt', 'FinishedAt'];
  return ensureSheetWithHeaders_(NEWS_URL_QUEUE_SHEET_NAME, headers);
}

function ensureNewsInboxSheet_() {
  const headers = ['NewsId', 'CreatedAt', 'ConversationId', 'SourceType', 'UserId', 'GroupId', 'RoomId', 'Url', 'Title', 'Category', 'Brief', 'Angle', 'TopicPotential', 'SourceMode', 'Status', 'ErrorText'];
  const sheet = ensureSheetWithHeaders_(NEWS_INBOX_SHEET_NAME, headers);

  // Outline 固定新增在目前最右側，讓既有 NewsInbox 欄位順序與舊資料保持相容。
  // 不把 Outline 直接放進共用 headers，避免舊表擴欄時在新欄前留下空白欄。
  const headerMap = getHeaderMap_(sheet);
  if (!headerMap.Outline) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Outline');
  }

  return sheet;
}

// ======================================================
// 直接貼網址：私訊 / 明確指令保留同步 Brief；群組一般網址另走靜默 queue
// ======================================================

function handleDirectNewsUrlMessage_(event, conversationId, userText) {
  const urls = extractUrls(userText).slice(0, MAX_NEWS_URLS_PER_MESSAGE);

  if (!urls.length) {
    return {
      ok: false,
      replyText: getBotTextNoReadableUrl_(),
      replyMode: 'news_inbox_no_url'
    };
  }

  // 同步流程只處理單一網址。多網址維持背景 queue，避免同一個 LINE webhook
  // 連續執行多次 Reader 與 Gemini，導致 replyToken 等待時間過長。
  if (urls.length !== 1) {
    return enqueueDirectNewsUrlsForBackground_(event, conversationId, userText, false, 'multiple_urls');
  }

  const partitionedUrls = partitionNewsUrlsForQueue_(urls);
  if (!partitionedUrls.supportedUrls.length) {
    return {
      ok: false,
      replyText: getBotTextUnsupportedSocialUrl_(partitionedUrls.unsupportedSocialUrls),
      replyMode: 'news_inbox_unsupported_url'
    };
  }

  const url = partitionedUrls.supportedUrls[0];
  const totalStartedAt = Date.now();
  const readerStartedAt = Date.now();
  let webResult = null;
  try {
    webResult = fetchAndExtractWebPageByReaderLayer_(url);
  } catch (error) {
    console.error('Direct news Reader failed:', error && error.stack ? error.stack : error);
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'reader_exception'
    );
  }

  const readerElapsedMs = Date.now() - readerStartedAt;

  if (!webResult.ok) {
    // unsafe_url 等永久性錯誤不應寫入 queue，否則背景 trigger 只會再次得到相同結果。
    if (isPermanentNewsUrlError_(webResult.errorType, webResult.error)) {
      return {
        ok: false,
        replyText: getBotTextDirectNewsSummaryFailed_(url, webResult.error),
        replyMode: 'news_inbox_sync_failed'
      };
    }

    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      webResult.errorType || 'reader_error'
    );
  }

  // Reader 已耗時過久時，不再追加 Gemini 同步呼叫。
  // 網頁內容仍會由 NewsUrlQueue 在背景重新處理，避免 LINE replyToken 逼近有效期限。
  if (readerElapsedMs > DIRECT_NEWS_SYNC_READER_MAX_MS) {
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'reader_slow_' + readerElapsedMs + 'ms'
    );
  }

  let analysis = null;
  const geminiStartedAt = Date.now();
  try {
    analysis = analyzeNewsUrlWithGemini_(url, webResult);
  } catch (error) {
    console.error(
      'Direct news Gemini analysis failed after ' + (Date.now() - geminiStartedAt) + 'ms:',
      error && error.stack ? error.stack : error
    );
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'gemini_error'
    );
  }

  if (isWeakAutoNewsClassification_(analysis, url)) {
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'weak_classification'
    );
  }

  const newsOutline = analysis.outline;

  const source = event.source || {};
  try {
    appendNewsInboxRow_({
      conversationId: conversationId,
      sourceType: source.type || '',
      userId: source.userId || '',
      groupId: source.groupId || '',
      roomId: source.roomId || '',
      url: url,
      title: analysis.title,
      category: analysis.category,
      brief: analysis.brief,
      angle: analysis.angle,
      topicPotential: analysis.topicPotential,
      sourceMode: 'auto_url_sync',
      status: 'ok',
      errorText: '',
      outline: newsOutline
    });
  } catch (error) {
    console.error('Direct news NewsInbox write failed:', error && error.stack ? error.stack : error);
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'news_inbox_write_error'
    );
  }

  console.log('Direct news URL sync completed:', JSON.stringify({
    url: url,
    readerRoute: webResult.readerRoute || '',
    readerElapsedMs: readerElapsedMs,
    geminiElapsedMs: Date.now() - geminiStartedAt,
    totalElapsedMs: Date.now() - totalStartedAt,
    briefLength: analysis.brief.length,
    outlineLength: newsOutline.length
  }));

  return {
    ok: true,
    queued: false,
    replyText: getBotTextDirectNewsBrief_(analysis.brief),
    replyMode: 'news_inbox_sync_brief'
  };
}

function enqueueDirectNewsUrlsForBackground_(event, conversationId, userText, isSyncFallback, fallbackReason) {
  const enqueueResult = enqueueNewsUrlTasks(event, conversationId, userText);

  console.log('Direct news URL switched to background queue:', JSON.stringify({
    reason: fallbackReason || '',
    queuedUrlCount: enqueueResult.urls ? enqueueResult.urls.length : 0,
    ok: !!enqueueResult.ok
  }));

  if (!enqueueResult.ok) {
    return {
      ok: false,
      queued: false,
      replyText: enqueueResult.error || getBotTextNoReadableUrl_(),
      replyMode: 'news_inbox_queue_failed'
    };
  }

  return {
    ok: true,
    queued: true,
    replyText: isSyncFallback
      ? getBotTextDirectNewsSummaryQueued_()
      : getBotTextNewsInboxAccepted_(enqueueResult.urls.length, enqueueResult.skippedUnsupportedUrls),
    replyMode: isSyncFallback ? 'news_inbox_sync_fallback' : 'news_inbox_queued'
  };
}

function handleSilentNewsUrlMessage_(event, conversationId, userText) {
  const enqueueResult = enqueueNewsUrlTasks(event, conversationId, userText);

  if (!enqueueResult.ok) {
    if (enqueueResult.error) {
      createPendingReplyForNewsUrlIntake_(
        event,
        conversationId,
        enqueueResult.error,
        'news_url_intake_failed'
      );
    }

    return {
      ok: false,
      queued: false,
      error: enqueueResult.error || ''
    };
  }

  // 混合貼多個網址時，可支援的網址會靜默入隊；
  // 不支援的網址另透過 PendingReplies 延後回報，避免直接洗群組。
  if (enqueueResult.skippedUnsupportedUrls && enqueueResult.skippedUnsupportedUrls.length) {
    createPendingReplyForNewsUrlIntake_(
      event,
      conversationId,
      getBotTextUnsupportedSocialUrl_(enqueueResult.skippedUnsupportedUrls),
      'news_url_unsupported'
    );
  }

  return {
    ok: true,
    queued: true,
    urls: enqueueResult.urls || [],
    skippedUnsupportedUrls: enqueueResult.skippedUnsupportedUrls || []
  };
}

function createPendingReplyForNewsUrlIntake_(event, conversationId, replyText, replyMode) {
  const source = event.source || {};

  return createPendingReplyFromTask({
    conversationId: conversationId,
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    taskType: replyMode || 'news_url_intake'
  }, replyText, replyMode || 'news_url_intake');
}

function enqueueNewsUrlTasks(event, conversationId, userText) {
  const urls = extractUrls(userText).slice(0, MAX_NEWS_URLS_PER_MESSAGE);
  if (!urls.length) return { ok: false, error: getBotTextNoReadableUrl_() };

  const partitionedUrls = partitionNewsUrlsForQueue_(urls);

  // X / Twitter 非單篇 status 網址目前明確不支援自動擷取。
  // v1.10.5 的 Reader Layer 已能偵測 unsupported_social_platform，但若等到背景 trigger 才判斷，
  // 使用者會先收到「已收進素材池」，接著 queue 又無效重試三次，體驗與維護都很差。
  // 因此 v1.10.7 將「已知未支援平台」提前到入隊前攔截。
  if (!partitionedUrls.supportedUrls.length) {
    return {
      ok: false,
      error: getBotTextUnsupportedSocialUrl_(partitionedUrls.unsupportedSocialUrls),
      urls: [],
      skippedUnsupportedUrls: partitionedUrls.unsupportedSocialUrls
    };
  }

  const source = event.source || {};
  const sheet = ensureNewsUrlQueueSheet_();
  const now = new Date();

  partitionedUrls.supportedUrls.forEach(function(url) {
    sheet.appendRow([createSimpleId('newsq'), now, now, conversationId, source.type || '', source.userId || '', source.groupId || '', source.roomId || '', truncateForSheet(userText || ''), url, 'pending', 0, now, '', '', '', '']);
  });

  return {
    ok: true,
    urls: partitionedUrls.supportedUrls,
    skippedUnsupportedUrls: partitionedUrls.unsupportedSocialUrls
  };
}

function partitionNewsUrlsForQueue_(urls) {
  const supportedUrls = [];
  const unsupportedSocialUrls = [];

  urls.forEach(function(url) {
    const safeUrl = String(url || '').trim();
    if (!safeUrl) return;

    // 直接復用 Reader Layer 的 route detector，避免 NewsInbox 另維護一份平台清單。
    // 這裡只攔截「明確已知目前不支援」的平台；一般網站與 PTT 仍交給 queue 背景處理。
    const route = detectWebReaderRoute_(safeUrl);
    if (route === WEB_READER_ROUTE_UNSUPPORTED_SOCIAL) {
      unsupportedSocialUrls.push(safeUrl);
      return;
    }

    supportedUrls.push(safeUrl);
  });

  return {
    supportedUrls: supportedUrls,
    unsupportedSocialUrls: unsupportedSocialUrls
  };
}

function processNewsUrlQueue() {
  const queueLock = LockService.getScriptLock();
  if (!queueLock.tryLock(1000)) {
    console.log('processNewsUrlQueue skipped: lock busy');
    return;
  }

  let tasksToProcess = [];
  try {
    const sheet = ensureNewsUrlQueueSheet_();
    const headerMap = getHeaderMap_(sheet);
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return;

    const now = new Date();
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    for (let i = 0; i < values.length; i++) {
      if (tasksToProcess.length >= MAX_NEWS_QUEUE_TASKS_PER_RUN) break;
      const row = values[i];
      const status = getRowValueByHeader_(row, headerMap, 'Status');
      const nextRunAt = getRowValueByHeader_(row, headerMap, 'NextRunAt');
      if (status !== 'pending') continue;
      if (nextRunAt && new Date(nextRunAt).getTime() > now.getTime()) continue;

      const sheetRowNumber = i + 2;
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
        url: getRowValueByHeader_(row, headerMap, 'Url'),
        retryCount: Number(getRowValueByHeader_(row, headerMap, 'RetryCount') || 0)
      });
    }
  } finally {
    queueLock.releaseLock();
  }

  tasksToProcess.forEach(function(task) {
    processSingleNewsUrlTask_(task);
  });
}

function processSingleNewsUrlTask_(task) {
  const sheet = ensureNewsUrlQueueSheet_();
  const headerMap = getHeaderMap_(sheet);
  const now = new Date();

  try {
    const webResult = fetchAndExtractWebPageByReaderLayer_(task.url);
    if (!webResult.ok) {
      const readerError = new Error(webResult.error || 'fetch failed');
      readerError.errorType = webResult.errorType || 'reader_error';
      readerError.readerRoute = webResult.readerRoute || '';
      throw readerError;
    }

    const analysis = analyzeNewsUrlWithGemini_(task.url, webResult);

    if (isWeakAutoNewsClassification_(analysis, task.url)) {
      const weakError = new Error('weak_auto_classification: Gemini classification is insufficient for NewsInbox');
      weakError.errorType = 'weak_classification';
      throw weakError;
    }

    appendNewsInboxRow_({
      conversationId: task.conversationId,
      sourceType: task.sourceType,
      userId: task.userId,
      groupId: task.groupId,
      roomId: task.roomId,
      url: task.url,
      title: analysis.title,
      category: analysis.category,
      brief: analysis.brief,
      angle: analysis.angle,
      topicPotential: analysis.topicPotential,
      sourceMode: 'auto_url',
      status: 'ok',
      errorText: '',
      outline: analysis.outline
    });

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', now);
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'done');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', now);
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorType', '');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorText', '');

  } catch (error) {
    const errorText = error && error.message ? error.message : String(error);
    const errorType = error && error.errorType ? error.errorType : classifyNewsUrlError_(errorText);
    const retryCount = Number(task.retryCount || 0) + 1;
    const shouldRetry = shouldRetryNewsUrlError_(errorType, errorText);

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', now);
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'RetryCount', retryCount);
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorType', errorType);
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorText', truncateForSheet(errorText));

    // 暫時性錯誤才重試；已知永久性錯誤，例如 unsupported_social_platform，不應排回 pending。
    if (shouldRetry && retryCount < MAX_NEWS_QUEUE_RETRY_COUNT) {
      setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'pending');
      setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'NextRunAt', new Date(now.getTime() + retryCount * 2 * 60 * 1000));
      return;
    }

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'failed');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', now);

    // v1.10.7 修正：
    // 舊版誤呼叫不存在的 createPendingReply()，導致 queue 已 failed 但 PendingReplies 沒有建立。
    // 這裡改用 07_WebTaskQueue.gs 既有的 createPendingReplyFromTask()，
    // 讓下一次同 conversationId 有訊息進來時，01_Main.gs 可透過 getAndDeletePendingReply() 交付錯誤通知。
    createPendingReplyFromTask(task, getBotTextNewsUrlFailed_(task.url, errorText), 'news_url_failed');
  }
}

function shouldRetryNewsUrlError_(errorType, errorText) {
  if (isPermanentNewsUrlError_(errorType, errorText)) {
    return false;
  }

  return true;
}

function isPermanentNewsUrlError_(errorType, errorText) {
  const type = String(errorType || '').trim();

  if (NEWS_URL_PERMANENT_ERROR_TYPES.indexOf(type) >= 0) {
    return true;
  }

  // 後備防守：若舊資料或未帶 errorType 的錯誤訊息中仍包含明確永久錯誤訊號，也不要重試。
  const text = String(errorText || '').toLowerCase();
  return text.indexOf('unsupported_social_platform') >= 0 ||
    text.indexOf('網址安全檢查未通過') >= 0;
}

function analyzeNewsUrlWithGemini_(url, webResult) {
  const prompt = buildNewsAnalysisPrompt_(url, webResult);
  const result = callGeminiJson_(prompt, buildNewsAnalysisSchema_());

  return {
    title: String(result.title || webResult.title || '未取得標題').trim(),
    outline: normalizeDirectNewsOutline_(result.outline),
    category: normalizeNewsCategory_(result.category),
    brief: normalizeNewsInboxBrief_(result.brief),
    angle: String(result.angle || '').trim(),
    topicPotential: normalizeTopicPotential_(result.topicPotential)
  };
}

function buildNewsAnalysisPrompt_(url, webResult) {
  return [
    '請閱讀以下網頁資料，同時產生 LINE 回覆用短 Brief、NewsInbox 保存用完整 Outline，以及 Podcast「現正熱潮中」所需的分類資料。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '輸出欄位：title、outline、category、brief、angle、topicPotential。',
    'brief 請使用繁體中文，目標整理成 ' + NEWS_INBOX_BRIEF_TARGET_MIN_LENGTH + '～' + NEWS_INBOX_BRIEF_TARGET_MAX_LENGTH + ' 個中文字的自然短簡介，讓群組成員不用點開連結就知道事件核心。',
    '如果原文很短，例如 X / Twitter 貼文、公告或單句消息，brief 可以自然少於 ' + NEWS_INBOX_BRIEF_TARGET_MIN_LENGTH + ' 字，不要硬湊字數。',
    'brief 不要只是重寫標題，也不要使用「本文介紹」、「這篇文章」等空泛開頭。',
    'outline 請使用繁體中文，整理成一段 100～200 個中文字的完整內容大綱。',
    'outline 只描述網頁在講什麼，不要加入標題、條列、Markdown、前言、結語、立場評論或節目建議。',
    '可用分類：' + NEWS_INBOX_CATEGORIES.join('、'),
    '分類規則：如果明顯與馬斯克相關，優先選「馬斯克」；如果明顯與川普相關，優先選「川普」。其他再依內容選分類。',
    'topicPotential 只能是：低、中、高。',
    'angle 請整理成一段精簡的節目討論切角。',
    '只能根據提供的 Reader 文字，不可補充外部資訊或捏造內容。',
    '',
    'JSON 格式必須如下：',
    '{',
    '  "title": "",',
    '  "outline": "",',
    '  "category": "",',
    '  "brief": "",',
    '  "angle": "",',
    '  "topicPotential": ""',
    '}',
    '',
    'URL：' + url,
    'Reader Route：' + (webResult.readerRoute || ''),
    'Reader 標題：' + (webResult.title || ''),
    'Reader 來源：' + (webResult.siteName || ''),
    'Reader 內容：',
    String(webResult.mainText || '').slice(0, DIRECT_NEWS_GEMINI_TEXT_LIMIT)
  ].join('\n');
}

function buildNewsAnalysisSchema_() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      outline: { type: 'string' },
      category: { type: 'string' },
      brief: { type: 'string' },
      angle: { type: 'string' },
      topicPotential: { type: 'string' }
    },
    required: ['title', 'outline', 'category', 'brief', 'angle', 'topicPotential']
  };
}

function normalizeNewsInboxBrief_(brief) {
  const text = String(brief || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= NEWS_INBOX_BRIEF_HARD_MAX_LENGTH) return text;

  // 30～50 字是 prompt 目標，不在程式端硬裁；這裡只處理模型失控輸出。
  // 若必須防爆，優先在句尾截斷，避免把正常簡介切成半句。
  const limited = text.slice(0, NEWS_INBOX_BRIEF_HARD_MAX_LENGTH);
  const sentenceMarks = ['。', '！', '？', '!', '?'];
  let lastSentenceEnd = -1;

  sentenceMarks.forEach(function(mark) {
    lastSentenceEnd = Math.max(lastSentenceEnd, limited.lastIndexOf(mark));
  });

  if (lastSentenceEnd >= NEWS_INBOX_BRIEF_TARGET_MAX_LENGTH) {
    return limited.slice(0, lastSentenceEnd + 1).trim();
  }

  return text.slice(0, NEWS_INBOX_BRIEF_HARD_MAX_LENGTH - 1).trim() + '…';
}

function normalizeDirectNewsOutline_(outline) {
  const text = String(outline || '').trim();
  if (text.length < DIRECT_NEWS_OUTLINE_MIN_LENGTH) {
    return '';
  }

  if (text.length <= DIRECT_NEWS_OUTLINE_MAX_LENGTH) {
    return text;
  }

  // Gemini 偶爾會略超過指定長度。這裡優先在約 200 字內的句尾截斷；
  // 找不到合適句尾時才加省略號，避免只因大綱偏長而重跑背景任務。
  const limited = text.slice(0, 200);
  const sentenceMarks = ['。', '！', '？', '!', '?'];
  let lastSentenceEnd = -1;

  sentenceMarks.forEach(function(mark) {
    lastSentenceEnd = Math.max(lastSentenceEnd, limited.lastIndexOf(mark));
  });

  if (lastSentenceEnd >= 99) {
    return limited.slice(0, lastSentenceEnd + 1).trim();
  }

  return text.slice(0, 199).trim() + '…';
}

function isWeakAutoNewsClassification_(classification, url) {
  if (!classification) return true;

  const title = String(classification.title || '').trim();
  const category = String(classification.category || '').trim();
  const brief = String(classification.brief || '').trim();
  const angle = String(classification.angle || '').trim();
  const outline = String(classification.outline || '').trim();

  if (!title || !brief || !outline) return true;
  if (category === '待分類') return true;
  if (NEWS_INBOX_CATEGORIES.indexOf(category) === -1) return true;

  const normalizedTitle = title.replace(/\s+/g, '');
  const normalizedUrl = String(url || '').replace(/\s+/g, '');
  if (normalizedTitle && normalizedUrl && normalizedUrl.indexOf(normalizedTitle) !== -1 && !brief) return true;

  if (title === '未取得標題' && !angle) return true;

  return false;
}

function normalizeNewsCategory_(category) {
  const raw = String(category || '').trim();
  return NEWS_INBOX_CATEGORIES.indexOf(raw) >= 0 ? raw : '待分類';
}

function normalizeTopicPotential_(value) {
  const raw = String(value || '').trim();
  return NEWS_TOPIC_POTENTIAL_VALUES.indexOf(raw) >= 0 ? raw : '中';
}

function appendNewsInboxRow_(item) {
  const sheet = ensureNewsInboxSheet_();
  const now = new Date();
  const valuesByHeader = {
    NewsId: createSimpleId('news'),
    CreatedAt: now,
    ConversationId: item.conversationId || '',
    SourceType: item.sourceType || '',
    UserId: item.userId || '',
    GroupId: item.groupId || '',
    RoomId: item.roomId || '',
    Url: item.url || '',
    Title: truncateForSheet(item.title || ''),
    Category: item.category || '待分類',
    Brief: truncateForSheet(item.brief || ''),
    Angle: truncateForSheet(item.angle || ''),
    TopicPotential: item.topicPotential || '中',
    SourceMode: item.sourceMode || '',
    Status: item.status || 'ok',
    ErrorText: truncateForSheet(item.errorText || ''),
    Outline: truncateForSheet(item.outline || '')
  };

  // 依實際表頭對位，避免舊 Sheet 補上 Outline 後因欄位位置不同而寫錯資料。
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(function(header) {
    const key = String(header || '').trim();
    return Object.prototype.hasOwnProperty.call(valuesByHeader, key)
      ? valuesByHeader[key]
      : '';
  });

  sheet.appendRow(row);
}

function classifyNewsUrlError_(errorText) {
  const text = String(errorText || '').toLowerCase();
  if (text.indexOf('unsupported_social_platform') >= 0) return 'unsupported_social_platform';
  if (text.indexOf('網址安全檢查未通過') >= 0) return 'unsafe_url';
  if (text.indexOf('fetch') >= 0 || text.indexOf('urlfetch') >= 0) return 'fetch_error';
  if (text.indexOf('gemini') >= 0 || text.indexOf('json') >= 0) return 'classification_error';
  if (text.indexOf('weak_auto_classification') >= 0) return 'weak_classification';
  return 'unknown_error';
}

function handleWeeklyNewsDigest_(event, conversationId, userPrompt) {
  const queryOptions = parseWeeklyNewsQueryOptions_(userPrompt);
  const items = getRecentNewsInboxItems_(conversationId, queryOptions.days);
  const filteredItems = filterWeeklyNewsItems_(items, queryOptions);

  if (!filteredItems.length) return getBotTextWeeklyNewsNoData_(queryOptions);

  const digestText = formatWeeklyNewsDigest_(filteredItems, queryOptions);
  const memoryBridgeText = shouldBuildWeeklyNewsMemoryBridge_(queryOptions)
    ? buildWeeklyNewsMemoryBridge_(conversationId, filteredItems)
    : '';

  return [digestText, memoryBridgeText].filter(function(block) {
    return String(block || '').trim() !== '';
  }).join('\n\n');
}

function parseWeeklyNewsQueryOptions_(userPrompt) {
  const text = String(userPrompt || '').replace(/\s+/g, ' ').trim();
  const options = {
    days: DEFAULT_WEEKLY_NEWS_DAYS,
    viewMode: 'default',
    onlyHighPotential: false,
    categoryFilter: '',
    rawText: text
  };

  if (!text) return options;

  if (text.indexOf('24小時') >= 0 || text.indexOf('24 小時') >= 0 || text.indexOf('一天') >= 0 || text.indexOf('1天') >= 0) {
    options.days = 1;
  }

  if (text.indexOf('高潛力') >= 0) {
    options.onlyHighPotential = true;
  }

  if (text.indexOf('詳細') >= 0) {
    options.viewMode = 'detailed';
  }

  if (text.indexOf('精簡') >= 0) {
    options.viewMode = 'compact';
  }

  const categoryMatch = text.match(/(?:^|\s)分類\s+(.+)$/);
  if (categoryMatch && categoryMatch[1]) {
    const categoryText = categoryMatch[1]
      .replace(/高潛力/g, '')
      .replace(/詳細/g, '')
      .replace(/精簡/g, '')
      .replace(/24\s*小時/g, '')
      .replace(/一天/g, '')
      .replace(/1天/g, '')
      .trim();
    options.categoryFilter = normalizeWeeklyNewsCategoryFilter_(categoryText);
  }

  return options;
}

function normalizeWeeklyNewsCategoryFilter_(categoryText) {
  const raw = String(categoryText || '').trim();
  if (!raw) return '';
  if (NEWS_INBOX_CATEGORIES.indexOf(raw) >= 0) return raw;

  const compactRaw = raw.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < NEWS_INBOX_CATEGORIES.length; i++) {
    const category = NEWS_INBOX_CATEGORIES[i];
    if (category.replace(/\s+/g, '').toLowerCase() === compactRaw) {
      return category;
    }
  }

  return raw;
}

function filterWeeklyNewsItems_(items, queryOptions) {
  const options = queryOptions || {};

  return (items || []).filter(function(item) {
    if (options.onlyHighPotential && item.topicPotential !== '高') {
      return false;
    }

    if (options.categoryFilter && item.category !== options.categoryFilter) {
      return false;
    }

    return true;
  });
}

function getRecentNewsInboxItems_(conversationId, days) {
  const sheet = ensureNewsInboxSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const headerMap = getHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const cutoffTime = new Date().getTime() - days * 24 * 60 * 60 * 1000;

  return values.map(function(row) {
    return {
      createdAt: getRowValueByHeader_(row, headerMap, 'CreatedAt'),
      conversationId: getRowValueByHeader_(row, headerMap, 'ConversationId'),
      url: getRowValueByHeader_(row, headerMap, 'Url'),
      title: getRowValueByHeader_(row, headerMap, 'Title'),
      category: getRowValueByHeader_(row, headerMap, 'Category'),
      brief: getRowValueByHeader_(row, headerMap, 'Brief'),
      outline: getRowValueByHeader_(row, headerMap, 'Outline'),
      angle: getRowValueByHeader_(row, headerMap, 'Angle'),
      topicPotential: getRowValueByHeader_(row, headerMap, 'TopicPotential'),
      status: getRowValueByHeader_(row, headerMap, 'Status')
    };
  }).filter(function(item) {
    const createdAtTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return item.conversationId === conversationId &&
           item.status === 'ok' &&
           createdAtTime >= cutoffTime;
  }).sort(function(a, b) {
    return String(a.category || '').localeCompare(String(b.category || ''), 'zh-Hant');
  });
}

function formatWeeklyNewsDigest_(items, queryOptions) {
  const options = queryOptions || {};

  if (options.viewMode === 'compact') {
    return formatWeeklyNewsCompactDigest_(items, options);
  }

  if (options.viewMode === 'detailed') {
    return formatWeeklyNewsDetailedDigest_(items, options);
  }

  return formatWeeklyNewsDefaultDigest_(items, options);
}

function formatWeeklyNewsDefaultDigest_(items, queryOptions) {
  const grouped = {};
  items.forEach(function(item) {
    const category = item.category || '待分類';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });

  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];
  Object.keys(grouped).forEach(function(category) {
    lines.push('', '【' + category + '】');
    grouped[category].forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.title || '未取得標題'),
        item.brief ? '簡介：' + item.brief : '',
        '來源：' + (item.url || '')
      );
    });
  });

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function formatWeeklyNewsDetailedDigest_(items, queryOptions) {
  const grouped = {};
  items.forEach(function(item) {
    const category = item.category || '待分類';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });

  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];
  Object.keys(grouped).forEach(function(category) {
    lines.push('', '【' + category + '】');
    grouped[category].forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.title || '未取得標題'),
        '來源：' + (item.url || ''),
        '內容大綱：' + (item.outline || item.brief || '無'),
        item.angle ? '切角：' + item.angle : '',
        '節目潛力：' + (item.topicPotential || '中')
      );
    });
  });

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function formatWeeklyNewsCompactDigest_(items, queryOptions) {
  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];

  items.forEach(function(item, index) {
    lines.push(
      '',
      (index + 1) + '. 分類：' + (item.category || '待分類'),
      '標題：' + (item.title || '未取得標題'),
      '來源：' + (item.url || '')
    );
  });

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function buildWeeklyNewsDigestHeader_(queryOptions) {
  const options = queryOptions || {};
  const parts = [formatWeeklyNewsPeriodLabel_(options.days)];

  if (options.onlyHighPotential) {
    parts.push('高潛力');
  }

  if (options.categoryFilter) {
    parts.push('分類「' + options.categoryFilter + '」');
  }

  if (options.viewMode === 'detailed') {
    parts.push('詳細');
  } else if (options.viewMode === 'compact') {
    parts.push('精簡');
  }

  return '我把' + parts.join('、') + '的新聞素材翻出來了：';
}

function formatWeeklyNewsPeriodLabel_(days) {
  return Number(days) === 1 ? '最近 24 小時' : '最近 ' + (Number(days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天';
}

function shouldBuildWeeklyNewsMemoryBridge_(queryOptions) {
  const options = queryOptions || {};

  // 「高潛力 / 24 小時 / 分類 / 精簡」都屬於聚焦檢視；
  // 這些模式只輸出篩選後素材，避免額外補過去脈絡造成「只看」語意混淆。
  if (options.viewMode === 'compact' ||
      Number(options.days) === 1 ||
      options.onlyHighPotential ||
      options.categoryFilter) {
    return false;
  }

  return true;
}

function buildWeeklyNewsMemoryBridge_(conversationId, items) {
  const archiveText = getRecentWeeklySummaryText(
    conversationId,
    DEFAULT_WEEKLY_NEWS_ARCHIVE_MEMORY_COUNT,
    WEEKLY_ARCHIVE_TYPE_NEWS
  );

  if (!archiveText) {
    return '';
  }

  const currentNewsText = formatNewsItemsForMemoryBridge_(items);
  const prompt = [
    '請判斷「本週 NewsInbox」和「過去新聞封存記憶」之間是否有值得提醒的延續、反轉、同題材累積或可合併討論關聯。',
    '',
    '輸出限制：',
    '1. 使用繁體中文。',
    '2. 如果沒有明確關聯，請只回覆空字串。',
    '3. 如果有關聯，請用「過去脈絡：」開頭，最多列 3 點。',
    '4. 不要捏造資料中沒有的事實，不要補充外部資訊。',
    '5. 不要使用 Markdown 表格。',
    '',
    '本週 NewsInbox：',
    currentNewsText,
    '',
    '過去新聞封存記憶：',
    archiveText
  ].join('\n');

  try {
    const relationText = String(callDeepSeekDirect(prompt, 'integrate_topics') || '').trim();
    if (relationText === '空字串' || relationText === '""') {
      return '';
    }
    return relationText;
  } catch (error) {
    console.error('buildWeeklyNewsMemoryBridge_ error:', error && error.stack ? error.stack : error);
    return '';
  }
}

function formatNewsItemsForMemoryBridge_(items) {
  return items.slice(0, 20).map(function(item, index) {
    return [
      '【本週新聞 ' + (index + 1) + '】',
      '分類：' + (item.category || '待分類'),
      '標題：' + (item.title || '未取得標題'),
      '簡介：' + (item.brief || '無'),
      '大綱：' + (item.outline || '無'),
      '來源：' + (item.url || '')
    ].join('\n');
  }).join('\n\n');
}

function handleNewsStatusReport_(event, conversationId) {
  const stats = collectNewsStatusStats_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);
  return formatNewsStatusReport_(stats);
}

function collectNewsStatusStats_(conversationId, days) {
  const cutoffTime = new Date().getTime() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const urlMap = {};
  const stats = {
    days: days,
    inboxOkCount: 0,
    categoryCounts: {},
    receivedUrlCount: 0,
    queueTotalCount: 0,
    queueStatusCounts: {
      pending: 0,
      processing: 0,
      done: 0,
      failed: 0
    },
    errorTypeCounts: {},
    failedItems: [],
    pendingFailureReplyCount: 0
  };

  getRecentNewsInboxItems_(conversationId, days).forEach(function(item) {
    stats.inboxOkCount++;
    if (item.url) urlMap[item.url] = true;

    const category = item.category || '待分類';
    stats.categoryCounts[category] = (stats.categoryCounts[category] || 0) + 1;
  });

  collectNewsQueueStatusInto_(conversationId, cutoffTime, urlMap, stats);
  collectPendingNewsReplyStatusInto_(conversationId, cutoffTime, stats);

  stats.receivedUrlCount = Object.keys(urlMap).length;
  return stats;
}

function collectNewsQueueStatusInto_(conversationId, cutoffTime, urlMap, stats) {
  const sheet = ensureNewsUrlQueueSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const headerMap = getHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
    const createdAt = getRowValueByHeader_(row, headerMap, 'CreatedAt');
    const createdAtTime = createdAt ? new Date(createdAt).getTime() : 0;

    if (rowConversationId !== conversationId || createdAtTime < cutoffTime) {
      continue;
    }

    const url = getRowValueByHeader_(row, headerMap, 'Url');
    const status = String(getRowValueByHeader_(row, headerMap, 'Status') || 'pending');
    const errorType = String(getRowValueByHeader_(row, headerMap, 'LastErrorType') || 'unknown_error');
    const errorText = String(getRowValueByHeader_(row, headerMap, 'LastErrorText') || '');

    if (url) urlMap[url] = true;
    stats.queueTotalCount++;

    if (!Object.prototype.hasOwnProperty.call(stats.queueStatusCounts, status)) {
      stats.queueStatusCounts[status] = 0;
    }
    stats.queueStatusCounts[status]++;

    if (status === 'failed') {
      stats.errorTypeCounts[errorType] = (stats.errorTypeCounts[errorType] || 0) + 1;
      if (stats.failedItems.length < 3) {
        stats.failedItems.push({
          url: url,
          errorType: errorType,
          errorText: errorText
        });
      }
    }
  }
}

function collectPendingNewsReplyStatusInto_(conversationId, cutoffTime, stats) {
  const sheet = ensurePendingRepliesSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return;

  const headerMap = getHeaderMap_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

  values.forEach(function(row) {
    const rowConversationId = getRowValueByHeader_(row, headerMap, 'ConversationId');
    const createdAt = getRowValueByHeader_(row, headerMap, 'CreatedAt');
    const createdAtTime = createdAt ? new Date(createdAt).getTime() : 0;
    const status = getRowValueByHeader_(row, headerMap, 'Status');
    const replyMode = String(getRowValueByHeader_(row, headerMap, 'ReplyMode') || '');

    if (rowConversationId !== conversationId || createdAtTime < cutoffTime) {
      return;
    }

    if (status === 'pending' && replyMode.indexOf('news_url') === 0) {
      stats.pendingFailureReplyCount++;
    }
  });
}

function formatNewsStatusReport_(stats) {
  const queue = stats.queueStatusCounts || {};
  const lines = [
    '最近 ' + stats.days + ' 天新聞收件狀態：',
    '',
    '收到網址：' + stats.receivedUrlCount + ' 個',
    '已入庫 NewsInbox：' + stats.inboxOkCount + ' 則',
    '背景佇列：待處理 ' + (queue.pending || 0) + '、處理中 ' + (queue.processing || 0) + '、完成 ' + (queue.done || 0) + '、失敗 ' + (queue.failed || 0),
    '待回報錯誤：' + stats.pendingFailureReplyCount + ' 則'
  ];

  const categoryText = formatCountMap_(stats.categoryCounts);
  if (categoryText) {
    lines.push('', '分類概況：', categoryText);
  }

  const errorTypeText = formatCountMap_(stats.errorTypeCounts);
  if (errorTypeText) {
    lines.push('', '失敗類型：', errorTypeText);
  }

  if (stats.failedItems.length) {
    lines.push('', '最近失敗：');
    stats.failedItems.forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.url || '未記錄網址'),
        '原因：' + (item.errorType || 'unknown_error') + (item.errorText ? ' / ' + item.errorText.slice(0, 120) : '')
      );
    });
  }

  return lines.join('\n');
}

function formatCountMap_(countMap) {
  const keys = Object.keys(countMap || {}).filter(function(key) {
    return countMap[key] > 0;
  });

  if (!keys.length) {
    return '';
  }

  return keys.sort(function(a, b) {
    return countMap[b] - countMap[a];
  }).map(function(key) {
    return '・' + key + '：' + countMap[key];
  }).join('\n');
}

function getRecentNewsInboxTextForTopics_(conversationId, days, limit) {
  const items = getRecentNewsInboxItems_(conversationId, days)
    .slice()
    .sort(function(a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .slice(0, Math.max(1, Number(limit) || DEFAULT_RECENT_NEWS_INBOX_COUNT))
    .reverse();

  return items.map(function(item, index) {
    return [
      '【NewsInbox ' + (index + 1) + '】',
      '標題：' + (item.title || '未取得標題'),
      '分類：' + (item.category || '待分類'),
      '網址：' + (item.url || ''),
      '內容大綱：' + (item.outline || item.brief || '無'),
      '節目切角：' + (item.angle || '無'),
      '節目潛力：' + (item.topicPotential || '中')
    ].join('\n');
  }).join('\n\n');
}

function handleManualNewsSupplement_(event, conversationId, userText) {
  const urls = extractUrls(userText);
  if (!urls.length) return getBotTextManualNewsSupplementNeedUrl_();

  const parsed = parseManualNewsSupplement_(userText);
  const source = event.source || {};

  appendNewsInboxRow_({
    conversationId: conversationId,
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    url: urls[0],
    title: parsed.title || '人工補充素材',
    category: parsed.category || '待分類',
    brief: parsed.brief || '',
    angle: parsed.angle || '',
    topicPotential: parsed.topicPotential || '中',
    sourceMode: 'manual_supplement',
    status: 'ok',
    errorText: '',
    outline: ''
  });

  return getBotTextManualNewsSupplementSaved_(parsed);
}

function parseManualNewsSupplement_(userText) {
  const prompt = buildManualNewsSupplementPrompt_(userText);
  try {
    const responseText = callDeepSeekDirect(prompt, 'integrate_topics');

    // v1.10.8 修正：
    // 1. v1.10.2 cleanup 後這裡誤呼叫 parseLooseJson()，但專案實際存在的共用函式是 parseJsonObjectLoose()。
    // 2. 因為外層有 try/catch，錯誤不會讓 #新聞補充整個失敗，而是每次靜默掉進 fallback。
    // 3. 這會讓使用者表面上看到「補充成功」，但實際上 DeepSeek 解析出的分類、簡介與節目潛力沒有被使用。
    // 4. 因此這裡改回 parseJsonObjectLoose()，並用 || {} 防守模型偶發回傳非 JSON 的狀況。
    const result = parseJsonObjectLoose(responseText) || {};

    return {
      title: String(result.title || '').trim(),
      category: normalizeNewsCategory_(result.category),
      brief: normalizeNewsInboxBrief_(result.brief),
      angle: String(result.angle || '').trim(),
      topicPotential: normalizeTopicPotential_(result.topicPotential)
    };
  } catch (error) {
    console.error('parseManualNewsSupplement_ failed:', error && error.stack ? error.stack : error);
    return {
      title: '人工補充素材',
      category: '待分類',
      brief: normalizeNewsInboxBrief_(userText),
      angle: '',
      topicPotential: '中'
    };
  }
}

function buildManualNewsSupplementPrompt_(userText) {
  return [
    '請把以下使用者補充的新聞素材整理成 JSON。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '可用分類：' + NEWS_INBOX_CATEGORIES.join('、'),
    'topicPotential 只能是：低、中、高。',
    'brief 請以 30～50 個中文字整理成自然短簡介；如果素材本身很短，可以少於 30 字，不要硬湊字數。',
    '',
    '使用者輸入：',
    userText
  ].join('\n');
}
