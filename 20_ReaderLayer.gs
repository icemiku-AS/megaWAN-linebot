// ======================================================
// 20_ReaderLayer.gs
// 用途：Reader／Web workflows：統一網址讀取策略與 webResult。
//
// 職責與協作：
// 1. 供 NewsInbox 與 WebTaskQueue 取得正文；X status 用 FxTwitter，PTT 用 over18 cookie，一般網站先用 Jina。
// 2. 一般讀取在 Jina 失敗後可走 21_WebReader.gs 的 legacy extraction；快讀契約由 25_WebTaskQueue.gs 管理。
//
// 維護注意：
// 1. 維持 URL 安全檢查、共用 deadline 與 webResult 欄位；httpStatus=0 不得當成缺值。
// 2. internal read_url 的 noAi 模式禁止 legacy AI fallback，且不自動跟隨 HTTP redirect。
// 3. X 僅支援公開單篇 status；Facebook／Threads 依公開可讀性，不保證登入牆或私人內容。
// 4. 本檔管理 Reader routing，不組 provider payload，也不擁有下游業務 Prompt 或 validator。
// ======================================================

// ======================================================
// Reader Layer 常數
// ======================================================

// Jina Reader 的 URL 前綴。
// 使用方式：JINA_READER_ENDPOINT_PREFIX + 原始網址
const JINA_READER_ENDPOINT_PREFIX = 'https://r.jina.ai/';

// Reader route 名稱固定化，避免未來 Sheet 或 log 裡出現多種拼法。
const WEB_READER_ROUTE_JINA = 'jina_reader';
const WEB_READER_ROUTE_PTT_OVER18 = 'ptt_over18_cookie';
const WEB_READER_ROUTE_UNSUPPORTED_SOCIAL = 'unsupported_social_platform';
const WEB_READER_ROUTE_LEGACY = 'legacy_raw_html_ai';
// 歷史 Sheet / log 值不 migration；診斷或顯示舊資料時必須繼續辨識此值。
const WEB_READER_ROUTE_LEGACY_GEMINI = 'legacy_raw_html_gemini';
const WEB_READER_ROUTE_FXTWITTER_API = 'fxtwitter_api';

// Reader 可用性門檻。
// 一般文章保留長度門檻；PTT 在專用 parser 驗證結構後，只要求清理後正文非空。
const MIN_READER_MAIN_TEXT_LENGTH = 120;

// ======================================================
// 統一 reader 入口
// ======================================================

function fetchAndExtractWebPageByReaderLayer_(url, executionContext) {
  const safeUrl = String(url || '').trim();

  if (!isSafePublicUrl(safeUrl)) {
    return buildReaderLayerErrorResult_(safeUrl, '', 'unsafe_url', '網址安全檢查未通過。', {
      retryable: false,
      httpStatus: 0
    });
  }

  const route = detectWebReaderRoute_(safeUrl);

  if (route === WEB_READER_ROUTE_FXTWITTER_API) {
    return fetchTwitterStatusWithFxTwitter_(safeUrl, executionContext);
  }

  if (route === WEB_READER_ROUTE_UNSUPPORTED_SOCIAL) {
    return buildReaderLayerErrorResult_(
      safeUrl,
      route,
      'x_twitter_url_without_status_id',
      '這個 X / Twitter 網址不是單篇 status 貼文，v1.10.9 只支援 /status/{id} 類型的公開貼文網址。',
      { retryable: false, httpStatus: 0 }
    );
  }

  if (route === WEB_READER_ROUTE_PTT_OVER18) {
    return fetchPttArticleWithFallback_(safeUrl, executionContext);
  }

  const jinaResult = fetchReadablePageWithJina_(safeUrl, executionContext);

  if (jinaResult.ok) {
    return jinaResult;
  }

  // 模型 read_url 的 no-AI 模式必須在任何 legacy extraction 前停止，禁止巢狀 AI。
  if (executionContext && executionContext.noAi) return jinaResult;

  // absolute deadline 已耗盡時不可再嘗試 legacy；背景 Queue 會在沒有同步 context 時重新讀取。
  if (jinaResult.errorType === 'reader_sync_budget_exhausted') {
    return jinaResult;
  }

  // Jina Reader 失敗時，保留舊流程作為 fallback。
  // 這是 Reader Layer 的安全閥：先把主路徑切到 Jina，但不因單一 reader 失敗而讓所有舊網站直接不能讀。
  const legacyResult = fetchAndExtractWebPageLegacy_(safeUrl, executionContext);

  if (legacyResult && legacyResult.ok) {
    const warnings = legacyResult.warnings || [];
    warnings.unshift('Jina Reader 讀取失敗，已改用 legacy raw HTML + AI extraction。Jina 錯誤：' + (jinaResult.error || '未知錯誤'));

    legacyResult.readerRoute = WEB_READER_ROUTE_LEGACY;
    legacyResult.warnings = warnings;
    return legacyResult;
  }

  // legacy AI typed metadata 必須原樣穿越 Reader Layer，否則 NewsUrlQueue 會把缺 key、401/403
  // 等永久錯誤壓成一般 reader failure 並無效重試。普通 Reader error 才使用組合型 errorType。
  const hasLegacyAiError = isAiTypedReaderFailure_(legacyResult);
  const combinedRetryable = hasLegacyAiError
    ? resolveReaderFailureRetryable_(legacyResult)
    : (resolveReaderFailureRetryable_(jinaResult) || resolveReaderFailureRetryable_(legacyResult));
  const combinedHttpStatus = hasLegacyAiError
    ? Number(legacyResult && legacyResult.httpStatus || 0)
    : resolveCombinedReaderFailureHttpStatus_(jinaResult, legacyResult, combinedRetryable);
  return buildReaderLayerErrorResult_(
    safeUrl,
    legacyResult && legacyResult.readerRoute ? legacyResult.readerRoute : WEB_READER_ROUTE_LEGACY,
    hasLegacyAiError ? legacyResult.errorType : 'jina_and_legacy_failed',
    'Jina Reader 讀取失敗；legacy fallback 也未取得可用正文。Jina 錯誤：' +
      (jinaResult.error || '未知錯誤') +
      '；legacy 錯誤：' +
      (legacyResult && legacyResult.error ? legacyResult.error : '未知錯誤'),
    {
      retryable: combinedRetryable,
      httpStatus: combinedHttpStatus
    }
  );
}

