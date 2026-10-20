// 固定週期封存／週編輯台回歸；只用 Node 內建模組，所有 GAS／HTTP 都是記憶體 mock。
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
  let now = clock, held = false, uuid = 0, busy = false, propertyFailure = null, ai = null, flush = null;
  const props = new Map(), logs = [], models = [], fetches = [], triggers = [];
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
      setProperty: (key, value) => { if (propertyFailure) propertyFailure(key, value); props.set(key, value); },
      deleteProperty: key => props.delete(key)
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (busy || held) return false; held = true; return true; },
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
  const run = (origin = 'manual') => c.runFixedNewsArchive_(config(), origin, event);
  const stateKey = () => c.getNewsArchiveStateKey_(config());
  return { c, props, logs, models, fetches, triggers, sheets, cache, run, config, stateKey,
    state: () => c.getNewsArchiveState_(config()), now: () => now, setNow: value => { now = value; },
    setBusy: value => { busy = value; }, setAi: value => { ai = value; },
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

const topics = [{ title: '群友討論 AI 改變對話習慣', summary: '甲與乙認為過度依賴制式回覆會影響討論方式。', talkingPoint: '哪些場合仍需要自己的說法？' }];
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

process.stdout.write('OK ' + checks + ' v1.17.0 checks; no live GAS/LINE/Sheets/API calls.\n');
