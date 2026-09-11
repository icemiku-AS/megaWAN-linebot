# 小浣 LINE Bot v1.14.2 Natural Search & Vision Edition

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

v1.13.1 將 20 個 GAS runtime `.gs` 依穩定領域區段重新編號，並將 DeepSeek／Gemini adapter 檔名由 Service 改為 Provider。這是 source layout 維護版本；函式、Trigger、Prompt、AI route/profile/model、Reader/Queue、Sheet schema 與 LINE 行為均不變。

v1.13.2 改善 `#本週新聞` 的 X / Twitter 單篇 status 顯示：週新聞 presentation 會優先用既有 Brief 產生 `X｜Brief`，但 NewsInbox raw Title、Brief、Outline、StoryKey 與 AI / Reader contract 都保持不變；診斷模式也不再因同帳號的 synthetic X title 誤報標題重複。

---

## 2. v1.14.2 本版重點

v1.14.2 是 Natural Search & Vision Edition，以 v1.14.1 為基線：

- 私訊回覆圖片後可直接自然提問；群組／room 只需「引用圖片 + `#小浣`」，不再要求「看圖」關鍵字。舊 `#小浣 看圖` 保持相容，沒有 quote 不猜上一張圖片。
- 一般聊天改走 DeepSeek Responses，提供 server-side `web_search`：普通問題使用 `tool_choice:auto`，明確上網／搜尋要求強制 `{type:"web_search"}`；只有實際 `web_search_call` 才算搜尋成功。
- URL parser 拒絕 userinfo、IPv6 authority、非法 port／numeric host，並關閉 PTT／legacy direct fetch 的未驗證 redirect，補上 SSRF trust boundary。
- Pending Reply 改為 LINE Reply 成功後才刪除；失敗保留供下次重試，以 at-least-not-lost 為目標。
- `general_chat` 使用 Responses；其他 12 個 AI task 維持 Chat Completions。全數仍使用 canonical `deepseek-flash` 與 HIGH，AiService/provider-neutral contract、Reader／Queue、Sheet／Trigger／memory／privacy 保留。

仍有 21 個 runtime `.gs`；沒有新增 Script Property、Sheet schema／migration、Trigger、Web App URL、外部 Search credential 或圖片保存。現有 smoke test 保留原名，擴充至 59 項。

### v1.14.1 simplification baseline（沿用）

NewsInbox／WeeklySummary 共用表頭 writer、同步／背景新聞共用 analysis、Reader hostname／HTTP status helper、memory 保存端修剪，以及週編輯台既有 partition／coverage／cache 驗證都完整沿用。

### v1.14.0 multimodal baseline（沿用）

v1.14.0 是 DeepSeek Flash Multimodal Edition：正式模型改為 `deepseek-flash`（2026-09-10 對應 DeepSeek V4.1 Flash），internal registry key 為 `deepseek_flash`。舊 `deepseek-v4-flash` alias 不再用於 active runtime；所有 13 個正式 AI task 都明確設定 thinking enabled + reasoning_effort high，並正式支援 LINE 圖片理解。

本版包含新圖片功能、AI profile 整理、reasoning token 預算調整、圖片 trust boundary 與錯誤訊息防洩漏、版本／help／文件更新。Provider-neutral architecture、既有 JSON validator、Reader routing、NewsInbox／StoryKey／Sheet schema、compatibility wrapper 與 Gemini dormant 定位保留。無新 Script Property、setup、migration 或 Trigger。

### v1.13.2 presentation baseline（沿用）

v1.13.2 是 X Post Weekly Display Edition。

主要調整如下：

- 只有 Twitter-like hostname 且具有有效 numeric status ID 的真正 X status 才套用特規；個人頁、搜尋頁、list 與一般網站 `/status/` 不會誤判。
- `#本週新聞` 的 X status 依 `Brief → 有效既有 StoryKey → raw Title → 未取得標題` 產生 Display Title；一般網站繼續顯示原始 Title。
- Weekly Editorial success、fallback、cache hit、高潛力、分類與詳細模式共用同一套 Display Title；診斷仍顯示 raw Title。
- X status 不使用 synthetic raw Title 進行診斷模式的 title duplicate 判斷；同 URL 重複與一般新聞 Title duplicate 仍照常運作。
- Display Title 不寫回 Sheet；NewsInbox schema、Reader、AI、排序、StoryKey、新聞問答與封存 contract 都不變，不需要 migration。
- `WEEKLY_EDITORIAL_CACHE_VERSION` 維持 `v1.13.0`，因模型 input、partition 與 cache payload contract 未變。

