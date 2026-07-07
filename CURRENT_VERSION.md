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
Version represented by this Git ref: `v1.12.4 Weekly News Compact & Story Grouping Edition`
Previous stable baseline described in this file: `v1.12.3 News QA Edition`

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

以下檔案代表 v1.12.4 Weekly News Compact & Story Grouping Edition 沿用的 GAS 程式結構：

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

## v1.12.4 Version Boundary

v1.12.4 是 Weekly News Compact & Story Grouping Edition。

本版讓 `#本週新聞` 預設變成適合 LINE 閱讀的精簡剪報，並新增 StoryKey 作為同一事件線的聚合鍵：

1. `#本週新聞` 預設改為 compact，顯示最近 7 天新聞素材，按 StoryKey / 故事線聚合。
2. `#本週新聞 精簡` 等同 `#本週新聞`；`#本週新聞 詳細` 才展開完整 Outline / Brief、切角、節目潛力、主分類、StoryKey 與完整來源網址。
3. `#本週新聞 高潛力`、`#本週新聞 高潛力 詳細`、`#本週新聞 分類 <分類名>`、`#本週新聞 分類 <分類名> 詳細` 保留既有篩選語意，但預設顯示為故事線 compact。
4. LINE `replyToLine(replyToken, text)` 會自動把長文字拆成最多 5 則 text message；每則使用 4900 字安全上限，仍維持單次 Reply API call。
5. NewsInbox 最右側追加 `StoryKey` 欄位，不重排、不刪除、不改名既有欄位；舊資料缺欄或空白時，會用 SpecialTopic、MatchedEntities、標題、分類或網址產生 fallback。
6. Gemini 新聞分析 prompt / JSON schema 新增 `storyKey`，並強化 category 的「主討論軸」判斷、防錯規則、分類理由與警告規則。
7. `#本週新聞` compact 模式優先依 StoryKey 分組；故事線排序依高潛力數量、同故事線素材數量、最新時間與文字排序。
8. `#本週新聞 診斷` 新增 StoryKey 空白、舊資料 fallback、同 URL 重複、標題正規化重複、同故事線跨多個 category，以及 category / StoryKey 疑似不一致提示。
9. `#新聞問答`、`#統整話題` 與 `#封存本週新聞` 的素材文字會帶入 StoryKey，方便後續整理引用事件線。
10. 更新 `#help`、`#版本`、README、CURRENT_VERSION 與 changelog。

本版包含 LINE reply 分段、NewsInbox schema 相容追加、Gemini 新聞分析 prompt / schema、`#本週新聞` compact / detailed / diagnostic 排版、分類 keyword fallback、重複素材診斷、help 與版本文件更新。

本版不修改 Reader Layer provider 策略；不導入 ByCrawl / Apify / 外部爬蟲服務；不修改 `#懶人包` 核心流程；不修改網址版 `#節目話題分析` 核心流程；不修改 NewsUrlQueue 基本背景收件架構；不重排或刪除既有 NewsInbox 欄位；不導入 Node.js / npm / package.json / 自架伺服器架構；不寫入任何 secret。

部署到 Google Apps Script 後，維護者需手動同步本版修改的 `.gs` 檔。`StoryKey` 欄位會在 `setupLogSheet()` 或任何呼叫 `ensureNewsInboxSheet_()` 的流程中自動追加到 NewsInbox 最右側，不需要手動重排欄位。

---

## v1.12.3 Version Boundary

v1.12.3 是 News QA Edition。

本版讓 NewsInbox 可以直接支援素材問答，並收斂低頻的本週新聞檢視：

1. 新增 `#新聞問答 <問題>`，根據最近 7 天 NewsInbox 素材回答新聞問題。
2. `#新聞問答` 支援 `高潛力` 與 `分類 <分類名>` 篩選；回答必須附完整原文網址，方便直接點回原文。
3. `#新聞問答` 可讀取最近新聞封存作為輔助脈絡，但 NewsInbox 仍是主要事實依據；素材不足時必須明確說目前素材池看不出來。
4. `#本週新聞 精簡` 保持按分類分組，但來源改為完整原文網址，不再只顯示網域。
5. `#本週新聞 診斷` 的來源改為完整原文網址，方便檢查分類問題後回到原文。
6. 移除 `#本週新聞 24小時` 與 `#本週新聞 24小時 診斷` 的支援與文件說明。
7. 核心 `#help` 新增 `#新聞問答 <問題>`；`#help 進階` 移除 24 小時說明，保留詳細、精簡、分類與診斷模式。
8. 更新 `#版本`、README、CURRENT_VERSION 與 changelog。

本版包含 LINE router、指令解析、DeepSeek news_question 模式、新聞問答 prompt、`#本週新聞` 精簡 / 診斷來源顯示、help 分層與版本文件更新。

本版不修改 Reader Layer；不導入 ByCrawl / Apify；不修改 NewsInbox schema；不修改 WeeklySummary schema；不改群組貼網址靜默收件流程；不改 WebTaskQueue、`#懶人包` 或網址版 `#節目話題分析`；不新增 Node.js / npm / package.json / 自架伺服器架構；不寫入任何 secret。

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

## Explicitly Not Included in v1.12.4

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

* Apify actor 整合
* ByCrawl 整合
* Node.js / npm / 自架伺服器架構
* 重新導入 `#本週新聞 24小時` 或 `#本週新聞 24小時 診斷`
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
* NewsInbox 既有欄位重排、改名或破壞性 migration
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

