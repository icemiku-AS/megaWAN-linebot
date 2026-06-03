// ======================================================
// 小甜 LINE Bot on Google Apps Script
// LINE Bot + DeepSeek API + Google Sheet Log + WeeklySummary
//
// 版本：V4 Integrated
//
// 功能：
// 1. 使用 DeepSeek deepseek-v4-flash
// 2. 支援 LINE 私訊多輪對話
// 3. 支援 LINE 群組指令觸發，避免每句話都回覆
// 4. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog
// 5. 可讀取最近 N 則對話進行摘要與回顧
// 6. 可清除短期記憶與指定聊天室長期紀錄
// 7. 可將本週話題封存成極簡長期記憶：WeeklySummary
// 8. 回覆時會讀取 WeeklySummary，作為過去討論脈絡
// ======================================================


// ======================================================
// API Endpoint 設定
// ======================================================

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// DeepSeek 模型
// deepseek-chat 可能逐步棄用，這裡改用 deepseek-v4-flash
const DEEPSEEK_MODEL = 'deepseek-v4-flash';


// ======================================================
// Google Sheet 設定
// ======================================================

// 原始對話紀錄 Sheet
const SHEET_NAME = 'ConversationLog';

// 封存後的極簡長期記憶 Sheet
const WEEKLY_SUMMARY_SHEET_NAME = 'WeeklySummary';


// ======================================================
// LINE Bot 指令設定
// ======================================================

// 群組中只有這些開頭才會觸發 Bot 回覆
// 沒有這些開頭的群組訊息只會被記錄，不會回覆
const TRIGGER_PREFIXES = [
  '#小甜',
  '#摘要',
  '#標題',
  '#help',
  '#reset',
  '#摘要最近',
  '#回顧最近',
  '#記錄',
  '#清空紀錄',
  '#封存本週話題'
];


// ======================================================
// 短期多輪記憶設定
// ======================================================

// Apps Script CacheService 最長 21600 秒，約 6 小時
const MEMORY_TTL_SECONDS = 21600;

// 保留最近幾輪短期對話
// 一輪 = user + assistant
const MAX_HISTORY_PAIRS = 6;


// ======================================================
// 第一次使用前，請手動執行 setupLogSheet()
// 用途：
// 1. 建立 ConversationLog 表頭
// 2. 建立 WeeklySummary 表頭
// 3. 觸發 Google Sheet 授權
// ======================================================

function setupLogSheet() {
  const logSheet = ensureLogSheet_();
  const weeklySheet = ensureWeeklySummarySheet_();

  return 'Sheet setup completed: ' + logSheet.getName() + ', ' + weeklySheet.getName();
}


// ======================================================
// 瀏覽器 GET 測試用
// 你用瀏覽器打開 Web App /exec 時會看到這段文字
// ======================================================

function doGet(e) {
  return HtmlService.createHtmlOutput('LINE BOT Web App is running.');
}


// ======================================================
// LINE Webhook 入口
// LINE Platform 會用 POST 打到這裡
// 注意：這裡回傳 HtmlService，避免 ContentService 造成 302 redirect
// ======================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return HtmlService.createHtmlOutput('OK');
    }

    const body = JSON.parse(e.postData.contents);
    const events = body.events || [];

    events.forEach(function(event) {
      handleLineEvent(event);
    });

    return HtmlService.createHtmlOutput('OK');

  } catch (error) {
    console.error('doPost error:', error);

    // LINE webhook 驗證重點是 HTTP 200
    // 即使內部錯誤，也盡量回 OK，避免 webhook 被判定失敗
    return HtmlService.createHtmlOutput('OK');
  }
}


// ======================================================
// 處理 LINE 事件
// ======================================================

