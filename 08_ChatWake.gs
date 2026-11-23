// 群組接話資格、LINE 重送去重與送達後的續問視窗。鎖內只操作有界狀態。

const CHAT_WEBHOOK_EVENT_TTL_MS = 20 * 60 * 1000;
const MAX_RECENT_LINE_REPLIES = 8;
const CHAT_EASTER_EGG_STATE_PROPERTY = 'CHAT_EASTER_EGG_STATE';

function getLineChatStateKey_(conversationId) {
  return isValidLineConversationId_(conversationId) ? 'LINE_CHAT_STATE_' + computeSha256Text_(conversationId) : '';
}

function readLineChatState_(key) {
  if (!key) return null;
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(key);
    if (!raw) return {};
    const state = JSON.parse(raw);
    return state && typeof state === 'object' && !Array.isArray(state) ? state : null;
  } catch (ignore) { return null; }
}

function resetLineChatStateLocked_(conversationId) {
  const key = getLineChatStateKey_(conversationId);
  if (!key) return;
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({
    resetId: Utilities.getUuid(), resetAtMs: Date.now()
  }));
}

function claimLineWebhookEvent_(key, eventId) {
  if (!key || typeof eventId !== 'string' || !/^[A-Za-z0-9_-]{1,48}$/.test(eventId)) return 'invalid';
  const receiptKey = key.replace('LINE_CHAT_STATE_', 'LINE_WEBHOOK_EVENTS_');
  try {
    const props = PropertiesService.getScriptProperties();
    const isLive = function(entry) {
      return Array.isArray(entry) && entry[1] > Date.now() - CHAT_WEBHOOK_EVENT_TTL_MS;
    };
    const read = function() { return JSON.parse(props.getProperty(receiptKey) || '[]').filter(isLive); };
    const isDuplicate = function(entries) { return entries.some(function(entry) { return entry[0] === eventId; }); };
    if (isDuplicate(read())) return 'duplicate';
    const claim = function() {
      const entries = read();
      if (isDuplicate(entries)) return { status: 'duplicate' };
      entries.push([eventId, Date.now()]);
      props.setProperty(receiptKey, JSON.stringify(entries.slice(-120)));
      return { status: 'accepted' };
    };
    // tryLock 已含等待，僅在確定未取得鎖、沒有寫入時再試一次。
    const result = withDataMutationLock_(claim, 300);
    return result.status === 'busy' ? withDataMutationLock_(claim, 300).status : result.status;
  } catch (ignore) { return 'busy'; }
}

function isLineBotMention_(message) {
  const mentions = message.mention && message.mention.mentionees;
  return Array.isArray(mentions) && mentions.some(function(target) { return target && target.isSelf === true; });
}

function readChatEasterEggState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(CHAT_EASTER_EGG_STATE_PROPERTY);
  const state = JSON.parse(raw || '{}');
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid chat cooldown state.');
  return state;
}

function isChatEasterEggAvailable_(key, now) {
  if (!ENABLE_CHAT_EASTER_EGG || !key) return false;
  try { return !(readChatEasterEggState_()[key] > now); }
  catch (ignore) { return false; }
}

function getLineChatWakeSignals_(event, key, state, text, quote, weeklyNoteRequested) {
  if (!state) return null;
  const before = Number(event.timestamp) || Date.now();
  const userId = event.source && event.source.userId;
  const replies = Array.isArray(state.replies) ? state.replies : [];
  const followUp = !!userId && replies.some(function(reply) {
    return reply.userId === userId && reply.at <= before && before - reply.at <= CHAT_FOLLOW_UP_WINDOW_MS;
  });
  const quotedId = event.message.quotedMessageId;
  const resetAtMs = state.resetAtMs || 0;
  const quotesBot = isExactLineMessageId_(quotedId) && (quote.reason === 'assistant_message' &&
    quote.sentAtMs <= before && quote.sentAtMs > resetAtMs || replies.some(function(reply) {
      return reply.at <= before && reply.at > resetAtMs && reply.ids.includes(quotedId);
    }));
  const compact = text.replace(/[\s！？!?。，、…~～]+/g, '');
  if (!followUp && !quotesBot && (!compact || /^(?:[wｗ]+|笑死|OP|OK|[+＋]1|哈+|嗯+|喔+|哦+|[\p{P}\p{S}]+)$/iu.test(compact))) return null;

  const named = /小浣|mega浣|浣熊/i.test(text);
  const weeklyNote = weeklyNoteRequested === true || isWeeklyNoteRequest_(text);
  const work = weeklyNote || isExplicitWebSearchRequest_(text) || isLineUrlResearchRequest_(text, false) ||
    /幫我(?:查|找|讀|看|整理|比對|補|記|列|確認|想)|幫忙(?:查|讀|整理|註記)|查證|收過嗎|聊過嗎|記進本週新聞|麻煩.{0,12}(?:找|查|整理|確認)/.test(text);
  const egg = /垃圾|棉花糖|乾脆麵|小熊貓|貍貓|狸貓/.test(text) && isChatEasterEggAvailable_(key, Date.now());
  return named || followUp || quotesBot || work || egg
    ? { named: named, followUp: followUp, quotesBot: quotesBot, work: work, easterEggAvailable: egg, weeklyNote: weeklyNote }
    : null;
}

