# CURRENT_VERSION

本文件是 MEGA浣 / 小浣 專案的現行版本判定文件。

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
Current Version: v1.10.3 Highlight & Cleanup Edition  
Current Working Branch: feature/v1103-highlights-cleanup  
Target Branch: main  
Source of Truth: GitHub pull request branch before PR merge; after merge, GitHub main branch latest commit

PR 合併後，不要再把 `Current Working Branch` 視為現行執行來源；請改以 `main` branch 最新 commit 作為唯一現行程式碼來源。

若本文件、README、Changelog、舊對話紀錄或先前上傳檔案之間出現矛盾，請依照下列優先順序判斷：

1. GitHub 目標版本分支 / main branch 最新 commit 中的實際 `.gs` 程式碼
2. `CURRENT_VERSION.md`
3. `README.md`
4. `99_changelog.md` 的最新版本段落
5. 舊版 changelog、舊對話紀錄、過去上傳檔案、歷史備份內容

---

## Active Source Files

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
- `14_HighlightsCleanup.gs`
- `15_BuiltInCommands.gs`
- `16_ResponseTextsV1103.gs`
- `17_VersionTextsV1103.gs`

---

## Documentation Files

- `README.md`
- `99_changelog.md`
- `CURRENT_VERSION.md`

`99_changelog.md` 僅作為歷史版本紀錄；若 changelog 與目前 `.gs` 程式碼不同，請以目前 `.gs` 程式碼為準。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。

請勿預設本專案需要 Node.js、npm、package.json、node_modules、npm install 或 npm start。

除非維護者明確表示要導入 `clasp` 或將專案改為本機 / 自架伺服器執行，否則請一律視為 Google Apps Script 專案。

---

## v1.10.3 Key Difference

v1.10.3 是 Highlight & Cleanup Edition。

本版主要調整：

1. `#記錄` 升級為 `#畫重點`。
2. 新增 `TopicHighlights` Sheet，讓人工標記的重點從 ConversationLog 中獨立出來。
3. `#統整話題`、無網址版 `#節目話題分析`、`#封存本週話題` 都會納入 TopicHighlights。
4. 節目整理相關功能從 ConversationLog 只讀使用者訊息，不納入小浣回覆。
5. 新增分層 help：`#help`、`#help 清理`、`#help 管理`、`#help 資料`、`#help 全部`。
6. 新增多資料表維護指令，且都只作用於目前 conversationId。
7. `01_Main.gs` 進一步瘦身，內建指令集中到 `15_BuiltInCommands.gs`。

---

## Last Confirmed

Last Confirmed Version: v1.10.3 Highlight & Cleanup Edition  
Last Confirmed Date: 2026-06-08
