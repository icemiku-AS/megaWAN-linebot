// ======================================================
// 13_NewsInbox.gs
// v1.10.7 NewsInbox Queue Hotfix：新聞素材池、新聞網址佇列、#本週新聞、#新聞補充。
//
// 維護重點：
// 1. 直接貼網址只收件分類，不產生懶人包。
// 2. NewsUrlQueue 用 time-driven trigger 慢慢處理，每次最多 2 筆。
// 3. v1.10.5 起，自動網址入庫會先透過 16_ReaderLayer.gs 取得 mainText，再交給 Gemini 分類。
// 4. v1.10.7 起，X / Facebook / Threads 這類已知未支援平台會在入隊前直接攔截，不再進 NewsUrlQueue 重試。
// 5. v1.10.7 起，背景處理若遇到永久性錯誤，會直接 failed 並建立 PendingReplies，不再無效重試三次。
// 6. DeepSeek 負責 #新聞補充 解析。
// 7. v1.10.1 起，#本週新聞 改由程式端固定排版，確保 LINE 內換行穩定。
// 8. 本檔盡量不改動舊 WebTaskQueue，避免影響 #懶人包 / #節目話題分析。
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

function enqueueNewsUrlTasks(event, conversationId, userText) {
  const urls = extractUrls(userText).slice(0, MAX_NEWS_URLS_PER_MESSAGE);
  if (!urls.length) return { ok: false, error: getBotTextNoReadableUrl_() };

  const partitionedUrls = partitionNewsUrlsForQueue_(urls);

  // X / Facebook / Threads 目前明確不支援自動擷取。
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

    const classification = classifyNewsUrlWithGemini_(task.url, webResult);

    if (isWeakAutoNewsClassification_(classification, task.url)) {
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
      title: classification.title,
      category: classification.category,
      brief: classification.brief,
      angle: classification.angle,
      topicPotential: classification.topicPotential,
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

function classifyNewsUrlWithGemini_(url, webResult) {
  const prompt = buildNewsClassificationPrompt_(url, webResult);
  const result = callGeminiJson_(prompt, buildNewsClassificationSchema_());

  return {
    title: String(result.title || webResult.title || '未取得標題').trim(),
    category: normalizeNewsCategory_(result.category),
    brief: String(result.brief || '').trim(),
    angle: String(result.angle || '').trim(),
    topicPotential: normalizeTopicPotential_(result.topicPotential)
  };
}

function buildNewsClassificationPrompt_(url, webResult) {
  return [
    '請閱讀以下網頁資料，將它分類成 Podcast「現正熱潮中」可用的新聞素材。',
    '請只輸出 JSON，不要加解釋。',
    '',
    '可用分類：' + NEWS_INBOX_CATEGORIES.join('、'),
    '分類規則：如果明顯與馬斯克相關，優先選「馬斯克」；如果明顯與川普相關，優先選「川普」。其他再依內容選分類。',
    'topicPotential 只能是：低、中、高。',
    'brief 請控制在 50 個中文字內。',
    '',
    'URL：' + url,
    '網頁標題：' + (webResult.title || ''),
    '網頁內容：',
    String(webResult.mainText || '').slice(0, 12000)
  ].join('\n');
}

function buildNewsClassificationSchema_() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      category: { type: 'string' },
      brief: { type: 'string' },
      angle: { type: 'string' },
      topicPotential: { type: 'string' }
    },
    required: ['title', 'category', 'brief', 'angle', 'topicPotential']
  };
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
    const result = parseLooseJson(callDeepSeekDirect(prompt, 'integrate_topics'));
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
