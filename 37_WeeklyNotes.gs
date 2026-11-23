// 本週手動註記。存留使用者文字片段與來源 ID，不把模型判斷當成事件內容或操作授權。

const MAX_WEEKLY_NOTES = 30;
const WEEKLY_NOTE_MAX_LENGTH = 160;
const WEEKLY_NOTES_MAX_BYTES = 8700;
const WEEKLY_NOTES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKLY_NOTE_REFERENCE_MS = 5 * 60 * 1000;
const WEEKLY_NOTE_ACTION_PATTERN = /(?:幫我|幫忙|協助|請你|請|麻煩|替我|當我)\s*(?:把[^，。！？\n]{1,50}?\s*)?(?:做個?\s*)?(?:註記|記下|記錄一下|記一下|備忘)|(?:註記|記錄|記下|記進|放進|加進|列入)(?:到|進|在|到時候)?\s*(?:本週新聞|這週新聞|週報)|(?:本週新聞|週報).{0,18}(?:當我註記|幫我記|請註記)/;

function isWeeklyNoteRequest_(text) {
  return String(text || '').split(/\r?\n/).some(function(line) {
    if (/^\s*[>＞]/.test(line)) return false;
    const ownWords = line.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, '引用文字');
    return !/(?:不用|不需要|先別|不要|不必|別)(?:再|幫我|先)?\s*(?:註記|記錄|記下|記進|記一下)/.test(ownWords) &&
      !/^(?:#小浣\s*)?(?:我想查|幫我查|請查|查一下|搜尋|上網查).{0,25}(?:註記|備忘)/.test(ownWords) &&
      WEEKLY_NOTE_ACTION_PATTERN.test(ownWords);
  });
}

