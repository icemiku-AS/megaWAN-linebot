# 小浣 LINE Bot v1.9.3 Gemini JSON Mode Hotfix

這是 MEGA浣 / 小浣 的 Google Apps Script 分檔版。

正式名稱：MEGA浣  
小名：小浣  
定位：Podcast「現正熱潮中」的 LINE 群組企劃助理。  
形象：長著浣熊耳朵與尾巴、會從垃圾桶探出頭，把雜亂社群資訊翻成可用素材的小幫手。

## 本版定位

v1.9.3 Gemini JSON Mode Hotfix 以 v1.9.2 Humanized System Reply Edition 為基礎，不改變 LINE 使用流程、不改變主要 Sheet 架構、不更換模型，主要目標是修正 Gemini API structured output 設定與目前 API / 模型組合不相容造成的網址讀取失敗。

本版原則：

1. 不主動新增複雜功能。
2. 不主動改變原本 LINE 指令流程。
3. 不改變主要 Sheet 架構。
4. 不更換 Gemini 模型。
5. 只修正 Gemini generationConfig 的相容性問題。
6. 保留詳細註解，方便未來人工維護與 AI 重新讀取。

## v1.9.3 主要變更

本版主要修改 `08_GeminiService.gs`：

1. 將 Gemini generationConfig 從 `responseFormat.text.mimeType/schema` 退回 `responseMimeType: 'application/json'`。
2. 修正 Gemini API 400 `generation_config.response_format.text.mime_type INVALID_ARGUMENT` 問題。
3. 保留 `getGeminiLazySummarySchema_()` 與 `getGeminiWebExtractorSchema_()`，但暫時只作為程式端資料契約與未來升級參考，不再直接送進 Gemini API。
4. 補上詳細註解，說明目前 `v1beta + gemini-3.1-flash-lite` 與 `responseFormat.text.mimeType/schema` 不相容。
5. 更新 `12_ResponseTexts.gs` 內建版本資料，讓 `#版本` 與 `#版本紀錄` 可回報本次 hotfix。

## 檔案配置

### `00_Config.gs`

集中管理系統常數。

包含：

- LINE / DeepSeek / Gemini endpoint
- 模型名稱
- Google Sheet 名稱
- TaskType
- LINE 觸發指令
- 短期記憶設定
- 網頁讀取限制

`TRIGGER_PREFIXES` 包含：

- `#版本`
- `#版本紀錄`

### `01_Main.gs`

主要入口與主流程。

包含：

- `setupLogSheet()`
- `installWebTaskQueueTrigger()`
- `doPost(e)`
- `handleLineEvent(event)`

這個檔案負責 LINE webhook 入口、文字訊息判斷、主流程分流。  
`#版本` 與 `#版本紀錄` 在此檔案中被攔截處理，不呼叫 LLM。

### `02_LineCommands.gs`

LINE 指令與回覆層。

包含：

- 指令解析
- mode 判斷
- conversationId 取得
- LINE Reply API
- Help 文字
- 網址任務接受回覆文字

固定文案由 `12_ResponseTexts.gs` 管理；本檔主要保留流程與既有函式名稱。

### `03_Utils.gs`

通用工具層。

包含：

- 簡單 ID 產生
- 寬鬆 JSON 解析

這些工具會被多個模組共用，因此獨立放置。

### `04_Storage.gs`

Google Sheet 資料層。

包含：

- Script Properties / Spreadsheet 入口
- Sheet 表頭建立與相容式補欄位
- ConversationLog / WebSummary / WeeklySummary / WebTaskQueue / PendingReplies 的讀寫
- 最近對話與摘要讀取
- ConversationLog 清空
- Sheet 單格長度截斷

### `05_Memory.gs`

短期記憶層。

包含：

- CacheService 讀寫
- 同聊天室短期多輪記憶
- 記憶修剪
- `#reset` 使用的清除功能

### `06_WebReader.gs`

網址與網頁讀取層。

包含：

- URL 擷取
- 網址安全檢查
- UrlFetchApp 抓網頁
- HTML 輕量清理
- 網頁正文抽取流程輔助
- 建立送給 DeepSeek 的網頁閱讀 prompt

### `07_WebTaskQueue.gs`

背景任務與 Pending Reply 層。

包含：

