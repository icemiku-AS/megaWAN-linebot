// ======================================================
// 36_NewsArchive.gs
// 新聞封存：已設定聊天室使用週三中午固定週期，未設定時支援手動封存最近 7 天。
// 固定週期的手動與排程共用期間、防重及提交；AI 等待期間不占用共用 ScriptLock。
// ======================================================

const NEWS_ARCHIVE_CONFIG_PROPERTY = 'NEWS_ARCHIVE_CONFIG';
const NEWS_ARCHIVE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const NEWS_ARCHIVE_TIMEZONE = 'Asia/Taipei';
const NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS = 3;
const NEWS_ARCHIVE_LEASE_MS = 5 * 60 * 1000;
const NEWS_ARCHIVE_EXTRA_HEADERS = ['ArchiveKey', 'PeriodStartAt', 'PeriodEndAt', 'ArchiveOrigin'];

function getNewsArchiveClosedEnd_(nowMs) {
  const local = new Date(nowMs + 8 * 60 * 60 * 1000);
  const daysFromWednesday = (local.getUTCDay() + 4) % 7;
  let end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysFromWednesday, 12) - 8 * 60 * 60 * 1000;
  if (end > nowMs) end -= NEWS_ARCHIVE_WEEK_MS;
  return end;
}

function formatNewsArchiveTime_(time) {
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

function getNewsArchiveConfigs_() {
  const raw = PropertiesService.getScriptProperties().getProperty(NEWS_ARCHIVE_CONFIG_PROPERTY);
  if (!raw) return [];
  let config;
  try { config = JSON.parse(raw); } catch (ignore) { throw createAiConfigurationError_('Invalid NEWS_ARCHIVE_CONFIG JSON.'); }
  if (!config || !Array.isArray(config.conversations) || config.conversations.length > 20) {
    throw createAiConfigurationError_('NEWS_ARCHIVE_CONFIG requires a bounded conversations array.');
  }
  const seen = Object.create(null);
  return config.conversations.map(function(item) {
    const scope = item && item.conversationId;
    const first = item && item.firstPeriodStartAt;
    const time = typeof first === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(first) ? Date.parse(first) : NaN;
    if (typeof scope !== 'string' || !/^(user|group|room):[A-Za-z0-9_-]{1,128}$/.test(scope) ||
        seen[scope] || typeof item.autoEnabled !== 'boolean' ||
        !isFinite(time) || getNewsArchiveClosedEnd_(time) !== time) {
      throw createAiConfigurationError_('Invalid news archive scope, start boundary or autoEnabled.');
    }
    seen[scope] = true;
    return { conversationId: scope, firstStartAt: time, autoEnabled: item.autoEnabled };
  });
}

function getNewsArchiveConfig_(conversationId) {
  return getNewsArchiveConfigs_().find(function(item) { return item.conversationId === conversationId; }) || null;
}

function getNewsArchiveStateKey_(config) {
  return 'NEWS_ARCHIVE_STATE_' + computeWeeklyEditorialInputHash_(config.conversationId);
}

function getNewsArchiveState_(config) {
  const raw = PropertiesService.getScriptProperties().getProperty(getNewsArchiveStateKey_(config));
  if (!raw) return { firstStartAt: config.firstStartAt, nextStartAt: config.firstStartAt,
    autoAttempts: 0, lastAutoDay: '', runId: '', leaseUntil: 0, retryable: true, lastErrorCode: '', retryNotBeforeMs: 0,
    lastCompletedStartAt: 0, lastCompletedEndAt: 0, lastCompletedAt: 0, lastOutcome: '' };
  let state;
  try { state = JSON.parse(raw); } catch (ignore) { throw createAiConfigurationError_('Invalid news archive state JSON.'); }
  if (!state || state.firstStartAt !== config.firstStartAt || !Number.isInteger(state.nextStartAt) ||
      state.nextStartAt < config.firstStartAt || getNewsArchiveClosedEnd_(state.nextStartAt) !== state.nextStartAt ||
      !Number.isInteger(state.autoAttempts) || state.autoAttempts < 0 || state.autoAttempts > NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS ||
      typeof state.runId !== 'string' || state.runId.length > 128 || typeof state.retryable !== 'boolean' ||
      !Number.isFinite(state.leaseUntil) || typeof state.lastAutoDay !== 'string' ||
      (state.runId ? state.leaseUntil <= 0 : state.leaseUntil !== 0) ||
      !/^(?:|\d{4}-\d{2}-\d{2})$/.test(state.lastAutoDay) ||
      typeof state.lastErrorCode !== 'string' ||
      (state.lastErrorCode && normalizeAiErrorReason_(state.lastErrorCode) !== state.lastErrorCode) ||
      !['', 'completed', 'empty', 'cleared'].includes(state.lastOutcome) ||
      ['lastCompletedStartAt', 'lastCompletedEndAt', 'lastCompletedAt'].some(function(key) { return !Number.isFinite(state[key]); }) ||
      (state.lastOutcome ? state.lastCompletedEndAt !== state.nextStartAt ||
        state.lastCompletedStartAt + NEWS_ARCHIVE_WEEK_MS !== state.lastCompletedEndAt
        : state.nextStartAt !== config.firstStartAt)) {
    throw createAiConfigurationError_('Invalid news archive state; reconcile it before resuming.');
  }
  const retryAt = normalizeAiRetryNotBeforeMs_(state.retryNotBeforeMs);
  if (state.retryNotBeforeMs !== undefined && state.retryNotBeforeMs !== 0 && (!retryAt || !isAiQuotaReason_(state.lastErrorCode))) {
    throw createAiConfigurationError_('Invalid news archive quota wait.');
  }
  state.retryNotBeforeMs = retryAt || 0;
  // 提交鎖持續忙碌時只能寫獨立的 token 失敗收據；唯讀狀態也要立即反映失敗。
  const failureRaw = state.runId && PropertiesService.getScriptProperties().getProperty(
    getNewsArchiveStateKey_(config) + '_FAILURE_' + state.runId);
  if (failureRaw) {
    let failure;
    try { failure = JSON.parse(failureRaw); } catch (ignore) { throw createAiConfigurationError_('Invalid news archive failure receipt.'); }
    if (!failure || typeof failure.retryable !== 'boolean' || !failure.errorCode ||
        normalizeAiErrorReason_(failure.errorCode) !== failure.errorCode) {
      throw createAiConfigurationError_('Invalid news archive failure receipt.');
    }
    applyNewsArchiveFailure_(state, failure);
  }
  return state;
}

function applyNewsArchiveFailure_(state, failure) {
  state.runId = ''; state.leaseUntil = 0;
  state.lastErrorCode = failure.errorCode; state.retryable = failure.retryable;
  state.retryNotBeforeMs = isAiQuotaReason_(failure.errorCode) ? (normalizeAiRetryNotBeforeMs_(failure.retryNotBeforeMs) || 0) : 0;
  // 只有持有原 runId 的零 HTTP 自動工作可以退還此次預扣嘗試。
  if (state.retryNotBeforeMs && failure.retryable && typeof failure.refundAutoDay === 'string' &&
      /^(?:|\d{4}-\d{2}-\d{2})$/.test(failure.refundAutoDay) && state.autoAttempts > 0) {
    state.autoAttempts--;
    state.lastAutoDay = failure.refundAutoDay;
  }
}

function saveNewsArchiveState_(config, state) {
  const properties = PropertiesService.getScriptProperties();
  const key = getNewsArchiveStateKey_(config);
  const raw = JSON.stringify(state);
  try { properties.setProperty(key, raw); } catch (error) {
    if (error && typeof error.retryable === 'boolean') throw error;
    // 原生進度寫入例外仍可隔日補跑，不把短暫儲存失敗永久封鎖。
    const failure = new Error('News archive progress write failed.');
    failure.retryable = true;
    throw failure;
  }
  // 收據只保存安全失敗碼，不保存模型結果；新進度落盤後移除已失效 token 的收據。
  try {
    properties.getKeys().filter(function(name) {
      return name.indexOf(key + '_FAILURE_') === 0 && name !== key + '_FAILURE_' + state.runId;
    }).forEach(function(name) { properties.deleteProperty(name); });
  } catch (ignore) { console.warn('NEWS_ARCHIVE_RECEIPT_CLEANUP_FAILED'); }
}

function readNewsArchiveSheet_(name, requiredHeaders) {
  try {
    const sheet = getSpreadsheet_().getSheetByName(name);
    if (!sheet || sheet.getLastColumn() < 1) throw createAiValidationError_('News archive source sheet is missing.', false);
    const names = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function(value) { return String(value || '').trim(); });
    const headers = Object.create(null);
    names.forEach(function(name, index) {
      if (name && headers[name]) throw createAiValidationError_('Duplicate news archive sheet header.', false);
      if (name) headers[name] = index + 1;
    });
    if (requiredHeaders.some(function(name) { return !headers[name]; })) {
      throw createAiValidationError_('News archive sheet requires setup or repair.', false);
    }
    const count = Math.max(0, sheet.getLastRow() - 1);
    return { sheet: sheet, headers: headers,
      rows: count ? sheet.getRange(2, 1, count, sheet.getLastColumn()).getValues() : [] };
  } catch (error) {
    if (error && error.errorType) throw error;
    const failure = createAiValidationError_('News archive sheet read failed.', true);
    failure.errorReason = 'tool_read_failed';
    throw failure;
  }
}

