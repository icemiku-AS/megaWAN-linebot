// ======================================================
// 17_GeminiQuota.gs
// Gemini 429 診斷與依專案／模型隔離的短期配額阻擋。
// ======================================================

const GEMINI_QUOTA_PROPERTY = 'GEMINI_QUOTA_STATE';
const GEMINI_QUOTA_TIMEZONE = 'America/Los_Angeles';
const GEMINI_QUOTA_COOLDOWN_MS = 60000;
const GEMINI_QUOTA_MAX_COOLDOWN_MS = 15 * 60000;

function getGeminiQuotaScope_(request) {
  return request.webSearchMode === 'required' ? 'search_paid' : 'free';
}

/** 只在 Gemini 的 429 分支使用。原始 provider 欄位不離開本函式。 */
function readGeminiQuotaFailure_(response, model, now) {
  let error;
  try {
    const body = response.getContentText();
    if (typeof body === 'string' && body.length <= 32768) error = JSON.parse(body).error;
  } catch (ignore) { /* 結構不明時使用短冷卻。 */ }
  const reasons = new Set();
  const hints = [];
  const details = error && Array.isArray(error.details) ? error.details.slice(0, 24) : [];
  for (const detail of details) {
    if (!detail) continue;
    if (detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' && Array.isArray(detail.violations)) {
      detail.violations.slice(0, 24).forEach(function(violation) {
        if (!violation) return;
        const reason = classifyGeminiQuotaLimit_(
          violation.quotaId || violation.quota_id, violation.quotaMetric || violation.quota_metric,
          violation.quotaDimensions || violation.quota_dimensions,
          violation.quotaValue ?? violation.quota_value ?? violation.limit, model);
        if (reason) reasons.add(reason);
      });
    }
    if (detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo') {
      const metadata = detail.metadata || {};
      const service = metadata.service || '';
      if (service && service !== 'generativelanguage.googleapis.com') continue;
      if (['SERVICE_DISABLED', 'API_KEY_SERVICE_BLOCKED', 'BILLING_DISABLED', 'PERMISSION_DENIED', 'QUOTA_LIMIT_ZERO'].indexOf(detail.reason) >= 0) {
        reasons.add('quota_zero');
      }
      const reason = classifyGeminiQuotaLimit_(metadata.quota_limit || metadata.quotaId,
        metadata.quota_metric || metadata.quotaMetric, metadata,
        metadata.quota_limit_value ?? metadata.quotaValue, model);
      if (reason) reasons.add(reason);
    }
    if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo') {
      const delay = detail.retryDelay || detail.retry_delay;
      if (typeof delay === 'string' && /^\d{1,6}(?:\.\d{1,9})?s$/.test(delay)) {
        hints.push(now + Math.ceil(Number(delay.slice(0, -1)) * 1000));
      }
    }
  }
  // 某些 RPC 回應省略 proto 預設值 0；只辨識明確的額度 0，絕不從 message 推斷日額度。
  if (error && error.status === 'PERMISSION_DENIED') reasons.add('quota_zero');
  if (error && error.status === 'RESOURCE_EXHAUSTED' && typeof error.message === 'string' &&
      /Quota exceeded for metric:[^,\r\n]{1,256},\s*limit:\s*0(?=\s*(?:,|$|\r|\n))/i.test(error.message)) {
    reasons.add('quota_zero');
  }
  try {
    const headers = (typeof response.getAllHeaders === 'function' ? response.getAllHeaders() : response.getHeaders()) || {};
    Object.keys(headers).filter(function(name) { return name.toLowerCase() === 'retry-after'; }).forEach(function(name) {
      const values = Array.isArray(headers[name]) ? headers[name] : [headers[name]];
      values.slice(0, 4).forEach(function(value) {
        const text = String(value).trim();
        if (/^\d{1,6}$/.test(text)) hints.push(now + Number(text) * 1000);
        else if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(text)) hints.push(Date.parse(text));
      });
    });
  } catch (ignore) { /* HTTP headers 為可選提示。 */ }
  const reason = ['quota_zero', 'quota_rpd', 'quota_tpm', 'quota_rpm'].find(function(code) {
    return reasons.has(code);
  }) || 'quota_unknown';
  // 日額度的提示可跨長日；短期類別只接受合理的冷卻提示。
  const maxHint = reason === 'quota_rpd' ? 26 * 3600000 : GEMINI_QUOTA_MAX_COOLDOWN_MS;
  const validHints = hints.filter(function(time) { return Number.isSafeInteger(time) && time > now && time - now <= maxHint; });
  return { errorReason: reason, retryNotBeforeMs: validHints.length ? Math.max.apply(null, validHints) : null };
}