function detectWebReaderRoute_(url) {
  const hostname = getReaderLayerHostname_(url);

  if (!hostname) {
    return WEB_READER_ROUTE_JINA;
  }

  if (canonicalizePttArticleUrl_(url)) {
    return WEB_READER_ROUTE_PTT_OVER18;
  }

  if (isTwitterLikeHostname_(hostname)) {
    return extractTwitterStatusIdFromUrl_(url) ? WEB_READER_ROUTE_FXTWITTER_API : WEB_READER_ROUTE_UNSUPPORTED_SOCIAL;
  }

  // Facebook / fb.watch / Threads.com / Threads.net 交由一般公開網址讀取流程嘗試。
  // 它們會自然走 Jina Reader；讀不到再由既有 fallback 與錯誤流程處理。
  return WEB_READER_ROUTE_JINA;
}

function getReaderLayerHostname_(url) {
  const match = String(url || '').trim().match(/^https?:\/\/([^\/?#]+)(?:[\/?#]|$)/i);
  if (!match || !match[1]) return '';

  const authority = String(match[1]);
  // URL userinfo 會出現在最後一個 @ 前；本 bot 不需要帳密網址，整類拒絕最小且不會誤判實際 host。
  // GAS V8 沒有在此 contract 中保證 WHATWG URL；IPv6 authority 也先拒絕，避免用脆弱 regex 猜冒號語意。
  if (authority.indexOf('@') >= 0 || authority.indexOf('[') >= 0 || authority.indexOf(']') >= 0) return '';

  const authorityMatch = authority.match(/^([^:]+)(?::(\d+))?$/);
  if (!authorityMatch) return '';
  if (authorityMatch[2]) {
    const port = Number(authorityMatch[2]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '';
  }

  let hostname = String(authorityMatch[1] || '').toLowerCase();
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  if (!hostname || hostname.length > 253 || hostname.indexOf('..') >= 0) return '';

  const labels = hostname.split('.');
  const validLabels = labels.every(function(label) {
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label);
  });
  return validLabels ? hostname : '';
}

function isPttHostname_(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host === 'ptt.cc' || host.endsWith('.ptt.cc');
}

// 只正規化 classic Web article；不改寫子網域、非預設 port、列表或任意 path。
function canonicalizePttArticleUrl_(url) {
  const text = String(url || '').trim();
  const match = text.match(/^(https?):\/\/(?:www\.)?ptt\.cc(?::(80|443))?(\/bbs\/[A-Za-z0-9_-]+\/M\.\d+\.A\.[A-Fa-f0-9]+\.html)(?:[?#][^\s\\]*)?$/i);
  if (!match || (match[2] && match[2] !== (match[1].toLowerCase() === 'https' ? '443' : '80'))) return '';
  return 'https://www.ptt.cc' + match[3];
}

// 舊函式名稱保留給相容與排查用。
// Facebook / Threads 不由此函式視為 unsupported；可讀性由 Reader 判斷。
function isUnsupportedSocialHostname_(hostname) {
  return isTwitterLikeHostname_(hostname);
}

function isTwitterLikeHostname_(hostname) {
  const host = String(hostname || '').toLowerCase();

  return host === 'x.com' ||
    host.endsWith('.x.com') ||
    host === 'twitter.com' ||
    host.endsWith('.twitter.com') ||
    host === 'fxtwitter.com' ||
    host.endsWith('.fxtwitter.com') ||
    host === 'fixupx.com' ||
    host.endsWith('.fixupx.com');
}

function extractTwitterStatusIdFromUrl_(url) {
  const text = String(url || '').trim();

  // /status/ 同時涵蓋 /user/status/{id} 與 /i/web/status/{id}，不需第二次匹配。
  // 只抓 snowflake 數字 ID，不處理搜尋頁、個人頁、列表頁。
  const statusMatch = text.match(/\/status\/(\d{5,})(?:[/?#]|$)/i);
  if (statusMatch && statusMatch[1]) {
    return statusMatch[1];
  }

  return '';
}

// ======================================================
// Legacy fallback：復用 21_WebReader.gs 舊流程
// ======================================================

function fetchAndExtractWebPageLegacy_(url, executionContext) {
  // 目前 21_WebReader.gs 的 fetchAndExtractWebPage(url) 代表 raw HTML + AI extraction 流程。
  // 若未來把 fetchAndExtractWebPage(url) 改成也走 Reader Layer，這裡必須同步重構，避免遞迴。
  return fetchAndExtractWebPage(url, executionContext);
}

/**
 * 舊 route 值相容判斷。新資料使用 legacy_raw_html_ai；歷史 legacy_raw_html_gemini
 * 不改寫，仍應被診斷工具視為同一類 legacy fallback。
 */
function isLegacyRawHtmlReaderRoute_(readerRoute) {
  const route = String(readerRoute || '').trim();
  return route === WEB_READER_ROUTE_LEGACY || route === WEB_READER_ROUTE_LEGACY_GEMINI;
}

// ======================================================
// X / Twitter provider：FxTwitter API
// ======================================================

function fetchTwitterStatusWithFxTwitter_(url, executionContext) {
  const statusId = extractTwitterStatusIdFromUrl_(url);

  if (!statusId) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER_API,
      'x_twitter_url_without_status_id',
      '這個 X / Twitter 網址不是單篇 status 貼文，無法用 FxTwitter API 讀取。',
      { retryable: false, httpStatus: 0 }
    );
  }

  const apiUrl = FXTWITTER_API_STATUS_ENDPOINT_PREFIX + encodeURIComponent(statusId);
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: !(executionContext && executionContext.noAi),
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; MEGAHuanBot/1.10.9; FxTwitter Reader)'
    }
  };
  if (!applyReaderFetchTimeoutForExecutionContext_(options, executionContext)) {
    return buildReaderExecutionBudgetFailure_(url, WEB_READER_ROUTE_FXTWITTER_API);
  }

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const statusCode = response.getResponseCode();
    const headers = response.getHeaders();
    const contentType = headers['Content-Type'] || headers['content-type'] || 'application/json';
    const bodyText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_FXTWITTER_API,
        'fxtwitter_fetch_failed',
        'FxTwitter API 讀取失敗，HTTP 狀態碼：' + statusCode + '；回應預覽：' + String(bodyText || '').slice(0, 500),
        buildReaderHttpFailureMetadata_(statusCode)
      );
    }

    let json = null;
    try {
      json = JSON.parse(bodyText);
    } catch (parseError) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_FXTWITTER_API,
        'fxtwitter_invalid_json',
        'FxTwitter API 有回應，但內容不是合法 JSON：' + String(bodyText || '').slice(0, 500)
      );
    }

    return normalizeFxTwitterStatusToReaderResult_(url, statusCode, contentType, json);

  } catch (error) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER_API,
      'fxtwitter_fetch_exception',
      '呼叫 FxTwitter API 時發生錯誤：' + String(error && error.message ? error.message : error)
    );
  }
}