function getNewsArchivePeriodItems_(config, period) {
  const data = readNewsArchiveSheet_(NEWS_INBOX_SHEET_NAME, ['CreatedAt', 'ConversationId', 'Status', 'Title', 'Url', 'Brief']);
  return data.rows.filter(function(row) {
    if (getRowValueByHeader_(row, data.headers, 'ConversationId') !== config.conversationId ||
        getRowValueByHeader_(row, data.headers, 'Status') !== 'ok') return false;
    const raw = getRowValueByHeader_(row, data.headers, 'CreatedAt');
    const time = new Date(raw).getTime();
    if (raw === '' || raw === null || (typeof raw !== 'string' && !(raw instanceof Date)) || !isFinite(time)) {
      throw createAiValidationError_('News archive source timestamp is invalid.', false);
    }
    return time >= period.startAt && time < period.endAt;
  }).map(function(row) { return newsInboxRowToItem_(row, data.headers); }).sort(compareNewsItemsForDisplay_);
}

function getNewsArchiveKey_(config, period) {
  return 'news:' + computeWeeklyEditorialInputHash_(config.conversationId) + ':' + period.startAt + ':' + period.endAt;
}

function findNewsArchiveRow_(config, period) {
  const data = readNewsArchiveSheet_(WEEKLY_SUMMARY_SHEET_NAME,
    ['ConversationId', 'ArchiveType', 'Summary', 'SourceItemCount'].concat(NEWS_ARCHIVE_EXTRA_HEADERS));
  const key = getNewsArchiveKey_(config, period);
  // shortcut: 每週以全表精確找 ArchiveKey；封存量顯著增加後再建立索引。
  const matches = data.rows.filter(function(row) {
    return getRowValueByHeader_(row, data.headers, 'ArchiveKey') === key;
  });
  if (matches.length > 1) throw createAiValidationError_('Duplicate news archive key requires repair.', false);
  if (!matches.length) return null;
  const row = matches[0];
  const count = Number(getRowValueByHeader_(row, data.headers, 'SourceItemCount'));
  if (getRowValueByHeader_(row, data.headers, 'ConversationId') !== config.conversationId ||
      getRowValueByHeader_(row, data.headers, 'ArchiveType') !== WEEKLY_ARCHIVE_TYPE_NEWS ||
      Date.parse(getRowValueByHeader_(row, data.headers, 'PeriodStartAt')) !== period.startAt ||
      Date.parse(getRowValueByHeader_(row, data.headers, 'PeriodEndAt')) !== period.endAt ||
      !String(getRowValueByHeader_(row, data.headers, 'Summary') || '').trim() ||
      !Number.isInteger(count) || count < 1) {
    throw createAiValidationError_('Incomplete news archive row requires repair.', false);
  }
  return { count: count };
}

