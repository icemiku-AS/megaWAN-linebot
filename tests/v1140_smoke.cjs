// 本機開發檢查：node tests/v1140_smoke.cjs。只用內建模組，不部署到 GAS、不呼叫網路。
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
context.replyToLine = (token, text) => replies.push({ token, text });
const value = expression => vm.runInContext(expression, context);
const json = expression => JSON.parse(JSON.stringify(value(expression)));
const png = Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const imagePart = { type: 'image', mimeType: 'image/png', bytes: png };
const message = { role: 'user', content: [{ type: 'text', text: '解釋截圖' }, imagePart] };
function response(status, body, headers = {}, bytes = []) {
  return { getResponseCode: () => status, getContentText: () => typeof body === 'string' ? body : JSON.stringify(body), getAllHeaders: () => headers, getContent: () => bytes };
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
process.stdout.write(`Verified ${files.length} GAS sources, ${functions.length} unique functions; ${checks} checks passed. No live GAS/LINE/DeepSeek calls.\n`);