### v1.13.1 source layout baseline

v1.13.1 是 Source Layout & File Ordering Edition。

主要調整如下：

- 20 個 runtime `.gs` 依 Core、AI、Reader/Jobs、News/Editorial、Topic/Material、Data operations 六個領域區段排列。
- 完成 17 個 rename；`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs` 保持原名。
- `09_DeepSeekService.gs` → `15_DeepSeekProvider.gs`，`08_GeminiService.gs` → `16_GeminiProvider.gs`，明確區分正式 `10_AiService.gs` 與 vendor adapter。
- 區段內保留空號，未來新增檔案優先使用所屬領域空號，不為了完美插入順序再次重編既有檔案。
- 數字前綴只供人類／AI 架構導航與 GAS 平面檔案排序，不代表 runtime load order；不得新增依賴檔案排序的 top-level executable side effect。
- 本版只更新檔名、檔頭、版本顯示與維護文件；不改函式名稱、global const 名稱（版本顯示值除外）、Prompt、AI route/profile/model、Reader/Queue、Sheet、Trigger、LINE 指令或回覆格式。
- `WEEKLY_EDITORIAL_CACHE_VERSION` 維持 `v1.13.0`，因週編輯台資料 contract 未變，避免無價值 cache miss。

### v1.14.0 AI runtime

v1.13.0 建立的 provider-neutral 分層由 `10_AiService.gs`、`11_AiProfiles.gs`、`15_DeepSeekProvider.gs` 與 `16_GeminiProvider.gs` 承接；v1.14.0 擴充 content contract 並更新模型／profile，v1.14.1 沿用。Gemini 仍是 dormant provider、不是 fallback，缺少 `GEMINI_API_KEY` 不影響正常功能。

### AI call flow

`AI Task → Task Route / Execution Profile → Provider Adapter → Normalized Response → 功能 validator / Sheet / LINE`

### Task / profile 對照

| Task | Profile | Thinking | Output | Max tokens / timeout | 主要用途 |
| --- | --- | --- | --- | --- | --- |
| `general_chat` | `thinking_high` | enabled / high | text | 4,800 / 45s | 一般聊天、記憶與 Responses Web Search |
| `news_analysis` | `thinking_json` | enabled / high | JSON | 8,000 / 60s | NewsInbox 分析／分類／StoryKey |
| `web_lazy_summary` | `thinking_json` | enabled / high | JSON | 8,000 / 60s | 網址懶人包 |
| `raw_html_extraction` | `long_extraction_json` | enabled / high | JSON | 28,000 / 90s | legacy 長文抽取 |
| `news_question` | `thinking_high` | enabled / high | text | 7,000 / 90s | 新聞問答 |
| `program_topic_analysis` | `thinking_high` | enabled / high | text | 8,000 / 120s | 節目話題分析 |
| `integrate_topics` | `thinking_high` | enabled / high | text | 9,000 / 120s | 跨素材統整 |
| `archive_topics` | `thinking_json` | enabled / high | JSON | 6,000 / 60s | 對話封存 |
| `archive_news` | `thinking_json` | enabled / high | JSON | 7,000 / 60s | 新聞封存 |
| `weekly_editorial_digest` | `thinking_json` | enabled / high | JSON | 10,000 / 60s | 新聞聚類／對話去重 |
| `manual_news_supplement` | `thinking_json` | enabled / high | JSON | 5,000 / 60s | 人工補充 |
| `news_memory_bridge` | `thinking_high` | enabled / high | text | 5,000 / 90s | 跨週脈絡 |
| `image_analysis` | `thinking_high` | enabled / high | text | 8,000 / 60s | 圖片／OCR／截圖問答 |

`fast_text` 合併到 `thinking_high`，`fast_json` 更名為 `thinking_json`；移除沒有 caller 的 `thinking_max`。長文抽取維持獨立 profile，避免短 JSON 取得長文預算。每個 route 同時驗證 expectedThinking 與 expectedReasoningEffort。