function completeNewsArchiveState_(config, state, period, outcome) {
  state.nextStartAt = period.endAt;
  state.lastCompletedStartAt = period.startAt;
  state.lastCompletedEndAt = period.endAt;
  state.lastCompletedAt = Date.now();
  state.lastOutcome = outcome;
  state.runId = '';
  state.leaseUntil = 0;
  state.autoAttempts = 0;
  state.lastAutoDay = '';
  state.lastErrorCode = '';
  state.retryNotBeforeMs = 0;
  state.retryable = true;
  saveNewsArchiveState_(config, state);
}

function runFixedNewsArchive_(config, origin, event, aiExecutionContext) {
  const context = aiExecutionContext || { deadlineAtMs: Date.now() + (origin === 'auto' ? 180000 : 40000),
    aiTimeoutCapSeconds: origin === 'auto' ? 60 : 30, aiMinimumRequestSeconds: 8 };
  let reservation = null;
  let committing = false;
  try {
    reservation = withDataMutationLock_(function() {
      const state = getNewsArchiveState_(config);
      const now = Date.now();
      const period = { startAt: state.nextStartAt, endAt: state.nextStartAt + NEWS_ARCHIVE_WEEK_MS };
      if (period.endAt > getNewsArchiveClosedEnd_(now)) {
        return { status: 'up_to_date', lastOutcome: state.lastOutcome,
          period: state.lastCompletedEndAt ? { startAt: state.lastCompletedStartAt, endAt: state.lastCompletedEndAt } : null };
      }
      if (state.runId && state.leaseUntil > now) return { status: 'processing', period: period };
      const today = formatNewsArchiveTime_(now).slice(0, 10);
      const blocked = origin === 'auto' && (!state.retryable || state.autoAttempts >= NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS);
      const blockedErrorCode = state.lastErrorCode || 'ai_timeout';
      // 先恢復已落盤的摘要，不能讓重試上限擋住「寫入成功、進度更新失敗」的修復。
      try {
        const existing = findNewsArchiveRow_(config, period);
        if (existing) {
          completeNewsArchiveState_(config, state, period, 'completed');
          return { status: 'already_done', period: period, count: existing.count };
        }
        if (blocked) {
          saveNewsArchiveState_(config, state);
          return { status: 'needs_attention', period: period, errorCode: blockedErrorCode };
        }
        if (origin === 'auto' && state.retryNotBeforeMs > now) {
          return { status: 'quota_wait', period: period, errorCode: state.lastErrorCode, retryNotBeforeMs: state.retryNotBeforeMs };
        }
        if (origin === 'auto' && state.lastAutoDay === today) {
          saveNewsArchiveState_(config, state);
          return { status: 'waiting', period: period };
        }
        // 與 CreatedAt／append／flush 共用同一把短鎖；空期也不能跳過來源快照的協調。
        const items = getNewsArchivePeriodItems_(config, period);
        state.runId = Utilities.getUuid();
        state.leaseUntil = now + NEWS_ARCHIVE_LEASE_MS;
        const previousAutoDay = state.lastAutoDay;
        if (origin === 'auto') { state.autoAttempts++; state.lastAutoDay = today; }
        saveNewsArchiveState_(config, state);
        return { status: 'reserved', period: period, runId: state.runId, items: items, previousAutoDay: previousAutoDay };
      } catch (error) {
        // 自動恢復檢查失敗不能把原本不可重試／達上限的狀態改回可重試。
        if (blocked) {
          console.warn('NEWS_ARCHIVE_RECOVERY_READ_FAILED');
          return { status: 'needs_attention', period: period, errorCode: blockedErrorCode };
        }
        state.runId = ''; state.leaseUntil = 0;
        state.lastErrorCode = normalizeAiErrorReason_(error && error.errorReason) || normalizeAiErrorType_(error && error.errorType);
        state.retryable = !!(error && error.retryable === true);
        state.retryNotBeforeMs = 0;
        if (origin === 'auto' && state.lastAutoDay !== today && state.autoAttempts < NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS) {
          state.autoAttempts++; state.lastAutoDay = today;
        }
        saveNewsArchiveState_(config, state);
        throw error;
      }
    });
    if (reservation.status !== 'reserved') return reservation;
    const period = reservation.period;
    const items = reservation.items;
    const archiveJson = items.length ? buildNewsArchiveSummary_(items, {
      start: formatNewsArchiveTime_(period.startAt) + '（含）',
      end: formatNewsArchiveTime_(period.endAt) + '（不含，台灣時間）'
    }, context) : null;
    committing = true;
    const result = withDataMutationLock_(function() {
      const state = getNewsArchiveState_(config);
      if (state.runId !== reservation.runId || state.nextStartAt !== period.startAt) {
        return { status: 'cancelled', period: period };
      }
      if (Date.now() >= context.deadlineAtMs) throw createAiExecutionBudgetError_('News archive commit deadline expired.');
      const existing = findNewsArchiveRow_(config, period);
      if (archiveJson && !existing) {
        const parts = config.conversationId.split(':');
        const source = event && event.source || {};
        appendWeeklySummaryRow_({
          conversationId: config.conversationId, sourceType: parts[0],
          userId: origin === 'manual' ? source.userId || '' : '',
          groupId: parts[0] === 'group' ? parts[1] : '', roomId: parts[0] === 'room' ? parts[1] : '',
          topicTitle: archiveJson.topicTitle, summary: archiveJson.summary,
          keywords: archiveJson.keywords.join(', '), reusableAngles: archiveJson.reusableAngles.join('\n'),
          followUpQuestions: archiveJson.followUpQuestions.join('\n'), sourceItemCount: items.length,
          rawMessageCount: items.length,
          periodStart: formatNewsArchiveTime_(period.startAt).slice(0, 10),
          periodEnd: formatNewsArchiveTime_(period.endAt).slice(0, 10),
          archiveKey: getNewsArchiveKey_(config, period),
          periodStartAt: new Date(period.startAt).toISOString(), periodEndAt: new Date(period.endAt).toISOString(),
          archiveOrigin: origin
        });
        SpreadsheetApp.flush();
      }
      const outcome = existing || archiveJson ? 'completed' : 'empty';
      completeNewsArchiveState_(config, state, period, outcome);
      return { status: existing ? 'already_done' : outcome, period: period,
        count: existing ? existing.count : items.length };
    }, Math.max(0, Math.min(30000, context.deadlineAtMs - Date.now() - 1000)));
    if (result.status === 'busy') throw createAiExecutionBudgetError_('News archive commit lock is busy.');
    return result;
  } catch (error) {
    const code = normalizeAiErrorReason_(error && error.errorReason) || normalizeAiErrorType_(error && error.errorType);
    // 原生 Sheet／Properties 寫入錯誤可隔日補跑；typed validation 的不可重試決定仍保留。
    const retryable = error && typeof error.retryable === 'boolean' ? error.retryable : committing;
    const quota = getAiQuotaRetryHint_(error);
    const deferred = !!quota && quota.modelCalls === 0 && retryable;
    const failureState = { errorCode: code, retryable: retryable };
    if (quota) failureState.retryNotBeforeMs = quota.retryNotBeforeMs;
    if (deferred && origin === 'auto' && reservation && reservation.runId) failureState.refundAutoDay = reservation.previousAutoDay;
    if (reservation && reservation.runId) {
      let recorded = false;
      try {
        const update = withDataMutationLock_(function() {
          const state = getNewsArchiveState_(config);
          if (state.runId !== reservation.runId) return { status: 'cancelled' };
          applyNewsArchiveFailure_(state, failureState);
          saveNewsArchiveState_(config, state);
          return { status: 'recorded' };
        }, Math.max(0, Math.min(1000, context.deadlineAtMs - Date.now())));
        if (update.status === 'cancelled') return { status: 'cancelled', period: reservation.period };
        recorded = update && update.status !== 'busy';
      } catch (ignore) { console.error('News archive progress update failed.'); }
      if (!recorded) {
        try {
          PropertiesService.getScriptProperties().setProperty(
            getNewsArchiveStateKey_(config) + '_FAILURE_' + reservation.runId,
            JSON.stringify(failureState));
        } catch (ignore) { console.error('NEWS_ARCHIVE_FAILURE_RECEIPT_WRITE_FAILED'); }
      }
    }
    if (deferred) return { status: 'quota_wait', period: reservation && reservation.period,
      errorCode: code, retryNotBeforeMs: quota.retryNotBeforeMs };
    console.error('NEWS_ARCHIVE_FAILURE ' + code);
    return { status: 'failed', period: reservation && reservation.period,
      failure: { errorType: normalizeAiErrorType_(error && error.errorType), errorReason: code,
        retryable: retryable, httpStatus: Number(error && error.httpStatus) || 0, ...quota } };
  }
}

