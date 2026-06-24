// ======================================================
// 09_DeepSeekService.gs
// DeepSeek API 服務層。負責主模型呼叫、短期記憶組裝、長期封存記憶注入與模型參數控制。
//
// 小浣 LINE Bot v1.12.3 News QA Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持清楚分層。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
// 5. v1.10.5 的網址分析改由 16_ReaderLayer.gs 先讀取正文，再交給 DeepSeek 做節目話題分析。
// 6. v1.12.3 起，news_question 模式使用低溫度與較長 token 上限，供 #新聞問答 整理 NewsInbox 素材。
// ======================================================

// ======================================================
// 網頁閱讀後交給 DeepSeek
// ======================================================

function callDeepSeekWithWebReading(conversationId, userText, mode) {
  const urls = extractUrls(userText).slice(0, MAX_URLS_PER_MESSAGE);

  if (urls.length === 0) {
    return callDeepSeekWithMemory(conversationId, userText, mode);
  }

  const webResults = urls.map(function(url) {
    return fetchAndExtractWebPageByReaderLayer_(url);
  });

  const deepSeekPrompt = buildWebReadingPrompt(userText, webResults, mode);

  // 送給 DeepSeek 的內容是 deepSeekPrompt，裡面包含抽取後正文。
  // 存進短期記憶的內容仍是 userText，避免把長文塞進 CacheService。
  return callDeepSeekWithMemoryPayload(
    conversationId,
    userText,
    deepSeekPrompt,
    mode
  );
}

// ======================================================
// DeepSeek 記憶型呼叫
// ======================================================

function callDeepSeekWithMemory(conversationId, userText, mode) {
  return callDeepSeekWithMemoryPayload(
    conversationId,
    userText,
    userText,
    mode
  );
}

function callDeepSeekWithMemoryPayload(conversationId, userTextForHistory, deepSeekUserContent, mode) {
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
      content: deepSeekUserContent
    });

    const reply = callDeepSeekApi_(messages, mode);

    const updatedHistory = trimmedHistory.concat([
      {
        role: 'user',
        content: userTextForHistory
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

function callDeepSeekDirect(userText, mode) {
  return callDeepSeekApi_([
    {
      role: 'system',
      content: buildSystemPrompt(mode)
    },
    {
      role: 'user',
      content: userText
    }
  ], mode);
}

// ======================================================
// DeepSeek API 底層呼叫
// ======================================================

function callDeepSeekApi_(messages, mode) {
  const apiKey = getRequiredScriptProperty_('DEEPSEEK_API_KEY');

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

  return reply;
}

// ======================================================
// DeepSeek 用量與模型參數
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

function getTemperatureByMode(mode) {
  // 需要收束、判斷與整理的任務使用較低 temperature，減少發散。
  if (
    mode === 'archive' ||
    mode === 'archive_news' ||
    mode === 'web_read' ||
    mode === 'program_topic_analysis' ||
    mode === 'integrate_topics' ||
    mode === 'news_question'
  ) {
    return 0.3;
  }

  // 一般聊天保留一點彈性，讓小浣回覆不會太死板。
  return 0.7;
}

function getMaxTokensByMode(mode) {
  if (mode === 'web_read') {
    return 1200;
  }

  if (mode === 'program_topic_analysis') {
    return 2200;
  }

  if (mode === 'integrate_topics') {
    return 2600;
  }

  if (mode === 'archive') {
    return 1200;
  }

  if (mode === 'archive_news') {
    return 2200;
  }

  if (mode === 'news_question') {
    return 1800;
  }

  return 900;
}