- 建立 WebTaskQueue 任務
- `processWebTaskQueue()` 排程處理
- 單一任務處理
- 快讀摘要任務
- 節目話題網址分析任務
- PendingReplies 建立與交付

注意：`processWebTaskQueue()` 是 time-driven trigger 會呼叫的函式，函式名稱不可隨意更改。  
網址任務失敗、單篇網址讀取失敗、快讀結果區塊等固定回覆格式由 `12_ResponseTexts.gs` 管理。

### `08_GeminiService.gs`

Gemini API 服務層。

包含：

- Gemini 網頁快讀摘要
- Gemini 網頁正文抽取
- Gemini schema-like 資料契約
- Gemini JSON mode generationConfig
- Gemini 回應文字解析
- Gemini usage log

v1.9.3 起，此檔使用 `responseMimeType: 'application/json'` 作為 Gemini JSON mode。  
`getGeminiLazySummarySchema_()` 與 `getGeminiWebExtractorSchema_()` 暫時不直接送進 Gemini API，只作為維護用資料契約。

維護時請注意：

- 若未來要重新啟用 structured output schema，必須先確認目前模型與 endpoint 是否支援。
- 不要直接把 `responseFormat.text.mimeType/schema` 恢復到 `gemini-3.1-flash-lite + v1beta`，否則可能再次出現 400 INVALID_ARGUMENT。

### `09_DeepSeekService.gs`

DeepSeek API 服務層。

包含：

- DeepSeek API 呼叫
- 短期記憶與長期記憶組裝
- 網頁閱讀內容交給 DeepSeek
- temperature / max_tokens 控制
- DeepSeek usage log

### `10_TopicFeatures.gs`

節目企劃功能層。

包含：

- `#節目話題分析`
- `#統整話題`
- `#封存本週話題`
- WeeklySummary 封存 JSON 解析

未來若新增節目大綱、SEO 標題、社群貼文、逐字稿等高階功能，可以優先放在這裡，再視情況繼續拆。  
沒有足夠素材時的固定提醒、封存完成訊息，由 `12_ResponseTexts.gs` 管理。

### `11_Prompts.gs`

Prompt 管理層。

包含：

- 小浣基礎人格
- 摘要模式 prompt
- 回顧模式 prompt
- 標題模式 prompt
- 節目話題分析 prompt
- 統整話題 prompt
- 封存 prompt
- 一般聊天 prompt

### `12_ResponseTexts.gs`

固定回覆文字層。

包含：

- 小浣目前版本資料
- 主要版本紀錄資料
- `#版本` 回覆文字
- `#版本紀錄` 回覆文字
- 任務接收文字
- Pending reply 交付文字
- reset / 清空紀錄 / 記錄等系統提示
- 網址快讀結果區塊格式
- 錯誤提示文字

這個檔案只放固定文字與簡單格式化，不呼叫 DeepSeek / Gemini。  
若未來想調整小浣的「非 LLM 回覆語氣」，優先修改此檔。

### `99_changelog.md`

版本紀錄。

## 放進 Google Apps Script 的方式

建議先在 GAS 專案中刪除舊的單一 `03_AiLogic.gs`，避免函式重複定義。

然後建立並貼上以下檔案：

1. `00_Config.gs`
2. `01_Main.gs`
3. `02_LineCommands.gs`
4. `03_Utils.gs`
5. `04_Storage.gs`
6. `05_Memory.gs`
7. `06_WebReader.gs`
8. `07_WebTaskQueue.gs`
9. `08_GeminiService.gs`
10. `09_DeepSeekService.gs`
11. `10_TopicFeatures.gs`
12. `11_Prompts.gs`
13. `12_ResponseTexts.gs`

## 維護建議

- 改非 LLM 固定回覆、版本資訊：看 `12_ResponseTexts.gs`
- 改語氣與人格 prompt：看 `11_Prompts.gs`
- 改 LINE 指令：看 `02_LineCommands.gs`
- 改 Sheet 欄位：看 `04_Storage.gs`
- 改網址抓取：看 `06_WebReader.gs`
- 改排程與 Pending Reply：看 `07_WebTaskQueue.gs`
- 改 Gemini：看 `08_GeminiService.gs`
- 改 DeepSeek：看 `09_DeepSeekService.gs`
- 改節目企劃功能：看 `10_TopicFeatures.gs`
