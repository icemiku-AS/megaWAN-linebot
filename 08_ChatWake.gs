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

function isLineQuoteOfDeliveredBot_(event, state, quote, before) {
  if (!state) return false;
  const replies = Array.isArray(state.replies) ? state.replies : [];
  const quotedId = event.message.quotedMessageId;
  const resetAtMs = state.resetAtMs || 0;
  return isExactLineMessageId_(quotedId) && (quote.reason === 'assistant_message' &&
    quote.sentAtMs <= before && quote.sentAtMs > resetAtMs || replies.some(function(reply) {
      return reply.at <= before && reply.at > resetAtMs && reply.ids.includes(quotedId);
    }));
}

function isLineChatClosingNoise_(text) {
  const compact = text.replace(/[^\p{L}\p{N}]+/gu, '');
  return !compact || /^(?:[wｗ]+|笑死(?:了)?|OP|OK(?:ay|啦|了)?|1|哈+|嗯+|喔+|哦+|好+(?:的|喔|哦|啦|吧|呀|啊)?|收到|了解|(?:好)?先這樣(?:喔|哦|啦|吧)?)$/iu.test(compact);
}

function getLineHotChat_(state, eventAtMs, now) {
  const hot = state && state.hotChat;
  return hot && hot.at <= eventAtMs && hot.at > (state.resetAtMs || 0) && now - hot.at <= CHAT_FOLLOW_UP_WINDOW_MS
    ? hot : null;
}

