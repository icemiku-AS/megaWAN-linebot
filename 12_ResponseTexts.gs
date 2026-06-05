// ======================================================
// 12_ResponseTexts.gs
// 小浣固定回覆文字層。集中管理「不經過 LLM」的系統回覆、版本資訊與版本紀錄。
//
// 小浣 LINE Bot v1.9.2 Humanized System Reply Edition
//
// 設計說明：
// 1. 這個檔案只放固定文字與簡單格式化，不呼叫 DeepSeek / Gemini。
// 2. 目的不是讓小浣變吵，而是讓非 LLM 回覆也維持一致人格：親切、可靠、帶一點浣熊翻素材感。
// 3. 主流程檔案（例如 01_Main.gs）應盡量只呼叫這裡的函式，不直接散落大量硬編文字。
// 4. 若未來想調整小浣語氣，優先改這個檔案。
// ======================================================

// ======================================================
// 版本資料
// ======================================================

const BOT_CURRENT_VERSION = 'v1.9.2 Humanized System Reply Edition';
const BOT_CURRENT_VERSION_DATE = '2026-06-05';

const BOT_VERSION_HISTORY = [
  {
    version: 'v1.9.2 Humanized System Reply Edition',
    date: '2026-06-05',
    summary: '集中管理小浣不經過 LLM 的固定回覆文字，讓系統提示、任務接收、錯誤訊息與版本查詢更有人味。',
    changes: [
      '新增 12_ResponseTexts.gs，集中管理固定回覆文字。',
      '新增 #版本，可查看目前版本與本版新增功能。',
      '新增 #版本紀錄，可查看主要版本更新摘要。',
      '調整任務接收、pending reply、reset、清空紀錄、記錄、錯誤提示等固定回覆語氣。',
      '維持 Google Apps Script 架構，不導入 Node.js / npm。'
    ]
  },
  {
    version: 'v1.9.1 Structured Gemini Output Edition',
    date: '2026-06-05',
    summary: '將 Gemini 網頁快讀摘要與正文抽取改為 structured output schema，提升 JSON 回傳穩定性。',
    changes: [
      '新增 Gemini 快讀摘要 schema。',
      '新增 Gemini 正文抽取 schema。',
      '新增 Gemini JSON generation config helper。',
      '新增 normalizer helper，對字串、陣列、數字與 enum 做最後防守。',
      '保留 parseJsonObjectLoose() fallback，降低任務中斷風險。'
    ]
  },
  {
    version: 'v1.9.0 Service Split Edition',
    date: '2026-06-05',
    summary: '拆分原本過於肥大的 AI 邏輯檔，建立目前的 Google Apps Script 分檔架構。',
    changes: [
      '新增 03_Utils.gs、04_Storage.gs、05_Memory.gs、06_WebReader.gs、07_WebTaskQueue.gs、08_GeminiService.gs、09_DeepSeekService.gs、10_TopicFeatures.gs。',
      '將 prompt 管理調整為 11_Prompts.gs。',
      '維持原功能邏輯，主要改善可維護性。'
    ]
  },
  {
    version: 'v1.7.1',
    date: '2026-06-04',
    summary: '調整小浣回覆內容、重新定義程式版號，並將單次讀網址數量調整為 3 個。',
    changes: [
      '調整小浣回覆內容，讓回答更精簡。',
      '重新定義程式版號。',
      '一次性讀網址調整為 3 個。'
    ]
  },
  {
    version: 'v1.7.0 Topic Pool Edition',
    date: '2026-06-04',
    summary: '建立網址素材池與節目話題統整流程，讓貼網址可以進入 WebSummary，供 #統整話題 使用。',
    changes: [
      '群組直接貼網址會自動進入快讀摘要任務。',
      '新增 WebSummary 作為網址快讀素材池。',
      '新增 #節目話題分析 與 #統整話題 的近期素材整合邏輯。'
    ]
  },
  {
    version: 'v1.6.2 Queue Edition',
    date: '2026-06-04',
    summary: '建立 WebTaskQueue 與 PendingReplies，讓網址處理可以排程背景處理，完成後於下次訊息交付。',
    changes: [
      '網址任務寫入 WebTaskQueue。',
      'time-driven trigger 背景處理任務。',
      '處理完成後寫入 PendingReplies。'
    ]
  }
];

