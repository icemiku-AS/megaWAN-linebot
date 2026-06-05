# 小浣 LINE Bot v1.9.1 Structured Gemini Output Edition

這是 MEGA浣 / 小浣 的 Google Apps Script 分檔版。

正式名稱：MEGA浣  
小名：小浣  
定位：Podcast「現正熱潮中」的 LINE 群組企劃助理。  
形象：長著浣熊耳朵與尾巴、會從垃圾桶探出頭，把雜亂社群資訊翻成可用素材的小幫手。

## 本版定位

v1.9.1 Structured Gemini Output Edition 以 v1.9.0 Service Split Edition 為基礎，不改變 LINE 使用流程、不新增使用者可見指令，主要目標是強化 Gemini 回傳資料的穩定性。

本版原則：

1. 不主動新增使用者可見功能。
2. 不主動改變原本 LINE 指令流程。
3. 不改變主要 Sheet 架構。
4. 將 Gemini 網頁快讀摘要與正文抽取改為 structured output schema。
5. 保留詳細註解，方便未來人工維護與 AI 重新讀取。

## v1.9.1 主要變更

本版主要修改 `08_GeminiService.gs`：

1. 新增 `getGeminiLazySummarySchema_()`，集中定義快讀摘要 JSON 結構。
2. 新增 `getGeminiWebExtractorSchema_()`，集中定義網頁正文抽取 JSON 結構。
3. 新增 `buildGeminiJsonGenerationConfig_()`，統一建立 Gemini JSON structured output 設定。
4. 新增 normalizer helper：
   - `normalizeGeminiString_()`
   - `normalizeGeminiStringArray_()`
   - `normalizeGeminiNumber_()`
   - `normalizeGeminiEnum_()`
5. 快讀摘要的 `contentTypeLabel` 與 `topicPotential` 改用 enum 防守，避免模型輸出不利程式判斷的自由文字。
6. 保留 `parseJsonObjectLoose()` 作為 fallback，避免偶發格式問題讓排程任務整個中斷。

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

### `01_Main.gs`

主要入口與主流程。

包含：

- `setupLogSheet()`
- `installWebTaskQueueTrigger()`
- `doPost(e)`
- `handleLineEvent(event)`

這個檔案負責 LINE webhook 入口、文字訊息判斷、主流程分流。

### `02_LineCommands.gs`

LINE 指令與回覆層。

包含：

- 指令解析
- mode 判斷
- conversationId 取得
- LINE Reply API
- Help 文字
- 網址任務接受回覆文字

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

### `08_GeminiService.gs`

Gemini API 服務層。

包含：

- Gemini 網頁快讀摘要
- Gemini 網頁正文抽取
- Gemini structured output schema
- Gemini 回應文字解析
- Gemini usage log

v1.9.1 起，此檔會集中管理 Gemini structured output schema。  
維護時請注意：schema、normalizer、函式回傳格式應互相對齊。

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

## 維護建議

- 改語氣與人格：看 `11_Prompts.gs`
- 改 LINE 指令：看 `02_LineCommands.gs`
- 改 Sheet 欄位：看 `04_Storage.gs`
- 改網址抓取：看 `06_WebReader.gs`
- 改排程與 Pending Reply：看 `07_WebTaskQueue.gs`
- 改 Gemini：看 `08_GeminiService.gs`
- 改 DeepSeek：看 `09_DeepSeekService.gs`
- 改節目企劃功能：看 `10_TopicFeatures.gs`
