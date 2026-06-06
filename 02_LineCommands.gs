// ======================================================
// 02_LineCommands.gs
// 處理 LINE 指令解析、回覆文字、Help 與 LINE Reply API。
//
// 小浣 LINE Bot v1.10.0 News Inbox Edition
//
// 維護原則：
// 1. 本檔負責指令解析與 Reply API，不直接管理大量固定文案。
// 2. 不經過 LLM 的固定回覆文字集中於 12_ResponseTexts.gs。
// 3. v1.10.0 新增 #本週新聞 / #新聞補充 / #懶人包。
// ======================================================

function enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText) {
  if (!shouldUseWebReading(userText)) {
    return null;
  }

  // v1.10.0：
  // 1. #節目話題分析 + 網址：仍走深度網址分析 queue。
  // 2. #讀網址 / #懶人包：仍走快讀摘要 queue。
  // 3. 其他含網址訊息：收進 NewsInbox queue，不再自動產出懶人包。
  if (userText.startsWith('#節目話題分析')) {
    return enqueueWebTask(event, conversationId, userText, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
  }

  if (userText.startsWith('#讀網址') || userText.startsWith('#懶人包')) {
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
  if (text.startsWith('#摘要最近')) return 'summary_recent_command';
  if (text.startsWith('#回顧最近')) return 'review_recent_command';
  if (text.startsWith('#封存本週話題')) return 'archive_command';
  if (text.startsWith('#讀網址')) return 'web_read_command';
  if (text.startsWith('#懶人包')) return 'web_read_command';
  if (text.startsWith('#清空紀錄')) return 'clear_command';
  if (text.startsWith('#版本紀錄')) return 'version_history_command';
  if (text.startsWith('#版本')) return 'version_command';
  if (text.startsWith('#記錄')) return 'note';
  if (text.startsWith('#摘要')) return 'summary_command';
  if (text.startsWith('#標題')) return 'title_command';
  if (text.startsWith('#小浣')) return 'assistant_command';
  if (text.startsWith('#reset')) return 'reset_command';
  if (text.startsWith('#help')) return 'help_command';

  if (shouldUseWebReading(text)) return 'news_inbox_url_message';

  return 'input';
}


function parseCommand(text) {
  let mode = 'chat';
  let userPrompt = text;
  let recentCount = null;

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

  } else if (text.startsWith('#讀網址')) {
    mode = 'web_read';
    userPrompt = text.replace('#讀網址', '').trim();

  } else if (text.startsWith('#懶人包')) {
    mode = 'web_read';
    userPrompt = text.replace('#懶人包', '').trim();

  } else if (text.startsWith('#摘要最近')) {
    mode = 'summary_recent';
    recentCount = extractNumber(text, 50);
    userPrompt = text.replace('#摘要最近', '').trim();

  } else if (text.startsWith('#回顧最近')) {
    mode = 'review_recent';
    recentCount = extractNumber(text, 50);
    userPrompt = text.replace('#回顧最近', '').trim();

  } else if (text.startsWith('#摘要')) {
    mode = 'summary';
    userPrompt = text.replace('#摘要', '').trim();

  } else if (text.startsWith('#標題')) {
    mode = 'title';
    userPrompt = text.replace('#標題', '').trim();

  } else if (text.startsWith('#小浣')) {
    mode = 'chat';
    userPrompt = text.replace('#小浣', '').trim();
  }

  if (!userPrompt) {
    if (mode === 'summary') {
      userPrompt = '請根據前面的對話內容，整理摘要。如果沒有足夠內容，請提醒使用者貼上需要摘要的內容。';
    } else if (mode === 'title') {
      userPrompt = '請根據前面的對話內容，產生適合 Podcast 或 YouTube 的標題。如果資訊不足，請提醒使用者提供主題。';
    } else if (mode === 'web_read') {
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
    userPrompt: userPrompt,
    recentCount: recentCount
  };
}


function extractNumber(text, defaultValue) {
  const match = String(text).match(/\d+/);

  if (!match) {
    return defaultValue;
  }

  const number = parseInt(match[0], 10);

  if (isNaN(number)) {
    return defaultValue;
  }

  return Math.min(Math.max(number, 5), 200);
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
    '#讀網址 網址',
    '等同 #懶人包，保留舊習慣。',
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
    '#小浣 你的問題',
    '例：#小浣 幫我整理這週可以聊的 AI 話題',
    '',
    '#摘要 你要整理的內容',
    '例：#摘要 今天我們聊了角川財報、Fantia 政策、AI 助理趨勢',
    '',
    '#摘要最近 30',
    '整理這個聊天室最近 30 則使用者訊息。',
    '',
    '#回顧最近 50',
    '回顧這個聊天室最近 50 則使用者訊息，整理重點與下一步。',
    '',
    '#封存本週話題',
    '把最近最多 200 則對話整理成極簡長期記憶，寫入 WeeklySummary。',
    '',
    '#標題 本集內容',
    '例：#標題 這集聊 Fantia 政策、角川異世界退燒、AI 助理賈維斯化',
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
    '在私訊裡可以直接聊天；在群組裡請用指令開頭叫我。',
    '例外：群組裡直接貼網址會自動收進 NewsInbox 新聞素材池。'
  ].join('\n');
}
