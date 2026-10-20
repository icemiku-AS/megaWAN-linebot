// 固定週期封存／週編輯台／Queue 回歸；只用 Node 內建模組，所有 GAS／HTTP 都是記憶體 mock。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = fs.readdirSync(root).filter(name => name.endsWith('.gs'))
  .map(name => fs.readFileSync(path.join(root, name), 'utf8')).join('\n');
const week = 604800000, start = Date.parse('2026-10-07T12:00:00+08:00'), end = start + week;
const extraHeaders = ['ArchiveKey', 'PeriodStartAt', 'PeriodEndAt', 'ArchiveOrigin'];
const legacyHeaders = ['ArchivedAt', 'ConversationId', 'SourceType', 'UserId', 'GroupId', 'RoomId',
  'TopicTitle', 'Keywords', 'Summary', 'ReusableAngles', 'FollowUpQuestions', 'RawMessageCount',
  'ArchiveType', 'PeriodStart', 'PeriodEnd', 'SourceItemCount'];
const newsHeaders = ['CreatedAt', 'ConversationId', 'Status', 'Title', 'Url', 'Brief', 'Category', 'StoryKey'];
const chatHeaders = ['Timestamp', 'ConversationId', 'Role', 'Mode', 'UserId', 'Text', 'MessageId'];
const archive = { topicTitle: '本週新聞索引', keywords: ['新聞'], summary: '本週新聞保留代表事件與主要脈絡。',
  reusableAngles: ['事件後續'], followUpQuestions: ['下週有何進展？'] };
const event = { source: { type: 'group', groupId: 'a', userId: 'alice' } };

class Sheet {
  constructor(headers, rows = []) { this.data = [headers.slice(), ...rows.map(row => row.slice())]; this.failRead = false; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return Math.max(...this.data.map(row => row.length)); }
  getRange(row, column, rows = 1, columns = 1) {
    return {
      getValues: () => {
        if (this.failRead) throw Error('PRIVATE_SHEET_FAILURE');
        return Array.from({ length: rows }, (_, i) => Array.from({ length: columns },
          (_, j) => this.data[row - 1 + i]?.[column - 1 + j] ?? ''));
      },
      setValues: values => values.forEach((valuesRow, i) => valuesRow.forEach((v, j) => {
        this.data[row - 1 + i] ||= []; this.data[row - 1 + i][column - 1 + j] = v;
      })),
      setValue: v => { this.data[row - 1] ||= []; this.data[row - 1][column - 1] = v; }
    };
  }
  appendRow(row) { this.data.push(Array.from(row)); }
  deleteRow(row) { this.data.splice(row - 1, 1); }
  setFrozenRows() {}
  records() { return this.data.slice(1).map(row => Object.fromEntries(this.data[0].map((h, i) => [h, row[i] ?? '']))); }
}

function env({ configured = true, legacy = false, clock = end + 900000 } = {}) {
  let now = clock, held = false, uuid = 0, busy = false, busyUntil = 0, propertyFailure = null, ai = null, flush = null;
  const props = new Map(), logs = [], models = [], fetches = [], triggers = [], lockWaits = [];
  const sheets = new Map([
    ['WeeklySummary', new Sheet(legacy ? legacyHeaders : legacyHeaders.concat(extraHeaders))],
    ['NewsInbox', new Sheet(newsHeaders)],
    ['ConversationLog', new Sheet(chatHeaders)]
  ]);
  if (configured) props.set('NEWS_ARCHIVE_CONFIG', JSON.stringify({ conversations: [
    { conversationId: 'group:a', autoEnabled: true, firstPeriodStartAt: new Date(start).toISOString() }
  ] }));
  const c = vm.createContext({
    console: Object.fromEntries(['log', 'warn', 'error'].map(key => [key, (...args) => logs.push(args.join(' '))])),
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props.get(key) ?? (['DEEPSEEK_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN'].includes(key) ? 'test-only-placeholder' : null),
      getKeys: () => [...props.keys()],
      setProperty: (key, value) => { if (propertyFailure) propertyFailure(key, value); props.set(key, value); },
      deleteProperty: key => props.delete(key)
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: waitMs => {
        lockWaits.push(waitMs);
        if (held) return false;
        if (busy) { now += waitMs; return false; }
        if (busyUntil > now) {
          now += Math.min(waitMs, busyUntil - now);
          if (busyUntil > now) return false;
        }
        held = true; return true;
      },
      releaseLock: () => { assert(held); held = false; }
    }) },
    SpreadsheetApp: { flush: () => { if (flush) flush(); } },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Utilities: {
      getUuid: () => 'run-' + ++uuid, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      newBlob: value => ({ getBytes: () => Array.from(Buffer.from(value)) }),
      computeDigest: (_algorithm, value) => [...crypto.createHash('sha256').update(value).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString('base64url'),
      formatDate: date => new Date(date.getTime() + 28800000).toISOString().slice(0, 10)
    },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: trigger => triggers.splice(triggers.indexOf(trigger), 1),
      newTrigger: handler => {
        const data = { getHandlerFunction: () => handler };
        const builder = { timeBased: () => builder, create: () => triggers.push(data) };
        for (const method of ['atHour', 'nearMinute', 'everyDays', 'inTimezone']) builder[method] = value => { data[method] = value; return builder; };
        return builder;
      }
    },
    UrlFetchApp: { fetch: (url, options) => {
      fetches.push({ url, options });
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
        object: 'response', status: 'completed',
        output: [{ type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(archive) }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
      }) };
    } }
  });
  const cache = new Map();
  vm.runInContext(source, c);
  c.getSpreadsheet_ = () => ({ getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const sheet = new Sheet([]); sheets.set(name, sheet); return sheet; } });
  const realRunAiJsonTask = c.runAiJsonTask;
  c.runAiJsonTask = (...args) => {
    assert(!held, 'AI cannot run while ScriptLock is held');
    models.push(args);
    return ai ? ai(...args) : { ok: true, json: structuredClone(archive) };
  };
  const config = () => c.getNewsArchiveConfig_('group:a');
  const run = (origin = 'manual', context) => c.runFixedNewsArchive_(config(), origin, event, context);
  const stateKey = () => c.getNewsArchiveStateKey_(config());
  return { c, props, logs, models, fetches, triggers, sheets, cache, lockWaits, run, config, stateKey,
    state: () => c.getNewsArchiveState_(config()), now: () => now, setNow: value => { now = value; },
    setBusy: value => { busy = value; }, setAi: value => { ai = value; },
    setBusyUntil: value => { busyUntil = value; },
    setPropertyFailure: value => { propertyFailure = value; }, setFlush: value => { flush = value; },
    restoreAi: () => { c.runAiJsonTask = realRunAiJsonTask; }, held: () => held };
}

function news(e, time = start + 1000, scope = 'group:a', title = '代表新聞', status = 'ok') {
  e.sheets.get('NewsInbox').appendRow([typeof time === 'number' ? new Date(time).toISOString() : time, scope,
    status, title, 'https://example.org/' + encodeURIComponent(title), '新聞摘要', '科技與 AI', title]);
}
function seedArchive(e, periodStart = start, scope = 'group:a', patch = {}) {
  const config = { ...e.config(), conversationId: scope }, period = { startAt: periodStart, endAt: periodStart + week };
  e.c.appendWeeklySummaryRow_({ conversationId: scope, archiveType: 'news', summary: '已存摘要', sourceItemCount: 1,
    archiveKey: e.c.getNewsArchiveKey_(config, period), periodStartAt: new Date(period.startAt).toISOString(),
    periodEndAt: new Date(period.endAt).toISOString(), ...patch });
}
let checks = 0;
function check(name, run) { run(); checks++; process.stdout.write('PASS ' + name + '\n'); }