function getWeeklyNoteResearchIntent_(text) {
  // 單純附原帖或在事件內文提到搜尋功能，不等於同時交辦研究。
  const clauses = text.split(/\r?\n/).map(stripUrlsForWeeklyEditorial_).join('\n').replace(/[#@]小浣/g, '')
    .split(/[，,。；;！？!?\n]|順便|另外|同時|並且|(?:並|再|也)(?=請|幫我|上網|聯網|閱讀|讀取|確認)/);
  const requestLead = /^(?:(?:也|再|先|請問|請你?|麻煩你?|幫我|幫忙|可以|能否|可否)\s*)*/;
  const requests = clauses.map(function(clause) { return clause.trim(); });
  const search = isExplicitWebSearchRequest_(text) && requests.some(function(request) {
    return /^(?:上網|聯網|網路|網上|外部|查|找|搜尋|搜索)/.test(request.replace(requestLead, '')) &&
      isExplicitWebSearchRequest_(request);
  });
  const url = shouldUseWebReading(text) && requests.some(function(request) {
    const action = request.replace(requestLead, '');
    return /^(?:讀取|讀一下|閱讀|看一下|看看|解讀|摘要|比對|(?:讀|看|整理(?:一下)?)\s*(?:這篇|這則|原文|原帖|網址|連結|重點)|(?:讀|看)$)/.test(action) ||
      /^(?:(?:確認|查)?(?:這篇|這則|連結|網址).{0,12}(?:收過|重複|重點|說了什麼)|(?:確認(?:一下)?|查)?(?:是否|有沒有)收過)/.test(action);
  });
  return { search: search, url: url };
}

function isWeeklyNoteNoise_(text) {
  const compact = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  return !compact || /^(?:[wｗ]+|笑死|OP|OK|1|嗯+|好|哈+|喔+|哦+)$/i.test(compact);
}

function extractWeeklyNoteText_(rawText, allowDescriptiveText) {
  const tagged = isWeeklyNoteRequest_(rawText);
  const pieces = redactAiMediaText_(rawText).split(/\r?\n|[；;]/);
  return pieces.map(function(piece) {
    let text = piece.trim().replace(/^[\s・•\-]+|^\d+[.)、]\s*/g, '').replace(/(?:#小浣|@小浣|^(?:小浣|MEGA浣)[，,：:\s]+)\s*/gi, '').trim();
    const action = WEEKLY_NOTE_ACTION_PATTERN.exec(text);
    if (action) {
      const suffix = text.slice(action.index + action[0].length).match(/^[^：:，,。！？]{0,14}[：:，,]\s*(.+)$/);
      const prefix = text.slice(0, action.index).match(/^(.+?)[，,。！!？?]\s*(?:到時候\s*)?$/);
      const object = text.match(/(?:幫我|幫忙|協助|請你|請|麻煩|替我)\s*把\s*(.{4,120}?)\s*(?:註記|記下|記錄|記進|放進|加進|列入)/);
      text = suffix ? suffix[1] : prefix ? prefix[1] : object ? object[1] : '';
    }
    text = stripUrlsForWeeklyEditorial_(text).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (text.length < 5 || isWeeklyNoteNoise_(text) ||
        /^(?:[#>＞]|沒有|沒新聞|我(?:這裡|這邊)?(?:沒有|沒)|(?:這|那)(?:兩|個|幾|則|件|篇|裡|邊)[^。！？]{0,8}$|(?:最近|本週|這週).{0,12}(?:事件|消息|新聞)[，,、：:\s]*(?:提一下|說一下|分享一下)?$|(?:提|說|看|查|記|註記|補充|分享)一下(?:[。！？…]+)?$)/.test(text)) return '';
    const concrete = /事件|爭議|炎上|流失|停服|關服|伺服器|上市|宣布|發表|發布|推出|上映|上線|更新|故障|延[期後]|漲價|取消|爆發|開唱|演唱|開放|下架|通過|倒閉|server|launch|outage/i.test(text);
    if (!concrete && (!(tagged || allowDescriptiveText) || text.length < 8 ||
        !/[a-z\d]|[，,。]|有了|成為|開始|改為|調整|收到|提供|出現|停止|(?:要|將|已|會|在).{2,}/i.test(text))) return '';
    const bounded = truncateWeeklyEditorialText_(text, WEEKLY_NOTE_MAX_LENGTH);
    return bounded.replace(/^(?:[>＞]+|\*+)\s*/, '');
  }).filter(Boolean);
}

function buildWeeklyNoteCandidates_(event, text, executionContext) {
  const context = executionContext.conversationContext;
  const make = function(rawText, messageId, allowDescriptiveText) {
    return extractWeeklyNoteText_(rawText, allowDescriptiveText).slice(0, MAX_WEEKLY_NOTES).map(function(summary, index) {
      return { text: summary, sourceId: isExactLineMessageId_(messageId) ? messageId : '', index: index };
    });
  };
  const own = make(text, event.message.id);
  if (own.length) return own;
  if (event.message.quotedMessageId) {
    const quote = context.textQuote;
    return quote && quote.status === 'text_found' && !quote.truncated ? make(quote.text, quote.messageId, true) : [];
  }

  // 模糊指稱只接最近的同一發言者，避免把別人插話或小浣的回覆收成事件。
  if (!context.currentUserId) return [];
  const before = context.beforeTimestampMs;
  const previous = (context.ambientContext || []).slice().reverse().find(function(item) {
    if (item.role !== 'user' || before - item.timestampMs > WEEKLY_NOTE_REFERENCE_MS) return false;
    const textWithoutUrl = stripUrlsForWeeklyEditorial_(item.text.replace(/^(?:#小浣|@小浣)\s*/, ''));
    return !isWeeklyNoteNoise_(textWithoutUrl) && (!isWeeklyNoteRequest_(item.text) || make(item.text, item.messageId).length > 0);
  });
  return previous && previous.userId === context.currentUserId ? make(previous.text, previous.messageId, true) : [];
}

function getWeeklyNotesKey_(conversationId) {
  if (!isValidLineConversationId_(conversationId)) throw new Error('Invalid weekly notes scope.');
  return 'WEEKLY_NOTES_' + computeSha256Text_(conversationId);
}

function readWeeklyNotesState_(props, key, now, prune) {
  const state = JSON.parse(props.getProperty(key) || '{"items":[]}');
  if (!state || !Array.isArray(state.items)) throw new Error('Invalid weekly notes state.');
  const active = { clearedAtMs: Number(state.clearedAtMs) || 0, items: state.items.filter(function(item) {
    return item && typeof item.text === 'string' && item.text.trim() && item.text.length <= WEEKLY_NOTE_MAX_LENGTH &&
      Number.isSafeInteger(item.at) && item.at >= now - WEEKLY_NOTES_WINDOW_MS && item.at <= now;
  }) };
  if (prune && state.items.length !== active.items.length) {
    try { props.setProperty(key, JSON.stringify(active)); }
    catch (ignore) { console.warn('WEEKLY_NOTE_PRUNE_FAILED'); }
  }
  return active;
}

function getRecentWeeklyNotes_(conversationId) {
  const key = getWeeklyNotesKey_(conversationId);
  const result = withDataMutationLock_(function() {
    return { items: readWeeklyNotesState_(PropertiesService.getScriptProperties(), key, Date.now(), true).items };
  }, 500);
  if (result.status === 'busy') throw new Error('Weekly notes read is busy.');
  return result.items;
}

function normalizeWeeklyNoteKey_(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function saveLineWeeklyNotes_(event, conversationId, text, executionContext, chatKey, leaseId) {
  try {
    const context = executionContext.conversationContext;
    const candidates = buildWeeklyNoteCandidates_(event, text, executionContext);
    if (!candidates.length) return { status: 'missing' };
    const deadline = executionContext.deadlineAtMs;
    const result = withDataMutationLock_(function() {
      const now = Date.now();
      const chat = readLineChatState_(chatKey);
      if (now >= deadline || !chat || !context.lineChatState ||
          (chat.resetId || '') !== (context.lineChatState.resetId || '') ||
          context.beforeTimestampMs <= (chat.resetAtMs || 0) ||
          leaseId && (!chat.lease || chat.lease.id !== leaseId)) return { status: 'failed' };
      const props = PropertiesService.getScriptProperties();
      const key = getWeeklyNotesKey_(conversationId);
      const state = readWeeklyNotesState_(props, key, now);
      if (context.beforeTimestampMs <= state.clearedAtMs) return { status: 'failed' };
      const existing = [];
      const added = [];
      candidates.forEach(function(candidate) {
        const check = normalizeWeeklyNoteKey_(candidate.text);
        const duplicate = state.items.concat(added).find(function(item) {
          return (candidate.sourceId && item.sourceId === candidate.sourceId && item.index === candidate.index) ||
            normalizeWeeklyNoteKey_(item.text) === check;
        });
        if (duplicate) {
          if (!added.includes(duplicate) && !existing.includes(duplicate)) existing.push(duplicate);
        } else {
          added.push(Object.assign({ at: now }, candidate));
        }
      });
      state.items = state.items.concat(added).slice(-MAX_WEEKLY_NOTES);
      let serialized = JSON.stringify(state);
      while (Utilities.newBlob(serialized).getBytes().length > WEEKLY_NOTES_MAX_BYTES && state.items.length) {
        state.items.shift();
        serialized = JSON.stringify(state);
      }
      if (added.length) props.setProperty(key, serialized);
      return { status: 'ok',
        saved: added.filter(function(item) { return state.items.includes(item); }).map(function(item) { return item.text; }),
        existing: existing.filter(function(item) { return state.items.includes(item); }).map(function(item) { return item.text; }),
        omitted: added.filter(function(item) { return !state.items.includes(item); }).length +
          existing.filter(function(item) { return !state.items.includes(item); }).length };
    }, Math.min(500, Math.max(0, deadline - Date.now())));
    return result.status === 'busy' ? { status: 'failed' } : result;
  } catch (ignore) { return { status: 'failed' }; }
}

function clearWeeklyNotesLocked_(conversationId) {
  const props = PropertiesService.getScriptProperties();
  const key = getWeeklyNotesKey_(conversationId);
  const now = Date.now();
  const count = readWeeklyNotesState_(props, key, now).items.length;
  // 保留空的清理時間界線，防止清理前已開始的喚醒分類寫回。
  props.setProperty(key, JSON.stringify({ clearedAtMs: now, items: [] }));
  return count;
}

function formatWeeklyNoteAcknowledgement_(result) {
  if (result.status === 'missing') return '你想放進本週新聞的是哪件事？補一句事件內容，或回覆原訊息叫我註記。';
  if (result.status !== 'ok') return '這次本週手動註記沒存成功，晚點再叫我一次。';
  const blocks = [];
  if (result.saved.length) blocks.push('加進本週手動註記了\n' + result.saved.map(function(text) { return '・' + text; }).join('\n'));
  if (result.existing.length) blocks.push('本週已經有這幾筆\n' + result.existing.map(function(text) { return '・' + text; }).join('\n'));
  if (result.omitted) blocks.push('另有 ' + result.omitted + ' 筆超過本週註記容量。');
  return blocks.join('\n\n');
}

function formatWeeklyManualNotesBlock_(notes, notice) {
  if (!notes || !notes.length) return notice || '';
  const lines = ['本週手動註記'];
  let length = lines[0].length;
  for (const item of notes.slice().reverse()) {
    const line = '・' + item.text;
    // 留出中性開場、換行與省略數空間，整個區塊保持在一個 LINE bubble 的容量內。
    if (length + line.length + 1 > LINE_TEXT_MESSAGE_MAX_LENGTH - 500) break;
    lines.push(line);
    length += line.length + 1;
  }
  const omitted = notes.length - lines.length + 1;
  if (omitted > 0) lines.push('另有 ' + omitted + ' 筆手動註記因篇幅省略。');
  return lines.join('\n');
}
