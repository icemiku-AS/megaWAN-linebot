// ======================================================
// 00_Config.gs
// 集中管理 API endpoint、模型名稱、Sheet 名稱、指令前綴與各種系統常數。
//
// 小浣 LINE Bot v1.10.4 Data Cleanup Edition
//
// 維護原則：
// 1. 本版延續 Google Apps Script 分檔架構，不導入 Node.js / npm。
// 2. Google Apps Script 會把同一專案內的 .gs 檔視為同一個全域命名空間。
// 3. 因此函式可跨檔案直接呼叫，但函式名稱不可重複。
// 4. v1.10.4 新增資料清理層：多資料表清理皆需二段確認，且只作用於目前 conversationId。
// ======================================================

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// DeepSeek 主模型
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Gemini 模型
// v1.10.4 中 Gemini 仍負責：
// 1. 快讀摘要：#懶人包 指令使用
// 2. 正文抽取：#節目話題分析 使用
// 3. 新聞素材分類：直接貼網址進 NewsInbox 使用
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';


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

// 網頁讀取任務佇列 Sheet：保留給 #懶人包 / #節目話題分析
const WEB_TASK_QUEUE_SHEET_NAME = 'WebTaskQueue';

// 新聞網址待處理佇列 Sheet：直接貼網址會先進這裡
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

// #懶人包：做 Gemini 快讀摘要，不做 DeepSeek 深度分析
const TASK_TYPE_WEB_LAZY_SUMMARY = 'web_lazy_summary';

// #節目話題分析 + 網址：做 Gemini 抽取 + DeepSeek 深度節目分析
const TASK_TYPE_PROGRAM_TOPIC_ANALYSIS = 'program_topic_analysis';


// ======================================================
// LINE Bot 指令設定
// ======================================================

// 群組中只有這些開頭才會觸發一般 Bot 回覆。
// 例外：
// 1. 如果群組一般訊息內含網址，即使沒有觸發詞，也會自動排入 NewsInbox 新聞素材池。
// 2. 個人聊天室直接貼網址也走相同 NewsInbox 收件流程，方便在私訊測試群組行為。
// 3. Pending Reply 交付仍放在觸發詞判斷之前，所以只要有完成的 pending reply，任何文字都會交付。
// 4. v1.10.3 將 #記錄 升級為 #畫重點，並寫入 TopicHighlights。
// 5. v1.10.4 新增多資料表清理指令，所有清理都只作用於目前 conversationId。
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
  '#懶人包',
  '#本週新聞',
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
// 網頁讀取設定
// ======================================================

// 單則訊息最多讀幾個網址，避免排程一次處理太久
const MAX_URLS_PER_MESSAGE = 3;

// 每次排程最多處理幾個 pending 網頁任務
// 這裡仍只給舊 WebTaskQueue 使用；NewsUrlQueue 有自己的每批處理量。
const MAX_WEB_TASKS_PER_RUN = 1;

// 送給 Gemini 的 HTML 最大長度
const MAX_HTML_FOR_GEMINI = 180000;

// Gemini 抽出的正文送給 DeepSeek 前的最大長度
const MAX_EXTRACTED_TEXT_FOR_DEEPSEEK = 12000;

// #統整話題 預設讀取最近幾筆網址摘要
const DEFAULT_RECENT_WEB_SUMMARY_COUNT = 20;

// #統整話題 / #節目話題分析 沒貼網址時，預設讀取最近幾則對話
const DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC = 80;

// #統整話題 / #節目話題分析 / #封存本週話題 預設讀取最近幾筆人工重點
const DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT = 50;
