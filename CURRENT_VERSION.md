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
Current Version: v1.10.3 Highlight Layer Edition  
Current Working Branch: feature/v1103-highlights  
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
6. 本版不新增 `#清空重點`、`#清空快讀`、`#清空封存`、`#清空新聞` 等多資料表清理指令。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。請勿預設本專案需要 Node.js、npm、package.json、node_modules、npm install 或 npm start。

---

## Last Confirmed

Last Confirmed Version: v1.10.3 Highlight Layer Edition  
Last Confirmed Date: 2026-06-08