// ======================================================
// 版本查詢回覆
// ======================================================

function getBotVersionText_() {
  const current = BOT_VERSION_HISTORY[0];

  return [
    '小浣目前版本：',
    BOT_CURRENT_VERSION,
    '',
    '更新日期：' + BOT_CURRENT_VERSION_DATE,
    '',
    '這版我主要升級的是「說話方式」和「版本查詢」。',
    '以前有些地方像後台系統在吐訊息，現在我會盡量用比較像小浣自己的方式回覆。',
    '',
    '本次新增：',
    formatBulletList_(current.changes),
    '',
    '想看一路以來的更新，可以輸入：',
    '#版本紀錄'
  ].join('\n');
}

function getBotVersionHistoryText_() {
  const blocks = BOT_VERSION_HISTORY.map(function(item) {
    return [
      item.version + '｜' + item.date,
      item.summary,
      formatBulletList_(item.changes)
    ].join('\n');
  });

  return [
    '我把目前記得的版本紀錄翻出來了：',
    '',
    blocks.join('\n\n'),
    '',
    '提醒：這裡是小浣執行時內建的版本摘要，完整歷史仍以 GitHub 的 99_changelog.md 為準。'
  ].join('\n');
}

function formatBulletList_(items) {
  if (!items || !Array.isArray(items) || items.length === 0) {
    return '・目前沒有列出細項。';
  }

  return items.map(function(item) {
    return '・' + item;
  }).join('\n');
}

// ======================================================
// 任務與 pending reply 相關回覆
// ======================================================

function getBotTextWebTaskAccepted_(taskType, urlCount) {
  const countText = urlCount > 1
    ? '前 ' + urlCount + ' 個網址'
    : '這個網址';

  if (taskType === TASK_TYPE_PROGRAM_TOPIC_ANALYSIS) {
    return [
      '收到，' + countText + '我先叼回素材堆裡整理。',
      '我會把事件重點、可聊切角和需要補查的地方一起翻出來。',
      '等我處理完，下一次群組有人說話時，我就把結果送上來。'
    ].join('\n');
  }

  return [
    '收到網址，我先鑽進素材堆裡翻一下重點。',
    '整理好後，下一次群組有人說話時，我會把快讀摘要送上來。'
  ].join('\n');
}

function getBotTextPendingDelivery_(pendingText, alsoAcceptedNewUrl) {
  let text = [
    '我剛剛那包資料整理好了，先端上來：',
    '',
    pendingText || ''
  ].join('\n');

  if (alsoAcceptedNewUrl) {
    text += [
      '',
      '另外，你這次貼的新網址我也收到了。',
      '我會接著翻，整理好再送上來。'
    ].join('\n');
  }

  return text;
}

// ======================================================
// 一般系統提示
// ======================================================

function getBotTextUnsupportedMessage_() {
  return '目前我先支援文字訊息。圖片、貼圖、語音這些我還不能穩穩處理，之後可以再幫我加功能。';
}

function getBotTextEmptyReply_() {
  return '我剛剛沒有產生有效回覆，可能是資料太少或模型沒有順利吐出內容。你可以換個說法再叫我一次。';
}

function getBotTextNoReadableUrl_() {
  return '我翻了一下，沒有找到可以讀取的網址。你可以確認一下連結是不是完整，或重新貼一次。';
}

function getBotTextResetDone_() {
  return [
    '好，這個聊天室的短期記憶我先清掉了。',
    '剛剛腦袋裡暫存的小紙條會消失，但 Google Sheet 裡的長期紀錄還在，不會被我亂丟。'
  ].join('\n');
}

function getBotTextClearWarning_() {
  return [
    '先等一下，這個動作比較大包。',
    '你準備清空的是這個聊天室在 ConversationLog 裡的長期紀錄。',
    '',
    '不會影響：',
    '・其他私訊',
    '・其他群組',
    '・WeeklySummary 封存摘要',
    '・WebSummary 網址快讀素材池',
    '',
    '如果你真的確定要丟掉這包紀錄，請輸入：',
    '#清空紀錄 確認'
  ].join('\n');
}

