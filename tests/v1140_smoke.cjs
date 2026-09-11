// v1.14.0 基礎 + v1.14.1 回歸：node tests/v1140_smoke.cjs。只用內建模組，不部署到 GAS、不呼叫網路。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(name => name.endsWith('.gs'));
const source = files.map(name => {
  const code = fs.readFileSync(path.join(root, name), 'utf8');
  new vm.Script(code, { filename: name });
  return code;
}).join('\n');
assert.equal(files.length, 21);
assert(!/deepseek-v4-flash|deepseek_v4_flash/.test(source));
const functions = [...source.matchAll(/^function (\w+)\(/gm)].map(match => match[1]);
assert.equal(new Set(functions).size, functions.length, 'duplicate GAS function');

let now = 1000000;
const cache = new Map();
const rows = [], logs = [], calls = [], replies = [];
let fetchImpl, lockDelay = 0, pending = null, encodedDelay = 0;
const context = vm.createContext({
  console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')), warn: (...args) => logs.push(args.join(' ')) },
  Date: class extends Date { static now() { return now; } },
  Utilities: {
    base64Encode: bytes => { now += encodedDelay; return Buffer.from(bytes).toString('base64'); },
    newBlob: value => ({ getBytes: () => Array.from(typeof value === 'string' ? Buffer.from(value) : Buffer.from(value || [])) })
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-only-placeholder' }) },
  CacheService: { getScriptCache: () => ({ get: key => cache.get(key), put: (key, value) => cache.set(key, value), remove: key => cache.delete(key) }) },
  LockService: { getScriptLock: () => ({ waitLock: () => { now += lockDelay; }, releaseLock() {} }) },
  UrlFetchApp: { fetch: (url, options) => { calls.push({ url, options }); return fetchImpl(url, options); } },
  HtmlService: { createHtmlOutput: value => value }
});
vm.runInContext(source, context);
// 保留實際 ConversationLog writer 和 Cache memory，只替換 Google 服務的資料來源。
context.ensureLogSheet_ = () => ({ appendRow: row => rows.push(row) });
context.getRecentWeeklySummaryText = () => '';
context.getAndDeletePendingReply = () => { const value = pending; pending = null; return value; };
const transportReply = context.replyToLine;
context.replyToLine = (token, text) => replies.push({ token, text });
const value = expression => vm.runInContext(expression, context);
const json = expression => JSON.parse(JSON.stringify(value(expression)));
const png = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const imagePart = { type: 'image', mimeType: 'image/png', bytes: png };
const message = { role: 'user', content: [{ type: 'text', text: '解釋截圖' }, imagePart] };
function response(status, body, headers = {}, bytes = []) {
  return { getResponseCode: () => status, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => headers, getHeaders: () => headers, getContent: () => bytes };
}
function completion(text = '看見可辨識的錯誤訊息。', finish = 'stop') {
  return response(200, { choices: [{ message: { content: text, reasoning_content: 'never persist reasoning' }, finish_reason: finish }], usage: { prompt_tokens: 1200, completion_tokens: 2600, completion_tokens_details: { reasoning_tokens: 2200 }, total_tokens: 3800 } });
}
function reset() {
  now = 1000000; lockDelay = 0; encodedDelay = 0; pending = null;
  cache.clear(); rows.length = logs.length = calls.length = replies.length = 0;
  fetchImpl = url => url.includes('api-data.line.me')
    ? response(200, '', { 'Content-Type': 'image/png' }, png) : completion();
}
let checks = 0;
function check(name, run) { reset(); run(); checks++; process.stdout.write('PASS ' + name + '\n'); }
function event(type = 'image', sourceType = 'user', extra = {}) {
  return { type: 'message', replyToken: 'test-reply', timestamp: now, source: { type: sourceType, userId: 'user1', groupId: 'group1', roomId: 'room1' }, message: { type, id: '123456789012345678', contentProvider: { type: 'line' }, ...extra } };
}
const budgets = {
  general_chat: [4800, 45], news_analysis: [8000, 60], web_lazy_summary: [8000, 60],
  raw_html_extraction: [28000, 90], news_question: [7000, 90], program_topic_analysis: [8000, 120],
  integrate_topics: [9000, 120], archive_topics: [6000, 60], archive_news: [7000, 60],
  weekly_editorial_digest: [10000, 60], manual_news_supplement: [5000, 60], news_memory_bridge: [5000, 90], image_analysis: [8000, 60]
};
assert.deepEqual(Object.keys(json('AI_TASK_ROUTES')).sort(), Object.keys(budgets).sort());
for (const [task, [tokens, timeout]] of Object.entries(budgets)) check('route/payload ' + task, () => {
  const config = context.resolveAiTaskConfig_(task);
  assert.equal(config.modelRegistryKey, 'deepseek_flash');
  assert.equal(config.maxOutputTokens, tokens); assert.equal(config.timeoutSeconds, timeout);
  fetchImpl = () => completion(config.outputMode === 'json' ? '{"ok":true}' : '純文字回答');
  const result = context.runAiMessagesTask(task, [{ role: 'user', content: '請只輸出 JSON object 或指定文字' }]);
  assert(result.ok); assert.equal(result.usage.reasoningTokens, 2200);
  const payload = JSON.parse(calls[0].options.payload);
  assert.equal(payload.model, 'deepseek-flash'); assert.equal(payload.thinking.type, 'enabled');
  assert.equal(payload.reasoning_effort, 'high'); assert.equal(payload.max_tokens, tokens);
  for (const field of ['temperature', 'top_p', 'presence_penalty', 'frequency_penalty']) assert(!(field in payload));
  if (config.outputMode === 'json') { assert.equal(payload.response_format.type, 'json_object'); assert.equal(result.json.ok, true); }
});

check('missing thinking/effort fails before HTTP', () => {
  value("AI_TASK_ROUTES.general_chat.expectedReasoningEffort = ''");
  assert.equal(context.runAiTextTask('general_chat', 'hello').errorType, 'ai_configuration_error');
  value("AI_TASK_ROUTES.general_chat.expectedReasoningEffort = 'high'");
  assert.throws(() => context.buildDeepSeekPayload_({ messages: [] }));
  assert.equal(calls.length, 0);
});
check('text-only chat and conversation isolation', () => {
  context.handleLineEvent(event('text', 'user', { text: '你好' }), now);
  context.handleLineEvent(event('text', 'user', { text: '繼續' }), now);
  const payload = JSON.parse(calls[1].options.payload);
  assert(payload.messages.every(msg => typeof msg.content === 'string'));
  assert(payload.messages.some(msg => msg.role === 'assistant'));
  assert.equal(context.getConversationHistory('user:user1').length, 4);
  assert.equal(context.getConversationHistory('group:group1').length, 0);
});
check('image payload and text-only persistence', () => {
  context.handleLineEvent(event(), now);
  const payload = JSON.parse(calls[1].options.payload);
  const content = payload.messages.at(-1).content;
  assert.equal(content[0].type, 'text'); assert.equal(content[1].type, 'image_url');
  assert.equal(content[1].image_url.url, 'data:image/png;base64,' + Buffer.from(png).toString('base64'));
  assert.equal(calls[0].options.timeoutSeconds, 10); assert.equal(calls[1].options.timeoutSeconds, 30);
  const persisted = JSON.stringify([...cache.values(), rows, logs, replies]);
  assert(!persisted.includes(Buffer.from(png).toString('base64')));
  assert(!/data:image|"bytes"|never persist reasoning/.test(persisted));
  assert(persisted.includes('[使用者提供圖片]')); assert(persisted.includes('看見可辨識'));
  assert.equal(rows.length, 2);
});
check('group and room images stay silent, explicit quote carries question', () => {
  for (const sourceType of ['group', 'room']) context.handleLineEvent(event('image', sourceType), now);
  assert.equal(calls.length, 0); assert.equal(rows.length, 0); assert.equal(replies.length, 0);
  context.handleLineEvent(event('text', 'group', { text: '#小浣 看圖 哪裡出錯？', quotedMessageId: '99999' }), now);
  assert(calls[0].url.endsWith('/99999/content'));
  assert.equal(JSON.parse(calls[1].options.payload).messages.at(-1).content[0].text, '哪裡出錯？');
  assert.equal(replies.length, 1);
});
check('untriggered quote, missing quote, external image, album', () => {
  context.handleLineEvent(event('text', 'group', { text: '哪裡出錯？', quotedMessageId: '99999' }), now);
  context.handleLineEvent(event('text', 'group', { text: '#小浣 看圖' }), now);
  context.handleLineEvent(event('image', 'user', { contentProvider: { type: 'external', originalContentUrl: 'https://example.com/a.png' } }), now);
  context.handleLineEvent(event('image', 'user', { imageSet: { index: 2, total: 3 } }), now);
  assert.equal(calls.length, 0); assert.equal(replies.length, 2);
  assert(replies[0].text.includes('回覆')); assert(replies[1].text.includes('重新傳圖'));
});
check('pending reply takes priority without silently losing image request', () => {
  pending = { text: '先前的文字结果' };
  context.handleLineEvent(event(), now);
  assert.equal(calls.length, 0); assert(replies[0].text.includes('請再傳一次'));
});
check('quoted image questions are redacted before any persistence', () => {
  const question = 'data:image/png;base64,' + Buffer.from(png).toString('base64') + '。' + 'A'.repeat(300);
  for (const state of ['success', 'download_failure', 'pending']) {
    reset();
    if (state === 'download_failure') fetchImpl = () => response(404, 'unavailable');
    if (state === 'pending') pending = { text: '先前結果' };
    context.handleLineEvent(event('text', 'group', { text: '#小浣 看圖 ' + question, quotedMessageId: '123' }), now);
    const persisted = JSON.stringify([...cache.values(), rows, logs, replies]);
    assert(!/data:image/.test(persisted)); assert(!persisted.includes('A'.repeat(300)));
    assert(persisted.includes('已省略'));
  }
});
check('pending image question URL is not collected as news', () => {
  const originalIntake = context.handleSilentNewsUrlMessage_;
  let intakeCount = 0;
  context.handleSilentNewsUrlMessage_ = () => { intakeCount++; return { ok: true }; };
  try {
    pending = { text: '先前結果' };
    context.handleLineEvent(event('text', 'group', { text: '#小浣 看圖 https://example.org 是來源嗎？', quotedMessageId: '123' }), now);
    assert.equal(intakeCount, 0); assert.equal(calls.length, 0);
    assert(replies[0].text.includes('請重送看圖指令')); assert(!replies[0].text.includes('新網址'));
    pending = { text: '另一份先前結果' };
    context.handleLineEvent(event('text', 'group', { text: 'https://example.org/news' }), now);
    assert.equal(intakeCount, 1, 'ordinary pending URL intake is preserved');
  } finally { context.handleSilentNewsUrlMessage_ = originalIntake; }
});
check('album without a valid index requires explicit image selection', () => {
  // LINE webhook reference: Android <=11.15 can omit imageSet.index/total; events may arrive out of order.
  for (const index of [undefined, null, 0, -1, '1', 0.5]) {
    context.handleLineEvent(event('image', 'user', { imageSet: { id: 'album', index } }), now);
    assert(replies.at(-1).text.includes('單張分次傳送'));
  }
  assert.equal(calls.length, 0);
  context.handleLineEvent(event('image', 'user', { imageSet: { id: 'album', index: 2, total: 2 } }), now);
  context.handleLineEvent(event('image', 'user', { imageSet: { id: 'album', index: 1, total: 2 } }), now);
  assert.equal(calls.length, 2, 'only index=1 downloads and analyzes, regardless of event order');
  assert(replies.at(-1).text.includes('第一張'));
});
check('LINE transport bounds timeout and never exposes external failures', () => {
  const sensitive = 'external-error-sentinel data:image/png;base64,token-sentinel';
  fetchImpl = () => response(400, sensitive);
  transportReply('test-reply', 'safe analysis');
  assert.equal(calls[0].options.timeoutSeconds, 10);
  assert(logs.join('').includes('400')); assert(!logs.join('').includes('sentinel'));
  fetchImpl = () => { throw new Error(sensitive); };
  assert.throws(() => transportReply('test-reply', 'safe analysis'), error => error.message === 'LINE Reply API request failed.');
  // 使用真正 Reply transport，驗證 doPost 最外層 stack log 也不含外部例外內容。
  const mockReply = context.replyToLine;
  context.replyToLine = transportReply;
  try {
    fetchImpl = url => url.includes('/message/reply') ? (() => { throw new Error(sensitive); })()
      : url.includes('api-data.line.me') ? response(200, '', { 'Content-Type': 'image/png' }, png) : completion();
    assert.equal(context.doPost({ postData: { contents: JSON.stringify({ events: [event()] }) } }), 'OK');
    assert(!JSON.stringify([...cache.values(), rows, logs]).includes('sentinel'));
  } finally { context.replyToLine = mockReply; }
});
check('reject malformed message IDs before downloading', () => {
  for (const id of ['', null, 123, '../a', '1?token=abc', '9'.repeat(65)]) assert(!context.downloadLineImage_(id).ok);
  assert.equal(calls.length, 0);
});
check('HTTP status, MIME, empty/mismatched content, exception', () => {
  const cases = [response(404, 'secret'), response(302, '', { Location: 'https://example.com' }), response(202, ''),
    response(200, '', { 'Content-Type': 'text/html' }, png), response(200, '', {}, png),
    response(200, '', { 'Content-Type': 'image/png' }, []), response(200, '', { 'Content-Type': 'image/jpeg' }, png),
    response(200, '', { 'Content-Type': 'image/png' }, [60, 104, 116, 109, 108, 62])];
  for (const item of cases) { fetchImpl = () => item; assert(!context.downloadLineImage_('123').ok); }
  fetchImpl = () => { throw new Error('timed out secret image bytes'); };
  assert.equal(context.downloadLineImage_('123').errorType, 'ai_timeout');
  assert(!logs.join('').includes('secret'));
  assert(calls.every(call => call.options.followRedirects === false));
});
check('size checks use both headers and raw bytes, accept signed bytes', () => {
  const limit = value('AI_IMAGE_MAX_BYTES');
  fetchImpl = () => response(200, '', { 'content-type': 'IMAGE/PNG; charset=binary', 'content-length': String(limit + 1) }, png);
  assert.equal(context.downloadLineImage_('123').errorType, 'image_too_large');
  fetchImpl = () => response(200, '', { 'Content-Type': 'image/png', 'Content-Length': '1' }, new Array(limit + 1).fill(0));
  assert.equal(context.downloadLineImage_('123').errorType, 'image_too_large');
  fetchImpl = () => response(200, '', { 'content-type': 'image/png' }, png.map(byte => byte > 127 ? byte - 256 : byte));
  assert(context.downloadLineImage_('123').ok);
});
check('multimodal trust boundary rejects unsupported structures', () => {
  for (const content of [{ image_url: 'https://example.com' }, [], [{ type: 'image_url', image_url: {} }],
    [{ ...imagePart, bytes: [1.5] }], [imagePart, imagePart], [{ ...imagePart, mimeType: 'image/gif' }]]) {
    assert.throws(() => context.normalizeAiMessages_([{ role: 'user', content }]));
  }
  assert.throws(() => context.normalizeAiMessages_([{ role: 'system', content: [imagePart] }]));
  value('AI_MODEL_REGISTRY.deepseek_flash.supportsImages = false');
  assert.equal(context.runAiMessagesTask('image_analysis', [message]).errorType, 'ai_configuration_error');
  value('AI_MODEL_REGISTRY.deepseek_flash.supportsImages = true');
  assert.equal(calls.length, 0);
});
check('only user accepts content arrays under the published message schema', () => {
  // DeepSeek Chat Completions: system=string, assistant=string|null, user=string|parts.
  for (const role of ['system', 'assistant']) {
    const result = context.runAiMessagesTask('image_analysis', [
      { role, content: [{ type: 'text', text: 'structured text' }] }, message
    ]);
    assert.equal(result.errorType, 'ai_configuration_error'); assert.equal(result.retryable, false);
  }
  assert.equal(calls.length, 0, 'invalid roles fail before provider HTTP');
  const result = context.runAiMessagesTask('general_chat', [
    { role: 'system', content: 'system text' }, { role: 'assistant', content: 'previous answer' },
    { role: 'user', content: [{ type: 'text', text: 'user text parts' }] }
  ]);
  assert(result.ok);
  const messages = JSON.parse(calls[0].options.payload).messages;
  assert.equal(typeof messages[0].content, 'string'); assert.equal(typeof messages[1].content, 'string');
  assert.equal(messages[2].content[0].text, 'user text parts');
});
check('encoded body ceiling is enforced before fetch', () => {
  const request = { ...context.resolveAiTaskConfig_('image_analysis'), messages: context.normalizeAiMessages_([message]) };
  const raw = new Array(value('AI_IMAGE_MAX_BYTES')).fill(0); png.forEach((byte, index) => { raw[index] = byte; });
  request.messages = context.normalizeAiMessages_([{ role: 'user', content: [{ type: 'text', text: '圖片' }, { ...imagePart, bytes: raw }] }]);
  assert(context.callDeepSeekProvider_(request).ok);
  const payload = calls[0].options.payload;
  assert(Buffer.byteLength(payload) < value('DEEPSEEK_REQUEST_MAX_BYTES'));
  request.messages[0].content[0].text = '字'.repeat(1000000);
  assert.equal(context.callDeepSeekProvider_(request).errorType, 'ai_configuration_error');
  assert.equal(calls.length, 1);
});
check('shared deadline: expired image/AI/Reader makes zero fetches', () => {
  const execution = context.createLineWebhookExecutionContext_(now - 41000);
  assert.equal(context.downloadLineImage_('123', execution).errorType, 'ai_timeout');
  assert.equal(context.runAiTextTask('general_chat', 'hello', { executionDeadlineAtMs: now - 1 }).errorType, 'ai_timeout');
  assert(!context.applyReaderFetchTimeoutForExecutionContext_({}, execution));
  const reader = context.fetchAndExtractWebPageByReaderLayer_('https://example.com/news', execution);
  assert(!reader.ok); assert.equal(reader.httpStatus, 0); assert.equal(reader.retryable, true);
  assert.equal(calls.length, 0);
});
check('download, lock and encoding all consume the same deadline', () => {
  const execution = context.createLineWebhookExecutionContext_(now - 17000);
  fetchImpl = url => { if (url.includes('api-data.line.me')) { now += 9000; return response(200, '', { 'Content-Type': 'image/png' }, png); } return completion(); };
  lockDelay = 3000; encodedDelay = 1000;
  assert(context.analyzeLineImage_(event(), 'user:user1', '123', '', execution).includes('看見'));
  assert.equal(calls[1].options.timeoutSeconds, 10);
  reset(); encodedDelay = 33000;
  context.analyzeLineImage_(event(), 'user:user1', '123', '', context.createLineWebhookExecutionContext_(now));
  assert.equal(calls.length, 1, 'expired after encoding: no provider fetch');
});
check('webhook batch cannot refresh budget for the second event', () => {
  fetchImpl = url => { if (url.includes('api-data.line.me')) return response(200, '', { 'Content-Type': 'image/png' }, png); now += 33000; return completion(); };
  assert.equal(context.doPost({ postData: { contents: JSON.stringify({ events: [event(), event()] }) } }), 'OK');
  assert.equal(calls.length, 2); assert.equal(replies.length, 2); assert(replies[1].text.includes('時間'));
});
check('background has full timeout; Reader cap and status zero contract retained', () => {
  context.runAiJsonTask('raw_html_extraction', 'JSON');
  assert.equal(calls[0].options.timeoutSeconds, 90);
  const options = {}; context.applyReaderFetchTimeoutForExecutionContext_(options, context.createLineWebhookExecutionContext_(now));
  assert.equal(options.timeoutSeconds, 12);
  const error = context.createNewsUrlReaderError_({ errorType: 'reader_sync_budget_exhausted', retryable: true, httpStatus: 0, statusCode: 200 });
  assert.equal(error.httpStatus, 0); assert.equal(error.retryable, true);
  for (const status of [400, 401, 403, 404]) assert(!context.shouldRetryNewsUrlError_('ai_provider_http_error', '', false, status));
  for (const status of [408, 429, 500, 503]) assert(context.shouldRetryNewsUrlError_('ai_provider_http_error', '', true, status));
});
check('invalid JSON, empty/length responses never enter memory', () => {
  for (const [text, finish, errorType] of [['{"x":', 'stop', 'ai_invalid_json'], ['{}', 'length', 'ai_finish_reason_length'], ['', 'stop', 'ai_empty_response']]) {
    fetchImpl = () => completion(text, finish);
    assert.equal(context.runAiJsonTask('archive_news', 'JSON').errorType, errorType);
  }
  fetchImpl = () => completion('partial image description', 'length');
  const result = context.runAiMemoryTask('image_analysis', 'user:user1', '[圖片]', message.content);
  assert(!result.ok); assert.equal(cache.size, 0);
});
check('provider HTTP errors and exceptions never echo media or secret', () => {
  const sensitive = 'data:image/png;base64,' + Buffer.from(png).toString('base64') + ' test-secret';
  for (const status of [400, 401, 403, 408, 429, 500]) {
    fetchImpl = () => response(status, { error: { message: sensitive } });
    const result = context.runAiMessagesTask('image_analysis', [message]);
    assert(!result.ok); assert(!JSON.stringify(result).includes('test-secret'));
    assert.equal(result.retryable, [408, 429, 500].includes(status));
  }
  fetchImpl = () => { throw new Error(sensitive); };
  assert(!JSON.stringify(context.runAiMessagesTask('image_analysis', [message])).includes('test-secret'));
  assert(!logs.join('').includes(sensitive));
});
check('reasoning-only truncation and malformed provider response', () => {
  fetchImpl = () => response(200, { choices: [{ message: { content: null }, finish_reason: 'length' }] });
  const result = context.runAiJsonTask('news_analysis', 'JSON');
  assert.equal(result.errorType, 'ai_finish_reason_length'); assert.equal(result.retryable, false);
  fetchImpl = () => response(200, { choices: [{ message: { content: null }, finish_reason: 'insufficient_system_resource' }] });
  assert.equal(context.runAiJsonTask('news_analysis', 'JSON').retryable, true);
  for (const text of [null, 'partial analysis']) {
    fetchImpl = () => completion(text, 'aborted');
    const interrupted = context.runAiMemoryTask('image_analysis', 'user:user1', '[圖片]', message.content);
    assert.equal(interrupted.errorType, 'ai_provider_http_error'); assert.equal(interrupted.retryable, true);
    assert.equal(interrupted.finishReason, 'aborted'); assert.equal(interrupted.usage.reasoningTokens, 2200);
    assert.equal(interrupted.text, ''); assert.equal(cache.size, 0);
  }
  for (const body of ['null', '{}', 'not json', '{"choices":[{"message":{"content":[]},"finish_reason":"stop"}]}']) {
    fetchImpl = () => response(200, body);
    assert.equal(context.runAiTextTask('general_chat', 'hello').errorType, 'ai_invalid_provider_response');
  }
  fetchImpl = () => completion('safe text', 'data:image/png;base64,secret');
  assert.equal(context.runAiMessagesTask('image_analysis', [message]).errorType, 'ai_invalid_provider_response');
  assert(!logs.join('').includes('data:image'));
});
check('model-echoed data URL is removed before memory/Sheet/LINE', () => {
  fetchImpl = url => url.includes('api-data.line.me') ? response(200, '', { 'Content-Type': 'image/png' }, png)
    : completion('描述 data:image/png;base64,' + Buffer.from(png).toString('base64') + '。結束');
  context.handleLineEvent(event(), now);
  assert(!JSON.stringify([...cache.values(), rows, replies, logs]).includes('data:image'));
});
check('news/archive/weekly business validators remain in place', () => {
  assert.throws(() => context.validateNewsAnalysisContract_({}));
  const news = Object.fromEntries(json('buildNewsAnalysisSchema_().required').map(key => [key, '測試']));
  context.validateNewsAnalysisContract_(news);
  assert.throws(() => context.validateArchiveJsonContract_({ summary: 'missing fields' }));
  context.validateArchiveJsonContract_({ topicTitle: '話題', keywords: [], summary: '摘要', reusableAngles: [], followUpQuestions: [] });
  const items = context.assignWeeklyEditorialItemIds_([{ title: '新聞一' }, { title: '新聞二' }]);
  const result = context.normalizeAndValidateWeeklyEditorialResult_(JSON.stringify({ newsClusters: [], ungroupedNewsIds: ['N001'], conversationTopics: [] }), ['N001', 'N002'], items, false);
  assert.equal(result.partition.otherItemIds.length, 2, 'missing news ID restored by existing validator');
});
check('Gemini stays dormant and wrappers remain available', () => {
  assert.equal(value('AI_PROVIDER_REGISTRY.gemini.status'), 'dormant');
  for (const name of ['callDeepSeekWithMemory', 'callDeepSeekDirect', 'callGeminiWebExtractor', 'buildSystemPrompt', 'processNewsUrlQueue', 'processWebTaskQueue']) assert.equal(typeof context[name], 'function');
  assert(!calls.some(call => call.url.includes('googleapis')));
});
// v1.14.1：只替換外部服務或不在本次檢查範圍的耗時流程；finally 還原，避免測試互相污染。
function withStubs(stubs, run) {
  const saved = Object.fromEntries(Object.keys(stubs).map(key => [key, context[key]]));
  Object.assign(context, stubs);
  try { run(); } finally { Object.assign(context, saved); }
}
function headerSheet(headers) {
  const appended = [];
  return {
    appended,
    getLastColumn: () => headers.length,
    getRange: (row, column, rowCount, columnCount) => {
      assert.deepEqual([row, column, rowCount, columnCount], [1, 1, 1, headers.length]);
      return { getValues: () => [headers.slice()] };
    },
    appendRow: row => appended.push(Array.from(row))
  };
}

check('header writer preserves column order, unknown columns and falsy own values', () => {
  const headers = [' Flag ', 'Zero', 'Empty', 'Missing', 'Inherited', 'constructor', 'When', 'Zero'];
  const sheet = headerSheet(headers);
  const fields = Object.assign(Object.create({ Inherited: 'must not write' }), {
    Flag: false, Zero: 0, Empty: '', When: new Date(0)
  });
  context.appendRowByHeaders_(sheet, fields);
  assert.deepEqual(sheet.appended[0], [false, 0, '', '', '', '', fields.When, 0]);
  assert.equal(headers[0], ' Flag ', 'writing must not rewrite headers');
  const weekly = headerSheet(['Summary', 'ConversationId', 'ArchiveType', 'SourceItemCount', 'RawMessageCount', 'Custom', 'PeriodStart']);
  withStubs({ ensureWeeklySummarySheet_: () => weekly }, () => {
    context.appendWeeklySummaryRow_({ conversationId: 'group:a', summary: '字'.repeat(30001), rawMessageCount: 4, archiveType: 'news', periodStart: '2026-09-04' });
    assert.deepEqual(weekly.appended[0], ['字'.repeat(30000), 'group:a', 'news', 4, 4, '', '2026-09-04']);
  });
});

check('memory saving keeps the last six pairs and leaves other conversations unchanged', () => {
  const seed = Array.from({ length: 16 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'message ' + i }));
  const snapshot = JSON.stringify(seed);
  context.saveConversationHistory('group:other', seed);
  const otherBefore = cache.get(context.getHistoryCacheKey('group:other'));
  context.saveConversationHistory('user:current', seed.concat([{ role: 'user', content: ' ' }, { role: 'system', content: 'reject' }]));
  assert(context.runAiMemoryTask('general_chat', 'user:current', 'new question', 'new question').ok);
  const history = JSON.parse(cache.get(context.getHistoryCacheKey('user:current')));
  assert.equal(history.length, 12); assert.equal(history[0].content, 'message 6');
  assert.equal(history.at(-2).content, 'new question'); assert.equal(history.at(-1).role, 'assistant');
  assert.equal(cache.get(context.getHistoryCacheKey('group:other')), otherBefore);
  assert.equal(JSON.stringify(seed), snapshot);
});

check('URL safety, X status routing and weekly display share existing hostname semantics', () => {
  for (const url of ['https://example.org/path', ' HTTPS://EXAMPLE.ORG:8443?q=1 ', 'http://sub.example.org#fragment']) assert(context.isSafePublicUrl(url), url);
  for (const url of ['', 'ftp://example.org', 'https:///path', 'https://example.org:bad/', 'http://localhost', 'http://127.0.0.1', 'http://10.2.3.4', 'http://172.16.0.1', 'http://192.168.1.2', 'http://169.254.169.254', 'http://metadata.google.internal']) assert(!context.isSafePublicUrl(url), url);
  for (const host of ['x.com', 'twitter.com', 'mobile.twitter.com', 'sub.twitter.com', 'fxtwitter.com', 'fixupx.com']) {
    for (const route of ['/user/status/12345', '/i/web/status/12345?x=1', '/user/status/12345/photo/1']) {
      const url = 'https://' + host + route;
      assert.equal(context.extractTwitterStatusIdFromUrl_(url), '12345');
      assert.equal(context.detectWebReaderRoute_(url), 'fxtwitter_api');
      assert.equal(context.getWeeklyNewsDisplayTitle_({ url, title: 'raw', brief: '既有簡介' }), 'X｜既有簡介');
    }
  }
  for (const route of ['/user', '/search?q=a', '/i/lists/12345', '/user/status/1234', '/user/status/12345x']) assert.equal(context.detectWebReaderRoute_('https://x.com' + route), 'unsupported_social_platform');
  for (const host of ['eviltwitter.com', 'twitter.com.evil.org']) assert(!context.isTwitterLikeHostname_(host));
  assert.equal(context.detectWebReaderRoute_('https://example.org/status/12345'), 'jina_reader');
  assert.equal(context.detectWebReaderRoute_('https://www.ptt.cc/bbs/C_Chat/M.123.html'), 'ptt_over18_cookie');
});

check('PTT explicit title, inferred title, over18 gate and short text keep their outcomes', () => {
  const body = '<div id="main-content">正文第一行<br>' + '有效文章內容'.repeat(30) + '</div>';
  for (const [html, title] of [[body, '正文第一行'], ['<title>測試標題 - 看板 C_Chat</title>' + body, '測試標題']]) {
    fetchImpl = () => response(200, html, { 'Content-Type': 'text/html' });
    const result = context.fetchPttPageWithOver18Cookie_('https://www.ptt.cc/bbs/C_Chat/M.123.html');
    assert(result.ok); assert.equal(result.title, title);
    assert.equal(result.mainText, context.htmlToReadableText_(html));
    assert.equal(calls.at(-1).options.headers.Cookie, 'over18=1');
  }
  fetchImpl = () => response(200, '我同意，我已年滿十八歲');
  assert.equal(context.fetchPttPageWithOver18Cookie_('https://ptt.cc').errorType, 'ptt_over18_failed');
  fetchImpl = () => response(200, '<div id="main-content">短</div>');
  assert.equal(context.fetchPttPageWithOver18Cookie_('https://ptt.cc').errorType, 'ptt_empty_content');
});

check('Reader error metadata keeps explicit zero and retry decisions', () => {
  for (const [result, expected] of [[{ statusCode: 503 }, 503], [{ httpStatus: 0, statusCode: 200 }, 0], [{ httpStatus: null, statusCode: 503 }, 0], [{ httpStatus: 429, statusCode: 200 }, 429], [{}, 0]]) {
    const error = context.createNewsUrlReaderError_({ ...result, errorType: 'reader_error', retryable: true });
    assert.equal(error.httpStatus, expected); assert.equal(error.retryable, true);
  }
  for (const status of [400, 404, 408, 429, 500, 599, 600]) assert.equal(context.isReaderHttpStatusRetryable_(status), [408, 429, 500, 599].includes(status));
  assert.equal(context.resolveCombinedReaderFailureHttpStatus_({ httpStatus: 500 }, { httpStatus: 404 }, true), 500);
  assert.equal(context.resolveCombinedReaderFailureHttpStatus_({ httpStatus: 404 }, { httpStatus: 0, retryable: true }, true), 0);
});

check('synchronous and queued news persist the same analysis in reordered columns', () => {
  const analysis = { title: '測試新聞', outline: '完整新聞內容'.repeat(20), category: '科技與 AI', brief: '新聞的自然簡介', angle: '可聊切角', topicPotential: '高', specialTopic: '無', categoryReason: '測試分類理由', categoryConfidence: 0, matchedEntities: '測試公司', classificationWarning: '', storyKey: '測試公司產品更新事件' };
  const fieldHeaders = { title: 'Title', outline: 'Outline', category: 'Category', brief: 'Brief', angle: 'Angle', topicPotential: 'TopicPotential', specialTopic: 'SpecialTopic', categoryReason: 'CategoryReason', categoryConfidence: 'CategoryConfidence', matchedEntities: 'MatchedEntities', classificationWarning: 'ClassificationWarning', storyKey: 'StoryKey' };
  const headers = ['SourceMode', 'ConversationId', 'Url', 'SourceType', 'UserId', 'GroupId', 'RoomId', 'Custom'].concat(Object.values(fieldHeaders).reverse());
  const sheet = headerSheet(headers), queue = headerSheet(['Status']), changes = {};
  const url = 'https://example.org/news';
  fetchImpl = () => completion(JSON.stringify(analysis));
  withStubs({ ensureNewsInboxSheet_: () => sheet, ensureNewsUrlQueueSheet_: () => queue,
    fetchAndExtractWebPageByReaderLayer_: () => ({ ok: true, mainText: '正文', readerRoute: 'jina_reader' }),
    setCellByHeader_: (_sheet, _row, _map, field, fieldValue) => { changes[field] = fieldValue; }
  }, () => {
    const direct = context.handleDirectNewsUrlMessage_(event('text'), 'user:user1', url);
    assert.equal(direct.replyText, analysis.brief); assert.equal(direct.queued, false);
    context.processSingleNewsUrlTask_({ sheetRowNumber: 2, conversationId: 'user:user1', sourceType: 'user', userId: 'user1', groupId: 'group1', roomId: 'room1', url });
    assert.equal(changes.Status, 'done'); assert.equal(sheet.appended.length, 2);
    for (const [i, row] of sheet.appended.entries()) {
      const record = Object.fromEntries(headers.map((header, j) => [header, row[j]]));
      assert.equal(record.SourceMode, i ? 'auto_url' : 'auto_url_sync');
      assert.equal(record.ConversationId, 'user:user1'); assert.equal(record.Url, url); assert.equal(record.Custom, '');
      assert.deepEqual([record.SourceType, record.UserId, record.GroupId, record.RoomId], ['user', 'user1', 'group1', 'room1']);
      for (const [key, header] of Object.entries(fieldHeaders)) assert.equal(record[header], key === 'classificationWarning' ? '分類信心偏低' : analysis[key], header);
    }
  });
});

check('WebTask success and failure preserve PendingReplies source fields and task type', () => {
  const queue = headerSheet(['Status']), pendingSheet = headerSheet([]), changes = {};
  const task = Object.freeze({ sheetRowNumber: 2, taskId: 'task', conversationId: 'room:r', sourceType: 'room', userId: 'u', groupId: '', roomId: 'r', userPrompt: 'prompt', urls: 'https://example.org', taskType: 'web_lazy_summary' });
  for (const failed of [false, true]) withStubs({ ensureWebTaskQueueSheet_: () => queue, ensurePendingRepliesSheet_: () => pendingSheet,
    processWebLazySummaryTask_: () => { if (failed) throw new Error('test failure'); return '快讀完成'; },
    setCellByHeader_: (_sheet, _row, _map, field, fieldValue) => { changes[field] = fieldValue; }
  }, () => {
    context.processSingleWebTask_(task);
    const row = pendingSheet.appended.at(-1);
    assert.deepEqual(row.slice(2, 7), ['room:r', 'room', 'u', '', 'r']);
    assert.equal(row[8], 'pending'); assert.equal(row[10], 'web_lazy_summary');
    assert.equal(row[7], failed ? context.getBotTextWebTaskFailed_('test failure') : '快讀完成');
    assert.equal(changes.Status, failed ? 'failed' : 'done');
  });
});

check('NewsUrlQueue retains permanent failure, retry backoff and retry exhaustion', () => {
  for (const [status, retryCount, shouldRetry] of [[404, 0, false], [408, 0, true], [429, 1, true], [503, 2, false], [0, 0, true]]) {
    const queue = headerSheet(['Status']), pendingSheet = headerSheet([]), changes = {};
    withStubs({ ensureNewsUrlQueueSheet_: () => queue, ensurePendingRepliesSheet_: () => pendingSheet,
      fetchAndExtractWebPageByReaderLayer_: () => ({ ok: false, httpStatus: status, statusCode: 200, retryable: true, errorType: 'reader_error', error: 'read failed' }),
      setCellByHeader_: (_sheet, _row, _map, field, fieldValue) => { changes[field] = fieldValue; }
    }, () => {
      context.processSingleNewsUrlTask_({ sheetRowNumber: 2, conversationId: 'group:a', url: 'https://example.org', retryCount });
      assert.equal(changes.Status, shouldRetry ? 'pending' : 'failed'); assert.equal(changes.RetryCount, retryCount + 1);
      if (shouldRetry) assert.equal(changes.NextRunAt.getTime() - changes.UpdatedAt.getTime(), (retryCount + 1) * 120000);
      assert.equal(pendingSheet.appended.length, shouldRetry ? 0 : 1);
      if (!shouldRetry) assert.equal(pendingSheet.appended[0][10], 'news_url_failed');
    });
  }
});

check('classification guards and shared potential normalization retain defaults', () => {
  const news = { title: 'https://example.org', brief: '簡介', outline: '大綱', category: '待分類', angle: '' };
  assert.equal(context.isWeakAutoNewsClassification_(news, news.title), false);
  for (const field of ['title', 'brief', 'outline']) assert(context.isWeakAutoNewsClassification_({ ...news, [field]: '' }, news.title));
  assert(context.isWeakAutoNewsClassification_({ ...news, category: '非法分類' }));
  assert(context.isWeakAutoNewsClassification_({ ...news, title: '未取得標題' }));
  for (const category of ['馬斯克', '川普', '未知', null]) assert.equal(context.normalizeNewsCategory_(category), '待分類');
  assert.equal(context.normalizeNewsCategory_(' 科技與 AI '), '科技與 AI');
  for (const [input, expected] of [[' 高 ', '高'], ['低', '低'], ['中', '中'], ['', '中'], [null, '中'], [0, '中'], ['未知', '中']]) {
    assert.equal(context.normalizeTopicPotential_(input), expected); assert.equal(context.normalizeWeeklyEditorialPotential_(input), expected);
  }
});

check('weekly clusters keep conflict repair, cache revalidation and rendered coverage', () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ title: '新聞 ' + i, category: '科技與 AI', url: 'https://example.org/' + i, brief: '簡介', topicPotential: '高' }));
  const identified = context.assignWeeklyEditorialItemIds_(items), ids = identified.map(entry => entry.itemId);
  const raw = { newsClusters: [{ title: '完整事件', itemIds: ['N001', 'N002', 'N002', 'unknown'] }, { title: '衝突事件', itemIds: ['N003', 'N004'] }], ungroupedNewsIds: ['N003'], conversationTopics: [] };
  const validated = context.normalizeAndValidateWeeklyEditorialResult_(JSON.stringify(raw), ids, identified, false);
  assert.deepEqual(JSON.parse(JSON.stringify(validated.normalizedResult)), { newsClusters: [{ title: '完整事件', itemIds: ['N001', 'N002'] }], ungroupedNewsIds: ['N003', 'N004', 'N005'], conversationTopics: [] });
  const options = { viewMode: 'compact', onlyHighPotential: false, days: 7 };
  withStubs({ getRecentWeeklyEditorialConversationItems_: () => [], buildWeeklyEditorialCacheKey_: () => 'test-weekly' }, () => {
    fetchImpl = () => completion(JSON.stringify(raw));
    const first = context.tryBuildWeeklyEditorialDigest_('group:a', items, options);
    assert(first.includes('完整事件')); const callCount = calls.length;
    assert.equal(context.tryBuildWeeklyEditorialDigest_('group:a', items, options), first); assert.equal(calls.length, callCount);
    cache.set('test-weekly', '{"broken":true}');
    assert.equal(context.tryBuildWeeklyEditorialDigest_('group:a', items, options), first); assert.equal(calls.length, callCount + 1);
    for (const item of items) assert.equal(first.split(item.url).length - 1, 1);
  });
  const oversized = context.assignWeeklyEditorialItemIds_(items.concat([{ title: 'too long', url: 'https://example.org/' + 'x'.repeat(5000) }]));
  const partition = { newsClusters: [], otherItemIds: oversized.map(entry => entry.itemId), conversationTopics: [] };
  const rendered = context.formatWeeklyEditorialDigest_(oversized, partition, options);
  assert(rendered.includes('尚有 1 則未顯示')); assert(!rendered.includes('x'.repeat(5000)));
  for (const item of items) assert.equal(rendered.split(item.url).length - 1, 1);
  const split = context.splitTextForLineMessagesWithMeta_(rendered); assert(!split.wasTruncated);
  assert.throws(() => context.assertWeeklyEditorialPartitionCoverage_(['N001'], [], []));
  assert.throws(() => context.assertWeeklyEditorialRenderedCoverage_(['N001'], ['N001', 'N001'], [], 0));
});

process.stdout.write(`Verified ${files.length} GAS sources, ${functions.length} unique functions; ${checks} checks passed. No live GAS/LINE/DeepSeek calls.\n`);
