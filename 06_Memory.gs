// ======================================================
// 05_Memory.gs
// 短期多輪記憶層。使用 CacheService 保存同一聊天室最近幾輪 user / assistant 對話。
//
// 小浣 LINE Bot v1.9 Service Split Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
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