function getBotTextClearDone_(deletedCount) {
  return [
    '我已經把這個聊天室的 ConversationLog 長期紀錄清掉了。',
    '短期對話記憶也一起清空。',
    '',
    '這次刪除筆數：' + deletedCount,
    '',
    'WeeklySummary 封存摘要和 WebSummary 網址快讀素材池沒有被刪掉，這兩包資料我會繼續留著。'
  ].join('\n');
}

function getBotTextNoteSaved_() {
  return '記好了，這段我先收進紀錄袋。';
}

function getBotTextNoteEmpty_() {
  return [
    '你可以這樣叫我記東西：',
    '#記錄 這段內容很重要',
    '',
    '我會把它收進 ConversationLog，之後整理話題時就比較不容易漏掉。'
  ].join('\n');
}

function getBotTextNoRecentSummaryData_() {
  return [
    '目前素材還有點少，我翻不到足夠的對話紀錄可以整理。',
    '你們可以再聊一點，或直接貼一段想摘要的內容給我。'
  ].join('\n');
}

function getBotTextNoRecentReviewData_() {
  return [
    '目前素材還不太夠，我翻不到足夠的對話紀錄可以回顧。',
    '等群組多累積一些討論，我就比較能幫你們整理脈絡和下一步。'
  ].join('\n');
}

function getBotTextArchiveError_() {
  return '我剛剛封存本週話題時卡住了。可能是紀錄太長、API 暫時不穩，或資料格式不太聽話。可以稍後再叫我試一次。';
}

function getBotTextAiError_() {
  return '我剛剛連接 AI、讀取網頁或翻紀錄時卡住了。你可以稍後再叫我一次，或把任務拆小一點給我處理。';
}

function getBotTextArchiveNoData_() {
  return '目前還沒有足夠的對話紀錄可以封存。等群組多累積一點討論，我再幫你把重點收進 WeeklySummary。';
}

function getBotTextNoTopicContextForAnalysis_() {
  return '目前我還翻不到足夠的對話紀錄、網址快讀摘要或封存記憶可以分析。你可以先貼一個網址，或多補一點想討論的脈絡。';
}

function getBotTextNoTopicContextForIntegration_() {
  return '目前我還翻不到足夠的聊天紀錄、網址快讀摘要或封存記憶可以統整。你們可以先丟幾個素材進來，我再幫你們整理成話題地圖。';
}

function getBotTextArchiveDone_(archiveJson, recentCount) {
  return [
    '本週話題我收好了，已經放進 WeeklySummary。',
    '',
    '主題：' + (archiveJson.topicTitle || '未命名主題'),
    '',
    '摘要：',
    archiveJson.summary || '已建立摘要，但內容比較短。',
    '',
    '這次封存了 ' + recentCount + ' 則訊息。',
    '之後你們再聊到相關主題時，我就能把這份極簡記憶翻出來接著用。'
  ].join('\n');
}

// ======================================================
// 網址快讀結果格式
// ======================================================

function getBotTextWebTaskFailed_(errorMessage) {
  return [
    '我剛剛翻這個網址任務時卡住了。',
    '',
    '可能原因：',
    '・網址擋爬蟲',
    '・內容需要登入',
    '・頁面格式太亂',
    '・API 暫時不穩',
    '',
    '錯誤訊息：',
    String(errorMessage || '未知錯誤').slice(0, 1000)
  ].join('\n');
}

function getBotTextSingleUrlFailed_(index, url, errorMessage) {
  return [
    '【網址 ' + (index + 1) + '】',
    url,
    '',
    '這個網址我翻到一半卡住了：',
    errorMessage || '讀取失敗'
  ].join('\n');
}

function getBotTextLazySummaryBlock_(result, index, keyPointsText, metaText) {
  return [
    '【網址快讀 ' + (index + 1) + '】',
    '標題：' + (result.title || '未取得標題'),
    metaText,
    '',
    '我翻到的重點是：',
    result.summary || '未取得摘要',
    '',
    '可以先抓這幾點：',
    keyPointsText,
    ''
  ].join('\n');
}
