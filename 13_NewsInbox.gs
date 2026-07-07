// ======================================================
// 13_NewsInbox.gs
// v1.12.4 Weekly News Compact & Story Grouping Edition：新聞素材池、靜默網址收件、狀態回報、新聞封存脈絡。
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
// 8.1 v1.12.1 起，#本週新聞 支援高潛力、詳細、精簡與分類篩選模式。
// 8.2 v1.12.2 起，NewsInbox 分離主要分類與特殊主題，並追加分類稽核欄位供診斷。
// 8.3 v1.12.3 起，移除 24 小時檢視，並新增 #新聞問答 以近期 NewsInbox 回答素材問題。
// 8.4 v1.12.4 起，NewsInbox 追加 StoryKey，#本週新聞 預設改按故事線精簡聚合。
// 9. 本檔盡量不改動舊 WebTaskQueue，避免影響 #懶人包 / #節目話題分析。
// 10. NewsInbox 在既有欄位最右側新增 Outline；舊資料若沒有 Outline，#統整話題會退回 Brief。
// ======================================================

const NEWS_INBOX_CATEGORIES = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '生活文化', '馬斯克', '川普', '待分類'];
const NEWS_PRIMARY_CATEGORIES = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '生活文化', '體育娛樂', '公共政策', '待分類'];
const NEWS_LEGACY_PERSON_CATEGORIES = ['馬斯克', '川普'];
const NEWS_CATEGORY_DISPLAY_ORDER = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '公共政策', '生活文化', '體育娛樂', '馬斯克', '川普', '待分類'];
const NEWS_INBOX_AUDIT_HEADERS = ['Outline', 'SpecialTopic', 'CategoryReason', 'CategoryConfidence', 'MatchedEntities', 'ClassificationWarning', 'StoryKey'];
const NEWS_TOPIC_POTENTIAL_VALUES = ['低', '中', '高'];
const MAX_NEWS_QUEUE_TASKS_PER_RUN = 2;
const MAX_NEWS_URLS_PER_MESSAGE = 10;
const MAX_NEWS_QUEUE_RETRY_COUNT = 3;
const DEFAULT_WEEKLY_NEWS_DAYS = 7;
const DEFAULT_WEEKLY_NEWS_ARCHIVE_MEMORY_COUNT = 4;
const MAX_NEWS_QUESTION_ITEMS = 30;
const MAX_WEEKLY_NEWS_STORY_GROUPS = 20;
const MAX_WEEKLY_NEWS_ITEMS_PER_STORY_GROUP = 5;
const NEWS_STORY_FALLBACK_KEY = '未命名故事線';

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

  // Outline 與分類稽核欄位固定追加在目前最右側，讓既有 NewsInbox 欄位順序與舊資料保持相容。
  // 不把這些欄位放進共用 headers，避免舊表擴欄時在新欄前留下空白欄。
  const headerMap = getHeaderMap_(sheet);
  NEWS_INBOX_AUDIT_HEADERS.forEach(function(header) {
    if (!headerMap[header]) {
      const nextColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, nextColumn).setValue(header);
      headerMap[header] = nextColumn;
    }
  });

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
      outline: newsOutline,
      specialTopic: analysis.specialTopic,
      categoryReason: analysis.categoryReason,
      categoryConfidence: analysis.categoryConfidence,
      matchedEntities: analysis.matchedEntities,
      classificationWarning: analysis.classificationWarning,
      storyKey: analysis.storyKey
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
      outline: analysis.outline,
      specialTopic: analysis.specialTopic,
      categoryReason: analysis.categoryReason,
      categoryConfidence: analysis.categoryConfidence,
      matchedEntities: analysis.matchedEntities,
      classificationWarning: analysis.classificationWarning,
      storyKey: analysis.storyKey
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
  const rawCategory = String(result.category || '').trim();

  const analysis = {
    title: String(result.title || webResult.title || '未取得標題').trim(),
    outline: normalizeDirectNewsOutline_(result.outline),
    category: normalizeNewsCategory_(rawCategory),
    brief: normalizeNewsInboxBrief_(result.brief),
    angle: String(result.angle || '').trim(),
    topicPotential: normalizeTopicPotential_(result.topicPotential),
    specialTopic: normalizeSpecialTopic_(result.specialTopic || (isLegacyPersonCategory_(rawCategory) ? rawCategory : '')),
    categoryReason: normalizeCategoryReason_(result.categoryReason),
    categoryConfidence: normalizeCategoryConfidence_(result.categoryConfidence),
    matchedEntities: normalizeMatchedEntities_(result.matchedEntities),
    classificationWarning: normalizeClassificationWarning_(result.classificationWarning)
  };
  analysis.storyKey = normalizeStoryKey_(result.storyKey, {
    title: analysis.title,
    specialTopic: analysis.specialTopic,
    matchedEntities: analysis.matchedEntities,
    category: analysis.category,
    url: url
  });

  if (isLegacyPersonCategory_(rawCategory)) {
    analysis.classificationWarning = appendClassificationWarning_(
      analysis.classificationWarning,
      '主要分類不再使用人物分類，已改由 SpecialTopic 保存「' + rawCategory + '」'
    );
  }

  return auditNewsClassification_(analysis, webResult, url);
}