maxOutputTokens 是 reasoning + visible output 的共用上限，並非保證保留多少可見輸出。原 non-thinking task 的初始調整：聊天 1,200→4,800、新聞分析 3,200→8,000、懶人包 4,000→8,000、長文抽取 24,000→28,000、話題封存 1,800→6,000、新聞封存 2,600→7,000、週編輯台 3,200→10,000、人工補充 1,800→5,000。週編輯台需處理最多 30 則新聞與對話去重，預留較多 reasoning；短補充較少。原本已 HIGH 的四個 task 預算不變。

所有既有 AI task timeout 維持不變。`general_chat` 走 Responses；其他 12 個 task 仍走 Chat Completions。單次同步 AI 仍最多 30 秒，同一批 webhook events 共用 40 秒 absolute deadline，主 task 最低剩餘 8 秒、輔助 memory bridge 最低 20 秒才發 request；同步 Reader cap 12 秒。圖片下載最多 10 秒，下載、memory lock、驗證、Base64 編碼／序列化耗時都會在 AI fetch 前重新扣除。LINE Reply API 另設 10 秒 timeout，避免使用 GAS 的 360 秒預設；此上限不延長 AI 工作 deadline。背景 Queue 不帶同步 context，保留 task 原上限。AiService 不 retry，Search 不建立 client continuation loop。

保留 `finish_reason=length`、空內容、非法 JSON 的 failure contract；不保存半截 JSON。直接網址可依 typed retryable 退回 NewsUrlQueue，週編輯台使用分類 fallback，人工補充使用既有文字 fallback；封存失敗不寫入 WeeklySummary。圖片失敗或預算不足回覆重送提示，不建立圖片 queue。上述 token 預算是待真實流量校準的初始值，請觀察 `AI_CALL_METADATA` 的 reasoningTokens／outputTokens／finishReason 與 timeout；本機 mock 不代表真實模型延遲或輸出品質。

---

## 3. 常用指令

### 看圖片：私訊與群組

- 私訊：直接傳 JPEG/PNG 圖片仍會自動分析；也可用 LINE「回覆」選取圖片，再直接輸入「這是什麼？」、「哪裡出錯？」等任意自然文字，不需要 `#小浣` 或「看圖」。
- 群組／多人聊天室：單純貼圖不下載、不回覆、不記錄圖片；普通使用者引用圖片聊天也保持靜默。要分析時，回覆該圖片並以 `#小浣` 開頭提問，例如 `#小浣 這是真的假的？`。舊 `#小浣 看圖 <問題>` 繼續有效。
- LINE 的 `quotedMessageId` 直接用來探測／下載指定圖片，不另外保存 message pairing。LINE quote 不附原訊息型別；只有安全取得 JPEG/PNG 才進 Vision，非圖片或不可取得的自然引用回到普通文字流程。明確舊看圖指令遇到過期、撤回、非圖片或缺引用時，仍顯示既有操作提示。
- 私訊一次多圖（imageSet）只處理 index=1，並提示其他圖片分次傳送；舊版 LINE 若未提供有效 index，會提示單張傳送／明確引用，不自動逐張分析。群組可單獨引用其中一張。不做多圖比較，也不將先前／下一則文字自動配成 caption。
- 既有 Pending Reply 優先交付；私訊此時傳圖會收到「圖片尚未分析，請再傳一次」。自然／舊看圖問題也會提示交付完成後重新回覆圖片，問題中的網址不會被當成新聞收件。
- 成功後只保存「使用者提供圖片」placeholder、問題與分析文字；後續文字聊天可延續這些描述。重新查細節須重新傳圖或引用仍可下載的原圖。

圖片輸入僅接受一張 JPEG/PNG、raw bytes ≤ 4 MiB（4,194,304 bytes），包含 Content-Type、檔案 signature、非空 bytes、整數 byte、HTTP 200 與 Content-Length／實際長度防線；不信任副檔名。完整 DeepSeek JSON body（含 Base64）另限 8 MiB；4 MiB 原圖編碼約 5.34 MiB。此上限刻意低於 DeepSeek 48 MiB request body / 32 MiB inline image 及 GAS 50 MB POST/response 限制。GAS fetch 會先緩衝回應，無法在下載途中以 raw ceiling 截流。

