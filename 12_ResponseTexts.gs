// ======================================================
// 12_ResponseTexts.gs
// 小浣固定回覆文字層。集中管理「不經過 LLM」的系統回覆、版本資訊與版本紀錄。
//
// 小浣 LINE Bot v1.10.6 PTT Over18 Detection Hotfix
//
// 設計說明：
// 1. 這個檔案只放固定文字與簡單格式化，不呼叫 DeepSeek / Gemini。
// 2. 目的不是讓小浣變吵，而是讓非 LLM 回覆也維持一致人格。
// 3. v1.10.6 是 PTT reader 的小型 hotfix；實際修正已整合於 16_ReaderLayer.gs。
// ======================================================

const BOT_CURRENT_VERSION = 'v1.10.6 PTT Over18 Detection Hotfix';
const BOT_CURRENT_VERSION_DATE = '2026-06-08';

const BOT_VERSION_HISTORY = [
  {
    version: 'v1.10.6 PTT Over18 Detection Hotfix',
    date: '2026-06-08',
    summary: '修正 PTT 正常文章頁被誤判成滿 18 歲確認頁的問題。',
    changes: [
      '在 16_ReaderLayer.gs 內修正 PTT over18 gate 偵測邏輯。',
      '正常 PTT 文章頁若已出現 main-content 或 article-meta 結構，就不再判定為 over18 gate。',
      '不再把 ask/over18 字樣單獨視為滿 18 歲確認頁，避免正常文章頁被誤殺。',
      '整合 legacy fallback wrapper 與 PTT detector hotfix，刪除過渡用的 17 / 18 檔案。',
      '本版不修改 Jina Reader、NewsInbox schema、DeepSeek / Gemini 主流程，也不導入 Apify / ByCrawl。'
    ]
  },
  {
    version: 'v1.10.5 Reader Layer Edition',
    date: '2026-06-08',
    summary: '新增 Reader Layer，讓一般網頁優先使用 Jina Reader，PTT 走 over18 cookie 特例。',
    changes: [
      '新增 16_ReaderLayer.gs，集中管理 Jina Reader、PTT over18 與社群平台未支援偵測。',
      '#懶人包 與 #節目話題分析 的網址讀取改先走 Reader Layer，再交給 Gemini / DeepSeek。',
      'NewsInbox 自動網址分類改用 Reader Layer 取得的 mainText，避免分類 prompt 吃不到正文。',
      '保留 legacy raw HTML + Gemini extractor 作為 fallback，不刪舊流程。',
      '本版不導入 Apify、ByCrawl，也不支援 X / Facebook / Threads 自動擷取。'
    ]
  },
  {
    version: 'v1.10.4 Data Cleanup Edition',
    date: '2026-06-08',
    summary: '新增分層 help 與多資料表清理指令，讓各資料層可以安全維護。',
    changes: [
      '新增 #help 清理、#help 管理、#help 資料、#help 全部，避免主 help 過長。',
      '新增 #清空重點、#清空快讀、#清空封存、#清空新聞、#清空待回覆。',
      '所有清理都採二段式確認，且只處理目前 conversationId。',
      '#清空紀錄 改走同一套清理流程，仍會同步清除短期記憶。',
      '新增 15_DataCleanup.gs，集中管理資料清理規則與執行。'
    ]
  },
  {
    version: 'v1.10.3 Highlight Layer Edition',
    date: '2026-06-08',
    summary: '新增 #畫重點 與 TopicHighlights，讓人工標記的重要內容成為獨立資料層。',
    changes: [
      '將 #記錄 升級為 #畫重點，重要內容會寫入 TopicHighlights，而不是只留在 ConversationLog。',
      '#統整話題、無網址版 #節目話題分析、#封存本週話題 會納入 TopicHighlights。',
      '節目整理相關功能從 ConversationLog 讀資料時只讀使用者訊息，避免小浣回覆污染素材。',
      '新增 14_TopicHighlights.gs，集中管理人工重點資料表。',
      '本版不實作多資料表清理；清理功能留待後續版本。'
    ]
  },
  {
    version: 'v1.10.2 Secretary Cleanup Edition',
    date: '2026-06-07',
    summary: '收斂小浣功能定位，移除重疊低用量指令，並讓個人聊天室直接貼網址與群組行為一致。',
    changes: [
      '移除 #摘要、#摘要最近、#回顧最近、#標題、#讀網址，降低指令重疊與維護成本。',
      '直接貼網址在群組與個人聊天室都會收進 NewsInbox，不再因聊天室類型不同而走不同流程。',
      '保留 #懶人包 作為唯一明確網址快讀入口。',
      '清理不再使用的 command parsing、prompt mode、DeepSeek mode 參數與固定回覆文案。',
      '更新 help、README、CURRENT_VERSION，讓文件與實作保持一致。'
    ]
  },
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
      '新增 #懶人包 作為明確網址快讀指令。'
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
    '這版我修正了 PTT 判斷：正常文章頁不會再只因為含有 ask/over18 字樣，就被誤判成滿 18 歲確認頁。',
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
    text += ['', '另外，你這次貼的新網址我也收到了。', '一般貼網址會放進 NewsInbox；如果是 #懶人包，我會照指令做快讀。'].join('\n');
  }
  return text;
}

function getBotTextNewsUrlFailed_(url, errorMessage) {
  return ['小浣剛剛有一個網址讀不到，可能是網站擋爬蟲、需要登入，或內容抓取失敗：', '', url || '', '', '原因：', String(errorMessage || '未知錯誤').slice(0, 1000), '', '你可以用 #新聞補充 加上網址和簡單說明，我再幫你手動放進本週新聞素材池。'].join('\n');
}