check('Taipei Wednesday noon half-open boundary survives UTC date, year and exact cutoff', () => {
  const e = env();
  for (const text of ['2026-10-14T12:00:00+08:00', '2026-12-30T12:00:00+08:00', '2027-01-06T12:00:00+08:00']) {
    const t = Date.parse(text);
    assert.equal(e.c.getNewsArchiveClosedEnd_(t - 1), t - week);
    assert.equal(e.c.getNewsArchiveClosedEnd_(t), t);
    assert.equal(e.c.getNewsArchiveClosedEnd_(t + week - 1), t);
  }
  assert.equal(e.c.formatNewsArchiveTime_(end), '2026-10-14 12:00');
});
check('configuration absent stays off and keeps legacy manual rolling7 behavior', () => {
  const e = env({ configured: false }); news(e, end - 1000);
  assert.equal(e.c.getNewsArchiveConfigs_().length, 0);
  assert.equal(e.c.processScheduledNewsArchives().length, 0);
  assert(e.c.archiveWeeklyNews(event, 'group:a').includes('已經放進 WeeklySummary'));
  assert.equal(e.models.length, 1);
  assert.equal(e.sheets.get('WeeklySummary').records()[0].ArchiveKey, '');
  assert(e.c.getNewsArchiveStatusText_('group:a').includes('未啟用'));
});
check('invalid config never reads or writes Sheet, invokes AI or installs a trigger', () => {
  const bad = ['{', '{}', '{"conversations":{}}',
    JSON.stringify({ conversations: [{ conversationId: 'group:a', autoEnabled: 'true', firstPeriodStartAt: new Date(start).toISOString() }] }),
    JSON.stringify({ conversations: [{ conversationId: 'group:a', autoEnabled: true, firstPeriodStartAt: '2026-10-07T12:00:00' }] }),
    JSON.stringify({ conversations: [{ conversationId: '../a', autoEnabled: true, firstPeriodStartAt: new Date(start).toISOString() }] }),
    JSON.stringify({ conversations: [{ conversationId: 'group:a', autoEnabled: true, firstPeriodStartAt: new Date(start + 1).toISOString() }] })];
  for (const raw of bad) {
    const e = env(); e.props.set('NEWS_ARCHIVE_CONFIG', raw);
    assert.throws(() => e.c.processScheduledNewsArchives()); assert.throws(() => e.c.installNewsArchiveTrigger());
    assert.equal(e.models.length, 0); assert.equal(e.triggers.length, 0);
    assert.equal(e.sheets.get('WeeklySummary').records().length, 0);
  }
  const e = env(), item = JSON.parse(e.props.get('NEWS_ARCHIVE_CONFIG')).conversations[0];
  e.props.set('NEWS_ARCHIVE_CONFIG', JSON.stringify({ conversations: [item, item] }));
  assert.throws(() => e.config());
});
check('future or still-open period is never archived, even by manual command', () => {
  const e = env({ clock: end - 1 }); news(e);
  assert.equal(e.run().status, 'up_to_date'); assert.equal(e.models.length, 0);
  e.setNow(end); assert.equal(e.run().status, 'completed');
});
check('exact interval uses CreatedAt, correct room and ok status; adjacent periods do not overlap', () => {
  const e = env();
  for (const [time, scope, title, status] of [
    [start - 1, 'group:a', 'before'], [start, 'group:a', 'inclusive'], [end - 1, 'group:a', 'last'],
    [end, 'group:a', 'next'], [start + 1, 'group:b', 'other'], [start + 2, 'group:a', 'failed', 'failed']
  ]) news(e, time, scope, title, status);
  const result = e.run(); assert.equal(result.count, 2); assert.equal(e.models.length, 1);
  const prompt = e.models[0][1];
  assert(prompt.includes('inclusive')); assert(prompt.includes('last'));
  for (const word of ['before', 'next', 'other', 'failed']) assert(!prompt.includes('標題：' + word));
  e.setNow(end + week); assert.equal(e.run().count, 1);
  assert.equal(e.sheets.get('WeeklySummary').records().length, 2);
});
check('automatic then manual then automatic produces one AI call and one archive', () => {
  const e = env(); news(e);
  assert.equal(e.run('auto').status, 'completed');
  assert(e.c.archiveWeeklyNews(event, 'group:a').includes('不重複封存'));
  assert.equal(e.run('auto').status, 'up_to_date'); assert.equal(e.models.length, 1);
  const row = e.sheets.get('WeeklySummary').records()[0];
  assert.equal(row.ArchiveOrigin, 'auto'); assert.equal(row.UserId, '');
  assert.equal(row.ArchiveType, 'news'); assert.equal(row.SourceItemCount, 1);
  assert.equal(Date.parse(row.PeriodStartAt), start); assert.equal(Date.parse(row.PeriodEndAt), end);
  assert.equal(row.PeriodStart, '2026-10-07'); assert.equal(row.PeriodEnd, '2026-10-14');
});
check('manual then auto shares key; another room cannot collide', () => {
  const e = env(); news(e);
  assert.equal(e.run().status, 'completed'); assert.equal(e.run('auto').status, 'up_to_date');
  assert.equal(e.sheets.get('WeeklySummary').records()[0].UserId, 'alice');
  assert.notEqual(e.c.getNewsArchiveKey_(e.config(), { startAt: start, endAt: end }),
    e.c.getNewsArchiveKey_({ ...e.config(), conversationId: 'group:b' }, { startAt: start, endAt: end }));
});
check('parallel manual/auto invocation reserves once and never holds the lock during AI', () => {
  const e = env(); news(e);
  e.setAi(() => { assert(!e.held()); assert.equal(e.run('auto').status, 'processing'); return { ok: true, json: archive }; });
  assert.equal(e.run().status, 'completed');
  assert.equal(e.models.length, 1); assert.equal(e.sheets.get('WeeklySummary').records().length, 1); assert(!e.held());
});
check('busy lock does not call AI, append rows or claim success', () => {
  const e = env(); news(e); e.setBusy(true);
  assert.equal(e.run().status, 'busy'); assert.equal(e.models.length, 0); assert.equal(e.props.size, 1);
});
check('retryable error retries once/day up to three automatic attempts and permits manual recovery', () => {
  const e = env(); news(e);
  e.setAi(() => ({ ok: false, errorType: 'ai_rate_limit', retryable: true }));
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(e.run('auto').status, 'failed');
    assert.equal(e.state().nextStartAt, start); assert.equal(e.state().autoAttempts, attempt);
    assert.equal(e.run('auto').status, attempt === 3 ? 'needs_attention' : 'waiting');
    e.setNow(e.now() + 86400000);
  }
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, 3);
  e.setAi(null); assert.equal(e.run().status, 'completed');
  assert.equal(e.state().autoAttempts, 0); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
});
check('nonretryable error stops automatic calls until explicitly retried manually', () => {
  const e = env(); news(e);
  e.setAi(() => ({ ok: false, errorType: 'ai_auth_error', retryable: false }));
  assert.equal(e.run('auto').status, 'failed'); e.setNow(e.now() + 86400000);
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, 1);
  e.setAi(null); assert.equal(e.run().status, 'completed');
});
check('invalid archive JSON never reaches WeeklySummary or advances the period', () => {
  const e = env(); news(e); e.setAi(() => ({ ok: true, json: { ...archive, summary: '' } }));
  assert.equal(e.run().status, 'failed'); assert.equal(e.state().nextStartAt, start);
  assert.equal(e.sheets.get('WeeklySummary').records().length, 0); assert(!e.held());
});
check('no rows records an empty period without AI, summary row or retry', () => {
  const e = env();
  assert.equal(e.run('auto').status, 'empty'); assert.equal(e.state().nextStartAt, end);
  assert.equal(e.state().lastOutcome, 'empty'); assert.equal(e.run().status, 'up_to_date');
  assert.equal(e.models.length, 0); assert.equal(e.sheets.get('WeeklySummary').records().length, 0);
});
for (const failure of ['missing NewsInbox', 'missing Summary', 'missing CreatedAt', 'duplicate header', 'read error', 'invalid date']) {
  check(failure + ' fails distinctly from an empty archive and retains cursor', () => {
    const e = env();
    if (failure === 'missing NewsInbox') e.sheets.delete('NewsInbox');
    if (failure === 'missing Summary') e.sheets.get('WeeklySummary').data[0][8] = 'Wrong';
    if (failure === 'missing CreatedAt') e.sheets.get('NewsInbox').data[0][0] = 'Wrong';
    if (failure === 'duplicate header') e.sheets.get('NewsInbox').data[0].push('CreatedAt');
    if (failure === 'read error') e.sheets.get('NewsInbox').failRead = true;
    if (failure === 'invalid date') news(e, 'not-a-date');
    assert.equal(e.run('auto').status, 'failed'); assert.equal(e.state().nextStartAt, start);
    assert.equal(e.state().lastOutcome, ''); assert(e.state().lastErrorCode);
    assert.equal(e.models.length, 0); assert.equal(e.sheets.get('WeeklySummary').records().length, 0);
    assert(!e.logs.join('').includes('PRIVATE_SHEET_FAILURE')); assert(!e.held());
  });
}
check('bad dates in another room and failed source rows do not block the configured room', () => {
  const e = env(); news(e); news(e, 'invalid', 'group:b'); news(e, 'invalid', 'group:a', 'failed', 'failed');
  assert.equal(e.run().count, 1);
});
check('a persisted row beyond the recent100 window recovers state with zero model calls', () => {
  const e = env(); seedArchive(e);
  for (let i = 0; i < 105; i++) e.c.appendWeeklySummaryRow_({ conversationId: 'group:b', summary: '其他聊天室' });
  assert.equal(e.run().status, 'already_done'); assert.equal(e.state().nextStartAt, end); assert.equal(e.models.length, 0);
});
check('row committed then property write failure recovers without duplicate summary or model', () => {
  const e = env(); news(e); let failed = false;
  e.setPropertyFailure((key, raw) => {
    if (!failed && key.startsWith('NEWS_ARCHIVE_STATE_') && JSON.parse(raw).lastOutcome === 'completed') {
      failed = true; throw Error('PRIVATE_PROPERTY_FAILURE');
    }
  });
  assert.equal(e.run().status, 'failed'); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
  e.setPropertyFailure(null);
  assert.equal(e.run('auto').status, 'already_done'); assert.equal(e.models.length, 1);
  assert.equal(e.state().nextStartAt, end); assert(!e.logs.join('').includes('PRIVATE_PROPERTY_FAILURE'));
});
check('ambiguous flush failure after append also recovers by the archive key', () => {
  const e = env(); news(e); e.setFlush(() => { throw Error('PRIVATE_FLUSH_FAILURE'); });
  assert.equal(e.run().status, 'failed'); e.setFlush(null);
  assert.equal(e.run().status, 'already_done'); assert.equal(e.models.length, 1);
  assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
});
check('native write failure before append is retryable next day without advancing the cursor', () => {
  const e = env(); news(e);
  const sheet = e.sheets.get('WeeklySummary'), append = sheet.appendRow.bind(sheet);
  sheet.appendRow = () => { throw Error('PRIVATE_WRITE_FAILURE'); };
  assert.equal(e.run('auto').status, 'failed'); assert.equal(e.state().retryable, true);
  assert.equal(e.run('auto').status, 'waiting'); assert.equal(e.models.length, 1);
  sheet.appendRow = append; e.setNow(e.now() + 86400000);
  assert.equal(e.run('auto').status, 'completed'); assert.equal(e.models.length, 2);
  assert.equal(sheet.records().length, 1); assert(!e.logs.join('').includes('PRIVATE_WRITE_FAILURE'));
});
check('crashed reservation lease can be reclaimed; late old AI result cannot write', () => {
  const e = env(); news(e); let first = true;
  e.setAi(() => {
    if (first) { first = false; e.setNow(e.now() + 300001); assert.equal(e.run().status, 'completed'); }
    return { ok: true, json: archive };
  });
  assert.equal(e.run().status, 'cancelled'); assert.equal(e.models.length, 2);
  assert.equal(e.sheets.get('WeeklySummary').records().length, 1); assert.equal(e.state().nextStartAt, end);
});
check('three hard-crashed attempts cannot bypass the automatic retry ceiling', () => {
  const e = env(); news(e);
  const state = e.state(); Object.assign(state, { autoAttempts: 3, runId: 'crashed', leaseUntil: e.now() - 1 });
  e.props.set(e.stateKey(), JSON.stringify(state));
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, 0);
  assert.equal(e.run().status, 'completed');
});
check('duplicate or incomplete keys stop rather than silently accept or append a third copy', () => {
  for (const kind of ['duplicate', 'bad period', 'missing summary', 'bad count']) {
    const e = env(); news(e); seedArchive(e);
    if (kind === 'duplicate') seedArchive(e);
    else {
      const sheet = e.sheets.get('WeeklySummary'), header = kind === 'bad period' ? 'PeriodEndAt' : kind === 'bad count' ? 'SourceItemCount' : 'Summary';
      sheet.data[1][sheet.data[0].indexOf(header)] = kind === 'bad count' ? 'invalid' : '';
    }
    assert.equal(e.run().status, 'failed'); assert.equal(e.models.length, 0);
    assert.equal(e.state().nextStartAt, start);
  }
});
check('corrupted or reconfigured progress fails closed without resetting historical cursor', () => {
  const e = env(); news(e); assert.equal(e.run().status, 'completed');
  const valid = e.props.get(e.stateKey());
  for (const patch of [{ nextStartAt: start + 1 }, { autoAttempts: 4 }, { lastCompletedEndAt: end + week }, { firstStartAt: start - week }]) {
    e.props.set(e.stateKey(), JSON.stringify({ ...JSON.parse(valid), ...patch }));
    assert.equal(e.run().status, 'failed'); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
  }
});
check('oldest failed backlog blocks later weeks; one run finishes only one period', () => {
  const e = env({ clock: end + week * 2 }); news(e); news(e, end + 1, 'group:a', '第二週');
  e.setAi(() => ({ ok: false, errorType: 'ai_rate_limit', retryable: true }));
  assert.equal(e.c.processScheduledNewsArchives()[0].status, 'failed'); assert.equal(e.state().nextStartAt, start);
  e.setNow(e.now() + 86400000); e.setAi(null);
  assert.equal(e.c.processScheduledNewsArchives()[0].status, 'completed');
  assert.equal(e.state().nextStartAt, end); assert.equal(e.models.length, 2);
  assert.equal(e.c.processScheduledNewsArchives()[0].status, 'completed');
  assert.equal(e.state().nextStartAt, end + week);
});
check('scheduler isolates enabled rooms and rotates within one shared execution deadline', () => {
  const e = env(), raw = JSON.parse(e.props.get('NEWS_ARCHIVE_CONFIG')), first = raw.conversations[0];
  raw.conversations.push({ ...first, conversationId: 'group:b', autoEnabled: false }, { ...first, conversationId: 'room:c' });
  e.props.set('NEWS_ARCHIVE_CONFIG', JSON.stringify(raw));
  news(e); news(e, start + 1, 'room:c'); news(e, start + 2, 'group:b');
  e.setAi((_task, _prompt, options) => {
    assert.equal(options.executionDeadlineAtMs, e.now() + 180000);
    assert.equal(options.timeoutCapSeconds, 60);
    return { ok: true, json: archive };
  });
  const results = e.c.processScheduledNewsArchives();
  assert.equal(results.length, 2); assert.equal(e.models.length, 2);
  assert(!e.props.has('NEWS_ARCHIVE_STATE_' + e.c.computeWeeklyEditorialInputHash_('group:b')));
  assert.equal(e.sheets.get('WeeklySummary').records().filter(row => row.ConversationId === 'room:c').length, 1);
  assert(!e.logs.filter(line => line.startsWith('NEWS_ARCHIVE_STATUS')).join('').includes('https://'));
});
check('slow rooms do not exceed the shared scheduler budget or starve the same tail forever', () => {
  const e = env(), raw = JSON.parse(e.props.get('NEWS_ARCHIVE_CONFIG')), first = raw.conversations[0];
  for (const scope of ['group:b', 'group:c', 'group:d']) raw.conversations.push({ ...first, conversationId: scope });
  e.props.set('NEWS_ARCHIVE_CONFIG', JSON.stringify(raw));
  for (const item of raw.conversations) news(e, start + 1, item.conversationId, item.conversationId);
  const attemptScopes = [];
  e.setAi((_task, prompt, options) => {
    const cutoff = options.executionDeadlineAtMs;
    assert(cutoff - e.now() >= 65000);
    attemptScopes.push(raw.conversations.find(item => prompt.includes('標題：' + item.conversationId)).conversationId);
    e.setNow(e.now() + 60000);
    return { ok: true, json: archive };
  });
  const began = e.now();
  assert.equal(e.c.processScheduledNewsArchives().length, 2);
  assert.equal(e.now() - began, 120000);
  const firstDay = attemptScopes.slice();
  e.setNow(began + 86400000);
  e.c.processScheduledNewsArchives();
  assert(attemptScopes.some(scope => !firstDay.includes(scope)));
  assert.equal(e.sheets.get('WeeklySummary').records().length, 4);
});
check('expired manual deadline makes zero model calls and remains available for a later retry', () => {
  const e = env(); news(e);
  const result = e.c.runFixedNewsArchive_(e.config(), 'manual', event,
    { deadlineAtMs: e.now() - 1, aiTimeoutCapSeconds: 30, aiMinimumRequestSeconds: 8 });
  assert.equal(result.status, 'failed'); assert.equal(result.failure.errorReason, 'local_time_budget');
  assert.equal(e.models.length, 0); assert.equal(e.state().nextStartAt, start);
  assert.equal(e.run('auto').status, 'completed');
});
check('preview is read-only; explicit setup only appends four columns and is repeatable', () => {
  const e = env({ legacy: true });
  e.c.appendWeeklySummaryRow_({ conversationId: 'group:a', archiveType: 'news', summary: '舊封存' });
  const sheet = e.sheets.get('WeeklySummary'), old = JSON.stringify(sheet.data);
  const before = [...e.props];
  const preview = e.c.previewNewsArchiveSetup()[0];
  assert.equal(preview.legacyNewsArchiveCount, 1); assert.equal(preview.legacyPeriods.length, 1);
  assert(e.logs.some(line => line.startsWith('NEWS_ARCHIVE_PREVIEW '))); assert(!e.logs.join('').includes('group:a'));
  assert.deepEqual([...e.props], before); assert.equal(JSON.stringify(sheet.data), old);
  assert.equal(e.c.ensureWeeklySummarySheet_().data[0].length, 16, 'ordinary reads do not migrate');
  e.c.setupNewsArchiveStorage(); e.c.setupNewsArchiveStorage();
  assert.deepEqual(sheet.data[0], legacyHeaders.concat(extraHeaders));
  assert.equal(JSON.stringify(sheet.data[1]), JSON.stringify(JSON.parse(old)[1]));
  assert.equal(e.triggers.length, 0); assert.equal(e.models.length, 0);
});
check('trigger installer requires setup, replaces only its own handler and keeps Taipei daily check', () => {
  const e = env();
  assert.throws(() => e.c.installNewsArchiveTrigger());
  e.c.setupNewsArchiveStorage();
  const unrelated = { getHandlerFunction: () => 'processNewsUrlQueue' }; e.triggers.push(unrelated);
  e.c.installNewsArchiveTrigger(); e.c.installNewsArchiveTrigger();
  assert.equal(e.triggers.length, 2); assert(e.triggers.includes(unrelated));
  const trigger = e.triggers.find(item => item !== unrelated);
  assert.equal(trigger.atHour, 12); assert.equal(trigger.nearMinute, 15);
  assert.equal(trigger.everyDays, 1); assert.equal(trigger.inTimezone, 'Asia/Taipei');
});
check('setup preserves reordered columns and custom values; broken old schema does not migrate', () => {
  const e = env({ legacy: true });
  const headers = ['Custom', ...legacyHeaders.slice().reverse()];
  const row = headers.map(header => ({ Custom: '保留自訂內容', ConversationId: 'group:a', Summary: '舊摘要' })[header] || '');
  e.sheets.set('WeeklySummary', new Sheet(headers, [row]));
  e.c.setupNewsArchiveStorage();
  assert.deepEqual(e.sheets.get('WeeklySummary').data[0], headers.concat(extraHeaders));
  assert.deepEqual(e.sheets.get('WeeklySummary').data[1], row);
  const broken = env({ legacy: true }); broken.sheets.get('WeeklySummary').data[0][8] = 'Wrong';
  const before = JSON.stringify(broken.sheets.get('WeeklySummary').data);
  assert.throws(() => broken.c.setupNewsArchiveStorage());
  assert.equal(JSON.stringify(broken.sheets.get('WeeklySummary').data), before);
  assert.equal(broken.props.size, 1); assert.equal(broken.triggers.length, 0);
});
check('cleanup cancels in-flight result and prevents old periods returning; next week resumes', () => {
  const e = env(); news(e); seedArchive(e, start - week, 'group:b');
  e.setAi(() => {
    assert.equal(e.c.performDataCleanup_('weekly_summary', 'group:a').total, 0);
    return { ok: true, json: archive };
  });
  assert.equal(e.run().status, 'cancelled');
  assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
  assert.equal(e.state().nextStartAt, end); assert.equal(e.run('auto').status, 'up_to_date');
  e.setAi(null); e.setNow(end + week); news(e, end + 1, 'group:a', '新週素材');
  assert.equal(e.run('auto').status, 'completed');
  assert.equal(e.sheets.get('WeeklySummary').records().filter(row => row.ConversationId === 'group:b').length, 1);
});
check('clear confirmation scope and legacy behavior stay compatible', () => {
  const e = env({ configured: false }); seedArchive(e, start, 'group:a'); seedArchive(e, start, 'group:b');
  assert.equal(e.c.getCleanupCommandInfo_('#清空封存').isConfirm, false);
  assert.equal(e.c.getCleanupCommandInfo_('#清空封存 確認').isConfirm, true);
  assert.equal(e.c.performDataCleanup_('weekly_summary', 'group:a').total, 1);
  assert.equal(e.props.size, 0); assert.equal(e.sheets.get('WeeklySummary').records()[0].ConversationId, 'group:b');
});
check('a reply transmission failure after commit never resets completion or duplicates an archive', () => {
  const e = env(); news(e);
  e.c.logMessageToSheet = () => {}; e.c.logAssistantReplyToSheet = () => {}; e.c.deliverPendingReply_ = () => null;
  const input = { ...event, type: 'message', timestamp: e.now(), replyToken: 'test-reply',
    message: { type: 'text', id: '100', text: '#封存本週新聞' } };
  const fetch = e.c.UrlFetchApp.fetch;
  e.c.UrlFetchApp.fetch = () => { throw Error('PRIVATE_LINE_FAILURE'); };
  assert.throws(() => e.c.handleLineEvent(input, e.now()), /LINE Reply API request failed/);
  assert.equal(e.state().nextStartAt, end); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
  e.c.UrlFetchApp.fetch = fetch;
  e.c.handleLineEvent(input, e.now());
  const sent = JSON.parse(e.fetches.at(-1).options.payload);
  assert(sent.messages[0].text.includes('不重複封存')); assert.equal(e.models.length, 1);
  assert(!e.logs.join('').includes('PRIVATE_LINE_FAILURE'));
});
check('all summary consumers display exact new intervals and preserve legacy date-only rows', () => {
  const e = env(); news(e); e.run();
  e.c.appendWeeklySummaryRow_({ conversationId: 'group:a', summary: '舊話題', periodStart: '2026-09-01', periodEnd: '2026-09-08' });
  const text = e.c.getRecentWeeklySummaryText('group:a', 8, undefined, true);
  assert(text.includes('2026-10-07 12:00（含）')); assert(text.includes('2026-10-14 12:00（不含，台灣時間）'));
  assert(text.includes('2026-09-01 ～ 2026-09-08'));
  const tool = e.c.getRecentWeeklySummaryText('group:a', 8, 'news', true);
  assert(tool.includes('新聞封存')); assert(!tool.includes('舊話題'));
  const sheet = e.sheets.get('WeeklySummary');
  sheet.data[1][sheet.data[0].indexOf('PeriodStartAt')] = 'corrupt timestamp';
  const fallback = e.c.getRecentWeeklySummaryText('group:a', 8, undefined, true);
  assert(fallback.includes('2026-10-07 ～ 2026-10-14')); assert(fallback.includes('舊話題'));
});
check('actual AiService/provider/parser shares archive validator, deadline and metadata', () => {
  const e = env(); news(e); e.restoreAi();
  const result = e.c.runFixedNewsArchive_(e.config(), 'manual', event,
    { deadlineAtMs: e.now() + 40000, aiTimeoutCapSeconds: 30, aiMinimumRequestSeconds: 8 });
  assert.equal(result.status, 'completed', JSON.stringify({ result, logs: e.logs }));
  assert.equal(e.fetches.length, 1);
  assert(e.fetches[0].options.timeoutSeconds <= 30);
  assert(e.logs.some(line => line.includes('AI_CALL_METADATA')));
});

