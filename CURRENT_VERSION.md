# CURRENT_VERSION

本文件是 MEGA浣 / 小浣 專案的現行版本判定文件。

本文件主要給網頁版 ChatGPT、GitHub connector、未來 AI 助手、維護者與協作者讀取，用來快速判斷目前正式架構，避免誤用舊對話、舊分支、已 revert 的 PR、舊版上傳檔案或歷史 changelog 內容。

若是在本機使用 Codex / AI coding agent，工作規則請優先閱讀 `AGENTS.md`。本文件只負責描述目前版本狀態，不負責定義 Codex 的操作規則。

---

## Project

正式名稱：MEGA浣
小名：小浣
用途：Podcast「現正熱潮中」的 LINE 群組企劃助理
執行環境：Google Apps Script
程式碼版本管理：GitHub
正式部署方式：維護者手動複製 / 同步至 Google Apps Script
主要資料儲存：Google Sheet
外部服務：LINE Messaging API、DeepSeek API、Gemini API、Jina Reader、FxTwitter API

---

## Version Represented by This Git Ref

Repository: `icemiku-AS/megaWAN-linebot`
Version represented by this Git ref: `v1.12.2 News Classification Audit Edition`
Previous stable baseline described in this file: `v1.12.1 Weekly News Query & Help Focus Edition`

本文件描述「目前這個 Git ref 的實際檔案所代表的版本」與版本邊界。

本文件不記錄暫時性的開發流程欄位。這些資訊應放在 Codex 任務提示詞、PR body 或維護者的開發紀錄中，不應寫進會被納入長期版本判定的文件。

---

## Reference Priority

若本文件、README、AGENTS、Changelog、舊對話紀錄、先前上傳檔案或其他分支之間出現矛盾，請依照下列優先順序判斷：

1. 目前 Git ref 的實際 `.gs` 程式碼
2. `CURRENT_VERSION.md`
3. `README.md`
4. `AGENTS.md` 的 Codex / AI coding agent 工作規則
5. `99_changelog.md` 的最新版本段落
6. 舊版 changelog、舊對話紀錄、過去上傳檔案、歷史備份內容

如果是詢問「Codex 應該怎麼工作」，請讀 `AGENTS.md`。

如果是詢問「小浣目前正式版本與功能狀態」，請讀本文件。

如果是詢問「目前實際程式如何運作」，請讀實際 `.gs` 檔案。

---

## Read Order for Web ChatGPT / GitHub Connector

網頁版 ChatGPT 或透過 GitHub connector 讀取本專案時，建議順序如下：

1. 先讀 `CURRENT_VERSION.md`
2. 再讀 `README.md`
3. 如果本次任務涉及 Codex、本機開發流程、AI agent 工作規則，再讀 `AGENTS.md`
4. 再依任務需要讀實際 `.gs` 檔案
5. 最後才讀 `99_changelog.md`，且只把它當歷史紀錄

如果 `99_changelog.md` 的舊版段落與目前 `.gs` 實作不同，請一律相信目前 `.gs`。

---

## Active Runtime Source Files

以下檔案代表 v1.12.2 News Classification Audit Edition 沿用的 GAS 程式結構：

* `00_Config.gs`
* `01_Main.gs`
* `02_LineCommands.gs`
* `03_Utils.gs`
* `04_Storage.gs`
* `05_Memory.gs`
* `06_WebReader.gs`
* `07_WebTaskQueue.gs`
* `08_GeminiService.gs`
* `09_DeepSeekService.gs`
* `10_TopicFeatures.gs`
* `11_Prompts.gs`
* `12_ResponseTexts.gs`
* `13_NewsInbox.gs`
* `14_TopicHighlights.gs`
* `15_DataCleanup.gs`
* `16_ReaderLayer.gs`

---

## Active Project Documents

以下檔案不是 GAS runtime 程式，但會影響維護與 AI 協作：

* `README.md`：專案說明、功能、指令與檔案配置。
* `CURRENT_VERSION.md`：目前版本判定與版本邊界。
* `AGENTS.md`：Codex / AI coding agent 的本機工作規則。
* `99_changelog.md`：歷史版本紀錄。