## Suggested Smoke Tests for v1.12.4 Runtime

本版會在 NewsInbox 最右側追加 `StoryKey` 欄位。若部署環境尚未套用 v1.12.2，仍需確認 NewsInbox 已具備 `SpecialTopic`、`CategoryReason`、`CategoryConfidence`、`MatchedEntities`、`ClassificationWarning`；若部署環境尚未套用 v1.12.0，仍需先確認 WeeklySummary 已具備 `ArchiveType`、`PeriodStart`、`PeriodEnd`、`SourceItemCount` 相容欄位。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

* 群組直接貼一個一般新聞網址，確認群組不會收到 Brief 回覆。
* 確認該網址進入 NewsUrlQueue，背景 trigger 處理後寫入 NewsInbox。
* 個人聊天室直接貼一個一般新聞網址，確認仍可同步回覆自然 Brief 並寫入 NewsInbox。
* PTT 文章、X / Twitter 單篇 status、Facebook / Threads 公開網址。
* 一次貼兩個以上網址，確認多筆靜默進 NewsUrlQueue。
* Reader 失敗、登入牆或不支援網址，確認 PendingReplies 會在下次訊息交付錯誤。
* 已有 Pending Reply 時再貼新網址，確認先交付舊結果，新網址仍靜默進背景 queue。
* 執行 `#狀態回報`，確認顯示最近 7 天收件、入庫、佇列與失敗統計。
* 執行 `setupLogSheet()`，或觸發任何會呼叫 `ensureNewsInboxSheet_()` 的流程，確認 NewsInbox 最右側追加 `StoryKey`，且既有欄位未重排。
* 執行 `#本週新聞`，確認顯示最近 7 天素材，預設按 StoryKey / 故事線聚合。
* 執行 `#本週新聞 高潛力`，確認只顯示 `TopicPotential=高` 的素材。
* 執行 `#本週新聞 詳細`，確認顯示 StoryKey、主分類、Outline / Brief、切角、節目潛力與完整原文網址。
* 執行 `#本週新聞 精簡`，確認等同 `#本週新聞`，按故事線聚合。
* 執行 `#本週新聞 分類 科技與 AI`，確認只顯示該分類素材，且仍以故事線聚合；可再換一個實際存在分類測試。
* 執行 `#本週新聞 分類 科技與 AI 詳細`，確認指定分類 + 詳細模式可正常組合。
* 執行 `#本週新聞 診斷`，確認會列出待分類、低信心、classificationWarning、StoryKey 空白、同 URL 重複、標題正規化重複、同 StoryKey 跨多 category 或 category / StoryKey 疑似不一致素材；若無異常，應回覆沒有明顯問題。
* 準備長文字或大量新聞素材，確認 LINE 回覆會拆成最多 5 則 text message，每則不超過 4900 字；超過容量時最後一則尾端有省略提示。
* 執行 `#新聞問答 這週有哪些 AI 公司相關新聞？`，確認回答依據 NewsInbox 並附完整原文網址。
* 執行 `#新聞問答 高潛力 有哪些適合做節目的社群平台新聞？`，確認只根據高潛力素材回答。
* 執行 `#新聞問答 分類 科技與 AI 這週有什麼可追蹤？`，確認只根據指定分類素材回答。
* 執行 `#新聞問答` 不加問題，確認會提示輸入問題範例。
* 執行 `#help`，確認只顯示核心功能。
* 執行 `#help 進階`，確認顯示詳細新聞檢視、精簡、分類、診斷模式、懶人包、節目話題分析、統整話題、畫重點與封存本週話題，且不再列出 24 小時模式。
* 執行 `#封存本週新聞`，確認 WeeklySummary 新增 `ArchiveType=news` 的新聞封存。
* 檢查 `#封存本週新聞` 的摘要是否像週報索引，並能利用 StoryKey / SpecialTopic / MatchedEntities 保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡。
* 再執行 `#本週新聞 詳細`，確認若有新聞封存且未使用高潛力或分類篩選，會嘗試補充過去脈絡；預設精簡、高潛力、分類與診斷模式只顯示當次查詢結果。
* 執行舊指令 `#本週新聞 24小時` 與 `#本週新聞 24小時 診斷`，確認會回覆 v1.12.3 已移除 24 小時檢視，不會改查最近一天素材。
* 執行 `#封存本週話題`，確認 WeeklySummary 新增 `ArchiveType=topic`，且來源只計算 ConversationLog 使用者訊息。
* 執行 `#統整話題`，確認 DeepSeek prompt 會收到 NewsInbox Outline。
* 準備一筆沒有 Outline 的舊 NewsInbox 資料，確認 `#統整話題` 會退回 Brief。
* 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。

本版修改了 `.gs` runtime，因此需要由維護者手動同步至 Google Apps Script。

---

## Last Confirmed

Last Confirmed Version at this Git ref: `v1.12.4 Weekly News Compact & Story Grouping Edition`
Previous stable baseline described in this file: `v1.12.3 News QA Edition`
Last Confirmed Date: `2026-07-07`
Last Documentation Note: `#本週新聞` defaults to StoryKey compact grouping, LINE replies auto-split into up to 5 text messages, NewsInbox appends StoryKey, and diagnostic mode checks story lines plus duplicate素材 signals.
