# 小浣 LINE Bot v1.10.4 Data Cleanup Edition

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.3 新增 TopicHighlights，讓使用者可以用 #畫重點 建立人工重點資料層。

v1.10.4 接續處理資料維護問題：新增多資料表清理指令，並將清理邏輯集中在 15_DataCleanup.gs。所有清理都採二段式確認，且只作用於目前聊天室的 conversationId。

---

## 2. v1.10.4 本版重點

v1.10.4 是 Data Cleanup Edition。

主要調整如下：

- 新增分層 help：#help、#help 清理、#help 管理、#help 資料、#help 全部。
- 新增多資料表清理指令：#清空重點、#清空快讀、#清空封存、#清空新聞、#清空待回覆。
- 保留 #清空紀錄，並改成和其他清理指令共用同一套清理流程。
- 所有清理都需二段式確認，例如先輸入 #清空重點，再輸入 #清空重點 確認。
- 所有清理只處理目前 conversationId，不會跨聊天室、不刪整張 Sheet、不刪表頭。
- 新增 15_DataCleanup.gs，集中管理資料清理規則與執行。
- 本版不修改 AI prompt 主邏輯、不修改網址讀取架構、不導入 Node.js。

---

## 3. 常用指令

### 直接貼網址

直接貼上網址時，小浣會將網址加入 NewsUrlQueue，由背景流程抓取網頁資訊、分類與整理，再寫入 NewsInbox。

個人聊天室與群組聊天室行為一致。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。

### 新聞補充

人工補充新聞素材到 NewsInbox。

### 懶人包

針對指定網址產生快讀摘要。一般直接貼網址不會產生懶人包，而是收進 NewsInbox。

### 節目話題分析

可針對網址做深度分析；不附網址時，會根據使用者近期聊天、TopicHighlights、WebSummary、WeeklySummary 判斷可分析主題。

### 統整話題

整合近期素材，整理成節目可用的話題地圖。

### 畫重點

將重要內容寫入 TopicHighlights。後續統整話題、節目話題分析、封存本週話題都會優先參考。

### 封存本週話題

將近期使用者討論、畫重點與網址快讀摘要整理成 WeeklySummary。

---

## 4. Help 與管理指令

### #help

查看常用功能。

### #help 清理

查看資料清理指令。

### #help 管理

查看版本、reset、資料說明等管理指令。

### #help 資料

查看目前各 Google Sheet 的用途。

### #help 全部

查看完整說明。

### #版本

查看目前版本。

### #版本紀錄

查看近期版本紀錄摘要。完整歷史仍以 99_changelog.md 為準。

### #reset

清除當前 conversationId 的短期記憶狀態。這只會清除 CacheService 中的短期對話記憶，不會刪除 Google Sheet 裡的長期資料。

---

## 5. 資料清理指令

所有清理指令都只作用於目前聊天室的 conversationId，不會影響其他私訊或群組。

所有清理指令都需要二段式確認。

- #清空紀錄：清除 ConversationLog，並清除短期記憶。
- #清空重點：清除 TopicHighlights。
- #清空快讀：清除 WebSummary 與 WebTaskQueue。
- #清空封存：清除 WeeklySummary。
- #清空新聞：清除 NewsInbox 與 NewsUrlQueue。
- #清空待回覆：清除 PendingReplies。

使用方式：先輸入清理指令查看影響範圍，確認後再輸入「原指令 確認」。

---

## 6. 資料表概念

本專案主要使用 Google Sheets 作為資料儲存層。

- ConversationLog：保存使用者與小浣的原始對話紀錄。
- TopicHighlights：保存 #畫重點 產生的人工釘選素材。
- WeeklySummary：保存 #封存本週話題 產生的長期記憶摘要。
- WebTaskQueue：保存網址快讀與網址版節目分析的背景任務。
- WebSummary：保存網址快讀摘要。
- NewsUrlQueue：保存直接貼網址後的新聞網址待處理佇列。
- NewsInbox：新聞素材池。
- PendingReplies：背景任務完成後，等待下次訊息交付的回覆。

---

## 7. 檔案配置

目前主要檔案如下：

- 00_Config.gs：API endpoint、模型名稱、Sheet 名稱、指令前綴與系統常數。
- 01_Main.gs：LINE webhook 主流程。
- 02_LineCommands.gs：指令解析、分層 help 與 LINE Reply API。
- 03_Utils.gs：共用工具函式。
- 04_Storage.gs：Google Sheet 與 Script Properties 入口。
- 05_Memory.gs：短期對話記憶。
- 06_WebReader.gs：網址擷取與 HTML 清理。
- 07_WebTaskQueue.gs：背景處理懶人包與網址版節目話題分析。
- 08_GeminiService.gs：Gemini API 相關流程。
- 09_DeepSeekService.gs：DeepSeek API 相關流程。
- 10_TopicFeatures.gs：節目話題分析、統整話題、封存本週話題。
- 11_Prompts.gs：一般 prompt。
- 12_ResponseTexts.gs：固定文案與版本資訊。
- 13_NewsInbox.gs：新聞素材池。
- 14_TopicHighlights.gs：人工重點資料層。
- 15_DataCleanup.gs：資料清理層。

---

## 8. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. Secret value 應放在 Apps Script 的 Script Properties。
4. 99_changelog.md 僅作為歷史紀錄。
5. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
6. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
7. 若要修改程式，不要直接改 main，應建立 feature 或 hotfix branch，開 PR 後由維護者手動 merge。

---

## 9. v1.10.4 建議測試流程

PR 合併後，建議先在 Apps Script 中執行 setupLogSheet()。

接著在 LINE 測試：#版本、#help、#help 清理、#help 管理、#help 資料、#清空重點、#清空重點 確認、#清空快讀、#清空封存、#清空新聞、#清空待回覆。

測試清理時建議先用測試聊天室，確認只處理目前 conversationId。
