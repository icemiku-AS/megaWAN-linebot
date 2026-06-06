// ======================================================
// 13_NewsInbox.gs
// v1.10.1 News Inbox Hotfix：新聞素材池、新聞網址佇列、#本週新聞、#新聞補充。
//
// 維護重點：
// 1. 直接貼網址只收件分類，不產生懶人包。
// 2. NewsUrlQueue 用 time-driven trigger 慢慢處理，每次最多 2 筆。
// 3. Gemini 負責自動網址入庫分類；DeepSeek 負責 #新聞補充 解析。
// 4. v1.10.1 起，#本週新聞 改由程式端固定排版，確保 LINE 內換行穩定。
// 5. 本檔盡量不改動舊 WebTaskQueue，避免影響 #讀網址 / #懶人包 / #節目話題分析。
// ======================================================

const NEWS_INBOX_CATEGORIES = ['科技與 AI', '社群輿論', 'ACG娛樂', '商業財經', '國際政治', '生活文化', '馬斯克', '川普', '待分類'];
const NEWS_TOPIC_POTENTIAL_VALUES = ['低', '中', '高'];
const MAX_NEWS_QUEUE_TASKS_PER_RUN = 2;
const MAX_NEWS_URLS_PER_MESSAGE = 10;
const MAX_NEWS_QUEUE_RETRY_COUNT = 3;
const DEFAULT_WEEKLY_NEWS_DAYS = 7;

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

  const source = event.source || {};
  const sheet = ensureNewsUrlQueueSheet_();
  const now = new Date();

  urls.forEach(function(url) {
    sheet.appendRow([createSimpleId('newsq'), now, now, conversationId, source.type || '', source.userId || '', source.groupId || '', source.roomId || '', truncateForSheet(userText || ''), url, 'pending', 0, now, '', '', '', '']);
  });

  return { ok: true, urls: urls };
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

  tasksToProcess.forEach(function(task) { processSingleNewsUrlTask_(task); });
}

function processSingleNewsUrlTask_(task) {
  const sheet = ensureNewsUrlQueueSheet_();
  const headerMap = getHeaderMap_(sheet);

  try {
    const rawPage = fetchRawWebPage(task.url);
    if (!rawPage.ok) {
      if (isHardNewsUrlFailure_(rawPage)) {
        markNewsQueueTaskFailed_(sheet, headerMap, task, 'hard_fetch_failed', rawPage.error || '網址讀取失敗');
      } else {
        retryOrFailNewsQueueTask_(sheet, headerMap, task, 'temporary_fetch_failed', rawPage.error || '網址讀取暫時失敗');
      }
      return;
    }

    const classified = callGeminiNewsInboxClassifier_(task.url, rawPage.rawHtml, rawPage.contentType, task.userPrompt);

    // v1.10.1 Hotfix：
    // v1.10.0 會把 Gemini 輸出異常或內容不足的結果正規化成「待分類」後直接寫入 NewsInbox，
    // 實際使用時會造成大量「待分類 / 標題是網址 / 簡介空白」的 ok 資料。
    // 這裡把這類結果視為「分類未完成」，讓它回到 queue 重試；重試仍失敗才走 PendingReplies。
    if (isWeakAutoNewsClassification_(classified, task.url)) {
      throw new Error('Gemini 新聞分類結果不足，暫不寫入 NewsInbox，改回 NewsUrlQueue 重試。');
    }

    saveNewsInboxItem_({ conversationId: task.conversationId, sourceType: task.sourceType, userId: task.userId, groupId: task.groupId, roomId: task.roomId, url: task.url, title: classified.title, category: classified.category, brief: classified.brief, angle: classified.angle, topicPotential: classified.topicPotential, sourceMode: 'auto', status: 'ok', errorText: '' });

    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', new Date());
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'done');
    setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', new Date());
  } catch (error) {
    retryOrFailNewsQueueTask_(sheet, headerMap, task, 'gemini_or_unknown_error', String(error && error.message ? error.message : error));
  }
}

function isHardNewsUrlFailure_(rawPage) {
  const statusCode = Number(rawPage && rawPage.statusCode ? rawPage.statusCode : 0);
  const errorText = String(rawPage && rawPage.error ? rawPage.error : '');
  if ([401, 403, 404, 410, 415].indexOf(statusCode) >= 0) return true;
  return errorText.indexOf('Content-Type') >= 0 || errorText.indexOf('網址安全檢查未通過') >= 0 || errorText.indexOf('只支援一般網頁與純文字') >= 0;
}

