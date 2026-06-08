# CURRENT_VERSION

本文件是 MEGA浣 / 小浣 專案的現行版本判定文件。

本文件主要給未來的 AI 助手、維護者與協作者讀取，用來快速判斷目前正式架構，避免誤用舊對話、舊分支、已 revert 的 PR、舊版上傳檔案或歷史 changelog 內容。

---

## Project

正式名稱：MEGA浣  
小名：小浣  
用途：Podcast「現正熱潮中」的 LINE 群組企劃助理  
執行環境：Google Apps Script  
程式碼版本管理：GitHub  
主要資料儲存：Google Sheet  
外部服務：LINE Messaging API、DeepSeek API、Gemini API、Jina Reader

---

## Current Version

Repository: icemiku-AS/megaWAN-linebot  
Current Version: v1.10.5 Reader Layer Edition  
Current Working Branch: feature/v1105-reader-layer  
Target Branch: main  
Source of Truth before merge: GitHub PR branch `feature/v1105-reader-layer`  
Source of Truth after merge: GitHub `main` branch latest commit

PR 合併前，若要檢查 v1.10.5，請讀 `feature/v1105-reader-layer`。

PR 合併後，不要再把 `feature/v1105-reader-layer` 視為現行執行來源；請改以 `main` branch 最新 commit 作為唯一現行程式碼來源。

若本文件、README、Changelog、舊對話紀錄、先前上傳檔案或其他分支之間出現矛盾，請依照下列優先順序判斷：

1. GitHub 目標版本分支 / main branch 最新 commit 中的實際 `.gs` 程式碼
2. `CURRENT_VERSION.md`
3. `README.md`
4. `99_changelog.md` 的最新版本段落
5. 舊版 changelog、舊對話紀錄、過去上傳檔案、歷史備份內容

---

## Read Order for AI Assistants

每次讀取本專案時，建議順序如下：

1. 先讀 `CURRENT_VERSION.md`
2. 再讀 `README.md`
3. 再依任務需要讀實際 `.gs` 檔案
4. 最後才讀 `99_changelog.md`，且只把它當歷史紀錄

如果 `99_changelog.md` 的舊版段落與目前 `.gs` 實作不同，請一律相信目前 `.gs`。

---

## Active Source Files

以下檔案代表 v1.10.5 Reader Layer Edition 的正式程式結構：

- `00_Config.gs`
- `01_Main.gs`
- `02_LineCommands.gs`
- `03_Utils.gs`
- `04_Storage.gs`
- `05_Memory.gs`
- `06_WebReader.gs`
- `07_WebTaskQueue.gs`
- `08_GeminiService.gs`
- `09_DeepSeekService.gs`
- `10_TopicFeatures.gs`
- `11_Prompts.gs`
- `12_ResponseTexts.gs`
- `13_NewsInbox.gs`
- `14_TopicHighlights.gs`
- `15_DataCleanup.gs`
- `16_ReaderLayer.gs`

---

## v1.10.5 Key Difference

v1.10.5 是 Reader Layer Edition。

本版只做「網頁讀取前置層」的小批量更新，不重構整體 Bot 流程、不導入 Node.js、不改資料清理層。

主要調整：

1. 新增 `16_ReaderLayer.gs`，集中管理網頁讀取 provider。
2. 一般網站優先使用 Jina Reader，將網頁轉成較適合 LLM 使用的文字內容。
3. PTT 使用 GAS 原生 `UrlFetchApp`，並在 request header 帶 `Cookie: over18=1` 處理滿 18 歲確認頁。
4. `#懶人包` 的網址快讀改先透過 Reader Layer 取得正文，再交給 Gemini 做快讀摘要。
5. `#節目話題分析 + 網址` 改透過 Reader Layer 取得正文，再交給 DeepSeek 做節目分析。
6. NewsInbox 自動網址分類改透過 Reader Layer 取得 `mainText`，再交給 Gemini 分類。
7. 舊 raw HTML + Gemini extractor 流程保留為 legacy fallback，不在本版刪除。

---

## Reader Layer Scope

v1.10.5 的 reader 分流如下：

- 一般網站：Jina Reader。
- PTT：GAS 原生 `UrlFetchApp` + `over18=1` cookie。
- X / Twitter / Facebook / Threads：本版只偵測並回報尚未支援，建議暫時使用 `#新聞補充` 手動入庫。
- Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## Existing Cleanup Command Scope

v1.10.5 沒有修改 v1.10.4 的清理功能。

清理指令與資料表對應仍如下：

- `#清空紀錄`：`ConversationLog`，並清除短期記憶。
- `#清空重點`：`TopicHighlights`。
- `#清空快讀`：`WebSummary`、`WebTaskQueue`。
- `#清空封存`：`WeeklySummary`。
- `#清空新聞`：`NewsInbox`、`NewsUrlQueue`。
- `#清空待回覆`：`PendingReplies`。

所有清理都只限目前聊天室的 `conversationId`。

---

## Explicitly Not Included in v1.10.5

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

- Apify actor 整合
- ByCrawl 整合
- X / Twitter / Facebook / Threads 自動擷取
- PDF / 圖片 / 影片內容讀取
- `#資料狀態`
- 跨聊天室全域清理
- 自動排程清理
- 清理前自動備份 Sheet
- Node.js / npm / 自架伺服器架構
- 大規模重構 Gemini / DeepSeek prompt 主邏輯
- 大規模重寫 NewsInbox 分類架構

上述功能若要實作，應另開 v1.10.6 或後續 feature branch。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。

請勿預設本專案需要 Node.js、npm、package.json、node_modules、npm install 或 npm start。

除非維護者明確表示要導入 `clasp` 或將專案改為本機 / 自架伺服器執行，否則請一律視為 Google Apps Script 專案。

---

## Suggested Smoke Tests After Merge

PR 合併後，建議先在 Apps Script 執行：

- `setupLogSheet()`

接著在 LINE 測試：

- `#版本`
- 一般新聞網址直接貼上，確認進 NewsUrlQueue 並可寫入 NewsInbox。
- `#懶人包 一般新聞網址`
- `#節目話題分析 一般新聞網址`
- PTT 成人看板網址，確認 over18 cookie reader 可讀取。
- X / Facebook / Threads 網址，確認本版會回報尚未支援，而不是假裝讀取成功。
- `#本週新聞`
- `#help`
- `#help 資料`

---

## Last Confirmed

Last Confirmed Version: v1.10.5 Reader Layer Edition  
Last Confirmed Date: 2026-06-08
