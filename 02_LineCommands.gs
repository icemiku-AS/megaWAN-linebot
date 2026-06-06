// ======================================================
// 02_LineCommands.gs
// 處理 LINE 指令解析、回覆文字、Help 與 LINE Reply API。
//
// 小浣 LINE Bot v1.10.2 Secretary Cleanup Edition
//
// 維護原則：
// 1. 本檔負責指令解析與 Reply API，不直接管理大量固定文案。
// 2. 不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. v1.10.2 保留新聞素材秘書核心指令，移除摘要 / 回顧 / 標題 / #讀網址 等低使用率或重疊指令。
// ======================================================

function enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText) {
  if (!shouldUseWebReading(userText)) {
    return null;
  }

  // v1.10.2：
  // 1. #節目話題分析 + 網址：走深度網址分析 queue。
  // 2. #懶人包：走快讀摘要 queue。
  // 3. 其他含網址訊息：收進 NewsInbox queue，不再自動產出懶人包。
  // 4. #讀網址 已移除，避免快讀入口過多造成維護與測試混淆。
  if (userText.startsWith('#節目話題分析')) {
    return enqueueWebTask(event, conversationId, userText, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
  }

  if (userText.startsWith('#懶人包')) {
    return enqueueWebTask(event, conversationId, userText, TASK_TYPE_WEB_LAZY_SUMMARY);
  }

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
  if (text.startsWith('#清空紀錄')) return 'clear_command';
  if (text.startsWith('#版本紀錄')) return 'version_history_command';
  if (text.startsWith('#版本')) return 'version_command';
  if (text.startsWith('#記錄')) return 'note';
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
    if (mode === 'web_read') {
      userPrompt = '請提供要讀取的網址。';
    } else if (mode === 'program_topic_analysis') {
      userPrompt = '請根據最近聊天內容、網址快讀摘要與封存記憶，判斷目前最值得分析的節目話題。';
    } else if (mode === 'integrate_topics') {
      userPrompt = '請統整最近聊天內容、網址快讀摘要與封存記憶，整理出近期可用節目話題。';
    } else if (mode === 'weekly_news') {
      userPrompt = '請整理最近 7 天 NewsInbox 中的新聞素材。';
    } else if (mode === 'manual_news_supplement') {
      userPrompt = '請補充新聞素材；如果要寫入素材池，需要附上網址。';
    } else if (mode === 'chat') {
      userPrompt = '請簡短介紹你可以協助的事情。';
    }
  }

  return {
    mode: mode,
    userPrompt: userPrompt
  };
}


function getConversationId(event) {
  const source = event.source || {};
  const sourceType = source.type || 'unknown';

  if (sourceType === 'user') {
    return 'user:' + source.userId;
  }

  if (sourceType === 'group') {
    return 'group:' + source.groupId;
  }

  if (sourceType === 'room') {
    return 'room:' + source.roomId;
  }

  return 'unknown';
}


function replyToLine(replyToken, text) {
  const token = getRequiredScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  const safeText = String(text || '').slice(0, 4500);

  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: safeText || getBotTextEmptyReply_()
      }
    ]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(LINE_REPLY_ENDPOINT, options);
  const statusCode = response.getResponseCode();

  if (statusCode < 200 || statusCode >= 300) {
    console.error('LINE Reply API error:', statusCode, response.getContentText());
  }
}


function getHelpText() {
  return [
    '小浣可以幫你把群組裡的雜訊、網址和討論，整理成節目素材。',
    '目前可用指令如下：',
    '',
    '直接貼網址',
    '我會先收進 NewsInbox 新聞素材池，背景慢慢抓內容、分類、標記節目潛力。需要整理時輸入 #本週新聞。',
    '這個行為在群組與個人聊天室都一樣；差別只是群組聊天要用 #小浣 叫我，私訊可以直接問。',
    '',
    '#本週新聞',
    '整理最近 7 天 NewsInbox 中的新聞素材，只列分類、標題、網址與節目潛力，不主動分析。',
    '',
    '#新聞補充 文字 + 網址',
    '如果網址讀不到，或你想人工補充素材，可以用自然語言告訴我。我會交給 DeepSeek 判斷分類後寫入 NewsInbox。',
    '',
    '#懶人包 網址',
    '明確指定我要做網址快讀摘要。這會走 WebSummary 與 PendingReplies。',
    '',
    '#節目話題分析 網址',
    '針對該網址做深度節目話題分析，包含事件重點、爭議焦點、主持切角、段落拆法與待查證點。',
    '',
    '#節目話題分析',
    '沒有貼網址時，我會根據最近聊天、WebSummary 與 WeeklySummary，自行判斷目前最值得分析的節目話題。',
    '',
    '#統整話題',
    '整合最近聊天、網址快讀摘要與封存記憶，整理近期可用節目話題地圖。',
    '',
    '#封存本週話題',
    '把最近最多 200 則對話整理成極簡長期記憶，寫入 WeeklySummary。',
    '',
    '#小浣 你的問題',
    '例：#小浣 幫我整理這週可以聊的 AI 話題',
    '',
    '#記錄 重要內容',
    '把某段重點標記寫入 ConversationLog。',
    '',
    '#版本',
    '查看小浣目前版本與本次新增功能。',
    '',
    '#版本紀錄',
    '查看小浣主要版本更新摘要。',
    '',
    '#reset',
    '清除目前這個聊天室的短期對話記憶，不會刪除 Google Sheet 紀錄。',
    '',
    '#清空紀錄',
    '查看清空目前聊天室 ConversationLog 紀錄的確認提示。',
    '',
    '#清空紀錄 確認',
    '刪除目前聊天室的 ConversationLog 長期紀錄，並清除短期記憶；不刪 WeeklySummary、WebSummary、NewsInbox。',
    '',
    '#help',
    '查看指令說明。',
    '',
    'v1.10.2 起，#摘要、#摘要最近、#回顧最近、#標題、#讀網址 已移除。',
    '需要快讀網址請用 #懶人包；需要整理節目素材請用 #統整話題 或 #節目話題分析。'
  ].join('\n');
}