function processScheduledNewsArchives() {
  const deadline = Date.now() + 180000;
  const results = [];
  const configs = getNewsArchiveConfigs_().filter(function(config) { return config.autoEnabled; });
  // 多聊天室遇到模型慢回覆時，輪替先後順序，避免固定尾端聊天室一直拿不到時間。
  const offset = configs.length ? Math.floor(Date.now() / 86400000) % configs.length : 0;
  configs.slice(offset).concat(configs.slice(0, offset)).forEach(function(config) {
    if (Date.now() + 65000 > deadline) return;
    const result = runFixedNewsArchive_(config, 'auto', null, {
      deadlineAtMs: deadline, aiTimeoutCapSeconds: 60, aiMinimumRequestSeconds: 8
    });
    const safe = { status: result.status, errorCode: result.errorCode || result.failure && result.failure.errorReason || '',
      period: result.period || null, count: result.count || 0 };
    if (result.retryNotBeforeMs) safe.retryNotBeforeMs = result.retryNotBeforeMs;
    console.log('NEWS_ARCHIVE_STATUS ' + JSON.stringify(safe));
    results.push(safe);
  });
  return results;
}

function previewNewsArchiveSetup() {
  const preview = getNewsArchiveConfigs_().map(function(config) {
    const data = readNewsArchiveSheet_(WEEKLY_SUMMARY_SHEET_NAME, ['ConversationId', 'ArchiveType', 'Summary']);
    const legacyRows = data.rows.filter(function(row) {
      return getRowValueByHeader_(row, data.headers, 'ConversationId') === config.conversationId &&
        getRowValueByHeader_(row, data.headers, 'ArchiveType') === WEEKLY_ARCHIVE_TYPE_NEWS &&
        !getRowValueByHeader_(row, data.headers, 'ArchiveKey');
    });
    return { conversationId: config.conversationId, firstPeriodStartAt: new Date(config.firstStartAt).toISOString(),
      latestClosedEndAt: new Date(getNewsArchiveClosedEnd_(Date.now())).toISOString(),
      duePeriods: Math.max(0, Math.floor((getNewsArchiveClosedEnd_(Date.now()) - getNewsArchiveState_(config).nextStartAt) / NEWS_ARCHIVE_WEEK_MS)),
      legacyNewsArchiveCount: legacyRows.length,
      // 舊列只有日期，不能證明精確覆蓋；列出期間供維護者選切換點，不猜測 ArchiveKey。
      legacyPeriods: legacyRows.map(function(row) {
        return { periodStart: getRowValueByHeader_(row, data.headers, 'PeriodStart'),
          periodEnd: getRowValueByHeader_(row, data.headers, 'PeriodEnd'),
          archivedAt: getRowValueByHeader_(row, data.headers, 'ArchivedAt') };
      }) };
  });
  preview.forEach(function(item, index) {
    const safe = Object.assign({}, item, { configIndex: index + 1 });
    delete safe.conversationId;
    console.log('NEWS_ARCHIVE_PREVIEW ' + JSON.stringify(safe));
  });
  return preview;
}

