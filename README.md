# 小浣 LINE Bot v1.13.0 AI Routing & Project Architecture Edition

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

v1.12.0 將群組直接貼網址改為靜默背景收件，不再主動回覆 Brief；新增 `#狀態回報` 與 `#封存本週新聞`，並讓 `#封存本週話題` 回到只讀 ConversationLog 的對話記憶。

v1.12.1 讓 `#本週新聞` 成為新聞素材主入口，新增高潛力、詳細、精簡、24 小時與分類檢視；`#封存本週新聞` 改為週報索引取向；`#help` 聚焦核心新聞工作流，低頻功能移到 `#help 進階`。

v1.12.2 強化 NewsInbox 分類稽核：主要分類與特殊主題分離，追加分類理由、信心、辨識實體與警告欄位；`#本週新聞 精簡` 改為分類掃描，並新增 `#本週新聞 診斷` 協助檢查疑似錯分素材。`#新聞問答` 保留到 v1.12.3。

v1.12.3 新增 `#新聞問答`，讓小浣可以根據最近 7 天 NewsInbox 素材回答新聞問題並附完整原文網址；同時移除低頻的 `#本週新聞 24小時` 檢視，並讓 `#本週新聞 精簡` 與診斷模式都保留完整原網址。

v1.12.4 將 `#本週新聞` 預設改為精簡模式，按 StoryKey / 故事線聚合同一事件線的素材；`#本週新聞 詳細` 才展開完整大綱、切角、節目潛力與分類資訊。NewsInbox 追加 `StoryKey` 欄位，Gemini 新聞分析會產生 storyKey；LINE 長回覆會自動分段成最多 5 則 text message，避免被單則硬裁切。診斷模式新增故事線、跨分類與重複素材檢查。

v1.12.5 將 StoryKey 重新定位為單篇新聞的候選事件提示。`#本週新聞` 與 `#本週新聞 精簡` 會以一次 DeepSeek JSON 呼叫批次判斷真正的多篇焦點故事線，並從最近七天、同 conversationId、user-only 的 ConversationLog 補充群組話題；網址、排序、完整性、LINE 排版與 fallback 仍由 GAS 固定控制。

v1.13.0 建立 provider-neutral AiService/AiProfiles。正常 runtime 的所有 AI task 都明確指定 provider、model、execution profile 與 thinking；DeepSeek V4 Flash 接管 NewsInbox 分析、`#懶人包` 與 Jina 失敗後的 raw HTML extraction。Gemini transport 保留為 dormant provider，但不是 fallback，沒有 `GEMINI_API_KEY` 也不影響正常功能。

---

## 2. v1.13.0 本版重點

v1.13.0 是 AI Routing & Project Architecture Edition。

主要調整如下：

- 新增 `18_AiService.gs`：統一 task route resolution、memory orchestration、provider dispatch、normalized response、finish reason/空回覆/JSON 基礎檢查、typed error 與安全 metadata log。
- 新增 `19_AiProfiles.gs`：集中 provider/model registry、execution profiles、task routes、thinking、reasoning effort、token、timeout、sampling 與 caller-owned retry metadata。
- 正常 runtime 全部使用 `deepseek-v4-flash`；NewsInbox 分析、`#懶人包` 與 raw HTML extraction 不再讀取 Gemini key。
- `08_GeminiService.gs` 保留 dormant transport。只有維護者明確把 route 切到 Gemini 才會讀 `GEMINI_API_KEY`；本版沒有自動跨 provider fallback。
- 功能 Prompt/schema/normalizer 留在最理解契約的功能檔；provider adapter 只處理 API 協議。
- AI metadata 只寫 console，不新增 AI Log Sheet，也不記錄完整 Prompt、聊天、正文、response text 或 secret。
- 本版不改 Sheet schema、Trigger、LINE 指令、既有回覆格式、Reader 優先順序或歷史資料。

### AI call flow

`AI Task → Task Route / Execution Profile → Provider Adapter → Normalized Response → 功能 validator / Sheet / LINE`

### Task / profile 對照