function normalizeFxTwitterStatusToReaderResult_(url, statusCode, contentType, json) {
  if (json && json.code && Number(json.code) !== 200) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER_API,
      'fxtwitter_status_unavailable',
      'FxTwitter API 回傳 code=' + json.code + '，可能是貼文刪除、鎖帳、受限或 API 暫時不可用。'
    );
  }

  const status = extractFxTwitterStatusObject_(json);

  if (!status) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER_API,
      'fxtwitter_status_unavailable',
      'FxTwitter API 回傳中沒有可用的 status / tweet 物件，可能是貼文刪除、鎖帳、受限或 API 回傳格式變更。'
    );
  }

  const text = normalizeFxTwitterString_(status.text || status.full_text || status.description || '');
  const author = status.author || status.user || {};
  const authorName = normalizeFxTwitterString_(author.name || author.display_name || '');
  const screenName = normalizeFxTwitterString_(author.screen_name || author.username || author.handle || '');
  const publishedAt = normalizeFxTwitterString_(status.created_at || status.createdAt || status.date || '');

  if (!text) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER_API,
      'fxtwitter_empty_status_text',
      'FxTwitter API 有回應，但沒有可用貼文文字，可能是純媒體貼文、受限貼文或 API 格式變更。'
    );
  }

  const mainText = buildFxTwitterMainText_(url, status, text, authorName, screenName, publishedAt);
  const titleName = screenName ? '@' + screenName : (authorName || 'unknown');

  return buildReaderLayerSuccessResult_({
    url: url,
    statusCode: statusCode,
    contentType: contentType || 'application/json',
    title: 'X / Twitter：' + titleName + ' 的貼文',
    siteName: 'X / Twitter',
    author: buildFxTwitterAuthorLabel_(authorName, screenName),
    publishedAt: publishedAt,
    mainText: mainText,
    extractionConfidence: 0.9,
    warnings: ['X / Twitter 貼文由 FxTwitter API 讀取並轉成 Reader Layer 文字。'],
    readerRoute: WEB_READER_ROUTE_FXTWITTER_API
  });
}

function extractFxTwitterStatusObject_(json) {
  if (!json) return null;

  // FxTwitter / FixupX API 主要會回 status；保留 tweet/data 形狀作為格式變動防守。
  if (json.status) return json.status;
  if (json.tweet) return json.tweet;
  if (json.data && json.data.status) return json.data.status;
  if (json.data && json.data.tweet) return json.data.tweet;

  return null;
}

function buildFxTwitterMainText_(url, status, text, authorName, screenName, publishedAt) {
  const lines = [];

  lines.push('【平台】X / Twitter');
  lines.push('【作者】' + (buildFxTwitterAuthorLabel_(authorName, screenName) || '未知'));

  if (publishedAt) {
    lines.push('【發布時間】' + publishedAt);
  }

  lines.push('');
  lines.push('【貼文內容】');
  lines.push(text);

  const quoteText = buildFxTwitterQuoteText_(status);
  if (quoteText) {
    lines.push('');
    lines.push('【引用貼文】');
    lines.push(quoteText);
  }

  const mediaText = buildFxTwitterMediaText_(status);
  if (mediaText) {
    lines.push('');
    lines.push('【媒體】');
    lines.push(mediaText);
  }

  const metricText = buildFxTwitterMetricText_(status);
  if (metricText) {
    lines.push('');
    lines.push('【互動數】');
    lines.push(metricText);
  }

  lines.push('');
  lines.push('【原始網址】');
  lines.push(url);

  return lines.join('\n').trim();
}

