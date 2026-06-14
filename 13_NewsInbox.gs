// ======================================================
// 13_NewsInbox.gs
// v1.11.0 Direct URL Summary Edition：新聞素材池、同步網址大綱、新聞網址佇列、#本週新聞、#新聞補充。
//
// 維護重點：
// 1. v1.11.0 起，直接貼單一網址會同步讀取，並由一次 Gemini 呼叫同時產生 LINE 大綱與 NewsInbox 分類資料。
// 2. 多網址、Reader 過慢、同步 API 失敗或結果不足時，退回 NewsUrlQueue；time-driven trigger 每次最多處理 2 筆。
// 3. v1.10.5 起，自動網址入庫會先透過 16_ReaderLayer.gs 取得 mainText，再交給 Gemini 整理。
// 4. v1.10.9 起，X / Twitter 非單篇 status 網址會在入隊前直接攔截；Facebook / Threads 先交給 Jina Reader。
// 5. v1.10.7 起，背景處理若遇到永久性錯誤，會直接 failed 並建立 PendingReplies，不再無效重試三次。
// 6. DeepSeek 負責 #新聞補充 解析。
// 7. v1.10.8 修正 #新聞補充 的 JSON parser 名稱錯誤，讓 DeepSeek 解析結果真的能被使用，而不是每次靜默 fallback。
// 8. v1.10.1 起，#本週新聞 改由程式端固定排版，確保 LINE 內換行穩定。
// 9. 本檔盡量不改動舊 WebTaskQueue，避免影響 #懶人包 / #節目話題分析。
// 10. 同步大綱只用於當次 LINE 回覆，不新增 NewsInbox 欄位；NewsInbox schema 維持相容。
// ======================================================

const NEWS_INBOX_CATEGORIES = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '生活文化', '馬斯克', '川普', '待分類'];
const NEWS_TOPIC_POTENTIAL_VALUES = ['低', '中', '高'];
const MAX_NEWS_QUEUE_TASKS_PER_RUN = 2;
const MAX_NEWS_URLS_PER_MESSAGE = 10;
const MAX_NEWS_QUEUE_RETRY_COUNT = 3;
const DEFAULT_WEEKLY_NEWS_DAYS = 7;

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
  return ensureSheetWithHeaders_(NEWS_INBOX_SHEET_NAME, headers);
}

// ======================================================
// 直接貼網址：同步大綱與 NewsInbox 入庫
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

  const replyOutline = normalizeDirectNewsOutlineForReply_(analysis.outline);
  if (!replyOutline) {
    return enqueueDirectNewsUrlsForBackground_(
      event,
      conversationId,
      userText,
      true,
      'weak_outline'
    );
  }

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
      errorText: ''
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
    outlineLength: replyOutline.length
  }));

  return {
    ok: true,
    queued: false,
    replyText: getBotTextDirectNewsSummary_(replyOutline),
    replyMode: 'news_inbox_sync_summary'
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
      errorText: ''
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
    outline: String(result.outline || '').trim(),
    category: normalizeNewsCategory_(result.category),
    brief: String(result.brief || '').trim(),
    angle: String(result.angle || '').trim(),
    topicPotential: normalizeTopicPotential_(result.topicPotential)
  };
}

function buildNewsAnalysisPrompt_(url, webResult) {
  return [
    '請閱讀以下網頁資料，同時產生 LINE 回覆用內容大綱，以及 Podcast「現正熱潮中」NewsInbox 所需的分類資料。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '輸出欄位：title、outline、category、brief、angle、topicPotential。',
    'outline 請使用繁體中文，整理成一段 100～200 個中文字的內容大綱。',
    'outline 只描述網頁在講什麼，不要加入標題、條列、Markdown、前言、結語、立場評論或節目建議。',
    '可用分類：' + NEWS_INBOX_CATEGORIES.join('、'),
    '分類規則：如果明顯與馬斯克相關，優先選「馬斯克」；如果明顯與川普相關，優先選「川普」。其他再依內容選分類。',
    'topicPotential 只能是：低、中、高。',
    'brief 請控制在 50 個中文字內。',
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

function normalizeDirectNewsOutlineForReply_(outline) {
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

  if (!title || !brief) return true;
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

  sheet.appendRow([
    createSimpleId('news'),
    now,
    item.conversationId || '',
    item.sourceType || '',
    item.userId || '',
    item.groupId || '',
    item.roomId || '',
    item.url || '',
    truncateForSheet(item.title || ''),
    item.category || '待分類',
    truncateForSheet(item.brief || ''),
    truncateForSheet(item.angle || ''),
    item.topicPotential || '中',
    item.sourceMode || '',
    item.status || 'ok',
    truncateForSheet(item.errorText || '')
  ]);
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
  const items = getRecentNewsInboxItems_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);
  if (!items.length) return getBotTextWeeklyNewsNoData_();

  return formatWeeklyNewsDigest_(items);
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

function formatWeeklyNewsDigest_(items) {
  const grouped = {};
  items.forEach(function(item) {
    const category = item.category || '待分類';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });

  const lines = ['我把最近 7 天的新聞素材翻出來了：'];
  Object.keys(grouped).forEach(function(category) {
    lines.push('', '【' + category + '】');
    grouped[category].forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.title || '未取得標題'),
        '來源：' + (item.url || ''),
        '節目潛力：' + (item.topicPotential || '中'),
        item.brief ? '簡介：' + item.brief : '',
        item.angle ? '切角：' + item.angle : ''
      );
    });
  });

  return lines.filter(function(line) { return line !== ''; }).join('\n');
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
    errorText: ''
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
      brief: String(result.brief || '').trim(),
      angle: String(result.angle || '').trim(),
      topicPotential: normalizeTopicPotential_(result.topicPotential)
    };
  } catch (error) {
    console.error('parseManualNewsSupplement_ failed:', error && error.stack ? error.stack : error);
    return {
      title: '人工補充素材',
      category: '待分類',
      brief: String(userText || '').slice(0, 80),
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
    'brief 請控制在 50 個中文字內。',
    '',
    '使用者輸入：',
    userText
  ].join('\n');
}