| Task | Profile | Thinking | Output | Max tokens / timeout | 主要用途 |
| --- | --- | --- | --- | --- | --- |
| `general_chat` | `fast_text` | disabled | text | 1,200 / 45s | 一般聊天與短期/長期記憶 |
| `news_analysis` | `fast_json` | disabled | JSON | 3,200 / 60s | NewsInbox title/brief/outline/分類/StoryKey |
| `web_lazy_summary` | `fast_json` | disabled | JSON | 4,000 / 60s | `#懶人包` |
| `raw_html_extraction` | `long_extraction_json` | disabled | JSON | 24,000 / 90s | Jina 失敗後的大段正文抽取 |
| `news_question` | `thinking_high` | enabled / high | text | 7,000 / 90s | 跨多筆 NewsInbox 問答 |
| `program_topic_analysis` | `thinking_high` | enabled / high | text | 8,000 / 120s | 節目話題分析 |
| `integrate_topics` | `thinking_high` | enabled / high | text | 9,000 / 120s | 跨資料層統整話題 |
| `archive_topics` | `fast_json` | disabled | JSON | 1,800 / 60s | 封存本週話題 |
| `archive_news` | `fast_json` | disabled | JSON | 2,600 / 60s | 封存本週新聞 |
| `weekly_editorial_digest` | `fast_json` | disabled | JSON | 3,200 / 60s | 本週編輯台聚類與群組話題 |
| `manual_news_supplement` | `fast_json` | disabled | JSON | 1,800 / 60s | `#新聞補充` |
| `news_memory_bridge` | `thinking_high` | enabled / high | text | 5,000 / 90s | 本週新聞與過去封存脈絡比對 |

`thinking_max` 只保留 profile，v1.13.0 沒有任何 runtime task 綁定。

---

## 3. 常用指令

### 直接貼網址

群組直接貼上一個可支援的網址時，小浣會靜默放入 NewsUrlQueue，由背景 trigger 讀取網頁、產生 Brief / Outline 與分類資料，再寫入 NewsInbox。這個流程不會主動回覆群組，讓對話保持乾淨。

如果網址不支援、入隊失敗或背景讀取失敗，錯誤會寫入 PendingReplies，等下次同聊天室有人發訊息時交付。

個人聊天室直接貼網址，或在明確指令中附上網址時，仍保留同步回覆路徑，方便維護者測試 Reader / AI 行為。

v1.10.5 起，網址流程會先透過 Reader Layer 讀取網頁內容。v1.10.6 起，PTT 文章頁會套用更嚴格的 over18 gate 判斷，避免正常文章被誤判。v1.10.9 起，X / Twitter 單篇 status 會走 FxTwitter API；Facebook、fb.watch、Threads.com、Threads.net 會先走 Jina Reader。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。預設與精簡模式會使用一次週編輯台呼叫，顯示有效群組話題、真正的多篇焦點故事線，以及依分類排列的其他新聞。每則新聞預設只顯示潛力、標題與完整來源網址。

常用檢視模式：

- `#本週新聞`：啟用週編輯台，整理群組話題、多篇焦點故事線與其他分類新聞。
- `#本週新聞 精簡`：等同 `#本週新聞`，啟用週編輯台。
- `#本週新聞 高潛力`：不啟用週編輯台，只顯示高潛力新聞並依分類精簡排列。
- `#本週新聞 詳細`：不啟用週編輯台，依分類顯示完整內容大綱、切角、節目潛力與主分類；不主動顯示 StoryKey。
- `#本週新聞 分類 <分類名>`：不啟用週編輯台，只看指定分類並精簡排列，例如 `#本週新聞 分類 科技與 AI`。
- `#本週新聞 診斷`：不啟用週編輯台，保留 StoryKey 並檢查待分類、低信心、分類警告、故事線異常與重複素材。

viewMode 的優先順序固定為 `diagnostic > detailed > compact`；高潛力與分類是獨立 filter。只有 compact 且沒有高潛力、沒有分類 filter 時才會啟用週編輯台。

如果 WeeklySummary 內已有 `ArchiveType=news` 的新聞封存，`#本週新聞 詳細` 在沒有高潛力或分類篩選時會嘗試比對本週新聞與過去新聞記憶，補充簡短的過去脈絡；精簡、分類、高潛力與診斷模式只顯示當次查詢結果。

### 新聞問答

根據最近 7 天 NewsInbox 素材回答新聞問題，並附上完整原文網址。小浣只會根據 NewsInbox 與過去新聞封存脈絡回答；如果素材池看不出來，會明確回覆資料不足。

常用方式：