function retryOrFailNewsQueueTask_(sheet, headerMap, task, errorType, errorText) {
  const nextRetryCount = Number(task.retryCount || 0) + 1;
  if (nextRetryCount >= MAX_NEWS_QUEUE_RETRY_COUNT) {
    markNewsQueueTaskFailed_(sheet, headerMap, task, errorType, errorText);
    return;
  }

  const delayMinutes = nextRetryCount === 1 ? 5 : 15;
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', new Date());
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'pending');
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'RetryCount', nextRetryCount);
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'NextRunAt', new Date(Date.now() + delayMinutes * 60 * 1000));
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorType', errorType);
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorText', truncateForSheet(errorText));
}

function markNewsQueueTaskFailed_(sheet, headerMap, task, errorType, errorText) {
  const now = new Date();
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'UpdatedAt', now);
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'Status', 'failed');
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorType', errorType);
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'LastErrorText', truncateForSheet(errorText));
  setCellByHeader_(sheet, task.sheetRowNumber, headerMap, 'FinishedAt', now);
  createPendingReplyFromTask({ conversationId: task.conversationId, sourceType: task.sourceType, userId: task.userId, groupId: task.groupId, roomId: task.roomId, taskType: 'news_inbox_failed' }, getBotTextNewsUrlFailed_(task.url, errorText), 'news_inbox_failed');
}