function handleLineEvent(event) {
  if (!event || !event.replyToken) {
    return;
  }

  const sourceType = event.source && event.source.type
    ? event.source.type
    : 'unknown';

  const isGroupLike = sourceType === 'group' || sourceType === 'room';
  const conversationId = getConversationId(event);

  // 只處理文字訊息
  if (event.type !== 'message' || !event.message || event.message.type !== 'text') {
    if (!isGroupLike) {
      replyToLine(event.replyToken, '目前我先支援文字訊息，圖片、貼圖、語音之後可以再加。');
    }
    return;
  }

  const userText = String(event.message.text || '').trim();

  if (!userText) {
    return;
  }

  // 所有文字訊息先寫入 ConversationLog
  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'user',
    text: userText,
    mode: getUserLogMode(userText)
  });

  // 群組裡沒有指令就安靜，只記錄不回覆
  if (isGroupLike && !hasTriggerPrefix(userText)) {
    return;
  }

  // #help 指令
  if (userText === '#help' || userText === '#小甜 help') {
    const helpText = getHelpText();

    replyToLine(event.replyToken, helpText);
    logAssistantReplyToSheet(event, conversationId, helpText, 'help');

    return;
  }

  // #reset：只清除短期多輪記憶，不刪 Google Sheet
  if (userText === '#reset' || userText === '#小甜 reset') {
    clearConversationHistory(conversationId);

    const resetText = '已清除這個聊天室的短期對話記憶。Google Sheet 裡的長期紀錄不會被刪除。';

    replyToLine(event.replyToken, resetText);
    logAssistantReplyToSheet(event, conversationId, resetText, 'reset');

    return;
  }

  // #清空紀錄：先提示，不直接刪除
  if (userText === '#清空紀錄') {
    const warningText = [
      '你正在準備清空這個聊天室的 Google Sheet 長期紀錄。',
      '',
      '這個動作會刪除目前聊天室在 ConversationLog 裡的歷史訊息。',
      '不會影響其他私訊、其他群組，也不會刪除 WeeklySummary 封存摘要。',
      '',
      '如果確定要清空，請輸入：',
      '#清空紀錄 確認'
    ].join('\n');

    replyToLine(event.replyToken, warningText);
    logAssistantReplyToSheet(event, conversationId, warningText, 'clear_warning');

    return;
  }

  // #清空紀錄 確認：刪除目前聊天室 ConversationLog
  if (userText === '#清空紀錄 確認') {
    const deletedCount = deleteConversationLogs(conversationId);
    clearConversationHistory(conversationId);

    const doneText = [
      '已清空這個聊天室的 ConversationLog 長期紀錄。',
      '同時也清除了短期對話記憶。',
      '',
      '刪除筆數：' + deletedCount,
      '',
      '提醒：WeeklySummary 封存摘要不會被刪除。'
    ].join('\n');

    replyToLine(event.replyToken, doneText);
    logAssistantReplyToSheet(event, conversationId, doneText, 'clear_done');

    return;
  }

  // #記錄：只做重點標記，不呼叫 AI
  if (userText.startsWith('#記錄')) {
    const noteText = userText.replace('#記錄', '').trim();

    const replyText = noteText
      ? '已記錄這段重點。'
      : '你可以用「#記錄 內容」把重要資訊寫進紀錄。';

    replyToLine(event.replyToken, replyText);
    logAssistantReplyToSheet(event, conversationId, replyText, 'note');

    return;
  }

  // #封存本週話題：整理最近對話，寫入 WeeklySummary
  if (userText === '#封存本週話題') {
    let archiveReply = '';

    try {
      archiveReply = archiveWeeklyTopics(event, conversationId);
    } catch (error) {
      console.error('archiveWeeklyTopics error:', error);
      archiveReply = '封存本週話題時發生問題，可以稍後再試一次。';
    }

    replyToLine(event.replyToken, archiveReply);
    logAssistantReplyToSheet(event, conversationId, archiveReply, 'archive_weekly');

    return;
  }

  // 一般 AI 指令處理
  const commandInfo = parseCommand(userText);

  let aiReply = '';

  try {
    if (commandInfo.mode === 'summary_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount);

      if (!recentText) {
        aiReply = '目前還沒有足夠的 Google Sheet 對話紀錄可以整理。';
      } else {
        aiReply = callDeepSeekWithMemory(
          conversationId,
          '請根據以下最近對話紀錄進行摘要：\n\n' + recentText,
          'summary'
        );
      }

    } else if (commandInfo.mode === 'review_recent') {
      const recentCount = commandInfo.recentCount || 50;
      const recentText = getRecentConversationText(conversationId, recentCount);

      if (!recentText) {
        aiReply = '目前還沒有足夠的 Google Sheet 對話紀錄可以回顧。';
      } else {
        aiReply = callDeepSeekWithMemory(
          conversationId,
          '請根據以下最近對話紀錄，整理出討論回顧、關鍵決策、可延伸話題：\n\n' + recentText,
          'review'
        );
      }

    } else {
      aiReply = callDeepSeekWithMemory(
        conversationId,
        commandInfo.userPrompt,
        commandInfo.mode
      );
    }

  } catch (error) {
    console.error('DeepSeek call error:', error);
    aiReply = '我剛剛連接 AI 或讀取紀錄時發生問題，可以稍後再試一次。';
  }

  replyToLine(event.replyToken, aiReply);
  logAssistantReplyToSheet(event, conversationId, aiReply, commandInfo.mode);
}