function getLineChatWakeSignals_(event, key, state, text, quote, weeklyNoteRequested) {
  if (!state) return {};
  const now = Date.now();
  const before = Number(event.timestamp) || now;
  const hot = getLineHotChat_(state, before, now);
  const followUpChain = hot ? hot.chain : 0;
  const quotesBot = isLineQuoteOfDeliveredBot_(event, state, quote, before);
  const compact = text.replace(/[^\p{L}\p{N}]+/gu, '');
  const noise = isLineChatClosingNoise_(text);
  const mentions = event.message.mention && event.message.mention.mentionees;
  const otherAction = /^[\/!！＃#]\s*[\p{L}\p{N}_-]/u.test(text) ||
    (Array.isArray(mentions) && mentions.some(function(mention) { return mention && mention.isSelf === false; }));
  const followUp = !!hot && followUpChain < CHAT_MAX_FOLLOW_UP_CHAIN && !noise && !otherAction;
  const signals = { quotesBot: quotesBot, followUp: followUp, followUpChain: followUpChain,
    hot: hot, noise: noise, otherAction: otherAction };
  if (noise || otherAction) return signals;

  const named = /小浣|mega浣|浣熊/i.test(text);
  const weeklyNote = weeklyNoteRequested === true || isWeeklyNoteRequest_(text);
  const work = weeklyNote || isExplicitWebSearchRequest_(text) || isLineUrlResearchRequest_(text, false) ||
    /幫我(?:查|找|讀|看|整理|比對|補|記|列|確認|想)|幫忙(?:查|讀|整理|註記)|查證|收過嗎|聊過嗎|記進本週新聞|麻煩.{0,12}(?:找|查|整理|確認)/.test(text);
  // 省略姓名的短虧句也先看前文，由守門員確認在跟小浣說話。
  const teasing = /^(?:或|也|欸)?(?:太不吵|怎麼(?:還|又)?(?:在)?裝死)[了啦啊欸喔哦呀嘛吧耶]*$/.test(compact);
  const easterEggTerm = teasing || /垃圾|棉花糖|乾脆麵|小熊貓|貍貓|狸貓/.test(text);
  const probeEligible = ENABLE_CHAT_AMBIENT_BANTER && !named && !work && !hot && !quotesBot && !easterEggTerm &&
    Array.from(compact).length >= 6 && !shouldUseWebReading(text);
  const mayInterject = !hot && !work && !quotesBot && (easterEggTerm || probeEligible) && isChatEasterEggAvailable_(key, now);
  return Object.assign(signals, { named: named, teasing: teasing, work: work, weeklyNote: weeklyNote,
    easterEggAvailable: easterEggTerm && mayInterject, ambientBanterAvailable: probeEligible && mayInterject && !(state.ambientProbeAfterMs > now),
    interjectionThrottled: ENABLE_CHAT_EASTER_EGG && !hot && !work && !quotesBot && (easterEggTerm || probeEligible) &&
      (!mayInterject || probeEligible && state.ambientProbeAfterMs > now) });
}

function reserveLineAutoReply_(key, snapshot, deadline, eventAtMs, lane) {
  const minimumMs = lane === 'explicit' ? 1 : 12000;
  if (!snapshot || !key || deadline - Date.now() < minimumMs) return { outcome: 'skipped_budget_or_error' };
  try {
    const reserved = withDataMutationLock_(function() {
      const state = readLineChatState_(key);
      const now = Date.now();
      if (!state || (state.resetId || '') !== (snapshot.resetId || '') || now + minimumMs > deadline ||
          lane !== 'explicit' && eventAtMs <= (state.resetAtMs || 0)) return { outcome: 'skipped_budget_or_error' };
      if (state.lease && state.lease.until > now) return { outcome: 'skipped_lease_busy' };
      if (lane === 'follow_up') {
        const hot = getLineHotChat_(state, eventAtMs, now);
        if (!hot || !snapshot.hotChat || hot.at !== snapshot.hotChat.at) return { outcome: 'skipped_no_signal' };
        if (hot.chain >= CHAT_MAX_FOLLOW_UP_CHAIN) return { outcome: 'skipped_chain_limit' };
        if (eventAtMs < hot.at + CHAT_FOLLOW_UP_INTERVAL_MS) return { outcome: 'skipped_cooldown' };
      } else if (lane === 'auto' && state.autoAfterMs > now) return { outcome: 'skipped_cooldown' };
      const id = Utilities.getUuid();
      state.lease = { id: id, until: deadline + LINE_REPLY_TIMEOUT_SECONDS * 1000, lane: lane };
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
      return { id: id };
    }, 250);
    return reserved.status === 'busy' ? { outcome: 'skipped_lease_busy' } : reserved;
  } catch (ignore) { return { outcome: 'skipped_budget_or_error' }; }
}

function isDirectLinePlayfulRequest_(text) {
  // 無標點的點名搭配明確短指示也可接話。完整句型排除「小浣吐槽得很好笑」等描述。
  const addressed = /^(?:(?:呼叫|欸)\s*)?(?:小浣|MEGA浣)[，,、：:\s]*([\s\S]+)$/i.exec(String(text || '').trim());
  if (!addressed) return false;
  const request = addressed[1].split(/[\r\n：:。]/, 1)[0].trim();
  let action = request.replace(/^(?:(?:你|請|麻煩|拜託|幫我|幫忙|快點?|先|也|能不能|可不可以)[，,、：:\s]*)+/, '');
  if (/[嗎？?][。！？!?\s]*$/.test(request)) action = action.replace(/^可以\s*/, '');
  action = action.replace(/[啊呀吧啦嘛喔欸嗎。！？!?~～\s]+$/, '').replace(/\s+/g, '');
  return /^(?:來)?吐[槽嘈糟](?:一[下句])?(?:(?:這|那)(?:句|段|件事|個梗)|剛才那句|剛剛那句|我)?(?:一下)?$/.test(action) ||
    /^(?:講|說|來)(?:一?[個則])?冷?笑話(?:給我聽)?$/.test(action) ||
    /^(?:出來(?:面對)?|(?:不要|別)裝死|評評理|怎麼看(?:(?:這|那)(?:句|段|件事|篇))?|怎麼想|覺得呢|有什麼看法|說呢|回我(?:一下)?)$/.test(action);
}

function closeLineHotChat_(context, hot, leaseId) {
  if (!hot || hot.chain >= CHAT_MAX_FOLLOW_UP_CHAIN) return;
  try {
    withDataMutationLock_(function() {
      const key = context.lineChatKey;
      const state = readLineChatState_(key);
      if (!state || !state.hotChat || state.hotChat.at !== hot.at || state.hotChat.chain !== hot.chain ||
          (state.resetId || '') !== (context.lineChatState.resetId || '') ||
          state.lease && state.lease.until > Date.now() && state.lease.id !== leaseId) return;
      delete state.hotChat;
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
    }, 250);
  } catch (ignore) { /* 退場狀態可等熱聊窗到期。 */ }
}

function claimLineAmbientProbe_(context, leaseId) {
  try {
    return withDataMutationLock_(function() {
      const key = context.lineChatKey;
      const state = readLineChatState_(key);
      const now = Date.now();
      // 取得同房資格後重讀節流狀態，避免依兩個 webhook 的舊快照重複探測。
      if (!state || !state.lease || state.lease.id !== leaseId || state.lease.until <= now || state.ambientProbeAfterMs > now ||
          (state.resetId || '') !== (context.lineChatState.resetId || '') || !isChatEasterEggAvailable_(key, now)) return {};
      state.ambientProbeAfterMs = now + CHAT_AMBIENT_PROBE_INTERVAL_MS;
      PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(state));
      return { claimed: true };
    }, 250).claimed === true;
  } catch (ignore) { return false; }
}

