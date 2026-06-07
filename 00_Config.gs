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

const DEEPSEEK_MODEL = 'deepseek-v4-flash';

const GEMINI_MODEL = 'gemini-3.1-flash-lite';
const GEMINI_ENDPOINT_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

const SHEET_NAME = 'ConversationLog';
const TOPIC_HIGHLIGHTS_SHEET_NAME = 'TopicHighlights';
const WEEKLY_SUMMARY_SHEET_NAME = 'WeeklySummary';
const WEB_TASK_QUEUE_SHEET_NAME = 'WebTaskQueue';
const NEWS_URL_QUEUE_SHEET_NAME = 'NewsUrlQueue';
const NEWS_INBOX_SHEET_NAME = 'NewsInbox';
const PENDING_REPLIES_SHEET_NAME = 'PendingReplies';
const WEB_SUMMARY_SHEET_NAME = 'WebSummary';

const TASK_TYPE_WEB_LAZY_SUMMARY = 'web_lazy_summary';
const TASK_TYPE_PROGRAM_TOPIC_ANALYSIS = 'program_topic_analysis';

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

const MEMORY_TTL_SECONDS = 21600;
const MAX_HISTORY_PAIRS = 6;

const MAX_URLS_PER_MESSAGE = 3;
const MAX_WEB_TASKS_PER_RUN = 1;
const MAX_HTML_FOR_GEMINI = 180000;
const MAX_EXTRACTED_TEXT_FOR_DEEPSEEK = 12000;
const DEFAULT_RECENT_WEB_SUMMARY_COUNT = 20;
const DEFAULT_RECENT_CONVERSATION_COUNT_FOR_TOPIC = 80;
const DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT = 50;