// ======================================================
// 判斷群組訊息是否有觸發詞
// ======================================================

function hasTriggerPrefix(text) {
  return TRIGGER_PREFIXES.some(function(prefix) {
    return text.startsWith(prefix);
  });
}


// ======================================================
// 判斷使用者訊息寫入 Sheet 時的 mode
// ======================================================

function getUserLogMode(text) {
  if (text.startsWith('#摘要最近')) return 'summary_recent_command';
  if (text.startsWith('#回顧最近')) return 'review_recent_command';
  if (text.startsWith('#封存本週話題')) return 'archive_command';
  if (text.startsWith('#清空紀錄')) return 'clear_command';
  if (text.startsWith('#記錄')) return 'note';
  if (text.startsWith('#摘要')) return 'summary_command';
  if (text.startsWith('#標題')) return 'title_command';
  if (text.startsWith('#小甜')) return 'assistant_command';
  if (text.startsWith('#reset')) return 'reset_command';
  if (text.startsWith('#help')) return 'help_command';

  return 'input';
}


// ======================================================
// 解析指令
// ======================================================

function parseCommand(text) {
  let mode = 'chat';
  let userPrompt = text;
  let recentCount = null;

  if (text.startsWith('#摘要最近')) {
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

  } else if (text.startsWith('#小甜')) {
    mode = 'chat';
    userPrompt = text.replace('#小甜', '').trim();
  }

  if (!userPrompt) {
    if (mode === 'summary') {
      userPrompt = '請根據前面的對話內容，整理摘要。如果沒有足夠內容，請提醒使用者貼上需要摘要的內容。';
    } else if (mode === 'title') {
      userPrompt = '請根據前面的對話內容，產生適合 Podcast 或 YouTube 的標題。如果資訊不足，請提醒使用者提供主題。';
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


// ======================================================
// 從文字中抓數字，例如：#摘要最近 30
// ======================================================

function extractNumber(text, defaultValue) {
  const match = String(text).match(/\d+/);

  if (!match) {
    return defaultValue;
  }

  const number = parseInt(match[0], 10);

  if (isNaN(number)) {
    return defaultValue;
  }

  // 避免一次撈太多導致 Apps Script 或 API 過慢
  // 最低 5 則，最高 200 則
  return Math.min(Math.max(number, 5), 200);
}


// ======================================================
// 取得對話 ID
// 私訊：user:userId
// 群組：group:groupId
// room：room:roomId
// ======================================================

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


// ======================================================
// 呼叫 DeepSeek：含短期多輪記憶 + WeeklySummary 長期記憶
// ======================================================

function callDeepSeekWithMemory(conversationId, userText, mode) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('DEEPSEEK_API_KEY');

  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY in Script Properties');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const history = getConversationHistory(conversationId);
    const trimmedHistory = trimHistory(history);

    const systemPrompt = buildSystemPrompt(mode);
    const longTermMemoryText = getRecentWeeklySummaryText(conversationId, 8);

    const messages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];

    // 極簡長期記憶：來自 WeeklySummary
    // 不要塞太多，避免 token 膨脹
    if (longTermMemoryText) {
      messages.push({
        role: 'system',
        content: [
          '以下是這個聊天室過去封存的極簡長期記憶。',
          '你可以參考它判斷目前話題是否曾經討論過。',
          '不要主動長篇複述，只有在有關聯時簡短提醒。',
          '如果沒有關聯，請自然忽略。',
          '',
          longTermMemoryText
        ].join('\n')
      });
    }

    // 短期多輪記憶：來自 CacheService
    trimmedHistory.forEach(function(message) {
      messages.push(message);
    });

    messages.push({
      role: 'user',
      content: userText
    });

    const payload = {
      model: DEEPSEEK_MODEL,
      messages: messages,
      temperature: getTemperatureByMode(mode),
      max_tokens: getMaxTokensByMode(mode),
      stream: false
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + apiKey
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(DEEPSEEK_ENDPOINT, options);
    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error('DeepSeek API error ' + statusCode + ': ' + responseText);
    }

    const json = JSON.parse(responseText);
    logDeepSeekUsage(json);

    const reply = json.choices &&
                  json.choices[0] &&
                  json.choices[0].message &&
                  json.choices[0].message.content;

    if (!reply) {
      throw new Error('Invalid DeepSeek response: ' + responseText);
    }

    const updatedHistory = trimmedHistory.concat([
      {
        role: 'user',
        content: userText
      },
      {
        role: 'assistant',
        content: reply
      }
    ]);

    saveConversationHistory(conversationId, trimHistory(updatedHistory));

    return reply;

  } finally {
    lock.releaseLock();
  }
}


