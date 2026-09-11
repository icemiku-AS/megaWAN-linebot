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
外部服務：LINE Messaging API、DeepSeek API、Jina Reader、FxTwitter API；Gemini API transport 保留但正常 runtime 不啟用

---

## Version Represented by This Git Ref

Repository: `icemiku-AS/megaWAN-linebot`
Version represented by this Git ref: `v1.14.2 Natural Search & Vision Edition`
Previous stable baseline described in this file: `v1.14.1 Codebase Simplification Edition`

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

以下 21 個檔案代表 v1.14.2 Natural Search & Vision Edition 的 active GAS runtime source：

* `00_Config.gs`
* `01_Main.gs`
* `02_LineCommands.gs`
* `03_ResponseTexts.gs`
* `04_Utils.gs`
* `05_Storage.gs`
* `06_Memory.gs`
* `07_LineImages.gs`
* `10_AiService.gs`
* `11_AiProfiles.gs`
* `12_Prompts.gs`
* `15_DeepSeekProvider.gs`
* `16_GeminiProvider.gs`
* `20_ReaderLayer.gs`
* `21_WebReader.gs`
* `25_WebTaskQueue.gs`
* `30_NewsInbox.gs`
* `35_WeeklyEditorialDigest.gs`
* `40_TopicHighlights.gs`
* `45_TopicFeatures.gs`
* `50_DataCleanup.gs`

---

## Source Layout Navigation Rule

數字前綴只供人類／AI 架構導航與 GAS 編輯器平面排序，不代表 Google Apps Script runtime load order。

* `00–09`：Core／LINE transport／Shared foundation
* `10–19`：AI configuration／orchestration／providers
* `20–29`：Reader／Web workflows／background jobs
* `30–39`：News／Editorial
* `40–49`：Topic／material workflows
* `50–59`：Data operations／maintenance
* `60–89`：未來新領域保留

新檔案應優先使用所屬領域的保留空號。不得為了完美插入順序再次重編既有檔案，也不得新增依賴檔名、檔號或排序的 top-level executable side effect。

---

## Active Project Documents

以下檔案不是 GAS runtime 程式，但會影響維護與 AI 協作：

* `README.md`：專案說明、功能、指令與檔案配置。
* `CURRENT_VERSION.md`：目前版本判定與版本邊界。
* `AGENTS.md`：Codex / AI coding agent 的本機工作規則。
* `99_changelog.md`：歷史版本紀錄。

修改這些文件通常不需要手動同步到 Google Apps Script，除非同時修改了 `.gs` 程式碼。

---

## v1.14.2 Version Boundary

本版是 Natural Search & Vision Edition，正式基線為 main 的 v1.14.1。現行 source of truth 是目前 Git ref 的實際 `.gs`；本地修改不代表已 merge、發布或部署到 GAS。

### DeepSeek official contract and Search boundary

2026-09-12 重新核對的 Responses reference／搜尋索引 contract 包含 `function` 與 server-side `web_search`，`tool_choice` 支援 `auto`、`required` 及特定 `{type:"web_search"}`；真正執行搜尋時，output 會出現 `web_search_call`。Responses 是 stateless，本版每次仍完整送入 system、trimmed user/assistant history、WeeklySummary memory 與當次 user message，並使用 `reasoning.effort=high`、`max_output_tokens`，不依賴 `previous_response_id`、`conversation` 或 `store`。

