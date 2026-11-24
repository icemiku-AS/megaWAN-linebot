// ======================================================
// 02_LineCommands.gs
// 用途：LINE transport：指令解析、Help、Reply API 與長文字分段。
//
// 職責與協作：
// 1. 01_Main.gs 使用本檔解析指令、顯示 Help 與傳送回覆。
// 2. 固定回覆由 03_ResponseTexts.gs 提供；AI、Reader、News 與 Sheet 流程交由各功能檔負責。
//
// 維護注意：
// 1. 指令名稱、參數解析、Help 分層與 reply token 使用方式須保持相容。
// 2. 單次 Reply API 最多五則訊息；有來源時保留最後一格，主回答沿用既有 splitter。
// ======================================================

function hasTriggerPrefix(text) {
  return TRIGGER_PREFIXES.some(function(prefix) {
    return text.startsWith(prefix);
  });
}

function stripLineBotAddress_(text) {
  return String(text || '').trim()
    .replace(/^(?:[#@]小浣|(?:[#@]?MEGA浣|小浣)(?=[，,：:\s]|幫我|麻煩|請|$))[，,：:\s]*/i, '');
}

function getLineRequestClauses_(text) {
  const plain = String(text || '').split(/\r?\n/).map(stripUrlsForWeeklyEditorial_).join('\n')
    .replace(/(?:順便|另外|同時|並且|以及|(?:並|再|也)(?=請|幫我|上網|聯網|讀|查|比對|確認|摘要|整理))[，,\t ]*/g, '\n');
  return (plain.match(/[^，,。！？!?；;\r\n]+[。！？!?]*/g) || []).map(stripLineBotAddress_).filter(Boolean);
}

function stripLineResearchLead_(text) {
  return text.replace(/^(?:(?:也|再|先|請問|請你?|麻煩你?|幫我|幫忙|可以|能否|可否|能不能|想請)\s*)*/, '');
}

// 查詢的對象與範圍由同一分句決定，另一句查群內資料不會蓋掉連帶的外部問題。
function isExplicitWebSearchRequest_(text) {
  return getLineRequestClauses_(text).some(function(clause) {
    if (getAiInternalResearchKinds_(clause).length ||
        /(?:不用|不必|不要|別)(?:再|幫我|先)?\s*(?:上網|聯網|搜尋|搜索|查證)/.test(clause)) return false;
    const action = stripLineResearchLead_(clause);
    if (/^(?:去|到|用)?(?:上網|聯網|網路|網絡|網上|外部).{0,8}(?:查|找|搜)|^(?:查|找|搜尋|搜索).{0,8}(?:網路|網絡|網上|外部)/.test(action)) return true;
    return /^(?:搜尋|搜索)(?!功能|欄|框|引擎|結果|介面)|^查(?:一下|證(?:一下|這|那|下列))/.test(action) ||
      /^(?:請你?|麻煩你?|能否|可否|可以)?\s*(?:幫我|幫忙|請|麻煩)\s*(?:查(?!看)|找|搜尋|搜索)|^(?:請|麻煩|能否|可否|可以)\s*查證/.test(clause);
  });
}

function isLineUrlResearchRequest_(text, explicitlyAddressed, hasUrl) {
  if (!(hasUrl === undefined ? shouldUseWebReading(text) : hasUrl)) return false;
  return isExplicitWebSearchRequest_(text) || getLineRequestClauses_(text).some(function(clause) {
    return isLineUrlResearchClause_(clause, explicitlyAddressed);
  });
}

function isLineUrlResearchClause_(clause, explicitlyAddressed) {
  const action = stripLineResearchLead_(clause).replace(/[。！？!?]+$/, '').trim();
  const readVerb = /^(?:讀取|閱讀|讀一下|讀|看一下|看看|看|解讀|比對|整理|摘要|總結|分析|抓重點|列出重點)\s*/;
  const match = readVerb.exec(action);
  if (match) {
    const target = action.slice(match[0].length);
    if (/^(?:一下|(?:這|那)(?:篇|則|個)|原文|原帖|網址|連結|文章|的?(?:內容|重點))/.test(target) ||
        !target && (explicitlyAddressed || action !== clause || action.length > 1)) return true;
  }
  return /^(?:(?:這|那)?(?:篇|則|個|連結|網址|文章)|原文|原帖).{0,24}(?:重點(?:是|在哪|有哪些)|內容是什麼|說了什麼|在講什麼|收過|重複|聊過)/.test(action) ||
    /^(?:查|確認|問|有沒有|是否|跟|和|與).{0,24}(?:收過|重複|聊過)/.test(action) ||
    /^(?:重點(?:是什麼|在哪|有哪些)|給我(?:(?:這|那)(?:篇|則)的?)?重點)/.test(action) ||
    explicitlyAddressed && action === '重點';
}

function getUserLogMode(text) {
  if (text.startsWith('#本週新聞')) return 'weekly_news_command';
  if (text.startsWith('#狀態回報')) return 'news_status_report_command';
  if (text.startsWith('#新聞補充')) return 'manual_news_supplement_command';
  if (text.startsWith('#封存本週新聞')) return 'archive_news_command';
  if (text.startsWith('#清空') && getCleanupCommandInfo_(text)) return 'cleanup_command';
  if (text.startsWith('#版本紀錄')) return 'version_history_command';
  if (text.startsWith('#版本')) return 'version_command';
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

  } else if (text.startsWith('#本週新聞')) {
    mode = 'weekly_news';
    userPrompt = text.replace('#本週新聞', '').trim();

  } else if (text.startsWith('#狀態回報')) {
    mode = 'news_status_report';
    userPrompt = text.replace('#狀態回報', '').trim();

  } else if (text.startsWith('#新聞補充')) {
    mode = 'manual_news_supplement';
    userPrompt = text.replace('#新聞補充', '').trim();

  } else if (text.startsWith('#封存本週新聞')) {
    mode = 'archive_weekly_news';
    userPrompt = text.replace('#封存本週新聞', '').trim();

  } else if (text.startsWith('#小浣')) {
    mode = 'chat';
    userPrompt = text.replace('#小浣', '').trim();
  }

  if (!userPrompt) {
    if (mode === 'weekly_news') {
      userPrompt = '請整理最近 7 天 NewsInbox 中的新聞素材。';
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

function replyToLine(replyToken, text, throwOnHttpError, finalMessageText, receipt) {
  const token = getRequiredScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
  const finalText = String(finalMessageText || '').trim();
  const mainMessageLimit = LINE_REPLY_MAX_MESSAGE_COUNT - (finalText ? 1 : 0);
  const messageTexts = splitTextForLineMessagesWithMeta_(text, mainMessageLimit).messages;
  const safeMessageTexts = messageTexts.length ? messageTexts : [getBotTextEmptyReply_()];
  if (finalText) safeMessageTexts.push(finalText.slice(0, getLineMessageSafeSliceIndex_(finalText, LINE_TEXT_MESSAGE_MAX_LENGTH)));

  const payload = {
    replyToken: replyToken,
    messages: safeMessageTexts.slice(0, LINE_REPLY_MAX_MESSAGE_COUNT).map(function(messageText) {
      const safeText = String(messageText || getBotTextEmptyReply_());
      return {
        type: 'text',
        text: safeText.slice(0, getLineMessageSafeSliceIndex_(safeText, LINE_TEXT_MESSAGE_MAX_LENGTH))
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
    timeoutSeconds: LINE_REPLY_TIMEOUT_SECONDS
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

    if (receipt) {
      receipt.sentAtMs = Date.now();
      receipt.messageIds = readLineSentMessageIds_(response);
    }
    return true;
  } catch (error) {
    // 保留既有拋錯行為，但不讓含 request/token 的外部例外流入上層 stack log。
    throw new Error('LINE Reply API request failed.');
  }
}

function readLineSentMessageIds_(response) {
  try {
    const body = response.getContentText();
    if (typeof body !== 'string' || body.length > 16000) return [];
    // LINE 也可能送 JSON 數字。解析前保留其原始位數，略過字串內看似 id 欄位的內容。
    const exact = body.replace(/("id"\s*:\s*)(\d{1,64})(?=\s*[,}])|"(?:\\.|[^"\\])*"/g,
      function(token, field, digits) { return field ? field + '"' + digits + '"' : token; });
    const sentMessages = JSON.parse(exact).sentMessages;
    return Array.isArray(sentMessages) ? sentMessages.slice(0, LINE_REPLY_MAX_MESSAGE_COUNT).map(function(message) {
      return message && isExactLineMessageId_(message.id) ? message.id : '';
    }) : [];
  } catch (ignore) { return []; }
}

// UTF-16 配對字元不可跨訊息或截斷邊界，切點必要時退一個單位。
function getLineMessageSafeSliceIndex_(text, index) {
  return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(text.slice(index - 1, index + 1)) ? index - 1 : index;
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
  const omittedNotice = '內容太多，後面已省略。可以用 #本週新聞 分類 <分類名> 或 #本週新聞 詳細 再查詢。';
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

    let splitIndex = findLineMessageSplitIndex_(remainingText, maxLength);
    // 短段落不能耗盡後續訊息容量；週編輯台仍由 fitter 驗證完整區塊。
    if (remainingText.slice(splitIndex).trim().length > (maxCount - messages.length - 1) * maxLength) {
      splitIndex = maxLength;
    }
    splitIndex = getLineMessageSafeSliceIndex_(remainingText, splitIndex);
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
      lastMessage = lastMessage.slice(0,
        getLineMessageSafeSliceIndex_(lastMessage, Math.max(0, maxLength - suffix.length))).trim();
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
    return '本次已使用網路搜尋，但搜尋服務未提供可列出的來源連結。';
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

  // 完整區塊可能出現在 1200 字以前；先保留整段，避免切開下一則新聞後被 fitter 省略。
  const paragraphIndex = safeText.lastIndexOf('\n\n', safeMax);
  if (paragraphIndex > 0) return paragraphIndex;

  const semanticPatterns = [
    /\n【[^】]+】/g,
    /\n(?:科技與 AI|社群輿論|ACG娛樂|商業財經|國際政治|公共政策|生活文化|體育娛樂|待分類)[：:]/g,
    /\n\d+\.\s/g
  ];

  for (let i = 0; i < semanticPatterns.length; i++) {
    const index = findLastRegexIndexBefore_(safeText, semanticPatterns[i], safeMax, minSemanticSplitIndex);
    if (index > 0) return index;
  }

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
    '・群組可用 LINE 點名小浣，或在訊息裡加 #小浣。也可引用群友文字後提問，找不到原文時請補貼內容。',
    '・私訊可直接傳圖片或回覆圖片提問；群組請回覆圖片並用 #小浣 <問題>。舊 #小浣 看圖 仍可使用。',
    '・引用圖片可問「幫我查最新進度」；一般聊天也可問「我們收過這則新聞嗎？」或「上週封存了什麼？」。',
    '・研究工具只讀目前聊天室資料；新增、封存、清理仍使用明確指令。',
    '・看圖支援 JPEG/PNG、每張最多 4 MiB；不永久保存原圖，逾時請重送。',
    '・一般聊天預設不聯網；說「幫我查」或「搜尋」才會開 Google 搜尋，完成後另附來源。',
    '・對小浣說「叫我毛球」或「記住我不吃香菜」，可以設定這個聊天室的稱呼和個人筆記。',
    '・#我的記憶 查看自己在本聊天室的設定。#忘記我 清除自己的稱呼和筆記。',
    '・貼網址：群組先收件，符合條件時會回一句點評。私訊單篇可直接回覆簡介。',
    '・#本週新聞：整合最近 7 天群組話題、焦點故事線與其他分類新聞。',
    '・叫小浣把說清楚的事件註記到本週新聞。成功儲存的手動註記會出現在 #本週新聞。',
    '・#本週新聞 高潛力：只看高潛力素材，依分類精簡顯示。',
    '・#狀態回報：查看最近 7 天收件、佇列及固定週期新聞封存進度。',
    '・#新聞補充 文字 + 網址：人工補充新聞素材。',
    '・#封存本週新聞：已設定聊天室補存最早到期的週三中午週期；未設定時封存最近 7 天。',
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
    '新聞檢視',
    '・#本週新聞 詳細：依分類展開完整大綱、切角、節目潛力與分類。',
    '・#本週新聞 精簡：等同 #本週新聞，使用週編輯台整理群組話題與多篇故事線。',
    '・#本週新聞 分類 <分類名>：只看指定分類，依分類精簡顯示。',
    '・#本週新聞 診斷：檢查分類、故事線與重複素材。'
  ].join('\n');
}

function getHelpCleanupText_() {
  return [
    '資料清理指令：',
    '',
    '所有清理只處理目前聊天室，不會影響其他私訊或群組。',
    '所有清理都需要二段確認。',
    '',
    '・#清空紀錄：ConversationLog，並清除短期記憶。個人記憶另用 #忘記我 清除。',
    '・#清空封存：本聊天室的全部 WeeklySummary 封存。',
    '・#清空新聞：NewsInbox、NewsUrlQueue 與本週手動註記。',
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
    '・#狀態回報：查看新聞收件、背景處理與封存進度。',
    '・#reset：清除本聊天室短期記憶，近期前文與續問也從現在重新累積。個人記憶會從 Sheet 重讀。'
  ].join('\n');
}

function getHelpDataText_() {
  return [
    '主要資料表：',
    '',
    '・ConversationLog：原始對話紀錄。',
    '・WeeklySummary：新聞封存與舊話題封存，依 ArchiveType 區分。',
    '・NewsUrlQueue：群組收件、多網址與同步整理失敗的待處理佇列。',
    '・NewsInbox：新聞素材、分類、簡介、大綱及故事線等資訊。',
    '・PendingReplies：等待交付的背景回覆。',
    '・MemberMemory：依聊天室與成員保存本人設定的稱呼和筆記。'
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
