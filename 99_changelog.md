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