function classifyLineChatWake_(text, signals, ambient, executionContext, leaseId) {
  const deadline = executionContext.deadlineAtMs;
  const classificationDeadline = Math.min(deadline - 10000, Date.now() + 8000);
  const seconds = Math.floor((classificationDeadline - Date.now()) / 1000);
  if (seconds < 2) return { outcome: 'skipped_budget_or_error' };
  if (signals.ambientBanterAvailable && !claimLineAmbientProbe_(executionContext.conversationContext, leaseId)) {
    return { outcome: 'skipped_cooldown' };
  }
  const speaker = createConversationSpeakerMap_();
  const currentSpeaker = speaker(executionContext.conversationContext.currentUserId);
  const previousReply = signals.followUp && ambient.find(function(item) {
    return item.role === 'assistant' && item.confirmed && item.timestampMs === signals.hot.at;
  });
  const recentItems = ambient.slice(-4);
  if (previousReply && !recentItems.includes(previousReply)) recentItems.unshift(previousReply);
  const recent = recentItems.map(function(item) {
    return { speaker: item.role === 'assistant' ? '小浣' : speaker(item.userId), text: item.text.slice(0, getLineMessageSafeSliceIndex_(item.text, 240)) };
  });
  const result = runAiJsonTask('chat_gatekeeper', JSON.stringify({
    currentSpeaker: currentSpeaker, signals: { named: signals.named, teasing: signals.teasing, followUp: signals.followUp,
      followUpChain: signals.followUpChain, work: signals.work, weeklyNote: signals.weeklyNote,
      easterEggAvailable: signals.easterEggAvailable, ambientBanterAvailable: signals.ambientBanterAvailable }, recent: recent,
    currentMessage: text.slice(0, getLineMessageSafeSliceIndex_(text, 1600))
  }), { executionDeadlineAtMs: classificationDeadline, timeoutCapSeconds: seconds, minimumRequestSeconds: 2, maxModelCalls: 1 });
  if (!result.ok || Date.now() > classificationDeadline) return { outcome: 'skipped_budget_or_error' };
  let decision = result.json;
  const ignored = { outcome: 'gatekeeper_ignore', scored: decision };
  if (!decision || decision.shouldReply !== true || decision.triggerType === 'ignore') return ignored;
  const thirdPerson = /(?:小浣|mega浣)(?:背後)?(?:的|最近)?(?:模型|改用|改成|換成|更新了)|(?:我|我們).{0,10}(?:在)?更新(?:了)?(?:小浣|mega浣)/i.test(text);
  if (thirdPerson && !signals.work && !/(?:小浣|mega浣)[，,\s]*你/i.test(text)) return ignored;
  // 熱聊中的省略姓名虧句即使被判點名，仍走續聊分數與連續回覆上限。
  if (decision.triggerType === 'direct_call' && signals.hot && signals.teasing) {
    decision = Object.assign({}, decision, { triggerType: 'follow_up' });
  }
  if (decision.triggerType === 'direct_call' && (signals.named || signals.teasing) ||
      decision.triggerType === 'follow_up' && signals.followUp && decision.replyScore >= CHAT_WAKE_FOLLOW_UP_SCORE_THRESHOLD ||
      decision.triggerType === 'work_collab' && signals.work ||
      decision.triggerType === 'easter_egg' && (signals.easterEggAvailable || signals.ambientBanterAvailable) &&
        decision.replyScore >= CHAT_WAKE_BASE_SCORE_THRESHOLD && !signals.work && !signals.quotesBot) {
    return { outcome: 'gatekeeper_reply', decision: decision };
  }
  return ignored;
}