function buildNewsAnalysisPrompt_(url, webResult) {
  return [
    '請閱讀以下網頁資料，同時產生 LINE 回覆用短 Brief、NewsInbox 保存用完整 Outline，以及 Podcast「現正熱潮中」所需的分類資料。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '輸出欄位：title、outline、category、brief、angle、topicPotential、specialTopic、categoryReason、categoryConfidence、matchedEntities、classificationWarning、storyKey。',
    'brief 請使用繁體中文，目標整理成 ' + NEWS_INBOX_BRIEF_TARGET_MIN_LENGTH + '～' + NEWS_INBOX_BRIEF_TARGET_MAX_LENGTH + ' 個中文字的自然短簡介，讓群組成員不用點開連結就知道事件核心。',
    '如果原文很短，例如 X / Twitter 貼文、公告或單句消息，brief 可以自然少於 ' + NEWS_INBOX_BRIEF_TARGET_MIN_LENGTH + ' 字，不要硬湊字數。',
    'brief 不要只是重寫標題，也不要使用「本文介紹」、「這篇文章」等空泛開頭。',
    'outline 請使用繁體中文，整理成一段 100～200 個中文字的完整內容大綱。',
    'outline 只描述網頁在講什麼，不要加入標題、條列、Markdown、前言、結語、立場評論或節目建議。',
    '主要分類 category 只能從以下清單選一個：' + NEWS_PRIMARY_CATEGORIES.join('、'),
    'category 代表新聞最適合被節目拿來討論的核心主軸，不是文章中出現最多的名詞，也不是來源板名。',
    '分類前請先判斷：「這則新聞最適合被節目拿來討論的核心主軸是什麼？」',
    '若主軸是 AI、模型、半導體、晶片、硬體、軟體平台、作業系統、資安、科技產品、機器人，歸為「科技與 AI」。',
    '若主軸是遊戲、動畫、漫畫、VTuber、影音娛樂、作品、主機遊戲、玩家文化、娛樂消費爭議，歸為「ACG娛樂」。',
    '若主軸是網紅、炎上、社群抵制、輿論擴散、平台討論風向、網路迷因，歸為「社群輿論」。',
    '若主軸是企業營收、財報、價格策略、供應鏈、投資、併購、市場競爭、品牌經營，歸為「商業財經」。',
    '若主軸是政府、法律、法院、監管、公共治理、政策攻防、制度規範，歸為「公共政策」。',
    '若主軸是國際關係、外交、戰爭、國家政治、跨國政治衝突，歸為「國際政治」。',
    '若主軸是日常消費、生活方式、文化現象、天氣、旅遊、飲食、健康，歸為「生活文化」。',
    '若主軸是職業運動、選手、球隊、賽事，歸為「體育娛樂」。',
    '資訊不足或無法可靠判斷時，才歸為「待分類」。',
    '不要因為來源是 PTT C_Chat 就自動歸為 ACG娛樂；不要因為來源是 PTT Stock 就自動歸為商業財經。',
    '不要因為標題出現 Apple、Steam、Xbox、PS6、OpenAI、AMD、NVIDIA 等品牌就只看品牌分類；要判斷事件主軸。',
    '同時符合多個分類時，選最適合節目討論切角的主分類；若分類有猶豫，請在 classificationWarning 寫出疑慮。',
    '不要把「馬斯克」或「川普」當作 category；若文章明確涉及這些人物，請放在 specialTopic。',
    'specialTopic 請填人物、公司、平台、政策、作品、產品或事件名稱；沒有明確特殊主題時請填「無」。',
    'specialTopic 可以放人物、公司、作品、平台、產品、政策或事件，但不要取代 category。',
    'storyKey 是同一新聞事件線 / 同一討論主題線的短名稱，不等於分類，也不等於人物標籤；請使用繁體中文，8～24 個中文字為佳。',
    'storyKey 不要太籠統，例如不要只寫「AI新聞」、「遊戲新聞」、「商業新聞」；不要只寫單一公司名，除非事件本身就是該公司整體事件。',
    '同一事件後續報導應盡量產生一致或高度接近的 storyKey，例如：全球記憶體短缺與價格上漲、Valve SteamOS 生態系擴張、家樂福台灣品牌改名、戀與深空辱華爭議。',
    'storyKey 用來聚合同一事件線，不要和 category 混用。',
    'categoryReason 請用 30～60 個中文字說明為什麼選這個主要分類。',
    'categoryConfidence 請填 0 到 1 的數字，越高代表越有把握。',
    'matchedEntities 請列出你從文章中辨識到的主要人物、公司、平台、政策、作品、產品或事件名稱，可用頓號串接；沒有則填「無」。',
    'classificationWarning 正常請填空字串；若分類和關鍵字不一致、內容不足、信心偏低或疑似錯分，請寫簡短警告。',
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
    '  "topicPotential": "",',
    '  "specialTopic": "",',
    '  "categoryReason": "",',
    '  "categoryConfidence": 0.8,',
    '  "matchedEntities": "",',
    '  "classificationWarning": "",',
    '  "storyKey": ""',
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
      topicPotential: { type: 'string' },
      specialTopic: { type: 'string' },
      categoryReason: { type: 'string' },
      categoryConfidence: { type: 'number' },
      matchedEntities: { type: 'string' },
      classificationWarning: { type: 'string' },
      storyKey: { type: 'string' }
    },
    required: ['title', 'outline', 'category', 'brief', 'angle', 'topicPotential', 'specialTopic', 'categoryReason', 'categoryConfidence', 'matchedEntities', 'classificationWarning', 'storyKey']
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

  // v1.12.2 起，category=待分類 但內容完整時允許入庫，並交由 ClassificationWarning / 診斷檢查。
  // 這避免有效新聞只因模型分類不確定，就在 NewsUrlQueue 反覆重試到 failed。
  if (!title || !brief || !outline) return true;
  if (!isAllowedNewsCategory_(category)) return true;

  const normalizedTitle = title.replace(/\s+/g, '');
  const normalizedUrl = String(url || '').replace(/\s+/g, '');
  if (normalizedTitle && normalizedUrl && normalizedUrl.indexOf(normalizedTitle) !== -1 && !brief) return true;

  if (title === '未取得標題' && !angle) return true;

  return false;
}

function isAllowedNewsCategory_(category) {
  const raw = String(category || '').trim();
  return NEWS_PRIMARY_CATEGORIES.indexOf(raw) >= 0 || NEWS_INBOX_CATEGORIES.indexOf(raw) >= 0;
}

function isLegacyPersonCategory_(category) {
  return NEWS_LEGACY_PERSON_CATEGORIES.indexOf(String(category || '').trim()) >= 0;
}

function normalizeNewsCategory_(category) {
  const raw = String(category || '').trim();
  if (NEWS_PRIMARY_CATEGORIES.indexOf(raw) >= 0) return raw;
  if (isLegacyPersonCategory_(raw)) return '待分類';
  return '待分類';
}

function normalizeTopicPotential_(value) {
  const raw = String(value || '').trim();
  return NEWS_TOPIC_POTENTIAL_VALUES.indexOf(raw) >= 0 ? raw : '中';
}

function normalizeSpecialTopic_(value) {
  const text = normalizeTextListField_(value).trim();
  return text || '無';
}

function normalizeCategoryReason_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function normalizeCategoryConfidence_(value) {
  if (value === '' || value === null || typeof value === 'undefined') return '';
  const numberValue = Number(value);
  if (isNaN(numberValue)) return '';
  return Math.max(0, Math.min(1, numberValue));
}

function normalizeMatchedEntities_(value) {
  const text = normalizeTextListField_(value).trim();
  return text || '無';
}

function normalizeClassificationWarning_(value) {
  return normalizeTextListField_(value).trim();
}