function buildFxTwitterAuthorLabel_(authorName, screenName) {
  const name = normalizeFxTwitterString_(authorName || '');
  const handle = normalizeFxTwitterString_(screenName || '').replace(/^@/, '');

  if (name && handle) return name + ' (@' + handle + ')';
  if (handle) return '@' + handle;
  return name;
}

function buildFxTwitterQuoteText_(status) {
  const quote = status && (status.quote || status.quoted_status || status.quote_tweet || status.quotedTweet);
  if (!quote) return '';

  const quoteAuthor = quote.author || quote.user || {};
  const quoteAuthorLabel = buildFxTwitterAuthorLabel_(
    quoteAuthor.name || quoteAuthor.display_name || '',
    quoteAuthor.screen_name || quoteAuthor.username || quoteAuthor.handle || ''
  );
  const quoteBody = normalizeFxTwitterString_(quote.text || quote.full_text || quote.description || '');

  return [
    quoteAuthorLabel ? '作者：' + quoteAuthorLabel : '',
    quoteBody ? '內容：' + quoteBody : ''
  ].filter(function(line) { return line !== ''; }).join('\n');
}

function buildFxTwitterMediaText_(status) {
  const media = status && status.media;
  if (!media) return '';

  const pieces = [];

  if (Array.isArray(media.photos) && media.photos.length) {
    pieces.push('圖片 ' + media.photos.length + ' 張');
  }

  if (Array.isArray(media.videos) && media.videos.length) {
    pieces.push('影片 ' + media.videos.length + ' 則');
  }

  if (Array.isArray(media.animated_gifs) && media.animated_gifs.length) {
    pieces.push('GIF ' + media.animated_gifs.length + ' 則');
  }

  if (Array.isArray(media) && media.length) {
    pieces.push('媒體 ' + media.length + ' 個');
  }

  return pieces.join('、');
}

function buildFxTwitterMetricText_(status) {
  const metrics = status && (status.metrics || status.public_metrics || {});
  const pieces = [];

  addFxTwitterMetricPiece_(pieces, 'Like', metrics.likes || metrics.like_count || status.likes || status.favorite_count);
  addFxTwitterMetricPiece_(pieces, 'Repost', metrics.retweets || metrics.retweet_count || metrics.reposts || status.retweets);
  addFxTwitterMetricPiece_(pieces, 'Reply', metrics.replies || metrics.reply_count || status.replies);
  addFxTwitterMetricPiece_(pieces, 'Quote', metrics.quotes || metrics.quote_count || status.quotes);

  return pieces.join(' / ');
}

function addFxTwitterMetricPiece_(pieces, label, value) {
  const numberValue = Number(value || 0);
  if (numberValue > 0) {
    pieces.push(label + '：' + numberValue);
  }
}

function normalizeFxTwitterString_(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
}

// ======================================================
// Jina Reader provider
// ======================================================

function fetchReadablePageWithJina_(url, executionContext, pttArticle) {
  // PTT 專用模式只接受已正規化的可信文章 URL，不接受任意 cookie / header 注入。
  if (pttArticle && (!isSafePublicUrl(url) || canonicalizePttArticleUrl_(url) !== url)) {
    return buildReaderLayerErrorResult_(url, WEB_READER_ROUTE_JINA, 'unsafe_url', 'PTT article 網址安全檢查未通過。', { retryable: false, httpStatus: 0 });
  }
  const readerUrl = buildJinaReaderUrl_(url);

  const options = {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: !pttArticle && !(executionContext && executionContext.noAi),
    headers: {
      // 明確要求文字輸出；Jina Reader 通常會回 Markdown / text。
      'Accept': 'text/plain',
      'User-Agent': 'Mozilla/5.0 (compatible; MEGAHuanBot/1.10.9; Jina Reader Layer)'
    }
  };
  if (pttArticle) {
    options.headers['X-Set-Cookie'] = 'over18=1; Domain=www.ptt.cc; Path=/';
    // 暫存 HTML 重用 PTT 結構驗證，保留 metadata；不依賴 selector 的 title 保留行為。
    options.headers['X-Respond-With'] = 'html';
  }
  if (!applyReaderFetchTimeoutForExecutionContext_(options, executionContext)) {
    return buildReaderExecutionBudgetFailure_(url, WEB_READER_ROUTE_JINA);
  }

  try {
    const response = UrlFetchApp.fetch(readerUrl, options);
    const statusCode = response.getResponseCode();
    const headers = response.getHeaders();
    const contentType = headers['Content-Type'] || headers['content-type'] || 'text/plain';
    const bodyText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_JINA,
        'jina_fetch_failed',
        'Jina Reader 讀取失敗，HTTP 狀態碼：' + statusCode +
          (pttArticle ? '' : '；回應預覽：' + String(bodyText || '').slice(0, 500)),
        buildReaderHttpFailureMetadata_(statusCode)
      );
    }

    if (pttArticle) return parsePttArticleResponse_(url, statusCode, contentType, bodyText, WEB_READER_ROUTE_JINA);

    const normalized = normalizeJinaReaderText_(url, bodyText);

    if (!isReadableTextUsable_(normalized.mainText, MIN_READER_MAIN_TEXT_LENGTH, normalized.title)) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_JINA,
        'reader_empty_content',
        'Jina Reader 有回應，但正文長度或品質不足，可能是登入頁、錯誤頁、JS 空殼頁或非文章型頁面。'
      );
    }

    return buildReaderLayerSuccessResult_({
      url: url,
      statusCode: statusCode,
      contentType: contentType || 'text/markdown',
      title: normalized.title,
      siteName: normalized.siteName,
      author: normalized.author,
      publishedAt: normalized.publishedAt,
      mainText: normalized.mainText,
      extractionConfidence: normalized.extractionConfidence,
      warnings: normalized.warnings,
      readerRoute: WEB_READER_ROUTE_JINA
    });

  } catch (error) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_JINA,
      'jina_fetch_exception',
      pttArticle ? '呼叫 PTT Jina fallback 時發生 fetch exception。' : '呼叫 Jina Reader 時發生錯誤：' + String(error && error.message ? error.message : error),
      pttArticle ? { retryable: true, httpStatus: 0 } : undefined
    );
  }
}

