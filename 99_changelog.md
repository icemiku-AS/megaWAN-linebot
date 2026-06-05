2026-06-05
v1.9.3 Gemini JSON Mode Hotfix
- 以 v1.9.2 Humanized System Reply Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 修正 Gemini API 400 錯誤：generation_config.response_format.text.mime_type INVALID_ARGUMENT。
- 修改 08_GeminiService.gs，將 Gemini generationConfig 從 responseFormat.text.mimeType/schema 退回 responseMimeType: 'application/json'。
- 保留 getGeminiLazySummarySchema_() 與 getGeminiWebExtractorSchema_()，但暫時只作為程式端資料契約與未來升級參考，不直接送進 Gemini API。
- 補上詳細註解，說明目前 v1beta + gemini-3.1-flash-lite 與 responseFormat.text.mimeType/schema 不相容。
- 更新 12_ResponseTexts.gs 的 #版本 / #版本紀錄 內建版本資訊。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.2 Humanized System Reply Edition
- 以 v1.9.1 Structured Gemini Output Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 新增 12_ResponseTexts.gs，集中管理不經過 LLM 的固定回覆文字、版本資訊與版本紀錄。
- 新增 #版本 指令，可回覆目前版本與本次新增功能。
- 新增 #版本紀錄 指令，可回覆主要版本更新摘要。
- 調整任務接收、pending reply 交付、reset、清空紀錄、#記錄、錯誤提示、封存完成等固定回覆語氣。
- 修改 00_Config.gs，將 #版本 / #版本紀錄 加入 TRIGGER_PREFIXES。
- 修改 01_Main.gs，加入 #版本 / #版本紀錄 指令處理，並改用 12_ResponseTexts.gs 的固定文案。
- 修改 02_LineCommands.gs，新增 version log mode 與 help 說明。
- 修改 07_WebTaskQueue.gs，調整網址任務失敗與快讀結果格式。
- 修改 10_TopicFeatures.gs，調整沒有素材與封存完成時的固定提示。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.1 Structured Gemini Output Edition
- 以 v1.9.0 Service Split Edition 為基礎，維持 Google Apps Script 分檔架構與既有 LINE 指令流程。
- 修改 08_GeminiService.gs，將 Gemini 網頁快讀摘要與 Gemini 網頁正文抽取改為 structured output schema。
- 新增 getGeminiLazySummarySchema_()，集中定義快讀摘要 JSON 欄位、型別、必要欄位與 enum。
- 新增 getGeminiWebExtractorSchema_()，集中定義正文抽取 JSON 欄位、型別與必要欄位。
- 新增 buildGeminiJsonGenerationConfig_()，統一建立 Gemini REST API 的 JSON structured output generationConfig。
- 新增 normalizeGeminiString_()、normalizeGeminiStringArray_()、normalizeGeminiNumber_()、normalizeGeminiEnum_()，作為 structured output 之外的最後防守。
- 保留 parseJsonObjectLoose() fallback，避免偶發格式問題造成 WebTaskQueue 任務整個中斷。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.0 Service Split Edition
- 拆分原本過於肥大的 03_AiLogic.gs。
- 新增 03_Utils.gs、04_Storage.gs、05_Memory.gs、06_WebReader.gs、07_WebTaskQueue.gs、08_GeminiService.gs、09_DeepSeekService.gs、10_TopicFeatures.gs。
- 將原本 04_Prompts.gs 調整為 11_Prompts.gs，讓檔案順序符合系統流程。
- 功能邏輯原則上不變，主要改善可維護性與未來擴充性。
- 每個程式碼檔案補上責任說明與維護註解，方便未來人工或 AI 重新讀取。

// ==================================================

2026-06-04
V1.7.1
-調整小浣回覆內容，讓回答更精簡
-重新定義程式版號
-一次性讀網址調整程3個
// ==================================================


// 版本：V1.7.0 Topic Pool Edition
//
// 核心架構：
// 1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆
// 2. 只要訊息中含網址：
//    - 不需要 #小浣，也不需要 #讀網址
//    - 立刻回覆：「收到網址，我先幫你抓重點。」
//    - 任務寫入 WebTaskQueue，TaskType = web_lazy_summary
//    - 由 time-driven trigger 背景處理
//    - UrlFetchApp 抓網頁
//    - Script 做基礎垃圾訊息清理
//    - Gemini Flash-Lite 產生 100～500 字快讀摘要
//    - 摘要寫入 WebSummary，作為未來 #統整話題 的素材池
//    - 同時寫入 PendingReplies，下一次同聊天室有任何文字訊息時交付結果
// 3. #節目話題分析 + 網址：
//    - 任務寫入 WebTaskQueue，TaskType = program_topic_analysis
//    - Gemini 抽正文
//    - DeepSeek 做節目話題深度分析
// 4. #節目話題分析 沒貼網址：
//    - 讀最近 ConversationLog + WebSummary + WeeklySummary
//    - 由 DeepSeek 判斷要分析剛剛聊天內容、正在寫的內容，或近期最有節目潛力的素材
// 5. #統整話題：
//    - 讀最近 ConversationLog + WebSummary + WeeklySummary
//    - 整理成近期話題地圖、可做節目段落、素材來源與優先順序
// 6. PendingReplies 仍只是交付機制，正式素材保存於 WebSummary
// ======================================================
// 小浣 LINE Bot on Google Apps Script
// LINE Bot + DeepSeek API + Gemini Web Extractor + Google Sheet Log
//
// 版本：V1.6.2 Queue Edition
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
v1.6.1
- 小甜正式改名為小浣
- 調整群組回覆口吻
- 移除 LINE markdown 格式
- 加入網址 pending reply 流程
// ======================================================
// LINE Bot + DeepSeek API + Gemini Web Extractor + Google Sheet Log
//
// 版本：V1.6.0 Queue Edition
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
// 版本：V1.5.0 WebReader Integrated
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
// 版本：V1.4.0 Integrated
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