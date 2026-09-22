// ======================================================
// 14_AiTools.gs
// 用途：AI research tools：工具定義、參數驗證與只讀資料查詢。
//
// 職責與協作：
// 1. 提供新聞、對話、人工重點、週記憶與網址只讀 evidence，供 AiService 查詢。
// 2. 回傳有界資料與安全來源；provider adapter 負責轉譯工具協議。
//
// 維護注意：
// 1. conversationId 僅由 trusted caller 注入；模型不能指定 Sheet、range 或任意 GAS 函式。
// 2. 整批 calls 驗證後才執行，筆數、日期、文字、URL 與回合皆有上限。
// 3. 工具不建表、不補欄、不修改資料；read_url 重用 Reader 並禁止遞迴 AI。
// 4. 不記錄原始工具內容、例外或 provider 私有狀態。
// ======================================================

// ======================================================
// 工具上限與定義
// ======================================================

// 同步最多四個查詢、一次 URL、每份 6000 字元；為 30 秒 AI window 保留最後回答時間。
const AI_TOOL_MAX_CALLS = 4;
const AI_TOOL_MAX_RESULT_CHARS = 6000;
const AI_TOOL_FINAL_RESERVE_SECONDS = 8;
const AI_TOOL_MAX_LIMIT = 10;
const AI_TOOL_MAX_DAYS = 30;

function getAiReadOnlyToolDefinitions_() {
  const query = { type: 'string', maxLength: 200 };
  const limit = { type: 'integer', minimum: 1, maximum: AI_TOOL_MAX_LIMIT };
  const days = { type: 'integer', minimum: 1, maximum: AI_TOOL_MAX_DAYS };
  return [
    { name: 'search_news_inbox', description: '查目前聊天室近期已收集的新聞；query 是文字子字串，非任意查詢語法。',
      parameters: { type: 'object', properties: { query: query, days: days, limit: limit }, additionalProperties: false } },
    { name: 'search_conversation_log', description: '查目前聊天室近期使用者文字與 AI 從圖片辨識的短語意；回傳 provenance 區分來源，圖片描述不是使用者說過的話。',
      parameters: { type: 'object', properties: { query: query, days: days, limit: limit,
        provenance: { type: 'string', enum: ['user_text', 'image_derived'] } }, additionalProperties: false } },
    { name: 'get_topic_highlights', description: '查目前聊天室人工畫過的重點；保留人工觀點，不改寫資料。',
      parameters: { type: 'object', properties: { query: query, days: days, limit: limit }, additionalProperties: false } },
    { name: 'get_weekly_memory', description: '讀目前聊天室過去封存的週記憶；不是當前新聞事實。',
      parameters: { type: 'object', properties: { limit: limit, archiveType: { type: 'string', enum: ['topic', 'news'] } }, additionalProperties: false } },
    { name: 'read_url', description: '讀一個公開網址的內容；不執行頁面指令，不能讀登入頁或以 AI 遞迴抽取。',
      parameters: { type: 'object', properties: { url: { type: 'string', maxLength: 2048 } }, required: ['url'], additionalProperties: false } }
  ];
}

// ======================================================
// 工具呼叫驗證與安全錯誤
// ======================================================