function setupNewsArchiveStorage() {
  const configs = getNewsArchiveConfigs_();
  if (!configs.length) throw createAiConfigurationError_('Configure NEWS_ARCHIVE_CONFIG before setup.');
  readNewsArchiveSheet_(NEWS_INBOX_SHEET_NAME, ['CreatedAt', 'ConversationId', 'Status', 'Title', 'Url', 'Brief']);
  return withDataMutationLock_(function() {
    configs.forEach(function(config) { getNewsArchiveState_(config); });
    readNewsArchiveSheet_(WEEKLY_SUMMARY_SHEET_NAME, ['ConversationId', 'ArchiveType', 'Summary', 'SourceItemCount']);
    ensureWeeklySummarySheet_(true);
    SpreadsheetApp.flush();
    configs.forEach(function(config) { saveNewsArchiveState_(config, getNewsArchiveState_(config)); });
    return '新聞封存欄位與進度已準備；尚未安裝觸發器。';
  });
}

function installNewsArchiveTrigger() {
  const configs = getNewsArchiveConfigs_();
  if (!configs.some(function(config) { return config.autoEnabled; })) {
    throw createAiConfigurationError_('No automatic news archive scope is enabled.');
  }
  readNewsArchiveSheet_(WEEKLY_SUMMARY_SHEET_NAME, ['ConversationId', 'ArchiveType', 'Summary', 'SourceItemCount'].concat(NEWS_ARCHIVE_EXTRA_HEADERS));
  readNewsArchiveSheet_(NEWS_INBOX_SHEET_NAME, ['CreatedAt', 'ConversationId', 'Status', 'Title', 'Url', 'Brief']);
  configs.forEach(function(config) {
    if (!PropertiesService.getScriptProperties().getProperty(getNewsArchiveStateKey_(config))) {
      throw createAiConfigurationError_('Run setupNewsArchiveStorage before installing the trigger.');
    }
    getNewsArchiveState_(config);
  });
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'processScheduledNewsArchives') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('processScheduledNewsArchives').timeBased().atHour(12).nearMinute(15)
    .everyDays(1).inTimezone(NEWS_ARCHIVE_TIMEZONE).create();
  return '每日台灣時間中午檢查到期新聞週期；已完成的週期不重複封存。';
}