function classifyGeminiQuotaLimit_(id, metric, dimensions, limit, model) {
  const scope = dimensions || {};
  const reportedModel = scope.model;
  if (typeof reportedModel === 'string' && reportedModel.replace(/^models\//, '') !== model) return '';
  const amount = typeof limit === 'number' || (typeof limit === 'string' && /^\d{1,20}$/.test(limit)) ? Number(limit) : null;
  if (amount === 0) return 'quota_zero';
  const quota = [id, metric, scope.period, scope.timeUnit, scope.time_unit, scope.window, scope.unit]
    .filter(function(value) { return typeof value === 'string' && value.length <= 256; }).join(' ');
  const daily = /per[\s_.-]*day|daily|\brpd\b|(?:^|\s)(?:day|1\/d|1\/day)(?:\s|$)/i.test(quota);
  if (daily) return Number.isInteger(amount) && amount > 0 ? 'quota_rpd' : '';
  if (/\btpm\b/i.test(quota)) return 'quota_tpm';
  if (/\brpm\b/i.test(quota)) return 'quota_rpm';
  if (/per[\s_.-]*min(?:ute)?|\bminutely\b|(?:^|\s)(?:minute|1\/min|1\/m)(?:\s|$)/i.test(quota)) {
    if (/token/i.test(quota)) return 'quota_tpm';
    if (/requests?|generatecontent/i.test(quota)) return 'quota_rpm';
  }
  return '';
}

function getGeminiPtDate_(time) {
  return Utilities.formatDate(new Date(time), GEMINI_QUOTA_TIMEZONE, 'yyyy-MM-dd');
}

function getGeminiNextPtMidnight_(ptDate) {
  // UTC 只用來加一個日曆日，下一個當地午夜再交給時區規則解析。
  const nextDate = new Date(Date.parse(ptDate + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  return Utilities.parseDate(nextDate + ' 00:00:00', GEMINI_QUOTA_TIMEZONE, 'yyyy-MM-dd HH:mm:ss').getTime();
}

function readGeminiQuotaState_(properties, now) {
  const raw = properties.getProperty(GEMINI_QUOTA_PROPERTY);
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch (ignore) { parsed = null; }
  const state = {};
  const models = Object.values(AI_MODEL_REGISTRY).filter(function(entry) { return entry.provider === 'gemini'; });
  ['free', 'search_paid'].forEach(function(scope) {
    models.forEach(function(model) {
      const key = scope + '|' + model.model;
      const entry = parsed && parsed[key];
      if (entry && isAiQuotaReason_(entry.reason) &&
          entry.status === (entry.reason === 'quota_rpd' ? 'daily_blocked' : 'cooldown') &&
          typeof entry.ptDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.ptDate) &&
          Number.isSafeInteger(entry.updatedAtMs) && Number.isSafeInteger(entry.blockedUntilMs) &&
          entry.blockedUntilMs > now && entry.blockedUntilMs - now <= 26 * 3600000) {
        state[key] = { status: entry.status, reason: entry.reason, ptDate: entry.ptDate,
          blockedUntilMs: entry.blockedUntilMs, updatedAtMs: entry.updatedAtMs };
      }
    });
  });
  return { state: state, needsCleanup: !!raw && JSON.stringify(state) !== raw };
}

function readGeminiQuotaBlocks_(scope) {
  try {
    const properties = PropertiesService.getScriptProperties();
    let snapshot = readGeminiQuotaState_(properties, Date.now());
    if (snapshot.needsCleanup) {
      const current = withDataMutationLock_(function() {
        const next = readGeminiQuotaState_(properties, Date.now());
        if (next.needsCleanup) properties.setProperty(GEMINI_QUOTA_PROPERTY, JSON.stringify(next.state));
        return next;
      }, 100);
      if (current.state) snapshot = current;
    }
    const blocks = {};
    Object.keys(snapshot.state).forEach(function(key) {
      if (key.indexOf(scope + '|') === 0) blocks[key.slice(scope.length + 1)] = snapshot.state[key];
    });
    return blocks;
  } catch (ignore) {
    console.warn('GEMINI_QUOTA_READ_FAILED');
    return {};
  }
}

function recordGeminiQuotaBlock_(scope, model, failure, startedAtMs) {
  const now = Date.now();
  const reason = isAiQuotaReason_(failure.errorReason) ? failure.errorReason : 'quota_unknown';
  let day, nextMidnight;
  try {
    day = getGeminiPtDate_(now);
    // 跨日的舊請求不能替新日建立阻擋。
    if (getGeminiPtDate_(startedAtMs) !== day) return { reason: reason, blockedUntilMs: now };
    if (reason === 'quota_rpd') nextMidnight = getGeminiNextPtMidnight_(day);
  } catch (ignore) {
    console.warn('GEMINI_QUOTA_CLOCK_FAILED');
    return { reason: reason, blockedUntilMs: now + GEMINI_QUOTA_COOLDOWN_MS };
  }
  const daily = reason === 'quota_rpd';
  const hint = normalizeAiRetryNotBeforeMs_(failure.retryNotBeforeMs);
  const cooldown = hint > now ? Math.min(hint - now, GEMINI_QUOTA_MAX_COOLDOWN_MS) :
    reason === 'quota_zero' ? GEMINI_QUOTA_MAX_COOLDOWN_MS : GEMINI_QUOTA_COOLDOWN_MS;
  const proposed = { status: daily ? 'daily_blocked' : 'cooldown', reason: reason, ptDate: day,
    blockedUntilMs: daily ? nextMidnight : now + cooldown, updatedAtMs: now };
  try {
    const saved = withDataMutationLock_(function() {
      const lockedAt = Date.now();
      if (getGeminiPtDate_(lockedAt) !== day) return { reason: reason, blockedUntilMs: lockedAt };
      const properties = PropertiesService.getScriptProperties();
      const snapshot = readGeminiQuotaState_(properties, lockedAt);
      const key = scope + '|' + model;
      const current = snapshot.state[key];
      if (current && (current.status === 'daily_blocked' ||
        (!daily && current.blockedUntilMs >= proposed.blockedUntilMs))) return current;
      if (proposed.blockedUntilMs <= lockedAt) return proposed;
      snapshot.state[key] = proposed;
      properties.setProperty(GEMINI_QUOTA_PROPERTY, JSON.stringify(snapshot.state));
      return proposed;
    }, 100);
    if (saved.status !== 'busy') return saved;
  } catch (ignore) { console.warn('GEMINI_QUOTA_WRITE_FAILED'); }
  // 競態或寫入失敗時只把本次可信時間交給 caller，無鎖不寫共用狀態。
  return proposed;
}
