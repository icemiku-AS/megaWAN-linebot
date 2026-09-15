// ======================================================
// 02_LineCommands.gs
// 用途：LINE transport：指令解析、Help、Reply API 與長文字分段。
//
// 職責與協作：
// 1. 01_Main.gs 使用本檔解析指令、顯示 Help、傳送回覆及處理 Pending 交付時的新網址。
// 2. 固定回覆由 03_ResponseTexts.gs 提供；AI、Reader、News 與 Sheet 流程交由各功能檔負責。
//
// 維護注意：
// 1. 指令名稱、參數解析、Help 分層與 reply token 使用方式須保持相容。
// 2. 單次 Reply API 最多五則訊息；有來源時保留最後一格，主回答沿用既有 splitter。
// ======================================================

function enqueueWebTaskFromCurrentMessageIfNeeded_(event, conversationId, userText) {
  if (!shouldUseWebReading(userText)) {
    return null;
  }

  if (userText.startsWith('#節目話題分析')) {
    return enqueueWebTask(event, conversationId, userText, TASK_TYPE_PROGRAM_TOPIC_ANALYSIS);
  }

  if (userText.startsWith('#懶人包')) {
    return enqueueWebTask(event, conversationId, userText, TASK_TYPE_WEB_LAZY_SUMMARY);
  }

  // Pending 交付時的一般網址以靜默新聞收件處理；圖片／研究問題由主流程先排除。
  // 若此訊息同時觸發 pending reply 交付，新網址仍會入 NewsUrlQueue；
  // 不支援或入隊失敗的網址則另建 PendingReplies，避免錯誤直接洗版。
  return handleSilentNewsUrlMessage_(event, conversationId, userText);
}

function buildWebTaskAcceptedText_(taskType, urlCount) {
  return getBotTextWebTaskAccepted_(taskType, urlCount);
}

function hasTriggerPrefix(text) {
  return TRIGGER_PREFIXES.some(function(prefix) {
    return text.startsWith(prefix);
  });
}

// 「幫我查」已是使用者明確要求查找；只有「最近／今天」等單純時效詞才交給模型 auto。
function isExplicitWebSearchRequest_(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  return /(?:上網|網路|網絡|網上).{0,8}(?:查|找|搜)|(?:查|找|搜尋|搜索).{0,8}(?:網路|網絡|網上)|(?:搜尋|搜索)(?:一下|看看)?|(?:幫我)?查一下|(?:請|麻煩)?\s*幫我\s*(?:(?:上網|去網路)\s*)?(?:查(?!看)|找|搜尋|搜索)/.test(value);
}

