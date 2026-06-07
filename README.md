# 小浣 LINE Bot v1.10.3 Highlight Layer Edition

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## v1.10.3 重點

本版只新增「重點資料層」，不導入多資料表清理。

主要調整：

- 原本的記錄功能升級為「畫重點」。
- 新增 TopicHighlights Sheet，用來保存人工標記的重要內容。
- 統整話題、無網址版節目話題分析、封存本週話題會參考 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀資料時，只讀使用者訊息，不納入小浣回覆。
- 直接貼網址仍維持 v1.10.2 行為：收進 NewsInbox；明確要求快讀時才走懶人包。

---

## 常用功能

- 直接貼網址：收進 NewsUrlQueue，背景整理後進 NewsInbox。
- 本週新聞：查看最近 7 天 NewsInbox 新聞素材。
- 新聞補充：人工補充新聞素材到 NewsInbox。
- 懶人包：針對指定網址產生快讀摘要。
- 節目話題分析：分析網址或近期素材。
- 統整話題：整理近期可用節目話題地圖。
- 畫重點：將重要內容寫入 TopicHighlights。
- 封存本週話題：整理成 WeeklySummary。

---

## 主要資料表

- ConversationLog：原始對話紀錄。
- TopicHighlights：人工標記的重要內容。
- WeeklySummary：封存後的長期記憶。
- WebTaskQueue：網址快讀與網址分析任務。
- WebSummary：網址快讀摘要。
- NewsUrlQueue：新聞網址待處理佇列。
- NewsInbox：新聞素材池。
- PendingReplies：背景任務完成後等待交付的回覆。

---

## 主要檔案

- 00_Config.gs
- 01_Main.gs
- 02_LineCommands.gs
- 03_Utils.gs
- 04_Storage.gs
- 05_Memory.gs
- 06_WebReader.gs
- 07_WebTaskQueue.gs
- 08_GeminiService.gs
- 09_DeepSeekService.gs
- 10_TopicFeatures.gs
- 11_Prompts.gs
- 12_ResponseTexts.gs
- 13_NewsInbox.gs
- 14_TopicHighlights.gs

---

## 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. 99_changelog.md 僅作為歷史紀錄。
4. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
5. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
