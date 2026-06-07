# 小浣 LINE Bot v1.10.3 Highlight Layer Edition

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.2 開始，小浣的產品方向收斂為「新聞素材秘書」：直接貼網址先收進新聞素材池，明確使用懶人包時才產生快讀摘要。

v1.10.3 延續這個方向，新增「重點資料層」。原本的記錄功能升級為畫重點，並新增 TopicHighlights Sheet，讓使用者手動標記的重要內容不再只混在 ConversationLog 裡，而是成為後續統整、分析與封存時可優先參考的人工重點素材。

本版不導入多資料表清理，清理功能留待後續版本獨立處理。

---

## 2. v1.10.3 本版重點

v1.10.3 只做「重點資料層」，不做多資料表清理。

主要調整如下：

- 將原本的記錄功能升級為畫重點。
- 新增 TopicHighlights Sheet，保存使用者手動標記的重要內容。
- 畫重點指令會寫入 TopicHighlights，而不是只留在 ConversationLog。
- 統整話題、無網址版節目話題分析、封存本週話題會納入 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀資料時，只讀使用者訊息，不納入小浣回覆。
- 保留 v1.10.2 的網址行為：直接貼網址收進 NewsInbox；明確要求快讀時才走懶人包。
- 不新增清空重點、清空快讀、清空封存、清空新聞、清空待回覆等多資料表清理指令。

---

## 3. 常用指令

### 直接貼網址

直接貼上網址時，小浣會將網址加入 NewsUrlQueue，由背景流程抓取網頁資訊、分類與整理，再寫入 NewsInbox。

這是目前小浣最主要的新聞素材收集入口。個人聊天室與群組聊天室行為一致。

差別只在：個人聊天室可以直接對小浣說話；群組聊天室一般聊天不會觸發小浣，除非使用觸發指令。不過群組中直接貼網址，即使沒有叫小浣，也會被收進新聞素材池。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。

小浣會依分類整理近期新聞素材，方便節目準備時快速掃過。

### 新聞補充

當某些網頁無法順利抓取，或需要手動補充標題、重點、背景時，可以使用新聞補充功能。

這會將人工補充內容寫入 NewsInbox。

### 懶人包

針對指定網址產生快讀摘要。

這是目前唯一保留的明確網址快讀入口。一般直接貼網址不會產生懶人包，而是收進 NewsInbox。

### 節目話題分析加網址

針對指定網址產生較深入的節目話題分析。

此流程會走背景任務，處理完成後透過 PendingReplies 在下一次對話時交付結果。

### 節目話題分析不加網址

不附網址時，小浣會根據近期內容自行判斷適合分析的主題。

資料來源包括：使用者近期聊天內容、TopicHighlights、WebSummary、WeeklySummary。

v1.10.3 起，這個流程不會納入小浣自己的回覆。

### 統整話題

整合近期素材，整理成節目可用的話題地圖。

資料來源包括：使用者近期聊天內容、TopicHighlights、WebSummary、WeeklySummary。

適合用在節目前準備、整理本週累積素材、決定哪些話題值得聊。

### 畫重點

將重要內容寫入 TopicHighlights。

後續統整話題、節目話題分析、封存本週話題都會優先參考這些人工標記重點。

### 封存本週話題

將近期使用者討論、畫重點與網址快讀摘要整理成 WeeklySummary。

WeeklySummary 是長期記憶摘要，讓小浣未來可以知道某些主題以前討論過，以及當時有哪些觀點。

v1.10.3 的封存資料來源包括：使用者聊天內容、TopicHighlights、WebSummary。不納入小浣自己的回覆。

---

## 4. Help 與管理指令

### help

查看目前可用功能與主要指令。

### 版本

查看目前版本。

### 版本紀錄

查看近期版本紀錄摘要。完整歷史仍以 99_changelog.md 為準。

### reset

清除當前 conversationId 的短期記憶狀態。

這只會清除 CacheService 中的短期對話記憶，不會刪除 Google Sheet 裡的長期資料。

### 清空紀錄

清除目前聊天室的 ConversationLog，並清除短期記憶。

這是 v1.10.2 既有功能。v1.10.3 保留此功能，但不新增多資料表清理。

清空紀錄不會清除 TopicHighlights、WeeklySummary、WebSummary 或 NewsInbox。

---

## 5. 資料表概念

本專案主要使用 Google Sheets 作為資料儲存層。

### ConversationLog

