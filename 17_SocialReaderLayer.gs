// ======================================================
// 17_SocialReaderLayer.gs
// v1.10.9 Social Reader Edition：社群網址 reader 相容層。
//
// 本檔只處理 v1.10.9 的社群網址分流，不重構 NewsInbox、WebTaskQueue、
// Gemini / DeepSeek prompt，也不導入 ByCrawl、Apify、Node.js 或自架伺服器。
//
// 設計方式：
// 1. 盡量復用 16_ReaderLayer.gs 既有 provider，例如 Jina Reader、PTT reader、legacy fallback。
// 2. 只新增 X / Twitter 單篇 status 的 FxTwitter API provider。
// 3. Facebook / fb.watch / Threads.com / Threads.net 不再提前攔截，改交給 Jina Reader 嘗試讀取。
// 4. 對下游維持原本 webResult 契約：mainText、title、siteName、author、publishedAt、warnings、readerRoute。
//
// 維護注意：
// Google Apps Script 會將專案內 .gs 檔放在同一全域命名空間。
// 本檔刻意放在 16_ReaderLayer.gs 後方，覆寫 fetchAndExtractWebPageByReaderLayer_()
// 與 detectWebReaderRoute_()，以避免 v1.10.9 為小改版卻整份替換大型 Reader Layer 檔案。
// 後續若要大整理 Reader Layer，應把本檔邏輯正式合併回 16_ReaderLayer.gs。
// ======================================================

// Reader route 名稱固定化，方便 Sheet / log 排查來源。
const WEB_READER_ROUTE_FXTWITTER = 'fxtwitter_api';

// ======================================================
// v1.10.9 社群 aware 統一 reader 入口
// ======================================================

function fetchAndExtractWebPageByReaderLayer_(url) {
  const safeUrl = String(url || '').trim();

  if (!isSafePublicUrl(safeUrl)) {
    return buildReaderLayerErrorResult_(safeUrl, '', 'unsafe_url', '網址安全檢查未通過。');
  }

  const route = detectWebReaderRoute_(safeUrl);

  if (route === WEB_READER_ROUTE_FXTWITTER) {
    return fetchTwitterStatusWithFxTwitter_(safeUrl);
  }

  if (route === WEB_READER_ROUTE_UNSUPPORTED_SOCIAL) {
    return buildReaderLayerErrorResult_(
      safeUrl,
      route,
      'x_twitter_url_without_status_id',
      '這個 X / Twitter 網址不是單篇 status 貼文，v1.10.9 只支援 /status/{id} 類型的公開貼文網址。'
    );
  }

  if (route === WEB_READER_ROUTE_PTT_OVER18) {
    return fetchPttPageWithOver18Cookie_(safeUrl);
  }

  // Facebook / fb.watch / Threads.com / Threads.net 會自然走到這裡。
  // 若 Jina 讀不到，仍保留 legacy raw HTML + Gemini extractor fallback。
  const jinaResult = fetchReadablePageWithJina_(safeUrl);

  if (jinaResult.ok) {
    return jinaResult;
  }

  const legacyResult = fetchAndExtractWebPageLegacy_(safeUrl);

  if (legacyResult && legacyResult.ok) {
    const warnings = legacyResult.warnings || [];
    warnings.unshift('Jina Reader 讀取失敗，已改用 legacy raw HTML + Gemini extractor。Jina 錯誤：' + (jinaResult.error || '未知錯誤'));

    legacyResult.readerRoute = WEB_READER_ROUTE_LEGACY;
    legacyResult.warnings = warnings;
    return legacyResult;
  }

  return buildReaderLayerErrorResult_(
    safeUrl,
    WEB_READER_ROUTE_JINA,
    'jina_and_legacy_failed',
    'Jina Reader 讀取失敗；legacy fallback 也未取得可用正文。Jina 錯誤：' +
      (jinaResult.error || '未知錯誤') +
      '；legacy 錯誤：' +
      (legacyResult && legacyResult.error ? legacyResult.error : '未知錯誤')
  );
}

