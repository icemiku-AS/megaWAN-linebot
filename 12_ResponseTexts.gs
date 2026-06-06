// ======================================================
// 12_ResponseTexts.gs
// 小浣固定回覆文字層。集中管理「不經過 LLM」的系統回覆、版本資訊與版本紀錄。
//
// 小浣 LINE Bot v1.10.1 News Inbox Hotfix
//
// 設計說明：
// 1. 這個檔案只放固定文字與簡單格式化，不呼叫 DeepSeek / Gemini。
// 2. 目的不是讓小浣變吵，而是讓非 LLM 回覆也維持一致人格。
// 3. v1.10.1 更新 NewsInbox hotfix 的版本資訊。
// ======================================================

const BOT_CURRENT_VERSION = 'v1.10.1 News Inbox Hotfix';
const BOT_CURRENT_VERSION_DATE = '2026-06-06';

const BOT_VERSION_HISTORY = [
  {
    version: 'v1.10.1 News Inbox Hotfix',
    date: '2026-06-06',
    summary: '修正 NewsInbox 自動分類不足仍入庫，以及 #本週新聞 LINE 換行格式不佳的問題。',
    changes: [
      '自動網址分類若回傳無效分類、待分類，或標題是網址且簡介空白，會回到 NewsUrlQueue 重試。',
      '避免分類不足的資料直接以 ok 寫入 NewsInbox。',
      '#本週新聞 改由程式端固定排版，確保分類、標題、來源網址與節目潛力分行顯示。',
      '#新聞補充 保留 DeepSeek 自然語言解析，人工補充仍可寫入待分類。'
    ]
  },
  {
    version: 'v1.10.0 News Inbox Edition',
    date: '2026-06-06',
    summary: '將直接貼網址改為新聞素材池收件分類，新增 NewsUrlQueue、NewsInbox、#本週新聞、#新聞補充與 #懶人包。',
    changes: [
      '直接貼網址不再自動吐懶人包，改為收進 NewsInbox 新聞素材池。',
      '新增 NewsUrlQueue，由 time-driven trigger 每次最多處理 2 筆網址。',
      '新增 Gemini 新聞入庫分類，儲存標題、網址、分類、50 字內簡介、觀點標籤與節目潛力。',
      '新增 #本週新聞，依分類整理最近 7 天素材，只輸出標題、來源網址與節目潛力。',
      '新增 #新聞補充，允許使用者用自然語言加網址人工補進 NewsInbox。',
      '新增 #懶人包 作為明確網址快讀指令，#讀網址 繼續保留。'
    ]
  },
  {
    version: 'v1.9.3 Gemini JSON Mode Hotfix',
    date: '2026-06-05',
    summary: '修正 Gemini structured output 設定與目前 API / 模型組合不相容，導致網址快讀與正文抽取直接 400 失敗的問題。',
    changes: [
      '修正 08_GeminiService.gs 的 generationConfig。',
      '將 Gemini 輸出設定從 responseFormat.text.mimeType/schema 退回 responseMimeType: application/json。',
      '保留 schema 函式作為程式端資料契約與未來升級參考。',
      '維持 Google Apps Script 架構，不更換模型。'
    ]
  },
  {
    version: 'v1.9.2 Humanized System Reply Edition',
    date: '2026-06-05',
    summary: '集中管理小浣不經過 LLM 的固定回覆文字，讓系統提示、任務接收、錯誤訊息與版本查詢更有人味。',
    changes: [
      '新增 12_ResponseTexts.gs，集中管理固定回覆文字。',
      '新增 #版本 與 #版本紀錄。',
      '調整任務接收、pending reply、reset、清空紀錄、記錄、錯誤提示等固定回覆語氣。'
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
  }
];

function getBotVersionText_() {
  const current = BOT_VERSION_HISTORY[0];
  return [
    '小浣目前版本：',
    BOT_CURRENT_VERSION,
    '',
    '更新日期：' + BOT_CURRENT_VERSION_DATE,
    '',
    '這版我把新聞素材池補上兩個小修：分類不足會回到佇列重試，#本週新聞 也會乖乖換行。',
    '',
    '本次新增 / 修正：',
    formatBulletList_(current.changes),
    '',
    '想看一路以來的更新，可以輸入：',
    '#版本紀錄'
  ].join('\n');
}

function getBotVersionHistoryText_() {
  const blocks = BOT_VERSION_HISTORY.map(function(item) {
    return [item.version + '｜' + item.date, item.summary, formatBulletList_(item.changes)].join('\n');
  });

  return ['我把目前記得的版本紀錄翻出來了：', '', blocks.join('\n\n'), '', '提醒：這裡是小浣執行時內建的版本摘要，完整歷史仍以 GitHub 的 99_changelog.md 為準。'].join('\n');
}

function formatBulletList_(items) {
  if (!items || !Array.isArray(items) || items.length === 0) return '・目前沒有列出細項。';
  return items.map(function(item) { return '・' + item; }).join('\n');
}

// ======================================================
// 任務與 pending reply 相關回覆
// ======================================================

function getBotTextWebTaskAccepted_(taskType, urlCount) {
  const countText = urlCount > 1 ? '前 ' + urlCount + ' 個網址' : '這個網址';

  if (taskType === TASK_TYPE_PROGRAM_TOPIC_ANALYSIS) {
    return ['收到，' + countText + '我先叼回素材堆裡整理。', '我會把事件重點、可聊切角和需要補查的地方一起翻出來。', '等我處理完，下一次群組有人說話時，我就把結果送上來。'].join('\n');
  }

  return ['收到，' + countText + '我會做成懶人包。', '整理好後，下一次群組有人說話時，我會把快讀摘要送上來。'].join('\n');
}

function getBotTextNewsInboxAccepted_(urlCount) {
  const countText = urlCount > 1 ? '這 ' + urlCount + ' 個網址' : '這篇';
  return ['收到，' + countText + '我先收進本週新聞素材池。', '我會在背景慢慢分類整理；之後用 #本週新聞，就可以看到這週的剪報。'].join('\n');
}

function getBotTextPendingDelivery_(pendingText, alsoAcceptedNewUrl) {
  let text = ['我剛剛那包資料整理好了，先端上來：', '', pendingText || ''].join('\n');
  if (alsoAcceptedNewUrl) {
    text += ['','另外，你這次貼的新網址我也收到了。', '如果是一般貼網址，我會放進 NewsInbox；如果是 #懶人包 或 #讀網址，我會照指令做快讀。'].join('\n');
  }
  return text;
}

function getBotTextNewsUrlFailed_(url, errorMessage) {
  return ['小浣剛剛有一個網址讀不到，可能是網站擋爬蟲、需要登入，或內容抓取失敗：', '', url || '', '', '原因：', String(errorMessage || '未知錯誤').slice(0, 1000), '', '你可以用 #新聞補充 加上網址和簡單說明，我再幫你手動放進本週新聞素材池。'].join('\n');
}

function getBotTextManualNewsSupplementNeedUrl_() {
  return ['我大概懂你想補一個素材，不過新聞素材池需要有網址，之後你們才找得到原文。', '你可以用這種方式丟我：', '#新聞補充 這篇大概是在講某某事件，偏社群輿論，節目潛力高 https://example.com'].join('\n');
}

function getBotTextManualNewsSupplementSaved_(parsed) {
  return ['收到，我幫你補進本週新聞素材池了。', '我先理解成：' + (parsed.category || '待分類') + '，節目潛力：' + (parsed.topicPotential || '中') + '。'].join('\n');
}

function getBotTextWeeklyNewsNoData_() {
  return ['我翻了一下，最近 7 天 NewsInbox 還沒有可整理的新聞素材。', '你可以先直接貼網址讓我收進素材池，或用 #新聞補充 手動補一筆。'].join('\n');
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
  return ['好，這個聊天室的短期記憶我先清掉了。', '剛剛腦袋裡暫存的小紙條會消失，但 Google Sheet 裡的長期紀錄還在，不會被我亂丟。'].join('\n');
}

function getBotTextClearWarning_() {
  return ['先等一下，這個動作比較大包。', '你準備清空的是這個聊天室在 ConversationLog 裡的長期紀錄。', '', '不會影響：', '・其他私訊', '・其他群組', '・WeeklySummary 封存摘要', '・WebSummary 網址快讀素材池', '・NewsInbox 新聞素材池', '', '如果你真的確定要丟掉這包紀錄，請輸入：', '#清空紀錄 確認'].join('\n');
}

function getBotTextClearDone_(deletedCount) {
  return ['我已經把這個聊天室的 ConversationLog 長期紀錄清掉了。', '短期對話記憶也一起清空。', '', '這次刪除筆數：' + deletedCount, '', 'WeeklySummary、WebSummary 和 NewsInbox 沒有被刪掉，這幾包素材我會繼續留著。'].join('\n');
}

function getBotTextNoteSaved_() { return '記好了，這段我先收進紀錄袋。'; }

function getBotTextNoteEmpty_() {
  return ['你可以這樣叫我記東西：', '#記錄 這段內容很重要', '', '我會把它收進 ConversationLog，之後整理話題時就比較不容易漏掉。'].join('\n');
}

function getBotTextNoRecentSummaryData_() {
  return ['目前素材還有點少，我翻不到足夠的對話紀錄可以整理。', '你們可以再聊一點，或直接貼一段想摘要的內容給我。'].join('\n');
}

function getBotTextNoRecentReviewData_() {
  return ['目前素材還不太夠，我翻不到足夠的對話紀錄可以回顧。', '等群組多累積一些討論，我就比較能幫你們整理脈絡和下一步。'].join('\n');
}

function getBotTextArchiveError_() {
  return '我剛剛封存本週話題時卡住了。可能是紀錄太長、API 暫時不穩，或資料格式不太聽話。可以稍後再叫我試一次。';
}

function getBotTextAiError_() {
  return '我剛剛連接 AI、讀取網頁或翻紀錄時卡住了。你可以稍後再叫我一次，或把任務拆小一點給我處理。';
}

function getBotTextArchiveNoData_() { return '目前還沒有足夠的對話紀錄可以封存。等群組多累積一點討論，我再幫你把重點收進 WeeklySummary。'; }
function getBotTextNoTopicContextForAnalysis_() { return '目前我還翻不到足夠的對話紀錄、網址快讀摘要或封存記憶可以分析。你可以先貼一個網址，或多補一點想討論的脈絡。'; }
function getBotTextNoTopicContextForIntegration_() { return '目前我還翻不到足夠的聊天紀錄、網址快讀摘要或封存記憶可以統整。你們可以先丟幾個素材進來，我再幫你們整理成話題地圖。'; }

function getBotTextArchiveDone_(archiveJson, recentCount) {
  return ['本週話題我收好了，已經放進 WeeklySummary。', '', '主題：' + (archiveJson.topicTitle || '未命名主題'), '', '摘要：', archiveJson.summary || '已建立摘要，但內容比較短。', '', '這次封存了 ' + recentCount + ' 則訊息。', '之後你們再聊到相關主題時，我就能把這份極簡記憶翻出來接著用。'].join('\n');
}

// ======================================================
// 網址快讀結果格式
// ======================================================

function getBotTextWebTaskFailed_(errorMessage) {
  return ['我剛剛翻這個網址任務時卡住了。', '', '可能原因：', '・網址擋爬蟲', '・內容需要登入', '・頁面格式太亂', '・API 暫時不穩', '', '錯誤訊息：', String(errorMessage || '未知錯誤').slice(0, 1000)].join('\n');
}

function getBotTextSingleUrlFailed_(index, url, errorMessage) {
  return ['【網址 ' + (index + 1) + '】', url, '', '這個網址我翻到一半卡住了：', errorMessage || '讀取失敗'].join('\n');
}

function getBotTextLazySummaryBlock_(result, index, keyPointsText, metaText) {
  return ['【網址快讀 ' + (index + 1) + '】', '標題：' + (result.title || '未取得標題'), metaText, '', '我翻到的重點是：', result.summary || '未取得摘要', '', '可以先抓這幾點：', keyPointsText, ''].join('\n');
}