function buildJinaReaderUrl_(url) {
  // 保留原始 URL 結構給 Jina Reader。
  // 注意：URL fragment（# 後方）本來就不會送到伺服器，通常不是文章正文必要資訊。
  return JINA_READER_ENDPOINT_PREFIX + String(url || '').trim();
}

function normalizeJinaReaderText_(url, readerText) {
  const rawText = String(readerText || '').replace(/\r\n/g, '\n').trim();
  const lines = rawText.split('\n');

  let title = '';
  let publishedAt = '';
  let author = '';
  const bodyLines = [];
  let passedMarkdownContentMarker = false;

  lines.forEach(function(line) {
    const trimmed = String(line || '').trim();

    if (!title && trimmed.indexOf('Title:') === 0) {
      title = trimmed.replace(/^Title:\s*/i, '').trim();
      return;
    }

    if (!publishedAt && /^Published\s*Time:/i.test(trimmed)) {
      publishedAt = trimmed.replace(/^Published\s*Time:\s*/i, '').trim();
      return;
    }

    if (!author && /^Author:/i.test(trimmed)) {
      author = trimmed.replace(/^Author:\s*/i, '').trim();
      return;
    }

    // Jina Reader 常見輸出會有 URL Source / Markdown Content 標記。
    // URL Source 是 metadata，不當成正文；Markdown Content 後面才優先視為正文。
    if (/^URL\s*Source:/i.test(trimmed)) {
      return;
    }

    if (/^Markdown\s*Content:/i.test(trimmed)) {
      passedMarkdownContentMarker = true;
      return;
    }

    if (passedMarkdownContentMarker || bodyLines.length > 0 || trimmed !== '') {
      bodyLines.push(line);
    }
  });

  let mainText = bodyLines.join('\n').trim();

  // 如果 Jina 沒有輸出 Markdown Content 標記，就退回使用完整文字。
  if (!mainText) {
    mainText = rawText;
  }

  // 去掉過多空行，避免下游 prompt 被無效換行灌水。
  mainText = mainText.replace(/\n{3,}/g, '\n\n').trim();

  if (!title) {
    title = inferTitleFromReadableText_(mainText);
  }

  return {
    title: title,
    siteName: getReaderLayerHostname_(url),
    author: author,
    publishedAt: publishedAt,
    mainText: mainText,
    extractionConfidence: 0.85,
    warnings: ['內容由 Jina Reader 轉換為 LLM 友善文字。']
  };
}

// ======================================================
// PTT provider：GAS 原生 UrlFetchApp + over18 cookie
// ======================================================

function fetchPttPageWithOver18Cookie_(url, executionContext) {
  const canonicalUrl = canonicalizePttArticleUrl_(url);
  if (!isSafePublicUrl(url) || !canonicalUrl) {
    return buildReaderLayerErrorResult_(url, WEB_READER_ROUTE_PTT_OVER18, 'unsafe_url', 'PTT article 網址安全檢查未通過。', { retryable: false, httpStatus: 0 });
  }
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    // 直接 UrlFetch 不跟隨未重新驗證的 Location，避免公開網址轉向內網／metadata host。
    followRedirects: false,
    headers: {
      // PTT 成人看板會用 over18 cookie 判斷使用者是否已確認年滿 18 歲。
      // 這不是登入 token，只是 PTT over18 gate 的確認狀態。
      'Cookie': 'over18=1',
      'User-Agent': 'Mozilla/5.0 (compatible; MEGAHuanBot/1.10.9; PTT Reader)'
    }
  };
  if (!applyReaderFetchTimeoutForExecutionContext_(options, executionContext)) {
    return buildReaderExecutionBudgetFailure_(url, WEB_READER_ROUTE_PTT_OVER18);
  }

  try {
    const response = UrlFetchApp.fetch(canonicalUrl, options);
    const statusCode = response.getResponseCode();
    const headers = response.getHeaders();
    const contentType = headers['Content-Type'] || headers['content-type'] || 'text/html';
    const html = response.getContentText();

    return parsePttArticleResponse_(canonicalUrl, statusCode, contentType, html, WEB_READER_ROUTE_PTT_OVER18);

  } catch (error) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_PTT_OVER18,
      'ptt_fetch_exception',
      '讀取 PTT 時發生 fetch exception。',
      { retryable: true, httpStatus: 0 }
    );
  }
}

