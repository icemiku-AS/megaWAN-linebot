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

    return history.filter(function(message) {
      return message &&
             (message.role === 'user' || message.role === 'assistant') &&
             typeof message.content === 'string';
    });

  } catch (error) {
    console.error('Parse history error:', error);
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
  });

  const maxMessages = MAX_HISTORY_PAIRS * 2;

  if (validHistory.length <= maxMessages) {
    return validHistory;
  }

  return validHistory.slice(validHistory.length - maxMessages);
}