const topics = [{ title: '群友討論 AI 改變對話習慣', summary: '甲與乙認為過度依賴制式回覆會影響討論方式。', talkingPoint: '哪些場合仍需要自己的說法？', relatedNewsIds: [] }];
const query = { viewMode: 'compact', onlyHighPotential: false, categoryFilter: '', days: 7 };
function editorial(e, count = 23) {
  const items = Array.from({ length: count }, (_, i) => ({
    title: '新聞標題'.repeat(12) + i + (i === count - 1 ? '\n1. 次標題' : ''),
    url: 'https://example.org/' + i + '/'.repeat(130), brief: '素材簡介', category: '科技與 AI',
    topicPotential: '高', createdAt: new e.c.Date(start + i)
  }));
  const ids = items.map((_, i) => 'N' + String(i + 1).padStart(3, '0'));
  e.sheets.get('ConversationLog').appendRow([new Date(end - 3).toISOString(), 'group:a', 'user', 'input', 'alice', '我們可以聊 AI 怎麼改變對話習慣。', '100']);
  e.sheets.get('ConversationLog').appendRow([new Date(end - 2).toISOString(), 'group:b', 'user', 'input', 'bob', 'PRIVATE_OTHER_ROOM', '101']);
  e.sheets.get('ConversationLog').appendRow([new Date(end - 1).toISOString(), 'group:a', 'derived', 'image_semantic', '', 'PRIVATE_DERIVED_IMAGE', '']);
  e.setAi(() => ({ ok: true, json: { newsClusters: [], ungroupedNewsIds: ids, conversationTopics: topics } }));
  return { items, ids };
}
check('real conversation reader and long multi-bubble render retain topics, every news and URLs', () => {
  const e = env(), { items } = editorial(e);
  const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  assert(text.includes(topics[0].title)); assert(text.includes('本週群組話題'));
  for (const item of items) assert.equal(text.split(item.url).length - 1, 1);
  assert(!text.includes('未顯示'));
  const split = e.c.splitTextForLineMessagesWithMeta_(text);
  assert(split.messages.length > 1); assert(!split.wasTruncated);
  assert(split.messages.every(message => message.length <= 4900));
  const prompt = e.models[0][1];
  assert(prompt.includes('我們可以聊')); assert(!prompt.includes('PRIVATE_OTHER_ROOM')); assert(!prompt.includes('PRIVATE_DERIVED_IMAGE'));
  assert.equal(e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query), text); assert.equal(e.models.length, 1);
  assert(e.logs.some(line => line.includes('"cacheHit":true') && line.includes('"topicCount":1')));
});
check('oversized news is omitted with notice while a valid conversation topic survives', () => {
  const e = env(), { items, ids } = editorial(e, 2);
  items[0].url += 'x'.repeat(5000);
  const identified = e.c.assignWeeklyEditorialItemIds_(items);
  const text = e.c.formatWeeklyEditorialDigest_(identified,
    { newsClusters: [], otherItemIds: ids, conversationTopics: topics }, query);
  assert(text.includes(topics[0].title)); assert(text.includes('尚有 1 則未顯示'));
  assert(text.includes(items[1].url)); assert(!text.includes('x'.repeat(5000)));
});
check('conversation read failure explicitly reports incomplete topics and does not leak exceptions', () => {
  const e = env(), { items } = editorial(e, 1); e.sheets.get('ConversationLog').failRead = true;
  const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  assert(text.includes('對話紀錄讀取失敗')); assert(!text.includes(topics[0].title)); assert(text.includes(items[0].url));
  assert(!e.logs.join('').includes('PRIVATE_SHEET_FAILURE'));
  assert(e.logs.some(line => line.includes('"conversationRead":"failed"')));
});
check('missing ConversationLog is a read failure, never a silently created empty sheet', () => {
  const e = env(), { items } = editorial(e, 1); e.sheets.delete('ConversationLog');
  const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  assert(text.includes('對話紀錄讀取失敗')); assert(!e.sheets.has('ConversationLog'));
});
check('an empty ConversationLog with missing headers also reports a read failure', () => {
  const e = env(), { items } = editorial(e, 1);
  e.sheets.set('ConversationLog', new Sheet(['Timestamp', 'ConversationId']));
  assert(e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query).includes('對話紀錄讀取失敗'));
});
check('AI or validation failure shows safe cause and keeps classification news fallback', () => {
  for (const invalid of [false, true]) {
    const e = env(), { items } = editorial(e, 1);
    e.setAi(() => invalid ? { ok: true, json: { broken: true } }
      : { ok: false, errorType: 'ai_timeout', errorReason: 'api_no_response', retryable: true, errorMessage: 'PRIVATE_PROVIDER_FAILURE' });
    const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
    assert(text.includes('週編輯台整理未完成')); assert(text.includes('群組話題尚未完成')); assert(text.includes(items[0].url));
    assert(!text.includes('PRIVATE_')); assert(!e.logs.join('').includes('PRIVATE_'));
    assert.equal(e.models.length, 1);
  }
});
check('successful empty topics distinguish available conversation from no eligible input', () => {
  for (const hasConversation of [false, true]) {
    const e = env(), { items, ids } = editorial(e, 1);
    if (!hasConversation) e.sheets.get('ConversationLog').data.splice(1);
    e.setAi(() => ({ ok: true, json: { newsClusters: [], ungroupedNewsIds: ids, conversationTopics: [] } }));
    const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
    assert(text.includes(hasConversation ? '已讀取可用對話' : '沒有符合整理條件的對話'));
    assert(!text.includes('整理未完成')); assert.equal(e.models.length, 1);
  }
});
check('diagnostics contain counts and safe codes, never raw scope, dialogue, URL or prompts', () => {
  const e = env(), { items } = editorial(e, 1);
  e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  const diagnostic = JSON.parse(e.logs.find(line => line.startsWith('WEEKLY_EDITORIAL_STATUS ')).slice('WEEKLY_EDITORIAL_STATUS '.length));
  assert.equal(diagnostic.rawConversationCount, 1); assert.equal(diagnostic.keptConversationCount, 1);
  assert.equal(diagnostic.topicCount, 1); assert.equal(diagnostic.stage, 'done');
  for (const word of ['我們可以聊', 'example.org', 'group:a', 'alice']) assert(!JSON.stringify(diagnostic).includes(word));
});

