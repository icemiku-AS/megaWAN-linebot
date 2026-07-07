// ======================================================
// 12_ResponseTexts.gs
// 小浣固定回覆文字層。集中管理「不經過 LLM」的系統回覆、版本資訊與版本紀錄。
//
// 小浣 LINE Bot v1.12.4 Weekly News Compact & Story Grouping Edition
//
// 設計說明：
// 1. 這個檔案只放固定文字與簡單格式化，不呼叫 DeepSeek / Gemini。
// 2. 目的不是讓小浣變吵，而是讓非 LLM 回覆也維持一致人格。
// 3. v1.10.9 將社群 reader 版本資訊與非 status 社群網址提示併回本檔，避免額外版本文字小檔。
// 4. v1.10.10 限制 #版本紀錄 只顯示最近 6 筆，避免回覆隨版本增加而過長。
// 5. v1.11.0 新增直接貼單一網址的同步大綱、queue fallback 與失敗固定回覆。
// 6. v1.11.1 將直接網址回覆縮短為 20 字內 Brief，完整 Outline 留給 NewsInbox 與 #統整話題。
// 7. v1.11.2 將 Brief 改為 30～50 字目標區間，程式端只保留防爆上限，不再正常硬裁。
// 8. v1.12.0 將群組貼網址改為靜默收件，新增 #狀態回報 與 #封存本週新聞。
// 9. v1.12.1 強化 #本週新聞 查詢模式，並讓 #help 聚焦核心新聞工作流。
// 10. v1.12.2 強化 NewsInbox 分類稽核、#本週新聞 精簡分組與診斷檢視。
// 11. v1.12.3 新增 #新聞問答，並移除低頻的 #本週新聞 24 小時檢視。
// 12. v1.12.4 起，#本週新聞 預設按 StoryKey 精簡聚合，長回覆會自動分段。
// ======================================================

const BOT_CURRENT_VERSION = 'v1.12.4 Weekly News Compact & Story Grouping Edition';
const BOT_CURRENT_VERSION_DATE = '2026-07-07';
const BOT_VERSION_HISTORY_LIMIT = 6;