- `#新聞問答 這週有哪些 AI 公司相關新聞？`
- `#新聞問答 高潛力 有哪些適合做節目的社群平台新聞？`
- `#新聞問答 分類 科技與 AI 這週有什麼可追蹤？`

### 狀態回報

查看最近 7 天新聞收件狀態，包含收到網址數、NewsInbox 入庫數、NewsUrlQueue 待處理 / 處理中 / 完成 / 失敗數、待交付錯誤回報與失敗類型。

### 新聞補充

人工補充新聞素材到 NewsInbox。v1.10.8 起，這個流程會正確使用 DeepSeek 解析補充內容，而不是因 parser 命名錯誤靜默 fallback。

### 懶人包

針對指定網址產生包含重點條列與來源資訊的完整快讀摘要。一般直接貼單一網址只回覆精簡內容大綱並收進 NewsInbox，不等同 `#懶人包`。

### 節目話題分析

可針對網址做深度分析；不附網址時，會根據使用者近期聊天、TopicHighlights、WebSummary、WeeklySummary 判斷可分析主題。

### 統整話題

整合近期素材，整理成節目可用的話題地圖。v1.11.1 起會納入最近 7 天 NewsInbox 的完整 Outline；舊資料沒有 Outline 時會退回 Brief。

### 畫重點

將重要內容寫入 TopicHighlights。後續統整話題與節目話題分析會優先參考；v1.12.0 起 `#封存本週話題` 只讀 ConversationLog。

### 封存本週話題

只根據 ConversationLog 的近期使用者訊息整理成 WeeklySummary，作為對話長期記憶。v1.12.0 起不再混入 TopicHighlights、WebSummary 或 NewsInbox。

### 封存本週新聞

將最近 7 天 NewsInbox 素材整理成 WeeklySummary，作為新聞長期記憶。這類封存會寫入 `ArchiveType=news`，供未來 `#本週新聞 詳細` 比對過去脈絡。v1.12.1 起，封存 prompt 更像「本週新聞週報索引」；v1.12.2 起會參考 `SpecialTopic` / `MatchedEntities`；v1.12.4 起素材文字也會帶入 `StoryKey`，更穩定保留代表性事件線、人物、公司、平台、政策、作品名稱與主要脈絡。

---

## 4. Help 與管理指令

### #help

查看核心功能：群組直接貼網址、`#本週新聞`、`#本週新聞 高潛力`、`#新聞問答 <問題>`、`#狀態回報`、`#新聞補充`、`#封存本週新聞`。

### #help 進階

查看較少用的新聞檢視與節目整理功能，例如 `#本週新聞 詳細 / 精簡 / 分類 / 診斷`、`#懶人包`、`#節目話題分析`、`#統整話題`、`#畫重點`、`#封存本週話題`。

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

Reader Layer 的目標是把「讀網頁」與「後續 AI task 整理」拆開，讓 AiService、NewsInbox 與 WebSummary 只吃穩定的 mainText、title、siteName、author、publishedAt、warnings 等欄位。

目前分流規則：

- 一般網站：優先使用 Jina Reader。
- PTT：使用 GAS 原生 UrlFetchApp，並帶 over18=1 cookie；v1.10.6 起在 16_ReaderLayer.gs 內修正正常文章頁被 over18 gate detector 誤判的問題。
- X / Twitter 單篇 status：使用 FxTwitter API。
- X / Twitter 非單篇 status：不自動擷取，避免把個人頁、搜尋頁、列表頁或登入頁誤當正文。
- Facebook、fb.watch、Threads.com、Threads.net：先交給 Jina Reader 嘗試讀取。
- Jina Reader 失敗時：嘗試 legacy raw HTML + `raw_html_extraction` AI task；新 route 值為 `legacy_raw_html_ai`，歷史 `legacy_raw_html_gemini` 不 migration。

---

## 7. 資料表概念

本專案主要使用 Google Sheets 作為資料儲存層。