DeepSeek 官方另支援 GIF/WebP，但本版入口只開放 JPEG/PNG。尺寸由 DeepSeek 解碼器驗證（官方單圖每邊最多 8192 px）；本地以 raw size 控制資源，不新增 decoder、縮圖或壓縮依賴。格式／尺寸無法解析、429／5xx、下載失敗、超大圖、空回覆、截斷或逾時皆有固定繁中提示，不自動重試。

流程：`LINE image event / quotedMessageId → 07_LineImages 下載與驗證 → runAiMemoryTask(image_analysis) → normalizeAiMessages_ → DeepSeek Provider → normalized text → LINE / 文字 memory`。

AiService content 沿用字串，只有 user message 可另用 `[{type:'text', text:'問題'}, {type:'image', mimeType:'image/png', bytes:[...]}]`；system／assistant 保持字串，純 text parts 也不接受。Base64、`image_url` 與 data URL 只在 DeepSeek adapter 組 request 時產生，不寫 Sheet、Cache 或 console。不保存原圖，也不使用 Drive、Cloud Storage 或 DeepSeek Files API；分析文字與 placeholder 仍依原本 ConversationLog／Cache 政策保存。看圖問題在寫入 ConversationLog 前、模型結果在文字出口，都會移除 data URL／大段編碼；LINE Reply 失敗只記 HTTP status 或固定訊息，不記外部 error body／exception。

### 自然對話與即時 Web Search 狀態

一般聊天會完整送入 system、WeeklySummary memory、trimmed user/assistant history 與當次訊息，再由 DeepSeek Responses 的 `web_search` tool 決定是否查詢：

- 普通問題使用 `tool_choice:"auto"`；模型可依問題是否需要近期資料自行搜尋。
- 明確的「上網查／搜尋一下」使用 `{type:"web_search"}` 強制搜尋；「最近／今天／現在」不是 GAS keyword classifier，仍走 auto。
- output 實際出現 `web_search_call` 才是 `usedWebSearch=true`。明確搜尋若沒有 call、Responses 失敗或 timeout，會誠實回錯，不 fallback 到 Chat Completions 或舊知識。
- Search 發生時，來源獨立放在同一次 LINE Reply 最後一則；主回答最多 4 則，來源 1 則。來源限 provider action／`url_citation` metadata 的公開 HTTP(S) URL，去重後最多 3 個；沒有可靠 URL 時明示 provider 未提供，不從回答猜網址。
- Search raw result、action、annotation、reasoning 與來源頁面不進 memory、Sheet 或 console；conversation memory 只保存最終主回答文字。
- 引用圖片仍由 Chat Completions Vision 處理；要求圖片查證時可先完成圖片判讀，但本版不再追加第二次 HIGH Responses call，因此會明示即時網路查證未完成。
- 不新增 Search Queue、外部 Search API、API key、Agent framework 或 raw search log。