官方頁面目前仍存在發布時間差：同一個 [Responses guide](https://api-docs.deepseek.com/guides/responses_api/) 的直接頁面仍可讀到 built-in `web_search` ignored，但 [Responses reference](https://api-docs.deepseek.com/api/create-response/) 的搜尋索引／contract 已列 server-side Search 與上述 tool choice。頁面沒有提供足以排序兩份內容的精確更新時間；因此程式依已發布的 Search contract 實作，同時以實際 `web_search_call` fail closed，不能把「模型說有搜尋」當成功。本機 process environment 沒有 `DEEPSEEK_API_KEY`，未要求提供 secret，也未執行 live probe；正式部署仍需手動確認 endpoint 已套用新版 contract。

[V4.1 Flash updates](https://api-docs.deepseek.com/updates/)與[Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/)以 `deepseek-flash` 為 canonical name；`deepseek-v4-flash` 與 `deepseek-v4-flash-vision-exp` 是暫時 compatibility aliases。Responses 文件已列 canonical name，因此本版所有 transport 都送 `deepseek-flash`，不需要 alias mapping；舊名沒有進入 registry、feature layer 或 runtime payload。[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)與[Vision](https://api-docs.deepseek.com/guides/vision/)的現行 HIGH／圖片 contract 保留。

`general_chat` 現在由 provider-neutral AiService 路由到 DeepSeek `/responses`，一律提供 `tools:[{type:"web_search"}]`。普通對話使用 `tool_choice:"auto"`；只有非常明確的上網／搜尋要求才強制 `{type:"web_search"}`，「最近／今天／現在」仍交給模型 auto 判斷。其他 12 個 task 全部維持 `/chat/completions`、thinking enabled／high 與既有 JSON／Vision contract。

`usedWebSearch` 只在 output 真的有 `web_search_call` 時為 true。來源只從 `web_search_call.action.sources`、action URL 或 `output_text.annotations[type=url_citation]` 取得，經 public HTTP(S)／SSRF 驗證、URL 去重後最多 3 個；不從回答文字 regex 猜網址。實際搜尋會把來源獨立放在同一次 LINE Reply 的最後一則；主回答最多占 4 則。Search metadata、raw action、annotations、reasoning 與網頁內容不進 memory、Sheet 或 console。若 provider 未提供可靠 URL，最後一則會誠實說明沒有可列來源。

明確 Search 未產生 `web_search_call`、Responses HTTP／provider failure、timeout、malformed output 或截斷都不會 fallback 到 Chat Completions 或舊知識。AiService 不 retry，DeepSeek server-side continuation 只限單一 request，仍受 webhook absolute deadline 與現行 request timeout 約束。

### Natural quoted-image Vision

1. 私訊直接傳 JPEG/PNG 仍會自動分析；私訊用 LINE Reply 引用圖片後，可直接輸入任意自然問題，不需要 `#小浣` 或「看圖」。
2. 群組／room 單純貼圖與普通引用圖片聊天仍完全靜默；只有引用圖片且文字以 `#小浣` 觸發時才探測並分析。舊 `#小浣 看圖 <問題>` 完整相容。
3. LINE `quotedMessageId` 不提供原訊息型別；自然路由只向固定 Get message content endpoint 安全探測。確定取得 JPEG/PNG 才進 Vision，非圖片／不可取得的自然引用回到普通文字流程；明確舊看圖指令仍顯示既有圖片錯誤提示。
4. 沒有 `quotedMessageId` 絕不猜上一張圖，不新增圖片 cache、配對 Sheet、媒體資料庫或永久保存。圖片 bytes、Base64、data URL、reasoning 仍不進 Sheet、Cache、LINE 或 console；memory 只保存 placeholder、問題與分析文字。
5. Vision 仍走 `image_analysis` Chat Completions。引用圖片要求查證時會先完成可靠圖片判讀，再明示即時網路查證未完成；本版沒有把圖片 raw bytes 再送入 Responses，也沒有加入可能撞上 40 秒同步 deadline 的第二次 HIGH 呼叫。Vision + Search 尚未正式支援。

### Reliability and security fixes

1. `getReaderLayerHostname_()` 先解析完整 authority，拒絕所有 userinfo、IPv6 authority、非法 port、非法 label 與非 canonical numeric host；`isSafePublicUrl()` 擴充 all-127 loopback、localhost suffix、private/link-local/CGNAT/multicast 與 metadata host 防線。拒絕時不把可能含帳密的 raw URL 寫入 console。
2. PTT 與 legacy raw HTML 的直接 UrlFetch 關閉自動 redirect，避免已通過檢查的公開 URL 轉向內網／metadata host。Jina 與 FxTwitter 仍只呼叫固定 provider endpoint。
3. Pending Reply 改由 `deliverPendingReply_()` 在 ScriptLock 內取得資料、呼叫既有 LINE Reply transport，確認 HTTP 2xx 後才 delete。非 2xx／exception 會保留 row，下一次可再交付；程序若在成功送達後、刪除前中斷，可能 at-least-once 重送，但不會 delete-before-send 永久遺失。
4. PendingReplies schema、conversationId isolation、ReplyMode、image pending priority 與既有清理指令均不變。沒有承諾 exactly-once，也沒有新增 distributed transaction 或平行 Queue。

Lock review：保留讀取→LINE→acknowledge 同一 ScriptLock；只把 HTTP 移出鎖會允許同聊天室同時取到同一 pending。沒有導入 claim／lease 狀態，避免中斷後卡住交付。代價是其他聊天室、memory 與 Queue 會競爭全域鎖；持鎖時間包含 Sheet、callback 與 LINE 的 10 秒 request cap，不能宣稱整段最多 10 秒。取鎖失敗會略過本次 pending，row 留待下次；LINE 已送達但刪除失敗可能重送。人工直接改 Sheet 與未取同鎖的 cleanup 不受這把鎖保護，不能視作完整資料庫交易。

### Preserved contracts

同一 webhook batch 仍共用 40 秒 absolute deadline；AI 30 秒 cap、Reader 12 秒 cap、最小 request budget、圖片下載 10 秒、LINE Reply 10 秒與背景 task timeout 均未放大。AiService 不 retry；Search 是單一 Responses request，不建立 client continuation loop。NewsInbox、Weekly Editorial、NewsUrlQueue、WebTaskQueue、Reader priority、PTT/FxTwitter/Jina、JSON validators、Sheet schema、Script Properties、Trigger handlers、compatibility wrappers、Gemini dormant、cleanup 二段確認與 memory/cache contract 保留。

### Migration, deployment and verification

沒有新增 runtime file、Script Property、Sheet migration、setup、Trigger、Web App URL 或外部 service credential；仍只需既有 `DEEPSEEK_API_KEY`。手動同步 `01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`15_DeepSeekProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`，再建立 v1.14.2 Apps Script version 並更新既有 deployment。文件與 test 不部署。

本機 `node tests/v1140_smoke.cjs` 共 59 項通過，未呼叫真實 GAS／LINE／DeepSeek。新增回歸涵蓋 general_chat Responses、auto／forced Search、完整 history、HIGH／token budget、實際 `web_search_call`、來源 metadata 驗證／去重／最多三筆／獨立 bubble／保留第 5 則、fail-closed、memory／reasoning privacy；原有 Natural Vision、舊看圖、沒有 quote 不猜圖、SSRF、Pending Reply、deadline、Reader／Queue 回歸皆通過。離線 mock 證明本地 contract，不證明 DeepSeek production endpoint 已部署同一文件版本。

---

## v1.14.1 Version Boundary

本版是 Codebase Simplification Edition，正式基線為 main 的 v1.14.0（`75decaa`）。現行 source of truth 是目前 Git ref 的實際 `.gs`；本地修改不代表已 merge、發布或部署到 GAS。

### Included

1. `05_Storage.gs` 新增 `appendRowByHeaders_()`，合併 WeeklySummary / NewsInbox 完全相同的表頭對位寫入，保留欄序、未知欄位空白及 0 / false / 空字串。
2. 同步與背景新聞收件以 `Object.assign` 沿用已驗證 analysis，再明確設定來源與狀態；不再逐欄重建相同分析物件，人工補充的獨立預設值保留。
3. WebTaskQueue 直接把 task 交給只讀取所需欄位的 PendingReplies writer，移除不必要的中間投影。
4. AiService 移除保存前重複的 `trimHistory()`；保存端驗證、六輪上限、讀取端驗證與 conversation isolation 保留。
5. URL 安全檢查沿用 Reader hostname parser；NewsUrlQueue error 沿用 `getReaderFailureHttpStatus_()`，顯式 `httpStatus=0` 不退回 200。
6. 移除已被通用 `/status/` regex 涵蓋的 `/i/web/status/` 分支，以及已被 `.twitter.com` 涵蓋的 mobile hostname 比較。PTT title fallback 重用已轉換正文。
7. 移除弱分類檢查中不可能再成立的 `!brief` 分支與其兩個局部變數，以及 category normalizer 中與最終 fallback 相同的 return。
8. 週編輯台潛力 normalization 共用既有 `normalizeTopicPotential_()`；移除只在內部物件複製、從未參與結果的 `sourceIndex`。
9. 延伸既有 `tests/v1140_smoke.cjs`，保留原 39 項並新增 10 項回歸；版本文字與三份版本文件同步。

共採用 13 項局部清理；未刪除任何既有全域函式或常數，389 個既有函式簽名全部保留，新增一個共用 writer。runtime 仍為 21 檔，沒有 rename 或合併檔案。

### Preserved contracts and rejected cleanup

`01_Main.gs` 的 parse / Pending Reply / text / image / command routing 不變。13 個 AI task、deepseek-flash、explicit HIGH、provider-neutral service、Gemini dormant、圖片驗證與隱私、所有 Prompt / JSON business validators、Reader priority / deadline / retry、Sheet headers / 欄序、StoryKey、memory / cache payload、cleanup 二段確認均保留。

保留全部 compatibility wrappers、手動 setup / 診斷入口、`doPost`、`setupLogSheet`、`installWebTaskQueueTrigger`、`processWebTaskQueue`、`processNewsUrlQueue`。`deleteConversationLogs()`、舊 StoryKey grouping / formatting helpers、`isAiErrorRetryable_()` 等 repo 內無 caller 的項目仍可能被外部或 GAS 手動使用，不能只因搜尋不到 caller 就刪除。`formatWeeklyNewsDefaultDigest_()` 依既有文件明確保留。

不同 trust boundary 的驗證、不同規則的 URL / title normalizer、provider adapter、週編輯台 partition / rendered coverage 與 cache revalidation 不強行合併；本版不包含獨立產品 bugfix、新功能、模型、Prompt 改版或架構 redesign。

### Migration, deployment and verification

沒有 Sheet migration、setup、新 Script Property 或 Trigger 變更；`WEEKLY_EDITORIAL_CACHE_VERSION` 仍為 `v1.13.0`。從 v1.14.0 手動同步 `03_ResponseTexts.gs`、`05_Storage.gs`、`10_AiService.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`。同步後仍為 21 個 `.gs`，建立 v1.14.1 Apps Script version 並更新既有 deployment，保留 Web App URL 與既有 Trigger。文件和 tests 不部署。

本機 `node tests/v1140_smoke.cjs` 共 49 項通過，涵蓋 syntax、原 13 routes / 圖片 / privacy / deadline 防線，以及表頭對位、memory 上限、X/PTT、status zero、同步／背景 NewsInbox 入庫、PendingReplies、Queue retry/backoff、分類 defaults、週編輯台 cache / partition / rendered coverage。

未能本機執行 GAS；未呼叫真實 LINE / DeepSeek。部署前依 README 第 10 節測試，特別比對新聞與封存寫入的所有欄位、背景成功／失敗交付、X/PTT 與週編輯台 fallback。runtime 行為相容性的結論來自靜態檢查與 mock regression，仍需維護者完成 live smoke tests。

---

## v1.14.0 Version Boundary（歷史基線）

本版為 DeepSeek Flash Multimodal Edition，基線 v1.13.2。現行 source of truth 是目前 Git ref 的實際 .gs；本地修改不代表已 merge、發布或部署到 GAS。

### Included

1. 正式 model 使用 `deepseek-flash`，internal key 使用 `deepseek_flash`；2026-09-10 對應 DeepSeek V4.1 Flash。舊 `deepseek-v4-flash` alias 不再供 active runtime 使用。
2. 原有 12 個 task 加上 `image_analysis` 共 13 個，全部 thinking enabled / reasoning_effort high。profiles 只保留 `thinking_high`（text）、`thinking_json`（JSON）、`long_extraction_json`（長文 HIGH JSON）；各 route 顯式驗證 thinking/effort，預算詳見 README task 表。
3. 因 reasoning 與最終輸出共用 max_tokens，原 non-thinking task 分別補足預算；既有 HIGH task 不放大。所有舊 task timeout、40 秒共同 webhook deadline、30 秒 AI cap、12 秒 Reader cap、8/20 秒啟動門檻保留。
4. 私訊直接傳 JPEG/PNG 圖；群組貼圖靜默，使用 LINE 原生「回覆圖片」+ `#小浣 看圖 <問題>` 指定。沒有 caption pairing／永久圖片 queue；私訊多圖僅處理 index=1，舊版 LINE 缺有效 index 時提示單張／引用。Pending Reply 優先交付後提示重送看圖指令，問題中的 URL 不作新聞收件。
5. 新增 `07_LineImages.gs`：固定 LINE Get content endpoint、數字 message ID、HTTP 200、MIME／signature、空內容與 raw bytes ≤ 4 MiB 驗證；拒絕 redirect／external content。下載 cap 10 秒，之後 memory／編碼耗時繼續扣原 deadline。
6. AiService content 向後相容字串，只有 user 接受 text/image parts，system／assistant 不接受任何 content array；image 以 mimeType + bytes 表達，最多一張。DeepSeek adapter 才將 bytes 編成 Base64 image_url data URL，完整 JSON body ≤ 8 MiB。Gemini 沒有 image capability，仍 dormant 且不 fallback。
7. 圖片原始資料不進 Sheet、Cache、console 或永久儲存；只保存 placeholder／問題／分析文字。看圖問題在 Sheet logging 前、圖片結果在文字出口移除 data URL／大段編碼。包含 LINE Reply 在內的 HTTP／exception 不輸出外部原始 error body；Reply timeout 設 10 秒，AI 共同 deadline 不變。
8. 新增圖片 prompt、固定繁中錯誤與 help。圖片逾時、過大、格式無法解析、過期、下載／AI 失敗時提示重新傳送，不把原圖送背景 queue。
9. 原 JSON schema／validator、NewsInbox／StoryKey、Reader routing／typed errors、Queue retry／fallback、compatibility wrappers 均保留；`25/35` 僅同步 profile 註解。DeepSeek `aborted` 與 `insufficient_system_resource` 都轉為可重試中斷並保留 finish／usage，不保存半截內容。Weekly Editorial cache contract/version 不變，既有 cache 自然到期後重算使用 HIGH。
10. 版本、README、CURRENT_VERSION 與 changelog 同步；歷史段落仍保留當時的模型／profile 事實。

### Migration and deployment

沒有新增 Script Property、Sheet 欄位、setup／migration、Trigger 或 handler。沿用 LINE_CHANNEL_ACCESS_TOKEN、SPREADSHEET_ID、DEEPSEEK_API_KEY；GEMINI_API_KEY 仍非必要。無 Node runtime、npm dependency、Drive／Cloud Storage、Files API、圖片資料庫、多圖配對或新 provider。

手動同步 `01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、新增 `07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`15_DeepSeekProvider.gs`、`25_WebTaskQueue.gs`、`35_WeeklyEditorialDigest.gs`。完成後 GAS 應有 21 個 .gs，建立 v1.14.0 Apps Script version，更新既有 Web App deployment；URL 與 Trigger handler 維持不變。文件與 tests/v1140_smoke.cjs 不部署。

### Verification and limits

本機 `node tests/v1140_smoke.cjs` 使用內建模組與 mock 服務檢查 syntax、13 routes、HIGH／JSON payload、圖片與純文字路由、privacy、size、expired no-fetch、共同 deadline、Reader retry metadata 與業務 validator。未能本機執行 GAS，未實際呼叫 LINE／DeepSeek；圖片辨識品質與 HIGH latency／length 比例需用 README 的部署 smoke tests 校準。

本地只接收 JPEG/PNG；GIF/WebP 雖為 DeepSeek 官方格式，但本版未啟用。原圖每邊的官方上限為 8192 px，由 DeepSeek 解碼驗證；本地限制 raw bytes，不引入 image decoder。GAS 先緩衝下載，無法在 HTTP 過程提早截流。引用圖片取決於 LINE 尚可提供內容，不保證永久可取；後續文字記憶不代表能重新查看原圖。

官方規格（2026-09-10）：[Model / V4.1 Flash](https://api-docs.deepseek.com/quick_start/pricing/)、[Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)、[Vision](https://api-docs.deepseek.com/guides/vision/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[LINE](https://developers.line.biz/en/reference/messaging-api/nojs/)、[GAS UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)。官方目前明列 thinking 的 temperature／presence_penalty／frequency_penalty 無效，top_p 可用但低於 0.95 會被提升至 0.95；本版仍不送任何 sampling fields。

---

以下舊版 Version Boundary 是歷史沿革；其中的 alias、disabled thinking、舊檔案數量與部署清單描述當時狀態，不可覆蓋上方 v1.14.2 實作。

## v1.13.2 Version Boundary

v1.13.2 是 X Post Weekly Display Edition。Previous stable baseline 是 v1.13.1；本版只改善 `#本週新聞` 對 X / Twitter 單篇 status 的 presentation title，並修正診斷模式因 synthetic X title 產生的假重複。

### Included

1. 建立共同的 weekly-news Display Title helper；真正 X status 優先顯示 `X｜Brief`。
2. Brief 缺失時，只使用 NewsInbox 已保存且有效、非 fallback 的 StoryKey；再依序退回 raw Title 與 `未取得標題`。
3. Weekly Editorial success、AI/API/JSON/validator/cache-invalid fallback、cache hit、高潛力、分類與詳細模式共用同一套 Display Title semantics。
4. 診斷模式仍顯示 raw NewsInbox Title，但真正 X status 不再使用 synthetic Title 進行 title duplicate diagnosis；同 URL 重複仍照常檢查。
5. Display Title 只做 whitespace 正規化與 100 字 presentation 防爆，不寫回 Sheet，也不修改 canonical Brief。
6. 同步 `BOT_CURRENT_VERSION`、內建版本紀錄、README、CURRENT_VERSION 與 changelog。

### Runtime invariants

* X status 判定直接復用 Reader Layer 的 Twitter-like hostname 與 numeric status ID helpers；不依賴 synthetic title pattern。
* Reader priority、FxTwitter endpoint、webResult 與 canonical Reader title contract 不變；`20_ReaderLayer.gs` runtime 不修改。
* NewsInbox headers、欄序、Title / Brief / Outline / StoryKey contract、舊資料與人工補充資料不變。
* Weekly Editorial AI input、Prompt、schema、profile、provider、model、partition validator、排序與 cache payload contract 不變。
* `normalizeNewsTitleForDuplicateCheck_()` contract 不變；X 特規只位於 Diagnostic duplicate decision layer。
* `formatWeeklyNewsDefaultDigest_()` 保持既有 defensive / compatibility 行為；正常 query parser 不會產生可到達該 formatter 的 viewMode。
* `WEEKLY_EDITORIAL_CACHE_VERSION` 維持 `v1.13.0`，因 cache 保存的是模型整理 / partition 結果，最終文字仍由本地 formatter 即時 render。
* LINE command/router、Trigger、Script Properties、新聞問答、封存、統整與 memory bridge contract 不變。

### Migration and deployment

本版不需要 Sheet migration、setup、回填舊資料、重跑 AI、新 Trigger 或新增 Script Properties。既有 NewsInbox row 只要 URL 可辨識為真正 X status 且 Brief 已存在，部署後下一次 `#本週新聞` 就會套用新展示。

本版修改 `.gs` runtime，維護者完成 review 後需手動同步 `03_ResponseTexts.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs` 至 Google Apps Script，再建立新 Apps Script version 並更新既有 Web App deployment。

---

## v1.13.1 Version Boundary

v1.13.1 是 Source Layout & File Ordering Edition。Previous stable baseline 是 v1.13.0；本版只整理 source layout、active 註解、版本顯示與維護文件，不改 runtime 行為。

### Rename mapping

| v1.13.0 active name | v1.13.1 active name |
| --- | --- |
| `12_ResponseTexts.gs` | `03_ResponseTexts.gs` |
| `03_Utils.gs` | `04_Utils.gs` |
| `04_Storage.gs` | `05_Storage.gs` |
| `05_Memory.gs` | `06_Memory.gs` |
| `18_AiService.gs` | `10_AiService.gs` |
| `19_AiProfiles.gs` | `11_AiProfiles.gs` |
| `11_Prompts.gs` | `12_Prompts.gs` |
| `09_DeepSeekService.gs` | `15_DeepSeekProvider.gs` |
| `08_GeminiService.gs` | `16_GeminiProvider.gs` |
| `16_ReaderLayer.gs` | `20_ReaderLayer.gs` |
| `06_WebReader.gs` | `21_WebReader.gs` |
| `07_WebTaskQueue.gs` | `25_WebTaskQueue.gs` |
| `13_NewsInbox.gs` | `30_NewsInbox.gs` |
| `17_WeeklyEditorialDigest.gs` | `35_WeeklyEditorialDigest.gs` |
| `14_TopicHighlights.gs` | `40_TopicHighlights.gs` |
| `10_TopicFeatures.gs` | `45_TopicFeatures.gs` |
| `15_DataCleanup.gs` | `50_DataCleanup.gs` |

`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs` 保持原名。共 20 個 runtime `.gs`、17 個 rename。

### Included

1. 依穩定領域區段重新編號，並保留區段內空號供未來擴充。
2. 將 DeepSeek／Gemini adapter 檔名由 Service 改為 Provider，明確區分 `10_AiService.gs` 與 vendor adapter。
3. 更新 20 個檔頭 self-name、版本、責任、caller/dependency 與重要相容性註解。
4. 更新現行跨檔引用、`BOT_CURRENT_VERSION`、`BOT_CURRENT_VERSION_DATE`、最新 `BOT_VERSION_HISTORY` 與四份 active 文件。
5. 提供 GAS 直接 Rename、部署、驗證與反向 rename rollback 邊界。

### Runtime invariants

* top-level function、Trigger handler 與 global const 名稱不變；只有版本顯示 metadata 值與最新版本紀錄更新。
* Prompt、AI task route/profile/model/thinking/token/timeout/retry metadata、normalized response contract 不變。
* Reader priority、typed error、retry/backoff/deadline、Queue/PendingReplies 行為不變。
* Sheet 名稱、headers、欄序、Script Properties、setup/migration、cleanup 範圍不變。
* LINE 指令、router、reply format、Web App entry 與 Trigger handler 名稱不變。
* `WEEKLY_EDITORIAL_CACHE_VERSION` 維持 `v1.13.0`，因 weekly editorial 資料 contract 未變。

### GAS deployment and rollback boundary

GAS 應在低流量時段直接 Rename 既有 17 個檔案，不得用「新增新檔、稍後刪舊檔」。同時存在新舊檔會造成重複 top-level function／const 宣告，可能讓專案無法載入。Rename 完成後仍須正好有 20 個 `.gs`，且 17 個舊 active 名稱全部消失。

Trigger 綁定函式名稱，不綁定檔名；本版不需重建 Trigger。程式同步與 smoke tests 通過後，建立 v1.13.1 Apps Script version，將既有 Web App deployment 指向新 version，deployment URL 不變。

回滾時先將 Web App deployment 指回先前穩定 Apps Script version；若要回復 source 名稱，依上表右欄 → 左欄直接反向 Rename，最後確認仍是 20 個 `.gs`、主要 handler 與既有 Trigger 綁定完整。Script Properties 與 Sheet 不需回滾。

---

## v1.13.0 Version Boundary

v1.13.0 是 AI Routing & Project Architecture Edition。

本版建立薄的 provider-neutral AI routing，並讓 DeepSeek V4 Flash 接管正常 runtime：

1. 新增 `18_AiService.gs`，統一 task route/profile resolution、memory orchestration、provider dispatch、normalized response、finish reason、空回覆、JSON 基礎檢查與安全 console metadata。
2. 新增 `19_AiProfiles.gs`，集中 provider/model registry、execution profiles、task routes、thinking、reasoning effort、output mode、token、timeout、sampling 與 caller-owned retry metadata。
3. 正常 runtime task 全部使用 `deepseek-v4-flash`；每個 task 都顯式指定 thinking，不依賴 API 預設。
4. `fast_text`、`fast_json`、`long_extraction_json` 均使用 thinking disabled；`thinking_high` 使用官方 `reasoning_effort=high`；`thinking_max` 保留但沒有 runtime task 綁定。
5. DeepSeek thinking enabled 時不送 temperature、top_p、presence_penalty 或 frequency_penalty；JSON task 使用 `response_format={type:"json_object"}` 與合理 `max_tokens`。
6. `news_analysis` 接管 NewsInbox title、brief、outline、分類稽核、StoryKey 等固定 JSON；Prompt/schema/normalizer/audit 仍由 `13_NewsInbox.gs` 負責。
7. `web_lazy_summary` 接管 `#懶人包`；Prompt/schema/normalizer/validator 歸 `07_WebTaskQueue.gs`。
8. `raw_html_extraction` 接管 Jina 失敗後的 legacy raw HTML 正文抽取；Prompt injection 防護、長輸出 contract 與 mainText validator 歸 `06_WebReader.gs`。
9. Reader 優先順序維持 FxTwitter / PTT / Jina / legacy fallback；新 legacy route 為 `legacy_raw_html_ai`，歷史 `legacy_raw_html_gemini` 不 migration 且仍可辨識。
10. 既有 DeepSeek 功能全部改走正式 task：`general_chat`、`news_question`、`program_topic_analysis`、`integrate_topics`、`archive_topics`、`archive_news`、`weekly_editorial_digest`、`manual_news_supplement`、`news_memory_bridge`。
11. `08_GeminiService.gs` 保留 dormant provider transport；正常 runtime 不使用、不是 fallback，只有 route 明確選到 Gemini 時才讀 `GEMINI_API_KEY`。
12. Gemini 重新啟用前必須核對當時最新 API/model/payload；v1.13.0 dormant adapter 不保證未來格式不變，也不支援未經 review 的 thinking route。
13. normalized response 固定提供 `ok/text/json/task/profile/provider/model/finishReason/usage/elapsedMs/errorType/errorMessage/httpStatus/retryable`。
14. usage 可觀察 input/cached/uncached/output/reasoning/total tokens；provider 沒有的欄位為 optional null。
15. typed error 區分 configuration/auth/rate limit/timeout/provider HTTP/empty/invalid JSON/length/validation/unknown；AiService 不 retry，NewsUrlQueue 依 `retryable` 或穩定 errorType 決策。
16. structured AI log 只寫 console metadata，不新增 AI Log Sheet，也不記錄完整 Prompt、聊天、網頁正文、response text 或 API key。
17. 保留既有公開入口與 trigger：`doPost`、`setupLogSheet`、`installWebTaskQueueTrigger`、`processWebTaskQueue`、`processNewsUrlQueue`。
18. 保留一版 `callDeepSeek...`、`callGeminiWeb...` 與 `buildSystemPrompt` compatibility wrapper；正式 runtime 不使用舊 wrapper。
19. `WEEKLY_EDITORIAL_CACHE_VERSION` 更新為 `v1.13.0`，避免舊 normalized cache 混入新 provider contract。
20. 本版不修改任何 Sheet header/欄序、LINE 指令或既有回覆格式；不需要 migration、setup、新 Trigger 或新增 Script Properties。
21. Jina、FxTwitter、PTT 與 legacy Reader failure 會保留 `errorType/retryable/httpStatus` 到 ReaderLayer 與 NewsUrlQueue；configuration/auth/永久 4xx 不重試，408/timeout/429/5xx 才依 typed metadata 重試。成功 webResult 欄位不變，舊 caller 若只讀 `ok/error` 仍相容。
22. 同一個 LINE webhook payload 的所有 events 共用一個 40 秒 absolute deadline；單次同步 AI 最多 30 秒、同步 Reader 最多 12 秒，直接網址會用同一 deadline 扣除 Reader 與前一次 AI 耗時，預算不足即進既有 Queue。
23. profile timeout 是任務最大值，背景 Queue 不傳同步 context 時仍使用完整上限；`retryPolicy` 只供 caller 描述與決策，AiService 不自動 retry。
24. `AI_CALL_METADATA.ok` 只代表 provider transport、finish/content 與 JSON 基礎格式通過，不代表功能 schema/business validator 已完成。

Task/profile 對照：

* `general_chat` → `fast_text` → thinking disabled → text
* `news_analysis` → `fast_json` → thinking disabled → JSON
* `web_lazy_summary` → `fast_json` → thinking disabled → JSON
* `raw_html_extraction` → `long_extraction_json` → thinking disabled → JSON
* `news_question` → `thinking_high` → thinking enabled/high → text
* `program_topic_analysis` → `thinking_high` → thinking enabled/high → text
* `integrate_topics` → `thinking_high` → thinking enabled/high → text
* `archive_topics` / `archive_news` → `fast_json` → thinking disabled → JSON
* `weekly_editorial_digest` → `fast_json` → thinking disabled → JSON
* `manual_news_supplement` → `fast_json` → thinking disabled → JSON
* `news_memory_bridge` → `thinking_high` → thinking enabled/high → text

以上 profile timeout 為任務最大值；所有由 `handleLineEvent()` 同步執行的 AI task 都另受 30 秒單次 cap 與 40 秒 event deadline 約束。`news_memory_bridge` 是輔助脈絡，剩餘少於 20 秒時直接跳過；週編輯台 compact route 與 memory bridge 依現行 query 條件互斥。

Script Properties：正常 runtime 需要 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`。`GEMINI_API_KEY` 只在 dormant Gemini route 被明確選中時需要；本版沒有新增 key。

部署到 Google Apps Script 後，維護者需手動同步本版修改與新增的 `.gs` 檔。

---

## v1.12.5 Version Boundary

v1.12.5 是 Weekly Editorial Digest Edition。

本版把 StoryKey 從 compact 的最終聚合鍵改為「單篇新聞提供的候選事件提示」，並新增一次同步 DeepSeek 週編輯台：

1. `#本週新聞` 與 `#本週新聞 精簡` 只有在 `viewMode=compact`、沒有高潛力 filter、沒有分類 filter 時啟用週編輯台。
2. viewMode 優先順序固定為 `diagnostic > detailed > compact`；高潛力與分類維持獨立 filter。
3. 同一次 `weekly_editorial_digest` DeepSeek JSON 呼叫處理新聞聚類、群組話題提煉，以及群組話題與新聞的重複判斷。
4. DeepSeek 使用專用 direct JSON helper、低溫度、JSON object 格式、thinking disabled、`finish_reason` 驗證；webhook 內不 retry。
5. GAS 為新聞建立 `N001` 類固定 ID，最多送模型 30 則；網址不送模型，最後由原始 NewsInbox item 取回。
6. 至少兩則才成立焦點故事線；不確定或只有單篇的新聞回到其他新聞，並按主要分類精簡顯示。
7. 模型 JSON 採保守部分採納：未知 ID 移除、同陣列去重、跨 cluster 或 cluster / ungrouped 衝突退回其他新聞、漏項由 GAS 補回。
8. validator 完成後的 partition coverage 保證每則原始新聞恰好位於一個故事線或其他新聞；未送模型新聞也必定進入其他新聞。
9. ConversationLog 使用表頭讀取真正最近七天、相同 conversationId、role=user 的資料；從尾端每批 500 列有限掃描，最多 2500 列。
10. GAS 先移除指令、純網址、符號短語、完全重複與單純新聞標題轉貼；「實質評論＋網址」會保留移除網址後的評論。
11. 有效對話最多 60 則、單則 240 字、總長約 6000 字；UserId 轉成本次查詢的匿名代號。
12. 模型/API/JSON/頂層契約失敗時，直接回到已事先建立的分類 compact fallback；錯誤只寫 console log。
13. LINE block fitter 先移除低順位群組話題，再省略完整低順位新聞 block；rendered coverage 與 partition coverage 分開驗證，省略新聞準確顯示「尚有 N 則未顯示」。
14. 既有 `splitTextForLineMessages_(text)` 簽名、回傳型別與行為保持不變；metadata helper 只供週編輯台預演，通用 splitter 僅作最後防線。
15. 通過 validator 的 normalized JSON 使用 10 分鐘 ScriptCache；key 包含版本、conversationId hash 與實際送模型的新聞/對話 hash。
16. 詳細模式不顯示 StoryKey；診斷、`#新聞問答`、`#統整話題` 與 `#封存本週新聞` 仍可使用 StoryKey 候選提示。
17. 聚類結果不回寫 NewsInbox，不建立永久故事線表，不修改舊資料。
18. 本版新增 `17_WeeklyEditorialDigest.gs`，並更新 help、版本文字、README、CURRENT_VERSION 與 changelog。

本版不修改 NewsInbox 或其他 Sheet schema，不需要 migration、setup、Trigger 或新增 Script Properties；不修改 Gemini 單篇新聞分析、Reader Layer、NewsUrlQueue、WebTaskQueue、`#新聞問答` 核心行為、WeeklySummary schema 或封存結構。

部署到 Google Apps Script 後，維護者需手動同步本版修改的 `.gs` 檔。

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
* PTT：GAS 原生 `UrlFetchApp` + `over18=1` cookie，並在現行 `20_ReaderLayer.gs` 內保留 v1.10.6 的 over18 gate 誤判修正。
* X / Twitter 單篇 status：現行 `20_ReaderLayer.gs` 透過 FxTwitter API 讀取。
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

## Explicitly Not Included in v1.13.1

以下項目不屬於 source layout 維護版本：

* 新功能、Prompt 修改或 AI task route/profile/model/provider 改動
* 函式／global const／Trigger handler 改名，或函式跨檔搬移
* 拆分／合併 `05_Storage.gs`、`30_NewsInbox.gs`、`45_TopicFeatures.gs` 或其他 runtime 檔案
* Reader priority/error handling、Queue retry/backoff/deadline/PendingReplies 行為調整
* Sheet schema、欄序、Script Properties、setup、migration 或 cleanup 行為調整
* LINE 指令、router、help 功能內容或 reply format 調整
* compatibility wrapper 移除、新 provider、provider fallback 或新的外部 Reader
* `WEEKLY_EDITORIAL_CACHE_VERSION` 更新

以上應在後續獨立 feature/refactor/hotfix 版本處理。

---

## Explicitly Not Included in v1.13.0 (Previous Version Boundary)

以下功能不是本版內容，不要在讀取本版時誤判為已實作：

* Apify actor 整合
* ByCrawl 整合
* Node.js / npm / 自架伺服器架構
* NewsInbox 或其他 Sheet schema / migration
* 新 Trigger 或新 Script Properties
* 永久故事線資料表或將週編輯台聚類回寫 NewsInbox
* 背景週編輯 queue 或拆成兩次同步模型呼叫
* OpenAI / GPT-5.6 Luna API 串接
* xAI / Grok API 串接
* 新 Gemini 模型啟用或 Gemini 自動 fallback
* 使用者透過 LINE 指令切換模型
* 多模態圖片、PDF、影片分析
* DeepSeek Pro 或其他未確認模型
* 新 AI Log Sheet
* WeeklySummary schema 或封存資料結構調整
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
* 全面重新編號 `.gs` 檔案
* 拆分 `13_NewsInbox.gs` 或 `16_ReaderLayer.gs` 大型檔案
* 自動跨 provider fallback、dependency injection、class hierarchy 或 plugin framework

上述功能若要實作，應另開後續 feature branch。

---

## Google Apps Script Rule

本專案目前不是 Node.js 專案。

請勿預設本專案需要 Node.js、npm、package.json、node_modules、npm install 或 npm start。

除非維護者明確表示要導入 `clasp` 或將專案改為本機 / 自架伺服器執行，否則請一律視為 Google Apps Script 專案。

GitHub 只作為版本管理來源。正式部署到 Google Apps Script 由維護者手動處理。

數字檔號不是 runtime load order。GAS 同一專案的 `.gs` 共享全域命名空間；初始化必須由明確函式入口執行，不得依賴 top-level executable side effect 或檔案排序。

v1.13.1 rollout 必須直接 Rename 既有檔案，不可新增新檔後暫時保留舊檔。完成後建立新 Apps Script version，讓既有 Web App deployment 指向新 version；Trigger handler 與 deployment URL 均維持不變。

---

## Historical Smoke Tests for v1.13.2 X Post Weekly Display

以下保留 v1.13.2 當時的檢查紀錄；v1.14.2 部署請以本文件上方及 README 第 10 節為準，尤其是 21 檔與全部 HIGH。

本版只修改週新聞 presentation 與 Diagnostic title duplicate decision，不修改 Sheet、Reader、AI、cache payload、router 或 Trigger contract，也不需要 migration、setup、新 Trigger 或新增 Script Properties。

部署前先確認 GAS 正好有 20 個 `.gs`，並手動同步 `03_ResponseTexts.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`；函式選單與 Trigger 仍應保留原 handler。

將本版修改的 `.gs` 檔手動同步至 Apps Script 後，在 LINE 測試：

* `#版本`、`#版本紀錄`、`#help`。
* 準備一般網站 Title 與不同 Brief，確認所有週新聞 presentation 仍顯示 Title，不改成 Brief。
* 準備 `x.com`、`twitter.com`、`mobile.twitter.com`、`fxtwitter.com`、`fixupx.com` 的有效 `/status/{numeric id}` 舊資料，確認 Brief 存在時顯示 `X｜Brief`，且 whitespace / newline 會收斂、異常長文字會安全裁切。
* 準備 X status 缺 Brief 的資料，確認依有效既有 StoryKey → raw Title → `未取得標題` 回退，不會顯示空的 `X｜`。
* 準備 X 個人頁、搜尋頁、list、無有效 numeric status ID，以及一般網站的 `/status/`，確認都不套 X Display Title。
* 在 Weekly Editorial success、模型失敗 fallback、cache hit、高潛力、分類與詳細模式確認 X 使用同一套 Display Title；診斷畫面仍顯示 raw Title。
* 準備同帳號、相同 synthetic Title、不同 status URL 的兩筆 X 資料，確認不報 title duplicate；完全相同 status URL 仍報同 URL 重複；一般新聞相同 Title 仍照常診斷。
* 準備多筆長 X Brief，確認 formatter 的實際 block 長度會進入既有 LINE fitter，protected block、最多 5 則 message、單則長度、omission count 與 rendered coverage 都保持正確。
* 在私訊與群組 `#小浣` 進行至少兩輪一般聊天，確認 general_chat 為 non-thinking，且短期/長期記憶仍可接續。
* 群組直接貼一個一般新聞網址，確認群組不會收到 Brief 回覆。
* 確認該網址進入 NewsUrlQueue，背景 trigger 處理後寫入 NewsInbox。
* 個人聊天室直接貼一個一般新聞網址，確認仍可同步回覆自然 Brief 並寫入 NewsInbox。
* 模擬 Reader 已耗時、Jina 失敗後先做 legacy extraction，以及剩餘 AI 預算不足，確認直接網址改進既有 NewsUrlQueue，不等待完整 profile timeout。
* PTT 文章、X / Twitter 單篇 status、Facebook / Threads 公開網址。
* 準備一個 Jina 成功網址，確認不呼叫 raw_html_extraction；再模擬 Jina 失敗，確認依序進入 `legacy_raw_html_ai` 且正文 validator 生效。
* 一次貼兩個以上網址，確認多筆靜默進 NewsUrlQueue。
* Reader 失敗、登入牆或不支援網址，確認 PendingReplies 會在下次訊息交付錯誤。
* 已有 Pending Reply 時再貼新網址，確認先交付舊結果，新網址仍靜默進背景 queue。
* 執行 `#狀態回報`，確認顯示最近 7 天收件、入庫、佇列與失敗統計。
* 執行 `#本週新聞` 與 `#本週新聞 精簡`，確認啟用一次週編輯台；多篇同事件合併、同實體不同事件不合併、全部單篇時不顯示焦點故事線。
* 測試漏 ID、同 cluster 重複、跨 cluster 重複、未知 ID、cluster / ungrouped 衝突、空標題與單篇 cluster，確認 partition coverage 仍讓每則原始新聞恰好位於一處。
* 測試 ConversationLog 指令、純網址、短回覆、重複與標題轉貼排除；「評論＋網址」要保留評論，沒有有效對話時不顯示群組話題。
* 測試 DeepSeek 非 2xx、空回覆、非法 JSON、缺欄、截斷 JSON 與 `finish_reason=length`，確認 typed error、Queue retry/fallback 與資料保護符合 task 規則。
* 模擬缺 `DEEPSEEK_API_KEY`、401/403、400、timeout、429、5xx，確認 legacy Reader 到 NewsUrlQueue 的 `errorType/retryable/httpStatus` 不遺失，且永久錯誤不重試。
* 確認 X / Twitter 非 `/status/{id}` 網址即使繞過入隊前檢查，也不會進入 Queue retry。
* 新聞超過 30 則時，確認分類保留、潛力/StoryKey/時間選取規則可重現，未送模型新聞仍進其他新聞。
* 對話超過 60 則或 6000 字時，確認裁切與匿名代號正確。
* 準備超長輸出，確認先減少群組話題、再省略完整低順位新聞 block；保留 URL 不被切開，rendered 與 omitted 不重複，省略數準確。
* 相同查詢確認 10 分鐘 cache hit；新增新聞或有效對話後確認 cache miss。
* 執行高潛力、分類、詳細與診斷，確認不啟用週編輯台；詳細不顯示 StoryKey，診斷保留。
* 測試診斷、詳細與精簡同時出現，確認 `diagnostic > detailed > compact`。
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
* 執行 `#統整話題`，確認 AI task 會收到 NewsInbox Outline。
* 準備一筆沒有 Outline 的舊 NewsInbox 資料，確認 `#統整話題` 會退回 Brief。
* 執行 `#畫重點`，確認 TopicHighlights 可寫入，後續統整仍可讀取。
* 對任一清理指令只執行第一階段，確認顯示影響範圍與二段式警告；不要輸入「確認」。
* 回歸 `#懶人包`、網址版 `#節目話題分析`、`#新聞補充`、`#版本`、`#版本紀錄`。
* 在 GAS 手動執行 `processWebTaskQueue` / `processNewsUrlQueue`，並確認既有 time-driven trigger handler 名稱未改變。
* 等待下一輪 Queue Trigger，確認排程可正常再執行且沒有 duplicate function／const 載入錯誤。
* 移除 `GEMINI_API_KEY` 後回歸全部正常功能，確認 Gemini dormant provider 不影響啟動或 runtime。
* 對照部署前快照，確認所有 Sheet headers、欄序與 Script Properties 名稱／值均未變。
* 檢查 `AI_CALL_METADATA` 包含 task/provider/model/profile/thinking/reasoning effort/token/finish reason/errorType/resultScope/businessValidation；thinking_high 成功時確認 reasoning tokens 可觀察，且 log 不含完整 Prompt、聊天、正文、response text 或 secret。

本版修改了 `.gs` runtime，因此需要由維護者手動同步至 Google Apps Script。

---

## Last Confirmed

Last Confirmed Version at this Git ref: `v1.14.2 Natural Search & Vision Edition`
Previous stable baseline described in this file: `v1.14.1 Codebase Simplification Edition`
Last Confirmed Date: `2026-09-12`
Last Documentation Note: general_chat Responses Web Search is implemented with actual-call verification and 59 local mock checks. Official reference/index and direct guide content still differ; manual GAS deployment and a live Search smoke test are required.