function getBotTextManualNewsSupplementNeedUrl_() { return ['我大概懂你想補一個素材，不過新聞素材池需要有網址，之後你們才找得到原文。', '你可以用這種方式丟我：', '#新聞補充 這篇大概是在講某某事件，偏社群輿論，節目潛力高，後面附上原文網址'].join('\n'); }
function getBotTextManualNewsSupplementSaved_(parsed) { return ['收到，我幫你補進本週新聞素材池了。', '我先理解成：' + (parsed.category || '待分類') + '，節目潛力：' + (parsed.topicPotential || '中') + '。'].join('\n'); }
function getBotTextWeeklyNewsNoData_() { return ['我翻了一下，最近 7 天 NewsInbox 還沒有可整理的新聞素材。', '你可以先直接貼網址讓我收進素材池，或用 #新聞補充 手動補一筆。'].join('\n'); }

// ======================================================
// 一般系統提示
// ======================================================

function getBotTextUnsupportedMessage_() { return '目前我先支援文字訊息。圖片、貼圖、語音這些我還不能穩穩處理，之後可以再幫我加功能。'; }
function getBotTextEmptyReply_() { return '我剛剛沒有產生有效回覆，可能是資料太少或模型沒有順利吐出內容。你可以換個說法再叫我一次。'; }
function getBotTextNoReadableUrl_() { return '我翻了一下，沒有找到可以讀取的網址。你可以確認一下連結是不是完整，或重新貼一次。'; }
function getBotTextResetDone_() { return ['好，這個聊天室的短期記憶我先清掉了。', '剛剛腦袋裡暫存的小紙條會消失，但 Google Sheet 裡的長期紀錄還在，不會被我亂丟。'].join('\n'); }

function getBotTextCleanupWarning_(cleanupInfo) {
  return [
    '先等一下，這個動作比較大包。',
    '',
    '你準備清理的是：' + cleanupInfo.label,
    cleanupInfo.description,
    '',
    '影響資料表：',
    formatBulletList_(cleanupInfo.affectedSheets),
    '',
    '範圍：只限目前這個聊天室，不會影響其他私訊或群組。',
    '',
    '如果你確定要繼續，請輸入：',
    cleanupInfo.confirmCommand
  ].join('\n');
}

function getBotTextCleanupDone_(cleanupInfo, cleanupResult) {
  const details = (cleanupResult.details || []).map(function(item) {
    return '・' + item.sheetName + '：' + item.count + ' 筆';
  }).join('\n');

  return [
    '整理完成。',
    '',
    '項目：' + cleanupInfo.label,
    '合計清理筆數：' + cleanupResult.total,
    '',
    details || '・沒有找到符合目前聊天室的資料',
    '',
    '我只處理目前聊天室的資料，其他私訊或群組沒有被動到。'
  ].join('\n');
}

// 舊函式名稱保留給未來相容用；v1.10.4 主流程已改走 getBotTextCleanupWarning_ / getBotTextCleanupDone_。
function getBotTextClearWarning_() {
  return getBotTextCleanupWarning_(getCleanupCommandInfo_('#清空紀錄'));
}

function getBotTextClearDone_(deletedCount) {
  return getBotTextCleanupDone_(getCleanupCommandInfo_('#清空紀錄 確認'), { total: deletedCount, details: [{ sheetName: SHEET_NAME, count: deletedCount }] });
}

function getBotTextHighlightSaved_() { return '我幫你畫起來了。這段已寫入 TopicHighlights，之後統整、分析、封存都會優先參考。'; }
function getBotTextHighlightEmpty_() { return ['你要我畫哪一段重點？', '#畫重點 這段內容之後節目可以從平台風險和創作者依賴切入'].join('\n'); }
function getBotTextArchiveError_() { return '我剛剛封存本週話題時卡住了。可能是紀錄太長、API 暫時不穩，或資料格式不太聽話。可以稍後再叫我試一次。'; }
function getBotTextAiError_() { return '我剛剛連接 AI、讀取網頁或翻紀錄時卡住了。你可以稍後再叫我一次，或把任務拆小一點給我處理。'; }
function getBotTextArchiveNoData_() { return '目前還沒有足夠的使用者對話、畫重點或網址快讀摘要可以封存。等素材多一點，我再幫你收進 WeeklySummary。'; }
function getBotTextNoTopicContextForAnalysis_() { return '目前我還翻不到足夠的使用者對話、畫重點、網址快讀摘要或封存記憶可以分析。你可以先貼一個網址，或用 #畫重點 補一段想討論的脈絡。'; }
function getBotTextNoTopicContextForIntegration_() { return '目前我還翻不到足夠的使用者聊天、畫重點、網址快讀摘要或封存記憶可以統整。你們可以先丟幾個素材進來，我再幫你們整理成話題地圖。'; }

function getBotTextArchiveDone_(archiveJson, recentCount) {
  return ['本週話題我收好了，已經放進 WeeklySummary。', '', '主題：' + (archiveJson.topicTitle || '未命名主題'), '', '摘要：', archiveJson.summary || '已建立摘要，但內容比較短。', '', '這次封存參考了 ' + recentCount + ' 則使用者訊息 / 畫重點。', '之後你們再聊到相關主題時，我就能把這份極簡記憶翻出來接著用。'].join('\n');
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
