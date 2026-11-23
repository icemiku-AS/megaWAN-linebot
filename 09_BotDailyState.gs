// 小浣的角色日常。只在 LINE 主回覆已交付後，用剩餘預算準備下一輪的素材。

const BOT_DAILY_STATE_PROPERTY = 'BOT_DAILY_STATE';
const BOT_DAILY_STATE_MIN_REMAINING_MS = 18000;
const BOT_DAILY_STATE_TIMEOUT_SECONDS = 4;

function getBotDailyDate_(time) {
  return Utilities.formatDate(new Date(time), 'Asia/Taipei', 'yyyy-MM-dd');
}

function normalizeBotDailyText_(value) {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(value)) return '';
  const text = value.trim();
  const length = Array.from(text).length;
  const normalized = text.normalize('NFKC');
  return length >= 40 && length <= 80 && /\p{Script=Han}/u.test(text) &&
    !/[*#\x60_|\[\]<>~]|https?:|www\.|[\w-]+\.[a-z]{2,}\b|^\s*(?:[-+]\s|\d+\.\s)/i.test(normalized) ? text : '';
}

function readBotDailyState_(props, now) {
  let saved;
  try { saved = JSON.parse(props.getProperty(BOT_DAILY_STATE_PROPERTY) || '{}'); }
  catch (ignore) { saved = null; }
  const days = {};
  for (let offset = 2; offset >= 0; offset--) {
    const date = getBotDailyDate_(now - offset * 86400000);
    const text = normalizeBotDailyText_(saved && saved.days && saved.days[date]);
    if (text) days[date] = text;
  }
  return { days: days, pending: saved && saved.pending };
}

function getBotDailyState_() {
  try {
    const now = Date.now();
    return readBotDailyState_(PropertiesService.getScriptProperties(), now).days[getBotDailyDate_(now)] || '';
  } catch (ignore) { return ''; }
}

function maybeGenerateBotDailyState_(deadline) {
  if (deadline - Date.now() < BOT_DAILY_STATE_MIN_REMAINING_MS) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const date = getBotDailyDate_(now);
    const needsState = function(state, time) {
      return !state.days[date] && !(state.pending && state.pending.date === date && state.pending.until > time);
    };
    if (!needsState(readBotDailyState_(props, now), now)) return;
    const claim = withDataMutationLock_(function() {
      const time = Date.now();
      const state = readBotDailyState_(props, time);
      if (deadline - time < BOT_DAILY_STATE_MIN_REMAINING_MS || getBotDailyDate_(time) !== date || !needsState(state, time)) return {};
      // 不跨房重複生成。失敗後稍後再試，避免在每一則聊天重試。
      state.pending = { date: date, token: Utilities.getUuid(), until: time + 60000 };
      props.setProperty(BOT_DAILY_STATE_PROPERTY, JSON.stringify(state));
      return { token: state.pending.token, previous: Object.values(state.days) };
    }, 0);
    if (!claim.token) return;
    const auxiliaryDeadline = Math.min(deadline, Date.now() + BOT_DAILY_STATE_TIMEOUT_SECONDS * 1000);
    const result = runAiTextTask('bot_daily_state', '近期角色日常（避重）：\n' + JSON.stringify(claim.previous), {
      executionDeadlineAtMs: auxiliaryDeadline, timeoutCapSeconds: BOT_DAILY_STATE_TIMEOUT_SECONDS,
      minimumRequestSeconds: 1, maxModelCalls: 1, disableClientResearch: true
    });
    const text = result.ok && normalizeBotDailyText_(result.text);
    if (!text || Date.now() > auxiliaryDeadline || claim.previous.includes(text)) return;
    withDataMutationLock_(function() {
      const time = Date.now();
      const state = readBotDailyState_(props, time);
      if (time > auxiliaryDeadline || getBotDailyDate_(time) !== date || state.days[date] ||
          !state.pending || state.pending.token !== claim.token) return;
      state.days[date] = text;
      const serialized = JSON.stringify({ days: state.days });
      if (Utilities.newBlob(serialized).getBytes().length <= 1500) props.setProperty(BOT_DAILY_STATE_PROPERTY, serialized);
    }, 0);
  } catch (ignore) { /* 選用角色素材失敗不影響已送達的回覆。 */ }
}
