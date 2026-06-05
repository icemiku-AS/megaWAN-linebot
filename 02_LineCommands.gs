// ======================================================
// 02_LineCommands.gs
// 處理 LINE 指令解析、回覆文字、Help 與 LINE Reply API。
//
// 小浣 LINE Bot v1.9 Service Split Edition
//
// 維護原則：
// 1. 本版只拆分檔案職責，不主動改變功能邏輯。
// 2. Google Apps Script 會把同一專案內的 .gs 檔視為同一個全域命名空間。
// 3. 因此函式可跨檔案直接呼叫，但函式名稱不可重複。
// ======================================================

function enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText) {
  if (!shouldUseWebReading(userText)) {
    return null;
  }

  const taskType = userText.startsWith('#節目話題分析')
    ? TASK_TYPE_PROGRAM_TOPIC_ANALYSIS
    : TASK_TYPE_WEB_LAZY_SUMMARY;

  return enqueueWebTask(event, conversationId, userText, taskType);
}


function buildWebTaskAcceptedText_(taskType, urlCount) {
  const countText = urlCount > 1
    ? '前 ' + urlCount + ' 個網址'
    : '這個網址';

  if (taskType === TASK_TYPE_PROGRAM_TOPIC_ANALYSIS) {
    return [
      '收到，' + countText + '我會做成節目話題分析。',
      '處理完成後，下一次群組有任何訊息，我會把結果送出。'
    ].join('\n');
  }

  return [
    '收到網址！稍等我整理一下喔！',
    '處理完成後，下一次群組有任何訊息，我會把結果送出'
  ].join('\n');
}


function hasTriggerPrefix(text) {
  return TRIGGER_PREFIXES.some(function(prefix) {
    return text.startsWith(prefix);
  });
}


function getUserLogMode(text) {
  if (text.startsWith('#節目話題分析')) return 'program_topic_analysis_command';
  if (text.startsWith('#統整話題')) return 'integrate_topics_command';
  if (text.startsWith('#摘要最近')) return 'summary_recent_command';
  if (text.startsWith('#回顧最近')) return 'review_recent_command';
  if (text.startsWith('#封存本週話題')) return 'archive_command';
  if (text.startsWith('#讀網址')) return 'web_read_command';
  if (text.startsWith('#清空紀錄')) return 'clear_command';
  if (text.startsWith('#記錄')) return 'note';
  if (text.startsWith('#摘要')) return 'summary_command';
  if (text.startsWith('#標題')) return 'title_command';
  if (text.startsWith('#小浣')) return 'assistant_command';
  if (text.startsWith('#reset')) return 'reset_command';
  if (text.startsWith('#help')) return 'help_command';

  if (shouldUseWebReading(text)) return 'url_message';

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

  } else if (text.startsWith('#讀網址')) {
    mode = 'web_read';
    userPrompt = text.replace('#讀網址', '').trim();

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

  // 避免一次撈太多導致 Apps Script 或 API 過慢。
  // 最低 5 則，最高 200 則。
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

  // LINE 單則文字訊息上限約 5000 字，這裡保守切到 4500
  const safeText = String(text || '').slice(0, 4500);

  const payload = {
    replyToken: replyToken,
    messages: [
      {
        type: 'text',
        text: safeText || '我剛剛沒有產生有效回覆。'
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
    '目前可用指令：',
    '',
    '直接貼網址',
    '小浣會自動做快讀摘要，放進 WebSummary 素材池。處理完成後，下一次群組有任何訊息時交付結果。',
    '',
    '#讀網址 網址',
    '手動指定網址快讀。效果跟直接貼網址類似。',
    '',
    '#節目話題分析 網址',
    '針對該網址做深度節目話題分析，包含事件重點、爭議焦點、主持切角、段落拆法與待查證點。',
    '',
    '#節目話題分析',
    '沒有貼網址時，會根據最近聊天、WebSummary 與 WeeklySummary，自行判斷目前最值得分析的節目話題。',
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
    '整理這個聊天室最近 30 則使用者訊息',
    '',
    '#回顧最近 50',
    '回顧這個聊天室最近 50 則使用者訊息，整理重點與下一步',
    '',
    '#封存本週話題',
    '把最近最多 200 則對話整理成極簡長期記憶，寫入 WeeklySummary',
    '',
    '#標題 本集內容',
    '例：#標題 這集聊 Fantia 政策、角川異世界退燒、AI 助理賈維斯化',
    '',
    '#記錄 重要內容',
    '把某段重點標記寫入 ConversationLog',
    '',
    '#reset',
    '清除目前這個聊天室的短期對話記憶，不會刪除 Google Sheet 紀錄',
    '',
    '#清空紀錄',
    '查看清空目前聊天室 ConversationLog 紀錄的確認提示',
    '',
    '#清空紀錄 確認',
    '刪除目前聊天室的 ConversationLog 長期紀錄，並清除短期記憶，不刪 WeeklySummary 與 WebSummary',
    '',
    '#help',
    '查看指令說明',
    '',
    '在私訊裡可以直接聊天；在群組裡請用指令開頭叫我。',
    '例外：群組裡直接貼網址會自動觸發快讀摘要。',
    '群組裡的一般文字會被寫進 ConversationLog；若有 pending reply，任何文字訊息都會觸發交付。',
    'WebSummary 是網址素材池，WeeklySummary 是封存後的極簡長期記憶。'
  ].join('\n');
}