function callGeminiNewsInboxClassifier_(url, rawHtml, contentType, originalMessage) {
  const apiKey = getRequiredScriptProperty_('GEMINI_API_KEY');
  const endpoint = GEMINI_ENDPOINT_BASE + encodeURIComponent(GEMINI_MODEL) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const limitedHtml = truncateHtmlForGemini(lightCleanHtmlForExtractor(rawHtml));

  const systemInstruction = [
    '你是 Podcast「現正熱潮中」的新聞素材入庫分類器，不是評論者，也不是共同主持人。',
    '請根據 HTML 或純文字產生 Google Sheet 入庫用 JSON。',
    '分類只能選：' + NEWS_INBOX_CATEGORIES.join('、'),
    '分類優先順序：馬斯克 > 川普 > 科技與 AI > 社群輿論 > ACG娛樂 > 商業財經 > 國際政治 > 生活文化 > 待分類。',
    '如果核心主體是 Elon Musk、Tesla、SpaceX、X、xAI、Neuralink，優先分類為馬斯克。',
    '如果核心主體是 Donald Trump、川普政府、川普政策、川普選舉、川普司法或其公開發言，優先分類為川普。',
    'brief 必須 50 字以內。angle 是 12 字以內觀點標籤，可空白。topicPotential 只能是低、中、高。',
    '如果無法判斷分類，category 才能用待分類；但仍必須盡量給出 title 與 brief。',
    '只輸出合法 JSON，不要 Markdown，不要解釋。',
    '{"title":"","category":"科技與 AI","brief":"50字以內簡介","angle":"","topicPotential":"中"}'
  ].join('\n');

  const userContent = ['原始訊息：', originalMessage || '', '', 'URL:', url, '', 'Content-Type:', contentType || 'unknown', '', 'HTML_OR_TEXT:', limitedHtml].join('\n');
  const payload = { systemInstruction: { parts: [{ text: systemInstruction }] }, contents: [{ role: 'user', parts: [{ text: userContent }] }], generationConfig: buildGeminiJsonGenerationConfig_(0.2, 1600, null) };
  const response = UrlFetchApp.fetch(endpoint, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();
  if (statusCode < 200 || statusCode >= 300) throw new Error('Gemini API error ' + statusCode + ': ' + responseText);

  const json = JSON.parse(responseText);
  logGeminiUsage(json);
  const parsed = parseJsonObjectLoose(extractGeminiText(json));
  if (!parsed) throw new Error('Gemini 新聞分類回傳格式不是合法 JSON。');

  const rawCategory = String(parsed.category || '').trim();
  const rawTopicPotential = String(parsed.topicPotential || '').trim();

  return {
    title: normalizeGeminiString_(parsed.title) || url,
    category: normalizeNewsCategory_(rawCategory),
    rawCategory: rawCategory,
    brief: normalizeGeminiString_(parsed.brief).slice(0, 80),
    angle: normalizeGeminiString_(parsed.angle).slice(0, 20),
    topicPotential: normalizeNewsTopicPotential_(rawTopicPotential),
    rawTopicPotential: rawTopicPotential
  };
}

function normalizeNewsCategory_(value) {
  const text = String(value || '').trim();
  return NEWS_INBOX_CATEGORIES.indexOf(text) >= 0 ? text : '待分類';
}

function normalizeNewsTopicPotential_(value) {
  const text = String(value || '').trim();
  return NEWS_TOPIC_POTENTIAL_VALUES.indexOf(text) >= 0 ? text : '中';
}

function isWeakAutoNewsClassification_(classified, originalUrl) {
  const category = String(classified && classified.category ? classified.category : '').trim();
  const rawCategory = String(classified && classified.rawCategory ? classified.rawCategory : '').trim();
  const title = String(classified && classified.title ? classified.title : '').trim();
  const brief = String(classified && classified.brief ? classified.brief : '').trim();
  const angle = String(classified && classified.angle ? classified.angle : '').trim();

  // Gemini 沒有回傳合法分類時，不要悄悄落到「待分類」後直接入庫。
  if (!rawCategory || NEWS_INBOX_CATEGORIES.indexOf(rawCategory) < 0) return true;

  // 自動流程若回傳「待分類」，通常代表模型沒有讀懂內容或輸出品質不足；
  // 讓 queue 重試，比把未分類資料寫入 NewsInbox 更安全。
  if (category === '待分類') return true;

  // 標題是網址、簡介又空白時，幾乎等同沒有完成分類。
  const titleLooksLikeUrl = /^https?:\/\//i.test(title) || title === originalUrl;
  if (titleLooksLikeUrl && !brief && !angle) return true;

  // 標題與簡介都沒有實質內容時，也回到 queue。
  if (!title && !brief) return true;

  return false;
}

function saveNewsInboxItem_(item) {
  ensureNewsInboxSheet_().appendRow([createSimpleId('news'), new Date(), item.conversationId || '', item.sourceType || '', item.userId || '', item.groupId || '', item.roomId || '', item.url || '', truncateForSheet(item.title || ''), normalizeNewsCategory_(item.category), truncateForSheet(item.brief || ''), truncateForSheet(item.angle || ''), normalizeNewsTopicPotential_(item.topicPotential), item.sourceMode || 'auto', item.status || 'ok', truncateForSheet(item.errorText || '')]);
}

function getRecentNewsInboxItems_(conversationId, days) {
  const sheet = ensureNewsInboxSheet_();
  const headerMap = getHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const cutoff = new Date(Date.now() - (days || DEFAULT_WEEKLY_NEWS_DAYS) * 24 * 60 * 60 * 1000);
  const readRows = Math.min(lastRow - 1, 500);
  const values = sheet.getRange(lastRow - readRows + 1, 1, readRows, sheet.getLastColumn()).getValues();
  const matched = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];
    if (getRowValueByHeader_(row, headerMap, 'ConversationId') !== conversationId) continue;
    if (String(getRowValueByHeader_(row, headerMap, 'Status') || 'ok') !== 'ok') continue;
    const createdAt = getRowValueByHeader_(row, headerMap, 'CreatedAt');
    if (createdAt && new Date(createdAt).getTime() < cutoff.getTime()) continue;
    matched.push({ url: getRowValueByHeader_(row, headerMap, 'Url'), title: getRowValueByHeader_(row, headerMap, 'Title'), category: getRowValueByHeader_(row, headerMap, 'Category'), brief: getRowValueByHeader_(row, headerMap, 'Brief'), angle: getRowValueByHeader_(row, headerMap, 'Angle'), topicPotential: getRowValueByHeader_(row, headerMap, 'TopicPotential') });
  }

  matched.reverse();
  return matched;
}

function buildNewsInboxItemsText_(items) {
  return items.map(function(item, index) {
    return ['【素材 ' + (index + 1) + '】', '分類：' + (item.category || '待分類'), '標題：' + (item.title || '未命名素材'), '觀點標籤：' + (item.angle || '無'), '網址：' + (item.url || ''), '節目潛力：' + (item.topicPotential || '中'), '簡介：' + (item.brief || '無')].join('\n');
  }).join('\n\n');
}

function handleWeeklyNewsDigest_(event, conversationId, userPrompt) {
  const items = getRecentNewsInboxItems_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);
  if (!items.length) return getBotTextWeeklyNewsNoData_();
  return buildWeeklyNewsDigestWithDeepSeek_(items);
}

function buildWeeklyNewsDigestWithDeepSeek_(items) {
  // v1.10.1 Hotfix：
  // v1.10.0 讓 DeepSeek 自由輸出 #本週新聞，實測容易把多筆素材壓成一段文字，
  // 在 LINE 裡閱讀成本很高。這個功能本質上只需要「分類、排序、固定格式」，
  // 因此 hotfix 改成程式端固定排版，確保每筆都有明確換行。
  //
  // 函式名稱暫時保留 buildWeeklyNewsDigestWithDeepSeek_，避免影響其他呼叫點；
  // 之後若要整理命名，可在小版本中改成 buildWeeklyNewsDigestText_。
  return formatWeeklyNewsDigest_(items);
}