function reserveLineAutoReply_(key, snapshot, deadline, eventAtMs, quotesBot) {
  if (!snapshot || !key || deadline - Date.now() < 12000) return '';
  try {
    const reserved = withDataMutationLock_(function() {
      const state = readLineChatState_(key);
      const now = Date.now();
      if (!state || (state.resetId || '') !== (snapshot.resetId || '') || now + 12000 > deadline ||
          eventAtMs <= (state.resetAtMs || 0) || state.autoAfterMs > now && !quotesBot ||
          state.lease && state.lease.until > now) return {};
      const id = Utilities.getUuid();
      state.lease = { id: id, until: deadline + LINE_REPLY_TIMEOUT_SECONDS * 1000, quotesBot: quotesBot === true };
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
      return { id: id };
    }, 250);
    return reserved.id || '';
  } catch (ignore) { return ''; }
}

function isDirectLinePlayfulRequest_(text) {
  // 無標點的點名搭配明確短指示也可接話。完整句型排除「小浣吐槽得很好笑」等描述。
  const addressed = /^(?:呼叫\s*)?(?:小浣|MEGA浣)[，,、：:\s]*([^\r\n]+)$/i.exec(String(text || '').trim());
  if (!addressed) return false;
  const request = addressed[1].trim();
  let action = request.replace(/^(?:(?:你|請|麻煩|拜託|幫我|幫忙|快點?|先|也|能不能|可不可以)[，,、：:\s]*)+/, '');
  if (/[嗎？?][。！？!?\s]*$/.test(request)) action = action.replace(/^可以\s*/, '');
  action = action.replace(/[啊呀吧啦嘛喔欸嗎。！？!?~～\s]+$/, '').replace(/\s+/g, '');
  return /^(?:來)?吐[槽嘈糟](?:一[下句])?(?:(?:這|那)(?:句|段|件事)|剛才那句|剛剛那句|我)?(?:一下)?$/.test(action) ||
    /^(?:講|說|來)(?:一?[個則])?冷?笑話(?:給我聽)?$/.test(action);
}

function classifyLineChatWake_(text, signals, ambient, executionContext) {
  // 入口已取得同房處理資格。明確交辦直接回答，仍走原送達、限頻與驗證流程。
  if (isDirectLinePlayfulRequest_(text)) {
    return { shouldReply: true, triggerType: 'direct_call', noteAction: 'none', needsSearch: false };
  }
  const deadline = executionContext.deadlineAtMs;
  const classificationDeadline = Math.min(deadline - 10000, Date.now() + 8000);
  const seconds = Math.floor((classificationDeadline - Date.now()) / 1000);
  if (seconds < 2) return null;
  const speaker = createConversationSpeakerMap_();
  const currentSpeaker = speaker(executionContext.conversationContext.currentUserId);
  const recent = ambient.slice(-4).map(function(item) {
    return { speaker: item.role === 'assistant' ? '小浣' : speaker(item.userId), text: item.text.slice(0, getLineMessageSafeSliceIndex_(item.text, 240)) };
  });
  const result = runAiJsonTask('chat_gatekeeper', JSON.stringify({
    currentSpeaker: currentSpeaker, signals: signals, recent: recent,
    currentMessage: text.slice(0, getLineMessageSafeSliceIndex_(text, 1600))
  }), { executionDeadlineAtMs: classificationDeadline, timeoutCapSeconds: seconds, minimumRequestSeconds: 2, maxModelCalls: 1 });
  if (!result.ok || Date.now() + 10000 > deadline) return null;
  const decision = result.json;
  if (!decision || decision.shouldReply !== true || decision.triggerType === 'ignore') return null;
  const thirdPerson = /(?:小浣|mega浣)(?:背後)?(?:的|最近)?(?:模型|改用|改成|換成|更新了)|(?:我|我們).{0,10}(?:在)?更新(?:了)?(?:小浣|mega浣)/i.test(text);
  if (thirdPerson && !signals.quotesBot && !signals.work && !/小浣[，,：:！!、]|(?:小浣|mega浣)[，,\s]*你/i.test(text)) return null;
  if (decision.triggerType === 'direct_call' && signals.named ||
      decision.triggerType === 'follow_up' && (signals.followUp || signals.quotesBot) ||
      decision.triggerType === 'work_collab' && signals.work ||
      decision.triggerType === 'easter_egg' && signals.easterEggAvailable && !signals.work && !signals.quotesBot) return decision;
  return null;
}