// 一次 direct + 最多一次既有 Jina；永不進入 legacy AI，不重設 caller deadline。
function fetchPttArticleWithFallback_(url, executionContext) {
  const canonicalUrl = canonicalizePttArticleUrl_(url);
  const direct = fetchPttPageWithOver18Cookie_(url, executionContext);
  const status = getReaderFailureHttpStatus_(direct);
  const eligible = !direct.ok && (direct.errorType === 'ptt_fetch_exception' ||
    direct.errorType === 'ptt_over18_failed' || direct.errorType === 'ptt_unexpected_page' ||
    direct.errorType === 'ptt_empty_content' || (status >= 300 && status < 400) ||
    status === 403 || isReaderHttpStatusRetryable_(status));
  let result = direct;
  let fallback = 'not_attempted';
  if (eligible) {
    const jina = fetchReadablePageWithJina_(canonicalUrl, executionContext, true);
    fallback = jina.errorType === 'reader_sync_budget_exhausted' ? 'budget_skipped' : (jina.ok ? 'success' : 'failed');
    if (jina.ok || jina.errorType === 'reader_sync_budget_exhausted') {
      result = jina;
      if (jina.ok) result.warnings.push('PTT direct 未取得可用文章，已使用 Jina fallback；direct=' + direct.errorType + '，HTTP=' + status + '。');
    } else {
      const retryable = resolveReaderFailureRetryable_(direct) || resolveReaderFailureRetryable_(jina);
      result = buildReaderLayerErrorResult_(canonicalUrl, WEB_READER_ROUTE_JINA, 'ptt_fallback_failed',
        'PTT direct 失敗（' + direct.errorType + '，HTTP ' + status + '）；Jina fallback 失敗（' + jina.errorType + '，HTTP ' + getReaderFailureHttpStatus_(jina) + '）。',
        { retryable: retryable, httpStatus: resolveCombinedReaderFailureHttpStatus_(direct, jina, retryable) });
    }
  }
  // 外部 fetch 可能晚於 timeout 返回；拒絕超過共同 deadline 的結果，不延長 AI reserve。
  if (executionContext && Number(executionContext.deadlineAtMs) > 0 && Date.now() >= Number(executionContext.deadlineAtMs)) {
    result = buildReaderLayerErrorResult_(canonicalUrl, result.readerRoute, 'reader_sync_budget_exhausted',
      'Reader 已耗盡共同執行預算，未繼續處理。', { retryable: true, httpStatus: 0 });
  }
  console.log('PTT_READER ' + JSON.stringify({
    directHttpStatus: status, directPageClassification: direct.ok ? 'article' : direct.errorType,
    canonicalized: canonicalUrl !== String(url || '').trim(), redirectObserved: status >= 300 && status < 400,
    fallback: fallback, finalReaderRoute: result.readerRoute, errorType: result.errorType || '',
    mainTextLength: result.ok ? result.mainText.length : 0
  }));
  return result;
}

function parsePttArticleResponse_(url, statusCode, contentType, html, route) {
  if (statusCode < 200 || statusCode >= 300) {
    const type = statusCode === 404 || statusCode === 410 ? 'ptt_not_found' :
      statusCode === 403 ? 'ptt_access_blocked' :
      statusCode >= 300 && statusCode < 400 ? 'ptt_unexpected_redirect' : 'ptt_fetch_failed';
    return buildReaderLayerErrorResult_(url, route, type, 'PTT 讀取失敗，HTTP 狀態碼：' + statusCode, buildReaderHttpFailureMetadata_(statusCode));
  }
  const article = extractPttMainContent_(html);
  if (looksLikePttOver18Gate_(html)) {
    return buildReaderLayerErrorResult_(url, route, 'ptt_over18_failed', 'PTT 仍回傳年齡確認頁，未取得文章。', { retryable: false, httpStatus: statusCode });
  }
  if (!article || extractPttArticleMetaValues_(article.html).length < 3 || !/\barticle-meta-tag\b/.test(article.html)) {
    return buildReaderLayerErrorResult_(url, route, 'ptt_unexpected_page', 'PTT 回應不是已知的完整文章結構，無法確認正文。', { retryable: false, httpStatus: statusCode });
  }
  // 一併移除發信站前的標準分隔線，避免沒有正文時只剩「--」仍被當成可用文章。
  const mainText = htmlToReadableText_(article.bodyHtml).replace(/(?:^|\n)(?:--[ \t]*\n\s*)?※ 發信站[:：][\s\S]*$/, '').trim();
  // 結構已驗證且正文已 trim；文章可能討論 Cloudflare 等錯誤文字，不套 generic 關鍵字 heuristic。
  if (!mainText) {
    return buildReaderLayerErrorResult_(url, route, 'ptt_empty_content', 'PTT 文章結構存在，但移除 metadata、推文與頁尾後正文為空。', { retryable: false, httpStatus: statusCode });
  }
  return buildReaderLayerSuccessResult_({
    url: url, statusCode: statusCode, contentType: contentType, siteName: 'PTT',
    title: extractPttTitle_(article.html) || extractPttTitle_(html) || inferTitleFromReadableText_(mainText),
    author: extractPttAuthor_(article.html), publishedAt: extractPttPublishedAt_(article.html),
    mainText: mainText, extractionConfidence: 0.8, readerRoute: route,
    warnings: [route === WEB_READER_ROUTE_JINA ? 'PTT 經 Jina 取得 HTML 並通過文章結構驗證。' : 'PTT direct 文章結構驗證通過。']
  });
}