function getNewsArchiveStatusText_(conversationId) {
  try {
    const config = getNewsArchiveConfig_(conversationId);
    if (!config) return '固定週期新聞封存：未啟用（維持手動最近 7 天）。';
    const state = getNewsArchiveState_(config);
    const due = Math.max(0, Math.floor((getNewsArchiveClosedEnd_(Date.now()) - state.nextStartAt) / NEWS_ARCHIVE_WEEK_MS));
    const lines = ['固定週期新聞封存：' + (config.autoEnabled ? '已設定自動檢查' : '僅手動補跑') + '；週三 12:00 截止。',
      '待處理週期：' + due + '；目前這期自動嘗試：' + state.autoAttempts + '/' + NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS];
    if (state.lastCompletedEndAt) lines.push('最近完成：' + formatNewsArchiveTime_(state.lastCompletedStartAt) + ' ～ ' +
      formatNewsArchiveTime_(state.lastCompletedEndAt) + '（不含迄時）；' + (state.lastOutcome === 'empty' ? '無資料' : state.lastOutcome === 'cleared' ? '已清空舊封存' : '已封存'));
    if (due) lines.push('下一期：' + formatNewsArchiveTime_(state.nextStartAt) + ' ～ ' + formatNewsArchiveTime_(state.nextStartAt + NEWS_ARCHIVE_WEEK_MS));
    if (state.runId) lines.push(state.leaseUntil > Date.now() ? '封存正在處理中。' : '前次工作已逾期，可補跑。');
    if (state.retryNotBeforeMs > Date.now()) lines.push('配額延後（' + state.lastErrorCode.toUpperCase() + '）：最早 ' +
      formatNewsArchiveTime_(state.retryNotBeforeMs) + '（台灣時間）。');
    else if (state.lastErrorCode) lines.push('前次失敗：' + state.lastErrorCode.toUpperCase() +
      (!state.retryable || state.autoAttempts >= NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS ? '；需要處理後手動補跑。' :
        config.autoEnabled ? '；下次每日檢查補跑。' : '；自動封存已關閉，請用 #封存本週新聞 手動補跑。'));
    else if (state.autoAttempts >= NEWS_ARCHIVE_MAX_AUTO_ATTEMPTS) lines.push('自動嘗試已達上限，需維護者確認後手動補跑。');
    return lines.join('\n');
  } catch (ignore) { return '固定週期新聞封存：設定或進度無法讀取，請維護者檢查。'; }
}

