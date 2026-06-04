// ======================================================
// 小浣 LINE Bot on Google Apps Script
// LINE Bot + DeepSeek API + Gemini Web Extractor + Google Sheet Log
//
// 版本：V6 Queue Edition
//
// 核心架構：
// 1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆
// 2. #讀網址 或指令中含網址：
//    - 立刻回覆：「收到你的網址摘要了，我先處理。」
//    - 任務寫入 WebTaskQueue
//    - 由 time-driven trigger 背景處理
//    - 處理完成後寫入 PendingReplies
//    - 下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果
//    - 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆
//
// 必要 Script Properties：
// 1. LINE_CHANNEL_ACCESS_TOKEN
// 2. DEEPSEEK_API_KEY
// 3. GEMINI_API_KEY
// 4. SPREADSHEET_ID
// ======================================================
2026-06-04
- 小甜正式改名為小浣
- 調整群組回覆口吻
- 移除 LINE markdown 格式
- 加入網址 pending reply 流程
// ======================================================
// LINE Bot + DeepSeek API + Gemini Web Extractor + Google Sheet Log
//
// 版本：V6 Queue Edition
//
// 核心架構：
// 1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆
// 2. #讀網址 或指令中含網址：
//    - 立刻回覆：「收到你的網址摘要了，我先處理。」
//    - 任務寫入 WebTaskQueue
//    - 由 time-driven trigger 背景處理
//    - 處理完成後寫入 PendingReplies
//    - 下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果
//    - 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆
//
// 必要 Script Properties：
// 1. LINE_CHANNEL_ACCESS_TOKEN
// 2. DEEPSEEK_API_KEY
// 3. GEMINI_API_KEY
// 4. SPREADSHEET_ID
// ======================================================
// 小甜 LINE Bot on Google Apps Script
// LINE Bot + DeepSeek API + Google Sheet Log + WeeklySummary
//
// 版本：V5 WebReader Integrated
//
// 功能：
// 1. 使用 DeepSeek deepseek-v4-flash 作為主要回覆模型
// 2. 使用 Gemini 3.1 Flash-Lite 作為網頁正文抽取模型
// 3. 支援 LINE 私訊多輪對話
// 4. 支援 LINE 群組指令觸發，避免每句話都回覆
// 5. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog
// 6. 可讀取最近 N 則對話進行摘要與回顧
// 7. 可清除短期記憶與指定聊天室長期紀錄
// 8. 可將本週話題封存成極簡長期記憶：WeeklySummary
// 9. 回覆時會讀取 WeeklySummary，作為過去討論脈絡
// 10. 支援 #讀網址：UrlFetchApp 讀網頁 → Gemini 抽正文 → DeepSeek 做整理
// ======================================================
// 小甜 LINE Bot on Google Apps Script
// LINE Bot + DeepSeek API + Google Sheet Log + WeeklySummary
//
// 版本：V4 Integrated
//
// 功能：
// 1. 使用 DeepSeek deepseek-v4-flash
// 2. 支援 LINE 私訊多輪對話
// 3. 支援 LINE 群組指令觸發，避免每句話都回覆
// 4. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog
// 5. 可讀取最近 N 則對話進行摘要與回顧
// 6. 可清除短期記憶與指定聊天室長期紀錄
// 7. 可將本週話題封存成極簡長期記憶：WeeklySummary
// 8. 回覆時會讀取 WeeklySummary，作為過去討論脈絡
// ======================================================