// ======================================================
// 呼叫 DeepSeek：不使用短期記憶
// 適合封存、格式化、純任務型整理
// ======================================================

function callDeepSeekDirect(userText, mode) {
  const apiKey = PropertiesService
    .getScriptProperties()
    .getProperty('DEEPSEEK_API_KEY');

  if (!apiKey) {
    throw new Error('Missing DEEPSEEK_API_KEY in Script Properties');
  }

  const payload = {
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(mode)
      },
      {
        role: 'user',
        content: userText
      }
    ],
    temperature: getTemperatureByMode(mode),
    max_tokens: getMaxTokensByMode(mode),
    stream: false
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + apiKey
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(DEEPSEEK_ENDPOINT, options);
  const statusCode = response.getResponseCode();
  const responseText = response.getContentText();

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error('DeepSeek API error ' + statusCode + ': ' + responseText);
  }

  const json = JSON.parse(responseText);
  logDeepSeekUsage(json);

  const reply = json.choices &&
                json.choices[0] &&
                json.choices[0].message &&
                json.choices[0].message.content;

  if (!reply) {
    throw new Error('Invalid DeepSeek response: ' + responseText);
  }

  return reply;
}


// ======================================================
// 短期記憶：讀取
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


// ======================================================
// 短期記憶：儲存
// ======================================================

function saveConversationHistory(conversationId, history) {
  const cache = CacheService.getScriptCache();
  const key = getHistoryCacheKey(conversationId);
  const safeHistory = trimHistory(history);

  cache.put(key, JSON.stringify(safeHistory), MEMORY_TTL_SECONDS);
}


// ======================================================
// 短期記憶：清除
// ======================================================

function clearConversationHistory(conversationId) {
  const cache = CacheService.getScriptCache();
  const key = getHistoryCacheKey(conversationId);

  cache.remove(key);
}


// ======================================================
// 短期記憶：產生 Cache Key
// ======================================================

function getHistoryCacheKey(conversationId) {
  return 'linebot_history_' + conversationId;
}


// ======================================================
// 短期記憶：修剪
// ======================================================

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


// ======================================================
// Google Sheet：確保 ConversationLog Sheet 存在
// ======================================================