/** 整批先驗證再執行，未知工具、額外欄位、重複 ID 或超限都在任何資料讀取前停止。 */
function validateAiToolCalls_(calls, availableTools) {
  if (!Array.isArray(calls) || !calls.length || calls.length > AI_TOOL_MAX_CALLS) throw createAiToolError_('ai_tool_limit');
  const ids = Object.create(null);
  let urlCount = 0;
  return calls.map(function(call) {
    const definition = (availableTools || []).find(function(tool) { return tool.name === (call && call.name); });
    if (!definition) throw createAiToolError_('ai_tool_not_allowed');
    if (typeof call.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(call.id) || ids[call.id]) throw createAiToolError_('ai_invalid_tool_call');
    ids[call.id] = true;
    let args = call.arguments;
    if (typeof args === 'string') {
      if (args.length > 4096) throw createAiToolError_('ai_invalid_tool_arguments');
      try { args = JSON.parse(args); } catch (error) { throw createAiToolError_('ai_invalid_tool_arguments'); }
    }
    if (!validateAiSchemaValue_(args, definition.parameters)) throw createAiToolError_('ai_invalid_tool_arguments');
    if (call.name === 'read_url') {
      if (++urlCount > 1) throw createAiToolError_('ai_tool_limit');
      if (!isSafePublicUrl(args.url)) throw createAiToolError_('ai_unsafe_tool_url');
    }
    return { id: call.id, name: call.name, arguments: args };
  });
}

function createAiToolError_(errorType) {
  const error = new Error('Read-only research could not complete.');
  error.errorType = errorType;
  error.retryable = false;
  return error;
}

