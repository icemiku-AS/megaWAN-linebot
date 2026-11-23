// 本週手動註記。存留使用者文字片段與來源 ID，不把模型判斷當成事件內容或操作授權。

const MAX_WEEKLY_NOTES = 30;
const WEEKLY_NOTE_MAX_LENGTH = 160;
const WEEKLY_NOTES_MAX_BYTES = 8700;
const WEEKLY_NOTES_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const WEEKLY_NOTE_EVICTION_BUCKET_MS = 60 * 60 * 1000;
const WEEKLY_NOTE_REFERENCE_MS = 5 * 60 * 1000;
const WEEKLY_NOTE_ACTION_PATTERN = /(?:幫我|幫忙|協助|請你|請|麻煩|替我|當我)\s*(?:把[^，。！？\n]{1,50}?\s*)?(?:做個?\s*)?(?:註記|記下|記錄一下|記一下|備忘)|(?:註記|記錄|記下|記進|放進|加進|列入)(?:到|進|在|到時候)?\s*(?:本週新聞|這週新聞|週報)|(?:本週新聞|週報).{0,18}(?:當我註記|幫我記|請註記)/;

function getWeeklyNoteOwnWords_(text) {
  return String(text || '').split(/\r?\n/).filter(function(line) { return !/^\s*[>＞]/.test(line); })
    .map(function(line) { return stripLineBotAddress_(line).replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/g, '引用文字'); });
}

function hasWeeklyNoteAction_(text) {
  return getWeeklyNoteOwnWords_(text).some(function(ownWords) {
    return !/(?:不用|不需要|先別|不要|不必|別)(?:再|幫我|先)?\s*(?:註記|記錄|記下|記進|記一下)/.test(ownWords) &&
      !/^(?:我想查|幫我查|請查|查一下|搜尋|上網查).{0,25}(?:註記|備忘)/.test(ownWords) &&
      WEEKLY_NOTE_ACTION_PATTERN.test(ownWords);
  });
}

function hasWeeklyNoteDestination_(text) {
  return getWeeklyNoteOwnWords_(text).some(function(line) {
    for (const target of line.matchAll(/(?:本|這)[週周](?:的)?新聞|[週周]報(?!告|名|表)/g)) {
      const before = line.slice(0, target.index).trimEnd();
      const after = line.slice(target.index + target[0].length).trimStart();
      if (/(?:記(?:進|到|在)|註記(?:到|進|在)|放(?:進|到)|加進|寫進|列入|收進|整理到|當作|作為)$/.test(before) ||
          /註記$/.test(before) && /^(?:[：:，,。！？!?]|一下|吧|嗎|$)/.test(after) ||
          /^(?:時(?:候)?|用|的?(?:素材|話題|主題)|(?:可以|想|要|打算|來)?(?:聊|講|談|提|註記|記下))/.test(after) ||
          /(?:^|[。！？!?，,；;])\s*(?:到時候|這次|下次)?$/.test(before) && /^(?:[，,。；;]|$)/.test(after)) return true;
    }
    return false;
  });
}

function isWeeklyNoteRequest_(text, context) {
  if (!hasWeeklyNoteAction_(text)) return false;
  if (hasWeeklyNoteDestination_(text)) return true;
  if (!context || !context.currentUserId) return false;
  return (context.ambientContext || []).some(function(item) {
    return item.role === 'user' && item.userId === context.currentUserId &&
      item.timestampMs < context.beforeTimestampMs && context.beforeTimestampMs - item.timestampMs <= WEEKLY_NOTE_REFERENCE_MS &&
      hasWeeklyNoteDestination_(item.text);
  });
}

function isWeeklyNoteAdditionalQuestion_(text) {
  const words = stripLineBotAddress_(text);
  return /[？?][。！!]*$/.test(text) ||
    /^(?:你(?:覺得|怎麼看)|為什麼|怎麼|會不會|有沒有|是不是|請問|這會不會|這(?:會|對).{0,24}(?:有什麼|造成什麼|怎樣|如何))/.test(words) ||
    /^(?:查|找|比對|確認|看看)/.test(stripLineResearchLead_(words)) && getAiInternalResearchKinds_(words).length > 0;
}

function getWeeklyNoteResearchIntent_(text) {
  // 只有本次明確交辦的附帶問題會送進研究判定；註記附原帖只提供素材。
  const urls = extractUrls(text);
  const requests = getLineRequestClauses_(text).filter(function(clause) {
    return !/^[>＞]/.test(clause) && !hasWeeklyNoteAction_(clause) &&
      (isWeeklyNoteAdditionalQuestion_(clause) || isExplicitWebSearchRequest_(clause) ||
        isLineUrlResearchRequest_(clause, true, urls.length > 0));
  });
  const requestText = requests.join('\n');
  const url = isLineUrlResearchRequest_(requestText, true, urls.length > 0);
  return { search: isExplicitWebSearchRequest_(requestText), url: url,
    question: url ? requestText + '\n' + urls.join('\n') : requestText };
}

