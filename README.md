# 小浣 LINE Bot v1.11.2 Brief Range Hotfix

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.3 新增 TopicHighlights，讓使用者可以用 #畫重點 建立人工重點資料層。

v1.10.4 接續處理資料維護問題：新增多資料表清理指令，並將清理邏輯集中在 15_DataCleanup.gs。所有清理都採二段式確認，且只作用於目前聊天室的 conversationId。

v1.10.5 新增 Reader Layer，調整網址讀取前置流程：一般網頁優先使用 Jina Reader，PTT 使用 over18 cookie 特例，舊 raw HTML + Gemini extractor 保留為 fallback。

v1.10.6 修正 PTT 正常文章頁被誤判成滿 18 歲確認頁的問題，避免文章頁只因含有 ask/over18 字樣就被判定讀取失敗。本版也將過渡用的 17 / 18 檔案整合回 16_ReaderLayer.gs，避免 Reader Layer 檔案過度分散。

v1.10.7 修正 NewsInbox Queue 流程：X / Facebook / Threads 這類當時未支援平台會在入隊前直接攔截，不再進 NewsUrlQueue 重試；背景處理 failed 後也會正確建立 PendingReplies。

v1.10.8 修正 #新聞補充 的 JSON parser 命名錯誤，讓 DeepSeek 解析出的分類、簡介、切角與節目潛力真正寫入 NewsInbox，而不是靜默掉進 fallback。

v1.10.9 新增 Social Reader：X / Twitter 單篇 status 貼文改走 FxTwitter API；Facebook、fb.watch、Threads.com、Threads.net 改為先走 Jina Reader，不再提前攔截。

v1.10.10 更新 #版本 與 #版本紀錄 固定文字，並將版本紀錄限制為最近 6 筆；完整歷史仍以 99_changelog.md 為準。

v1.11.0 調整直接貼網址的回覆方式：單一網址會同步讀取，Gemini 在一次呼叫中同時產生 100～200 字內容大綱與 NewsInbox 分類資料，成功後直接回覆大綱並入庫。

v1.11.1 將群組回覆縮短為 20 字內 Brief，同時把原本 100～200 字完整內容大綱保存到 NewsInbox 的 Outline 欄位，並提供 `#統整話題` 使用。

v1.11.2 將 Brief 從「20 字內硬限制」調整為「30～50 字目標區間」。短內容可以自然低於 30 字，程式端只保留防爆上限，避免正常簡介被切成半句。

---

## 2. v1.11.2 本版重點

v1.11.2 是 Brief Range Hotfix。

主要調整如下：

- 單一直接網址會同步透過 Reader Layer 取得正文。
- Gemini 只呼叫一次，同時產生 LINE 回覆用的 30～50 字目標 Brief、NewsInbox 保存用的 100～200 字 Outline，以及標題、分類、切角與節目潛力。
- 同步成功後直接寫入 NewsInbox，LINE 回覆自然短 Brief；短原文可低於 30 字，不硬湊字數。
- 程式端不再以目標字數硬裁 Brief，只保留防爆上限避免模型失控輸出。
- `#本週新聞` 顯示短 Brief，不再顯示切角，降低群組閱讀壓力。
- `#統整話題` 會讀取最近 7 天 NewsInbox 的完整 Outline；舊資料沒有 Outline 時退回 Brief。
- 多網址、Reader 過慢、同步 API 失敗或結果不足時，會退回 NewsUrlQueue 背景處理。
- 本版不修改 `#懶人包`、`#節目話題分析`、Reader 路由、WebTaskQueue 或 LINE router。

---

## 3. 常用指令

### 直接貼網址

直接貼上一個可支援的網址時，小浣會透過 Reader Layer 讀取網頁，交給 Gemini 同時產生 30～50 字目標 Brief、100～200 字 Outline 與 NewsInbox 分類資料。成功後會立即回覆短 Brief，並將完整 Outline 與分類資料寫入 NewsInbox。

一次貼多個網址、Reader 花費時間過長、同步 API 失敗或 Gemini 結果不足時，會改放入 NewsUrlQueue 由背景流程整理。同步成功的網址不會建立 NewsUrlQueue 或 PendingReplies。