DeepSeek 官方頁面目前有版本落差：Responses reference／搜尋索引列出 server-side Search、forced tool choice 與 `web_search_call`，但直接取得的 guide 仍可讀到 built-in `web_search` ignored。精確修改時間與 production endpoint 尚未以 live probe 證實，詳見 [CURRENT_VERSION.md](CURRENT_VERSION.md#deepseek-official-contract-and-search-boundary)。本機沒有 API key，未要求提供；部署後需手動做最小 Search smoke test。

### 直接貼網址

群組直接貼上一個可支援的網址時，小浣會靜默放入 NewsUrlQueue，由背景 trigger 讀取網頁、產生 Brief / Outline 與分類資料，再寫入 NewsInbox。這個流程不會主動回覆群組，讓對話保持乾淨。

如果網址不支援、入隊失敗或背景讀取失敗，錯誤會寫入 PendingReplies，等下次同聊天室有人發訊息時交付。

個人聊天室直接貼網址，或在明確指令中附上網址時，仍保留同步回覆路徑，方便維護者測試 Reader / AI 行為。

v1.10.5 起，網址流程會先透過 Reader Layer 讀取網頁內容。v1.10.6 起，PTT 文章頁會套用更嚴格的 over18 gate 判斷，避免正常文章被誤判。v1.10.9 起，X / Twitter 單篇 status 會走 FxTwitter API；Facebook、fb.watch、Threads.com、Threads.net 會先走 Jina Reader。

### 本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。預設與精簡模式會使用一次週編輯台呼叫，顯示有效群組話題、真正的多篇焦點故事線，以及依分類排列的其他新聞。每則新聞預設只顯示潛力、標題與完整來源網址；真正的 X / Twitter 單篇 status 會用既有 Brief 產生 `X｜Brief` Display Title，Brief 缺失時才安全回退。一般網站仍顯示原始 Title。

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

Reader Layer 的目標是把「讀網頁」與「後續 AI task 整理」拆開。成功 webResult 維持既有 mainText、title、siteName、author、publishedAt、warnings 等欄位；失敗結果可額外帶 optional `errorType/retryable/httpStatus` 供 Queue 判斷，舊 caller 若只讀 `ok/error` 仍相容。

目前分流規則：

- 一般網站：優先使用 Jina Reader。
- PTT：使用 GAS 原生 UrlFetchApp，並帶 over18=1 cookie；現行 routing 與 over18 gate detector 位於 `20_ReaderLayer.gs`。
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
- NewsInbox：新聞素材池；Brief 供快速瀏覽，Outline 供 `#統整話題` 深度統整，StoryKey 是單篇新聞的候選事件提示；SpecialTopic / CategoryReason / CategoryConfidence / MatchedEntities / ClassificationWarning 供分類稽核、診斷與 `#新聞問答` 使用。v1.13.2 的 Display Title 只在 render 時計算，不新增欄位、不改 raw Title / Brief / Outline contract，也不回寫週編輯台聚類。
- PendingReplies：背景任務完成後，等待下次訊息交付的回覆；v1.14.2 起只有 LINE Reply HTTP 2xx 後才刪除，失敗會保留供下次再交付。

---

## 8. 檔案配置

數字前綴只供架構導航與 GAS 編輯器的平面排序，不是 runtime load order。新檔案應優先使用所屬領域的保留空號；不要為了插入新檔重新編號整個專案，也不得透過 top-level executable side effect 依賴檔案排序。

### 00–09 Core／LINE transport／Shared foundation

- `00_Config.gs`：共用設定、endpoint、Sheet 名稱、指令前綴與非 AI 路由常數。
- `01_Main.gs`：LINE webhook、setup 與 Trigger 安裝入口。
- `02_LineCommands.gs`：指令解析、分層 help 與 LINE Reply API。
- `03_ResponseTexts.gs`：固定文案、版本資訊與非 LLM 系統回覆。
- `04_Utils.gs`：跨領域共用工具函式。
- `05_Storage.gs`：Google Sheet 與 Script Properties 共用入口。
- `06_Memory.gs`：短期對話記憶。
- `07_LineImages.gs`：LINE 圖片下載／驗證與 image_analysis 功能入口。

### 10–19 AI configuration／orchestration／providers

- `10_AiService.gs`：AI task 正式入口、memory orchestration、provider dispatch、normalized response 與 typed error。
- `11_AiProfiles.gs`：provider/model registry、execution profiles、task routes 與 retry metadata。
- `12_Prompts.gs`：小浣人格與 provider-neutral 共用 system prompt。
- `15_DeepSeekProvider.gs`：DeepSeek provider adapter、payload、HTTP/error/usage normalization 與相容 wrapper。
- `16_GeminiProvider.gs`：預設不啟用的 dormant Gemini provider adapter 與相容 wrapper。

### 20–29 Reader／Web workflows／background jobs

- `20_ReaderLayer.gs`：Jina、PTT、FxTwitter、legacy fallback routing 與統一 webResult contract。
- `21_WebReader.gs`：legacy raw HTML fetch/cleaning、raw extraction contract 與網頁分析 Prompt。
- `25_WebTaskQueue.gs`：WebTaskQueue、快讀 contract、網址版節目話題分析與 PendingReplies。

### 30–39 News／Editorial

- `30_NewsInbox.gs`：新聞素材池、NewsUrlQueue、`#本週新聞`、`#新聞問答` 與新聞封存脈絡。
- `35_WeeklyEditorialDigest.gs`：週編輯台輸入、validator、cache、fallback 與 LINE block fitting。

### 40–49 Topic／material workflows

- `40_TopicHighlights.gs`：人工重點資料層。
- `45_TopicFeatures.gs`：節目話題分析、統整話題、封存本週話題與封存本週新聞。

### 50–59 Data operations／maintenance

- `50_DataCleanup.gs`：依 conversationId 執行二段式確認的資料清理。

`60–89` 保留給未來新領域；所有區段內未使用的編號都刻意保留。

---

## 9. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. Secret value 應放在 Apps Script 的 Script Properties。正常 runtime 需要 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 只供 dormant Gemini route，未設定不影響其他功能。
4. 99_changelog.md 僅作為歷史紀錄。
5. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
6. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。
7. 若要修改程式，不要直接改 main，應建立 feature 或 hotfix branch，開 PR 後由維護者手動 merge。
8. 數字前綴與檔名不得被程式當成 load order；跨檔初始化應由函式入口明確呼叫。
9. 新增 `.gs` 時先選領域與保留號碼，不為了排序美觀重編既有檔案。

---

## 10. v1.14.2 GAS rollout 與建議測試流程

本版修改一般聊天的 Responses Search transport、LINE 來源 bubble、自然圖片 routing、URL safety 與 Pending Reply 交付。Sheet schema、cache payload、Trigger 與 Script Properties 不變，不需要 migration/setup 或清除 cache。GAS 仍由維護者手動同步。

GAS 手動同步順序：

1. 先備份目前 Apps Script version；由 v1.14.1 升級前後都應有 21 個 `.gs`。
2. 手動同步 `01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`15_DeepSeekProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`；routing、transport、Pending Reply acknowledge 與 caller 註解應在同一次 source 同步中完成。
3. 不暫停或重建 Trigger；在 Trigger 畫面確認仍綁定原 handler，並在函式選單確認主要入口仍存在。
4. 完成 smoke tests 後建立 v1.14.2 Apps Script version，將既有 Web App deployment 指向新 version；deployment URL 應保持不變。

若同步或 smoke test 發現問題，先讓 Web App deployment 保持在上一個穩定 Apps Script version，再檢查本版同步的十二個 runtime 檔案。

本機可先執行 `node tests/v1140_smoke.cjs`（只有內建模組；這是開發驗證工具，不是新增 Node runtime，也不部署到 GAS）。共 59 項；涵蓋 general_chat Responses、auto／forced Search、完整 history、HIGH／token budget、`web_search_call`、來源驗證／獨立 bubble／第 5 則 slot、honest failure、memory privacy，以及既有 URL authority／redirect、Natural Vision、業務流程與 Pending transport／lock／acknowledge。未能本機執行 GAS，亦未用真實 API key 執行 LINE/DeepSeek；離線 mock 不證明 production endpoint 已部署同一 Search contract。

本版特別回歸：Search auto／forced、實際 call 判定、最多三來源、長回答保留來源 bubble、失敗不 fallback；Natural quoted image、群組 quiet、沒有 quote 不猜圖；userinfo/IPv4/IPv6/port/redirect 防線；以及 Pending Reply LINE failure 保留、retry 成功才 consume。原有 NewsInbox／Queue／X／PTT／週編輯台／memory／deadline 回歸全數繼續適用。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

- 私訊傳一般圖片、中文截圖、錯誤訊息、新聞圖卡與表格，確認能分析；模糊字應標示看不清楚。
- 私訊回覆圖片輸入任意自然問題，確認啟動 Vision；引用非圖片時應回到普通文字對話。
- 群組貼圖與普通引用圖片聊天確認完全靜默；回覆圖片輸入 `#小浣 哪裡出錯？` 會分析，舊 `#小浣 看圖` 仍可用；沒有引用時不猜上一張圖。
- 一般聊天測試不需即時資料與需最新資料兩種問題，確認 Responses `auto` 由模型決定；明確要求上網時確認強制 Search、最後一則顯示最多三個來源。再模擬無 `web_search_call`／provider failure／timeout，確認不回退舊知識。引用圖片要求查證時可先做 Vision，但清楚標示未完成網路查證。
- 檢查超過 4 MiB、非 JPEG/PNG、過期引用與下載／AI timeout 的繁中 fallback；私訊多圖只回第一張。
- 測試缺少 imageSet.index 的舊版多圖事件：提示單張／引用且不呼叫 AI；有 Pending Reply 時，帶網址的看圖問題不可進 NewsUrlQueue。
- 圖片分析後文字追問，檢查 Cache 與 ConversationLog 只有 placeholder／問題／分析文字，console 沒有圖片、data URL 或 secret。
- 模擬圖片下載耗時、memory lock 耗時與同批多 events，確認共用 40 秒 deadline；預算不足不發後續 fetch，也不排圖片 queue。
- 模擬 LINE Reply 非 2xx／exception，確認 PendingReplies row 保留；下一次 2xx 後才刪除，其他 conversation 不受影響。
- Pending 仍持 global ScriptLock 經過 LINE HTTP；並行 webhook 可能略過本次 pending，交付後 acknowledge 失敗可能重送。需實測低併發下可接受的延遲；不承諾 exactly-once 或與人工 Sheet／cleanup 操作互斥。
- 測試 userinfo、localhost、127/8、private/link-local/metadata、IPv6、非法 port 與公開 X/PTT URL；確認 direct raw/PTT fetch 不跟隨 redirect。

- 執行 `#版本`、`#版本紀錄` 與 `#help`，確認顯示與指令內容正確。

- 準備一般網站 Title 與不同 Brief，確認所有週新聞 presentation 仍顯示 Title，不改成 Brief。
- 準備 `x.com`、`twitter.com`、`mobile.twitter.com`、`fxtwitter.com`、`fixupx.com` 的有效 status 舊資料，確認顯示 `X｜Brief`；X 個人頁、搜尋頁、list、無 numeric status ID 與一般網站 `/status/` 不套特規。
- 測試 X status 缺 Brief，確認依有效既有 StoryKey、raw Title、`未取得標題` 回退，且不會顯示空的 `X｜`。
- 在 Weekly Editorial success、失敗 fallback、cache hit、高潛力、分類與詳細模式確認 X 顯示一致；診斷仍顯示 raw Title。
- 準備同帳號、相同 synthetic Title、不同 status URL 的兩筆 X 素材，確認不報 title duplicate；相同 URL 仍報重複，一般新聞 Title duplicate 仍有效。
- 準備多筆長 Brief，確認既有 LINE block fitting、protected ranges、最多 5 則 message、單則長度與 omission count 都正常。

- 在私訊與群組 `#小浣` 進行至少兩輪一般聊天，確認 general_chat 為 enabled/high，且短期/長期記憶仍可接續。
- 在群組直接貼一個一般新聞網址，確認群組不會收到 Brief 回覆。
- 確認該網址進入 NewsUrlQueue，背景 trigger 處理後寫入 NewsInbox。
- 在個人聊天室直接貼一個一般新聞網址，確認仍可同步回覆短 Brief 並寫入 NewsInbox。
- 模擬 Reader 已耗時、Jina 失敗後先做 legacy extraction，以及剩餘 AI 預算不足，確認直接網址會改進既有 NewsUrlQueue，而不是再等待完整 60/90 秒。
- 測試 PTT、X / Twitter 單篇 status、Facebook / Threads 公開網址。
- 準備一個 Jina 成功網址，確認不呼叫 raw_html_extraction；再模擬 Jina 失敗，確認依序進入 `legacy_raw_html_ai` 且正文 validator 生效。
- 一次貼兩個以上網址，確認多筆靜默進 NewsUrlQueue。
- 測試不支援或讀取失敗網址，確認 PendingReplies 會在下次訊息交付錯誤。
- 執行 `#狀態回報`，確認顯示最近 7 天收件、入庫、佇列與失敗統計。
- 執行 `#本週新聞` 與 `#本週新聞 精簡`，確認啟用週編輯台；多篇同事件合併、同實體不同事件不合併、全部單篇時省略焦點故事線。
- 測試漏 itemId、重複 itemId、未知 itemId、cluster / ungrouped 衝突、空標題與單篇 cluster，確認資料 partition 讓每則原始新聞恰好位於一個故事線或其他新聞集合。
- 測試 ConversationLog 的指令、純網址、短回覆與重複排除；「評論文字＋網址」應保留評論，沒有有效對話時省略群組話題。
- 測試 DeepSeek 非 2xx、空回覆、非 JSON、缺欄、截斷 JSON 與 `finish_reason=length`，確認 typed error、Queue retry/fallback 與資料保護符合各 task 規則。
- 模擬缺 `DEEPSEEK_API_KEY`、401/403、400、timeout、429、5xx，確認 legacy Reader 到 NewsUrlQueue 的 typed metadata 不遺失，且永久錯誤不重試。
- 測試 X / Twitter 非 `/status/{id}` 網址即使繞過入隊前檢查，也會以 `x_twitter_url_without_status_id` 直接 failed。
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
- 執行 `#畫重點`，確認 TopicHighlights 可寫入，後續統整仍可讀取。
- 對任一清理指令只執行第一階段，確認顯示影響範圍與二段式警告；不要輸入「確認」。
- 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。
- 在 GAS 手動執行 `processWebTaskQueue` / `processNewsUrlQueue`，並確認既有 time-driven trigger handler 名稱未改變。
- 等待下一輪 Queue Trigger，確認排程可正常再執行且沒有 duplicate function／const 載入錯誤。
- 暫時移除 `GEMINI_API_KEY` 後回歸上述所有正常功能，確認沒有啟動錯誤或 Gemini 呼叫。
- 對照部署前快照，確認所有 Sheet headers、欄序與 Script Properties 名稱／值均未變。
- 檢查 `AI_CALL_METADATA` 含 task/provider/model/profile/thinking/reasoning effort/token/finish reason/errorType/resultScope/businessValidation；所有 task 成功時確認 thinking=enabled、reasoningEffort=high、model=deepseek-flash 與 reasoning tokens 可觀察，且 log 不含完整 Prompt、聊天、正文、response text 或 secret。


## 11. 2026-09-12 官方規格核對

- [DeepSeek 更新日誌](https://api-docs.deepseek.com/updates/)與[模型資料](https://api-docs.deepseek.com/quick_start/pricing/)：正式 `deepseek-flash` 對應 V4.1 Flash，支援文字、Vision 與 JSON。
- [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)：Chat Completions 送 `thinking:{type:'enabled'}` 與 `reasoning_effort:'high'`；general_chat Responses 轉為 `reasoning:{effort:'high'}`。官方目前明列 temperature／presence_penalty／frequency_penalty 在 thinking 無效，`top_p` 雖可用但低於 0.95 會被提升至 0.95。本版刻意省略全部 sampling 欄位。
- [Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)：system content 是 string、assistant 是 string/null、user 可用 string/content parts。JSON task 保留 `response_format:{type:'json_object'}`、明確 JSON prompt 與 finish reason 檢查；`aborted`／`insufficient_system_resource` 在 adapter 分類為可重試中斷，保留 finish／usage metadata，部分輸出不進記憶。
- [Vision](https://api-docs.deepseek.com/guides/vision/)：user content 中使用 text + image_url 區塊，inline image 是 Base64 data URL；本地限制詳見看圖說明。
- [Responses API guide](https://api-docs.deepseek.com/guides/responses_api/)與[Create a response reference](https://api-docs.deepseek.com/api/create-response/)：reference／搜尋索引列 `web_search` 為 server-side tool，支援 `auto`／`required`／特定 tool choice，並以 `web_search_call` 表示實際搜尋；直接 guide 頁面仍可讀到 built-in Search ignored。兩者沒有可比較的精確更新時間，本版依 Search contract 實作並用實際 call fail closed；未宣稱 production endpoint 已 live 驗證。
- [LINE Get content／quotedMessageId](https://developers.line.biz/en/reference/messaging-api/nojs/)：原生 content API 使用 api-data.line.me；replyToken 應在收到 webhook 一分鐘內使用，圖片保存時間不保證。
- [GAS UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)與[配額](https://developers.google.com/apps-script/guides/services/quotas)：使用 timeoutSeconds；POST／response 上限 50 MB，本版採更小的應用上限。