const BOT_VERSION_HISTORY = [
  {
    version: 'v1.12.4 Weekly News Compact & Story Grouping Edition',
    date: '2026-07-07',
    summary: '#本週新聞 預設改為按故事線精簡整理，NewsInbox 追加 StoryKey，長回覆會自動分段避免被硬裁切。',
    changes: [
      '#本週新聞 與 #本週新聞 精簡 預設按 StoryKey / 故事線聚合；#本週新聞 詳細 才展開完整大綱、切角、節目潛力與分類資訊。',
      'LINE Reply API 長回覆會拆成最多 5 則 text message，同一則仍保留單次 reply API call。',
      'NewsInbox 最右側追加 StoryKey，Gemini 新聞分析 prompt / schema 會產生 storyKey；舊資料缺欄時會用 SpecialTopic、實體、標題或網址 fallback。',
      '#本週新聞 診斷 新增 StoryKey 空白、同 URL 重複、標題正規化重複、同故事線跨分類與分類 / 故事線疑似不一致提示。',
      '本版不修改 Reader Layer、WebTaskQueue、#懶人包、網址版 #節目話題分析 或 NewsUrlQueue 基本背景收件架構。'
    ]
  },
  {
    version: 'v1.12.3 News QA Edition',
    date: '2026-06-24',
    summary: '新增 #新聞問答，讓小浣可根據最近 7 天 NewsInbox 回答素材問題；同時移除低頻的 24 小時新聞檢視，並讓精簡與診斷模式保留完整原文網址。',
    changes: [
      '新增 #新聞問答 <問題>，可搭配高潛力與分類篩選，回答時必須附完整原文網址。',
      '#本週新聞 精簡 與 #本週新聞 診斷 的來源改回完整 URL，方便直接點回原文。',
      '移除 #本週新聞 24小時 與 #本週新聞 24小時 診斷 的支援與文件說明。',
      '本版不修改 Reader Layer、NewsInbox schema、WeeklySummary schema、群組貼網址靜默收件流程或外部 reader 服務。'
    ]
  },
  {
    version: 'v1.12.2 News Classification Audit Edition',
    date: '2026-06-24',
    summary: '強化 NewsInbox 分類稽核，讓 #本週新聞 精簡模式更像分類掃描，並新增診斷檢視協助抓出疑似錯分素材。',
    changes: [
      'NewsInbox 新增 SpecialTopic、CategoryReason、CategoryConfidence、MatchedEntities 與 ClassificationWarning 欄位，保留主要分類以外的主角與稽核線索。',
      '自動分類不再把馬斯克 / 川普當主要分類；相關人物改放 SpecialTopic，並在關鍵字不支撐時寫入分類警告。',
      '#本週新聞 精簡 改為按分類分組，只列標題與來源網域；#本週新聞 診斷 可檢查待分類、低信心與特殊主題疑似誤判素材。',
      '#封存本週新聞 會把 SpecialTopic / MatchedEntities 納入週報索引素材；本版不新增 #新聞問答，保留到 v1.12.3。'
    ]
  },
  {
    version: 'v1.12.1 Weekly News Query & Help Focus Edition',
    date: '2026-06-18',
    summary: '強化 #本週新聞 的常用檢視模式，調整新聞封存為週報索引取向，並讓 #help 聚焦核心新聞工作流。',
    changes: [
      '#本週新聞 支援預設 7 天、高潛力、詳細、精簡、24 小時與指定分類檢視。',
      '#封存本週新聞 的 prompt 改為週報索引取向，優先保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡。',
      '#help 只顯示核心功能，較少用的詳細檢視、懶人包、節目話題分析、統整話題、畫重點與話題封存移到 #help 進階。',
      '本版不修改 Reader Layer、NewsInbox schema、WeeklySummary schema、群組貼網址靜默收件流程或外部 reader 服務。'
    ]
  },
  {
    version: 'v1.12.0 Silent URL Status & News Archive Edition',
    date: '2026-06-17',
    summary: '群組貼網址改為靜默背景收件，新增新聞狀態回報與新聞封存記憶，並簡化 #本週新聞 顯示。',
    changes: [
      '群組非 trigger 訊息內含網址時，不再回覆 Brief，改靜默寫入 NewsUrlQueue 背景整理。',
      '網址不支援、入隊失敗或背景讀取失敗時，改透過 PendingReplies 延後回報。',
      '新增 #狀態回報，統計最近 7 天網址收件、NewsInbox 入庫、NewsUrlQueue 佇列與失敗狀態。',
      '新增 #封存本週新聞，將最近 7 天 NewsInbox 摘要寫入 WeeklySummary，並以 ArchiveType=news 區分新聞記憶。',
      '#封存本週話題 改為只讀 ConversationLog；#本週新聞 移除節目潛力顯示，並可參考過去新聞封存脈絡。'
    ]
  },
  {
    version: 'v1.11.2 Brief Range Hotfix',
    date: '2026-06-16',
    summary: '調整直接網址 Brief 長度策略：改以 30～50 字為目標區間，短內容可更短，程式端不再正常硬裁。',
    changes: [
      'Gemini Brief prompt 從 20 字內改為 30～50 字自然短簡介，避免回覆太像標題。',
      'X / Twitter 貼文、公告或單句消息等短內容可自然少於 30 字，不硬湊字數。',
      '程式端只保留 120 字防爆上限，避免模型失控輸出；正常超過目標區間不再被硬切成半句。',
      '本版不修改 NewsInbox schema、Outline、Reader Layer、WebTaskQueue 或 LINE router。'
    ]
  },
  {
    version: 'v1.11.1 Compact News Brief Edition',
    date: '2026-06-15',
    summary: '直接貼網址改回覆 20 字內簡介，完整 100～200 字 Outline 保存至 NewsInbox 並提供 #統整話題使用。',
    changes: [
      'Gemini 維持一次呼叫，同時產生 20 字內 Brief、100～200 字 Outline、分類、切角與節目潛力。',
      '直接貼單一網址只回覆短 Brief；#本週新聞也使用短 Brief，不再顯示切角。',
      'NewsInbox 最右側新增 Outline 欄位，#統整話題會讀取近期完整 Outline，舊資料缺少時退回 Brief。',
      '本版不修改 Reader Layer、WebTaskQueue、LINE router 或外部服務。'
    ]
  },
  {
    version: 'v1.11.0 Direct URL Summary Edition',
    date: '2026-06-14',
    summary: '直接貼單一網址時，同步回覆 100～200 字內容大綱，並在同一次 Gemini 呼叫完成 NewsInbox 分類。',
    changes: [
      '單一直接網址會先透過 Reader Layer 取得正文，再由 Gemini 一次產生大綱、分類、簡介、切角與節目潛力。',
      '同步成功後直接寫入 NewsInbox 並回覆大綱，不再等待 NewsUrlQueue 或 PendingReplies。',
      '多網址、Reader 過慢、同步分析失敗或結果不足時，會退回既有 NewsUrlQueue 背景處理。',
      '本版不修改 #本週新聞、#懶人包、#節目話題分析、Reader 路由或 Google Sheet schema。'
    ]
  },
  {
    version: 'v1.10.10 Version History Maintenance Edition',
    date: '2026-06-14',
    summary: '優化 #版本 與 #版本紀錄 的固定文字，並限制版本紀錄只顯示最近 6 筆。',
    changes: [
      '更新小浣目前版本文字與內建版本摘要。',
      '#版本紀錄 改為只顯示最近 6 筆，避免回覆隨版本增加而過長。',
      '保留完整歷史以 GitHub 的 99_changelog.md 為準的提醒。',
      '本版不修改 Reader Layer、NewsInbox、WebTaskQueue、Sheet schema 或 LINE webhook 主流程。'
    ]
  },
  {
    version: 'v1.10.9 Social Reader Edition',
    date: '2026-06-14',
    summary: '新增社群網址 reader 分流：X / Twitter status 走 FxTwitter API，Facebook / Threads / fb.watch 先走 Jina Reader。',
    changes: [
      'X / Twitter 單篇 /status/{id} 貼文會由 FxTwitter API 轉成 Reader Layer 統一文字格式。',
      'Facebook、fb.watch、Threads.com、Threads.net 不再被 NewsUrlQueue 入隊前攔截。',
      '直接貼網址、#懶人包、#節目話題分析 都沿用原本下游流程。',
      '本版不導入 ByCrawl / Apify，不修改 Sheet schema，不重構 NewsInbox。'
    ]
  },
  {
    version: 'v1.10.8 Manual News Supplement Parse Hotfix',
    date: '2026-06-08',
    summary: '修正 #新聞補充 的 JSON parser 命名錯誤，避免人工補充每次靜默掉進 fallback。',
    changes: [
      '將 13_NewsInbox.gs 的 parseManualNewsSupplement_() 從不存在的 parseLooseJson() 改回 parseJsonObjectLoose()。',
      '#新聞補充 現在會真正使用 DeepSeek 解析出的分類、簡介、切角與節目潛力。',
      '保留 fallback 防守：若 DeepSeek 回傳非 JSON 或 API 失敗，仍會用使用者原文建立人工補充素材。',
      '本版不修改 NewsUrlQueue、Reader Layer、Gemini 自動分類、DeepSeek 主聊天流程，也不導入 Apify / ByCrawl。'
    ]
  },
  {
    version: 'v1.10.7 NewsInbox Queue Hotfix',
    date: '2026-06-08',
    summary: '修正 X / Facebook / Threads 直接貼網址時被放進 NewsUrlQueue 重試，以及 failed 後沒有 pending reply 的問題。',
    changes: [
      'X / Facebook / Threads 這類目前未支援平台會在 NewsInbox 入隊前直接攔截，不再進 NewsUrlQueue。',
      'NewsUrlQueue 背景處理遇到 unsupported_social_platform / unsafe_url 這類永久錯誤時，不再重試三次。',
      '修正 NewsInbox failed 後誤呼叫不存在的 createPendingReply()，改用 createPendingReplyFromTask() 建立 PendingReplies。',
      '混合貼多個網址時，可支援的網址仍會入隊，不支援的社群網址會在回覆中提醒。',
      '本版不導入 Apify / ByCrawl，也不支援 X / Facebook / Threads 自動擷取。'
    ]
  },
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
    current.summary,
    '',
    '本次新增 / 修正：',
    formatBulletList_(current.changes),
    '',
    '想看一路以來的更新，可以輸入：',
    '#版本紀錄'
  ].join('\n');
}