function ensureLogSheet_() {
  const spreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty('SPREADSHEET_ID');

  if (!spreadsheetId) {
    throw new Error('Missing SPREADSHEET_ID in Script Properties');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = [
    'Timestamp',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'Role',
    'Mode',
    'MessageId',
    'Text'
  ];

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  const hasHeader = firstRow.some(function(value) {
    return String(value || '').trim() !== '';
  });

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}


// ======================================================
// Google Sheet：確保 WeeklySummary Sheet 存在
// ======================================================

function ensureWeeklySummarySheet_() {
  const spreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty('SPREADSHEET_ID');

  if (!spreadsheetId) {
    throw new Error('Missing SPREADSHEET_ID in Script Properties');
  }

  const ss = SpreadsheetApp.openById(spreadsheetId);
  let sheet = ss.getSheetByName(WEEKLY_SUMMARY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(WEEKLY_SUMMARY_SHEET_NAME);
  }

  const headers = [
    'ArchivedAt',
    'ConversationId',
    'SourceType',
    'UserId',
    'GroupId',
    'RoomId',
    'TopicTitle',
    'Keywords',
    'Summary',
    'ReusableAngles',
    'FollowUpQuestions',
    'RawMessageCount'
  ];

  const firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  const hasHeader = firstRow.some(function(value) {
    return String(value || '').trim() !== '';
  });

  if (!hasHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  return sheet;
}


// ======================================================
// Google Sheet：記錄訊息到 ConversationLog
// ======================================================

function logMessageToSheet(data) {
  try {
    const event = data.event || {};
    const source = event.source || {};
    const message = event.message || {};

    const sheet = ensureLogSheet_();

    const timestamp = event.timestamp
      ? new Date(event.timestamp)
      : new Date();

    const row = [
      timestamp,
      data.conversationId || '',
      source.type || '',
      source.userId || '',
      source.groupId || '',
      source.roomId || '',
      data.role || '',
      data.mode || '',
      message.id || '',
      truncateForSheet(data.text || '')
    ];

    sheet.appendRow(row);

  } catch (error) {
    console.error('logMessageToSheet error:', error);
  }
}


// ======================================================
// Google Sheet：記錄 AI 回覆
// ======================================================

function logAssistantReplyToSheet(event, conversationId, text, mode) {
  logMessageToSheet({
    event: event,
    conversationId: conversationId,
    role: 'assistant',
    text: text,
    mode: mode || 'reply'
  });
}


// ======================================================
// Google Sheet：讀取最近 N 則使用者對話
// 用於 #摘要最近、#回顧最近、#封存本週話題
// ======================================================

function getRecentConversationText(conversationId, limit) {
  const items = getRecentConversationItems(conversationId, limit);

  return items.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');
}


// ======================================================
// Google Sheet：讀取最近 N 則使用者對話，回傳結構化資料
// ======================================================

function getRecentConversationItems(conversationId, limit) {
  const sheet = ensureLogSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const lastCol = sheet.getLastColumn();

  // 為了效能，最多往回讀最近 500 列
  const readRows = Math.min(lastRow - 1, 500);
  const startRow = lastRow - readRows + 1;

  const values = sheet
    .getRange(startRow, 1, readRows, lastCol)
    .getValues();

  const matched = [];

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];

    const rowConversationId = row[1];
    const role = row[6];
    const mode = row[7];
    const text = row[9];

    if (rowConversationId !== conversationId) {
      continue;
    }

    if (!text) {
      continue;
    }

    // 避免 AI 回覆不斷污染摘要，最近回顧以 user 訊息為主
    if (role !== 'user') {
      continue;
    }

    // 避免把純系統指令大量納入封存摘要
    // 但保留 #記錄，因為它通常是使用者刻意標記的重要內容
    const textString = String(text);
    const isCommand = textString.startsWith('#');
    const isImportantNote = textString.startsWith('#記錄');

    if (isCommand && !isImportantNote) {
      continue;
    }

    matched.push({
      role: role,
      mode: mode,
      text: textString
    });

    if (matched.length >= limit) {
      break;
    }
  }

  matched.reverse();

  return matched;
}


// ======================================================
// Google Sheet：讀取最近 N 筆 WeeklySummary 長期記憶
// ======================================================

