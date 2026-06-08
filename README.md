# 小浣 LINE Bot v1.10.8 Manual News Supplement Parse Hotfix

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.3 新增 TopicHighlights，讓使用者可以用 #畫重點 建立人工重點資料層。

v1.10.4 接續處理資料維護問題：新增多資料表清理指令，並將清理邏輯集中在 15_DataCleanup.gs。所有清理都採二段式確認，且只作用於目前聊天室的 conversationId。

v1.10.5 新增 Reader Layer，調整網址讀取前置流程：一般網頁優先使用 Jina Reader，PTT 使用 over18 cookie 特例，舊 raw HTML + Gemini extractor 保留為 fallback。

v1.10.6 修正 PTT 正常文章頁被誤判成滿 18 歲確認頁的問題，避免文章頁只因含有 ask/over18 字樣就被判定讀取失敗。本版也將過渡用的 17 / 18 檔案整合回 16_ReaderLayer.gs，避免 Reader Layer 檔案過度分散。

v1.10.7 修正 NewsInbox Queue 流程：X / Facebook / Threads 這類目前未支援平台會在入隊前直接攔截，不再進 NewsUrlQueue 重試；背景處理 failed 後也會正確建立 PendingReplies。

v1.10.8 修正 #新聞補充 的 JSON parser 命名錯誤，讓 DeepSeek 解析出的分類、簡介、切角與節目潛力真正寫入 NewsInbox，而不是靜默掉進 fallback。

---

## 2. v1.10.8 本版重點

v1.10.8 是 Manual News Supplement Parse Hotfix。

主要調整如下：

- 修正 13_NewsInbox.gs 的 parseManualNewsSupplement_()。
- 將不存在的 parseLooseJson() 改回專案既有的 parseJsonObjectLoose()。
- #新聞補充 現在會真正使用 DeepSeek 解析出的分類、簡介、切角與節目潛力。
- 保留 fallback：若 DeepSeek 回傳非 JSON 或 API 失敗，仍可用使用者原文建立人工補充素材。
- 本版不修改 NewsUrlQueue、Reader Layer、Gemini 自動分類、資料清理層，也不導入 Apify / ByCrawl。

---

## 3. 常用指令

### 直接貼網址

直接貼上網址時，小浣會將可支援的網址加入 NewsUrlQueue，由背景流程抓取網頁資訊、分類與整理，再寫入 NewsInbox。

v1.10.5 起，這個背景流程會先透過 Reader Layer 讀取網頁內容。v1.10.6 起，PTT 文章頁會套用更嚴格的 over18 gate 判斷，避免正常文章被誤判。v1.10.7 起，X / Facebook / Threads 會在入隊前直接回報未支援，不再進 queue 重試。

個人聊天室與群組聊天室行為一致。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。

### 新聞補充

人工補充新聞素材到 NewsInbox。v1.10.8 起，這個流程會正確使用 DeepSeek 解析補充內容，而不是因 parser 命名錯誤靜默 fallback。

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

## 6. Reader Layer 概念

Reader Layer 的目標是把「讀網頁」與「後續 LLM 整理」拆開，讓下游的 Gemini、DeepSeek、NewsInbox 盡量只吃穩定的 mainText、title、siteName、author、publishedAt、warnings 等欄位。

目前分流規則：

- 一般網站：優先使用 Jina Reader。
- PTT：使用 GAS 原生 UrlFetchApp，並帶 over18=1 cookie；v1.10.6 起在 16_ReaderLayer.gs 內修正正常文章頁被 over18 gate detector 誤判的問題。
- X、Twitter、Facebook、Threads：本版仍不支援自動擷取；v1.10.7 起，直接貼網址時會在入隊前攔截，不再進 NewsUrlQueue 重試。
- Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## 7. 資料表概念

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

## 8. 檔案配置

目前主要檔案如下：

- 00_Config.gs：API endpoint、模型名稱、Sheet 名稱、指令前綴與系統常數。
- 01_Main.gs：LINE webhook 主流程。
- 02_LineCommands.gs：指令解析、分層 help 與 LINE Reply API。
- 03_Utils.gs：共用工具函式。
- 04_Storage.gs：Google Sheet 與 Script Properties 入口。
- 05_Memory.gs：短期對話記憶。
- 06_WebReader.gs：網址擷取、legacy HTML 清理與網頁內容 prompt 組裝。
- 07_WebTaskQueue.gs：背景處理懶人包與網址版節目話題分析。
- 08_GeminiService.gs：Gemini API 相關流程。
- 09_DeepSeekService.gs：DeepSeek API 相關流程。
- 10_TopicFeatures.gs：節目話題分析、統整話題、封存本週話題。
- 11_Prompts.gs：一般 prompt。
- 12_ResponseTexts.gs：固定文案與版本資訊。
- 13_NewsInbox.gs：新聞素材池與 NewsUrlQueue 處理。
- 14_TopicHighlights.gs：人工重點資料層。
- 15_DataCleanup.gs：資料清理層。
- 16_ReaderLayer.gs：Jina Reader、PTT over18、社群平台未支援偵測、legacy fallback wrapper 與 reader 統一資料契約。

---

## 9. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. Secret value 應放在 Apps Script 的 Script Properties。
4. 99_changelog.md 僅作為歷史紀錄。
5. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
6. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
7. 若要修改程式，不要直接改 main，應建立 feature 或 hotfix branch，開 PR 後由維護者手動 merge。

---

## 10. v1.10.8 建議測試流程

PR 合併後，建議先在 Apps Script 中執行 setupLogSheet()。

接著在 LINE 測試：

- #版本
- #新聞補充 這篇大概在講 X 平台政策變動，偏社群輿論，節目潛力高，https://x.com/example/status/123
- 確認 NewsInbox 新增資料的分類、簡介、切角與節目潛力不再每次都只落入 fallback 預設值。
- 直接貼 X / Facebook / Threads 網址，確認仍會立即回覆未支援，且不新增 NewsUrlQueue pending task。
- 直接貼一般新聞網址，確認可進 NewsUrlQueue 並寫入 NewsInbox。
- #本週新聞
- #help
- #help 資料
- #help 清理

測試清理時仍建議先用測試聊天室，確認只處理目前 conversationId。