修改這些文件通常不需要手動同步到 Google Apps Script，除非同時修改了 `.gs` 程式碼。

---

## v1.12.2 Version Boundary

v1.12.2 是 News Classification Audit Edition。

本版強化 NewsInbox 分類稽核，並讓 `#本週新聞` 更適合快速掃描與檢查分類品質：

1. NewsInbox 在既有欄位最右側追加 `SpecialTopic`、`CategoryReason`、`CategoryConfidence`、`MatchedEntities`、`ClassificationWarning`，舊欄位順序不變。
2. Gemini 新聞分類改用主要分類清單；`馬斯克` / `川普` 不再作為新素材主要分類，改放 `SpecialTopic`。
3. 分類稽核會檢查特殊主題是否有內容關鍵字支撐，並將低信心、待分類與疑似誤判寫入 `ClassificationWarning`。
4. `#本週新聞 精簡` 改為按分類分組，只列標題與來源網域。
5. 新增 `#本週新聞 診斷` 與 `#本週新聞 24小時 診斷`，檢查待分類、低信心、分類警告與特殊主題疑似誤判素材。
6. `#封存本週新聞` 會把 `SpecialTopic` / `MatchedEntities` 納入週報索引素材，不修改 WeeklySummary schema。
7. `#help 進階` 補上診斷模式；核心 `#help` 維持 v1.12.1 收斂後的核心功能。
8. 更新 `#版本`、README、CURRENT_VERSION 與 changelog。

本版包含 NewsInbox 自動分類 prompt、分類稽核欄位寫入、`#本週新聞` 精簡 / 診斷檢視、新聞封存素材組裝、help 分層與版本文件更新。

本版不新增 `#新聞問答`；不刪除任何既有功能；不修改 Reader Layer；不導入 ByCrawl / Apify；不修改 WeeklySummary schema；不改群組貼網址靜默收件流程；不新增 Node.js / npm / package.json / 自架伺服器架構；不寫入任何 secret。

---

## v1.12.0 Version Boundary

v1.12.0 是 Silent URL Status & News Archive Edition。

本版調整新聞收件、狀態回報與封存記憶分工：

1. 群組非 trigger 訊息內含網址時，不再回覆 Brief，改靜默寫入 NewsUrlQueue 背景整理。
2. 網址不支援、入隊失敗或背景讀取失敗時，改透過 PendingReplies 延後回報。
3. 個人聊天室直接貼網址與明確指令中的網址，仍保留同步回覆路徑，方便維護測試 Reader / Gemini。
4. 新增 `#狀態回報`，統計最近 7 天網址收件、NewsInbox 入庫、NewsUrlQueue 佇列與失敗狀態。
5. 新增 `#封存本週新聞`，將最近 7 天 NewsInbox 摘要寫入 WeeklySummary。
6. `#封存本週話題` 改為只讀 ConversationLog，不再混入 TopicHighlights、WebSummary 或 NewsInbox。
7. `#本週新聞` 移除節目潛力顯示；若已有新聞封存，會嘗試比對過去新聞脈絡。
8. WeeklySummary 最右側追加 `ArchiveType`、`PeriodStart`、`PeriodEnd`、`SourceItemCount`，用來區分 `topic` / `news` 封存並保留期間資訊。

本版包含 LINE router、NewsInbox / NewsUrlQueue 收件流程、WeeklySummary 相容 schema、固定回覆文字、help、README、CURRENT_VERSION 與 changelog 更新。

本版不刪除 `#統整話題`、`#節目話題分析`、`#懶人包`、`#畫重點` 等既有功能；不修改 Reader Layer provider；不新增 Node.js / npm / 自架伺服器架構；不寫入任何 secret。

---

## v1.11.2 Version Boundary

v1.11.2 是 Brief Range Hotfix。

本版只調整直接網址與 NewsInbox Brief 的長度策略：

1. Gemini 維持一次 JSON 呼叫，不新增 API 呼叫。
2. Brief 從 20 字內改為 30～50 字目標區間，避免回覆太像標題。
3. X / Twitter 貼文、公告或單句消息等短內容可以自然少於 30 字，不硬湊字數。
4. 程式端不再以目標字數硬裁 Brief，只保留 120 字防爆上限，避免模型失控輸出。
5. `#本週新聞` 沿用 Brief 欄位，因此會自然顯示較完整的短簡介。
6. NewsInbox schema、Outline 欄位、`#統整話題` 讀取 Outline 的流程都不變。