function getRecentWeeklySummaryText(conversationId, limit) {
  try {
    const sheet = ensureWeeklySummarySheet_();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return '';
    }

    const lastCol = sheet.getLastColumn();

    // 最多往回讀最近 100 筆 WeeklySummary
    const readRows = Math.min(lastRow - 1, 100);
    const startRow = lastRow - readRows + 1;

    const values = sheet
      .getRange(startRow, 1, readRows, lastCol)
      .getValues();

    const matched = [];

    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];

      const rowConversationId = row[1];
      const topicTitle = row[6];
      const keywords = row[7];
      const summary = row[8];
      const reusableAngles = row[9];
      const followUpQuestions = row[10];

      if (rowConversationId !== conversationId) {
        continue;
      }

      if (!summary) {
        continue;
      }

      matched.push({
        topicTitle: topicTitle,
        keywords: keywords,
        summary: summary,
        reusableAngles: reusableAngles,
        followUpQuestions: followUpQuestions
      });

      if (matched.length >= limit) {
        break;
      }
    }

    matched.reverse();

    return matched.map(function(item, index) {
      return [
        '【封存記憶 ' + (index + 1) + '】',
        '主題：' + item.topicTitle,
        '關鍵字：' + item.keywords,
        '摘要：' + item.summary,
        '可重用切角：' + item.reusableAngles,
        '後續問題：' + item.followUpQuestions
      ].join('\n');
    }).join('\n\n');

  } catch (error) {
    console.error('getRecentWeeklySummaryText error:', error);
    return '';
  }
}


// ======================================================
// Google Sheet：刪除目前聊天室的 ConversationLog 紀錄
// 不刪 WeeklySummary
// ======================================================

function deleteConversationLogs(conversationId) {
  const sheet = ensureLogSheet_();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return 0;
  }

  const conversationIdColumn = 2; // B 欄：ConversationId

  const values = sheet
    .getRange(2, conversationIdColumn, lastRow - 1, 1)
    .getValues();

  let deletedCount = 0;

  // 從下面往上刪，避免刪除列後 row index 位移
  for (let i = values.length - 1; i >= 0; i--) {
    const rowConversationId = values[i][0];

    if (rowConversationId === conversationId) {
      sheet.deleteRow(i + 2);
      deletedCount++;
    }
  }

  return deletedCount;
}


// ======================================================
// 封存本週話題：整理最近對話，寫入 WeeklySummary
// ======================================================

function archiveWeeklyTopics(event, conversationId) {
  const recentCount = 200;
  const recentItems = getRecentConversationItems(conversationId, recentCount);

  if (!recentItems || recentItems.length === 0) {
    return '目前還沒有足夠的對話紀錄可以封存。';
  }

  const recentText = recentItems.map(function(item, index) {
    return (index + 1) + '. [' + item.role + '/' + item.mode + '] ' + item.text;
  }).join('\n');

  const prompt = [
    '請把以下 LINE 群組最近討論整理成「極度精簡版長期記憶」。',
    '',
    '用途：',
    '這份摘要未來會被 AI 助手讀取，用來判斷這個話題以前是否討論過，以及當時有哪些觀點。',
    '',
    '請輸出成 JSON，且只輸出 JSON，不要加任何解釋文字。',
    '',
    'JSON 格式如下：',
    '{',
    '  "topicTitle": "一句話主題標題",',
    '  "keywords": ["關鍵字1", "關鍵字2", "關鍵字3"],',
    '  "summary": "150到300字摘要，保留核心觀點與脈絡",',
    '  "reusableAngles": ["未來可重用切角1", "未來可重用切角2", "未來可重用切角3"],',
    '  "followUpQuestions": ["後續可追問問題1", "後續可追問問題2", "後續可追問問題3"]',
    '}',
    '',
    '要求：',
    '1. 使用繁體中文。',
    '2. 不要寫空泛心得。',
    '3. 不要捏造對話中沒有的資訊。',
    '4. 如果討論很零散，請整理出最有價值的主題即可。',
    '5. 這份內容是給未來 AI 助手參考，所以要精煉、可重用、好檢索。',
    '',
    '以下是最近對話紀錄：',
    recentText
  ].join('\n');

  const archiveText = callDeepSeekDirect(prompt, 'archive');
  const archiveJson = parseArchiveJson(archiveText);

  const source = event.source || {};
  const sheet = ensureWeeklySummarySheet_();

  sheet.appendRow([
    new Date(),
    conversationId,
    source.type || '',
    source.userId || '',
    source.groupId || '',
    source.roomId || '',
    archiveJson.topicTitle || '',
    Array.isArray(archiveJson.keywords) ? archiveJson.keywords.join(', ') : '',
    archiveJson.summary || '',
    Array.isArray(archiveJson.reusableAngles) ? archiveJson.reusableAngles.join('\n') : '',
    Array.isArray(archiveJson.followUpQuestions) ? archiveJson.followUpQuestions.join('\n') : '',
    recentItems.length
  ]);

  return [
    '已封存本週話題到 WeeklySummary。',
    '',
    '主題：' + (archiveJson.topicTitle || '未命名主題'),
    '',
    '摘要：',
    archiveJson.summary || '已建立摘要，但內容較短。',
    '',
    '封存訊息數：' + recentItems.length,
    '',
    '之後我可以把這些封存摘要當成極簡長期記憶使用。'
  ].join('\n');
}


