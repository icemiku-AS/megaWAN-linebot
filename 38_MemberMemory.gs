// 個人記憶只用目前聊天室及 LINE 發言者身分定址。內容由本人明確設定，模型沒有寫入權。

const MEMBER_MEMORY_HEADERS = ['ConversationId', 'UserId', 'Nickname', 'Notes', 'UpdatedAt'];
const MEMBER_MEMORY_CACHE_TTL_SECONDS = 300;
const MEMBER_MEMORY_MAX_NOTES = 5;

function ensureMemberMemorySheet_() {
  return ensureSheetWithHeaders_(MEMBER_MEMORY_SHEET_NAME, MEMBER_MEMORY_HEADERS);
}

function getMemberMemoryCacheKey_(conversationId) {
  return 'MEMBER_MEMORY_' + computeSha256Text_(conversationId);
}

function invalidateMemberMemoryCache_(conversationId) {
  if (isValidLineConversationId_(conversationId)) CacheService.getScriptCache().remove(getMemberMemoryCacheKey_(conversationId));
}

function isValidMemberMemoryUserId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) && !/^(?:undefined|null)$/.test(id);
}

function cleanMemberMemoryText_(value, limit) {
  if (typeof value === 'number' || typeof value === 'boolean') value = String(value);
  if (typeof value !== 'string') return '';
  const text = redactAiMediaText_(value.slice(0, getLineMessageSafeSliceIndex_(value, 1024)))
    .replace(/U[0-9a-f]{32}(?![0-9a-f])/gi, '').replace(/[\p{Cc}\p{Cs}\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, limit).join('').trimEnd();
}

function projectMemberMemory_(userId, nickname, notes) {
  const entries = Array.isArray(notes) ? notes : typeof notes === 'string' ? notes.slice(0, 4096).split(/\r?\n/) : [];
  const unique = new Set(entries.map(function(note) { return cleanMemberMemoryText_(note, 80); }).filter(Boolean));
  return { userId: userId, nickname: cleanMemberMemoryText_(nickname, 24), notes: Array.from(unique).slice(-MEMBER_MEMORY_MAX_NOTES) };
}

function readMemberMemoryRows_(sheet, conversationId) {
  const headers = Object.create(null);
  const records = [];
  if (!sheet || !sheet.getLastRow()) return { headers: headers, records: records };
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function(value, index) {
    const header = String(value || '').trim();
    if (!MEMBER_MEMORY_HEADERS.includes(header)) return;
    if (headers[header]) throw new Error('Duplicate member memory header.');
    headers[header] = index + 1;
  });
  if (MEMBER_MEMORY_HEADERS.some(function(key) { return !headers[key]; })) throw new Error('Missing member memory header.');
  const count = sheet.getLastRow() - 1;
  if (!count) return { headers: headers, records: records };
  const width = Math.max.apply(null, Object.values(headers));
  sheet.getRange(2, 1, count, width).getValues().forEach(function(row, index) {
    const get = function(name) { return getRowValueByHeader_(row, headers, name); };
    const id = get('UserId');
    if (get('ConversationId') !== conversationId || !isValidMemberMemoryUserId_(id)) return;
    records.push({ rowNumber: index + 2, member: projectMemberMemory_(id, get('Nickname'), get('Notes')) });
  });
  return { headers: headers, records: records };
}

function getMemberMemories_(conversationId, deadline) {
  if (!isValidLineConversationId_(conversationId)) return [];
  const cache = CacheService.getScriptCache();
  const key = getMemberMemoryCacheKey_(conversationId);
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  // 選用資料在回覆預算吃緊時只接受快取命中，不再做 Sheet I/O。
  if (deadline && deadline - Date.now() < 15000) return [];
  const sheet = getSpreadsheet_().getSheetByName(MEMBER_MEMORY_SHEET_NAME);
  if (!sheet) return [];
  const result = withDataMutationLock_(function() {
    const rechecked = cache.get(key);
    if (rechecked) return { members: JSON.parse(rechecked) };
    const members = new Map();
    readMemberMemoryRows_(sheet, conversationId).records.forEach(function(row) {
      members.set(row.member.userId, row.member);
    });
    const projected = Array.from(members.values()).filter(function(member) { return member.nickname || member.notes.length; });
    // 與寫入共用短鎖，避免讀取較早的內容後又蓋回剛失效的快取。
    const serialized = JSON.stringify(projected);
    if (Utilities.newBlob(serialized).getBytes().length <= 90000) cache.put(key, serialized, MEMBER_MEMORY_CACHE_TTL_SECONDS);
    return { members: projected };
  }, 250);
  if (!result.members) throw new Error('Member memory read is busy.');
  return result.members;
}

