// ======================================================
// 06_Memory.gs
// Memory／Shared foundation：使用 CacheService 保存同一聊天室最近幾輪 user / assistant 對話。
//
// 小浣 LINE Bot v1.13.1 Source Layout & File Ordering Edition
//
// 設計與 contract：
// 1. 主要 caller 是一般聊天與 AiService memory orchestration；conversationId 是隔離邊界。
// 2. 本檔只管理短期 history 的讀寫、修剪與格式，不選 provider、不組 Prompt、不處理長期 Sheet 封存。
// 3. Cache key 與 history message 結構屬相容性 contract，不能因檔案排序調整。
// 4. 函式名稱後綴底線代表內部 helper，但仍位於 GAS 全域命名空間。
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
