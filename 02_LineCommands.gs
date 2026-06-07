// ======================================================
// 02_LineCommands.gs
// 處理 LINE 指令解析、回覆文字、Help 與 LINE Reply API。
//
// 小浣 LINE Bot v1.10.4 Data Cleanup Edition
//
// 維護原則：
// 1. 本檔負責指令解析與 Reply API，不直接管理大量固定文案。
// 2. 不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. v1.10.4 新增分層 help，避免清理指令全部塞進主 help 造成壓力。
// ======================================================

function enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText) {
  if (!shouldUseWebReading(userText)) return null;
  if (userText.startsWith('#節目話題分析')) return enqueueWebTask(event, conversationId, userText, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
  if (userText.startsWith('#懶人包')) return enqueueWebTask(event, conversationId, userText, TASK_TYPE_WEB_LAZY_SUMMARY);
  return enqueueNewsUrlTasks(event, conversationId, userText);
}

function buildWebTaskAcceptedText_(taskType, urlCount) {
  return getBotTextWebTaskAccepted_(taskType, urlCount);
}

function hasTriggerPrefix(text) {
  return TRIGGER_PREFIXES.some(function(prefix) {
    return text.startsWith(prefix);
  });
}

function getUserLogMode(text) {
  if (text.startsWith('#節目話題分析')) return 'program_topic_analysis_command';
  if (text.startsWith('#統整話題')) return 'integrate_topics_command';
  if (text.startsWith('#本週新聞')) return 'weekly_news_command';
  if (text.startsWith('#新聞補充')) return 'manual_news_supplement_command';
  if (text.startsWith('#封存本週話題')) return 'archive_command';
  if (text.startsWith('#懶人包')) return 'web_read_command';
  if (text.startsWith('#清空')) return 'cleanup_command';
  if (text.startsWith('#版本紀錄')) return 'version_history_command';
  if (text.startsWith('#版本')) return 'version_command';
  if (text.startsWith('#畫重點')) return 'highlight_command';
  if (text.startsWith('#小浣')) return 'assistant_command';
  if (text.startsWith('#reset')) return 'reset_command';
  if (text.startsWith('#help')) return 'help_command';
  if (shouldUseWebReading(text)) return 'news_inbox_url_message';
  return 'input';
}

function parseCommand(text) {
  let mode = 'chat';
  let userPrompt = text;

  if (text.startsWith('#節目話題分析')) {
    mode = 'program_topic_analysis';
    userPrompt = text.replace('#節目話題分析', '').trim();
  } else if (text.startsWith('#統整話題')) {
    mode = 'integrate_topics';
    userPrompt = text.replace('#統整話題', '').trim();
  } else if (text.startsWith('#本週新聞')) {
    mode = 'weekly_news';
    userPrompt = text.replace('#本週新聞', '').trim();
  } else if (text.startsWith('#新聞補充')) {
    mode = 'manual_news_supplement';
    userPrompt = text.replace('#新聞補充', '').trim();
  } else if (text.startsWith('#懶人包')) {
    mode = 'web_read';
    userPrompt = text.replace('#懶人包', '').trim();
  } else if (text.startsWith('#小浣')) {
    mode = 'chat';
    userPrompt = text.replace('#小浣', '').trim();
  }

  if (!userPrompt) {
    if (mode === 'web_read') userPrompt = '請提供要讀取的網址。';
    else if (mode === 'program_topic_analysis') userPrompt = '請根據最近使用者聊天內容、人工畫重點、網址快讀摘要與封存記憶，判斷目前最值得分析的節目話題。';
    else if (mode === 'integrate_topics') userPrompt = '請統整最近使用者聊天內容、人工畫重點、網址快讀摘要與封存記憶，整理出近期可用節目話題。';
    else if (mode === 'weekly_news') userPrompt = '請整理最近 7 天 NewsInbox 中的新聞素材。';
    else if (mode === 'manual_news_supplement') userPrompt = '請補充新聞素材；如果要寫入素材池，需要附上網址。';
    else if (mode === 'chat') userPrompt = '請簡短介紹你可以協助的事情。';
  }

  return { mode: mode, userPrompt: userPrompt };
}

function getConversationId(event) {
  const source = event.source || {};
  const sourceType = source.type || 'unknown';
  if (sourceType === 'user') return 'user:' + source.userId;
  if (sourceType === 'group') return 'group:' + source.groupId;
  if (sourceType === 'room') return 'room:' + source.roomId;
  return 'unknown';
}

function replyToLine(replyToken, text) {
  const token = getRequiredScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  const safeText = String(text || '').slice(0, 4500);
  const payload = { replyToken: replyToken, messages: [{ type: 'text', text: safeText || getBotTextEmptyReply_() }] };
  const options = { method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(payload), muteHttpExceptions: true };
  const response = UrlFetchApp.fetch(LINE_REPLY_ENDPOINT, options);
  const statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) console.error('LINE Reply API error:', statusCode, response.getContentText());
}

