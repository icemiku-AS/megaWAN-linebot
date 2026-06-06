# 小浣 LINE Bot v1.10.0 News Inbox Edition

這是 MEGA浣 / 小浣 的 Google Apps Script 分檔版。

正式名稱：MEGA浣  
小名：小浣  
定位：Podcast「現正熱潮中」的 LINE 群組企劃助理。  
形象：長著浣熊耳朵與尾巴、會從垃圾桶探出頭，把雜亂社群資訊翻成可用素材的小幫手。

## 本版定位

v1.10.0 News Inbox Edition 將小浣的網址行為從「直接貼網址就自動產生懶人包」改成「直接貼網址先收進新聞素材池」。

本版原則：

1. 小浣像新聞素材秘書，不是第三位共同編輯。
2. 直接貼網址只做收件、抓取、分類、入庫。
3. 需要快讀摘要時，使用 `#懶人包` 或 `#讀網址`。
4. 需要本週剪報整理時，使用 `#本週新聞`。
5. 需要人工補充讀不到的網址時，使用 `#新聞補充`。
6. 保留 Google Apps Script 架構，不導入 Node.js / npm。
7. 程式碼保留詳細註解，方便未來人工維護與 AI 重新讀取。

## v1.10.0 主要變更

1. 新增 `13_NewsInbox.gs`，集中管理新聞素材池相關流程。
2. 新增 `NewsUrlQueue` Sheet，直接貼網址會先寫入這張佇列表。
3. 新增 `NewsInbox` Sheet，儲存已分類新聞素材。
4. `processNewsUrlQueue()` 每次最多處理 2 筆網址，降低 Gemini 連續呼叫壓力。
5. Gemini 負責自動網址分類，輸出標題、分類、50 字內簡介、觀點標籤與節目潛力。
6. `#本週新聞` 讀取最近 7 天 NewsInbox，由 DeepSeek 做秘書式整理，只輸出分類、標題、來源網址與節目潛力。
7. `#新聞補充` 支援自然語言補充，文字內有網址即可由 DeepSeek 判斷分類後寫入 NewsInbox。
8. 新增 `#懶人包`，作為明確網址快讀指令；`#讀網址` 保留。

## 新聞分類

NewsInbox 固定分類：

- 科技與 AI
- 社群輿論
- ACG娛樂
- 商業財經
- 國際政治
- 生活文化
- 馬斯克
- 川普
- 待分類

分類優先順序：馬斯克 > 川普 > 其他分類 > 待分類。

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
- NewsInbox / NewsUrlQueue Sheet 名稱

### `01_Main.gs`

主要入口與主流程。

包含：

- `setupLogSheet()`
- `installWebTaskQueueTrigger()`
- `doPost(e)`
- `handleLineEvent(event)`

v1.10.0 起，群組直接貼網址會進 `NewsUrlQueue`，不再直接進 `WebTaskQueue` 快讀摘要。

### `02_LineCommands.gs`

LINE 指令與回覆層。

包含：

- 指令解析
- mode 判斷
- conversationId 取得
- LINE Reply API
- Help 文字

新增指令：

- `#本週新聞`
- `#新聞補充`
- `#懶人包`

### `03_Utils.gs`

通用工具層。

包含：

- 簡單 ID 產生
- 寬鬆 JSON 解析

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

舊網址任務與 Pending Reply 層。

包含：

- 建立 WebTaskQueue 任務
- `processWebTaskQueue()` 排程處理
- 快讀摘要任務
- 節目話題網址分析任務
- PendingReplies 建立與交付

注意：`processWebTaskQueue()` 仍給 `#懶人包`、`#讀網址`、`#節目話題分析` 使用。

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
- NewsInbox 相關固定回覆
- 錯誤提示文字

### `13_NewsInbox.gs`

新聞素材池層。

包含：

- `ensureNewsUrlQueueSheet_()`
- `ensureNewsInboxSheet_()`
- `enqueueNewsUrlTasks()`
- `processNewsUrlQueue()`
- `processSingleNewsUrlTask_()`
- `callGeminiNewsInboxClassifier_()`
- `saveNewsInboxItem_()`
- `getRecentNewsInboxItems_()`
- `handleWeeklyNewsDigest_()`
- `handleManualNewsSupplement_()`

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
14. `13_NewsInbox.gs`

## 維護建議

- 改非 LLM 固定回覆、版本資訊：看 `12_ResponseTexts.gs`
- 改語氣與人格 prompt：看 `11_Prompts.gs`
- 改 LINE 指令：看 `02_LineCommands.gs`
- 改 Sheet 欄位：看 `04_Storage.gs` 與 `13_NewsInbox.gs`
- 改網址抓取：看 `06_WebReader.gs`
- 改舊快讀排程與 Pending Reply：看 `07_WebTaskQueue.gs`
- 改新聞素材池排程：看 `13_NewsInbox.gs`
- 改 Gemini：看 `08_GeminiService.gs` 與 `13_NewsInbox.gs`
- 改 DeepSeek：看 `09_DeepSeekService.gs` 與 `13_NewsInbox.gs`
- 改節目企劃功能：看 `10_TopicFeatures.gs`
