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
外部服務：LINE Messaging API、DeepSeek API、Gemini API

---

## Current Version

Repository: icemiku-AS/megaWAN-linebot  
Current Version: v1.10.3 Highlight Layer Edition  
Current Pull Request: PR #14  
Current Working Branch: feature/v1103-highlights  
Target Branch: main  
Source of Truth before merge: GitHub PR #14 branch `feature/v1103-highlights`  
Source of Truth after merge: GitHub `main` branch latest commit

PR #14 合併前，若要檢查 v1.10.3，請讀 `feature/v1103-highlights`。

PR #14 合併後，不要再把 `feature/v1103-highlights` 視為現行執行來源；請改以 `main` branch 最新 commit 作為唯一現行程式碼來源。

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

以下檔案代表 v1.10.3 Highlight Layer Edition 的正式程式結構：

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

---

## v1.10.3 Key Difference

v1.10.3 是 Highlight Layer Edition。

本版只做「重點資料層」，不做多資料表清理。

主要調整：

1. `#記錄` 升級為 `#畫重點`。
2. 新增 `TopicHighlights` Sheet，保存使用者手動標記的重要內容。
3. `#統整話題`、無網址版 `#節目話題分析`、`#封存本週話題` 會納入 TopicHighlights。
4. 節目整理相關功能從 ConversationLog 讀資料時，只讀使用者訊息，不納入小浣回覆。
5. 保留 v1.10.2 的網址行為：直接貼網址收進 NewsInbox；明確使用 `#懶人包` 才做快讀摘要。
6. `#清空紀錄` 仍只處理 ConversationLog，不會清除 TopicHighlights、WeeklySummary、WebSummary 或 NewsInbox。

---

## Explicitly Not Included in v1.10.3

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

- `#清空重點`
- `#清空快讀`
- `#清空封存`
- `#清空新聞`
- `#清空待回覆`
- 多資料表清理指令
- `15_BuiltInCommands.gs`
- `16_ResponseTextsV1103.gs`
- `17_VersionTextsV1103.gs`
- 任何 Node.js / npm / 自架伺服器架構

上述清理功能若要實作，應另開 v1.10.4 或後續 feature branch，不要把舊 PR #10 的失敗嘗試當作目前程式碼來源。

---

## Reverted / Historical Work Warning

曾經有一版 v1.10.3 Highlight & Cleanup Edition 嘗試同時導入：

- TopicHighlights
- 分層 help
- 多資料表清理
- 內建指令拆檔
- 額外版本文字檔

該批修改後來已被 revert，不是目前正式實作。

目前 v1.10.3 Highlight Layer Edition 是從乾淨 v1.10.2 baseline 重新製作，只保留重點資料層，不延續舊失敗分支的多資料表清理架構。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。

請勿預設本專案需要：

- Node.js
- npm
- package.json
- node_modules
- npm install
- npm start

除非維護者明確表示要導入 `clasp` 或將專案改為本機 / 自架伺服器執行，否則請一律視為 Google Apps Script 專案。

---

## Suggested Smoke Tests After Merge

PR 合併後，建議先在 Apps Script 執行：

- `setupLogSheet()`

確認 `TopicHighlights` 已建立。

接著在 LINE 測試：

- `#版本`
- `#help`
- `#畫重點 測試一段節目重點`
- `#統整話題`
- `#節目話題分析`
- `#封存本週話題`
- `#清空紀錄`，確認它只提示清 ConversationLog，不影響 TopicHighlights

---

## Last Confirmed

Last Confirmed Version: v1.10.3 Highlight Layer Edition  
Last Confirmed Pull Request: PR #14  
Last Confirmed Date: 2026-06-08
