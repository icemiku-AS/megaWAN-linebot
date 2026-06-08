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
Current Version: v1.10.8 Manual News Supplement Parse Hotfix  
Current Working Branch: hotfix/v1108-manual-news-parse  
Target Branch: main  
Source of Truth before merge: GitHub PR branch `hotfix/v1108-manual-news-parse`  
Source of Truth after merge: GitHub `main` branch latest commit

PR 合併前，若要檢查 v1.10.8，請讀 `hotfix/v1108-manual-news-parse`。

PR 合併後，不要再把 `hotfix/v1108-manual-news-parse` 視為現行執行來源；請改以 `main` branch 最新 commit 作為唯一現行程式碼來源。

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

以下檔案代表 v1.10.8 Manual News Supplement Parse Hotfix 的正式程式結構：

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

## v1.10.8 Key Difference

v1.10.8 是 Manual News Supplement Parse Hotfix。

本版只修正 `#新聞補充` 的人工補充解析問題，不導入新 reader provider，不修改 NewsUrlQueue、不修改資料清理層。

問題背景：

1. v1.10.0 的人工新聞補充曾使用 `parseJsonObjectLoose()` 解析 DeepSeek 回傳 JSON。
2. v1.10.2 cleanup 後，`parseManualNewsSupplement_()` 誤改成呼叫不存在的 `parseLooseJson()`。
3. 因為這段外層有 try/catch，錯誤不會讓 `#新聞補充` 直接失敗，而是每次靜默掉進 fallback。
4. 使用者表面上會看到「補充成功」，但 DeepSeek 解析出的分類、簡介、切角與節目潛力其實沒有被使用。

主要調整：

1. `13_NewsInbox.gs` 的 `parseManualNewsSupplement_()` 改回使用 `parseJsonObjectLoose()`。
2. 使用 `parseJsonObjectLoose(responseText) || {}` 防守 DeepSeek 偶發非 JSON 回覆。
3. 保留 fallback：若 DeepSeek API 失敗或解析發生例外，仍會用使用者原文建立人工補充素材。
4. 補上詳細註解，說明這是 v1.10.2 cleanup 留下的靜默降級型 bug。

---

## Reader Layer Scope

v1.10.8 延續 v1.10.7 的 reader 分流：

- 一般網站：Jina Reader。
- PTT：GAS 原生 `UrlFetchApp` + `over18=1` cookie，並在 `16_ReaderLayer.gs` 內套用 v1.10.6 的 over18 gate 誤判修正。
- X / Twitter / Facebook / Threads：本版仍不支援自動擷取，但會在 NewsInbox 入隊前直接攔截，不再進 queue 重試。
- Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## Existing Cleanup Command Scope

v1.10.8 沒有修改 v1.10.4 的清理功能。

清理指令與資料表對應仍如下：

- `#清空紀錄`：`ConversationLog`，並清除短期記憶。
- `#清空重點`：`TopicHighlights`。
- `#清空快讀`：`WebSummary`、`WebTaskQueue`。
- `#清空封存`：`WeeklySummary`。
- `#清空新聞`：`NewsInbox`、`NewsUrlQueue`。
- `#清空待回覆`：`PendingReplies`。

所有清理都只限目前聊天室的 `conversationId`。

---

## Explicitly Not Included in v1.10.8

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
- NewsUrlQueue 重構
- Reader Layer 重構
- Gemini / DeepSeek prompt 主架構重構
- 大規模重寫 NewsInbox 分類架構

上述功能若要實作，應另開後續 feature branch。

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
- `#新聞補充 這篇大概在講 X 平台政策變動，偏社群輿論，節目潛力高，https://x.com/example/status/123`
- 確認 NewsInbox 新增資料的分類、簡介、切角與節目潛力不再每次都只落入 fallback 預設值。
- 直接貼一般新聞網址，確認 NewsUrlQueue / NewsInbox 自動分類仍正常。
- 直接貼 X / Facebook / Threads 網址，確認仍會立即回覆未支援，且不新增 NewsUrlQueue pending task。
- `#本週新聞`
- `#help`
- `#help 資料`

---

## Last Confirmed

Last Confirmed Version: v1.10.8 Manual News Supplement Parse Hotfix  
Last Confirmed Date: 2026-06-08