function getLineMemberMemoryRequest_(text, message, explicitlyAddressed) {
  let words = String(text || '');
  const mentions = message.mention && message.mention.mentionees;
  // 依 LINE 原生標記移除自稱 mention，即使顯示名稱改過也認得。
  if (Array.isArray(mentions)) {
    mentions.filter(function(mention) {
      return mention && mention.isSelf === true && Number.isInteger(mention.index) && mention.index >= 0 &&
        Number.isInteger(mention.length) && mention.length > 0 && mention.index + mention.length <= words.length;
    }).sort(function(a, b) { return b.index - a.index; }).forEach(function(mention) {
      words = words.slice(0, mention.index) + ' ' + words.slice(mention.index + mention.length);
    });
  }
  words = words.replace(/#小浣/g, ' ').trim();
  if (explicitlyAddressed) words = words.replace(/^@(?:小浣|MEGA浣)[，,、：:\s]*/i, '');
  const address = /^(?:(?:呼叫|欸)\s*)?(?:小浣|MEGA浣)[，,、：:\s]*(?=(?:請你?|麻煩你?)?\s*(?:叫我|記住我|你記得我|忘了我))/i.exec(words);
  if (address) words = words.slice(address[0].length);
  else if (!explicitlyAddressed && !/^#(?:我的記憶|忘記我)(?:$|\s|[。！？!?，,；;])/.test(words)) return null;
  words = words.replace(/^[，,、：:\s]*(?:請你?|麻煩你?)?\s*/, '');
  if (!/^(?:#我的記憶|#忘記我|你(?:還)?記得我|忘了我|叫我|記住\s*我)/.test(words)) return null;

  let end = words.length;
  let question = '';
  const hasUrl = shouldUseWebReading(words);
  for (const separator of words.matchAll(/[，,。！？!?；;\r\n]/g)) {
    const tail = words.slice(separator.index + 1).trim().replace(/^(?:另外|順便|同時|還有|以及)[，,：:\s]*/, '');
    const lead = tail.split(/[，,。\r\n]/, 1)[0];
    const separateRequest = lead && !/^(?:可以|行|好|能|行不行)(?:嗎|么)?[？?！!]*$/.test(lead) &&
      (isWeeklyNoteAdditionalQuestion_(lead) || isExplicitWebSearchRequest_(lead) ||
        isLineUrlResearchRequest_(lead, true, hasUrl) || /^(?:請|麻煩|幫我|你(?:能|可以))/.test(lead));
    if (!separateRequest && /^[，,]$/.test(separator[0])) continue;
    end = separator.index;
    if (separateRequest) question = tail;
    break;
  }
  const instruction = words.slice(0, end).trim().replace(/(?:可以嗎|行不行|[～~]+)$/, '').trimEnd();
  if (/^(?:#我的記憶|你(?:還)?記得我什[麼么](?:嗎|呢)?)$/.test(instruction)) return { action: 'view', question: question };
  if (/^(?:#忘記我|忘了我(?:吧|啦)?)$/.test(instruction)) return { action: 'forget', question: question };
  const name = /^(?:叫我|記住\s*我的(?:稱呼|名字)是)\s*(.*)$/.exec(instruction);
  if (name) return { action: 'nickname', value: cleanMemberMemoryText_(name[1], 24), question: question };
  const note = /^記住\s*(我.+)$/.exec(instruction);
  return note ? { action: 'note', value: cleanMemberMemoryText_(note[1], 80), question: question } : null;
}

function applyLineMemberMemoryRequest_(conversationId, userId, request, leaseId, deadline) {
  if (!isValidLineConversationId_(conversationId) || !isValidMemberMemoryUserId_(userId)) {
    return '這則訊息沒有可辨識的成員身分，個人記憶沒有處理。';
  }
  try {
    if (request.action === 'view') {
      const member = getMemberMemories_(conversationId).find(function(item) { return item.userId === userId; });
      if (!member) return '這個聊天室還沒有你設定的個人記憶。';
      return ['我在這個聊天室記得你設定的這些：', member.nickname ? '稱呼：' + member.nickname : '']
        .concat(member.notes.map(function(note) { return '・' + note; })).filter(Boolean).join('\n');
    }
    if (request.action !== 'forget' && !request.value) return '再告訴我一句要記的稱呼或偏好就行。';
    const result = withDataMutationLock_(function() {
      const chat = readLineChatState_(getLineChatStateKey_(conversationId));
      if (Date.now() >= deadline || !chat || !chat.lease || chat.lease.id !== leaseId) return {};
      const forget = request.action === 'forget';
      let sheet = getSpreadsheet_().getSheetByName(MEMBER_MEMORY_SHEET_NAME);
      if (!sheet && !forget) sheet = ensureMemberMemorySheet_();
      const data = readMemberMemoryRows_(sheet, conversationId);
      const matches = data.records.filter(function(row) { return row.member.userId === userId; });
      try {
        if (forget) {
          matches.slice().reverse().forEach(function(row) { sheet.deleteRow(row.rowNumber); });
          return { text: matches.length ? '我把你在這個聊天室設定的稱呼和筆記清掉了。' : '這個聊天室沒有你的個人記憶可清。' };
        }
        const row = matches[matches.length - 1];
        const member = row ? row.member : { nickname: '', notes: [] };
        if (request.action === 'nickname') member.nickname = request.value;
        else member.notes = member.notes.filter(function(note) { return note !== request.value; }).concat(request.value).slice(-MEMBER_MEMORY_MAX_NOTES);
        // 起頭的公式符號以 Sheets 的 literal escape 儲存。既有列只更新這次要變動的欄位。
        const literal = function(text) { return /^[=+\-@']/.test(text) ? "'" + text : text; };
        const values = { ConversationId: conversationId, UserId: literal(userId), Nickname: literal(member.nickname),
          Notes: literal(member.notes.join('\n')), UpdatedAt: new Date() };
        if (row) {
          const field = request.action === 'nickname' ? 'Nickname' : 'Notes';
          setCellByHeader_(sheet, row.rowNumber, data.headers, field, values[field]);
          setCellByHeader_(sheet, row.rowNumber, data.headers, 'UpdatedAt', values.UpdatedAt);
        } else appendRowByHeaders_(sheet, values);
        return { text: request.action === 'nickname' ? '下次在這裡就叫你「' + member.nickname + '」。'
          : '這個聊天室的個人筆記放好啦：' + request.value };
      } finally {
        try { SpreadsheetApp.flush(); } finally { invalidateMemberMemoryCache_(conversationId); }
      }
    }, 500);
    if (result.text) return result.text;
  } catch (ignore) { /* Sheet 或鎖失敗時不聲稱已完成。 */ }
  return '這次個人記憶沒能確認完成，晚點再試一下。';
}