本版包含 Gemini 新聞 prompt、Brief normalizer、help、版本文字與文件更新。

本版不修改 Reader Layer、WebTaskQueue、LINE router、NewsInbox schema、Outline、網址版 `#節目話題分析` 或 `#懶人包` 行為。

---

## v1.11.1 Version Boundary

v1.11.1 是 Compact News Brief Edition。

本版只調整直接網址的摘要分工、NewsInbox 欄位與 `#統整話題` 的素材來源：

1. Gemini 維持一次 JSON 呼叫，同時產生 20 字內 Brief、100～200 字 Outline、標題、分類、切角與節目潛力。
2. 單一直接網址同步成功後，LINE 只回覆短 Brief。
3. NewsInbox 在既有欄位最右側新增 `Outline`，保存完整內容大綱。
4. 同步與 NewsUrlQueue 背景入庫都會保存 Brief 與 Outline。
5. `#本週新聞` 顯示標題、短 Brief、來源網址與節目潛力，不再顯示切角。
6. `#統整話題` 會讀取最近 7 天、最多 20 筆 NewsInbox 素材，優先使用 Outline；舊資料沒有 Outline 時退回 Brief。
7. `#新聞補充` 維持人工補充流程，Outline 留空，Brief 統一限制在 20 字內。
8. `ensureNewsInboxSheet_()` 會自動把 Outline 補到既有 NewsInbox 最右側，不需要 migration。

本版包含 Gemini 新聞 prompt、NewsInbox schema 與寫入相容處理、`#本週新聞` 排版、`#統整話題` DeepSeek 素材組裝、版本文字與文件更新。

本版不修改 Reader Layer、WebTaskQueue、網址版 `#節目話題分析`、`#懶人包`、LINE router、外部 reader 服務或其他 Sheet schema。

---

## v1.11.0 Version Boundary

v1.11.0 是 Direct URL Summary Edition。

本版只調整「直接貼網址」的收件與回覆流程：

1. 單則訊息只有一個可支援網址時，先透過現有 Reader Layer 取得正文。
2. Gemini 在一次 JSON 呼叫中，同時產生 LINE 回覆用的 100～200 字內容大綱，以及 NewsInbox 的標題、分類、50 字內簡介、切角與節目潛力。
3. 同步成功後直接寫入 NewsInbox，並使用當次 LINE replyToken 回覆大綱。
4. 同步成功不建立 NewsUrlQueue 或 PendingReplies。
5. 多網址、Reader 過慢、同步 API 失敗、分類不足或大綱結果不足時，退回既有 NewsUrlQueue 背景處理。
6. 若當下已有舊 Pending Reply，仍先交付舊結果；新網址維持背景入隊，避免同一 replyToken 同時承擔兩套結果。
7. 同步大綱只用於當次 LINE 回覆，不新增 NewsInbox 欄位。
8. 群組與個人聊天室維持一致行為。

本版包含 LINE webhook 直接網址分流、NewsInbox Gemini prompt 與固定回覆調整，也包含 README、CURRENT_VERSION、版本文字與 changelog 更新。

本版不修改 `#本週新聞` 的資料讀取或排版，不修改 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、Reader 路由或 Google Sheet schema。

---

## v1.10.10 Version Boundary

v1.10.10 是 Version History Maintenance Edition。

本版只做版本文字與版本紀錄顯示維護：

1. 更新 `#版本` 顯示的小浣目前版本文字。
2. 在內建版本紀錄最前方加入 v1.10.10。
3. `#版本紀錄` 只顯示最近 6 筆，避免回覆隨版本增加而過長。
4. 保留完整歷史以 `99_changelog.md` 為準的提醒。
5. 小幅同步 README、CURRENT_VERSION 與 changelog。

本版不新增指令、不修改 LINE webhook 主流程，也不修改 Reader Layer、NewsInbox、WebTaskQueue 或 Google Sheet schema。

