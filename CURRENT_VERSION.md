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
外部服務：LINE Messaging API、DeepSeek API、Gemini API、Jina Reader、FxTwitter API

---

## Current Version

Repository: icemiku-AS/megaWAN-linebot  
Current Version: v1.10.9 Social Reader Edition  
Current Working Branch: feature/v1109-reader  
Target Branch: main  
Source of Truth before merge: GitHub PR branch `feature/v1109-reader`  
Source of Truth after merge: GitHub `main` branch latest commit

PR 合併前，若要檢查 v1.10.9，請讀 `feature/v1109-reader`。

PR 合併後，不要再把 `feature/v1109-reader` 視為現行執行來源；請改以 `main` branch 最新 commit 作為唯一現行程式碼來源。

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

以下檔案代表 v1.10.9 Social Reader Edition 的正式程式結構：

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
- `17_SocialReaderLayer.gs`

---

## v1.10.9 Version Boundary

v1.10.9 是 Social Reader Edition。

本版只做社群網址 reader 分流調整：

1. X / Twitter 單篇 `/status/{id}` 貼文改用 FxTwitter API 讀取。
2. FxTwitter API 回傳會被整理成 Reader Layer 統一 webResult 格式，讓後續 NewsInbox、#懶人包、#節目話題分析 沿用既有流程。
3. Facebook、fb.watch、Threads.com、Threads.net 不再於入隊前被視為未支援平台，改先交給 Jina Reader 嘗試讀取。
4. 若 Jina Reader 失敗，仍保留 legacy raw HTML + Gemini extractor fallback。
5. FxTwitter API endpoint 放在 `00_Config.gs`。
6. v1.10.9 的版本文字與非 status 社群網址提示已併回 `12_ResponseTexts.gs`。

---

## Reader Layer Scope

v1.10.9 的 reader 分流：

- 一般網站：Jina Reader。
- PTT：GAS 原生 `UrlFetchApp` + `over18=1` cookie，並在 `16_ReaderLayer.gs` 內保留 v1.10.6 的 over18 gate 誤判修正。
- X / Twitter 單篇 status：`17_SocialReaderLayer.gs` 透過 FxTwitter API 讀取。
- X / Twitter 非單篇 status 網址：不自動讀取，避免把個人頁、搜尋頁或登入頁誤當正文。
- Facebook / fb.watch / Threads.com / Threads.net：先走 Jina Reader，不再入隊前攔截。
- Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## Existing Cleanup Command Scope

v1.10.9 沒有修改 v1.10.4 的清理功能。

清理指令與資料表對應仍如下：

- `#清空紀錄`：`ConversationLog`，並清除短期記憶。
- `#清空重點`：`TopicHighlights`。
- `#清空快讀`：`WebSummary`、`WebTaskQueue`。
- `#清空封存`：`WeeklySummary`。
- `#清空新聞`：`NewsInbox`、`NewsUrlQueue`。
- `#清空待回覆`：`PendingReplies`。

所有清理都只限目前聊天室的 `conversationId`。

---

## Explicitly Not Included in v1.10.9

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

- Apify actor 整合
- ByCrawl 整合
- Node.js / npm / 自架伺服器架構
- X / Twitter 個人頁、搜尋頁、列表頁自動擷取
- Facebook 私人貼文、登入牆內容或留言串完整擷取保證
- Threads 登入牆內容擷取保證
- PDF / 圖片 / 影片內容讀取
- `#資料狀態`
- 跨聊天室全域清理
- 自動排程清理
- 清理前自動備份 Sheet
- NewsUrlQueue 重構
- Reader Layer 大規模重構
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
- 直接貼一篇 `https://x.com/{user}/status/{id}`，確認可進 NewsUrlQueue 並寫入 NewsInbox。
- `#懶人包 https://x.com/{user}/status/{id}`，確認可產生 WebSummary / PendingReplies。
- `#節目話題分析 https://x.com/{user}/status/{id}`，確認 DeepSeek 可收到 Reader Layer 文字。
- 直接貼 `https://x.com/{user}`，確認非 status 網址不會無效重試。
- 直接貼 Facebook 公開貼文、fb.watch、Threads.com / Threads.net 連結，確認會嘗試 Jina Reader。
- 混合貼一般新聞網址 + X status + Threads 連結，確認可支援網址仍入隊。
- `#本週新聞`
- `#help`
- `#help 資料`

---

## Last Confirmed

Last Confirmed Version: v1.10.9 Social Reader Edition  
Last Confirmed Date: 2026-06-14