for (const hasExisting of [false, true]) for (const origin of ['manual', 'auto']) for (const writerFirst of [false, true]) {
  check('cutoff serialization ' + JSON.stringify({ hasExisting, origin, writerFirst }), () => {
    const e = env({ clock: writerFirst ? end - 1 : end }), sheet = e.sheets.get('NewsInbox');
    if (hasExisting) news(e);
    const item = { conversationId: 'group:a', title: '截止交錯新聞', url: 'https://example.org/cutoff', brief: '摘要' };
    e.setFlush(() => assert(e.held(), 'writes flush before releasing the data lock'));
    if (writerFirst) {
      const append = e.c.appendRowByHeaders_;
      e.c.appendRowByHeaders_ = (target, values) => {
        if (target === sheet) {
          assert(e.held()); assert.equal(values.CreatedAt.getTime(), end - 1);
          e.setNow(end);
          assert.equal(e.run(origin).status, 'busy', 'snapshot cannot overtake unflushed writer');
          assert.equal(e.state().nextStartAt, start);
        }
        return append(target, values);
      };
      e.c.appendNewsInboxRow_(item);
      assert.equal(e.run(origin).count, hasExisting ? 2 : 1);
      assert.equal(e.run().status, 'up_to_date');
      e.setNow(end + week); assert.equal(e.run(origin).status, 'empty');
      assert.equal(e.models.length, 1);
    } else {
      const snapshot = e.c.getNewsArchivePeriodItems_;
      e.c.getNewsArchivePeriodItems_ = (...args) => {
        assert(e.held());
        assert.throws(() => e.c.appendNewsInboxRow_(item), error => error.errorReason === 'local_time_budget');
        return snapshot(...args);
      };
      assert.equal(e.run(origin).status, hasExisting ? 'completed' : 'empty');
      e.c.getNewsArchivePeriodItems_ = snapshot;
      e.c.appendNewsInboxRow_(item);
      assert.equal(sheet.records().at(-1).CreatedAt.getTime(), end, 'retry timestamps only after acquiring lock');
      assert.equal(e.run().status, 'up_to_date');
      e.setNow(end + week); assert.equal(e.run(origin).count, 1);
      assert.equal(e.models.length, hasExisting ? 2 : 1);
    }
    const summaries = e.sheets.get('WeeklySummary').records();
    assert.equal(summaries.reduce((sum, row) => sum + row.SourceItemCount, 0), hasExisting ? 2 : 1);
    assert.equal(new Set(summaries.map(row => row.ArchiveKey)).size, summaries.length);
    assert(!e.held());
  });
}
check('busy news insertion throws, sync queues, background stays incomplete, manual never claims saved', () => {
  const e = env(), analysis = { title: '新聞標題', outline: '完整新聞', brief: '新聞簡介', category: '科技與 AI',
    angle: '節目切角', topicPotential: '高', specialTopic: '無', categoryConfidence: 90, storyKey: '新聞事件' };
  e.c.fetchAndExtractWebPageByReaderLayer_ = () => ({ ok: true, mainText: '新聞正文', readerRoute: 'jina_reader' });
  e.c.analyzeNewsUrlWithAi_ = () => analysis;
  e.c.isWeakAutoNewsClassification_ = () => false;
  const fallback = [];
  e.c.enqueueDirectNewsUrlsForBackground_ = (...args) => { fallback.push(args); return { ok: true, queued: true }; };
  e.setBusy(true);
  assert.throws(() => e.c.appendNewsInboxRow_({ conversationId: 'group:a' }));
  assert.equal(e.c.handleDirectNewsUrlMessage_(event, 'group:a', 'https://example.org/news').queued, true);
  assert.equal(fallback.length, 1); assert.equal(fallback[0][4], 'news_inbox_write_error');
  e.c.parseManualNewsSupplement_ = () => analysis;
  assert.throws(() => e.c.handleManualNewsSupplement_(event, 'group:a', 'https://example.org/news 新聞補件'));
  const queue = e.c.ensureNewsUrlQueueSheet_();
  e.c.appendRowByHeaders_(queue, { TaskId: 'task1', ConversationId: 'group:a', Status: 'processing', RetryCount: 0 });
  assert.equal(e.c.processSingleNewsUrlTask_({ taskId: 'task1', conversationId: 'group:a', startedAtMs: e.now(),
    url: 'https://example.org/news', retryCount: 0 }).status, 'busy');
  assert.equal(queue.records()[0].Status, 'processing'); assert.equal(queue.records()[0].RetryCount, 0);
  assert.equal(e.sheets.get('NewsInbox').records().length, 0);
});
check('all cleanup scopes hold one outer lock through row snapshot, deletion and flush', () => {
  for (const key of ['conversation_log', 'topic_highlights', 'web_data', 'weekly_summary', 'news_data', 'pending_replies']) {
    const e = env();
    const names = { conversation_log: ['ConversationLog'], topic_highlights: ['TopicHighlights'],
      web_data: ['WebSummary', 'WebTaskQueue'], weekly_summary: ['WeeklySummary'],
      news_data: ['NewsInbox', 'NewsUrlQueue'], pending_replies: ['PendingReplies'] }[key];
    for (const name of names) {
      const sheet = new Sheet(['ConversationId'], ['group:b', 'group:a', 'group:c', 'group:a', 'group:d'].map(scope => [scope]));
      e.sheets.set(name, sheet);
      const range = sheet.getRange.bind(sheet), remove = sheet.deleteRow.bind(sheet);
      let interleaved = false;
      sheet.getRange = (...args) => {
        const result = range(...args), read = result.getValues;
        result.getValues = () => {
          const values = read();
          if (args[0] === 2 && !interleaved) {
            interleaved = true; assert(e.held());
            assert.throws(() => e.c.performDataCleanup_(key, 'group:b'), error => error.errorReason === 'local_time_budget');
          }
          return values;
        };
        return result;
      };
      sheet.deleteRow = row => { assert(e.held()); remove(row); };
    }
    e.setFlush(() => assert(e.held()));
    assert.equal(e.c.performDataCleanup_(key, 'group:a').total, 2 * names.length);
    for (const name of names) assert.deepEqual(e.sheets.get(name).records().map(row => row.ConversationId), ['group:b', 'group:c', 'group:d']);
    assert.equal(e.c.performDataCleanup_(key, 'group:b').total, names.length);
    for (const name of names) assert.deepEqual(e.sheets.get(name).records().map(row => row.ConversationId), ['group:c', 'group:d']);
    assert(!e.held());
  }
});
check('legacy public deletion entrypoints serialize and preserve other rooms', () => {
  const e = env({ configured: false }), sheet = new Sheet(['ConversationId'], [['group:a'], ['group:b'], ['group:a']]);
  e.c.ensureLogSheet_ = () => sheet;
  e.setBusy(true);
  assert.throws(() => e.c.deleteConversationLogs('group:a'));
  assert.throws(() => e.c.deleteRowsByConversationIdFromSheet_(sheet, 'group:a'));
  assert.equal(sheet.records().length, 3);
  e.setBusy(false); e.setFlush(() => assert(e.held()));
  assert.equal(e.c.deleteConversationLogs('group:a'), 2);
  assert.deepEqual(sheet.records(), [{ ConversationId: 'group:b' }]);
});
check('busy cleanup router retains confirmation and returns incomplete without a success message', () => {
  const e = env(); e.setBusy(true);
  e.c.handleLineEvent({ ...event, type: 'message', replyToken: 'reply',
    message: { type: 'text', id: '1', text: '#清空封存 確認' } }, e.now());
  const reply = JSON.parse(e.fetches.at(-1).options.payload).messages[0].text;
  assert(reply.includes('清理未完成')); assert(!reply.includes('已清除'));
  assert.equal(e.sheets.get('WeeklySummary').records().length, 0); assert.equal(e.models.length, 0);
  assert(!e.props.has(e.stateKey()), 'busy cleanup never cancels or advances the archive');
});
check('pending delivery and cleanup share the same lock, flush before release and consume only after LINE success', () => {
  for (const succeeds of [false, true]) {
    const e = env({ configured: false }), sheet = e.c.ensurePendingRepliesSheet_();
    ['group:b', 'group:a', 'group:c', 'group:a', 'group:d'].forEach((scope, index) => {
      e.c.appendRowByHeaders_(sheet, { PendingId: 'p' + index, ConversationId: scope, Status: 'pending', ReplyText: '待回覆' });
    });
    e.c.replyToLine = () => {
      assert(e.held());
      assert.throws(() => e.c.performDataCleanup_('pending_replies', 'group:b'));
      if (!succeeds) throw Error('PRIVATE_LINE_FAILURE');
    };
    let flushes = 0; e.setFlush(() => { assert(e.held()); flushes++; });
    if (succeeds) {
      assert(e.c.deliverPendingReply_('group:a', 'reply'));
      assert.equal(sheet.records().filter(row => row.ConversationId === 'group:a').length, 1);
      assert.equal(flushes, 1);
    } else {
      assert.throws(() => e.c.deliverPendingReply_('group:a', 'reply'), /PRIVATE_LINE_FAILURE/);
      assert.equal(sheet.records().filter(row => row.ConversationId === 'group:a').length, 2);
      assert.equal(flushes, 0);
    }
    assert(!e.held());
    assert.equal(e.c.performDataCleanup_('pending_replies', 'group:b').total, 1);
    assert.equal(sheet.records().filter(row => ['group:c', 'group:d'].includes(row.ConversationId)).length, 2);
  }
});
check('fatal and capped states survive repeated preflight read errors yet recover an existing row', () => {
  for (const capped of [false, true]) {
    const e = env(); news(e);
    e.setAi(() => ({ ok: false, errorType: capped ? 'ai_rate_limit' : 'ai_auth_error', retryable: capped }));
    if (capped) for (let n = 0; n < 2; n++) { e.run('auto'); e.setNow(e.now() + 86400000); }
    assert.equal(e.run('auto').status, 'failed');
    const before = JSON.stringify(e.state()), calls = e.models.length;
    e.sheets.get('WeeklySummary').failRead = true;
    for (let n = 0; n < 2; n++) {
      e.setNow(e.now() + 86400000); assert.equal(e.run('auto').status, 'needs_attention');
      assert.equal(JSON.stringify(e.state()), before);
    }
    e.sheets.get('WeeklySummary').failRead = false; e.setAi(null);
    assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, calls);
    seedArchive(e);
    assert.equal(e.run('auto').status, 'already_done'); assert.equal(e.models.length, calls);
    assert.equal(e.state().nextStartAt, end); assert.equal(e.state().autoAttempts, 0);
  }
});
check('commit waits for ordinary chat contention within the original deadline and reuses one AI result', () => {
  for (const origin of ['manual', 'auto']) {
    const e = env(); news(e); const began = e.now(), deadline = began + 40000;
    e.setAi(() => { e.setNow(began + 5000); e.setBusyUntil(e.now() + 20000); return { ok: true, json: archive }; });
    assert.equal(e.run(origin, { deadlineAtMs: deadline, aiTimeoutCapSeconds: 30, aiMinimumRequestSeconds: 8 }).status, 'completed');
    assert.equal(e.now(), began + 25000); assert(e.now() < deadline);
    assert.equal(e.models.length, 1); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
    assert.equal(e.state().runId, ''); assert(!e.logs.join('').includes('RECEIPT_CLEANUP_FAILED'));
  }
});
check('exhausted commit lock budget records retryable failure instead of a phantom processing lease', () => {
  for (const origin of ['manual', 'auto']) {
    const e = env(); news(e); const deadline = e.now() + 40000;
    e.setAi(() => { e.setNow(deadline - 1500); e.setBusy(true); return { ok: true, json: archive }; });
    const result = e.run(origin, { deadlineAtMs: deadline, aiTimeoutCapSeconds: 30, aiMinimumRequestSeconds: 8 });
    assert.equal(result.status, 'failed'); assert.equal(result.failure.errorReason, 'local_time_budget');
    assert.equal(e.now(), deadline); assert.equal(e.models.length, 1);
    assert.equal(e.sheets.get('WeeklySummary').records().length, 0);
    const raw = JSON.parse(e.props.get(e.stateKey()));
    assert(raw.runId, 'do not overwrite shared progress without the global lock');
    const receipt = [...e.props].filter(([key]) => key.includes('_FAILURE_'));
    assert.equal(receipt.length, 1); assert.deepEqual(JSON.parse(receipt[0][1]), { errorCode: 'local_time_budget', retryable: true });
    assert.equal(e.state().runId, ''); assert.equal(e.state().leaseUntil, 0);
    const status = e.c.getNewsArchiveStatusText_('group:a');
    assert(status.includes('LOCAL_TIME_BUDGET')); assert(!status.includes('正在處理'));
    e.setBusy(false);
    if (origin === 'auto') {
      assert.equal(e.run('auto').status, 'waiting');
      assert.equal(JSON.parse(e.props.get(e.stateKey())).runId, '');
      e.setNow(e.now() + 86400000);
    }
    e.setAi(null); assert.equal(e.run(origin).status, 'completed');
    assert.equal(e.models.length, 2); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
    assert.equal([...e.props.keys()].filter(key => key.includes('_FAILURE_')).length, 0);
  }
});
check('failure receipts are token scoped, cleaned on progress, and cannot unblock fatal or corrupt state', () => {
  const e = env(); news(e);
  const state = { ...e.state(), runId: 'active', leaseUntil: e.now() + 300000 };
  e.props.set(e.stateKey(), JSON.stringify(state));
  e.props.set(e.stateKey() + '_FAILURE_old', JSON.stringify({ errorCode: 'local_time_budget', retryable: true }));
  assert.equal(e.run().status, 'processing'); assert.equal(e.state().runId, 'active');
  e.props.set(e.stateKey() + '_FAILURE_active', '{"errorCode":"PRIVATE_UNKNOWN","retryable":true}');
  assert.equal(e.run().status, 'failed'); assert.equal(e.models.length, 0);
  assert(!e.logs.join('').includes('PRIVATE_UNKNOWN'));
  e.props.set(e.stateKey() + '_FAILURE_active', '{"errorCode":"ai_auth_error","retryable":false}');
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.state().retryable, false);
  assert.equal(e.models.length, 0);
  assert.equal(e.run().status, 'completed'); assert.equal(e.state().nextStartAt, end);
  assert.equal([...e.props.keys()].filter(key => key.includes('_FAILURE_')).length, 0);
});
check('preview counts only remaining periods after completion, empty and clear, without writes', () => {
  for (const outcome of ['fresh', 'completed', 'empty', 'cleared']) {
    const e = env({ clock: end + week });
    if (outcome === 'completed') { news(e); e.run(); }
    if (outcome === 'empty') e.run();
    if (outcome === 'cleared') e.c.performDataCleanup_('weekly_summary', 'group:a');
    const before = JSON.stringify([...e.props]), sheets = JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data]));
    const due = e.c.previewNewsArchiveSetup()[0].duePeriods, expected = outcome === 'fresh' ? 2 : outcome === 'cleared' ? 0 : 1;
    assert.equal(due, expected); assert(e.c.getNewsArchiveStatusText_('group:a').includes('待處理週期：' + expected));
    assert.equal(JSON.stringify([...e.props]), before);
    assert.equal(JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data])), sheets);
  }
});
check('unknown news IDs never leak model text, dialogue, URL or arbitrary label to logs', () => {
  const e = env(), marker = 'PRIVATE_DIALOGUE https://private.example/secret';
  const ids = e.c.normalizeWeeklyEditorialIdArray_([marker, 'N001', 'N001', '', null, '__proto__', 'constructor', 'toString'], { N001: true }, marker);
  assert.deepEqual(Array.from(ids), ['N001']);
  assert(e.logs.some(line => line.startsWith('WEEKLY_EDITORIAL_UNKNOWN_ID index=')));
  assert(!e.logs.join('').includes('PRIVATE_')); assert(!e.logs.join('').includes('https://'));
});
check('all rejected, partial and valid-empty topics keep distinct diagnostics and cache hits', () => {
  for (const kind of ['all_rejected', 'partial', 'valid_empty', 'no_input']) {
    const e = env(), { items, ids } = editorial(e, 1), invalid = { ...topics[0], title: '   ' };
    const returned = kind === 'valid_empty' ? [] : kind === 'partial' ? [invalid, topics[0]] : [invalid];
    if (kind === 'no_input') e.sheets.get('ConversationLog').data.splice(1);
    e.setAi(() => ({ ok: true, json: { newsClusters: [], ungroupedNewsIds: ids, conversationTopics: returned } }));
    const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
    assert.equal(e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query), text); assert.equal(e.models.length, 1);
    assert(text.includes(items[0].url)); assert(!text.includes('週編輯台整理未完成'));
    if (kind === 'all_rejected') { assert(text.includes('話題未通過檢查')); assert(!text.includes('沒有可提煉')); }
    if (kind === 'partial') { assert(text.includes('部分話題未通過檢查')); assert(text.includes(topics[0].title)); }
    if (kind === 'valid_empty') assert(text.includes('沒有可提煉的主題'));
    if (kind === 'no_input') { assert(text.includes('沒有符合整理條件的對話')); assert(!text.includes('話題未通過')); }
    const diagnostics = e.logs.filter(line => line.startsWith('WEEKLY_EDITORIAL_STATUS ')).map(line => JSON.parse(line.slice(24)));
    assert.equal(diagnostics.length, 2);
    for (const data of diagnostics) {
      assert.equal(data.topicValidation, kind);
      assert.equal(data.returnedTopicCount, returned.length);
      assert.equal(data.topicCount, kind === 'partial' ? 1 : 0);
      assert.equal(data.rejectedTopicCount, kind === 'valid_empty' ? 0 : 1);
      assert.equal(data.stage, 'done'); assert.equal(data.errorCode, '');
    }
    assert.equal(diagnostics[1].cacheHit, true);
    assert([...e.cache.keys()].some(key => key.startsWith('weekly_editorial:v1.17.0:')));
  }
});
check('corrupt topic count cache is discarded and regenerated without storing rejected raw content', () => {
  const e = env(), { items, ids } = editorial(e, 1);
  e.setAi(() => ({ ok: true, json: { newsClusters: [], ungroupedNewsIds: ids,
    conversationTopics: [{ ...topics[0], title: 'https://private.example/PRIVATE_REJECTED' }] } }));
  e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  const key = [...e.cache.keys()][0], valid = JSON.parse(e.cache.get(key));
  assert(!e.cache.get(key).includes('PRIVATE_REJECTED'));
  for (const topicCounts of [{ returned: -1, adopted: 0, rejected: -1 }, { returned: 1, adopted: 1, rejected: 0 },
    { returned: 2, adopted: 0, rejected: 1 }, { returned: 1e20, adopted: 0, rejected: 1e20 }]) {
    e.cache.set(key, JSON.stringify({ ...valid, topicCounts }));
    const count = e.models.length; e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
    assert.equal(e.models.length, count + 1);
  }
  assert(!e.logs.join('').includes('PRIVATE_REJECTED'));
});
check('actual AI service preserves rejected topic cause and removes unknown ID text from output and logs', () => {
  const e = env(), { items, ids } = editorial(e, 1); e.restoreAi();
  const marker = 'PRIVATE_ID_DIALOGUE https://private.example/url';
  e.c.UrlFetchApp.fetch = (url, options) => {
    e.fetches.push({ url, options });
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({
      object: 'response', status: 'completed', output: [{ type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify({ newsClusters: [], ungroupedNewsIds: [...ids, marker],
          conversationTopics: [{ ...topics[0], title: '   ' }] }) }] }],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
    }) };
  };
  const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  assert(text.includes('話題未通過檢查')); assert(text.includes(items[0].url));
  assert.equal(e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query), text); assert.equal(e.fetches.length, 1);
  assert(!e.logs.join('').includes('PRIVATE_ID_DIALOGUE')); assert(!text.includes(marker));
});
check('short complete paragraph fits three topics and one huge news block in two LINE bubbles', () => {
  for (const [titleLength, urlLength] of [[1900, 2000], [100, 1000], [100, 2000]]) {
    const e = env(), topic = { title: '題'.repeat(60), summary: '述'.repeat(160), talkingPoint: '點'.repeat(100), relatedNewsIds: [] };
    const prefix = 'https://example.org/', item = { title: '新'.repeat(titleLength),
      url: prefix + 'u'.repeat(urlLength - prefix.length), category: '科技與 AI', topicPotential: '高' };
    const text = e.c.formatWeeklyEditorialDigest_(e.c.assignWeeklyEditorialItemIds_([item]),
      { newsClusters: [], otherItemIds: ['N001'], conversationTopics: [topic, topic, topic] }, query);
    assert(!text.includes('未顯示')); assert.equal(text.split(item.url).length - 1, 1);
    const split = e.c.splitTextForLineMessagesWithMeta_(text);
    assert(!split.wasTruncated); assert(split.messages.every(message => message.length <= 4900));
    assert.equal(split.messages.filter(message => message.includes(item.url)).length, 1);
    if (titleLength === 1900) { assert.equal(split.messages.length, 2); assert(split.messages[0].length < 1200); }
  }
});

