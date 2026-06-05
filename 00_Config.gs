// ======================================================
// 00_Config.gs
// 集中管理 API endpoint、模型名稱、Sheet 名稱、指令前綴與各種系統常數。
//
// 小浣 LINE Bot v1.9.2 Humanized System Reply Edition
//
// 維護原則：
// 1. 本版延續 Google Apps Script 分檔架構，不導入 Node.js / npm。
// 2. Google Apps Script 會把同一專案內的 .gs 檔視為同一個全域命名空間。
// 3. 因此函式可跨檔案直接呼叫，但函式名稱不可重複。
// 4. v1.9.2 新增 #版本 / #版本紀錄，並把固定回覆文字集中到 12_ResponseTexts.gs。
// ======================================================

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const DEEPSEEK_ENDPOINT = 'https://api.deepseek.com/chat/completions';

// DeepSeek 主模型
const DEEPSEEK_MODEL = 'deepseek-v4-flash';

// Gemini 模型
// v1.7 / v1.8 / v1.9 中 Gemini 有兩種用途：
// 1. 快讀摘要：將網頁直接整理成 100～500 字懶人包
// 2. 正文抽取：在 #節目話題分析 時，先將 HTML 抽成乾淨正文，再交給 DeepSeek
const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';


// ======================================================
// Google Sheet 設定
// ======================================================

// 原始對話紀錄 Sheet
const SHEET_NAME = 'ConversationLog';

// 封存後的極簡長期記憶 Sheet
const WEEKLY_SUMMARY_SHEET_NAME = 'WeeklySummary';

// 網頁讀取任務佇列 Sheet
const WEB_TASK_QUEUE_SHEET_NAME = 'WebTaskQueue';

// 已完成但尚未交付給使用者的回覆 Sheet
const PENDING_REPLIES_SHEET_NAME = 'PendingReplies';

// 網址快讀摘要素材池
// 這張表是 #統整話題 的核心資料來源之一
const WEB_SUMMARY_SHEET_NAME = 'WebSummary';


// ======================================================
// WebTaskQueue TaskType
// ======================================================

// 一般貼網址或 #讀網址：只做 Gemini 快讀摘要，不做 DeepSeek 深度分析
const TASK_TYPE_WEB_LAZY_SUMMARY = 'web_lazy_summary';

// #節目話題分析 + 網址：做 Gemini 抽取 + DeepSeek 深度節目分析
const TASK_TYPE_PROGRAM_TOPIC_ANALYSIS = 'program_topic_analysis';


// ======================================================
// LINE Bot 指令設定
// ======================================================

// 群組中只有這些開頭才會觸發一般 Bot 回覆。
// 例外：
// 1. 如果群組一般訊息內含網址，即使沒有觸發詞，也會自動排入網址快讀。
// 2. Pending Reply 交付仍放在觸發詞判斷之前，所以只要有完成的 pending reply，任何文字都會交付。
// 3. v1.9.2 新增 #版本 / #版本紀錄，讓小浣可直接回覆目前版本與主要更新紀錄。
const TRIGGER_PREFIXES = [
  '#小浣',
  '#摘要',
  '#標題',
  '#help',
  '#reset',
  '#版本紀錄',
  '#版本',
  '#摘要最近',
  '#回顧最近',
  '#記錄',
  '#清空紀錄',
  '#封存本週話題',
  '#讀網址',
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
// Apps Script 有執行時間限制，MVP 建議先保持 1
const MAX_WEB_TASKS_PER_RUN = 1;

// 送給 Gemini 的 HTML 最大長度
// Gemini context 很大，但 Apps Script、API 成本與速度仍要控管
const MAX_HTML_FOR_GEMINI = 180000;

// Gemini 抽出的正文送給 DeepSeek 前的最大長度
const MAX_EXTRACTED_TEXT_FOR_DEEPSEEK = 12000;

// #統整話題 預設讀取最近幾筆網址摘要
const DEFAULT_RECENT_WEB_SUMMARY_COUNT = 20;

// #統整話題 / #節目話題分析 沒貼網址時，預設讀取最近幾則對話
const DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC = 80;