- ConversationLog：保存使用者與小浣的原始對話紀錄。
- TopicHighlights：保存 #畫重點 產生的人工釘選素材。
- WeeklySummary：保存 #封存本週話題 與 #封存本週新聞 產生的長期記憶摘要；v1.12.0 起以 ArchiveType 區分 topic / news。
- WebTaskQueue：保存網址快讀與網址版節目分析的背景任務。
- WebSummary：保存網址快讀摘要。
- NewsUrlQueue：保存多網址、同步處理過慢或失敗時的新聞網址待處理佇列。
- NewsInbox：新聞素材池；Brief 供快速瀏覽，Outline 供 `#統整話題` 深度統整，StoryKey 是單篇新聞的候選事件提示；SpecialTopic / CategoryReason / CategoryConfidence / MatchedEntities / ClassificationWarning 供分類稽核、診斷與 `#新聞問答` 使用。v1.13.0 不新增欄位，也不回寫週編輯台聚類。
- PendingReplies：背景任務完成後，等待下次訊息交付的回覆。

---

## 8. 檔案配置

目前主要檔案如下：

- 00_Config.gs：LINE/Reader endpoint、Sheet 名稱、指令前綴與非 AI 路由常數。
- 01_Main.gs：LINE webhook 主流程。
- 02_LineCommands.gs：指令解析、分層 help 與 LINE Reply API。
- 03_Utils.gs：共用工具函式。
- 04_Storage.gs：Google Sheet 與 Script Properties 入口。
- 05_Memory.gs：短期對話記憶。
- 06_WebReader.gs：網址安全、legacy HTML 清理、raw extraction Prompt/schema/normalizer/validator 與網頁分析 Prompt。
- 07_WebTaskQueue.gs：背景處理、快讀 Prompt/schema/normalizer/validator、網址版節目話題分析與 PendingReplies。
- 08_GeminiService.gs：預設不啟用的 dormant Gemini provider adapter 與相容 wrapper。
- 09_DeepSeekService.gs：DeepSeek provider adapter、payload、HTTP/error/usage normalization 與相容 wrapper。
- 10_TopicFeatures.gs：節目話題分析、統整話題、封存本週話題、封存本週新聞。
- 11_Prompts.gs：小浣人格與 provider-neutral 共用 system prompt。
- 12_ResponseTexts.gs：固定文案、版本資訊與非 LLM 系統回覆。
- 13_NewsInbox.gs：新聞素材池、短 Brief、完整 Outline、NewsUrlQueue、`#本週新聞` 與 `#新聞問答` 處理。
- 14_TopicHighlights.gs：人工重點資料層。
- 15_DataCleanup.gs：資料清理層。
- 16_ReaderLayer.gs：Jina Reader、PTT over18、FxTwitter API、legacy fallback wrapper 與 reader 統一資料契約。
- 17_WeeklyEditorialDigest.gs：週編輯台 orchestration、模型輸入、ConversationLog 去噪、validator、cache、固定排版與 LINE block fitting。
- 18_AiService.gs：AI task 正式入口、memory orchestration、provider dispatch、normalized response、typed error 與 console metadata。
- 19_AiProfiles.gs：provider/model registry、execution profiles、task routes 與 retry policy metadata。

---

## 9. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. Secret value 應放在 Apps Script 的 Script Properties。正常 runtime 需要 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 只供 dormant Gemini route，未設定不影響其他功能。
4. 99_changelog.md 僅作為歷史紀錄。
5. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
6. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
7. 若要修改程式，不要直接改 main，應建立 feature 或 hotfix branch，開 PR 後由維護者手動 merge。

---

## 10. v1.13.0 建議測試流程

本版不修改任何 Sheet schema，不需要 migration、setup、新 Trigger 或新增 Script Properties。將修改的 `.gs` 手動同步至 Apps Script 後再進行 LINE / GAS 測試。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