保存使用者與小浣的原始對話紀錄。

用途包括保留原始聊天內容、提供近期上下文、支援一般對話與部分節目整理功能。

v1.10.3 起，節目整理功能從 ConversationLog 讀資料時，預設只讀使用者訊息，不讀小浣回覆。

### TopicHighlights

保存畫重點功能產生的人工釘選素材。

用途包括儲存使用者手動標記的重要想法，供統整話題、無網址版節目話題分析與封存本週話題優先參考。

### WeeklySummary

保存封存本週話題產生的長期記憶摘要。

用途包括保存過去討論過的重要主題，讓後續話題分析知道以前是否聊過，協助形成極簡長期記憶。

### WebTaskQueue

保存網址快讀與網址版節目分析的背景任務。

主要來源是懶人包與網址版節目話題分析。

### WebSummary

保存網址快讀摘要。

後續會被統整話題、節目話題分析與封存本週話題參考。

### NewsUrlQueue

保存直接貼網址後的新聞網址待處理佇列。

直接貼網址時，小浣會先將網址放進這張表，再由背景 trigger 慢慢處理。

### NewsInbox

新聞素材池。

主要來源是直接貼網址與新聞補充，主要用途是本週新聞。

### PendingReplies

保存背景任務完成後，等待下次訊息交付的回覆。

例如懶人包完成後的摘要、網址版節目話題分析完成後的分析結果、網址抓取失敗後的提醒。

---

## 6. 檔案配置

目前主要檔案如下：

### 00_Config.gs

集中管理 API endpoint、模型名稱、Sheet 名稱、指令前綴與系統常數。

v1.10.3 新增 TopicHighlights 相關常數與畫重點指令前綴。

### 01_Main.gs

LINE webhook 主流程。

負責接收 LINE event、寫入 ConversationLog、處理 pending reply、處理網址收件、處理內建指令與一般 AI 指令流程。

v1.10.3 新增畫重點指令處理，並讓 setupLogSheet 建立 TopicHighlights。

### 02_LineCommands.gs

負責 LINE 指令解析、help 與 LINE Reply API。

v1.10.3 移除記錄指令入口，改為畫重點。

### 03_Utils.gs

共用工具函式。

### 04_Storage.gs

Google Sheet 與 Script Properties 入口。

負責既有資料表：ConversationLog、WeeklySummary、WebTaskQueue、PendingReplies、WebSummary。

### 05_Memory.gs

短期對話記憶。

使用 Apps Script CacheService。

### 06_WebReader.gs

網址擷取與 HTML 清理。

### 07_WebTaskQueue.gs

背景處理懶人包與網址版節目話題分析。

### 08_GeminiService.gs

Gemini API 相關流程。

目前主要負責快讀摘要、正文抽取與新聞網址分類。

### 09_DeepSeekService.gs

DeepSeek API 相關流程。

主要負責一般對話、節目話題分析、統整話題、封存本週話題、人工新聞補充解析。

### 10_TopicFeatures.gs

節目企劃功能層。

負責節目話題分析、統整話題、封存本週話題。

v1.10.3 調整為 user-only ConversationLog 加 TopicHighlights 加 WebSummary 加 WeeklySummary 的話題資料結構。

### 11_Prompts.gs

一般 prompt。

### 12_ResponseTexts.gs

固定文案與版本資訊。

### 13_NewsInbox.gs

新聞素材池。

負責 NewsUrlQueue、NewsInbox、直接貼網址收件、本週新聞、新聞補充。

### 14_TopicHighlights.gs

v1.10.3 新增。

負責 TopicHighlights Sheet 初始化、畫重點寫入、近期人工重點讀取與格式化。

---

## 7. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. Secret value 應放在 Apps Script 的 Script Properties。
4. 99_changelog.md 僅作為歷史紀錄。
5. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
6. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
7. 不要從舊對話、舊上傳檔案或歷史 changelog 推回目前實作。
8. 若要修改程式，不要直接改 main，應建立 feature 或 hotfix branch，開 PR 後由維護者手動 merge。

---

## 8. v1.10.3 建議測試流程

PR 合併後，建議在 Apps Script 中先執行 setupLogSheet()，確認 TopicHighlights 已建立。

接著在 LINE 測試：版本、help、畫重點、統整話題、節目話題分析、封存本週話題。

清空紀錄仍可測試，但它只會清 ConversationLog，不會清 TopicHighlights。