function detectWebReaderRoute_(url) {
  const hostname = getReaderLayerHostname_(url);

  if (!hostname) {
    return WEB_READER_ROUTE_JINA;
  }

  if (isPttHostname_(hostname)) {
    return WEB_READER_ROUTE_PTT_OVER18;
  }

  if (isTwitterLikeHostname_(hostname)) {
    return extractTwitterStatusIdFromUrl_(url) ? WEB_READER_ROUTE_FXTWITTER : WEB_READER_ROUTE_UNSUPPORTED_SOCIAL;
  }

  // v1.10.9：Facebook / fb.watch / Threads 不再提前攔截。
  // 這些網址先交給 Jina Reader；Jina 失敗後才 fallback 或回錯誤。
  return WEB_READER_ROUTE_JINA;
}

// ======================================================
// X / Twitter URL 判斷與 FxTwitter API provider
// ======================================================

function isTwitterLikeHostname_(hostname) {
  const host = String(hostname || '').toLowerCase();

  return host === 'x.com' ||
    host.endsWith('.x.com') ||
    host === 'twitter.com' ||
    host.endsWith('.twitter.com') ||
    host === 'mobile.twitter.com' ||
    host === 'fxtwitter.com' ||
    host.endsWith('.fxtwitter.com') ||
    host === 'fixupx.com' ||
    host.endsWith('.fixupx.com');
}

function extractTwitterStatusIdFromUrl_(url) {
  const text = String(url || '').trim();

  // 常見格式：/user/status/123、/i/web/status/123。
  // 只抓 snowflake 數字 ID，不處理搜尋頁、個人頁、列表頁。
  const statusMatch = text.match(/\/status\/(\d{5,})(?:[/?#]|$)/i);
  if (statusMatch && statusMatch[1]) {
    return statusMatch[1];
  }

  const webStatusMatch = text.match(/\/i\/web\/status\/(\d{5,})(?:[/?#]|$)/i);
  if (webStatusMatch && webStatusMatch[1]) {
    return webStatusMatch[1];
  }

  return '';
}

function fetchTwitterStatusWithFxTwitter_(url) {
  const statusId = extractTwitterStatusIdFromUrl_(url);

  if (!statusId) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER,
      'x_twitter_url_without_status_id',
      '這個 X / Twitter 網址不是單篇 status 貼文，無法用 FxTwitter API 讀取。'
    );
  }

  const apiUrl = FXTWITTER_API_STATUS_ENDPOINT_PREFIX + encodeURIComponent(statusId);
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; MEGAHuanBot/1.10.9; FxTwitter Reader)'
    }
  };

  try {
    const response = UrlFetchApp.fetch(apiUrl, options);
    const statusCode = response.getResponseCode();
    const headers = response.getHeaders();
    const contentType = headers['Content-Type'] || headers['content-type'] || 'application/json';
    const bodyText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_FXTWITTER,
        'fxtwitter_fetch_failed',
        'FxTwitter API 讀取失敗，HTTP 狀態碼：' + statusCode + '；回應預覽：' + String(bodyText || '').slice(0, 500)
      );
    }

    let json = null;
    try {
      json = JSON.parse(bodyText);
    } catch (parseError) {
      return buildReaderLayerErrorResult_(
        url,
        WEB_READER_ROUTE_FXTWITTER,
        'fxtwitter_invalid_json',
        'FxTwitter API 有回應，但內容不是合法 JSON：' + String(bodyText || '').slice(0, 500)
      );
    }

    return normalizeFxTwitterStatusToReaderResult_(url, statusCode, contentType, json);

  } catch (error) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER,
      'fxtwitter_fetch_exception',
      '呼叫 FxTwitter API 時發生錯誤：' + String(error && error.message ? error.message : error)
    );
  }
}

function normalizeFxTwitterStatusToReaderResult_(url, statusCode, contentType, json) {
  const status = extractFxTwitterStatusObject_(json);

  if (!status) {
    return buildReaderLayerErrorResult_(
      url,
      WEB_READER_ROUTE_FXTWITTER,
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
      WEB_READER_ROUTE_FXTWITTER,
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
    readerRoute: WEB_READER_ROUTE_FXTWITTER
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