v1.10.5 起，網址流程會先透過 Reader Layer 讀取網頁內容。v1.10.6 起，PTT 文章頁會套用更嚴格的 over18 gate 判斷，避免正常文章被誤判。v1.10.9 起，X / Twitter 單篇 status 會走 FxTwitter API；Facebook、fb.watch、Threads.com、Threads.net 會先走 Jina Reader。

個人聊天室與群組聊天室行為一致。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。每篇會顯示標題、短 Brief、來源網址與節目潛力，不顯示完整 Outline 或切角。

### 新聞補充

人工補充新聞素材到 NewsInbox。v1.10.8 起，這個流程會正確使用 DeepSeek 解析補充內容，而不是因 parser 命名錯誤靜默 fallback。

### 懶人包

針對指定網址產生包含重點條列與來源資訊的完整快讀摘要。一般直接貼單一網址只回覆精簡內容大綱並收進 NewsInbox，不等同 `#懶人包`。

### 節目話題分析

可針對網址做深度分析；不附網址時，會根據使用者近期聊天、TopicHighlights、WebSummary、WeeklySummary 判斷可分析主題。

### 統整話題

整合近期素材，整理成節目可用的話題地圖。v1.11.1 起會納入最近 7 天 NewsInbox 的完整 Outline；舊資料沒有 Outline 時會退回 Brief。

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

查看最近 6 筆版本紀錄摘要。完整歷史仍以 99_changelog.md 為準。

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
- X / Twitter 單篇 status：使用 FxTwitter API。
- X / Twitter 非單篇 status：不自動擷取，避免把個人頁、搜尋頁、列表頁或登入頁誤當正文。
- Facebook、fb.watch、Threads.com、Threads.net：先交給 Jina Reader 嘗試讀取。
- Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## 7. 資料表概念

本專案主要使用 Google Sheets 作為資料儲存層。

- ConversationLog：保存使用者與小浣的原始對話紀錄。
- TopicHighlights：保存 #畫重點 產生的人工釘選素材。
- WeeklySummary：保存 #封存本週話題 產生的長期記憶摘要。
- WebTaskQueue：保存網址快讀與網址版節目分析的背景任務。
- WebSummary：保存網址快讀摘要。
- NewsUrlQueue：保存多網址、同步處理過慢或失敗時的新聞網址待處理佇列。
- NewsInbox：新聞素材池；Brief 供 LINE 與 `#本週新聞` 快速瀏覽，Outline 供 `#統整話題` 深度統整。
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
- 12_ResponseTexts.gs：固定文案、版本資訊與非 LLM 系統回覆。
- 13_NewsInbox.gs：新聞素材池、短 Brief、完整 Outline、NewsUrlQueue 與 `#本週新聞` 處理。
- 14_TopicHighlights.gs：人工重點資料層。
- 15_DataCleanup.gs：資料清理層。
- 16_ReaderLayer.gs：Jina Reader、PTT over18、FxTwitter API、legacy fallback wrapper 與 reader 統一資料契約。

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

## 10. v1.11.2 建議測試流程

本版不修改 Sheet schema，不需要 migration，也不強制手動執行 setup。NewsInbox 既有 `Outline` 欄位仍照 v1.11.1 流程保存完整大綱。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

- 在群組直接貼一個一般新聞網址。
- 在個人聊天室直接貼一個一般新聞網址。
- 確認 LINE 回覆 30～50 字左右的自然 Brief，短貼文可低於 30 字但不硬湊。
- 確認 NewsInbox 同一筆資料保存 100～200 字 Outline。
- 測試 PTT、X / Twitter 單篇 status、Facebook / Threads 公開網址。
- 一次貼兩個以上網址，確認改走 NewsUrlQueue。
- 測試無法讀取、需要登入或同步處理過慢的網址，確認有 queue fallback 或明確錯誤。
- 測試已有 Pending Reply 時再貼網址，確認仍優先交付舊結果，新網址進背景 queue。
- 執行 `#本週新聞`，確認顯示短 Brief 且不顯示切角。
- 執行 `#統整話題`，確認會引用 NewsInbox Outline；再用一筆沒有 Outline 的舊資料確認可退回 Brief。
- 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。

確認同步成功時 LINE 回覆自然短 Brief，NewsInbox 新增一筆 `SourceMode=auto_url_sync` 且 Outline 有內容的資料，並且不會同時新增 NewsUrlQueue 或 PendingReplies。