// 由 performDataCleanup_ 的外層 ScriptLock 保護，這裡不重複取得鎖。
function clearNewsArchiveProgress_(conversationId) {
  const config = getNewsArchiveConfig_(conversationId);
  if (!config) return;
  const state = getNewsArchiveState_(config);
  const end = Math.max(config.firstStartAt, getNewsArchiveClosedEnd_(Date.now()));
  // 先取消執行中工作，避免清空後遲到的 AI 結果重新寫回。
  completeNewsArchiveState_(config, state, { startAt: end - NEWS_ARCHIVE_WEEK_MS, endAt: end }, 'cleared');
}

// ======================================================
// #封存本週新聞：將 NewsInbox 週摘要寫入 WeeklySummary
// ======================================================

function archiveWeeklyNews(event, conversationId, aiExecutionContext) {
  const config = getNewsArchiveConfig_(conversationId);
  if (config) return formatNewsArchiveResult_(runFixedNewsArchive_(config, 'manual', event, aiExecutionContext));

  const items = getRecentNewsInboxItems_(conversationId, DEFAULT_WEEKLY_NEWS_DAYS);

  if (!items.length) {
    return getBotTextNewsArchiveNoData_();
  }

  const period = getWeeklyArchivePeriod_(DEFAULT_WEEKLY_NEWS_DAYS);
  const archiveJson = buildNewsArchiveSummary_(items, period, aiExecutionContext);
  const source = event.source || {};

  appendWeeklySummaryRow_({
    conversationId: conversationId,
    sourceType: source.type || '',
    userId: source.userId || '',
    groupId: source.groupId || '',
    roomId: source.roomId || '',
    topicTitle: archiveJson.topicTitle || '',
    keywords: archiveJson.keywords.join(', '),
    summary: archiveJson.summary || '',
    reusableAngles: archiveJson.reusableAngles.join('\n'),
    followUpQuestions: archiveJson.followUpQuestions.join('\n'),
    rawMessageCount: items.length,
    periodStart: period.start,
    periodEnd: period.end,
    sourceItemCount: items.length
  });

  return getBotTextNewsArchiveDone_(archiveJson, items.length);
}

