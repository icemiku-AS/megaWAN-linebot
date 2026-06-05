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
Current Version: v1.9.2 Humanized System Reply Edition  
Current Branch: main  
Source of Truth: GitHub main branch latest commit

本專案目前以 GitHub `main` branch 的最新 commit 作為唯一現行程式碼來源。

若本文件、README、Changelog、舊對話紀錄或先前上傳檔案之間出現矛盾，請依照下列優先順序判斷：

1. GitHub main branch 最新 commit 中的實際 `.gs` 程式碼
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
- 不可將 v1.6、v1.7、v1.8、v1.9.0、v1.9.1 等歷史版本描述直接視為目前程式邏輯。
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

## AI Collaboration Rule

當 AI 助手協助本專案時，請遵守以下規則：

1. 以 GitHub main branch 最新 commit 為準。
2. 優先讀取 `CURRENT_VERSION.md` 與 `README.md`。
3. 再讀取現行 `.gs` 程式碼。
4. `99_changelog.md` 只作為歷史參考。
5. 不要使用舊對話、舊記憶、過去上傳檔案來覆蓋 GitHub 最新版本。
6. 若本次任務需要修改程式，請先提出修改方案，不要直接假設舊版架構仍存在。
7. 若 GitHub 檔案中找不到某個函式、常數或流程，請先指出缺少依據，不要根據舊記憶補寫。
8. 若檔案之間出現矛盾，請優先相信實際 `.gs` 程式碼。
9. 若要修改 GitHub repo，除非維護者明確要求，否則不要直接修改 main branch。
10. 建議先產生可複製版本，或建立 feature branch / PR 供維護者確認。
11. 預設工作模式為只讀與分析 GitHub 檔案，不直接修改 repository。
12. 若需要修改 repository，必須先向維護者確認修改檔案、修改內容與修改方式。
13. 除非維護者明確要求，否則不得直接 commit 到 main branch；建議使用 feature branch 或提供可複製程式碼。

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
7. 背景任務與 Pending Reply 由 `07_WebTaskQueue.gs` 處理
8. Gemini API 相關流程由 `08_GeminiService.gs` 處理
9. DeepSeek API 相關流程由 `09_DeepSeekService.gs` 處理
10. 節目企劃功能由 `10_TopicFeatures.gs` 處理
11. Prompt 內容集中於 `11_Prompts.gs`
12. 不經過 LLM 的固定回覆、版本資訊與版本紀錄集中於 `12_ResponseTexts.gs`

---

## v1.9.2 Key Difference

v1.9.2 的主要變更集中在固定回覆文字與版本查詢。

本版新增：

1. 新增 `12_ResponseTexts.gs`，集中管理不經過 LLM 的固定回覆文字。
2. 新增 `#版本` 指令，可查看目前版本與本版新增功能。
3. 新增 `#版本紀錄` 指令，可查看主要版本更新摘要。
4. 調整任務接收、pending reply、reset、清空紀錄、記錄、錯誤提示、封存完成等固定回覆語氣。
5. 保留既有 LINE 指令流程、Sheet 架構與模型呼叫方式。

此版本不改變 Google Sheet 主要欄位、不導入 Node.js / npm、不改變 DeepSeek 或 Gemini 模型設定，主要目標是讓非 LLM 回覆也維持小浣一致的人格與可維護性。

---

## Previous Key Difference

v1.9.1 的主要變更集中在 `08_GeminiService.gs`。

本版將 Gemini 網頁快讀摘要與 Gemini 網頁正文抽取改為 structured output schema：

1. 快讀摘要 schema 集中於 `getGeminiLazySummarySchema_()`。
2. 正文抽取 schema 集中於 `getGeminiWebExtractorSchema_()`。
3. Gemini JSON generation config 集中於 `buildGeminiJsonGenerationConfig_()`。
4. 新增 normalizer helper，對字串、字串陣列、數字與 enum 做最後防守。
5. 保留 `parseJsonObjectLoose()` 作為 fallback，避免偶發格式問題造成任務中斷。

---

## Update Rule

每次專案架構有重大變動時，請同步更新本文件。

尤其是以下情況：

- 新增或刪除主要 `.gs` 檔案
- 改變目前正式版本號
- 改變主要執行環境
- 從 GAS 改為 clasp / Node.js / 其他部署方式
- 變更 secret 管理策略
- 變更 GitHub branch 流程
- 新增 AI 協作規則
- 變更 AI 與 GitHub repository 的讀寫協作流程

---

## Last Confirmed

Last Confirmed Version: v1.9.2 Humanized System Reply Edition  
Last Confirmed Date: 2026-06-05