// ======================================================
// 解析封存 JSON
// DeepSeek 有時可能會包在 ```json 裡，所以這裡做防呆
// ======================================================

function parseArchiveJson(text) {
  const raw = String(text || '').trim();

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);

    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (innerError) {
        console.error('parseArchiveJson inner error:', innerError);
      }
    }

    console.error('parseArchiveJson error:', error, raw);

    return {
      topicTitle: '未能解析的封存摘要',
      keywords: [],
      summary: raw.slice(0, 1000),
      reusableAngles: [],
      followUpQuestions: []
    };
  }
}


// ======================================================
// 避免 Google Sheet 單格過長
// Google Sheets 單格上限約 50,000 字，這裡保守切短
// ======================================================

function truncateForSheet(text) {
  const safeText = String(text || '');
  return safeText.slice(0, 30000);
}


// ======================================================
// DeepSeek usage / KV Cache log
// 可在 Apps Script 執行紀錄中查看 token 用量
// ======================================================

function logDeepSeekUsage(json) {
  if (!json || !json.usage) {
    return;
  }

  const usage = json.usage;

  console.log('DeepSeek usage:', JSON.stringify({
    prompt_tokens: usage.prompt_tokens,
    completion_tokens: usage.completion_tokens,
    total_tokens: usage.total_tokens,
    prompt_cache_hit_tokens: usage.prompt_cache_hit_tokens,
    prompt_cache_miss_tokens: usage.prompt_cache_miss_tokens
  }));
}


// ======================================================
// 建立系統提示詞
// 依照不同模式給小甜不同任務設定
// ======================================================