function authorizeLineAutoReply_(key, leaseId, deadline, easterEgg) {
  try {
    return withDataMutationLock_(function() {
      const now = Date.now();
      const state = readLineChatState_(key);
      if (!state || !state.lease || state.lease.id !== leaseId || now >= deadline ||
          state.autoAfterMs > now && !state.lease.quotesBot) return {};
      const props = PropertiesService.getScriptProperties();
      if (easterEgg) {
        if (!ENABLE_CHAT_EASTER_EGG) return {};
        const cooldowns = readChatEasterEggState_();
        if (cooldowns[key] > now) return {};
        Object.keys(cooldowns).forEach(function(name) { if (!(cooldowns[name] > now)) delete cooldowns[name]; });
        // 先保留傳送時間，LINE 回應遺失時也守住六小時上限。
        cooldowns[key] = now + CHAT_EASTER_EGG_COOLDOWN_MS + LINE_REPLY_TIMEOUT_SECONDS * 1000;
        const serialized = JSON.stringify(cooldowns);
        if (serialized.length > 8700) return {};
        props.setProperty(CHAT_EASTER_EGG_STATE_PROPERTY, serialized);
      }
      state.autoAfterMs = Math.max(state.autoAfterMs || 0, now + CHAT_AUTO_REPLY_INTERVAL_MS);
      props.setProperty(key, JSON.stringify(state));
      return { allowed: true };
    }, 250).allowed === true;
  } catch (ignore) { return false; }
}

function finishLineAutoReply_(key, leaseId) {
  try {
    withDataMutationLock_(function() {
      const state = readLineChatState_(key);
      if (!state || !state.lease || state.lease.id !== leaseId) return;
      delete state.lease;
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
    }, 250);
  } catch (ignore) { /* 遺留的接話資格會到期。 */ }
}

function rememberLineReply_(key, snapshot, event, receipt, startsFollowUp, leaseId, easterEgg) {
  if (!key || !snapshot || !receipt.sentAtMs) return;
  const ids = (receipt.messageIds || []).filter(isExactLineMessageId_);
  if (!ids.length && !startsFollowUp && !leaseId) return;
  try {
    withDataMutationLock_(function() {
      const state = readLineChatState_(key);
      if (!state || (state.resetId || '') !== (snapshot.resetId || '') ||
          Number(event.timestamp) > 0 && Number(event.timestamp) <= (state.resetAtMs || 0) ||
          leaseId && (!state.lease || state.lease.id !== leaseId)) return;
      const userId = event.source && event.source.userId;
      const props = PropertiesService.getScriptProperties();
      if (leaseId) state.autoAfterMs = Math.max(state.autoAfterMs || 0, receipt.sentAtMs + CHAT_AUTO_REPLY_INTERVAL_MS);
      const replies = Array.isArray(state.replies) ? state.replies : [];
      replies.push({ at: receipt.sentAtMs,
        userId: startsFollowUp && typeof userId === 'string' && userId.length <= 128 ? userId : '', ids: ids });
      state.replies = replies.filter(function(reply) { return reply.at > Date.now() - AMBIENT_CHAT_WINDOW_MS; })
        .sort(function(a, b) { return b.at - a.at; }).slice(0, MAX_RECENT_LINE_REPLIES);
      props.setProperty(key, JSON.stringify(state));
      if (easterEgg) {
        const cooldowns = readChatEasterEggState_();
        cooldowns[key] = receipt.sentAtMs + CHAT_EASTER_EGG_COOLDOWN_MS;
        props.setProperty(CHAT_EASTER_EGG_STATE_PROPERTY, JSON.stringify(cooldowns));
      }
    }, 250);
  } catch (ignore) { /* 已確認送出時，輔助狀態失敗不重送。 */ }
}