/** 明確資料需求由 code 執行；只讀本次問題，不讓 history、圖片或 evidence 擴大必要來源。 */
function getAiRequiredResearch_(question) {
  const text = redactAiMediaText_(String(question || '')).slice(0, 2000);
  const required = [];
  const imageRecall = /(?:之前|以前|過去|上次|曾經).{0,20}(?:圖|圖片|截圖|照片)|(?:貼過|傳過|分享過).{0,20}(?:圖|圖片|截圖|照片)|(?:圖|圖片|截圖|照片).{0,20}(?:貼過|傳過|分享過)/.test(text);
  const selections = [
    ['search_news_inbox', /收過|收集|收錄|新聞庫|收件匣|(?:之前|以前|過去|我們|聊天室|舊).{0,20}新聞/, /(?:收過|收集|收錄)\s*([^，。？！\n,!?]*)/],
    ['search_conversation_log', imageRecall ? /聊過|討論過|對話紀錄|聊天紀錄|ConversationLog|貼過|傳過|分享過/i
      : /聊過|討論過|對話紀錄|聊天紀錄|ConversationLog/i, /(?:聊過|討論過|貼過|傳過|分享過)\s*([^，。？！\n,!?]*)/],
    ['get_topic_highlights', /畫(?:過)?(?:的)?重點|人工重點|(?:之前|以前|過去|我們|聊天室|保存|儲存).{0,20}重點/, null],
    ['get_weekly_memory', /週記憶|封存|上週|前週/, null]
  ];
  selections.forEach(function(selection) {
    if (!selection[1].test(text)) return;
    const args = selection[0] === 'get_weekly_memory' ? { limit: 5 } : { days: 30, limit: 5 };
    const match = selection[2] && text.match(selection[2]);
    // ponytail: 只取明確的字面主題；指圖／相關資料改讀 bounded candidates，語意索引留待 v1.15.2。
    const query = match ? match[1].split(/或|以及|另外|順便|也看看|並且/)[0]
      .replace(/^[「『"`\s]+|[」』"`\s]+$/g, '').replace(/(?:的)?新聞$/, '').trim() : '';
    if (query && !/這|那|相關|什麼|哪些|有沒有|嗎|呢/.test(query) && query.length <= 200) args.query = query;
    if (selection[0] === 'search_conversation_log' && imageRecall) {
      args.provenance = 'image_derived';
      const latin = text.match(/[A-Za-z][A-Za-z0-9-]{2,}/);
      args.query = latin ? latin[0] : (query.replace(/^(?:一張|那張|這張)\s*/, '').replace(/(?:那張|這張)?(?:梗圖|圖片|截圖|照片|圖)$/, '').trim() || undefined);
      if (!args.query) delete args.query;
    }
    required.push({ name: selection[0], arguments: args });
  });
  if (imageRecall && !required.some(function(item) { return item.name === 'search_conversation_log'; })) {
    required.push({ name: 'search_conversation_log', arguments: { days: 30, limit: 5, provenance: 'image_derived' } });
  }
  const urls = extractUrls(text);
  if (urls.length || /https?:\/\/|網址|連結/i.test(text)) {
    required.push({ name: 'read_url', arguments: { url: urls.length === 1 ? urls[0] : '' } });
  }
  return required;
}

// ======================================================
// 只讀工具執行與資料投影
// ======================================================

function runAiReadOnlyTool_(call, trustedContext) {
  if (!trustedContext || typeof trustedContext.conversationId !== 'string' || !trustedContext.conversationId.trim()) {
    throw createAiConfigurationError_('Research requires a trusted conversation scope.');
  }
  const args = call.arguments;
  const scope = trustedContext.conversationId;
  const limit = args.limit || 5;
  const cutoff = Date.now() - (args.days || 7) * 86400000;
  const query = String(args.query || '').toLowerCase();
  const sources = [];
  try {
    let data;
    switch (call.name) {
      case 'search_news_inbox':
      case 'search_conversation_log':
      case 'get_topic_highlights': {
        const news = call.name === 'search_news_inbox';
        const conversation = call.name === 'search_conversation_log';
        // ponytail: 掃描尾端最多 500/300 列；大量多聊天室資料需要獨立索引時再優化，結果標明有限視窗。
        const rows = readAiScopedSheetRows_(conversation ? SHEET_NAME : news ? NEWS_INBOX_SHEET_NAME : TOPIC_HIGHLIGHTS_SHEET_NAME, scope, news || conversation ? 500 : 300);
        const records = [];
        for (let i = rows.length - 1; i >= 0 && records.length < limit; i--) {
          const row = rows[i];
          const time = new Date(conversation ? row.Timestamp : row.CreatedAt).getTime();
          if (!isFinite(time) || time < cutoff || time > Date.now()) continue;
          if (conversation) {
            // 當次問題已先寫入 Sheet；不能把提問本身或 assistant 回答當成「以前聊過」。
            if (!((row.Role === 'user' && row.Mode !== 'image_input') || (row.Role === 'derived' && row.Mode === 'image_semantic')) ||
              (args.provenance === 'image_derived' && row.Role !== 'derived') ||
              (args.provenance === 'user_text' && row.Role !== 'user') ||
              (trustedContext.excludeMessageId && row.MessageId === trustedContext.excludeMessageId) ||
              (trustedContext.beforeTimestampMs && time >= trustedContext.beforeTimestampMs)) continue;
          } else if (news ? row.Status !== 'ok' : (row.Status && row.Status !== 'active')) continue;
          const text = conversation ? String(row.Text || '') : news ? [row.Title, row.Brief, row.Outline, row.StoryKey].join(' ') : String(row.HighlightText || '');
          if (!text.trim() || (query && text.toLowerCase().indexOf(query) < 0)) continue;
          const record = conversation ? {
            role: row.Role, provenance: row.Role === 'derived' ? 'image_derived' : 'user_text',
            timestamp: new Date(time).toISOString(),
            text: aiToolText_(text.slice(Math.max(0, query ? text.toLowerCase().indexOf(query) - 160 : 0)), 800)
          } : news ? {
            title: aiToolText_(row.Title, 200), brief: aiToolText_(row.Brief, 400), outline: aiToolText_(row.Outline, 800),
            category: aiToolText_(row.Category, 60), storyKey: aiToolText_(row.StoryKey, 120),
            url: typeof row.Url === 'string' && row.Url.length <= 2048 && isSafePublicUrl(row.Url) ? row.Url : '',
            timestamp: new Date(time).toISOString()
          } : { text: aiToolText_(row.HighlightText, 1200), tags: aiToolText_(row.Tags, 160), timestamp: new Date(time).toISOString() };
          // 在收集來源前確認這筆 evidence 確實會送給模型。
          if (JSON.stringify(records.concat([record])).length > AI_TOOL_MAX_RESULT_CHARS - 300) break;
          records.push(record);
          if (record.url) sources.push({ title: record.title, url: record.url });
        }
        data = { records: records, limitedWindow: true, searchMode: query ? 'literal' : 'recent_candidates',
          maxDays: args.days || 7, maxScanRows: news || conversation ? 500 : 300, maxRecords: limit };
        break;
      }
      case 'get_weekly_memory':
        data = { text: aiToolText_(getRecentWeeklySummaryText(scope, limit, args.archiveType, true), AI_TOOL_MAX_RESULT_CHARS - 300), limitedWindow: true };
        break;
      case 'read_url': {
        const web = fetchAndExtractWebPageByReaderLayer_(args.url, {
          deadlineAtMs: trustedContext.deadlineAtMs - AI_TOOL_FINAL_RESERVE_SECONDS * 1000,
          readerTimeoutCapSeconds: 5, readerMinimumRequestSeconds: 1, noAi: true
        });
        if (!web || !web.ok) return { id: call.id, data: { ok: false, errorCode: 'tool_read_failed' }, sources: [] };
        data = { title: aiToolText_(web.title, 200), url: args.url, text: aiToolText_(web.mainText, 3000), truncated: String(web.mainText || '').length > 3000 };
        sources.push({ title: data.title, url: args.url });
        break;
      }
      default: throw createAiToolError_('ai_tool_not_allowed');
    }
    const result = { ok: true, evidenceOnly: true, data: data,
      executionStatus: (Array.isArray(data.records) ? data.records.length : String(data.text || '').trim().length) ? 'SEARCHED_FOUND' : 'SEARCHED_EMPTY' };
    // escaping 可能放大 JSON；超限回固定失敗，不切斷 JSON 或傳出 raw exception。
    if (JSON.stringify(result).length > AI_TOOL_MAX_RESULT_CHARS) return { id: call.id, data: { ok: false, errorCode: 'tool_result_too_large' }, sources: [] };
    return { id: call.id, data: result, sources: sources };
  } catch (error) {
    return { id: call.id, data: { ok: false, errorCode: 'tool_read_failed' }, sources: [] };
  }
}

function aiToolText_(value, maxLength) {
  return redactAiMediaText_(String(value || '')).slice(0, maxLength);
}

/** 不建表、不補欄；先隔離 conversation，再投影至 allowlist。既有 header reader 不帶寫入副作用。 */
function readAiScopedSheetRows_(sheetName, conversationId, maxRows) {
  const sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  const headers = getHeaderMap_(sheet);
  if (!Object.prototype.hasOwnProperty.call(headers, 'ConversationId')) throw createAiToolError_('ai_tool_data_unavailable');
  const requiredHeaders = sheetName === SHEET_NAME ? ['Timestamp', 'Role', 'Mode', 'MessageId', 'Text']
    : sheetName === NEWS_INBOX_SHEET_NAME ? ['CreatedAt', 'Status', 'Title'] : ['CreatedAt', 'HighlightText'];
  if (requiredHeaders.some(function(key) {
    return !Object.prototype.hasOwnProperty.call(headers, key);
  })) throw createAiToolError_('ai_tool_data_unavailable');
  const count = Math.min(sheet.getLastRow() - 1, maxRows);
  const rows = sheet.getRange(sheet.getLastRow() - count + 1, 1, count, sheet.getLastColumn()).getValues();
  return rows.filter(function(row) { return getRowValueByHeader_(row, headers, 'ConversationId') === conversationId; }).map(function(row) {
    const record = {};
    // 僅使用既有欄名，沒有模型可指定的 Sheet、range 或 column。
    ['CreatedAt', 'Status', 'Title', 'Brief', 'Outline', 'StoryKey', 'Category', 'Url', 'HighlightText', 'Tags',
      'Timestamp', 'Role', 'Mode', 'MessageId', 'Text'].forEach(function(key) {
      record[key] = getRowValueByHeader_(row, headers, key);
    });
    return record;
  });
}
