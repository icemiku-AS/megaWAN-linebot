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

/** 舊陣列快取在第一次讀取快照時原樣轉入新世代。 */
function readConversationMemory_(conversationId) {
  const raw = CacheService.getScriptCache().get(getHistoryCacheKey(conversationId));
  if (!raw) return { generation: '', history: [] };
  try {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) return { generation: '', history: trimHistory(saved) };
    if (saved && typeof saved.generation === 'string' && saved.generation && Array.isArray(saved.history)) {
      return { generation: saved.generation, history: trimHistory(saved.history) };
    }
  } catch (error) {
    console.error('Parse history error');
  }
  return { generation: '', history: [] };
}

function writeConversationMemoryLocked_(conversationId, generation, history) {
  CacheService.getScriptCache().put(getHistoryCacheKey(conversationId),
    JSON.stringify({ generation: generation, history: trimHistory(history) }), MEMORY_TTL_SECONDS);
}

function getConversationHistory(conversationId) {
  return readConversationMemory_(conversationId).history;
}

function saveConversationHistory(conversationId, history) {
  const result = withDataMutationLock_(function() {
    writeConversationMemoryLocked_(conversationId, Utilities.getUuid(), history);
    return { status: 'saved' };
  });
  if (result.status === 'busy') throw createAiExecutionBudgetError_('Conversation memory lock is busy.');
}

function clearConversationHistoryLocked_(conversationId) {
  writeConversationMemoryLocked_(conversationId, Utilities.getUuid(), []);
}

function clearConversationHistory(conversationId) {
  const result = withDataMutationLock_(function() {
    clearConversationHistoryLocked_(conversationId);
    return { status: 'cleared' };
  });
  if (result.status === 'busy') throw createAiExecutionBudgetError_('Conversation memory lock is busy.');
}

function snapshotConversationMemory_(conversationId, deadlineAtMs) {
  const remaining = Number(deadlineAtMs) > 0 ? deadlineAtMs - Date.now() : 1000;
  if (remaining <= 0) return { status: 'busy' };
  return withDataMutationLock_(function() {
    const memory = readConversationMemory_(conversationId);
    if (!memory.generation) {
      memory.generation = Utilities.getUuid();
      writeConversationMemoryLocked_(conversationId, memory.generation, memory.history);
    }
    return { generation: memory.generation, history: memory.history };
  }, Math.min(1000, remaining));
}

function commitConversationTurn_(conversationId, generation, turn, deadlineAtMs) {
  const remaining = Number(deadlineAtMs) > 0 ? deadlineAtMs - Date.now() : 1000;
  if (remaining <= 0) return;
  withDataMutationLock_(function() {
    const latest = readConversationMemory_(conversationId);
    // 清理或 cache 已失效時保守捨棄；同世代以完成順序接上最新快取。
    if (latest.generation === generation) {
      writeConversationMemoryLocked_(conversationId, generation, latest.history.concat(turn));
    }
  }, Math.min(1000, remaining));
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