function buildNewsArchiveSummary_(items, period, aiExecutionContext) {
  const newsText = formatNewsInboxItemsForArchivePrompt_(items);

  const prompt = [
    '請把以下 NewsInbox 新聞素材整理成「本週新聞週報索引」。',
    '',
    '用途：',
    '這份索引未來會被 #本週新聞 讀取，用來判斷新一週新聞和過去新聞脈絡是否有延續、反轉或可合併討論的關聯。',
    '它不是短心得，也不是只挑一個主題；它要像本週新聞週報目錄，讓未來可以快速想起這週有哪些代表素材。',
    '',
    '資料來源說明：',
    '1. NewsInbox 是群組貼網址或 #新聞補充 收進來的新聞素材。',
    '2. Outline 是完整大綱，Brief 是短簡介；請優先使用 Outline，沒有 Outline 時才使用 Brief。',
    '3. Category、Angle 與 TopicPotential 可協助判斷素材用途，但不得覆蓋原始新聞事實。',
    '4. SpecialTopic 與 MatchedEntities 用來保留人物、公司、平台、政策、作品、產品或事件名稱；若有 ClassificationWarning，請保守看待該素材分類。',
    '5. 不要加入外部資料，也不要捏造新聞之間沒有呈現的關聯。',
    '',
    '請輸出成 JSON，且只輸出 JSON，不要加任何解釋文字。',
    '',
    'JSON 格式如下：',
    '{',
    '  "topicTitle": "一句話概括本週新聞索引主軸；若素材分散，請寫成多主軸索引標題",',
    '  "keywords": ["代表性事件、人物、公司、平台、政策、作品或主題關鍵字1", "關鍵字2", "關鍵字3"],',
    '  "summary": "180到260字週報索引，保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡；素材分散時可用分號串起 2 到 4 個主軸",',
    '  "reusableAngles": ["40字內可重用事件索引或脈絡1", "40字內可重用事件索引或脈絡2", "40字內可重用事件索引或脈絡3"],',
    '  "followUpQuestions": ["40字內後續追蹤問題1", "40字內後續追蹤問題2", "40字內後續追蹤問題3"]',
    '}',
    '',
    '要求：',
    '1. 使用繁體中文。',
    '2. 重點是建立可供未來比對的新聞索引，不要寫成節目逐字稿，也不要只寫抽象趨勢。',
    '3. 不要因為追求精簡而漏掉代表性素材；同一主軸下可合併，但應留下可辨識的事件名稱或主角。',
    '4. 若本週新聞分散，請整理出 2 到 4 個共同主軸，並保留每個主軸的代表素材。',
    '5. keywords 最多 8 個；reusableAngles 與 followUpQuestions 各最多 3 個，每個項目 40 字內。',
    '6. 整個 JSON 請控制在 1000 個中文字內，避免輸出被截斷。',
    '7. 保留有助於未來辨識延續事件的關鍵人物、公司、平台、政策、作品名稱、產品名稱或事件名稱。',
    '8. 若某些素材沒有明顯共同主軸，也請以「其他值得追蹤」形式納入摘要，不要直接丟掉。',
    '',
    '封存期間：' + period.start + ' ～ ' + period.end,
    '',
    '以下是本週 NewsInbox：',
    newsText
  ].join('\n');

  return validateArchiveJsonContract_(
    requireAiJson_(runAiJsonTask(
      'archive_news',
      prompt,
      requireAiCallOptionsForExecutionContext_(aiExecutionContext)
    )),
    'news_archive'
  );
}

function formatNewsInboxItemsForArchivePrompt_(items) {
  return items.map(function(item, index) {
    return [
      '【新聞 ' + (index + 1) + '】',
      '故事線：' + normalizeStoryKey_(item.storyKey, item),
      '分類：' + (item.category || '待分類'),
      item.specialTopic && item.specialTopic !== '無' ? '特殊主題：' + item.specialTopic : '',
      item.matchedEntities && item.matchedEntities !== '無' ? '辨識實體：' + item.matchedEntities : '',
      '標題：' + (item.title || '未取得標題'),
      '網址：' + (item.url || ''),
      '節目潛力：' + (item.topicPotential || '中'),
      '內容：' + (item.outline || item.brief || '無'),
      '切角：' + (item.angle || '無'),
      item.classificationWarning ? '分類警告：' + item.classificationWarning : ''
    ].filter(function(line) { return line !== ''; }).join('\n');
  }).join('\n\n');
}

function getWeeklyArchivePeriod_(days) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000);

  return {
    start: formatArchiveDate_(start),
    end: formatArchiveDate_(end)
  };
}

function formatArchiveDate_(date) {
  try {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  } catch (error) {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * 手動與排程新聞封存共用的功能契約 validator。
 * AiService 只檢查合法 JSON object；本函式負責必要欄位與陣列型別，避免不完整長期記憶寫入 WeeklySummary。
 * 封存驗證失敗不自動 retry，讓維護者稍後重試並保留可觀察的錯誤邊界。
 */
function validateArchiveJsonContract_(parsed, sourceLabel) {
  const value = parsed || {};
  const required = ['topicTitle', 'keywords', 'summary', 'reusableAngles', 'followUpQuestions'];
  const missingFields = required.filter(function(field) {
    return !Object.prototype.hasOwnProperty.call(value, field);
  });
  if (missingFields.length || !String(value.summary || '').trim()) {
    throw createAiValidationError_(
      String(sourceLabel || 'archive') + ' missing required fields or summary: ' + missingFields.join(', '),
      false
    );
  }
  if (!Array.isArray(value.keywords) || !Array.isArray(value.reusableAngles) || !Array.isArray(value.followUpQuestions)) {
    throw createAiValidationError_(String(sourceLabel || 'archive') + ' array contract is invalid.', false);
  }
  return value;
}
