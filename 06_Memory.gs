// ======================================================
// 06_Memory.gs
// 用途：Memory／Shared foundation：CacheService 短期對話記憶。
//
// 職責與協作：
// 1. 供 AiService 讀寫、修剪同一聊天室最近幾輪 user／assistant 文字。
// 2. 長期封存由 WeeklySummary 存取流程處理；本檔不選 provider 或組功能 Prompt。
//
// 維護注意：
// 1. conversationId、cache key 與 history message 結構是隔離及相容性邊界。
// 2. 只保存允許的文字訊息；圖片編碼、工具回合與 provider 私有狀態不得進入 history。
// ======================================================

// ======================================================
// 短期記憶讀寫與修剪
// ======================================================

function getConversationHistory(conversationId) {
  const cache = CacheService.getScriptCache();
  const key = getHistoryCacheKey(conversationId);
  const raw = cache.get(key);

  if (!raw) {
    return [];
  }

  try {
    const history = JSON.parse(raw);

    if (!Array.isArray(history)) {
      return [];
    }

    return trimHistory(history);

  } catch (error) {
    console.error('Parse history error');
    return [];
  }
}

function saveConversationHistory(conversationId, history) {
  const cache = CacheService.getScriptCache();
  const key = getHistoryCacheKey(conversationId);
  const safeHistory = trimHistory(history);

  cache.put(key, JSON.stringify(safeHistory), MEMORY_TTL_SECONDS);
}

function clearConversationHistory(conversationId) {
  const cache = CacheService.getScriptCache();
  const key = getHistoryCacheKey(conversationId);

  cache.remove(key);
}

function getHistoryCacheKey(conversationId) {
  return 'linebot_history_' + conversationId;
}

function trimHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const validHistory = history.filter(function(message) {
    return message &&
           (message.role === 'user' || message.role === 'assistant') &&
           typeof message.content === 'string' &&
           message.content.trim() !== '';
  }).map(function(message) {
    const safe = { role: message.role, content: message.content };
    if (message.role !== 'user') return safe;
    // 白名單 metadata；引用 evidence、媒體 ID、provider state 不可混進 history。
    if (typeof message.userId === 'string' && message.userId.length <= 128) safe.userId = message.userId;
    if (message.provenance === 'user_text' && isExactLineMessageId_(message.messageId)) {
      safe.messageId = message.messageId; safe.provenance = 'user_text';
    }
    if (TEXT_QUOTE_STATUSES.indexOf(message.quoteStatus) >= 0) safe.quoteStatus = message.quoteStatus;
    if (safe.quoteStatus === 'text_found' && isExactLineMessageId_(message.quotedMessageId)) safe.quotedMessageId = message.quotedMessageId;
    return safe;
  });

  const maxMessages = MAX_HISTORY_PAIRS * 2;

  if (validHistory.length <= maxMessages) {
    return validHistory;
  }

  return validHistory.slice(validHistory.length - maxMessages);
}

/** 同一次請求內共用匿名代稱；未知作者不具有相同身分，也不推定為當前提問者。 */
function createConversationSpeakerMap_() {
  const aliases = Object.create(null);
  let count = 0;
  return function(userId) {
    if (typeof userId !== 'string' || !userId || userId.length > 128) return '未知作者';
    if (!aliases[userId]) aliases[userId] = '成員' + (++count);
    return aliases[userId];
  };
}