check('deployment guides keep auto off through setup, update Web App, verify manual entry, then enable triggers', () => {
  for (const name of ['CURRENT_VERSION.md', 'README.md']) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    const start = name === 'CURRENT_VERSION.md' ? text.indexOf('### 上傳 GAS 後的手動啟用順序') : text.indexOf('## Setup、部署與維護');
    const section = text.slice(start);
    const setup = section.indexOf('setupNewsArchiveStorage()'), deploy = section.indexOf('**先更新 Web App deployment**'),
      manual = section.indexOf('**再驗證新版手動入口**'), enable = section.indexOf('**最後啟用自動封存**'),
      install = section.indexOf('installNewsArchiveTrigger()');
    assert(start >= 0 && setup > 0 && deploy > setup && manual > deploy && enable > manual && install > enable, name);
    assert(section.slice(0, deploy).includes('autoEnabled=false'));
    assert(section.slice(deploy, enable).includes('#版本'));
  }
});

function queueWork(e, kind, { id = 'task-a', scope = 'group:a', status = 'processing', retryCount = 0, urls = ['https://example.org/queue'] } = {}) {
  const isNews = kind === 'news', sheet = isNews ? e.c.ensureNewsUrlQueueSheet_() : e.c.ensureWebTaskQueueSheet_();
  const task = { taskId: id, conversationId: scope, startedAtMs: e.now(), retryCount,
    sourceType: scope.split(':')[0], userId: 'alice', groupId: scope.startsWith('group:') ? scope.slice(6) : '',
    roomId: scope.startsWith('room:') ? scope.slice(5) : '', url: urls[0], urls: urls.join('\n'),
    userPrompt: urls.join('\n'), taskType: kind === 'program' ? 'program_topic_analysis' : 'web_lazy_summary' };
  e.c.appendRowByHeaders_(sheet, { TaskId: id, ConversationId: scope, Status: status,
    StartedAt: status === 'processing' ? new e.c.Date(task.startedAtMs) : '', RetryCount: retryCount,
    SourceType: task.sourceType, UserId: task.userId, GroupId: task.groupId, RoomId: task.roomId,
    Url: task.url, Urls: task.urls, UserPrompt: task.userPrompt, TaskType: task.taskType });
  return { task, sheet, name: isNews ? 'NewsUrlQueue' : 'WebTaskQueue',
    cleanup: () => e.c.performDataCleanup_(isNews ? 'news_data' : 'web_data', scope),
    run: () => isNews ? e.c.processSingleNewsUrlTask_(task) : e.c.processSingleWebTask_(task),
    schedule: () => isNews ? e.c.processNewsUrlQueue() : e.c.processWebTaskQueue() };
}
function queueServices(e, { outcome = 'success', onRead = () => {}, onAi = () => {} } = {}) {
  const calls = { readers: 0, ai: 0 };
  e.c.fetchAndExtractWebPageByReaderLayer_ = url => {
    assert(!e.held()); calls.readers++; onRead(url);
    if (outcome === 'retry' || outcome === 'failed') return { ok: false, errorType: 'reader_error',
      error: 'PRIVATE_READER_BODY', httpStatus: outcome === 'retry' ? 503 : 404, retryable: outcome === 'retry' };
    return { ok: true, url, title: '測試新聞', mainText: '測試新聞正文', contentType: 'article', readerRoute: 'jina_reader' };
  };
  const infer = () => {
    assert(!e.held()); calls.ai++; onAi();
    if (outcome === 'ai_failed') throw Object.assign(Error('PRIVATE_AI_BODY'), { errorType: 'ai_timeout', retryable: true });
  };
  e.c.analyzeNewsUrlWithAi_ = () => {
    infer(); return { title: 'Queue 新聞', brief: '素材簡介', outline: '完整正文', category: '科技與 AI',
      angle: '節目切角', topicPotential: '高', storyKey: 'Queue 新聞事件', categoryConfidence: 0.9 };
  };
  e.c.runWebLazySummaryAi_ = () => {
    infer(); return { title: '快讀標題', summary: '快讀摘要', keyPoints: ['重點'], warnings: [],
      contentTypeLabel: '新聞資訊', topicPotential: '高', extractionConfidence: 0.9 };
  };
  e.c.runAiMemoryTask = () => { infer(); return { ok: true, text: '節目分析結果' }; };
  return calls;
}
function scopeRows(e, name, scope = 'group:a') {
  return e.sheets.get(name)?.records().filter(row => row.ConversationId === scope) || [];
}