---

## v1.10.9 Version Boundary

v1.10.9 是 Social Reader Edition。

本版只做社群網址 reader 分流調整：

1. X / Twitter 單篇 `/status/{id}` 貼文改用 FxTwitter API 讀取。
2. FxTwitter API 回傳會被整理成 Reader Layer 統一 webResult 格式，讓後續 NewsInbox、#懶人包、#節目話題分析 沿用既有流程。
3. Facebook、fb.watch、Threads.com、Threads.net 不再於入隊前被視為未支援平台，改先交給 Jina Reader 嘗試讀取。
4. 若 Jina Reader 失敗，仍保留 legacy raw HTML + Gemini extractor fallback。
5. FxTwitter API endpoint 放在 `00_Config.gs`。
6. v1.10.9 的社群 reader 已正式併回 `16_ReaderLayer.gs`。
7. v1.10.9 的版本文字與非 status 社群網址提示已併回 `12_ResponseTexts.gs`。

---

## Documentation Update After v1.10.9

v1.10.9 合併後，新增 `AGENTS.md` 作為本機 Codex / AI coding agent 工作規則。

此文件更新不改變小浣 runtime 行為。

它不包含：

* `.gs` 程式變更
* LINE Bot 行為變更
* Google Sheet schema 變更
* GAS 部署需求

---

## Reader Layer Scope

v1.10.9 的 reader 分流：

* 一般網站：Jina Reader。
* PTT：GAS 原生 `UrlFetchApp` + `over18=1` cookie，並在 `16_ReaderLayer.gs` 內保留 v1.10.6 的 over18 gate 誤判修正。
* X / Twitter 單篇 status：`16_ReaderLayer.gs` 透過 FxTwitter API 讀取。
* X / Twitter 非單篇 status 網址：不自動讀取，避免把個人頁、搜尋頁或登入頁誤當正文。
* Facebook / fb.watch / Threads.com / Threads.net：先走 Jina Reader，不再入隊前攔截。
* Jina Reader 失敗時：嘗試 legacy raw HTML + Gemini extractor fallback。

---

## Existing Cleanup Command Scope

v1.10.9 沒有修改 v1.10.4 的清理功能。

清理指令與資料表對應仍如下：

* `#清空紀錄`：`ConversationLog`，並清除短期記憶。
* `#清空重點`：`TopicHighlights`。
* `#清空快讀`：`WebSummary`、`WebTaskQueue`。
* `#清空封存`：`WeeklySummary`。
* `#清空新聞`：`NewsInbox`、`NewsUrlQueue`。
* `#清空待回覆`：`PendingReplies`。

所有清理都只限目前聊天室的 `conversationId`。

---

## Explicitly Not Included in v1.12.2

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

* Apify actor 整合
* ByCrawl 整合
* Node.js / npm / 自架伺服器架構
* `#新聞問答` 或新聞素材問答介面
* X / Twitter 個人頁、搜尋頁、列表頁自動擷取
* Facebook 私人貼文、登入牆內容或留言串完整擷取保證
* Threads 登入牆內容擷取保證
* PDF / 圖片 / 影片內容讀取
* `#資料狀態`
* 跨聊天室全域清理
* 自動排程清理
* 清理前自動備份 Sheet
* 刪除 NewsUrlQueue 或 PendingReplies
* Reader Layer 大規模重構
* NewsInbox 既有欄位重排、改名或 migration；本版只在最右側追加分類稽核欄位
* WeeklySummary schema 調整
* 群組貼網址靜默收件流程調整
* 刪除 `#統整話題`、`#節目話題分析`、`#懶人包` 或 `#畫重點`
* `#統整話題` 素材來源調整
* `#懶人包` 或網址版 `#節目話題分析` 行為調整
* Reader Layer 路由或 provider 行為調整
* WebTaskQueue 行為調整

上述功能若要實作，應另開後續 feature branch。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。

請勿預設本專案需要 Node.js、npm、package.json、node_modules、npm install 或 npm start。

除非維護者明確表示要導入 `clasp` 或將專案改為本機 / 自架伺服器執行，否則請一律視為 Google Apps Script 專案。