function getUserLogMode(text) {
  if (text.startsWith('#節目話題分析')) return 'program_topic_analysis_command';
  if (text.startsWith('#統整話題')) return 'integrate_topics_command';
  if (text.startsWith('#本週新聞')) return 'weekly_news_command';
  if (text.startsWith('#新聞問答')) return 'news_question_command';
  if (text.startsWith('#狀態回報')) return 'news_status_report_command';
  if (text.startsWith('#新聞補充')) return 'manual_news_supplement_command';
  if (text.startsWith('#封存本週新聞')) return 'archive_news_command';
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

  if (/^#小浣\s+看圖(?:\s|$)/.test(text)) {
    mode = 'image_analysis';
    userPrompt = text.replace(/^#小浣\s+看圖\s*/, '').trim();

  } else if (text.startsWith('#節目話題分析')) {
    mode = 'program_topic_analysis';
    userPrompt = text.replace('#節目話題分析', '').trim();

  } else if (text.startsWith('#統整話題')) {
    mode = 'integrate_topics';
    userPrompt = text.replace('#統整話題', '').trim();

  } else if (text.startsWith('#本週新聞')) {
    mode = 'weekly_news';
    userPrompt = text.replace('#本週新聞', '').trim();

  } else if (text.startsWith('#新聞問答')) {
    mode = 'news_question';
    userPrompt = text.replace('#新聞問答', '').trim();

  } else if (text.startsWith('#狀態回報')) {
    mode = 'news_status_report';
    userPrompt = text.replace('#狀態回報', '').trim();

  } else if (text.startsWith('#新聞補充')) {
    mode = 'manual_news_supplement';
    userPrompt = text.replace('#新聞補充', '').trim();

  } else if (text.startsWith('#封存本週新聞')) {
    mode = 'archive_weekly_news';
    userPrompt = text.replace('#封存本週新聞', '').trim();

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
      userPrompt = '請根據最近使用者聊天內容、人工畫重點、網址快讀摘要與封存記憶，判斷目前最值得分析的節目話題。';
    } else if (mode === 'integrate_topics') {
      userPrompt = '請統整最近使用者聊天內容、人工畫重點、NewsInbox 新聞素材、網址快讀摘要與封存記憶，整理出近期可用節目話題。';
    } else if (mode === 'weekly_news') {
      userPrompt = '請整理最近 7 天 NewsInbox 中的新聞素材。';
    } else if (mode === 'news_question') {
      userPrompt = '';
    } else if (mode === 'news_status_report') {
      userPrompt = '請回報最近 7 天新聞收件、入庫、背景處理與失敗狀態。';
    } else if (mode === 'manual_news_supplement') {
      userPrompt = '請補充新聞素材；如果要寫入素材池，需要附上網址。';
    } else if (mode === 'archive_weekly_news') {
      userPrompt = '請封存最近 7 天 NewsInbox 新聞素材。';
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

  if (sourceType === 'user') return 'user:' + source.userId;
  if (sourceType === 'group') return 'group:' + source.groupId;
  if (sourceType === 'room') return 'room:' + source.roomId;

  return 'unknown';
}

function replyToLine(replyToken, text, throwOnHttpError, finalMessageText) {
  const token = getRequiredScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  const finalText = String(finalMessageText || '').trim();
  const mainMessageLimit = LINE_REPLY_MAX_MESSAGE_COUNT - (finalText ? 1 : 0);
  const messageTexts = splitTextForLineMessagesWithMeta_(text, mainMessageLimit).messages;
  const safeMessageTexts = messageTexts.length ? messageTexts : [getBotTextEmptyReply_()];
  if (finalText) safeMessageTexts.push(finalText.slice(0, LINE_TEXT_MESSAGE_MAX_LENGTH));

  const payload = {
    replyToken: replyToken,
    messages: safeMessageTexts.slice(0, LINE_REPLY_MAX_MESSAGE_COUNT).map(function(messageText) {
      return {
        type: 'text',
        text: String(messageText || getBotTextEmptyReply_()).slice(0, LINE_TEXT_MESSAGE_MAX_LENGTH)
      };
    })
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    // 同步工作最多 40 秒；Reply 不沿用 GAS 360 秒預設，保留 replyToken 時間餘裕。
    timeoutSeconds: 10
  };

  try {
    const response = UrlFetchApp.fetch(LINE_REPLY_ENDPOINT, options);
    const statusCode = response.getResponseCode();

    if (statusCode < 200 || statusCode >= 300) {
      console.error('LINE Reply API error:', statusCode);
      // PendingReplies 只有在 transport 確認成功後才能 consume；非 2xx 必須向 caller 明確失敗。
      if (throwOnHttpError) throw new Error('LINE Reply API request failed.');
      return false;
    }

    return true;
  } catch (error) {
    // 保留既有拋錯行為，但不讓含 request/token 的外部例外流入上層 stack log。
    throw new Error('LINE Reply API request failed.');
  }
}

function splitTextForLineMessages_(text) {
  return splitTextForLineMessagesWithMeta_(text).messages;
}

// 保留 splitTextForLineMessages_(text) 的既有簽名、回傳型別與分段行為。
// 週編輯台額外讀取截斷狀態、切點與各訊息長度，判斷 block fitter
// 是否還要先省略完整區塊；其他既有呼叫者不需要修改。
function splitTextForLineMessagesWithMeta_(text, maxMessageCount) {
  const rawText = String(text || '').trim();
  if (!rawText) {
    return {
      messages: [],
      wasTruncated: false,
      splitIndexes: [],
      messageLengths: []
    };
  }

  const maxLength = LINE_TEXT_MESSAGE_MAX_LENGTH;
  const requestedMaxCount = Number(maxMessageCount);
  const maxCount = isFinite(requestedMaxCount) && requestedMaxCount > 0
    ? Math.min(LINE_REPLY_MAX_MESSAGE_COUNT, Math.floor(requestedMaxCount))
    : LINE_REPLY_MAX_MESSAGE_COUNT;
  const omittedNotice = '內容太多，後面已省略。可以用 #本週新聞 分類 <分類名>、#本週新聞 詳細 或 #新聞問答 追問。';
  const messages = [];
  const splitIndexes = [];
  let remainingText = rawText;
  let remainingOffset = 0;

  while (remainingText && messages.length < maxCount) {
    if (remainingText.length <= maxLength) {
      messages.push(remainingText);
      remainingText = '';
      break;
    }

    const splitIndex = findLineMessageSplitIndex_(remainingText, maxLength);
    const chunk = remainingText.slice(0, splitIndex).trim();
    messages.push(chunk || remainingText.slice(0, maxLength).trim());
    splitIndexes.push(remainingOffset + splitIndex);

    const nextRemainingText = remainingText.slice(splitIndex);
    const trimmedNextRemainingText = nextRemainingText.trim();
    const leadingTrimLength = nextRemainingText.length - nextRemainingText.replace(/^\s+/, '').length;
    remainingOffset += splitIndex + leadingTrimLength;
    remainingText = trimmedNextRemainingText;
  }

  const nonEmptyMessages = messages.filter(function(message) {
    return String(message || '').trim() !== '';
  });

  const wasTruncated = !!remainingText;

  if (wasTruncated && nonEmptyMessages.length) {
    const lastIndex = nonEmptyMessages.length - 1;
    const suffix = '\n\n' + omittedNotice;
    let lastMessage = nonEmptyMessages[lastIndex];

    // 第 5 則如果已接近上限，先裁出空間再補省略提示，避免 LINE payload 被拒。
    if (lastMessage.length + suffix.length > maxLength) {
      lastMessage = lastMessage.slice(0, Math.max(0, maxLength - suffix.length)).trim();
    }

    nonEmptyMessages[lastIndex] = (lastMessage ? lastMessage + suffix : omittedNotice).slice(0, maxLength);
  }

  return {
    messages: nonEmptyMessages.slice(0, maxCount),
    wasTruncated: wasTruncated,
    splitIndexes: splitIndexes,
    messageLengths: nonEmptyMessages.slice(0, maxCount).map(function(message) {
      return message.length;
    })
  };
}

function buildWebSearchSourcesBubble_(sources) {
  const seen = {};
  const safeSources = [];
  (Array.isArray(sources) ? sources : []).forEach(function(source) {
    const url = String(source && source.url || '').trim();
    if (!url || url.length > 2048 || seen[url] || !isSafePublicUrl(url) || safeSources.length >= 3) return;
    seen[url] = true;
    safeSources.push({
      title: String(source && source.title || '').replace(/\s+/g, ' ').trim().slice(0, 160),
      url: url
    });
  });

  if (!safeSources.length) {
    return '本次已使用網路搜尋，但 DeepSeek API 未提供可列出的來源連結。';
  }

  let bubble = '參考來源：';
  safeSources.forEach(function(source) {
    const entry = '• ' + (source.title || getReaderLayerHostname_(source.url) || '來源') + '\n' + source.url;
    if ((bubble + '\n\n' + entry).length <= LINE_TEXT_MESSAGE_MAX_LENGTH) bubble += '\n\n' + entry;
  });
  return bubble;
}

function findLineMessageSplitIndex_(text, maxLength) {
  const safeText = String(text || '');
  const safeMax = Math.max(1, Number(maxLength) || LINE_TEXT_MESSAGE_MAX_LENGTH);
  const minSemanticSplitIndex = Math.min(1200, Math.floor(safeMax * 0.35));

  const semanticPatterns = [
    /\n【[^】]+】/g,
    /\n(?:科技與 AI|社群輿論|ACG娛樂|商業財經|國際政治|公共政策|生活文化|體育娛樂|待分類)[：:]/g,
    /\n\d+\.\s/g
  ];

  for (let i = 0; i < semanticPatterns.length; i++) {
    const index = findLastRegexIndexBefore_(safeText, semanticPatterns[i], safeMax, minSemanticSplitIndex);
    if (index > 0) return index;
  }

  const paragraphIndex = safeText.lastIndexOf('\n\n', safeMax);
  if (paragraphIndex >= minSemanticSplitIndex) return paragraphIndex;

  const lineIndex = safeText.lastIndexOf('\n', safeMax);
  if (lineIndex >= minSemanticSplitIndex) return lineIndex;

  const spaceIndex = safeText.lastIndexOf(' ', safeMax);
  if (spaceIndex >= minSemanticSplitIndex) return spaceIndex;

  return safeMax;
}

function findLastRegexIndexBefore_(text, regex, maxIndex, minIndex) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  let bestIndex = -1;

  while (match) {
    const index = match.index;
    if (index > maxIndex) break;
    if (index >= minIndex) bestIndex = index;
    match = regex.exec(text);
  }

  return bestIndex;
}

function normalizeHelpCommandText_(text) {
  let normalized = String(text || '').trim();

  if (normalized.startsWith('#小浣')) {
    normalized = normalized.replace('#小浣', '').trim();
  }

  if (normalized === 'help' || normalized.startsWith('help ')) {
    normalized = '#' + normalized;
  }

  return normalized;
}

function getHelpTextByCommand_(text) {
  const normalized = normalizeHelpCommandText_(text);

  if (normalized === '#help') return getHelpText();
  if (normalized === '#help 進階') return getHelpAdvancedText_();
  if (normalized === '#help 清理') return getHelpCleanupText_();
  if (normalized === '#help 管理') return getHelpAdminText_();
  if (normalized === '#help 資料') return getHelpDataText_();
  if (normalized === '#help 全部') return getHelpAllText_();

  return null;
}

function getHelpText() {
  return [
    '小浣可以幫你把群組裡的雜訊、網址和討論，整理成節目素材。',
    '',
    '常用功能：',
    '・私訊可直接傳圖片或回覆圖片提問；群組請回覆圖片並用 #小浣 <問題>。舊 #小浣 看圖 仍可使用。',
    '・引用圖片可問「幫我查最新進度」；一般聊天也可問「我們收過這則新聞嗎？」或「之前畫過哪些重點？」。',
    '・研究工具只讀目前聊天室資料；新增、封存、清理仍使用明確指令。',
    '・看圖支援 JPEG/PNG、每張最多 4 MiB；不永久保存原圖，逾時請重送。',
    '・一般聊天需要最新資訊時，小浣可自行使用網路搜尋；有搜尋會另附來源訊息。',
    '・群組直接貼網址：靜默進背景佇列，整理後收進 NewsInbox。',
    '・#本週新聞：整合最近 7 天群組話題、焦點故事線與其他分類新聞。',
    '・#本週新聞 高潛力：只看高潛力素材，依分類精簡顯示。',
    '・#新聞問答 <問題>：根據最近 7 天新聞素材回答並附原文網址。',
    '・#狀態回報：查看最近 7 天網址收件、入庫、佇列與失敗狀態。',
    '・#新聞補充 文字 + 網址：人工補充新聞素材。',
    '・#封存本週新聞：把最近 7 天 NewsInbox 摘要封存成新聞記憶。',
    '',
    '更多說明：',
    '・#help 進階',
    '・#help 清理',
    '・#help 管理',
    '・#help 資料',
    '・#help 全部'
  ].join('\n');
}

function getHelpAdvancedText_() {
  return [
    '進階功能：',
    '',
    '新聞檢視：',
    '・#本週新聞 詳細：依分類展開完整大綱、切角、節目潛力與分類。',
    '・#本週新聞 精簡：等同 #本週新聞，使用週編輯台整理群組話題與多篇故事線。',
    '・#本週新聞 分類 <分類名>：只看指定分類，依分類精簡顯示。',
    '・#本週新聞 診斷：保留 StoryKey，檢查分類異常、故事線與重複素材。',
    '',
    '素材整理：',
    '・#懶人包 網址：產生網址快讀摘要。',
    '・#節目話題分析：分析網址或近期素材。',
    '・#統整話題：整理近期節目話題地圖。',
    '・#畫重點 內容：寫入 TopicHighlights。',
    '・#封存本週話題：只根據 ConversationLog 封存近期對話記憶。'
  ].join('\n');
}

function getHelpCleanupText_() {
  return [
    '資料清理指令：',
    '',
    '所有清理只處理目前聊天室，不會影響其他私訊或群組。',
    '所有清理都需要二段確認。',
    '',
    '・#清空紀錄：ConversationLog，並清除短期記憶。',
    '・#清空重點：TopicHighlights。',
    '・#清空快讀：WebSummary 與 WebTaskQueue。',
    '・#清空封存：WeeklySummary。',
    '・#清空新聞：NewsInbox 與 NewsUrlQueue。',
    '・#清空待回覆：PendingReplies。',
    '',
    '用法：先輸入清理指令看影響範圍，確認後再輸入「原指令 確認」。'
  ].join('\n');
}

function getHelpAdminText_() {
  return [
    '管理指令：',
    '',
    '・#版本：查看目前版本。',
    '・#版本紀錄：查看近期版本紀錄。',
    '・#狀態回報：查看新聞素材池與背景佇列狀態。',
    '・#reset：清除短期對話記憶，不動 Google Sheet。',
    '・#help 清理：查看資料清理指令。',
    '・#help 資料：查看各 Sheet 用途。'
  ].join('\n');
}

function getHelpDataText_() {
  return [
    '主要資料表：',
    '',
    '・ConversationLog：原始對話紀錄。',
    '・TopicHighlights：#畫重點 的人工重點。',
    '・WeeklySummary：#封存本週話題 與 #封存本週新聞 的長期記憶，透過 ArchiveType 區分來源。',
    '・WebTaskQueue：#懶人包 與網址分析任務。',
    '・WebSummary：網址快讀摘要。',
    '・NewsUrlQueue：多網址或同步整理失敗時的待處理網址。',
    '・NewsInbox：新聞素材池，保存短 Brief、完整 Outline、候選事件提示 StoryKey、SpecialTopic、CategoryReason、CategoryConfidence、MatchedEntities 與 ClassificationWarning。',
    '・PendingReplies：背景任務完成後等待交付的回覆。'
  ].join('\n');
}

function getHelpAllText_() {
  return [
    getHelpText(),
    '',
    '---',
    getHelpAdvancedText_(),
    '',
    '---',
    getHelpCleanupText_(),
    '',
    '---',
    getHelpAdminText_(),
    '',
    '---',
    getHelpDataText_()
  ].join('\n');
}