function isWeeklyNoteNoise_(text) {
  const compact = text.replace(/[\s\p{P}\p{S}]+/gu, '');
  return !compact || /^(?:[wｗ]+|笑死|OP|OK|1|嗯+|好|哈+|喔+|哦+)$/i.test(compact);
}

function extractWeeklyNoteText_(rawText, allowDescriptiveText) {
  const tagged = isWeeklyNoteRequest_(rawText);
  const source = redactAiMediaText_(rawText).split(/\r?\n/).map(stripUrlsForWeeklyEditorial_).join('\n');
  const pieces = source.replace(/(?:[，,]\s*)?(?:另外|順便|同時|並且|(?:並|再|也)(?=幫我|請|查|讀|摘要|整理))[，,\t ]*/g, '\n')
    .replace(/[，,]\s*(?=(?:你覺得|這(?:會|對)|那(?:會|對)|請問|怎麼|為什麼)[^。！？!?]*[？?])/g, '\n')
    .match(/[^；;。！？!?\r\n]+[。！？!?]*/g) || [];
  return pieces.map(function(piece) {
    let text = stripLineBotAddress_(piece.trim().replace(/^[\s・•\-]+|^\d+[.)、]\s*/g, ''));
    const action = WEEKLY_NOTE_ACTION_PATTERN.exec(text);
    if (action) {
      const suffix = text.slice(action.index + action[0].length).match(/^[^：:，,。！？]{0,14}[：:，,]\s*(.+)$/);
      const prefix = text.slice(0, action.index).match(/^(.+?)[，,。！!？?]\s*(?:到時候\s*)?$/);
      const object = text.match(/(?:幫我|幫忙|協助|請你|請|麻煩|替我)\s*把\s*(.{4,120}?)\s*(?:註記|記下|記錄|記進|放進|加進|列入)/);
      text = suffix ? suffix[1] : prefix ? prefix[1] : object ? object[1] : '';
    } else if (isExplicitWebSearchRequest_(text) ||
        isLineUrlResearchClause_(text, false) && !/^[#>＞]/.test(text)) {
      return '';
    }
    text = stripUrlsForWeeklyEditorial_(text).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim();
    if (text.length < 5 || isWeeklyNoteNoise_(text) || isWeeklyNoteAdditionalQuestion_(text) ||
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
  const quote = context.textQuote;
  const refersToQuote = event.message.quotedMessageId &&
    /(?:引用|回覆)(?:的)?(?:這|那)(?:一)?(?:句|則|篇)|(?:上面|上方|上頭)(?:的)?(?:這|那)?(?:一)?(?:句|則|篇)|(?:這|那)則引用|引用原文|原(?:始)?訊息/.test(text);
  if (refersToQuote) return quote && quote.status === 'text_found' && !quote.truncated ? make(quote.text, quote.messageId, true) : [];
  const own = make(text, event.message.id, true);
  if (own.length) return own;
  if (event.message.quotedMessageId) {
    return quote && quote.status === 'text_found' && !quote.truncated ? make(quote.text, quote.messageId, true) : [];
  }

  // 模糊指稱只接最近的同一發言者，避免把別人插話或小浣的回覆收成事件。
  if (!context.currentUserId) return [];
  const before = context.beforeTimestampMs;
  const previous = (context.ambientContext || []).slice().reverse().find(function(item) {
    if (item.role !== 'user' || before - item.timestampMs > WEEKLY_NOTE_REFERENCE_MS) return false;
    const textWithoutUrl = stripUrlsForWeeklyEditorial_(item.text.replace(/^(?:#小浣|@小浣)\s*/, ''));
    return !isWeeklyNoteNoise_(textWithoutUrl) &&
      (!hasWeeklyNoteAction_(item.text) || make(item.text, item.messageId, true).length > 0);
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
  const clearedAtMs = Number(state.clearedAtMs) || 0;
  const isInWindow = function(at) {
    return Number.isSafeInteger(at) && at > clearedAtMs && at >= now - WEEKLY_NOTES_WINDOW_MS && at <= now;
  };
  const buckets = Array.isArray(state.evictions) ? state.evictions : [];
  const active = {
    clearedAtMs: clearedAtMs,
    items: state.items.filter(function(item) {
      return item && typeof item.text === 'string' && item.text.trim() && item.text.length <= WEEKLY_NOTE_MAX_LENGTH &&
        isInWindow(item.at);
    }),
    evictions: buckets.filter(function(bucket) {
      return Array.isArray(bucket) && isInWindow(bucket[0]) && Number.isSafeInteger(bucket[1]) && bucket[1] > 0;
    })
  };
  if (prune && (state.items.length !== active.items.length || buckets.length !== active.evictions.length)) {
    try { props.setProperty(key, JSON.stringify(active)); }
    catch (ignore) { console.warn('WEEKLY_NOTE_PRUNE_FAILED'); }
  }
  return active;
}

function getRecentWeeklyNotesSnapshot_(conversationId) {
  const key = getWeeklyNotesKey_(conversationId);
  const result = withDataMutationLock_(function() {
    const state = readWeeklyNotesState_(PropertiesService.getScriptProperties(), key, Date.now(), true);
    const evictedCount = state.evictions.reduce(function(total, bucket) { return total + bucket[1]; }, 0);
    return { items: state.items, clearedAtMs: state.clearedAtMs, evictedCount: evictedCount };
  }, 500);
  if (result.status === 'busy') throw new Error('Weekly notes read is busy.');
  return result;
}

function getRecentWeeklyNotes_(conversationId) {
  return getRecentWeeklyNotesSnapshot_(conversationId).items;
}

function isWeeklyNotesBoundaryCurrent_(conversationId, clearedAtMs) {
  try {
    return withDataMutationLock_(function() {
      const state = readWeeklyNotesState_(PropertiesService.getScriptProperties(), getWeeklyNotesKey_(conversationId), Date.now());
      return { matches: state.clearedAtMs === clearedAtMs };
    }, 250).matches === true;
  } catch (ignore) { return false; }
}

function normalizeWeeklyNoteKey_(text) {
  const plain = text.normalize('NFKC').toLowerCase().replace(/\u2212/g, '-').replace(/\s+/g, '');
  return plain.replace(/[\p{P}\p{S}]/gu, function(symbol, index) {
    const next = plain.slice(index + 1, index + 3);
    if (symbol === '.' && /^\d/.test(next) || /[+-]/.test(symbol) && /^\.?\d/.test(next) ||
        symbol === '%' && /\d/.test(plain.charAt(index - 1))) return symbol;
    return '';
  });
}

function recordWeeklyNoteEviction_(buckets, at) {
  // 以來源註記時間精確到期。大量不同時間戳才合併同一小時，維持 property 容量上限。
  const exact = buckets.find(function(entry) { return entry[0] === at; });
  if (exact) { exact[1]++; return; }
  buckets.push([at, 1]);
  if (buckets.length <= WEEKLY_NOTES_WINDOW_MS / WEEKLY_NOTE_EVICTION_BUCKET_MS + 1) return;
  const hourly = new Map();
  buckets.forEach(function(entry) {
    const hour = Math.floor(entry[0] / WEEKLY_NOTE_EVICTION_BUCKET_MS);
    const bucket = hourly.get(hour);
    if (bucket) {
      bucket[0] = Math.max(bucket[0], entry[0]);
      bucket[1] += entry[1];
    } else {
      hourly.set(hour, entry);
    }
  });
  buckets.splice(0, buckets.length, ...hourly.values());
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
      state.items = state.items.concat(added);
      let serialized = JSON.stringify(state);
      while (state.items.length && (state.items.length > MAX_WEEKLY_NOTES ||
          Utilities.newBlob(serialized).getBytes().length > WEEKLY_NOTES_MAX_BYTES)) {
        recordWeeklyNoteEviction_(state.evictions, state.items.shift().at);
        serialized = JSON.stringify(state);
      }
      if (added.length) props.setProperty(key, serialized);
      return { status: 'ok', clearedAtMs: state.clearedAtMs,
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

function formatWeeklyManualNotesBlock_(notes, notice, evictedCount) {
  const items = notes || [];
  if (!items.length && !evictedCount) return notice || '';
  const lines = ['本週手動註記'];
  let length = lines[0].length;
  for (const item of items.slice().reverse()) {
    const line = '・' + item.text;
    // 留出中性開場、換行與省略數空間，整個區塊保持在一個 LINE bubble 的容量內。
    if (length + line.length + 1 > LINE_TEXT_MESSAGE_MAX_LENGTH - 500) break;
    lines.push(line);
    length += line.length + 1;
  }
  const omitted = items.length - lines.length + 1;
  if (omitted > 0) lines.push('另有 ' + omitted + ' 筆手動註記因篇幅省略。');
  if (evictedCount > 0) lines.push('另有 ' + evictedCount + ' 筆手動註記因容量上限省略。');
  return lines.join('\n');
}