function buildSystemPrompt(mode) {
  const basePrompt = [
    '你是放在 LINE 群組中的繁體中文 AI 小助手,名字叫「小甜」,正式名稱是「Tendo 甜度」',
    '你的主要使用者是 Podcast 節目「現正熱潮中」的主持人 LL 與漪夢',
    '這個節目風格是主觀、閒聊、帶觀點,用不嚴肅的角度聊嚴肅世界,關注社群熱點、科技趨勢、平台政策、創作者生態、迷因文化與大眾情緒',
    '你的定位是 AI 社群潮流祕書,負責整理群組討論、提煉觀點、收束話題,協助產生節目企劃、段落大綱、標題、SEO、摘要與延伸問題',
    '你提供討論地圖,不替主持人決定立場。可以提出切角、風險提醒與建議,但結論由主持人決定',
    '回答要自然、清楚、俐落,像可靠的企劃助理。可以有一點可愛的小助手感,但不要過度裝萌或太制式',
    '回覆要適合 LINE 閱讀,除非使用者要求完整企劃,否則不要過長。',
    '不要捏造資訊。未確認的社群傳聞、截圖、爆料或轉述,要標記為「待查證」。資訊不足時,要直接提醒使用者補充背景',
    '整理話題時,優先回答：這件事是什麼、為什麼會熱、大家在吵什麼、有哪些可聊角度、是否適合做成節目段落',
    '可以保留主持人的主觀、吐槽與聊天感,但要讓內容更有脈絡、更好懂、更適合錄音',
    '你具備多輪對話能力,請根據前面的對話脈絡接續回答,不要每次重新介紹背景'
  ].join('\n');

  if (mode === 'summary') {
    return [
      basePrompt,
      '',
      '目前任務：摘要整理。',
      '請把使用者提供的內容整理成：',
      '1. 核心重點',
      '2. 可延伸討論',
      '3. 值得保留的觀點',
      '4. 可以變成節目段落的切角',
      '請避免空泛心得。',
      '如果使用者說「剛剛」、「前面」、「上面」，請優先參考對話歷史或提供的紀錄。'
    ].join('\n');
  }

  if (mode === 'review') {
    return [
      basePrompt,
      '',
      '目前任務：對話回顧。',
      '請根據提供的對話紀錄整理：',
      '1. 最近主要聊了什麼',
      '2. 哪些內容值得繼續追蹤',
      '3. 有沒有可變成節目段落的主題',
      '4. 下一步建議',
      '請務實、具體，不要空泛。'
    ].join('\n');
  }

  if (mode === 'title') {
    return [
      basePrompt,
      '',
      '目前任務：產生 Podcast 或 YouTube 標題。',
      '請根據使用者提供的內容，產生：',
      '1. 直白 SEO 標題 5 個',
      '2. 有梗但不過度標題黨的標題 5 個',
      '3. 適合社群貼文的短標 5 個',
      '標題要自然、有點擊誘因，但不要太廉價。',
      '如果使用者說「根據剛剛內容」，請優先參考對話歷史。'
    ].join('\n');
  }

  if (mode === 'archive') {
    return [
      basePrompt,
      '',
      '目前任務：封存本週話題。',
      '請把零散對話壓縮成可以長期保存的精簡知識。',
      '重點不是逐字摘要，而是保留未來可以重用的觀點、切角、爭議點與追蹤問題。',
      '請務必按照使用者要求的 JSON 格式輸出。',
      '不要輸出 JSON 以外的文字。'
    ].join('\n');
  }

  return [
    basePrompt,
    '',
    '目前任務：一般助理回覆。',
    '請根據使用者問題與前文脈絡，給出清楚、可執行、自然的回答。',
    '如果過去封存記憶與目前問題有關，可以簡短提醒「之前有討論過類似方向」。',
    '如果無關，請不要硬提過去記憶。'
  ].join('\n');
}


// ======================================================
// 不同模式使用不同 temperature
// ======================================================

function getTemperatureByMode(mode) {
  if (mode === 'title') {
    return 0.9;
  }

  if (mode === 'summary' || mode === 'review' || mode === 'archive') {
    return 0.3;
  }

  return 0.7;
}


// ======================================================
// 不同模式使用不同輸出長度
// ======================================================

function getMaxTokensByMode(mode) {
  if (mode === 'title') {
    return 1200;
  }

  if (mode === 'summary' || mode === 'review') {
    return 1400;
  }

  if (mode === 'archive') {
    return 1200;
  }

  return 900;
}


// ======================================================
// LINE Reply API 回覆
// ======================================================

function replyToLine(replyToken, text) {
  const token = PropertiesService
    .getScriptProperties()
    .getProperty('LINE_CHANNEL_ACCESS_TOKEN');

  if (!token) {
    throw new Error('Missing LINE_CHANNEL_ACCESS_TOKEN in Script Properties');
  }

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


// ======================================================
// Help 文字
// ======================================================

function getHelpText() {
  return [
    '目前可用指令：',
    '',
    '#小甜 你的問題',
    '例：#小甜 幫我整理這週可以聊的 AI 話題',
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
    '刪除目前聊天室的 ConversationLog 長期紀錄，並清除短期記憶，不刪 WeeklySummary',
    '',
    '#help',
    '查看指令說明',
    '',
    '在私訊裡可以直接聊天；在群組裡請用指令開頭叫我。',
    '群組裡的一般文字會被寫進 ConversationLog，但我不會每句都回。',
    '封存後的 WeeklySummary 會成為我的極簡長期記憶。'
  ].join('\n');
}