GitHub 只作為版本管理來源。正式部署到 Google Apps Script 由維護者手動處理。

---

## Suggested Smoke Tests for v1.12.2 Runtime

本版會在 NewsInbox 既有欄位最右側追加 `SpecialTopic`、`CategoryReason`、`CategoryConfidence`、`MatchedEntities`、`ClassificationWarning`。不需要手動執行 migration；第一次觸發 NewsInbox 初始化 / 寫入 / 查詢時會補欄。WeeklySummary schema 不變。若部署環境尚未套用 v1.12.0，仍需先確認 WeeklySummary 已具備 `ArchiveType`、`PeriodStart`、`PeriodEnd`、`SourceItemCount` 相容欄位。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

* 群組直接貼一個一般新聞網址，確認群組不會收到 Brief 回覆。
* 確認該網址進入 NewsUrlQueue，背景 trigger 處理後寫入 NewsInbox。
* 個人聊天室直接貼一個一般新聞網址，確認仍可同步回覆自然 Brief 並寫入 NewsInbox。
* PTT 文章、X / Twitter 單篇 status、Facebook / Threads 公開網址。
* 一次貼兩個以上網址，確認多筆靜默進 NewsUrlQueue。
* Reader 失敗、登入牆或不支援網址，確認 PendingReplies 會在下次訊息交付錯誤。
* 已有 Pending Reply 時再貼新網址，確認先交付舊結果，新網址仍靜默進背景 queue。
* 執行 `#狀態回報`，確認顯示最近 7 天收件、入庫、佇列與失敗統計。
* 執行 `#本週新聞`，確認顯示最近 7 天素材，預設只列標題、Brief 與來源。
* 執行 `#本週新聞 高潛力`，確認只顯示 `TopicPotential=高` 的素材。
* 執行 `#本週新聞 詳細`，確認顯示 Outline / Brief、切角與節目潛力。
* 執行 `#本週新聞 精簡`，確認按分類分組，且每則只列標題與來源網域。
* 執行 `#本週新聞 24小時`，確認只看最近一天素材。
* 執行 `#本週新聞 分類 科技與 AI`，確認只顯示該分類素材；可再換一個實際存在分類測試。
* 執行 `#本週新聞 診斷`，確認會列出待分類、低信心、分類警告或特殊主題疑似誤判素材；若無異常，應回覆沒有明顯問題。
* 執行 `#本週新聞 24小時 診斷`，確認只診斷最近一天素材。
* 執行 `#help`，確認只顯示核心功能。
* 執行 `#help 進階`，確認顯示詳細新聞檢視、診斷模式、懶人包、節目話題分析、統整話題、畫重點與封存本週話題。
* 執行 `#封存本週新聞`，確認 WeeklySummary 新增 `ArchiveType=news` 的新聞封存。
* 檢查 `#封存本週新聞` 的摘要是否像週報索引，並能利用 SpecialTopic / MatchedEntities 保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡。
* 再執行 `#本週新聞`，確認若有新聞封存，預設或 `#本週新聞 詳細` 會嘗試補充過去脈絡；高潛力、24 小時、分類與精簡模式只顯示當次查詢結果。
* 執行 `#封存本週話題`，確認 WeeklySummary 新增 `ArchiveType=topic`，且來源只計算 ConversationLog 使用者訊息。
* 執行 `#統整話題`，確認 DeepSeek prompt 會收到 NewsInbox Outline。
* 準備一筆沒有 Outline 的舊 NewsInbox 資料，確認 `#統整話題` 會退回 Brief。
* 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。
* 確認本版沒有新增 `#新聞問答` 指令；新聞問答留到 v1.12.3。

本版修改了 `.gs` runtime，因此需要由維護者手動同步至 Google Apps Script。

---

## Last Confirmed

Last Confirmed Version at this Git ref: `v1.12.2 News Classification Audit Edition`
Previous stable baseline described in this file: `v1.12.1 Weekly News Query & Help Focus Edition`
Last Confirmed Date: `2026-06-24`
Last Documentation Note: NewsInbox has rightmost classification audit fields, `#本週新聞 精簡` is grouped by category, `#本週新聞 診斷` checks classification risks, and `#新聞問答` is not included in this version.