function authorizeLineAutoReply_(key, leaseId, deadline, triggerType) {
  try {
    return withDataMutationLock_(function() {
      const now = Date.now();
      const state = readLineChatState_(key);
      if (!state || !state.lease || state.lease.id !== leaseId || now >= deadline ||
          state.autoAfterMs > now && state.lease.lane === 'auto') return {};
      if (triggerType === 'follow_up' && (!state.hotChat || state.hotChat.chain >= CHAT_MAX_FOLLOW_UP_CHAIN)) return {};
      const props = PropertiesService.getScriptProperties();
      if (triggerType === 'easter_egg') {
        if (!ENABLE_CHAT_EASTER_EGG) return {};
        const cooldowns = readChatEasterEggState_();
        if (cooldowns[key] > now) return {};
        Object.keys(cooldowns).forEach(function(name) { if (!(cooldowns[name] > now)) delete cooldowns[name]; });
        // 先保留冷卻時間，LINE 回應遺失時也能維持插話間隔。
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

function rememberLineReply_(key, snapshot, event, receipt, startsFollowUp, leaseId, triggerType) {
  if (!key || !snapshot || !receipt.sentAtMs) return;
  const ids = (receipt.messageIds || []).filter(isExactLineMessageId_);
  if (!ids.length && !startsFollowUp) return;
  try {
    withDataMutationLock_(function() {
      const state = readLineChatState_(key);
      if (!state || (state.resetId || '') !== (snapshot.resetId || '') ||
          Number(event.timestamp) > 0 && Number(event.timestamp) <= (state.resetAtMs || 0) ||
          leaseId && (!state.lease || state.lease.id !== leaseId)) return;
      const userId = event.source && event.source.userId;
      const props = PropertiesService.getScriptProperties();
      if (leaseId && state.lease.lane !== 'explicit') {
        state.autoAfterMs = Math.max(state.autoAfterMs || 0, receipt.sentAtMs + CHAT_AUTO_REPLY_INTERVAL_MS);
      }
      if (startsFollowUp && (!state.hotChat || receipt.sentAtMs >= state.hotChat.at)) {
        state.hotChat = { at: receipt.sentAtMs,
          chain: triggerType === 'follow_up' && state.hotChat ? state.hotChat.chain + 1 : 0 };
      }
      const replies = Array.isArray(state.replies) ? state.replies : [];
      replies.push({ at: receipt.sentAtMs,
        userId: startsFollowUp && typeof userId === 'string' && userId.length <= 128 ? userId : '', ids: ids });
      state.replies = replies.filter(function(reply) { return reply.at > Date.now() - AMBIENT_CHAT_WINDOW_MS; })
        .sort(function(a, b) { return b.at - a.at; }).slice(0, MAX_RECENT_LINE_REPLIES);
      props.setProperty(key, JSON.stringify(state));
      if (triggerType === 'easter_egg') {
        const cooldowns = readChatEasterEggState_();
        cooldowns[key] = receipt.sentAtMs + CHAT_EASTER_EGG_COOLDOWN_MS;
        props.setProperty(CHAT_EASTER_EGG_STATE_PROPERTY, JSON.stringify(cooldowns));
      }
    }, 250);
  } catch (ignore) { /* 已確認送出時，輔助狀態失敗不重送。 */ }
}

function logLineChatWakeStatus_(outcome, scored, chain) {
  const type = scored && scored.triggerType;
  const score = scored && scored.replyScore;
  console.log('CHAT_WAKE_STATUS ' + JSON.stringify({ outcome: outcome,
    triggerType: ['direct_call', 'follow_up', 'work_collab', 'easter_egg', 'ignore'].includes(type) ? type : null,
    score: Number.isInteger(score) && score >= 0 && score <= 10 ? score : null,
    followUpChain: Number.isInteger(chain) && chain >= 0 && chain <= CHAT_MAX_FOLLOW_UP_CHAIN ? chain : 0 }));
}