for (const kind of ['news', 'web', 'program']) {
  check(kind + ' relocates a surviving task after preceding rows are deleted', () => {
    const e = env(), preceding = queueWork(e, kind, { id: 'task-other', scope: 'group:b' });
    const work = queueWork(e, kind);
    let shifted = false;
    const calls = queueServices(e, { onAi: () => {
      if (!shifted) { shifted = true; preceding.cleanup(); }
    } });
    assert.equal(work.run().status, 'committed');
    assert.equal(work.sheet.records().length, 1); assert.equal(work.sheet.records()[0].TaskId, 'task-a');
    assert.equal(work.sheet.records()[0].Status, 'done'); assert.equal(calls.ai, 1);
    assert.equal(scopeRows(e, 'PendingReplies').length, kind === 'news' ? 0 : 1);
    assert(!e.held());
  });
  for (const phase of ['reader', 'ai']) check(kind + ' cancellation during ' + phase + ' never recreates deleted data or replies', () => {
    const e = env(), work = queueWork(e, kind), other = queueWork(e, kind, { id: 'task-b', scope: 'group:b' });
    const beforeOther = JSON.stringify(other.sheet.records()[1]);
    let once = false;
    const cancel = () => { if (!once) { once = true; work.cleanup(); } };
    const calls = queueServices(e, { onRead: phase === 'reader' ? cancel : undefined, onAi: phase === 'ai' ? cancel : undefined });
    assert.equal(work.run().status, 'cancelled');
    assert.equal(JSON.stringify(other.sheet.records()[0]), beforeOther);
    for (const name of ['NewsInbox', 'WebSummary', 'PendingReplies']) assert.equal(scopeRows(e, name).length, 0);
    assert.equal(calls.ai, phase === 'reader' ? 0 : 1); assert(!e.held());
  });
  check(kind + ' missing task before processing skips all Reader and AI work', () => {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e);
    work.cleanup(); assert.equal(work.run().status, 'cancelled');
    assert.deepEqual(calls, { readers: 0, ai: 0 }); assert.equal(scopeRows(e, 'PendingReplies').length, 0);
  });
  check(kind + ' a replacement task at the same row survives the old result', () => {
    const e = env(), old = queueWork(e, kind); let replacement;
    queueServices(e, { onAi: () => {
      old.cleanup(); replacement = queueWork(e, kind, { id: 'new-task' });
    } });
    assert.equal(old.run().status, 'cancelled');
    assert.equal(old.sheet.records()[0].TaskId, 'new-task'); assert.equal(old.sheet.records()[0].Status, 'processing');
    queueServices(e); assert.equal(replacement.run().status, 'committed');
    assert.equal(old.sheet.records()[0].TaskId, 'new-task'); assert.equal(old.sheet.records()[0].Status, 'done');
    const sources = scopeRows(e, kind === 'news' ? 'NewsInbox' : 'WebSummary');
    assert.equal(sources.length, kind === 'program' ? 0 : 1);
  });
}
for (const kind of ['news', 'web', 'program']) check(kind + ' public handler claims with StartedAt, flushes and processes outside the lock', () => {
  const e = env(), work = queueWork(e, kind, { status: 'pending' });
  let snapshots = 0;
  const worker = kind === 'news' ? 'processSingleNewsUrlTask_' : 'processSingleWebTask_', original = e.c[worker];
  e.c[worker] = task => {
    assert(!e.held()); assert(!Object.hasOwn(task, 'sheetRowNumber'));
    assert.equal(task.startedAtMs, e.now());
    assert.equal(work.sheet.records()[0].Status, 'processing');
    snapshots++;
    return original(task);
  };
  const calls = queueServices(e, { onRead: () => work.schedule() });
  e.setFlush(() => assert(e.held()));
  work.schedule();
  assert.equal(snapshots, 1); assert.equal(calls.ai, 1); assert.equal(work.sheet.records()[0].Status, 'done');
});
check('news retry and permanent failure cannot update a different room or create a cancelled notification', () => {
  for (const outcome of ['retry', 'failed', 'ai_failed']) for (const cancel of [false, true]) {
    const e = env(), preceding = queueWork(e, 'news', { id: 'preceding', scope: 'group:b' });
    const work = queueWork(e, 'news');
    queueServices(e, { outcome, onRead: () => cancel ? work.cleanup() : preceding.cleanup(),
      onAi: () => cancel ? work.cleanup() : undefined });
    const result = work.run();
    if (cancel) {
      assert.equal(result.status, 'cancelled'); assert.equal(scopeRows(e, 'PendingReplies').length, 0);
      assert.equal(preceding.sheet.records()[0].TaskId, 'preceding'); assert.equal(preceding.sheet.records()[0].Status, 'processing');
    } else {
      assert.equal(result.status, 'committed');
      assert.equal(work.sheet.records()[0].TaskId, 'task-a');
      assert.equal(work.sheet.records()[0].Status, outcome === 'failed' ? 'failed' : 'pending');
      assert.equal(scopeRows(e, 'PendingReplies').length, outcome === 'failed' ? 1 : 0);
    }
  }
});
check('web and program AI failure revalidates ownership before creating its failure reply', () => {
  for (const kind of ['web', 'program']) for (const cancelled of [false, true]) {
    const e = env(), work = queueWork(e, kind);
    queueServices(e, { outcome: 'ai_failed', onAi: () => { if (cancelled) work.cleanup(); } });
    const result = work.run();
    assert.equal(result.status, cancelled ? 'cancelled' : 'committed');
    assert.equal(scopeRows(e, 'PendingReplies').length, cancelled ? 0 : 1);
    if (!cancelled) assert.equal(work.sheet.records()[0].Status, kind === 'program' ? 'failed' : 'done');
    assert(!e.logs.join('').includes('PRIVATE_AI_BODY'));
  }
});
check('news batch cancellation skips the second claimed task and does not revive either result', () => {
  const e = env(), first = queueWork(e, 'news', { status: 'pending' });
  queueWork(e, 'news', { id: 'second', status: 'pending' });
  const calls = queueServices(e, { onAi: () => first.cleanup() });
  first.schedule(); assert.equal(calls.ai, 1); assert.equal(calls.readers, 1);
  assert.equal(first.sheet.records().length, 0); assert.equal(scopeRows(e, 'NewsInbox').length, 0);
});
check('multi URL web cancellation stops later URLs and saves no partial or late summaries', () => {
  const e = env(), work = queueWork(e, 'web', { urls: ['https://example.org/1', 'https://example.org/2', 'https://example.org/3'] });
  const calls = queueServices(e, { onAi: () => work.cleanup() });
  assert.equal(work.run().status, 'cancelled'); assert.equal(calls.readers, 1); assert.equal(calls.ai, 1);
  assert.equal(scopeRows(e, 'WebSummary').length, 0); assert.equal(scopeRows(e, 'PendingReplies').length, 0);
});
check('multi URL web keeps each success or failure record and the existing combined reply', () => {
  const e = env(), work = queueWork(e, 'web', { urls: ['https://example.org/1', 'https://example.org/2'] });
  const calls = queueServices(e), read = e.c.fetchAndExtractWebPageByReaderLayer_;
  e.c.fetchAndExtractWebPageByReaderLayer_ = url => url.endsWith('/2')
    ? { ok: false, errorType: 'reader_error', httpStatus: 404 } : read(url);
  assert.equal(work.run().status, 'committed'); assert.equal(calls.ai, 1);
  assert.deepEqual(scopeRows(e, 'WebSummary').map(row => row.Status), ['ok', 'failed']);
  assert.equal(scopeRows(e, 'PendingReplies').length, 1); assert.equal(work.sheet.records()[0].Status, 'done');
});
check('queue identity guards reject missing, duplicate, changed room, state or claim time without fallback rows', () => {
  for (const kind of ['news', 'web']) for (const invalid of ['blank', 'duplicate', 'scope', 'status', 'started', 'missing-start']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e), headers = work.sheet.data[0];
    if (invalid === 'blank') work.task.taskId = '';
    if (invalid === 'duplicate') queueWork(e, kind, { scope: 'group:b' });
    if (invalid === 'scope') work.sheet.data[1][headers.indexOf('ConversationId')] = 'group:b';
    if (invalid === 'status') work.sheet.data[1][headers.indexOf('Status')] = 'done';
    if (invalid === 'started') work.sheet.data[1][headers.indexOf('StartedAt')] = new e.c.Date(e.now() + 1);
    if (invalid === 'missing-start') delete work.task.startedAtMs;
    const before = JSON.stringify(work.sheet.data);
    assert(['failed', 'cancelled'].includes(work.run().status)); assert.deepEqual(calls, { readers: 0, ai: 0 });
    assert.equal(JSON.stringify(work.sheet.data), before); assert.equal(scopeRows(e, 'PendingReplies').length, 0);
  }
});
check('claim skips blank and duplicate task IDs and never dispatches an ambiguous task', () => {
  for (const kind of ['news', 'web']) {
    const e = env(), work = queueWork(e, kind, { id: '', status: 'pending' });
    queueWork(e, kind, { id: 'duplicate', status: 'pending' });
    queueWork(e, kind, { id: 'duplicate', scope: 'group:b', status: 'pending' });
    const calls = queueServices(e); work.schedule();
    assert.deepEqual(calls, { readers: 0, ai: 0 });
    assert(work.sheet.records().every(row => row.Status === 'pending')); assert(!e.held());
  }
});
check('queue read, schema and retrieval failure stays distinct from cancellation and never creates a missing queue', () => {
  for (const kind of ['news', 'web']) for (const failure of ['read', 'missing-sheet', 'missing-header', 'duplicate-header', 'retrieve']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e);
    if (failure === 'read') work.sheet.failRead = true;
    if (failure === 'missing-sheet') e.sheets.delete(work.name);
    if (failure === 'missing-header') work.sheet.data[0][0] = 'NotTaskId';
    if (failure === 'duplicate-header') work.sheet.data[0].push('TaskId');
    if (failure === 'retrieve') e.c.getSpreadsheet_ = () => { throw Error('PRIVATE_SHEET_RETRIEVAL'); };
    assert.equal(work.run().status, 'failed'); assert.deepEqual(calls, { readers: 0, ai: 0 });
    assert(!e.logs.join('').includes('PRIVATE_'));
    if (failure === 'missing-sheet') assert(!e.sheets.has(work.name));
  }
});
check('queue commit rechecks headers and ownership after AI and before any output is written', () => {
  for (const kind of ['news', 'web', 'program']) for (const mutation of ['missing-header', 'read-error', 'changed-start']) {
    const e = env(), work = queueWork(e, kind);
    queueServices(e, { onAi: () => {
      if (mutation === 'missing-header') work.sheet.data[0][work.sheet.data[0].indexOf('FinishedAt')] = 'NotFinishedAt';
      if (mutation === 'read-error') work.sheet.failRead = true;
      if (mutation === 'changed-start') work.sheet.data[1][work.sheet.data[0].indexOf('StartedAt')] = new e.c.Date(e.now() + 1);
    } });
    assert.equal(work.run().status, mutation === 'changed-start' ? 'cancelled' : 'failed');
    for (const name of ['NewsInbox', 'WebSummary', 'PendingReplies']) assert.equal(scopeRows(e, name).length, 0);
  }
});
check('queue commit owns one lock through output writes, terminal status and flush, excluding cleanup', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind); queueServices(e);
    let flushed = false;
    e.setFlush(() => {
      assert(e.held()); assert.throws(work.cleanup);
      if (!flushed) assert.equal(work.sheet.records()[0].Status, 'processing');
      flushed = true;
    });
    assert.equal(work.run().status, 'committed'); assert(flushed); assert(!e.held());
    e.setFlush(null); work.cleanup();
    assert.equal(scopeRows(e, 'NewsInbox').length, 0); assert.equal(scopeRows(e, 'WebSummary').length, 0);
  }
});
check('queue commit waits within a finite budget and uses the same single model result', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind), began = e.now();
    const calls = queueServices(e, { onAi: () => e.setBusyUntil(e.now() + 3000) });
    assert.equal(work.run().status, 'committed'); assert.equal(e.now() - began, 3000);
    assert.equal(calls.ai, 1); assert.equal(work.sheet.records()[0].Status, 'done');
  }
});
check('permanent commit contention leaves unfinished work with a safe diagnostic and no duplicate AI or output', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind), began = e.now();
    const calls = queueServices(e, { onAi: () => e.setBusy(true) });
    assert.equal(work.run().status, 'busy'); assert.equal(e.now() - began, 5000); assert.equal(calls.ai, 1);
    assert.equal(work.sheet.records()[0].Status, 'processing');
    assert(e.logs.some(line => line.startsWith('QUEUE_TASK_STATUS ') && line.includes('local_time_budget')));
    for (const name of ['NewsInbox', 'WebSummary', 'PendingReplies']) assert.equal(scopeRows(e, name).length, 0);
  }
});
check('queue write and flush errors never mark done early, recreate failure notifications or rerun the model', () => {
  for (const kind of ['news', 'web', 'program']) for (const failure of ['output', 'fields', 'flush']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e);
    if (failure === 'output') {
      const factory = kind === 'news' ? 'ensureNewsInboxSheet_' : kind === 'web' ? 'ensureWebSummarySheet_' : 'ensurePendingRepliesSheet_';
      e.c[factory] = () => { throw Error('PRIVATE_OUTPUT_WRITE'); };
    }
    if (failure === 'fields') {
      const original = e.c.setCellByHeader_;
      e.c.setCellByHeader_ = (sheet, row, headers, name, value) => {
        if (name === 'UpdatedAt') throw Error('PRIVATE_FIELD_WRITE');
        return original(sheet, row, headers, name, value);
      };
    }
    if (failure === 'flush') e.setFlush(() => { throw Error('PRIVATE_FLUSH_WRITE'); });
    assert.equal(work.run().status, 'failed'); assert.equal(calls.ai, 1); assert(!e.held());
    assert.equal(work.sheet.records()[0].Status, 'processing');
    assert(scopeRows(e, 'PendingReplies').length <= 1);
    assert(!e.logs.join('').includes('PRIVATE_'));
    if (failure === 'output') assert.equal(scopeRows(e, 'PendingReplies').length, 0);
  }
});
check('a second worker invocation after commit cannot generate duplicate data, pending replies or AI', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e);
    assert.equal(work.run().status, 'committed');
    const snapshot = JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data]));
    assert.equal(work.run().status, 'cancelled'); assert.equal(calls.ai, 1);
    assert.equal(JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data])), snapshot);
  }
});
check('queue claim uses the flushed Sheet timestamp even when storage changes millisecond precision', () => {
  for (const kind of ['news', 'web']) {
    const e = env({ clock: end + 900123 }), work = queueWork(e, kind, { status: 'pending' });
    const setCell = e.c.setCellByHeader_;
    e.c.setCellByHeader_ = (sheet, row, headers, name, value) => {
      const stored = name === 'StartedAt' ? new e.c.Date(Math.round(value.getTime() / 1000) * 1000) : value;
      return setCell(sheet, row, headers, name, stored);
    };
    const calls = queueServices(e); work.schedule();
    assert.equal(calls.ai, 1); assert.equal(work.sheet.records()[0].Status, 'done');
  }
});
check('queue commit refreshes reordered headers instead of reusing stale column positions', () => {
  for (const kind of ['news', 'web']) {
    const e = env(), work = queueWork(e, kind);
    queueServices(e, { onAi: () => { work.sheet.data = work.sheet.data.map(row => row.slice().reverse()); } });
    assert.equal(work.run().status, 'committed'); assert.equal(work.sheet.records()[0].TaskId, 'task-a');
    assert.equal(work.sheet.records()[0].Status, 'done');
  }
});
check('queued news uses its guarded commit timestamp and remains visible to the correct fixed archive period', () => {
  for (const commitAt of [end - 1, end]) {
    const e = env({ clock: end - 2 }), work = queueWork(e, 'news');
    queueServices(e, { onAi: () => e.setNow(commitAt) });
    assert.equal(work.run().status, 'committed');
    assert.equal(scopeRows(e, 'NewsInbox')[0].CreatedAt.getTime(), commitAt);
    e.setNow(end);
    assert.equal(e.run().status, commitAt === end ? 'empty' : 'completed');
    e.setNow(end + week);
    assert.equal(e.run().status, commitAt === end ? 'completed' : 'empty');
    assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
  }
});
check('clearing only PendingReplies leaves active queue work eligible to complete normally', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind);
    queueServices(e, { onAi: () => e.c.performDataCleanup_('pending_replies', 'group:a') });
    assert.equal(work.run().status, 'committed'); assert.equal(work.sheet.records()[0].Status, 'done');
    assert.equal(scopeRows(e, 'PendingReplies').length, kind === 'news' ? 0 : 1);
  }
});
check('cleanup that wins during commit lock wait cancels the result before any persistence', () => {
  for (const kind of ['news', 'web']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e);
    const getLock = e.c.LockService.getScriptLock; let waiting = false;
    e.c.LockService.getScriptLock = () => {
      const lock = getLock(), acquire = lock.tryLock;
      lock.tryLock = waitMs => {
        if (waitMs === 5000 && !waiting) { waiting = true; work.cleanup(); }
        return acquire(waitMs);
      };
      return lock;
    };
    assert.equal(work.run().status, 'cancelled'); assert.equal(calls.ai, 1);
    for (const name of ['NewsInbox', 'WebSummary', 'PendingReplies']) assert.equal(scopeRows(e, name).length, 0);
    assert(!e.held());
  }
});
check('queue diagnostics never contain task identifiers, scope, source URLs or raw model errors', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind, { id: 'PRIVATE_TASK https://private.example/task' });
    queueServices(e, { outcome: 'ai_failed' });
    assert.equal(work.run().status, 'committed');
    assert(!e.logs.join('').includes('PRIVATE_')); assert(!e.logs.join('').includes('group:a'));
    assert(!e.logs.join('').includes('https://'));
  }
});
check('ambiguous final queue flush failure never creates a second reply or regenerates a committed result', () => {
  for (const kind of ['news', 'web', 'program']) {
    const e = env(), work = queueWork(e, kind), calls = queueServices(e); let flushes = 0;
    e.setFlush(() => { if (++flushes === 2) throw Error('PRIVATE_FINAL_FLUSH'); });
    assert.equal(work.run().status, 'failed'); assert.equal(work.sheet.records()[0].Status, 'done');
    e.setFlush(null);
    const persisted = JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data]));
    assert.equal(work.run().status, 'cancelled'); assert.equal(calls.ai, 1);
    assert.equal(JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data])), persisted);
    assert(!e.logs.join('').includes('PRIVATE_FINAL_FLUSH'));
  }
});
check('news treats even a falsy thrown value as failure and never stores an empty successful analysis', () => {
  for (const error of [null, undefined, 0, '']) {
    const e = env(), work = queueWork(e, 'news'); queueServices(e);
    e.c.analyzeNewsUrlWithAi_ = () => { throw error; };
    assert.equal(work.run().status, 'committed');
    assert.notEqual(work.sheet.records()[0].Status, 'done');
    assert.equal(scopeRows(e, 'NewsInbox').length, 0);
  }
});