function normalizeHelpCommandText_(text) {
  let normalized = String(text || '').trim();
  if (normalized.startsWith('#小浣')) normalized = normalized.replace('#小浣', '').trim();
  if (normalized === 'help' || normalized.startsWith('help ')) normalized = '#' + normalized;
  return normalized;
}

function getHelpTextByCommand_(text) {
  const normalized = normalizeHelpCommandText_(text);
  if (normalized === '#help') return getHelpText();
  if (normalized === '#help 清理') return getHelpCleanupText_();
  if (normalized === '#help 管理') return getHelpAdminText_();
  if (normalized === '#help 資料') return getHelpDataText_();
  if (normalized === '#help 全部') return getHelpAllText_();
  return null;
}

function getHelpText() {
  return ['小浣可以幫你把群組裡的雜訊、網址和討論，整理成節目素材。', '', '常用功能：', '・直接貼網址：收進 NewsInbox 新聞素材池。', '・#本週新聞：整理最近 7 天新聞素材。', '・#新聞補充 文字 + 網址：人工補充新聞素材。', '・#懶人包 網址：產生網址快讀摘要。', '・#節目話題分析：分析網址或近期素材。', '・#統整話題：整理近期節目話題地圖。', '・#畫重點 內容：寫入 TopicHighlights。', '・#封存本週話題：寫入 WeeklySummary。', '', '更多說明：', '・#help 清理', '・#help 管理', '・#help 資料', '・#help 全部'].join('\n');
}

function getHelpCleanupText_() {
  return ['資料清理指令：', '', '所有清理只處理目前聊天室，不會影響其他私訊或群組。', '所有清理都需要二段確認。', '', '・#清空紀錄：ConversationLog，並清除短期記憶。', '・#清空重點：TopicHighlights。', '・#清空快讀：WebSummary 與 WebTaskQueue。', '・#清空封存：WeeklySummary。', '・#清空新聞：NewsInbox 與 NewsUrlQueue。', '・#清空待回覆：PendingReplies。', '', '用法：先輸入清理指令看影響範圍，確認後再輸入「原指令 確認」。'].join('\n');
}

function getHelpAdminText_() {
  return ['管理指令：', '', '・#版本：查看目前版本。', '・#版本紀錄：查看近期版本紀錄。', '・#reset：清除短期對話記憶，不動 Google Sheet。', '・#help 清理：查看資料清理指令。', '・#help 資料：查看各 Sheet 用途。'].join('\n');
}

function getHelpDataText_() {
  return ['主要資料表：', '', '・ConversationLog：原始對話紀錄。', '・TopicHighlights：#畫重點 的人工重點。', '・WeeklySummary：#封存本週話題 的長期記憶。', '・WebTaskQueue：#懶人包 與網址分析任務。', '・WebSummary：網址快讀摘要。', '・NewsUrlQueue：直接貼網址後的待處理網址。', '・NewsInbox：新聞素材池。', '・PendingReplies：背景任務完成後等待交付的回覆。'].join('\n');
}

function getHelpAllText_() {
  return [getHelpText(), '', '---', getHelpCleanupText_(), '', '---', getHelpAdminText_(), '', '---', getHelpDataText_()].join('\n');
}
