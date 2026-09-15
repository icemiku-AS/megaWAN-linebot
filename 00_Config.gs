// ======================================================
// 00_Config.gs
// 用途：Core／Shared foundation：共用 endpoint、Sheet 名稱、指令前綴與執行上限。
//
// 職責與協作：
// 1. 集中跨領域且不含 secret 的常數；secret 值由使用端透過 Script Properties 延遲讀取。
// 2. AI model、profile 與 task route 由 11_AiProfiles.gs 管理，provider endpoint 留在各 adapter。
//
// 維護注意：
// 1. GAS 共用全域命名空間；數字前綴僅供導航，不可依賴檔案順序執行初始化副作用。
// 2. Sheet 名稱、Queue 上限、deadline 與 cache 識別皆有相容性影響，修改時須追蹤 callers。
// ======================================================

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

// LINE text message 官方上限為 5000 字；程式端留 100 字安全空間。
// Reply API 一次最多可送 5 則訊息，長回覆仍維持單次 reply API call。
const LINE_TEXT_MESSAGE_MAX_LENGTH = 4900;
const LINE_REPLY_MAX_MESSAGE_COUNT = 5;

// LINE webhook 的同步工作共用同一個 deadline。40 秒刻意保留 reply API、Sheet 寫入與排版餘裕；
// profile timeout 是任務最大預算，單次同步 AI 最多 30 秒，且只能由 caller 再縮短。
// 輔助型 memory bridge 至少要剩 20 秒才執行，避免拖垮主要回覆。
const LINE_WEBHOOK_SYNC_WORK_BUDGET_MS = 40000;
const LINE_WEBHOOK_SYNC_AI_TIMEOUT_CAP_SECONDS = 30;
const LINE_WEBHOOK_SYNC_AI_MIN_REQUEST_SECONDS = 8;
const LINE_WEBHOOK_SYNC_AUXILIARY_AI_MIN_REQUEST_SECONDS = 20;

// Google Apps Script UrlFetchApp 的預設 timeout 可長達 360 秒；同步 Reader 另套 12 秒上限。
// 背景 WebTaskQueue / NewsUrlQueue 不帶 execution context，維持既有 Reader 預設行為。
const LINE_WEBHOOK_SYNC_READER_TIMEOUT_CAP_SECONDS = 12;

// FxTwitter API：讀取 X / Twitter 公開單篇 status 貼文。
// 使用方式：FXTWITTER_API_STATUS_ENDPOINT_PREFIX + statusId
// 例：https://api.fxtwitter.com/2/status/1234567890123456789
const FXTWITTER_API_STATUS_ENDPOINT_PREFIX = 'https://api.fxtwitter.com/2/status/';

// ======================================================
// Google Sheet 設定
// ======================================================

// 原始對話紀錄 Sheet
const SHEET_NAME = 'ConversationLog';

// 人工重點資料表。
// #畫重點 會將使用者手動標記的重要內容寫入這裡，供統整、分析、封存優先參考。
const TOPIC_HIGHLIGHTS_SHEET_NAME = 'TopicHighlights';

// 封存後的極簡長期記憶 Sheet
const WEEKLY_SUMMARY_SHEET_NAME = 'WeeklySummary';

// WeeklySummary 封存類型。
// #封存本週話題 與 #封存本週新聞 共用 WeeklySummary，
// 透過 ArchiveType 區分「對話記憶」與「新聞記憶」，避免未來讀取長期記憶時混淆來源。
const WEEKLY_ARCHIVE_TYPE_TOPIC = 'topic';
const WEEKLY_ARCHIVE_TYPE_NEWS = 'news';

// 網頁讀取任務佇列 Sheet：保留給 #懶人包 / #節目話題分析
const WEB_TASK_QUEUE_SHEET_NAME = 'WebTaskQueue';

// 新聞網址待處理佇列 Sheet：多網址、同步處理過慢或失敗時使用
const NEWS_URL_QUEUE_SHEET_NAME = 'NewsUrlQueue';

// 新聞素材池 Sheet：#本週新聞 的資料來源
const NEWS_INBOX_SHEET_NAME = 'NewsInbox';

// 已完成但尚未交付給使用者的回覆 Sheet
const PENDING_REPLIES_SHEET_NAME = 'PendingReplies';

// 網址快讀摘要素材池
// 這張表仍保留給 #懶人包 與 #統整話題 使用
const WEB_SUMMARY_SHEET_NAME = 'WebSummary';


// ======================================================
// WebTaskQueue TaskType
// ======================================================

// #懶人包：做 provider-neutral 快讀摘要，不做深度節目分析
const TASK_TYPE_WEB_LAZY_SUMMARY = 'web_lazy_summary';

// #節目話題分析 + 網址：Reader 取得正文後，由 AI task 做深度節目分析
const TASK_TYPE_PROGRAM_TOPIC_ANALYSIS = 'program_topic_analysis';


// ======================================================
// LINE Bot 指令設定
// ======================================================