function formatWeeklyNewsDigest_(items) {
  const grouped = {};
  NEWS_INBOX_CATEGORIES.forEach(function(category) {
    if (category !== '待分類') grouped[category] = [];
  });
  grouped['待分類'] = [];

  items.forEach(function(item) {
    const category = normalizeNewsCategory_(item.category);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(item);
  });

  const blocks = ['本週新聞素材整理'];
  let sectionIndex = 1;

  NEWS_INBOX_CATEGORIES.forEach(function(category) {
    const list = grouped[category] || [];
    if (!list.length) return;

    list.sort(compareNewsItemsByPotential_);
    const lines = [toChineseSectionNumber_(sectionIndex) + '、' + category];

    list.forEach(function(item, index) {
      const title = formatNewsItemTitle_(item);
      lines.push((index + 1) + '. ' + title);
      lines.push('   來源：' + sanitizeWeeklyNewsLine_(item.url || ''));
      lines.push('   節目潛力：' + normalizeNewsTopicPotential_(item.topicPotential));
      if (index < list.length - 1) lines.push('');
    });

    blocks.push(lines.join('\n'));
    sectionIndex++;
  });

  if (blocks.length === 1) return getBotTextWeeklyNewsNoData_();
  return blocks.join('\n\n');
}

function compareNewsItemsByPotential_(a, b) {
  const scoreMap = { '高': 3, '中': 2, '低': 1 };
  const scoreA = scoreMap[normalizeNewsTopicPotential_(a.topicPotential)] || 2;
  const scoreB = scoreMap[normalizeNewsTopicPotential_(b.topicPotential)] || 2;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
}

function formatNewsItemTitle_(item) {
  const title = sanitizeWeeklyNewsLine_(item.title || '未命名素材');
  const angle = sanitizeWeeklyNewsLine_(item.angle || '');
  if (!angle || angle === '無') return title;
  return title + '（' + angle + '）';
}

function sanitizeWeeklyNewsLine_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function toChineseSectionNumber_(index) {
  const numbers = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return numbers[index - 1] || String(index);
}

function handleManualNewsSupplement_(event, conversationId, userText) {
  const urls = extractUrls(userText);
  if (!urls.length) return getBotTextManualNewsSupplementNeedUrl_();

  const parsed = parseManualNewsSupplementWithDeepSeek_(userText);
  const source = event.source || {};
  saveNewsInboxItem_({ conversationId: conversationId, sourceType: source.type || '', userId: source.userId || '', groupId: source.groupId || '', roomId: source.roomId || '', url: parsed.url || urls[0], title: parsed.title || '人工補充新聞素材', category: parsed.category, brief: parsed.brief, angle: parsed.angle, topicPotential: parsed.topicPotential, sourceMode: 'manual', status: 'ok', errorText: '' });
  return getBotTextManualNewsSupplementSaved_(parsed);
}

function parseManualNewsSupplementWithDeepSeek_(userText) {
  const prompt = ['你是新聞素材人工補充解析器。請根據使用者自然語言補充，產生一筆 NewsInbox JSON。', '分類只能選：' + NEWS_INBOX_CATEGORIES.join('、'), 'topicPotential 只能是低、中、高。brief 50 字以內。angle 12 字以內，可空白。', '只輸出合法 JSON，不要 Markdown，不要解釋。', '{"title":"","url":"","category":"社群輿論","brief":"50字以內簡介","angle":"","topicPotential":"中"}', '', '使用者補充內容：', userText].join('\n');
  const responseText = callDeepSeekApi_([{ role: 'system', content: '你是嚴格 JSON 解析器。只輸出 JSON。' }, { role: 'user', content: prompt }], 'summary');
  const parsed = parseJsonObjectLoose(responseText) || {};
  const fallbackUrl = extractUrls(userText)[0] || '';
  return { title: String(parsed.title || '').trim() || '人工補充新聞素材', url: String(parsed.url || '').trim() || fallbackUrl, category: normalizeNewsCategory_(parsed.category), brief: String(parsed.brief || '').trim().slice(0, 80), angle: String(parsed.angle || '').trim().slice(0, 20), topicPotential: normalizeNewsTopicPotential_(parsed.topicPotential) };
}