function normalizeStoryKey_(value, itemOrAnalysis) {
  const rawStoryKey = normalizeStoryKeyText_(value);
  if (isMeaningfulStoryKey_(rawStoryKey)) return rawStoryKey;

  const item = itemOrAnalysis || {};
  const specialTopic = normalizeStoryKeyText_(item.specialTopic);
  if (isMeaningfulStoryKey_(specialTopic)) return specialTopic;

  const matchedEntities = normalizeTextListField_(item.matchedEntities)
    .split(/[、,，/／;；]/)
    .map(function(entity) {
      return normalizeStoryKeyText_(entity);
    })
    .filter(function(entity) {
      return isMeaningfulStoryKey_(entity);
    });

  if (matchedEntities.length) {
    return matchedEntities.slice(0, 2).join('、');
  }

  const titleKey = normalizeStoryKeyFromTitle_(item.title);
  if (titleKey) return titleKey;

  const categoryKey = normalizeStoryKeyText_(item.category);
  if (isMeaningfulStoryKey_(categoryKey) && categoryKey !== '待分類') return categoryKey;

  const urlKey = normalizeStoryKeyFromUrl_(item.url);
  if (urlKey) return urlKey;

  return NEWS_STORY_FALLBACK_KEY;
}

function normalizeStoryKeyText_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^故事線[：:]/, '')
    .replace(/^StoryKey[：:]/i, '')
    .replace(/^["'「『]+|["'」』]+$/g, '')
    .trim()
    .slice(0, 40);
}

function isMeaningfulStoryKey_(value) {
  const text = normalizeStoryKeyText_(value);
  const lowered = text.toLowerCase();
  return !!text &&
    text !== '無' &&
    text !== '沒有' &&
    text !== '待分類' &&
    text !== NEWS_STORY_FALLBACK_KEY &&
    lowered !== 'none' &&
    lowered !== 'null' &&
    lowered !== 'undefined';
}

function normalizeStoryKeyFromTitle_(title) {
  const cleaned = String(title || '')
    .replace(/^Re[：:]\s*/i, '')
    .replace(/\[(新聞|閒聊|討論|情報|問卦|公告|心得)\]/g, '')
    .replace(/【(新聞|閒聊|討論|情報|問卦|公告|心得)】/g, '')
    .replace(/[「」『』"'“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^https?:\/\//i.test(cleaned)) return '';
  return cleaned.slice(0, 24);
}

function normalizeStoryKeyFromUrl_(url) {
  const match = String(url || '').match(/^https?:\/\/([^\/?#]+)(\/[^?#]*)?/i);
  if (!match) return '';

  const host = String(match[1] || '').replace(/^www\./i, '').toLowerCase();
  const path = String(match[2] || '')
    .split('/')
    .map(function(part) {
      try {
        return decodeURIComponent(part);
      } catch (error) {
        return part;
      }
    })
    .filter(function(part) {
      return part && !/^\d+$/.test(part);
    });

  const pathKey = path.length ? path[0].replace(/[-_]+/g, ' ').trim().slice(0, 20) : '';
  return (host + (pathKey ? ' / ' + pathKey : '')).slice(0, 40);
}

function normalizeTextListField_(value) {
  if (Array.isArray(value)) {
    return value.map(function(item) { return String(item || '').trim(); })
      .filter(function(item) { return item !== ''; })
      .join('、');
  }

  return String(value || '').replace(/\s+/g, ' ').trim();
}

function appendClassificationWarning_(existingWarning, warning) {
  const existing = String(existingWarning || '').trim();
  const next = String(warning || '').trim();
  if (!next) return existing;
  if (!existing) return next;
  if (existing.indexOf(next) >= 0) return existing;
  return existing + '；' + next;
}

function auditNewsClassification_(analysis, webResult, url) {
  const audited = {
    title: analysis.title || '',
    outline: analysis.outline || '',
    category: analysis.category || '待分類',
    brief: analysis.brief || '',
    angle: analysis.angle || '',
    topicPotential: analysis.topicPotential || '中',
    specialTopic: analysis.specialTopic || '無',
    categoryReason: analysis.categoryReason || '',
    categoryConfidence: analysis.categoryConfidence,
    matchedEntities: analysis.matchedEntities || '無',
    classificationWarning: analysis.classificationWarning || '',
    storyKey: normalizeStoryKey_(analysis.storyKey, analysis)
  };

  const auditText = [
    audited.title,
    audited.brief,
    audited.outline,
    audited.angle,
    String(webResult && webResult.mainText ? webResult.mainText : ''),
    url || ''
  ].join('\n');

  const topicText = [audited.category, audited.specialTopic, audited.matchedEntities].join(' ');

  if (containsAnyNewsKeyword_(topicText, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX']) &&
      !containsAnyNewsKeyword_(auditText, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX', 'X 平台', 'x.com'])) {
    audited.specialTopic = removeSpecialTopicTerms_(audited.specialTopic, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX']);
    if (containsAnyNewsKeyword_(audited.storyKey, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX'])) {
      audited.storyKey = normalizeStoryKey_('', audited);
    }
    if (audited.category === '馬斯克') audited.category = '待分類';
    audited.classificationWarning = appendClassificationWarning_(audited.classificationWarning, '特殊主題疑似誤判：內容未出現馬斯克相關關鍵字');
  }

  if (containsAnyNewsKeyword_(topicText, ['川普', 'Trump', 'Donald Trump', 'MAGA']) &&
      !containsAnyNewsKeyword_(auditText, ['川普', 'Trump', 'Donald Trump', '白宮', 'MAGA', '共和黨'])) {
    audited.specialTopic = removeSpecialTopicTerms_(audited.specialTopic, ['川普', 'Trump', 'Donald Trump', 'MAGA']);
    if (containsAnyNewsKeyword_(audited.storyKey, ['川普', 'Trump', 'Donald Trump', 'MAGA'])) {
      audited.storyKey = normalizeStoryKey_('', audited);
    }
    if (audited.category === '川普') audited.category = '待分類';
    audited.classificationWarning = appendClassificationWarning_(audited.classificationWarning, '特殊主題疑似誤判：內容未出現川普相關關鍵字');
  }

  if (audited.categoryConfidence !== '' && Number(audited.categoryConfidence) < 0.55) {
    audited.classificationWarning = appendClassificationWarning_(audited.classificationWarning, '分類信心偏低');
  }

  if (audited.category === '待分類' && audited.title && audited.brief && audited.outline) {
    audited.classificationWarning = appendClassificationWarning_(audited.classificationWarning, '待分類');
  }

  return audited;
}

function containsAnyNewsKeyword_(text, keywords) {
  const normalizedText = String(text || '').toLowerCase();
  return (keywords || []).some(function(keyword) {
    return normalizedText.indexOf(String(keyword || '').toLowerCase()) >= 0;
  });
}

function removeSpecialTopicTerms_(specialTopic, termsToRemove) {
  const raw = String(specialTopic || '').trim();
  if (!raw || raw === '無') return '無';

  const terms = raw.split(/[、,，/／;；]/).map(function(term) {
    return term.trim();
  }).filter(function(term) {
    if (!term) return false;
    return !containsAnyNewsKeyword_(term, termsToRemove);
  });

  return terms.length ? terms.join('、') : '無';
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
    Outline: truncateForSheet(item.outline || ''),
    SpecialTopic: truncateForSheet(item.specialTopic || '無'),
    CategoryReason: truncateForSheet(item.categoryReason || ''),
    CategoryConfidence: item.categoryConfidence === '' || typeof item.categoryConfidence === 'undefined' ? '' : item.categoryConfidence,
    MatchedEntities: truncateForSheet(item.matchedEntities || '無'),
    ClassificationWarning: truncateForSheet(item.classificationWarning || ''),
    StoryKey: truncateForSheet(normalizeStoryKey_(item.storyKey, item))
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
  if (isRemovedWeeklyNews24HourQuery_(userPrompt)) {
    return getBotTextWeeklyNews24HourRemoved_();
  }

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

function isRemovedWeeklyNews24HourQuery_(userPrompt) {
  // v1.12.3 起移除低頻的 24 小時檢視；保留明確提示，避免舊指令被誤解為仍有最近一天篩選。
  const text = String(userPrompt || '').replace(/\s+/g, ' ').trim();
  return /24\s*小時|24\s*小时|一天|1\s*天/.test(text);
}

function handleNewsQuestion_(event, conversationId, userPrompt) {
  const queryOptions = parseNewsQuestionOptions_(userPrompt);
  if (!queryOptions.question) {
    return getBotTextNewsQuestionNeedQuestion_();
  }

  const items = getRecentNewsInboxItems_(conversationId, queryOptions.days);
  const filteredItems = filterWeeklyNewsItems_(items, queryOptions);
  if (!filteredItems.length) {
    return getBotTextNewsQuestionNoData_(queryOptions);
  }

  const prompt = buildNewsQuestionPrompt_(conversationId, filteredItems, queryOptions);
  const answerText = String(callDeepSeekDirect(prompt, 'news_question') || '').trim();
  return answerText || getBotTextEmptyReply_();
}

function parseNewsQuestionOptions_(userPrompt) {
  let text = String(userPrompt || '').replace(/\s+/g, ' ').trim();
  const options = {
    days: DEFAULT_WEEKLY_NEWS_DAYS,
    onlyHighPotential: false,
    categoryFilter: '',
    question: '',
    rawText: text
  };

  if (!text) return options;

  if (text.indexOf('高潛力') >= 0) {
    options.onlyHighPotential = true;
    text = text.replace(/高潛力/g, ' ').replace(/\s+/g, ' ').trim();
  }

  const categoryResult = extractNewsQuestionCategory_(text);
  if (categoryResult.categoryFilter) {
    options.categoryFilter = categoryResult.categoryFilter;
    text = categoryResult.questionText;
  }

  options.question = text.trim();
  return options;
}

function extractNewsQuestionCategory_(text) {
  const match = String(text || '').match(/^(.*?)分類\s+(.+)$/);
  if (!match) {
    return {
      categoryFilter: '',
      questionText: String(text || '').trim()
    };
  }

  const beforeText = String(match[1] || '').trim();
  const tailText = String(match[2] || '').trim();
  const categories = getAllNewsCategoryValues_().slice().sort(function(a, b) {
    return b.length - a.length;
  });

  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    if (tailText === category || tailText.indexOf(category + ' ') === 0 || tailText.indexOf(category + '　') === 0) {
      return {
        categoryFilter: category,
        questionText: [beforeText, tailText.slice(category.length).trim()].filter(function(part) {
          return part !== '';
        }).join(' ')
      };
    }
  }

  return {
    categoryFilter: '',
    questionText: String(text || '').trim()
  };
}

function buildNewsQuestionPrompt_(conversationId, items, queryOptions) {
  const options = queryOptions || {};
  const archiveText = getRecentWeeklySummaryText(
    conversationId,
    DEFAULT_WEEKLY_NEWS_ARCHIVE_MEMORY_COUNT,
    WEEKLY_ARCHIVE_TYPE_NEWS
  );

  return [
    '請根據以下 NewsInbox 新聞素材，回答使用者的問題。',
    '',
    '使用者問題：',
    options.question,
    '',
    '範圍：',
    '最近 ' + (Number(options.days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天' +
      (options.onlyHighPotential ? '、高潛力' : '') +
      (options.categoryFilter ? '、分類「' + options.categoryFilter + '」' : ''),
    '',
    '回答規則：',
    '1. 只能根據下方 NewsInbox 與新聞封存脈絡回答，不要補充外部資訊。',
    '2. NewsInbox 是主要依據；新聞封存只能作為過去脈絡，不可當成本週新聞事實。',
    '3. 如果資料不足，請明確說「目前素材池看不出來」。',
    '4. 回答中的相關素材必須附完整原文網址，不可只寫網域。',
    '5. 使用繁體中文，不要使用 Markdown 表格。',
    '6. 請用以下格式：',
    '簡答：',
    '依據：',
    '相關素材：',
    '',
    'NewsInbox 素材：',
    formatNewsItemsForQuestion_(items),
    '',
    '過去新聞封存脈絡（可作輔助，不可取代 NewsInbox）：',
    archiveText || '無'
  ].join('\n');
}

function formatNewsItemsForQuestion_(items) {
  return (items || []).slice()
    .sort(function(a, b) {
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
    })
    .slice(0, MAX_NEWS_QUESTION_ITEMS)
    .map(function(item, index) {
      return [
        '【素材 ' + (index + 1) + '】',
        '故事線：' + normalizeStoryKey_(item.storyKey, item),
        '分類：' + (item.category || '待分類'),
        item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : '',
        item.matchedEntities && item.matchedEntities !== '無' ? '辨識實體：' + item.matchedEntities : '',
        '標題：' + (item.title || '未取得標題'),
        '簡介：' + (item.brief || '無'),
        '大綱：' + (item.outline || '無'),
        '切角：' + (item.angle || '無'),
        '節目潛力：' + (item.topicPotential || '中'),
        item.classificationWarning ? '分類警告：' + item.classificationWarning : '',
        '原文網址：' + (item.url || '未記錄網址')
      ].filter(function(line) {
        return line !== '';
      }).join('\n');
    }).join('\n\n');
}

function parseWeeklyNewsQueryOptions_(userPrompt) {
  const text = String(userPrompt || '').replace(/\s+/g, ' ').trim();
  const options = {
    days: DEFAULT_WEEKLY_NEWS_DAYS,
    viewMode: 'compact',
    onlyHighPotential: false,
    categoryFilter: '',
    rawText: text
  };

  if (!text) return options;

  if (text.indexOf('高潛力') >= 0) {
    options.onlyHighPotential = true;
  }

  if (text.indexOf('詳細') >= 0) {
    options.viewMode = 'detailed';
  }

  if (text.indexOf('精簡') >= 0) {
    options.viewMode = 'compact';
  }

  if (text.indexOf('診斷') >= 0) {
    options.viewMode = 'diagnostic';
  }

  const categoryMatch = text.match(/(?:^|\s)分類\s+(.+)$/);
  if (categoryMatch && categoryMatch[1]) {
    const categoryText = categoryMatch[1]
      .replace(/高潛力/g, '')
      .replace(/詳細/g, '')
      .replace(/精簡/g, '')
      .replace(/診斷/g, '')
      .trim();
    options.categoryFilter = normalizeWeeklyNewsCategoryFilter_(categoryText);
  }

  return options;
}

function normalizeWeeklyNewsCategoryFilter_(categoryText) {
  const raw = String(categoryText || '').trim();
  if (!raw) return '';
  const categories = getAllNewsCategoryValues_();
  if (categories.indexOf(raw) >= 0) return raw;

  const compactRaw = raw.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    if (category.replace(/\s+/g, '').toLowerCase() === compactRaw) {
      return category;
    }
  }

  return raw;
}

function getAllNewsCategoryValues_() {
  const values = [];
  NEWS_PRIMARY_CATEGORIES.concat(NEWS_INBOX_CATEGORIES).forEach(function(category) {
    if (values.indexOf(category) < 0) values.push(category);
  });
  return values;
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
    const rawStoryKey = getRowValueByHeader_(row, headerMap, 'StoryKey');
    const item = {
      createdAt: getRowValueByHeader_(row, headerMap, 'CreatedAt'),
      conversationId: getRowValueByHeader_(row, headerMap, 'ConversationId'),
      url: getRowValueByHeader_(row, headerMap, 'Url'),
      title: getRowValueByHeader_(row, headerMap, 'Title'),
      category: getRowValueByHeader_(row, headerMap, 'Category'),
      brief: getRowValueByHeader_(row, headerMap, 'Brief'),
      outline: getRowValueByHeader_(row, headerMap, 'Outline'),
      angle: getRowValueByHeader_(row, headerMap, 'Angle'),
      topicPotential: getRowValueByHeader_(row, headerMap, 'TopicPotential'),
      specialTopic: getRowValueByHeader_(row, headerMap, 'SpecialTopic'),
      categoryReason: getRowValueByHeader_(row, headerMap, 'CategoryReason'),
      categoryConfidence: getRowValueByHeader_(row, headerMap, 'CategoryConfidence'),
      matchedEntities: getRowValueByHeader_(row, headerMap, 'MatchedEntities'),
      classificationWarning: getRowValueByHeader_(row, headerMap, 'ClassificationWarning'),
      storyKeyRaw: rawStoryKey,
      storyKeyWasMissing: !String(rawStoryKey || '').trim(),
      status: getRowValueByHeader_(row, headerMap, 'Status')
    };
    item.storyKey = normalizeStoryKey_(rawStoryKey, item);
    return item;
  }).filter(function(item) {
    const createdAtTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    return item.conversationId === conversationId &&
            item.status === 'ok' &&
            createdAtTime >= cutoffTime;
  }).sort(function(a, b) {
    return compareNewsItemsForDisplay_(a, b);
  });
}

function formatWeeklyNewsDigest_(items, queryOptions) {
  const options = queryOptions || {};

  if (options.viewMode === 'diagnostic') {
    return formatWeeklyNewsDiagnosticDigest_(items, options);
  }

  if (options.viewMode === 'compact') {
    return formatWeeklyNewsCompactDigest_(items, options);
  }

  if (options.viewMode === 'detailed') {
    return formatWeeklyNewsDetailedDigest_(items, options);
  }

  return formatWeeklyNewsDefaultDigest_(items, options);
}

function formatWeeklyNewsDefaultDigest_(items, queryOptions) {
  const groupedResult = groupNewsItemsByCategory_(items);

  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];
  groupedResult.categories.forEach(function(category) {
    lines.push('', '【' + category + '】');
    groupedResult.grouped[category].forEach(function(item, index) {
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
  const groupedResult = groupNewsItemsByCategory_(items);

  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];
  groupedResult.categories.forEach(function(category) {
    lines.push('', '【' + category + '】');
    groupedResult.grouped[category].forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.title || '未取得標題'),
        '來源：' + (item.url || ''),
        '故事線：' + normalizeStoryKey_(item.storyKey, item),
        '主分類：' + (item.category || '待分類'),
        '內容大綱：' + (item.outline || item.brief || '無'),
        item.angle ? '切角：' + item.angle : '',
        '節目潛力：' + (item.topicPotential || '中'),
        item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : ''
      );
    });
  });

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function formatWeeklyNewsCompactDigest_(items, queryOptions) {
  const categoryGroupedResult = groupNewsItemsByCategory_(items);
  const storyGroupedResult = groupNewsItemsByStoryKey_(items);
  const lines = [
    buildWeeklyNewsDigestHeader_(queryOptions),
    '',
    '素材概況：共 ' + (items || []).length + ' 則',
    '分類概況：' + formatWeeklyNewsCategoryCounts_(categoryGroupedResult),
    '故事線概況：' + formatWeeklyNewsStoryCounts_(storyGroupedResult)
  ];

  const groupsToShow = storyGroupedResult.groups.slice(0, MAX_WEEKLY_NEWS_STORY_GROUPS);
  groupsToShow.forEach(function(group) {
    const categoryText = formatCategoryListForStoryGroup_(group.items);
    const potentialText = getHighestTopicPotential_(group.items);
    const headerParts = [
      '【' + group.storyKey + '】' + group.items.length + ' 則',
      potentialText ? '最高潛力：' + potentialText : '',
      categoryText
    ].filter(function(part) {
      return String(part || '').trim() !== '';
    });

    lines.push('', headerParts.join('｜'));

    group.items.slice(0, MAX_WEEKLY_NEWS_ITEMS_PER_STORY_GROUP).forEach(function(item, index) {
      lines.push(
        (index + 1) + '. ' + (item.title || '未取得標題'),
        '來源：' + (item.url || '')
      );
    });

    if (group.items.length > MAX_WEEKLY_NEWS_ITEMS_PER_STORY_GROUP) {
      lines.push('還有 ' + (group.items.length - MAX_WEEKLY_NEWS_ITEMS_PER_STORY_GROUP) + ' 則同故事線素材未列出。');
    }
  });

  if (storyGroupedResult.groups.length > MAX_WEEKLY_NEWS_STORY_GROUPS) {
    lines.push(
      '',
      '還有 ' + (storyGroupedResult.groups.length - MAX_WEEKLY_NEWS_STORY_GROUPS) + ' 條故事線未列出。',
      '可以用 #本週新聞 詳細、#本週新聞 分類 <分類名> 或 #新聞問答 <問題> 縮小範圍。'
    );
  }

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function formatWeeklyNewsDiagnosticDigest_(items, queryOptions) {
  // 診斷模式只讀 NewsInbox 現有欄位，不呼叫 LLM；用來快速找出需要人工檢查的分類結果。
  const diagnosticContext = buildWeeklyNewsDiagnosticContext_(items);
  const diagnosticItems = (items || []).map(function(item) {
    return {
      item: item,
      issues: getWeeklyNewsDiagnosticIssues_(item, diagnosticContext)
    };
  }).filter(function(result) {
    return result.issues.length > 0;
  });

  if (!diagnosticItems.length) {
    return getBotTextWeeklyNewsDiagnosticNoIssue_(queryOptions);
  }

  const lines = [buildWeeklyNewsDigestHeader_(queryOptions)];
  lines.push('我找到 ' + diagnosticItems.length + ' 則可能需要人工看一下的分類：');

  diagnosticItems.slice(0, 20).forEach(function(result, index) {
    const item = result.item;
    const suggestion = buildWeeklyNewsDiagnosticSuggestion_(item, result.issues);
    lines.push(
      '',
      (index + 1) + '. ' + (item.title || '未取得標題'),
      '故事線：' + normalizeStoryKey_(item.storyKey, item),
      '目前分類：' + (item.category || '待分類') + (item.specialTopic && item.specialTopic !== '無' ? ' / 特殊主題：' + item.specialTopic : ''),
      '來源：' + (item.url || ''),
      '問題：' + result.issues.join('；'),
      suggestion ? '建議：' + suggestion : ''
    );
  });

  if (diagnosticItems.length > 20) {
    lines.push('', '還有 ' + (diagnosticItems.length - 20) + ' 則未列出，可縮小時間或分類再查。');
  }

  return lines.filter(function(line) { return line !== ''; }).join('\n');
}

function buildWeeklyNewsDiagnosticContext_(items) {
  const context = {
    urlCounts: {},
    titleCounts: {},
    storyCategoryMap: {}
  };

  (items || []).forEach(function(item) {
    const normalizedUrl = normalizeNewsUrlForDuplicateCheck_(item.url);
    if (normalizedUrl) {
      context.urlCounts[normalizedUrl] = (context.urlCounts[normalizedUrl] || 0) + 1;
    }

    const normalizedTitle = normalizeNewsTitleForDuplicateCheck_(item.title);
    if (normalizedTitle) {
      context.titleCounts[normalizedTitle] = (context.titleCounts[normalizedTitle] || 0) + 1;
    }

    const storyKey = normalizeStoryKey_(item.storyKey, item);
    if (!context.storyCategoryMap[storyKey]) {
      context.storyCategoryMap[storyKey] = {};
    }
    context.storyCategoryMap[storyKey][item.category || '待分類'] = true;
  });

  return context;
}

function getWeeklyNewsDiagnosticIssues_(item, diagnosticContext) {
  const issues = [];
  const context = diagnosticContext || buildWeeklyNewsDiagnosticContext_([item]);
  const category = String(item.category || '').trim() || '待分類';
  const confidence = normalizeCategoryConfidence_(item.categoryConfidence);
  const warning = String(item.classificationWarning || '').trim();
  const auditText = getNewsItemAuditText_(item);
  const storyKey = normalizeStoryKey_(item.storyKey, item);
  const topicText = [category, item.specialTopic || '', item.matchedEntities || '', storyKey].join(' ');
  const normalizedUrl = normalizeNewsUrlForDuplicateCheck_(item.url);
  const normalizedTitle = normalizeNewsTitleForDuplicateCheck_(item.title);
  const storyCategories = context.storyCategoryMap[storyKey]
    ? Object.keys(context.storyCategoryMap[storyKey])
    : [];

  if (!item.title || (!item.brief && !item.outline)) {
    issues.push('標題或內容摘要不足');
  }

  if (item.storyKeyWasMissing || storyKey === NEWS_STORY_FALLBACK_KEY) {
    issues.push('StoryKey 空白或使用舊資料 fallback');
  }

  if (normalizedUrl && context.urlCounts[normalizedUrl] > 1) {
    issues.push('同 URL 重複入庫');
  }

  if (normalizedTitle && context.titleCounts[normalizedTitle] > 1) {
    issues.push('標題正規化後重複，疑似重複素材');
  }

  if (storyCategories.length > 1) {
    issues.push('同故事線跨多個分類，請確認是否合理：' + storyCategories.join(' / '));
  }

  if (category === '待分類') {
    issues.push('目前仍是待分類');
  }

  if (confidence !== '' && Number(confidence) < 0.55) {
    issues.push('分類信心低於 0.55');
  }

  if (warning) {
    issues.push('分類警告：' + warning);
  }

  const storyGuessedCategory = guessNewsCategoryByKeywords_({
    title: storyKey,
    brief: '',
    outline: '',
    angle: '',
    url: ''
  });

  if (storyGuessedCategory && storyGuessedCategory !== category) {
    issues.push('category 和 StoryKey 可能不一致，請確認是否應為「' + storyGuessedCategory + '」');
  }

  if (containsAnyNewsKeyword_(topicText, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX']) &&
      !containsAnyNewsKeyword_(auditText, ['馬斯克', 'Musk', 'Elon', 'Tesla', '特斯拉', 'SpaceX', 'X 平台', 'x.com'])) {
    issues.push('馬斯克 / Tesla / SpaceX 標籤缺少內容關鍵字支撐');
  }

  if (containsAnyNewsKeyword_(topicText, ['川普', 'Trump', 'Donald Trump', 'MAGA']) &&
      !containsAnyNewsKeyword_(auditText, ['川普', 'Trump', 'Donald Trump', '白宮', 'MAGA', '共和黨'])) {
    issues.push('川普標籤缺少內容關鍵字支撐');
  }

  return issues;
}

function buildWeeklyNewsDiagnosticSuggestion_(item, issues) {
  const guessedCategory = guessNewsCategoryByKeywords_(item);
  const suggestions = [];

  if (guessedCategory && guessedCategory !== item.category) {
    suggestions.push('可檢查是否改為「' + guessedCategory + '」');
  }

  if (String(item.category || '').trim() === '待分類' && !guessedCategory) {
    suggestions.push('可人工補上主要分類或重新補充素材');
  }

  if (issues.join('；').indexOf('特殊主題') >= 0 || String(item.classificationWarning || '').indexOf('特殊主題') >= 0) {
    suggestions.push('可確認 SpecialTopic / MatchedEntities 是否誤帶人物或公司名稱');
  }

  if (issues.join('；').indexOf('StoryKey') >= 0 || issues.join('；').indexOf('故事線') >= 0) {
    suggestions.push('可補上更穩定的故事線名稱，避免同事件被拆散');
  }

  return suggestions.join('；');
}

function guessNewsCategoryByKeywords_(item) {
  const text = getNewsItemAuditText_(item);
  if (containsAnyNewsKeyword_(text, ['法院', '訴訟', '反壟斷', '調查', '監管', '政策', '法案', '政府', '規範', '個資'])) return '公共政策';
  if (containsAnyNewsKeyword_(text, ['AI', '人工智慧', '模型', 'OpenAI', 'Gemini', '晶片', '半導體', '機器人', 'RAM', 'DRAM', 'HBM', 'NAND', '記憶體', '美光', '海力士', '三星', 'Micron', 'AMD', 'NVIDIA'])) return '科技與 AI';
  if (containsAnyNewsKeyword_(text, ['炎上', '抵制', '道歉', '網友', '社群熱議', '社群', 'YouTube', 'TikTok', 'Instagram', 'Threads', 'X 平台', '網紅', '迷因'])) return '社群輿論';
  if (containsAnyNewsKeyword_(text, ['Steam', 'SteamOS', 'Valve', 'Xbox', 'PS6', 'PlayStation', 'GTA', '遊戲平台', '動畫', '漫畫', '遊戲', '電影', '影集', 'ACG', 'VTuber', '作品'])) return 'ACG娛樂';
  if (containsAnyNewsKeyword_(text, ['家樂福', '量販', '超市', '通路', '品牌改名', '股價', '財報', '投資', '併購', '營收', '商業', '市場', '供應鏈', '價格'])) return '商業財經';
  if (containsAnyNewsKeyword_(text, ['川普', '白宮', '國會', '中國', '美國', '歐盟', '戰爭', '外交'])) return '國際政治';
  if (containsAnyNewsKeyword_(text, ['體育', '棒球', '籃球', '足球', '賽事', '選手'])) return '體育娛樂';
  if (containsAnyNewsKeyword_(text, ['生活', '文化', '消費', '旅遊', '美食', '健康', '天氣', '熱浪', '冷氣'])) return '生活文化';
  return '';
}

function getNewsItemAuditText_(item) {
  return [
    item.storyKey || '',
    item.title || '',
    item.brief || '',
    item.outline || '',
    item.angle || '',
    item.url || ''
  ].join('\n');
}

function normalizeNewsUrlForDuplicateCheck_(url) {
  const raw = String(url || '')
    .trim()
    .toLowerCase()
    .replace(/#.*$/, '');
  if (!raw) return '';

  const parts = raw.split('?');
  const baseUrl = parts[0].replace(/\/$/, '');
  const queryText = parts.slice(1).join('?');
  if (!queryText) return baseUrl;

  const keptParams = queryText.split('&').filter(function(param) {
    const key = String(param || '').split('=')[0];
    return key &&
      key.indexOf('utm_') !== 0 &&
      key !== 'fbclid' &&
      key !== 'gclid';
  });

  return keptParams.length ? baseUrl + '?' + keptParams.sort().join('&') : baseUrl;
}

function normalizeNewsTitleForDuplicateCheck_(title) {
  return String(title || '')
    .replace(/^Re[：:]\s*/ig, '')
    .replace(/\[(新聞|閒聊|討論|情報|問卦|公告|心得)\]/g, '')
    .replace(/【(新聞|閒聊|討論|情報|問卦|公告|心得)】/g, '')
    .replace(/[　\s]/g, '')
    .replace(/[，,。．.！!？?：:；;、／/\\｜|()（）\[\]【】「」『』"'“”‘’\-＿_~～]/g, '')
    .toLowerCase()
    .trim();
}

function groupNewsItemsByCategory_(items) {
  const grouped = {};
  (items || []).slice().sort(compareNewsItemsForDisplay_).forEach(function(item) {
    const category = item.category || '待分類';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });

  return {
    grouped: grouped,
    categories: Object.keys(grouped).sort(function(a, b) {
      return getNewsCategoryOrderIndex_(a) - getNewsCategoryOrderIndex_(b) ||
             String(a || '').localeCompare(String(b || ''), 'zh-Hant');
    })
  };
}

function formatWeeklyNewsCategoryCounts_(groupedResult) {
  return groupedResult.categories.map(function(category) {
    return category + ' ' + groupedResult.grouped[category].length;
  }).join('、');
}

function groupNewsItemsByStoryKey_(items) {
  const grouped = {};

  (items || []).slice().forEach(function(item) {
    const storyKey = normalizeStoryKey_(item.storyKey, item);
    if (!grouped[storyKey]) {
      grouped[storyKey] = {
        storyKey: storyKey,
        items: [],
        highPotentialCount: 0,
        latestTime: 0
      };
    }

    const group = grouped[storyKey];
    group.items.push(item);
    if (item.topicPotential === '高') group.highPotentialCount++;

    const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    if (!isNaN(itemTime)) group.latestTime = Math.max(group.latestTime, itemTime);
  });

  const groups = Object.keys(grouped).map(function(storyKey) {
    const group = grouped[storyKey];
    group.items = group.items.slice().sort(compareNewsItemsWithinStoryGroup_);
    return group;
  }).sort(compareNewsStoryGroupsForDisplay_);

  return {
    grouped: grouped,
    groups: groups
  };
}

function compareNewsStoryGroupsForDisplay_(a, b) {
  const highPotentialCompare = (b.highPotentialCount || 0) - (a.highPotentialCount || 0);
  if (highPotentialCompare !== 0) return highPotentialCompare;

  const countCompare = (b.items ? b.items.length : 0) - (a.items ? a.items.length : 0);
  if (countCompare !== 0) return countCompare;

  const timeCompare = (b.latestTime || 0) - (a.latestTime || 0);
  if (timeCompare !== 0) return timeCompare;

  return String(a.storyKey || '').localeCompare(String(b.storyKey || ''), 'zh-Hant');
}

function compareNewsItemsWithinStoryGroup_(a, b) {
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const timeCompare = (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
  if (timeCompare !== 0) return timeCompare;

  const categoryCompare = getNewsCategoryOrderIndex_(a.category) - getNewsCategoryOrderIndex_(b.category);
  if (categoryCompare !== 0) return categoryCompare;

  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
}

function formatWeeklyNewsStoryCounts_(groupedResult) {
  const groups = (groupedResult && groupedResult.groups) ? groupedResult.groups : [];
  const visibleGroups = groups.slice(0, 10).map(function(group) {
    return group.storyKey + ' ' + group.items.length;
  });

  if (groups.length > visibleGroups.length) {
    visibleGroups.push('另 ' + (groups.length - visibleGroups.length) + ' 條故事線');
  }

  return visibleGroups.join('、') || '無';
}

function formatCategoryListForStoryGroup_(items) {
  const groupedResult = groupNewsItemsByCategory_(items || []);
  return groupedResult.categories.join(' / ');
}

function getHighestTopicPotential_(items) {
  const order = { '高': 3, '中': 2, '低': 1 };
  let best = '';
  let bestScore = 0;

  (items || []).forEach(function(item) {
    const value = item.topicPotential || '中';
    const score = order[value] || 0;
    if (score > bestScore) {
      best = value;
      bestScore = score;
    }
  });

  return best;
}

function compareNewsItemsForDisplay_(a, b) {
  const categoryCompare = getNewsCategoryOrderIndex_(a.category) - getNewsCategoryOrderIndex_(b.category);
  if (categoryCompare !== 0) return categoryCompare;
  const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  return (isNaN(bTime) ? 0 : bTime) - (isNaN(aTime) ? 0 : aTime);
}

function getNewsCategoryOrderIndex_(category) {
  const normalized = String(category || '待分類').trim() || '待分類';
  const index = NEWS_CATEGORY_DISPLAY_ORDER.indexOf(normalized);
  return index >= 0 ? index : NEWS_CATEGORY_DISPLAY_ORDER.length;
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
  } else if (options.viewMode === 'diagnostic') {
    parts.push('診斷');
  }

  return '我把' + parts.join('、') + '的新聞素材翻出來了：';
}

function formatWeeklyNewsPeriodLabel_(days) {
  return '最近 ' + (Number(days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天';
}

function shouldBuildWeeklyNewsMemoryBridge_(queryOptions) {
  const options = queryOptions || {};

  // 「高潛力 / 分類 / 精簡 / 診斷」都屬於聚焦檢視；
  // 這些模式只輸出篩選後素材，避免額外補過去脈絡造成「只看」語意混淆。
  if (options.viewMode === 'compact' ||
      options.viewMode === 'diagnostic' ||
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
      '故事線：' + normalizeStoryKey_(item.storyKey, item),
      '分類：' + (item.category || '待分類'),
      item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : '',
      '標題：' + (item.title || '未取得標題'),
      '簡介：' + (item.brief || '無'),
      '大綱：' + (item.outline || '無'),
      '來源：' + (item.url || '')
    ].filter(function(line) { return line !== ''; }).join('\n');
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
      '故事線：' + normalizeStoryKey_(item.storyKey, item),
      '分類：' + (item.category || '待分類'),
      item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : '',
      '網址：' + (item.url || ''),
      '內容大綱：' + (item.outline || item.brief || '無'),
      '節目切角：' + (item.angle || '無'),
      '節目潛力：' + (item.topicPotential || '中'),
      item.classificationWarning ? '分類警告：' + item.classificationWarning : ''
    ].filter(function(line) { return line !== ''; }).join('\n');
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
    outline: '',
    specialTopic: parsed.specialTopic || '無',
    categoryReason: parsed.categoryReason || '',
    categoryConfidence: parsed.categoryConfidence,
    matchedEntities: parsed.matchedEntities || '無',
    classificationWarning: parsed.classificationWarning || '',
    storyKey: parsed.storyKey
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
      topicPotential: normalizeTopicPotential_(result.topicPotential),
      specialTopic: normalizeSpecialTopic_(result.specialTopic),
      categoryReason: normalizeCategoryReason_(result.categoryReason),
      categoryConfidence: normalizeCategoryConfidence_(result.categoryConfidence),
      matchedEntities: normalizeMatchedEntities_(result.matchedEntities),
      classificationWarning: normalizeClassificationWarning_(result.classificationWarning),
      storyKey: normalizeStoryKey_(result.storyKey, {
        title: result.title,
        specialTopic: result.specialTopic,
        matchedEntities: result.matchedEntities,
        category: result.category,
        url: extractUrls(userText)[0] || ''
      })
    };
  } catch (error) {
    console.error('parseManualNewsSupplement_ failed:', error && error.stack ? error.stack : error);
    return {
      title: '人工補充素材',
      category: '待分類',
      brief: normalizeNewsInboxBrief_(userText),
      angle: '',
      topicPotential: '中',
      specialTopic: '無',
      categoryReason: '',
      categoryConfidence: '',
      matchedEntities: '無',
      classificationWarning: '人工補充未經完整分類稽核',
      storyKey: normalizeStoryKey_('', {
        title: userText,
        category: '待分類',
        url: extractUrls(userText)[0] || ''
      })
    };
  }
}

function buildManualNewsSupplementPrompt_(userText) {
  return [
    '請把以下使用者補充的新聞素材整理成 JSON。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '主要分類 category 只能從以下清單選一個：' + NEWS_PRIMARY_CATEGORIES.join('、'),
    '不要把「馬斯克」或「川普」當作 category；若素材明確涉及這些人物，請放在 specialTopic。',
    'topicPotential 只能是：低、中、高。',
    'specialTopic 請填人物、公司、平台、政策、作品、產品或事件名稱；沒有則填「無」。',
    'categoryReason 請用 30～60 個中文字說明分類理由。',
    'categoryConfidence 請填 0 到 1 的數字。',
    'matchedEntities 請列出主要人物、公司、平台、政策、作品、產品或事件名稱；沒有則填「無」。',
    'classificationWarning 正常請填空字串；若分類不確定、素材不足或疑似錯分，請寫簡短警告。',
    'storyKey 請填同一新聞事件線 / 同一討論主題線的短名稱，使用繁體中文，8～24 個中文字為佳；不要只填分類或單一人物。',
    'brief 請以 30～50 個中文字整理成自然短簡介；如果素材本身很短，可以少於 30 字，不要硬湊字數。',
    '',
    '使用者輸入：',
    userText
  ].join('\n');
}