- 在私訊與群組 `#小浣` 進行至少兩輪一般聊天，確認 general_chat 為 non-thinking，且短期/長期記憶仍可接續。
- 在群組直接貼一個一般新聞網址，確認群組不會收到 Brief 回覆。
- 確認該網址進入 NewsUrlQueue，背景 trigger 處理後寫入 NewsInbox。
- 在個人聊天室直接貼一個一般新聞網址，確認仍可同步回覆短 Brief 並寫入 NewsInbox。
- 測試 PTT、X / Twitter 單篇 status、Facebook / Threads 公開網址。
- 準備一個 Jina 成功網址，確認不呼叫 raw_html_extraction；再模擬 Jina 失敗，確認依序進入 `legacy_raw_html_ai` 且正文 validator 生效。
- 一次貼兩個以上網址，確認多筆靜默進 NewsUrlQueue。
- 測試不支援或讀取失敗網址，確認 PendingReplies 會在下次訊息交付錯誤。
- 執行 `#狀態回報`，確認顯示最近 7 天收件、入庫、佇列與失敗統計。
- 執行 `#本週新聞` 與 `#本週新聞 精簡`，確認啟用週編輯台；多篇同事件合併、同實體不同事件不合併、全部單篇時省略焦點故事線。
- 測試漏 itemId、重複 itemId、未知 itemId、cluster / ungrouped 衝突、空標題與單篇 cluster，確認資料 partition 讓每則原始新聞恰好位於一個故事線或其他新聞集合。
- 測試 ConversationLog 的指令、純網址、短回覆與重複排除；「評論文字＋網址」應保留評論，沒有有效對話時省略群組話題。
- 測試 DeepSeek 非 2xx、空回覆、非 JSON、缺欄、截斷 JSON 與 `finish_reason=length`，確認 typed error、Queue retry/fallback 與資料保護符合各 task 規則。
- 準備超過 30 則新聞與超過對話上限的資料，確認未送模型新聞仍進其他新聞，模型 payload 遵守裁切上限。
- 準備超長回覆，確認先減少群組話題、再省略完整低順位新聞 block；每則保留新聞恰好顯示一次、被省略新聞完全不顯示、網址不被切斷，並準確顯示「尚有 N 則未顯示」。
- 重複執行相同查詢確認 10 分鐘 cache hit；新增新聞或有效對話後確認 cache miss。
- 執行 `#本週新聞 高潛力` 與分類篩選，確認只依分類精簡顯示且不啟用週編輯台。
- 執行 `#本週新聞 詳細`，確認不啟用週編輯台、顯示主分類、Outline / Brief、切角與節目潛力，但不顯示 StoryKey。
- 執行 `#本週新聞 診斷`，確認不啟用週編輯台，並保留 StoryKey、重複素材與跨分類診斷。
- 測試同時帶診斷、詳細與精簡文字，確認 `diagnostic > detailed > compact`。
- 執行 `#新聞問答 這週有哪些 AI 公司相關新聞？`，確認回答依據 NewsInbox 並附完整原文網址。
- 執行 `#新聞問答 高潛力 有哪些適合做節目的社群平台新聞？`，確認只根據高潛力素材回答。
- 執行 `#新聞問答 分類 科技與 AI 這週有什麼可追蹤？`，確認只根據指定分類素材回答。
- 執行 `#新聞問答` 不加問題，確認會提示輸入問題範例。
- 執行 `#help`，確認只顯示核心功能。
- 執行 `#help 進階`，確認顯示詳細新聞檢視、精簡、分類、診斷模式、懶人包、節目話題分析、統整話題、畫重點與封存本週話題，且不再列出 24 小時模式。
- 執行 `#封存本週新聞`，確認 WeeklySummary 新增 `ArchiveType=news` 的新聞封存。
- 檢查 `#封存本週新聞` 的摘要是否像週報索引，並能利用 StoryKey / SpecialTopic / MatchedEntities 保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡。
- 再執行 `#本週新聞 詳細`，確認若有新聞封存且未使用高潛力或分類篩選，會嘗試補充過去脈絡；預設精簡、高潛力、分類與診斷模式只顯示當次查詢結果。
- 執行舊指令 `#本週新聞 24小時` 與 `#本週新聞 24小時 診斷`，確認會回覆 v1.12.3 已移除 24 小時檢視，不會改查最近一天素材。
- 執行 `#封存本週話題`，確認 WeeklySummary 新增 `ArchiveType=topic`，且來源只計算 ConversationLog 使用者訊息。
- 執行 `#統整話題`，確認會引用 NewsInbox Outline；再用一筆沒有 Outline 的舊資料確認可退回 Brief。
- 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。
- 在 GAS 手動執行 `processWebTaskQueue` / `processNewsUrlQueue`，並確認既有 time-driven trigger handler 名稱未改變。
- 暫時移除 `GEMINI_API_KEY` 後回歸上述所有正常功能，確認沒有啟動錯誤或 Gemini 呼叫。
- 檢查 `AI_CALL_METADATA` 含 task/provider/model/profile/thinking/reasoning effort/token/finish reason/errorType；thinking_high 成功時確認 reasoning tokens 可觀察，且 log 不含完整 Prompt、聊天、正文、response text 或 secret。
