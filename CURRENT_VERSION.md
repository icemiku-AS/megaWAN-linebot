# CURRENT_VERSION

本文件是 MEGA浣 / 小浣 專案的「現行版本判定文件」。

本文件主要供 AI 助手、維護者、協作者在讀取 GitHub 專案時，快速判斷哪一批檔案代表目前正式架構，避免誤用舊版對話、舊版備份檔案或 `99_changelog.md` 中的歷史內容。

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
Current Version: v1.10.1 News Inbox Hotfix  
Current Branch: hotfix/v1.10.1-news-inbox-format  
Target Branch: main  
Source of Truth: GitHub hotfix branch before PR merge; after merge, GitHub main branch latest commit

本專案目前以 GitHub 上本次 v1.10.1 hotfix 分支作為待合併版本來源。合併後，仍以 `main` branch 最新 commit 作為唯一現行程式碼來源。

若本文件、README、Changelog、舊對話紀錄或先前上傳檔案之間出現矛盾，請依照下列優先順序判斷：

1. GitHub 目標版本分支 / main branch 最新 commit 中的實際 `.gs` 程式碼
2. `CURRENT_VERSION.md`
3. `README.md`
4. `99_changelog.md` 的最新版本段落
5. 舊版 changelog、舊對話紀錄、過去上傳檔案、歷史備份內容

---

## Active Source Files

以下檔案代表目前小浣正式版本的主要程式碼結構：

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

---

## Documentation Files

以下檔案為輔助文件：

- `README.md`
- `99_changelog.md`
- `CURRENT_VERSION.md`

其中：

- `README.md` 用於說明目前架構、檔案責任與維護方式。
- `99_changelog.md` 用於保存歷史版本紀錄。
- `CURRENT_VERSION.md` 用於明確宣告目前版本與判定規則。

---

## Changelog Reading Rule

`99_changelog.md` 僅作為歷史版本紀錄。

讀取 `99_changelog.md` 時，請注意：

- 舊版段落不代表目前實作。
- 不可將 v1.6、v1.7、v1.8、v1.9.x 等歷史版本描述直接視為目前程式邏輯。
- 若 changelog 與目前 `.gs` 程式碼不同，請以目前 `.gs` 程式碼為準。
- 若需要引用 changelog，請明確標示該內容屬於歷史紀錄或版本變更說明。

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

## Secret Management Rule

本專案的 API Key、Token、Sheet ID 等敏感資料，不應寫入 GitHub 版本管理檔案。

真正的敏感值應放在 Google Apps Script 的 Script Properties。

常見 Script Properties 包含：

- `LINE_CHANNEL_ACCESS_TOKEN`
- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`
- `SPREADSHEET_ID`

GitHub 中可以保存 Script Properties 的「名稱」與「設定說明」，但不可保存真正的 secret value。

---

## Current Architecture Summary

小浣目前是 Google Apps Script 分檔架構。

核心流程：

1. LINE webhook 進入 `01_Main.gs`
2. LINE 指令與回覆處理由 `02_LineCommands.gs` 管理
3. 系統常數集中於 `00_Config.gs`
4. Google Sheet 與 Script Properties 入口集中於 `04_Storage.gs`
5. 短期記憶由 `05_Memory.gs` 管理
6. 網址擷取與 HTML 清理由 `06_WebReader.gs` 處理
7. 舊網址快讀 / 節目分析背景任務由 `07_WebTaskQueue.gs` 處理
8. Gemini API 相關流程由 `08_GeminiService.gs` 處理
9. DeepSeek API 相關流程由 `09_DeepSeekService.gs` 處理
10. 節目企劃功能由 `10_TopicFeatures.gs` 處理
11. Prompt 內容集中於 `11_Prompts.gs`
12. 固定回覆、版本資訊與版本紀錄集中於 `12_ResponseTexts.gs`
13. 新聞素材池、NewsUrlQueue、NewsInbox、#本週新聞、#新聞補充由 `13_NewsInbox.gs` 處理

---

## v1.10.1 Key Difference

v1.10.1 是 News Inbox Hotfix。

本版主要修正：

1. 修正 v1.10.0 可能把 Gemini 分類不足的結果直接寫入 `NewsInbox`，造成「待分類 / 標題是網址 / 簡介空白」仍顯示 `ok` 的問題。
2. 自動分類若回傳無效分類、`待分類` 或內容不足，會回到 `NewsUrlQueue` 依既有規則重試；重試失敗才建立 PendingReplies 通知。
3. `#本週新聞` 改由程式端固定排版，確保 LINE 內顯示為分類、標題、來源、節目潛力的多行格式。
4. 保留 `#新聞補充` 的 DeepSeek 自然語言解析流程；人工補充仍可寫入 `待分類`。

---

## Last Confirmed

Last Confirmed Version: v1.10.1 News Inbox Hotfix  
Last Confirmed Date: 2026-06-06