// 群組中只有這些開頭才會觸發一般 Bot 回覆。
// 例外：
// 1. 如果群組一般訊息內含網址，即使沒有觸發詞，也會靜默進入 NewsUrlQueue 背景收件流程，不回覆群組。
// 2. 個人聊天室直接貼網址仍保留同步回覆路徑，方便維護者測試 Reader / AI 行為。
// 3. Pending Reply 交付仍放在觸發詞判斷之前，所以只要有完成的 pending reply，任何文字都會交付。
// 4. #畫重點 明確保存人工素材；清理指令只作用於目前 conversationId，且須二段確認。
// 5. 靜默收件失敗或網址不支援時，由 PendingReplies 延後回報。
const TRIGGER_PREFIXES = [
  '#小浣',
  '#help',
  '#reset',
  '#版本紀錄',
  '#版本',
  '#畫重點',
  '#清空紀錄',
  '#清空重點',
  '#清空快讀',
  '#清空封存',
  '#清空新聞',
  '#清空待回覆',
  '#封存本週話題',
  '#封存本週新聞',
  '#懶人包',
  '#本週新聞',
  '#新聞問答',
  '#狀態回報',
  '#新聞補充',
  '#節目話題分析',
  '#統整話題'
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
// 本週編輯台設定
// ======================================================

const WEEKLY_EDITORIAL_CACHE_VERSION = 'v1.13.0';
const WEEKLY_EDITORIAL_CACHE_TTL_SECONDS = 600;

const MAX_WEEKLY_EDITORIAL_NEWS_ITEMS = 30;
const MAX_WEEKLY_EDITORIAL_NEWS_PER_CATEGORY_RESERVE = 2;
const MAX_WEEKLY_EDITORIAL_CLUSTER_COUNT = 8;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_TOPIC_COUNT = 3;

const MAX_WEEKLY_EDITORIAL_TITLE_LENGTH = 100;
const MAX_WEEKLY_EDITORIAL_BRIEF_LENGTH = 80;
const MAX_WEEKLY_EDITORIAL_OUTLINE_LENGTH = 160;
const MAX_WEEKLY_EDITORIAL_STORY_KEY_LENGTH = 40;
const MAX_WEEKLY_EDITORIAL_SPECIAL_TOPIC_LENGTH = 80;
const MAX_WEEKLY_EDITORIAL_MATCHED_ENTITIES_LENGTH = 100;
const MAX_WEEKLY_EDITORIAL_CLUSTER_TITLE_LENGTH = 40;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_TITLE_LENGTH = 60;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_SUMMARY_LENGTH = 160;
const MAX_WEEKLY_EDITORIAL_TALKING_POINT_LENGTH = 100;

const WEEKLY_EDITORIAL_CONVERSATION_SCAN_BATCH_SIZE = 500;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_SCAN_ROWS = 2500;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_ITEMS = 60;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_ITEM_LENGTH = 240;
const MAX_WEEKLY_EDITORIAL_CONVERSATION_TOTAL_LENGTH = 6000;


// ======================================================
// 網頁讀取設定
// ======================================================

// 單則訊息最多讀幾個網址，避免排程一次處理太久
const MAX_URLS_PER_MESSAGE = 3;

// 每次排程最多處理幾個 pending 網頁任務
// 這裡仍只給舊 WebTaskQueue 使用；NewsUrlQueue 有自己的每批處理量。
const MAX_WEB_TASKS_PER_RUN = 1;

// legacy raw HTML 送入正文抽取 AI task 前的最大字元數。
// 過長 HTML 會先移除 script/style 等噪音再截斷，避免輸入擠壓 mainText 輸出空間。
const MAX_HTML_FOR_AI_EXTRACTION = 180000;

// Reader 正文送入後續 AI 分析 Prompt 前的最大字元數。
const MAX_EXTRACTED_TEXT_FOR_AI_PROMPT = 12000;

// 直接貼單一網址時，Reader 完成後若已超過此時間，就不再追加 AI 同步分析；
// 同時還會依 webhook 共用 deadline 計算剩餘 AI 預算，任一條件不足都改放 NewsUrlQueue。
const DIRECT_NEWS_SYNC_READER_MAX_MS = 15000;

// 同步 Brief、Outline 與 NewsInbox 分類共用同一次 news_analysis task。
// 只送入正文前 12000 字，兼顧新聞內容完整度、模型速度與 API 成本。
const DIRECT_NEWS_AI_TEXT_LIMIT = 12000;

// Brief 用於直接網址 LINE 回覆與 #本週新聞。
// 30～50 字是 prompt 目標區間，不是正常流程的硬裁切；短內容可自然低於 30 字。
const NEWS_INBOX_BRIEF_TARGET_MIN_LENGTH = 30;
const NEWS_INBOX_BRIEF_TARGET_MAX_LENGTH = 50;

// 防爆上限只處理模型失控輸出，避免 LINE 回覆與 Sheet 欄位塞入過長文字。
const NEWS_INBOX_BRIEF_HARD_MAX_LENGTH = 120;

// Outline 保存於 NewsInbox，供 #統整話題讀取。
// Prompt 目標是 100～200 字；程式端接受稍寬範圍，過長時直接裁切，避免再次呼叫 AI。
const DIRECT_NEWS_OUTLINE_MIN_LENGTH = 80;
const DIRECT_NEWS_OUTLINE_MAX_LENGTH = 240;

// #統整話題 預設讀取最近幾筆網址摘要
const DEFAULT_RECENT_WEB_SUMMARY_COUNT = 20;

// #統整話題 預設讀取最近幾筆 NewsInbox 新聞素材
const DEFAULT_RECENT_NEWS_INBOX_COUNT = 20;

// #統整話題 / #節目話題分析 沒貼網址時，預設讀取最近幾則對話
const DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC = 80;

// #統整話題 / #節目話題分析 預設讀取最近幾筆人工重點
const DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT = 50;