// ponytail: 僅支援 classic PTT div 結構；若版型改變，先新增 fixture 再擴充，不猜測整頁正文。
// 逐個 div 計算深度，避免 push / metadata 的第一個 </div> 提前截斷文章。
function extractPttMainContent_(html) {
  const text = String(html || '').replace(/<!--[\s\S]*?-->|<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const tags = /<\/?div\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
  let match, start = -1, cursor = 0, depth = 0, skipDepth = 0, body = '';
  while ((match = tags.exec(text)) !== null) {
    const closing = /^<\//.test(match[0]);
    // 逐個讀取 quoted attributes，避免 data-id 或屬性值內的 id 字樣冒充 main-content。
    const attributes = {};
    const attributePattern = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attribute;
    while ((attribute = attributePattern.exec(match[0])) !== null) {
      attributes[attribute[1].toLowerCase()] = attribute[2] === undefined ? attribute[3] : attribute[2];
    }
    if (start < 0) {
      if (!closing && attributes.id === 'main-content') {
        start = tags.lastIndex; cursor = start; depth = 1;
      }
      continue;
    }
    if (!closing) {
      depth++;
      if (!skipDepth && /(?:^|\s)(?:article-metaline(?:-right)?|push)(?:\s|$)/.test(attributes.class || '')) {
        body += text.slice(cursor, match.index); skipDepth = depth;
      }
    } else {
      if (skipDepth === depth) { cursor = tags.lastIndex; skipDepth = 0; }
      depth--;
      if (depth === 0) return { html: text.slice(start, match.index), bodyHtml: body + text.slice(cursor, match.index) };
    }
  }
  return null;
}

function looksLikePttOver18Gate_(html) {
  const text = String(html || '');

  // PTT 正常文章頁會包含 main-content 與 article-meta 結構。
  // 實測 C_Chat 成人看板文章可正常讀回 200，但頁面內仍可能殘留 ask/over18 字樣；
  // 因此只要已經看到文章結構，就應優先視為正式文章頁，而不是 over18 確認頁。
  const article = extractPttMainContent_(text);
  const hasArticleStructure = article && extractPttArticleMetaValues_(article.html).length >= 3 && /\barticle-meta-tag\b/.test(article.html);

  if (hasArticleStructure) {
    return false;
  }

  // 真正的 PTT over18 gate 會出現明確的同意按鈕文字。
  const hasAgreeButton = text.indexOf('我同意，我已年滿十八歲') >= 0;

  if (hasAgreeButton) {
    return true;
  }

  // ask/over18 不能單獨使用，因為正常文章頁可能也包含這個字串。
  // 只有同時看見「未滿十八歲」提示與 over18 form / action，才視為 gate。
  const hasUnderAgeWarning = text.indexOf('未滿十八歲') >= 0;
  const hasOver18Form =
    text.indexOf('/ask/over18') >= 0 &&
    (
      text.indexOf('name="yes"') >= 0 ||
      text.indexOf('value="yes"') >= 0 ||
      text.indexOf('method="post"') >= 0
    );

  return hasUnderAgeWarning && hasOver18Form;
}

function extractPttTitle_(html) {
  const metaValues = extractPttArticleMetaValues_(html);
  if (metaValues.length >= 3) {
    return metaValues[2];
  }

  const titleMatch = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch && titleMatch[1] ? decodeHtmlEntities_(stripHtmlTags_(titleMatch[1])).replace(/\s+-\s+看板.*$/g, '').trim() : '';
}

function extractPttAuthor_(html) {
  const metaValues = extractPttArticleMetaValues_(html);
  return metaValues.length >= 1 ? metaValues[0] : '';
}

function extractPttPublishedAt_(html) {
  const metaValues = extractPttArticleMetaValues_(html);
  return metaValues.length >= 4 ? metaValues[3] : '';
}

function extractPttArticleMetaValues_(html) {
  const values = [];
  const regex = /<span\b[^>]*\sclass\s*=\s*(["'])(?:[^"']*\s)?article-meta-value(?:\s[^"']*)?\1[^>]*>([\s\S]*?)<\/span>/gi;
  let match = null;

  while ((match = regex.exec(String(html || ''))) !== null) {
    values.push(decodeHtmlEntities_(stripHtmlTags_(match[2])).trim());
  }

  return values;
}

// ======================================================
// 共用文字處理
// ======================================================

function buildReaderLayerSuccessResult_(item) {
  return {
    ok: true,
    url: item.url || '',
    statusCode: item.statusCode || 200,
    contentType: item.contentType || 'text/plain',
    title: item.title || '',
    siteName: item.siteName || '',
    author: item.author || '',
    publishedAt: item.publishedAt || '',
    mainText: item.mainText || '',
    extractionConfidence: item.extractionConfidence || 0,
    warnings: item.warnings || [],
    readerRoute: item.readerRoute || ''
  };
}

/**
 * 建立向後相容的 Reader failure result。
 * ok/url/readerRoute/errorType/error 是既有欄位；retryable/httpStatus 為 optional typed metadata，
 * 只供 Queue 判斷是否重試。舊 caller 若只讀 ok/error，不需要修改。
 */
function buildReaderLayerErrorResult_(url, readerRoute, errorType, errorMessage, metadata) {
  const result = {
    ok: false,
    url: url || '',
    readerRoute: readerRoute || '',
    errorType: errorType || 'reader_error',
    error: errorMessage || 'reader failed'
  };
  const safeMetadata = metadata || {};
  if (typeof safeMetadata.retryable === 'boolean') result.retryable = safeMetadata.retryable;
  if (Object.prototype.hasOwnProperty.call(safeMetadata, 'httpStatus')) {
    result.httpStatus = Number(safeMetadata.httpStatus || 0);
  }
  return result;
}

function isAiTypedReaderFailure_(result) {
  return !!result && String(result.errorType || '').indexOf('ai_') === 0;
}

function isReaderHttpStatusRetryable_(statusCode) {
  const status = Number(statusCode || 0);
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * 所有 Reader 非 2xx 共用同一個 HTTP retry 契約：408、429、5xx 可重試，
 * 其餘 4xx 為永久失敗。判斷只依 status，不解析 provider 錯誤文字。
 */
function buildReaderHttpFailureMetadata_(statusCode) {
  const status = Number(statusCode || 0);
  return {
    httpStatus: status,
    retryable: isReaderHttpStatusRetryable_(status)
  };
}

function getReaderFailureHttpStatus_(result) {
  const safeResult = result || {};
  return Object.prototype.hasOwnProperty.call(safeResult, 'httpStatus')
    ? Number(safeResult.httpStatus || 0)
    : Number(safeResult.statusCode || 0);
}

/**
 * 普通 Jina＋legacy failure 沿用「任一來源可重試就重試」策略。
 * combined httpStatus 必須選自可重試來源；否則 Jina 500 + legacy 404 會因最後的 404
 * 在 NewsUrlQueue 被誤判為永久失敗。若可重試來源只有 exception/timeout 而沒有 status，回傳 0。
 */
function resolveCombinedReaderFailureHttpStatus_(jinaResult, legacyResult, combinedRetryable) {
  const jinaRetryable = resolveReaderFailureRetryable_(jinaResult);
  const legacyRetryable = resolveReaderFailureRetryable_(legacyResult);
  const jinaStatus = getReaderFailureHttpStatus_(jinaResult);
  const legacyStatus = getReaderFailureHttpStatus_(legacyResult);

  if (combinedRetryable) {
    if (legacyRetryable && isReaderHttpStatusRetryable_(legacyStatus)) return legacyStatus;
    if (jinaRetryable && isReaderHttpStatusRetryable_(jinaStatus)) return jinaStatus;
    return 0;
  }

  return legacyStatus || jinaStatus || 0;
}

/**
 * deadline 已耗盡時的 provider-neutral Reader failure。
 * retryable=true 表示可交給既有背景 Queue 重新執行，不代表同步 webhook 應立刻再試。
 */
function buildReaderExecutionBudgetFailure_(url, readerRoute) {
  return buildReaderLayerErrorResult_(
    url,
    readerRoute,
    'reader_sync_budget_exhausted',
    'LINE webhook 同步 Reader 執行預算已耗盡，未發出 HTTP request。',
    { retryable: true, httpStatus: 0 }
  );
}

/**
 * Reader combination 的 retryable 後備判斷。typed metadata 優先；4xx（408/429 除外）
 * 通常是永久失敗，5xx/timeout/未知 fetch exception 則允許既有 Queue 稍後再試。
 */
function resolveReaderFailureRetryable_(result) {
  const safeResult = result || {};
  if (typeof safeResult.retryable === 'boolean') return safeResult.retryable;
  const type = String(safeResult.errorType || '').trim();
  if (type === 'unsafe_url' || type === 'unsupported_social_platform' || type === 'x_twitter_url_without_status_id') {
    return false;
  }
  if (type.indexOf('ai_') === 0) return isAiErrorTypeRetryable_(type);
  const status = getReaderFailureHttpStatus_(safeResult);
  if (isReaderHttpStatusRetryable_(status)) return true;
  if (status >= 400) return false;
  return true;
}

/**
 * 同步 webhook Reader 套用短 timeout，且不得超過整批 webhook 剩餘 absolute deadline。
 * 背景 Queue 不傳 execution context，因此不新增全域 Reader 行為變更，仍沿用 GAS 預設 timeout。
 * 回傳 null 代表 deadline 已過，caller 必須直接走既有 fallback，不可再發 1 秒 request。
 */
function applyReaderFetchTimeoutForExecutionContext_(options, executionContext) {
  const safeOptions = options || {};
  const context = executionContext || null;
  if (!context) return safeOptions;

  const deadlineAtMs = Number(context.deadlineAtMs);
  const configuredCap = Number(context.readerTimeoutCapSeconds);
  if (!isFinite(deadlineAtMs) || deadlineAtMs <= 0) return safeOptions;

  const remainingSeconds = Math.floor((deadlineAtMs - Date.now()) / 1000);
  if (!isFinite(remainingSeconds) || remainingSeconds < 1) return null;
  const effectiveCap = isFinite(configuredCap) && configuredCap > 0
    ? Math.min(configuredCap, remainingSeconds)
    : remainingSeconds;
  safeOptions.timeoutSeconds = Math.max(1, Math.floor(effectiveCap));
  return safeOptions;
}

function isReadableTextUsable_(text, minLength, title) {
  const mainText = String(text || '').trim();

  if (mainText.length < Number(minLength || MIN_READER_MAIN_TEXT_LENGTH)) {
    return false;
  }

  return !isGenericReaderErrorPage_(title, mainText);
}

/** 只採用頁首／標題的錯誤頁訊號；正文討論 Cloudflare 等詞不代表頁面失敗。 */
function isGenericReaderErrorPage_(title, text) {
  const heading = String(title || '').replace(/^#+\s*/, '').trim();
  const errorHeading = /^(?:access denied|403 forbidden|http error 403|just a moment\.{0,3}|(?:please )?enable javascript|javascript is required|please enable javascript and cookies to continue|checking if the site connection is secure|請開啟 javascript|請先登入|登入後繼續|我同意，我已年滿十八歲|cloudflare (?:security check|challenge)|attention required!\s*\|\s*cloudflare)$/i;
  if (errorHeading.test(heading) || errorHeading.test(heading.replace(/\s*\|\s*cloudflare$/i, ''))) return true;
  const body = String(text || '').trim();
  const firstLine = body.split('\n').map(function(line) { return line.trim().replace(/^#+\s*/, ''); }).filter(Boolean)[0] || '';
  return body.length <= 2000 && errorHeading.test(firstLine);
}

function inferTitleFromReadableText_(text) {
  const lines = String(text || '')
    .split('\n')
    .map(function(line) { return String(line || '').trim(); })
    .filter(function(line) { return line !== ''; });

  if (!lines.length) {
    return '';
  }

  return lines[0]
    .replace(/^#+\s*/, '')
    .slice(0, 120)
    .trim();
}

function htmlToReadableText_(html) {
  let text = String(html || '');

  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // PTT 文章常用 <br> 換行，先轉成換行再移除 tag。
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<\/div>/gi, '\n');
  text = stripHtmlTags_(text);
  text = decodeHtmlEntities_(text);

  return text
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtmlTags_(html) {
  return String(html || '').replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities_(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x27;/g, "'")
    .replace(/&#x60;/g, '`');
}