check('native reservation progress write failure retries tomorrow, even if the failed write landed', () => {
  for (const landed of [false, true]) {
    const e = env(); news(e); let failed = false;
    e.setPropertyFailure((key, raw) => {
      if (!failed && key === e.stateKey() && JSON.parse(raw).runId) {
        failed = true;
        if (landed) e.props.set(key, raw);
        throw Error('PRIVATE_RESERVATION_WRITE');
      }
    });
    const result = e.run('auto');
    assert.equal(result.status, 'failed'); assert.equal(result.failure.retryable, true);
    assert.equal(e.state().retryable, true); assert.equal(e.state().runId, '');
    assert.equal(e.state().nextStartAt, start); assert.equal(e.state().autoAttempts, 1);
    assert.equal(e.run('auto').status, 'waiting'); assert.equal(e.models.length, 0);
    e.setPropertyFailure(null); e.setNow(e.now() + 86400000);
    assert.equal(e.run('auto').status, 'completed'); assert.equal(e.run().status, 'up_to_date');
    assert.equal(e.models.length, 1); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
    assert(!e.logs.join('').includes('PRIVATE_RESERVATION_WRITE')); assert(!e.held());
  }
});
check('reservation storage failures retain the automatic attempt ceiling and manual recovery', () => {
  const e = env(); news(e);
  e.setPropertyFailure((key, raw) => {
    if (key === e.stateKey() && JSON.parse(raw).runId) throw Error('PRIVATE_RESERVATION_WRITE');
  });
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(e.run('auto').status, 'failed');
    assert.equal(e.state().autoAttempts, attempt); assert.equal(e.state().retryable, true);
    assert.equal(e.run('auto').status, attempt === 3 ? 'needs_attention' : 'waiting');
    e.setNow(e.now() + 86400000);
  }
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, 0);
  e.setPropertyFailure(null);
  assert.equal(e.run().status, 'completed'); assert.equal(e.state().autoAttempts, 0);
  assert.equal(e.models.length, 1); assert.equal(e.sheets.get('WeeklySummary').records().length, 1);
});
check('explicit nonretryable progress-write errors and blocked states are never promoted to automatic retry', () => {
  const e = env(); news(e); let failed = false;
  e.setPropertyFailure((key, raw) => {
    if (!failed && key === e.stateKey() && JSON.parse(raw).runId) {
      failed = true; throw e.c.createAiConfigurationError_('PRIVATE_PROGRESS_CONFIGURATION');
    }
  });
  assert.equal(e.run('auto').failure.retryable, false); assert.equal(e.state().retryable, false);
  e.setPropertyFailure(null); e.setNow(e.now() + 86400000);
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.models.length, 0);
  const before = e.props.get(e.stateKey());
  e.setPropertyFailure(() => { throw Error('PRIVATE_BLOCKED_WRITE'); });
  assert.equal(e.run('auto').status, 'needs_attention'); assert.equal(e.props.get(e.stateKey()), before);
  e.setPropertyFailure(null); assert.equal(e.run().status, 'completed');
  assert(!e.logs.join('').includes('PRIVATE_'));
});
check('archive recovery status follows autoEnabled and never promises a disabled scheduled retry', () => {
  for (const enabled of [false, true]) for (const kind of ['retryable', 'fatal', 'capped']) {
    const e = env(); news(e);
    const config = JSON.parse(e.props.get('NEWS_ARCHIVE_CONFIG'));
    config.conversations[0].autoEnabled = enabled;
    e.props.set('NEWS_ARCHIVE_CONFIG', JSON.stringify(config));
    e.setAi(() => ({ ok: false, errorType: kind === 'fatal' ? 'ai_auth_error' : 'ai_timeout', retryable: kind !== 'fatal' }));
    assert.equal(e.run().status, 'failed');
    if (kind === 'capped') {
      e.props.set(e.stateKey(), JSON.stringify({ ...e.state(), autoAttempts: 3 }));
    }
    const status = e.c.getNewsArchiveStatusText_('group:a');
    assert.equal(status.includes('下次每日檢查補跑'), enabled && kind === 'retryable');
    if (!enabled || kind !== 'retryable') assert(status.includes('手動補跑'));
    e.setAi(null); e.setNow(e.now() + 86400000);
    const scheduled = e.c.processScheduledNewsArchives();
    assert.equal(scheduled.length, enabled ? 1 : 0);
    if (enabled) assert.equal(scheduled[0].status, kind === 'retryable' ? 'completed' : 'needs_attention');
    else assert.equal(e.models.length, 1);
  }
});
check('long replies fit all four or five main bubbles and retain the actual LINE source bubble', () => {
  for (const [count, slots] of [[355, 4], [435, 5]]) {
    const e = env(), text = 'Here is the analysis:\n\n' + Array.from({ length: count }, (_, i) =>
      (i + 1) + '. The team needs one more check before the launch.').join('\n');
    const sources = slots === 4 ? 'Sources:\nhttps://example.org/source' : '';
    const split = e.c.splitTextForLineMessagesWithMeta_(text, slots);
    assert.equal(split.wasTruncated, false); assert.equal(split.messages.length, slots);
    assert(split.messageLengths.every(length => length <= 4900));
    assert.equal(split.messages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    e.c.replyToLine('test-only-reply-token', text, true, sources);
    const payload = JSON.parse(e.fetches.at(-1).options.payload);
    assert.equal(payload.messages.length, 5);
    const main = sources ? payload.messages.slice(0, -1) : payload.messages;
    assert.equal(main.map(message => message.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    if (sources) assert.equal(payload.messages.at(-1).text, sources);
  }
});
check('splitter keeps exact-capacity content and bounds genuine overflow for one, four and five slots', () => {
  const e = env(), intro = 'Short introduction.\n\n';
  for (const slots of [1, 4, 5]) for (const excess of [0, 100]) {
    const text = intro + 'x'.repeat(4900 * slots - intro.length + excess);
    const split = e.c.splitTextForLineMessagesWithMeta_(text, slots);
    assert.equal(split.messages.length, slots); assert.equal(split.wasTruncated, excess > 0);
    assert(split.messageLengths.every(length => length <= 4900));
    if (!excess) assert.equal(split.messages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    else assert(split.messages.at(-1).includes('後面已省略'));
  }
});
check('long program Queue output survives guarded storage and Pending Reply delivery without truncation', () => {
  const e = env(), work = queueWork(e, 'program'); queueServices(e);
  const text = 'Here is the analysis:\n\n' + Array.from({ length: 435 }, (_, i) =>
    (i + 1) + '. The team needs one more check before the launch.').join('\n');
  e.c.runAiMemoryTask = () => ({ ok: true, text });
  assert.equal(work.run().status, 'committed'); assert.equal(work.sheet.records()[0].Status, 'done');
  assert.equal(scopeRows(e, 'PendingReplies')[0].ReplyText, text);
  const expected = e.c.getBotTextPendingDelivery_(text, false);
  assert(e.c.deliverPendingReply_('group:a', 'test-only-reply-token'));
  const payload = JSON.parse(e.fetches.at(-1).options.payload);
  assert(payload.messages.length <= 5); assert(payload.messages.every(message => message.text.length <= 4900));
  assert.equal(payload.messages.map(message => message.text).join('').replace(/\s/g, ''), expected.replace(/\s/g, ''));
  assert.equal(scopeRows(e, 'PendingReplies').length, 0); assert(!e.held());
});
check('capacity-aware splitting keeps three editorial topics and omits only complete news blocks', () => {
  const e = env(), topic = { title: '題'.repeat(60), summary: '述'.repeat(160), talkingPoint: '點'.repeat(100), relatedNewsIds: [] };
  const items = Array.from({ length: 30 }, (_, i) => ({ title: '新聞'.repeat(45) + i,
    url: 'https://example.org/' + i + '/' + 'u'.repeat(850), category: '科技與 AI', topicPotential: '高' }));
  const identified = e.c.assignWeeklyEditorialItemIds_(items);
  const text = e.c.formatWeeklyEditorialDigest_(identified, { newsClusters: [],
    otherItemIds: identified.map(entry => entry.itemId), conversationTopics: [topic, topic, topic] }, query);
  const split = e.c.splitTextForLineMessagesWithMeta_(text);
  assert.equal(text.split(topic.title).length - 1, 3); assert.equal(split.wasTruncated, false);
  assert(split.messages.length <= 5); assert(split.messageLengths.every(length => length <= 4900));
  let omitted = 0;
  for (const item of items) {
    if (!text.includes(item.url)) { omitted++; continue; }
    assert.equal(split.messages.filter(message => message.includes(item.url)).length, 1);
  }
  assert(omitted > 0 && omitted < items.length); assert(text.includes('尚有 ' + omitted + ' 則未顯示'));
});

check('LINE natural and capacity-forced cuts preserve paired Unicode and actual payloads', () => {
  for (const [count, slots] of [[355, 4], [435, 5]]) for (const at of [4898, 4899, 4900, 9799]) {
    const e = env();
    const original = 'Here is the analysis:\n\n' + Array.from({ length: count }, (_, i) =>
      (i + 1) + '. The team needs one more check before the launch.').join('\n');
    const text = original.slice(0, at) + '🙂' + original.slice(at + 2);
    const split = e.c.splitTextForLineMessagesWithMeta_(text, slots);
    assert(text.isWellFormed()); assert.equal(split.wasTruncated, false);
    assert(split.messages.every(message => message.isWellFormed() && message.length <= 4900));
    assert.equal(split.messages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    for (const index of split.splitIndexes) {
      assert(text.slice(0, index).isWellFormed()); assert(text.slice(index).isWellFormed());
    }
    const sources = slots === 4 ? 'Sources:\nhttps://example.org/source' : '';
    e.c.replyToLine('test-only-reply-token', text, true, sources);
    const payload = JSON.parse(e.fetches.at(-1).options.payload);
    assert.equal(payload.messages.length, 5); assert(payload.messages.every(message => message.text.isWellFormed()));
    const main = sources ? payload.messages.slice(0, -1) : payload.messages;
    assert.equal(main.map(message => message.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
    if (sources) assert.equal(payload.messages.at(-1).text, sources);
  }
  const e = env();
  for (const text of ['x'.repeat(4899) + '🙂' + 'y'.repeat(10), '說明。\n\n' + '🙂'.repeat(12000)]) {
    const split = e.c.splitTextForLineMessagesWithMeta_(text);
    assert.equal(split.wasTruncated, false); assert(split.messages.every(message => message.isWellFormed()));
    assert.equal(split.messages.join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  }
});
check('overflow notice and exact paired-character capacity never leave half a Unicode character', () => {
  const e = env(), probe = e.c.splitTextForLineMessagesWithMeta_('x'.repeat(5001), 1).messages[0];
  const suffix = probe.slice(probe.indexOf('\n\n'));
  assert(suffix.includes('後面已省略'));
  for (const slots of [1, 4, 5]) {
    const at = 4900 * slots - suffix.length - 1;
    const text = 'x'.repeat(at) + '🙂' + 'y'.repeat(200);
    const split = e.c.splitTextForLineMessagesWithMeta_(text, slots);
    assert.equal(split.wasTruncated, true); assert.equal(split.messages.length, slots);
    assert(split.messages.every(message => message.isWellFormed() && message.length <= 4900));
    assert(split.messages.at(-1).endsWith(suffix));
    const exact = 'x'.repeat(4899) + '🙂' + 'y'.repeat(Math.max(0, 4900 * slots - 4901));
    const exactSplit = e.c.splitTextForLineMessagesWithMeta_(exact, slots);
    assert.equal(exactSplit.wasTruncated, true);
    assert(exactSplit.messages.every(message => message.isWellFormed() && message.length <= 4900));
    assert(exactSplit.messages.at(-1).endsWith(suffix));
  }
});
check('LINE source bubble truncation retains only complete paired characters', () => {
  for (const at of [4898, 4899, 4900]) {
    const e = env(), source = 's'.repeat(at) + '🙂tail';
    e.c.replyToLine('test-only-reply-token', '正文', true, source);
    const payload = JSON.parse(e.fetches.at(-1).options.payload), last = payload.messages.at(-1).text;
    assert.equal(payload.messages.length, 2); assert(last.isWellFormed()); assert(last.length <= 4900);
    assert.equal(last, at === 4898 ? 's'.repeat(at) + '🙂' : 's'.repeat(Math.min(at, 4900)));
  }
});
check('program Queue and Pending Reply deliver paired Unicode without changing acknowledgement', () => {
  const e = env(), work = queueWork(e, 'program'); queueServices(e);
  const text = '說明。\n\n' + '🙂'.repeat(12000);
  e.c.runAiMemoryTask = () => ({ ok: true, text });
  assert.equal(work.run().status, 'committed'); assert.equal(work.sheet.records()[0].Status, 'done');
  assert.equal(scopeRows(e, 'PendingReplies')[0].ReplyText, text);
  const expected = e.c.getBotTextPendingDelivery_(text, false);
  assert(e.c.deliverPendingReply_('group:a', 'test-only-reply-token'));
  const payload = JSON.parse(e.fetches.at(-1).options.payload);
  assert(payload.messages.length <= 5); assert(payload.messages.every(message => message.text.isWellFormed() && message.text.length <= 4900));
  assert.equal(payload.messages.map(message => message.text).join('').replace(/\s/g, ''), expected.replace(/\s/g, ''));
  assert.equal(scopeRows(e, 'PendingReplies').length, 0); assert(!e.held());
});
check('editorial Unicode boundaries keep three topics, complete source URLs and exact omission counts', () => {
  const e = env(), topic = { title: '題'.repeat(58) + '🙂', summary: '述'.repeat(158) + '🙂',
    talkingPoint: '點'.repeat(98) + '🙂', relatedNewsIds: [] };
  const items = Array.from({ length: 30 }, (_, i) => ({ title: '新聞🙂'.repeat(20) + i,
    url: 'https://example.org/' + i + '/' + 'u'.repeat(850), category: '科技與 AI', topicPotential: '高' }));
  const identified = e.c.assignWeeklyEditorialItemIds_(items);
  const text = e.c.formatWeeklyEditorialDigest_(identified, { newsClusters: [],
    otherItemIds: identified.map(entry => entry.itemId), conversationTopics: [topic, topic, topic] }, query);
  const split = e.c.splitTextForLineMessagesWithMeta_(text);
  assert.equal(text.split(topic.title).length - 1, 3); assert.equal(split.wasTruncated, false);
  assert(split.messages.length <= 5); assert(split.messages.every(message => message.isWellFormed() && message.length <= 4900));
  let omitted = 0;
  for (const item of items) {
    if (!text.includes(item.url)) { omitted++; continue; }
    assert.equal(split.messages.filter(message => message.includes(item.url)).length, 1);
  }
  assert(omitted > 0 && omitted < items.length); assert(text.includes('尚有 ' + omitted + ' 則未顯示'));
});

check('editorial field clipping preserves complete Unicode at and around every shared length limit', () => {
  const e = env();
  for (const limit of [40, 60, 80, 100, 160, 240]) for (const mark of ['🙂', '𠮷']) {
    for (const at of [limit - 3, limit - 2, limit - 1]) {
      const original = '字'.repeat(at) + mark + '尾字';
      const clipped = e.c.truncateWeeklyEditorialText_(original, limit);
      assert(clipped.isWellFormed()); assert(clipped.length <= limit); assert(clipped.endsWith('…'));
      assert.equal(clipped, at === limit - 3 ? '字'.repeat(at) + mark + '…' : '字'.repeat(at) + '…');
    }
    const exact = '字'.repeat(limit - 2) + mark;
    assert.equal(e.c.truncateWeeklyEditorialText_(exact, limit), exact);
  }
  assert.equal(e.c.truncateWeeklyEditorialText_('題'.repeat(61), 60), '題'.repeat(59) + '…');
  assert.equal(e.c.truncateWeeklyEditorialText_(' \n說明　🙂\t內容  ', 60), '說明 🙂 內容');
  for (const limit of [1, 2]) assert.equal(e.c.truncateWeeklyEditorialText_('🙂尾', limit), '…');
  assert.equal(e.c.truncateWeeklyEditorialText_('🙂尾', 0), '🙂尾');
});
check('topic and story-line normalization keeps clipped Unicode valid without losing known news IDs', () => {
  const e = env(), { items, ids } = editorial(e, 2);
  const result = e.c.normalizeAndValidateWeeklyEditorialResult_(JSON.stringify({
    newsClusters: [{ title: '線'.repeat(38) + '🙂尾', itemIds: ids }], ungroupedNewsIds: [],
    conversationTopics: [{ title: '題'.repeat(58) + '🙂尾', summary: '述'.repeat(158) + '𠮷尾',
      talkingPoint: '點'.repeat(98) + '🙂尾', relatedNewsIds: [ids[0]] }]
  }), ids, e.c.assignWeeklyEditorialItemIds_(items), true);
  const normalized = result.normalizedResult, topic = normalized.conversationTopics[0];
  assert.equal(normalized.newsClusters[0].title, '線'.repeat(38) + '…');
  assert.equal(topic.title, '題'.repeat(58) + '…'); assert.equal(topic.summary, '述'.repeat(158) + '…');
  assert.equal(topic.talkingPoint, '點'.repeat(98) + '…');
  assert([normalized.newsClusters[0].title, topic.title, topic.summary, topic.talkingPoint].every(value => value.isWellFormed()));
  assert.equal(normalized.newsClusters[0].itemIds.join(','), ids.join(','));
  assert.equal(topic.relatedNewsIds.join(','), ids[0]);
  assert.equal(result.topicCounts.adopted, 1); assert.equal(result.topicCounts.rejected, 0);
});
check('editorial news and conversation model inputs share Unicode-safe clipping and existing bounds', () => {
  const e = env(), limits = { title: 100, brief: 80, outline: 160, category: 40, storyKey: 40,
    specialTopic: 80, matchedEntities: 100 };
  const item = { createdAt: new e.c.Date(start), topicPotential: '高' };
  for (const [field, limit] of Object.entries(limits)) item[field] = '材'.repeat(limit - 2) + '🙂尾';
  const identified = e.c.assignWeeklyEditorialItemIds_([item]);
  const payload = e.c.buildWeeklyEditorialNewsPayload_(identified);
  for (const [field, limit] of Object.entries(limits)) {
    assert.equal(payload[0][field], '材'.repeat(limit - 2) + '…');
    assert(payload[0][field].isWellFormed()); assert(payload[0][field].length <= limit);
  }
  assert(e.c.assertWeeklyEditorialNewsPayloadHasNoUrls_(payload));
  const conversations = e.c.prepareWeeklyEditorialConversationPayload_([{
    timestamp: new e.c.Date(end - 1), userId: 'alice', messageId: '100', role: 'user', mode: 'input',
    text: '述'.repeat(238) + '𠮷尾'
  }], identified);
  assert.equal(conversations.length, 1); assert.equal(conversations[0].text, '述'.repeat(238) + '…');
  assert(conversations[0].text.isWellFormed()); assert(conversations[0].text.length <= 240);
});
check('overlong emoji topics survive normalization, cache hits and actual multi-bubble LINE payloads', () => {
  const e = env(), { items, ids } = editorial(e, 30);
  items.forEach(item => { item.url += 'u'.repeat(850); });
  const rawTopics = ['甲', '乙', '丙'].map(label => ({ title: label.repeat(58) + '🙂尾',
    summary: '述'.repeat(158) + '𠮷尾', talkingPoint: '點'.repeat(98) + '🙂尾', relatedNewsIds: [ids[0]] }));
  e.setAi(() => ({ ok: true, json: { newsClusters: [], ungroupedNewsIds: ids, conversationTopics: rawTopics } }));
  const beforeSheets = JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data]));
  const beforeProps = JSON.stringify([...e.props]);
  const text = e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query);
  assert(text.isWellFormed()); assert(text.includes('本週群組話題'));
  for (const label of ['甲', '乙', '丙']) assert(text.includes(label.repeat(58) + '…'));
  const cached = JSON.parse([...e.cache.values()][0]);
  assert.equal(cached.topicCounts.adopted, 3); assert.equal(cached.topicCounts.rejected, 0);
  assert(cached.result.conversationTopics.every(topic => [topic.title, topic.summary, topic.talkingPoint].every(value => value.isWellFormed())));
  assert.equal(e.c.tryBuildWeeklyEditorialDigest_('group:a', items, query), text); assert.equal(e.models.length, 1);
  assert(e.logs.some(line => line.includes('"cacheHit":true') && line.includes('"topicCount":3')));
  assert(e.models[0][1].includes('我們可以聊')); assert(!e.models[0][1].includes('PRIVATE_OTHER_ROOM'));
  assert(!e.models[0][1].includes('PRIVATE_DERIVED_IMAGE'));
  e.c.replyToLine('test-only-reply-token', text, true);
  const payload = JSON.parse(e.fetches.at(-1).options.payload);
  assert(payload.messages.length > 1 && payload.messages.length <= 5);
  assert(payload.messages.every(message => message.text.isWellFormed() && message.text.length <= 4900));
  for (const label of ['甲', '乙', '丙']) assert.equal(payload.messages.filter(message => message.text.includes(label.repeat(58) + '…')).length, 1);
  let omitted = 0;
  for (const item of items) {
    if (!text.includes(item.url)) { omitted++; continue; }
    assert.equal(payload.messages.filter(message => message.text.includes(item.url)).length, 1);
  }
  assert(omitted > 0 && omitted < items.length); assert(text.includes('尚有 ' + omitted + ' 則未顯示'));
  assert.equal(JSON.stringify([...e.sheets].map(([name, sheet]) => [name, sheet.data])), beforeSheets);
  assert.equal(JSON.stringify([...e.props]), beforeProps); assert.equal(e.triggers.length, 0); assert(!e.held());
});

process.stdout.write('OK ' + checks + ' v1.17.0 checks; no live GAS/LINE/Sheets/API calls.\n');