function getBotVersionHistoryText_() {
  const recentHistory = BOT_VERSION_HISTORY.slice(0, BOT_VERSION_HISTORY_LIMIT);
  const blocks = recentHistory.map(function(item) {
    return [item.version + '｜' + item.date, item.summary, formatBulletList_(item.changes)].join('\n');
  });

  return ['我把最近 ' + BOT_VERSION_HISTORY_LIMIT + ' 筆版本紀錄翻出來了：', '', blocks.join('\n\n'), '', '提醒：這裡是小浣執行時內建的近期版本摘要，完整歷史仍以 GitHub 的 99_changelog.md 為準。'].join('\n');
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

function getBotTextNewsInboxAccepted_(urlCount, skippedUnsupportedUrls) {
  const countText = urlCount > 1 ? '這 ' + urlCount + ' 個網址' : '這篇';
  const lines = ['收到，' + countText + '我先收進本週新聞素材池。', '我會在背景慢慢分類整理；之後用 #本週新聞，就可以看到這週的剪報。'];

  if (skippedUnsupportedUrls && skippedUnsupportedUrls.length) {
    lines.push('', '另外，有 ' + skippedUnsupportedUrls.length + ' 個網址目前不能自動入庫。v1.10.9 已支援 X / Twitter 單篇 status，Facebook / Threads 也會先走 Jina；如果仍被略過，通常代表它不是單篇貼文、網址格式不完整，或內容需要登入。', '你可以先用 #新聞補充 加上簡短說明，我會用人工補充方式收進 NewsInbox。');
  }

  return lines.join('\n');
}

function getBotTextDirectNewsBrief_(brief) {
  return String(brief || '').trim();
}

function getBotTextDirectNewsSummaryQueued_() {
  return [
    '這篇即時整理沒有在時間內完成，我先改到背景處理。',
    '整理成功後會收進本週新聞素材池；之後可以用 #本週新聞 查看。'
  ].join('\n');
}

function getBotTextDirectNewsSummaryFailed_(url, errorMessage) {
  return [
    '這個網址目前無法自動讀取：',
    url || '',
    '',
    '原因：' + String(errorMessage || '未知錯誤').slice(0, 1000),
    '',
    '你可以改用 #新聞補充，加上簡短說明與原文網址。'
  ].join('\n');
}

function getBotTextUnsupportedSocialUrl_(urls) {
  const count = urls && urls.length ? urls.length : 1;
  return [
    '這 ' + count + ' 個網址目前不能自動讀取。',
    'v1.10.9 已支援 X / Twitter 單篇 /status/{id} 貼文；請確認網址是不是單篇貼文格式。Facebook、fb.watch、Threads.com、Threads.net 會先走 Jina Reader，不會再提前攔截。',
    '',
    '你可以改用：',
    '#新聞補充 這篇大概在講某某事件，偏社群輿論，節目潛力高，後面附上原文網址'
  ].join('\n');
}

function getBotTextPendingDelivery_(pendingText, alsoAcceptedNewUrl) {
  let text = ['我剛剛那包資料整理好了，先端上來：', '', pendingText || ''].join('\n');
  if (alsoAcceptedNewUrl) {
    text += ['', '另外，你這次貼的新網址我也收到了。', '一般貼網址會靜默進背景佇列，整理後收進 NewsInbox；如果是 #懶人包，我會照指令做快讀。'].join('\n');
  }
  return text;
}

function getBotTextNewsUrlFailed_(url, errorMessage) {
  return ['小浣剛剛有一個網址讀不到，可能是網站擋爬蟲、需要登入，或內容抓取失敗：', '', url || '', '', '原因：', String(errorMessage || '未知錯誤').slice(0, 1000), '', '你可以用 #新聞補充 加上網址和簡單說明，我再幫你手動放進本週新聞素材池。'].join('\n');
}

function getBotTextManualNewsSupplementNeedUrl_() { return ['我大概懂你想補一個素材，不過新聞素材池需要有網址，之後你們才找得到原文。', '你可以用這種方式丟我：', '#新聞補充 這篇大概是在講某某事件，偏社群輿論，節目潛力高，後面附上原文網址'].join('\n'); }
function getBotTextManualNewsSupplementSaved_(parsed) { return ['收到，我幫你補進本週新聞素材池了。', '我先理解成：' + (parsed.category || '待分類') + '，節目潛力：' + (parsed.topicPotential || '中') + '。'].join('\n'); }
function getBotTextWeeklyNewsNoData_(queryOptions) {
  const options = queryOptions || {};
  const periodText = '最近 ' + (Number(options.days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天';
  const scopeParts = [periodText];

  if (options.onlyHighPotential) {
    scopeParts.push('高潛力');
  }

  if (options.categoryFilter) {
    scopeParts.push('分類「' + options.categoryFilter + '」');
  }

  return ['我翻了一下，' + scopeParts.join('、') + ' NewsInbox 還沒有可整理的新聞素材。', '你可以先直接貼網址讓我靜默收進素材池，或用 #新聞補充 手動補一筆。'].join('\n');
}

function getBotTextWeeklyNewsDiagnosticNoIssue_(queryOptions) {
  const options = queryOptions || {};
  const periodText = '最近 ' + (Number(options.days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天';
  const scopeParts = [periodText];

  if (options.categoryFilter) {
    scopeParts.push('分類「' + options.categoryFilter + '」');
  }

  if (options.onlyHighPotential) {
    scopeParts.push('高潛力');
  }

  return '我檢查了' + scopeParts.join('、') + '的新聞分類，目前沒有明顯的低信心、待分類、故事線異常、重複素材或特殊主題誤判警告。';
}

function getBotTextWeeklyNews24HourRemoved_() {
  return [
    '#本週新聞 24小時 已在 v1.12.3 移除。',
    '請改用 #本週新聞 查看最近 7 天，或用 #本週新聞 高潛力 / #本週新聞 分類 <分類名> 聚焦素材。'
  ].join('\n');
}

function getBotTextNewsQuestionNeedQuestion_() {
  return [
    '你想問本週新聞素材什麼？',
    '可以這樣問：',
    '#新聞問答 這週有哪些 AI 公司相關新聞？',
    '#新聞問答 高潛力 有哪些適合做節目的社群平台新聞？',
    '#新聞問答 分類 科技與 AI 這週有什麼可追蹤？'
  ].join('\n');
}

function getBotTextNewsQuestionNoData_(queryOptions) {
  const options = queryOptions || {};
  const scopeParts = ['最近 ' + (Number(options.days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天'];

  if (options.onlyHighPotential) {
    scopeParts.push('高潛力');
  }

  if (options.categoryFilter) {
    scopeParts.push('分類「' + options.categoryFilter + '」');
  }

  return ['我翻了一下，' + scopeParts.join('、') + ' NewsInbox 沒有可回答的新聞素材。', '你可以先貼網址讓我收進素材池，或用 #新聞補充 手動補一筆。'].join('\n');
}

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
function getBotTextArchiveError_() { return '我剛剛封存本週話題時卡住了。可能是對話紀錄太長、API 暫時不穩，或資料格式不太聽話。可以稍後再叫我試一次。'; }
function getBotTextAiError_() { return '我剛剛連接 AI、讀取網頁或翻紀錄時卡住了。你可以稍後再叫我一次，或把任務拆小一點給我處理。'; }
function getBotTextArchiveNoData_() { return '目前還沒有足夠的使用者對話可以封存。等群組多聊一點，我再幫你收進 WeeklySummary。'; }
function getBotTextNewsArchiveError_() { return '我剛剛封存本週新聞時卡住了。可能是 NewsInbox 素材太多、API 暫時不穩，或資料格式不太聽話。可以稍後再叫我試一次。'; }
function getBotTextNewsArchiveNoData_() { return '最近 7 天 NewsInbox 還沒有可封存的新聞素材。你可以先貼幾個網址，或用 #新聞補充 手動補素材。'; }
function getBotTextNoTopicContextForAnalysis_() { return '目前我還翻不到足夠的使用者對話、畫重點、網址快讀摘要或封存記憶可以分析。你可以先貼一個網址，或用 #畫重點 補一段想討論的脈絡。'; }
function getBotTextNoTopicContextForIntegration_() { return '目前我還翻不到足夠的使用者聊天、畫重點、網址快讀摘要或封存記憶可以統整。你們可以先丟幾個素材進來，我再幫你們整理成話題地圖。'; }

function getBotTextArchiveDone_(archiveJson, recentCount) {
  return ['本週話題我收好了，已經放進 WeeklySummary。', '', '主題：' + (archiveJson.topicTitle || '未命名主題'), '', '摘要：', archiveJson.summary || '已建立摘要，但內容比較短。', '', '這次封存只參考 ConversationLog 的 ' + recentCount + ' 則使用者訊息。', '之後你們再聊到相關主題時，我就能把這份對話記憶翻出來接著用。'].join('\n');
}

function getBotTextNewsArchiveDone_(archiveJson, recentCount) {
  return ['本週新聞我收好了，已經放進 WeeklySummary。', '', '主題：' + (archiveJson.topicTitle || '未命名新聞主軸'), '', '摘要：', archiveJson.summary || '已建立新聞摘要，但內容比較短。', '', '這次封存參考了 ' + recentCount + ' 則 NewsInbox 素材。', '之後 #本週新聞 就可以拿這份新聞記憶比對過去脈絡。'].join('\n');
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
