# 小浣 LINE Bot v1.10.2 Secretary Cleanup Edition

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.2 開始，小浣的產品方向正式收斂為「新聞素材秘書」。本版移除低使用率、容易和其他功能重疊的指令，讓入口更乾淨，後續維護也更容易。

---

## 2. v1.10.2 本版重點

v1.10.2 移除了以下指令：

- #摘要
- #摘要最近
- #回顧最近
- #標題
- #讀網址

保留 #懶人包 作為唯一明確網址快讀入口。

個人聊天室與群組聊天室的直接貼網址行為一致：都會收進 NewsUrlQueue，背景整理後進入 NewsInbox。

---

## 3. 常用指令

直接貼網址：收進 NewsUrlQueue，背景整理後進 NewsInbox。

#本週新聞：查看最近 7 天 NewsInbox 新聞素材。

#新聞補充 文字 + 網址：人工補充新聞素材到 NewsInbox。

#懶人包 網址：針對指定網址產生快讀摘要。

#節目話題分析 網址：針對指定網址做較深入的節目話題分析。

#節目話題分析：不附網址時，根據近期聊天、WebSummary、WeeklySummary 判斷可分析主題。

#統整話題：整理近期可用節目話題地圖。

#記錄 內容：將內容標記為重要對話紀錄。此功能仍存在於 v1.10.2，但尚未獨立成重點資料表。

#封存本週話題：將近期討論與網址摘要整理成 WeeklySummary。

---

## 4. Help 與管理

#help：查看可用功能。

#版本：查看目前版本。

#版本紀錄：查看近期版本紀錄。

#reset：清除短期記憶，不影響 Google Sheet 長期資料。

#清空紀錄：清除目前聊天室的 ConversationLog，需二段確認。

---

## 5. 主要資料表

- ConversationLog：原始對話紀錄。
- WeeklySummary：#封存本週話題 產生的長期記憶。
- WebTaskQueue：#懶人包 與網址版 #節目話題分析 的背景任務。
- WebSummary：網址快讀摘要。
- NewsUrlQueue：直接貼網址後的新聞網址待處理佇列。
- NewsInbox：新聞素材池。
- PendingReplies：背景任務完成後等待交付的回覆。

---

## 6. 主要檔案

- 00_Config.gs：常數、模型、Sheet 名稱、指令前綴。
- 01_Main.gs：LINE webhook 主流程。
- 02_LineCommands.gs：指令解析、help、LINE reply。
- 03_Utils.gs：共用工具。
- 04_Storage.gs：Google Sheet 入口與資料讀寫。
- 05_Memory.gs：短期記憶。
- 06_WebReader.gs：網址擷取與 HTML 清理。
- 07_WebTaskQueue.gs：網址快讀與節目分析背景任務。
- 08_GeminiService.gs：Gemini API。
- 09_DeepSeekService.gs：DeepSeek API。
- 10_TopicFeatures.gs：節目話題分析、統整、封存。
- 11_Prompts.gs：一般 prompt。
- 12_ResponseTexts.gs：固定文案與版本資訊。
- 13_NewsInbox.gs：新聞素材池。

---

## 7. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. 99_changelog.md 僅作為歷史紀錄。
4. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
5. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
