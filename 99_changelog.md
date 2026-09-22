2026-09-23
v1.15.4 Context & Semantic Memory Edition
- 以前一正式版本 v1.15.3 為 lineage；新增圖片衍生文字記憶、context 成本量測與有證據的局部優化，修正 generic Reader 正文關鍵字誤判。Git 版本與 GAS deployment 由維護者分別確認。
- 私訊直接圖、自然引用與群組明確引用的已分析圖片沿用同一次 Vision inference 取得可選語意 sidecar；AiService 將隱藏摘要從主回答拆出，sidecar 缺失不影響正常回答。群組直接貼圖維持不回 LINE；每聊天室使用 15 分鐘 best-effort 限頻嘗試 non-thinking 短 caption，6 秒下載／8 秒模型 cap，無持久圖片 Queue。
- ConversationLog 沿用既有欄位，以 Role=derived、Mode=image_semantic、明確 prefix 及最多240字文字表示圖片辨識。圖片與衍生列的 MessageId 留空；清理移除 data URL、長編碼、URL、電子郵件、長識別碼及常見憑證值。不保存原圖、Base64、image cache 或永久圖片配對。
- search_conversation_log 可在同聊天室近期有界視窗查 user_text 與 image_derived，回傳 provenance；圖片回顧意圖可限定 derived。Prompt 將圖片摘要當不可信 evidence，不能說成使用者親口內容或當成新聞事實。#封存本週話題仍只收 user 文字；#清空紀錄按 conversationId 清除所有角色並清短期 Cache。
- 一般聊天與圖片 memory task 按問題預載 WeeklySummary，明確封存問題沿用 required tool 讀一次；短期 history 六輪維持。相同 user 文字若已在短期 history，required ConversationLog evidence 只留時間／provenance／引用標記。固定 system／tool 規則排在動態週記憶與 evidence 前，有利 DeepSeek 自動 prefix cache；不宣稱未量到的實際 hit rate。
- 安全 AI_CALL_METADATA 新增 modelCalls、requiredEvidenceReads、clientToolCalls、continuationCount、contextTextChars、toolDefinitionChars，與既有 usage／elapsed／Search metadata 一起供比較；不記 Prompt、圖片摘要、tool data、thinking 或 URL 正文。正式聊天／Search／複雜 JSON 維持 HIGH，Search max_uses=3 不變；只有群組短 caption 使用 non-thinking。
- generic Jina／legacy extraction 以 title 或短頁頁首辨識 challenge／Access Denied／JS required；正常文章正文提到 Cloudflare、403 Forbidden 等不再直接失敗。PTT v1.15.2／v1.15.3 路由、結構、一次 Jina、404／410、noAi、deadline、安全與隱私契約保留。
- 本機 `node tests/v1140_smoke.cjs` 擴充圖片語意、搜尋來源、群組靜默、清理／封存、context fixture、generic Reader 與 PTT 回歸。沒有新 runtime file、Sheet schema／migration、Trigger、Script Property、外部 DB、vector search 或 Node runtime dependency。真實 GAS／LINE／DeepSeek 行為仍需維護者部署後驗證。

2026-09-22
v1.15.3 Reader False Positive Hotfix
- 唯一 baseline 為 GitHub main / v1.15.2 merge commit 91c4f26cc758e70876ee5f3388c5667c70f968f8。維護者 production smoke：C_Chat HTTP 樣本成功，Stock 樣本 direct／Jina 均 HTTP200 後 ptt_empty_content。
- 根因為已驗證 PTT article 仍套 generic 全文 badSignals，正常正文提及 Cloudflare 即失敗。PTT parser 改為結構驗證、清除 metadata／push／footer 後只要求 trim 正文非空；同時修正 Access Denied、403 Forbidden、Just a moment、Enable JavaScript 等正文誤判。
- 保留 URL／redirect／over18／未知頁面／空正文保護、最多一次 Jina、noAi、absolute deadline 與隱私契約；一般 Reader detector 未修改，其全文關鍵字 false-positive 風險列 deferred。
- 補 deterministic regression 與部署後 smoke 清單。無 Sheet migration、Trigger、新 Script Property、provider、Prompt 或 AI routing 變更；GAS 驗收仍由維護者執行。

2026-09-22
v1.15.2 PTT Reader Resilience Hotfix
- 以 v1.15.1 / main merge 795072b32ca09c450130eb7ae506d8e4872bbcdc 為 baseline；classic PTT article 限可信 host/path，HTTP 與裸網域先正規化為 https://www.ptt.cc，不自動跟隨 redirect。
- direct 與既有 Jina fallback 共用 main-content／article-meta 結構驗證，按 div 深度抽取正文；不以導覽、metadata、推文或錯誤頁墊高正文長度，不把未知 200 頁面推定為刪文。
- 合適失敗最多一次 Jina，使用既有 Reader 的 X-Set-Cookie 與 HTML 回傳模式；404／410 不 fallback。沿用 typed retry／httpStatus=0、absolute deadline 與 noAi，無 legacy AI extraction 或 retry loop。
- 安全診斷只含狀態、分類、route、fallback 與長度；不記 HTML、正文、cookie 或原始 exception。補 deterministic tests 與 production smoke checklist，GAS／LINE 仍待部署後驗收。
- Sheet schema／migration／Trigger／新 Script Property／新 provider／新 AI capability 均 none。Context & Cost Optimization 延後，未混入本版。

2026-09-16
v1.15.1 Mixed Tool Continuation Hotfix
- 以 v1.15.0 Unified Research & Capability Edition / 30353cb99d73f4fff9af26e5742b0ee4b75c73d5 為 baseline，修正 Anthropic-compatible server Search 與 client tools 混用時，首輪尚未收到 Search result 就提前 ai_web_search_failed 的 regression。
- 僅在合法 client tool_use 與 stop_reason=tool_use 時允許 pending web_search；provider closure 私有追蹤跨回合 use/result ID，收到匹配且成功的 result 才標 usedWebSearch。缺結果、重複／錯配 ID、Search error、malformed block 與 protocol markup 仍 fail closed。
- Continuation 保留相同 tools、完整 assistant content／thinking，user 只回 client tool_result；有 pending Search 時採 auto，不再次強制 Search；沒有 pending 時維持 none。第二輪新 client tool_use 回 ai_tool_round_limit，server Search 完成不新增 client round。
- 維護者最新 production evidence：文字 Search、普通 Vision、image Search 成功；加上聊過／收過要求時仍未取得內部 evidence。確認 availability 不等於 execution，且缺少 ConversationLog research；既有 deadline corrective pass 保留，沒有因此更換 Search transport。
- 圖片依當次問題縮小 client tools：新聞、對話、週記憶、人工重點、URL 分別選擇，模糊舊資料比對保留三種內部來源；純 Search 不附 client tools。AiService 驗證選擇只能縮小 route／scope allowlist；無工具時移除 clientTools request capability。文字聊天保留可選工具模式。
- 首輪不再為尚未發生的工具續接預扣10秒，共用原30秒 orchestration／40秒 webhook deadline；真的要求工具才檢查讀取前9秒、final前8秒餘裕，晚到工具可能無法續接。沒有新增 model round、planner 或 Queue。
- 圖片只有 ai_web_search_failed 使用 Search-specific 文案；ai_timeout 使用看圖逾時，其餘 AI failure 用一般服務文案。Prompt 依實際 tools 說明可用性，圖片 Search 即使不提供 client tools 仍保留網站／搜尋 evidence 信任與原文隱私邊界。
- Required Internal Evidence：文字／圖片共用明確資料 intent，GAS 在首輪前只讀預查指定來源；模型可選一次精查，但不能跳過 required source 後冒充完整成功。NOT_SEARCHED、SEARCHED_EMPTY、SEARCHED_FOUND、FAILED 分開；Web 僅在正式 Search metadata 完成時標 COMPLETED。執行摘要沒有原始資料。
- 新增 search_conversation_log，重用 scope／header reader；限目前 trusted conversation、尾端500列／最多30天／10筆、每筆800字元與每份6000序列化字元，排除 assistant、當次 MessageId 與當次或未來時間。NewsInbox／重點預查也有界；封存使用既有 read-only reader，非空表缺必要 schema 不冒充空結果。
- 明確 URL 在首輪前讀取並避免第二次 URL；圖內未知 URL 先 Vision 再於一次 continuation 讀取，最終缺 evidence 仍失敗。自然提問讀內容走只讀，純貼網址保留收件。required failure 的文字／圖片 UX 明說未完成，不說沒找到；prefetch 仍消耗同一30秒 window。
- Responses Structured Output、Search transport、SSRF、Pending Reply、source bubble 與 Gemini dormant 狀態不變。Raw state／thinking／query／tool result 不進 feature、memory、Sheet、PendingReplies、LINE 或 raw log；只有最終回答與安全執行 metadata 可輸出。
- 本機 node tests/v1140_smoke.cjs：23 sources、420 unique functions、138 checks PASS；保留既有115項回歸，新增 required execution／empty／found、雙 sentinel 的文字／圖片與私訊／群組、跨 scope、當次提問排除、bounded reader、privacy／injection／deadline。未能本機執行 GAS，新增 evidence 行為仍需部署後 live smoke。
- 從 v1.15.0 升級至少同步 01_Main.gs、03_ResponseTexts.gs、05_Storage.gs、07_LineImages.gs、10_AiService.gs、12_Prompts.gs、14_AiTools.gs、15_DeepSeekProvider.gs；已部署先前 v1.15.1 也需核對完整8檔。Markdown／tests 不部署。Sheet migration、Trigger change、新 Script Property 均 none。Git merge 不等於 GAS deployment。
- Context & Cost Optimization 順延為 v1.15.2。

// ==================================================
2026-09-15
v1.15.0 Unified Research & Capability Edition
- 以 v1.14.4 / 4ab76565a13c78c9ccbd5bf9d2bcc80152db7f58 為 baseline，整合 Structured Output / Tools 與 Multimodal Research；本地完成／Git merge 不等於 GAS deployment。
- Capability-driven route/model registry 公告 text、thinking、vision、structuredOutput、webSearch、clientTools；adapter 決定 transport，未知／不支援組合在 HTTP 前 ai_configuration_error。舊 runAi* 入口與 compatibility wrappers 保留。
- 新增 13_AiSchemas.gs，news_analysis、web_lazy_summary、archive_topics、archive_news、weekly_editorial_digest、manual_news_supplement 使用 Responses text.format json_schema。重用既有 schema builder，保留分類、StoryKey、partition、coverage、cache、非空摘要與業務 validators；新聞／快讀 schema failure 保留 retryable。raw_html_extraction 明確保留 28k legacy JSON，待長文 live corpus 驗證。
- 新增 14_AiTools.gs，提供 search_news_inbox、get_topic_highlights、get_weekly_memory、read_url。模型 args 不含 conversationId，trusted service 注入 scope；整批先驗證名稱、JSON、ID、型別、enum、days、limit、URL。最多4 calls、1 URL、1 continuation，每份 serialized tool data 最多6000字元，回傳有限視窗標示。
- 只讀 Sheet 路徑禁止 ensureSheet／建表／補欄；WeeklySummary 重用既有 formatter 並增加相容的 readOnly 參數。NewsInbox／Highlights 讀取既有欄位並投影 compact records，不新增任何永久資料。
- read_url 沿用 Reader／SSRF trust boundary，noAi 模式下 Jina 失敗不進 legacy AI extraction；工具模式關閉 Jina／FxTwitter HTTP 自動 redirect。其他 Reader、Queue、httpStatus=0 與 retry 契約保留。
- general_chat 提供 auto Web Search 與只讀 tools；明確搜尋強制 server Search。multimodal_research 原生結合 image、Search、client tools；普通圖片仍走 Chat Completions，不因「圖片重點／這是真的嗎」就強制研究。自然引用、群組 quiet、舊看圖指令、多圖與 Pending 優先序保留；網址比對問題不轉收件，已有 Pending 時提示重問，普通網址仍收件。
- Opaque continuation 使用 provider-private closure，暫存完整 assistant thinking／tool turn；service 只處理 generic calls/results。最多一次續接，最後 request 停用工具並移除 server Search definition；同一最多30秒 orchestration 受40秒 webhook deadline約束，首輪預留final與資料時間，late response不保存。
- usedWebSearch 只認正式一對一且非錯誤 server metadata；sources 合併已執行 Search／NewsInbox／Reader 的安全URL，去重最多3筆，維持LINE 4+1 bubble，不從final text猜來源。raw tool args/results、query、thinking、圖片編碼、raw provider body與closure不進Sheet／Cache／PendingReplies／log。
- 移除 dead Responses Web Search payload／web_search_call成功判定／舊source collector；Responses保留並成為active structured transport。所有文字出口保留media redaction，provider protocol guard與不可信停止原因防洩漏補強。
- Gemini保持dormant；新能力明確fail-fast並遮蔽錯誤原文，不啟用production、無新credential或自動fallback。未來需重新review當時Interactions API。
- README改為現況／用法／架構／setup優先，後段按v1.x摘要；changelog沒有v1.8紀錄，明示而不補造。CURRENT_VERSION記錄完整契約、限制與live checklist；AGENTS補導航與只讀工具規則；#版本更新、#版本紀錄仍限6筆、help補研究用法。
- 本機 node tests/v1140_smoke.cjs：23 sources、417 unique functions、97 checks PASS。保留v1.14.4 production句型fixture與所有既有回歸；新增schema、capability、tools、scope、deadline、privacy、multimodal與source checks。未能本機執行GAS，沒有真實LINE／DeepSeek／Sheet呼叫；新API組合與latency需部署後live smoke。
- Sheet schema/migration、Trigger change、新Script Property、setup requirement均none。沒有新Queue、外部Search provider、backend、runtime dependency。手動同步檔案與回復流程見CURRENT_VERSION.md。

// ==================================================
2026-09-13
v1.14.4 Search Transport Correction Hotfix
- Production capability probe 證實 DeepSeek `/responses` 接受 Web Search request 卻未產生 server-side execution；`general_chat` 改走實際回傳 `server_tool_use`／`web_search_tool_result` 的 DeepSeek Anthropic-compatible `/messages`。
- 沿用同一 `DEEPSEEK_API_KEY`、`deepseek-flash`、HIGH 與 4,800 token budget；Anthropic payload 使用 `thinking:{type:"enabled"}`、`output_config:{effort:"high"}`、auto／forced `tool_choice`，Search 固定 `max_uses:3`。
- `usedWebSearch` 只認成對且非錯誤的正式 server tool execution；來源只取 `web_search_result` title／URL，沿用 public HTTP(S)／SSRF 驗證、去重、最多三筆與既有 LINE source bubble。
- 最終回答只取 text block；thinking、tool use、raw result、query、encrypted content、citation text 與 provider body 不進 LINE、memory、Sheet、PendingReplies 或原文 log。v1.14.3 DSML fail-closed 與舊 Responses compatibility parser 保留。
- 其他 12 個 task 與 `image_analysis` 仍走 Chat Completions；Natural Vision、Vision + Search 延後、SSRF、Pending Reply、deadline、Gemini、Sheet、Trigger、Properties 不變。無新 Queue、Search provider、runtime file 或 dependency；本機 62 項 smoke 通過。

// ==================================================

2026-09-13
v1.14.3 Search Reliability Hotfix
- 補強 explicit Search intent：「幫我查／請幫我查／麻煩幫我查／幫我搜尋」會強制 `{type:"web_search"}`；單純「最近／今天／現在／最新」仍由 `tool_choice:auto` 判斷。
- DeepSeek Responses `output_text` 若出現明確 DSML／invoke／tool protocol tag，會在 provider normalization 邊界 fail closed；Search markup 使用 `ai_web_search_failed`，其他 internal protocol 使用 `ai_invalid_provider_response`。
- `usedWebSearch` 仍只認正式 `web_search_call`；正常回答、最多三個來源 bubble、其他 12 個 Chat Completions task 與 Natural Vision contract 不變。
- raw provider markup 不進 LINE、ConversationLog、memory、PendingReplies、Sheet 或原文 log；本機 61 項 smoke 涵蓋 production fixture、auto／required leakage 與一般文字不誤殺。
- 不改 Search architecture、Vision + Search、SSRF、Pending Reply、deadline、Sheet、Trigger 或 Script Properties；無新 Queue、外部 Search API、runtime file 或 dependency。

// ==================================================

2026-09-12
v1.14.2 Natural Search & Vision Edition（final corrective pass）
- 本專案統一稱為 DeepSeek Flash，registry、Responses 與 Chat Completions 的 API model 均維持 `deepseek-flash`；舊文件或 compatibility alias 不作模型世代判定。
- 修正 `#help` 的 Natural Vision 文案；明確搜尋或 `ai_web_search_failed` 才顯示 Search-specific 錯誤，普通 auto 對話的 HTTP／auth／timeout／generic provider failure 改用一般 AI 服務錯誤。
- 現行 Responses reference／guide 明確支援 server-side `web_search`、auto／forced tool choice 與 `web_search_call`；本版仍只以實際 call 判定搜尋成功。
- 本機 60 項 smoke 全過；未新增 runtime file、Script Property、Sheet migration 或 Trigger，也未呼叫真實 GAS／LINE／DeepSeek。

// ==================================================

2026-09-12
v1.14.2 Natural Search & Vision Edition（Search contract correction）
- 撤回前一輪「Responses 不執行 Web Search」的主流程判定：general_chat 改走 `/responses`，提供 server-side `web_search`；一般對話 `tool_choice=auto`，明確上網／搜尋要求強制 `{type:"web_search"}`。
- Search 僅以 response output 的實際 `web_search_call` 判定；forced Search 沒有 call、provider failure、timeout、malformed output 或截斷均誠實失敗，不 fallback 到 Chat Completions 或舊知識。
- 來源只接受 `web_search_call.action` 或 `output_text` 的 `url_citation` metadata，經 public HTTP(S)／SSRF 驗證、URL 去重後最多 3 個；Search 發生時保留 LINE 第 5 則為獨立來源 bubble，沒有可靠 URL 時不捏造。
- Responses 完整送入 system、WeeklySummary memory、trimmed user／assistant history 與當次訊息，使用 `reasoning.effort=high` 與原 max output budget；raw Search、annotation、reasoning 與來源頁面不進 memory／Sheet／console。
- 本專案所有現行 transport 的 API model 均維持 `deepseek-flash`；舊文件或 compatibility alias 不作模型世代判定。除 general_chat 外的 12 個 task 仍走 Chat Completions + HIGH。
- Vision 仍走既有 Chat Completions `image_analysis`；不硬塞 Responses、不增加第二次 HIGH 同步 call。Natural Vision、舊 #小浣 看圖、群組 quiet、沒有 quote 不猜圖全部保留。
- URL／SSRF 與 Pending Reply acknowledge-after-send 回歸通過。Pending delivery 保留 global ScriptLock，以避免無 claim／lease 時的並行重送競態；代價是 LINE HTTP 最長約 10 秒期間會競爭全域鎖。
- 現行 Responses reference／guide 明確支援 server-side Search、auto／forced tool choice 與 `web_search_call`；本版以實際 call fail closed。
- 仍為 21 個 runtime source；無新 Script Property、Sheet migration、Trigger、外部 Search API、Search Queue、Agent framework 或圖片 persistence。本機 smoke 59 項通過，未呼叫真實 GAS／LINE／DeepSeek。

// ==================================================

2026-09-11
v1.14.2 Natural Search & Vision Edition
- 現行 Responses API reference 明確支援 server-side Web Search；一般聊天使用 auto，明確搜尋可強制執行，實際完成仍以 `web_search_call` 判定，版本名稱不變。
- 搜尋失敗維持誠實文案；圖片查證仍明示「圖片已分析，但即時網路查證未完成」。Pending 真實 transport mock failure／取鎖競爭／acknowledge failure 回歸保留，global lock tradeoff 不變。
- 私訊引用圖片可直接自然提問；群組／room 只有「引用圖片 + #小浣」才分析，普通貼圖／引用保持靜默，舊 #小浣 看圖 相容，沒有 quote 不猜上一張圖。
- 本專案現行模型統一稱為 DeepSeek Flash，API model 使用 `deepseek-flash`；Responses Search 只以實際 `web_search_call` 判定，不偽造 usedWebSearch／來源。
- getReaderLayerHostname_ 拒絕 userinfo、IPv6 authority、非法 port／numeric host；isSafePublicUrl 擴充 loopback／private／link-local／metadata 防線，PTT 與 legacy direct UrlFetch 不跟隨未驗證 redirect。
- Pending Reply 改為 LINE Reply 2xx 後才刪除；非 2xx／exception 保留供下次重試。以 at-least-not-lost 為目標，既有 schema、ReplyMode、conversation isolation 與 image pending 優先序不變。
- 13 個 AI routes 全部維持 Chat Completions、deepseek-flash、thinking enabled/high；webhook deadline、圖片隱私、Reader／Queue、NewsInbox、Weekly Editorial、Sheet／Trigger／Properties contract 保留。
- 仍為 21 個 runtime source；無新 Script Property、Sheet migration、Trigger、Web App URL、外部 credential 或圖片 persistence。手動同步本版九個 .gs；本機 smoke 54 項通過，未呼叫真實 GAS／LINE／DeepSeek。

// ==================================================

2026-09-11
v1.14.1 Codebase Simplification Edition
- 合併 NewsInbox / WeeklySummary 表頭對位寫入；同步與背景新聞重用已驗證 analysis，保留所有來源、狀態與分類稽核欄位。
- URL 安全檢查與 Queue error 重用 Reader hostname / HTTP status helper；顯式 httpStatus=0、Reader priority、retry/backoff/deadline 均不變。
- 移除已被涵蓋的 X status / mobile hostname 判斷、不可達弱分類分支、相同 category fallback、週編輯台未使用 sourceIndex；PTT 重用已轉換正文。
- WebTaskQueue 移除 PendingReplies 前的 task 投影；memory 由保存端統一修剪；週編輯台共用既有新聞潛力 normalizer。
- 13 項局部精簡；未刪除既有函式或全域常數，保留所有 compatibility / manual / Trigger contract、Gemini dormant、DeepSeek Flash + HIGH、圖片驗證與產品行為。
- 仍為 21 個 runtime source；無 Sheet schema / migration、Script Property、Trigger、Prompt 或新功能變更。手動同步本版八個 .gs；本機 smoke 由 39 項擴充至 49 項，未呼叫真實 GAS / LINE / DeepSeek。

// ==================================================

2026-09-10
v1.14.0 DeepSeek Flash Multimodal Edition
- 正式模型改為 deepseek-flash（當日對應 DeepSeek V4.1 Flash），registry key 改為 deepseek_flash；active runtime 不再依賴舊世代 alias。
- 原有 12 個 task 與新增 image_analysis 全部 thinking enabled / reasoning_effort high；合併 fast_text、更名 fast_json、移除未使用 thinking_max，依 task 補足 reasoning + visible output 預算。
- LINE 私訊直接傳圖片；群組保持貼圖靜默，回覆圖片輸入 #小浣 看圖 <問題> 才分析。使用原生 quotedMessageId / Get content，不建立 pairing 或永久圖片 queue。
- 新增 07_LineImages.gs；僅單張 JPEG/PNG、raw 4 MiB、完整 AI body 8 MiB，驗證 ID/status/MIME/signature/bytes。下載最多 10 秒，並保留共同 webhook deadline 與既有網址 Queue fallback。
- AiService 擴充 provider-neutral text/image bytes contract，DeepSeek adapter 才組 image_url / Base64；原圖不保存，memory / Sheet 只留 placeholder 與文字分析，錯誤 body 不外傳。
- 新增圖片 prompt、繁中 fallback、help、版本文件與不連網的本機 smoke check；Gemini 仍 dormant。無新 Script Property、Trigger、Sheet schema、setup/migration 或 Node runtime。
- 手動同步本版十個 .gs（含新增 07）；GAS 共 21 個 runtime source。25_WebTaskQueue / 35_WeeklyEditorialDigest 只同步 profile 註解；歷史內容保留。

// ==================================================

2026-08-12
v1.13.2 X Post Weekly Display Edition
- `#本週新聞` 對真正 X / Twitter 單篇 status 使用 presentation-only Display Title，優先顯示 `X｜Brief`，再依有效既有 StoryKey、raw Title 與既有標題 fallback 回退；一般新聞維持 raw Title。
- Display Title 與 Diagnostic 共用 Reader Layer 的 Twitter-like hostname + numeric status ID 判定；不以 synthetic title pattern 猜測 X status。
- Weekly Editorial success、fallback、cache hit、高潛力、分類與詳細模式共用 Display Title；診斷模式仍顯示 raw NewsInbox Title。
- 修正同帳號不同 X status 因 synthetic Title 相同而被誤報標題重複；同 URL 重複與一般新聞 Title duplicate 診斷保持不變。
- NewsInbox Title / Brief / Outline / StoryKey、Sheet schema、AI、Reader、排序、新聞問答與封存 contract 均不變，不需要 migration 或回填。
- `normalizeNewsTitleForDuplicateCheck_()` 與 `WEEKLY_EDITORIAL_CACHE_VERSION = 'v1.13.0'` 均維持不變。

// ==================================================

2026-08-07
v1.13.1 Source Layout & File Ordering Edition
- 將 20 個 GAS runtime `.gs` 依穩定領域區段排列：00–09 Core／LINE／Shared、10–19 AI、20–29 Reader／Web／Jobs、30–39 News／Editorial、40–49 Topic／Material、50–59 Data operations；區段內保留空號，60–89 保留給未來新領域。
- 完成 17 個純 rename；`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs` 保持原名。檔號只供人類／AI 導航與 GAS 平面排序，不代表 runtime load order。
- Provider adapter 檔名由 Service 改為 Provider，明確區分正式 `10_AiService.gs` 與 vendor adapter；既有 provider function 與 compatibility wrapper 名稱不變。
- 完整 mapping：`12_ResponseTexts.gs` → `03_ResponseTexts.gs`、`03_Utils.gs` → `04_Utils.gs`、`04_Storage.gs` → `05_Storage.gs`、`05_Memory.gs` → `06_Memory.gs`、`18_AiService.gs` → `10_AiService.gs`、`19_AiProfiles.gs` → `11_AiProfiles.gs`、`11_Prompts.gs` → `12_Prompts.gs`。
- 完整 mapping（續）：`09_DeepSeekService.gs` → `15_DeepSeekProvider.gs`、`08_GeminiService.gs` → `16_GeminiProvider.gs`、`16_ReaderLayer.gs` → `20_ReaderLayer.gs`、`06_WebReader.gs` → `21_WebReader.gs`、`07_WebTaskQueue.gs` → `25_WebTaskQueue.gs`。
- 完整 mapping（續）：`13_NewsInbox.gs` → `30_NewsInbox.gs`、`17_WeeklyEditorialDigest.gs` → `35_WeeklyEditorialDigest.gs`、`14_TopicHighlights.gs` → `40_TopicHighlights.gs`、`10_TopicFeatures.gs` → `45_TopicFeatures.gs`、`15_DataCleanup.gs` → `50_DataCleanup.gs`。
- 同步 20 個檔頭、現行跨檔註解、版本顯示 metadata、README、CURRENT_VERSION 與 AGENTS；v1.13.0 與更早歷史段落保留當時檔名。
- top-level functions、global const 名稱、Trigger、Sheet、Script Properties、Prompt、AI route/profile/model/thinking、Reader/Queue、LINE 指令與回覆格式均不變；`WEEKLY_EDITORIAL_CACHE_VERSION` 維持 `v1.13.0`。
- GAS 必須對既有檔案直接 Rename，不可讓新舊檔同時存在；完成後仍須正好有 20 個 `.gs`，再建立 v1.13.1 Apps Script version 並更新既有 Web App deployment。

// ==================================================

2026-08-06
v1.13.0 AI Routing & Project Architecture Edition
- 新增 18_AiService.gs 與 19_AiProfiles.gs，以 task route、execution profile、provider adapter、normalized response 建立薄的 provider-neutral AI 架構。
- 所有 AI task 顯式指定 provider、model、thinking、reasoning effort、output mode、max tokens、timeout 與 caller-owned retry metadata；thinking_max 保留但不綁日常 task。
- DeepSeek V4 Flash 接管 NewsInbox 新聞分析、#懶人包 與 Jina 失敗後的 raw HTML extraction；既有聊天、分析、統整、問答、封存與週編輯台 caller 也統一改走 AiService。
- 09_DeepSeekService.gs 整理為 provider adapter，thinking enabled 時不送無效 sampling 參數，並記錄 cache、output 與 reasoning tokens。
- 08_GeminiService.gs 保留為 dormant provider；正常 runtime 不使用、不是 fallback，只有 route 明確選到 Gemini 時才讀 GEMINI_API_KEY。
- Prompt/schema/normalizer 回到功能模組：NewsInbox 留在 13、快讀留在 07、raw HTML extraction 留在 06、週編輯台留在 17；provider adapter 不再擁有業務 Prompt。
- 新增 normalized AI response、typed error、Queue retryable 判斷與安全 console metadata；不新增 AI Log Sheet，不記錄完整 Prompt、聊天、正文、response text 或 secret。
- 新 reader route 使用 legacy_raw_html_ai；歷史 legacy_raw_html_gemini 不 migration 且仍可辨識。WEEKLY_EDITORIAL_CACHE_VERSION 更新為 v1.13.0。
- review fix：Jina、FxTwitter、PTT 與 legacy Reader failure 保留 typed HTTP metadata 到 NewsUrlQueue；route/profile 設定錯誤固定為不可重試，X 非 status URL 加入永久錯誤防守。
- review fix：同一 LINE webhook payload 的所有 events 共用 40 秒 absolute deadline、30 秒單次 AI cap 與 12 秒同步 Reader cap；直接網址會扣除 Reader/前一 AI 耗時，memory bridge 預算不足時跳過。
- 明確定義 `AI_CALL_METADATA.ok` 只代表 provider 與基礎格式結果；功能 validator 與 Queue retry 仍由 caller 負責。
- 保留公開 webhook/trigger、Sheet headers、LINE 指令與既有回覆格式；本版不需要 migration、setup、新 Trigger 或新增 Script Properties。

// ==================================================

2026-07-26
v1.12.5 Weekly Editorial Digest Edition
- #本週新聞 與 #本週新聞 精簡以一次 DeepSeek JSON 呼叫整理本週群組話題與真正的多篇焦點故事線。
- StoryKey 保留為單篇候選事件提示；至少兩篇才成立故事線，聚類結果不回寫 NewsInbox。
- 新增真正七天、同 conversationId、user-only 的 ConversationLog 讀取與機械噪音過濾；含網址但有實質評論的訊息會保留評論。
- 新增專用 JSON helper、finish_reason 檢查、保守 validator、分類 fallback 與 10 分鐘 ScriptCache。
- 新增完整新聞 block 容量控制；partition coverage 與 rendered coverage 分開驗證，省略新聞準確顯示「尚有 N 則未顯示」。
- 高潛力、分類、詳細與診斷不啟用週編輯台；詳細不顯示 StoryKey，診斷保留。
- 本版不修改 Sheet schema、Trigger、Script Properties、Reader Layer、新聞入庫核心或封存結構。

// ==================================================

2026-07-07
v1.12.4 Weekly News Compact & Story Grouping Edition
- #本週新聞 預設改為 compact，按 StoryKey / 故事線聚合同一事件線素材；#本週新聞 精簡 等同預設，#本週新聞 詳細 才展開完整大綱、切角、節目潛力與分類。
- LINE 長回覆會在單次 Reply API call 內自動拆成最多 5 則 text message，每則使用 4900 字安全上限，避免週新聞被單則硬裁切。
- NewsInbox 最右側追加 StoryKey；Gemini 新聞分析 prompt / schema 新增 storyKey，舊資料缺欄時會用 SpecialTopic、MatchedEntities、標題、分類或網址 fallback。
- #本週新聞 診斷 新增 StoryKey 空白、同 URL 重複、標題正規化重複、同故事線跨分類與分類 / 故事線疑似不一致提示。
- 強化分類 prompt 與診斷 keyword fallback；#新聞問答、#統整話題 與 #封存本週新聞 素材文字會帶入 StoryKey。
- 本版不修改 Reader Layer、WebTaskQueue、#懶人包、網址版 #節目話題分析、NewsUrlQueue 基本背景收件架構，也不新增 Node.js / npm / 自架伺服器架構。

// ==================================================

2026-06-24
v1.12.3 News QA Edition
- 新增 #新聞問答 <問題>，可根據最近 7 天 NewsInbox 素材回答新聞問題，並附完整原文網址。
- #新聞問答 支援高潛力與分類篩選；素材不足時會明確說目前素材池看不出來。
- #本週新聞 精簡 與 #本週新聞 診斷 的來源改為完整原文網址，不再只顯示網域。
- 移除 #本週新聞 24小時 與 #本週新聞 24小時 診斷，並同步更新 help 與文件。
- 本版不修改 Reader Layer、NewsInbox schema、WeeklySummary schema、群組貼網址靜默收件流程，也不新增 Node.js / npm / 自架伺服器架構。

// ==================================================

2026-06-24
v1.12.2 News Classification Audit Edition
- NewsInbox 追加 SpecialTopic、CategoryReason、CategoryConfidence、MatchedEntities、ClassificationWarning，協助分類稽核與診斷。
- #本週新聞 精簡 改為按分類分組並只列標題與來源網域；新增 #本週新聞 診斷 / 24小時 診斷。
- 自動分類不再把馬斯克 / 川普當主要分類，改以 SpecialTopic 保存，並在關鍵字不支撐或信心偏低時寫入警告。
- #封存本週新聞 納入 SpecialTopic / MatchedEntities 作為週報索引素材；#新聞問答 保留到 v1.12.3。
- 本版不修改 Reader Layer、WeeklySummary schema、群組貼網址靜默收件流程，也不新增 Node.js / npm / 自架伺服器架構。

// ==================================================

2026-06-18
v1.12.1 Weekly News Query & Help Focus Edition
- 強化 #本週新聞：支援預設 7 天、高潛力、詳細、精簡、24 小時與指定分類檢視。
- #封存本週新聞 prompt 改為週報索引取向，保留代表性事件、人物、公司、平台、政策、作品名稱與主要脈絡。
- #help 收斂為核心新聞工作流；詳細新聞檢視、#懶人包、#節目話題分析、#統整話題、#畫重點 與 #封存本週話題 移到 #help 進階。
- CURRENT_VERSION.md 改為描述此 Git ref 所代表的版本與版本邊界，不再記錄暫時性的 branch / PR / merge 狀態。
- 本版不修改 Reader Layer、NewsInbox schema、WeeklySummary schema、群組貼網址靜默收件流程，也不新增 Node.js / npm / 自架伺服器架構。

// ==================================================

2026-06-17
v1.12.0 Silent URL Status & News Archive Edition
- 群組直接貼網址改為靜默進 NewsUrlQueue 背景整理，不再主動回覆 Brief。
- 網址不支援、入隊失敗或背景讀取失敗時，改透過 PendingReplies 延後回報。
- 新增 #狀態回報 與 #封存本週新聞；WeeklySummary 追加 ArchiveType / PeriodStart / PeriodEnd / SourceItemCount 以區分話題與新聞封存。
- #封存本週話題 改為只讀 ConversationLog；#本週新聞 移除節目潛力顯示，並可參考過去新聞封存脈絡。
- 本版不刪除既有進階功能，不修改 Reader Layer、WebTaskQueue、NewsInbox Outline 或外部服務。

// ==================================================

2026-06-16
v1.11.2 Brief Range Hotfix
- 將直接貼網址與 NewsInbox Brief 從 20 字內硬限制改為 30～50 字目標區間。
- 短內容例如 X / Twitter 貼文、公告或單句消息可自然少於 30 字，不硬湊字數。
- 程式端不再正常硬裁 Brief，只保留 120 字防爆上限，避免模型失控輸出。
- 本版不修改 NewsInbox schema、Outline、Reader Layer、WebTaskQueue、LINE router 或外部服務。

// ==================================================

2026-06-15
v1.11.1 Compact News Brief Edition
- 直接貼單一網址改為回覆 20 字內 Brief；Gemini 仍維持一次呼叫，同時產生 100～200 字 Outline 與 NewsInbox 分類資料。
- NewsInbox 最右側新增 Outline 欄位；同步與背景網址入庫都會保存完整 Outline。
- #本週新聞 使用短 Brief 並移除切角顯示；#統整話題會讀取近期 NewsInbox Outline，舊資料缺少時退回 Brief。
- 本版不修改 Reader Layer、WebTaskQueue、LINE router、外部 reader 服務或其他 Sheet schema。

// ==================================================

2026-06-14
v1.11.0 Direct URL Summary Edition
- 直接貼單一網址時，改為同步透過 Reader Layer 讀取，並由一次 Gemini 呼叫同時產生 100～200 字內容大綱與 NewsInbox 分類資料。
- 同步成功後直接寫入 NewsInbox 並回覆大綱，不再等待 NewsUrlQueue 或 PendingReplies。
- 多網址、Reader 過慢、同步 API 失敗或結果不足時，退回既有 NewsUrlQueue 背景處理。
- 本版不修改 #本週新聞、#懶人包、#節目話題分析、Reader 路由或 Google Sheet schema。

// ==================================================

2026-06-14
v1.10.10 Version History Maintenance Edition
- 更新 #版本 與 #版本紀錄 的固定文字，並在內建版本紀錄最前方加入 v1.10.10。
- #版本紀錄 改為只顯示最近 6 筆，避免回覆隨版本增加而過長。
- 保留完整歷史以 99_changelog.md 為準的提醒。
- 本版不修改 Reader Layer、NewsInbox、WebTaskQueue、Google Sheet schema 或 LINE webhook 主流程。

// ==================================================

2026-06-14
v1.10.9 Social Reader Edition
- 以 v1.10.8 Manual News Supplement Parse Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 新增 X / Twitter 單篇 status 貼文 reader：/status/{id} 類型網址會透過 FxTwitter API 讀取。
- Facebook、fb.watch、Threads.com、Threads.net 不再提前攔截，改先交給 Jina Reader 嘗試讀取。
- 成功讀取的社群內容會整理成 Reader Layer 統一 webResult 格式，讓 NewsInbox、#懶人包、#節目話題分析 沿用既有流程。
- 本版不導入 Apify / ByCrawl，不修改 Google Sheet schema，不重構 NewsInbox、Gemini / DeepSeek prompt 或 Reader Layer 主架構。

// ==================================================

2026-06-08
v1.10.8 Manual News Supplement Parse Hotfix
- 以 v1.10.7 NewsInbox Queue Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 #新聞補充 的 JSON parser 命名錯誤：parseLooseJson() 並不存在，應使用 parseJsonObjectLoose()。
- 避免人工補充表面成功、實際每次靜默掉進 fallback，導致 DeepSeek 解析結果沒有被使用。
- 保留 fallback 防守；若 DeepSeek API 失敗或回傳非 JSON，仍可用使用者原文建立人工補充素材。
- 本版不修改 NewsUrlQueue、Reader Layer、Gemini 自動分類、DeepSeek 主聊天流程，不導入 Apify / ByCrawl。

// ==================================================

2026-06-08
v1.10.7 NewsInbox Queue Hotfix
- 以 v1.10.6 PTT Over18 Detection Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 X / Facebook / Threads 直接貼網址時被寫入 NewsUrlQueue 並重試三次的問題。
- NewsInbox 入隊前會先攔截 unsupported_social_platform；混合網址時只讓可支援網址入隊。
- NewsUrlQueue 遇到 unsupported_social_platform / unsafe_url 這類永久性錯誤時會直接 failed，不再重試三次。
- 修正 NewsInbox failed 後誤呼叫不存在的 createPendingReply()，改用 createPendingReplyFromTask() 建立 PendingReplies。
- 本版不導入 Apify / ByCrawl，不支援 X / Facebook / Threads 自動擷取。

// ==================================================

2026-06-08
v1.10.6 PTT Over18 Detection Hotfix
- 以 v1.10.5 Reader Layer Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 PTT 正常文章頁被 looksLikePttOver18Gate_() 誤判為滿 18 歲確認頁的問題。
- 將 PTT over18 gate 修正與 legacy fallback wrapper 整合回 16_ReaderLayer.gs，避免 Reader Layer 檔案過度分散。
- 正常文章頁若已出現 main-content 或 article-meta 結構，就不再判定為 over18 gate。
- 本版不修改 Jina Reader、NewsInbox schema、DeepSeek / Gemini 主流程，不導入 Apify / ByCrawl。

// ==================================================

2026-06-08
v1.10.5 Reader Layer Edition
- 以 v1.10.4 Data Cleanup Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 新增 16_ReaderLayer.gs，集中管理一般網站 Jina Reader、PTT over18 cookie 特例與社群平台未支援偵測。
- #懶人包、#節目話題分析 + 網址、NewsInbox 自動分類改走 Reader Layer 取得 mainText。
- 保留 legacy raw HTML + Gemini extractor 作為 fallback，不在本版刪除舊流程。
- 本版不導入 Apify / ByCrawl，不支援 X / Facebook / Threads 自動擷取，不修改資料清理層。

// ==================================================

2026-06-08
v1.10.4 Data Cleanup Edition
- 以 v1.10.3 Highlight Layer Edition 為基礎，維持 Google Apps Script 分檔架構。
- 新增分層 help 與資料維護流程，讓常用說明、管理說明、資料表說明與清理說明分開。
- 新增 15_DataCleanup.gs，集中管理目前聊天室範圍內的資料維護邏輯。
- 新增多資料表清理入口，採二段式確認，並只作用於目前 conversationId。
- 本版不修改 AI prompt 主邏輯、不修改網址讀取架構、不導入 Node.js / npm。

// ==================================================

2026-06-08
v1.10.3 Highlight Layer Edition
- 以乾淨 v1.10.2 Secretary Cleanup Edition baseline 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 將 #記錄 升級為 #畫重點，新增 TopicHighlights 作為人工重點資料表。
- #畫重點 會將使用者手動標記的重要內容寫入 TopicHighlights，而不是只留在 ConversationLog。
- #統整話題、無網址版 #節目話題分析、#封存本週話題 會納入 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀取資料時，只讀使用者訊息，不納入小浣回覆。
- 新增 14_TopicHighlights.gs，集中管理 TopicHighlights 的建立、寫入與讀取。
- 本版不導入 #清空重點、#清空快讀、#清空封存、#清空新聞 等多資料表清理指令；清理功能留待後續版本。

// ==================================================

2026-06-08
v1.10.2 Restore Baseline
- 回溯並整理目前 main 的正式基準為 v1.10.2 Secretary Cleanup Edition。
- v1.10.3 Highlight & Cleanup Edition 曾嘗試導入 #畫重點、TopicHighlights、分層 help 與多資料表清理，但該批變更已被 revert，不視為目前正式實作。
- 修復 README.md 中殘留 v1.10.3 內容導致 markdown 結構混亂的問題。
- 更新 CURRENT_VERSION.md，明確宣告目前 Source of Truth 為 main branch 最新 commit。
- 後續若要重新導入 #畫重點 / TopicHighlights，建議從乾淨 v1.10.2 baseline 重新規劃與開新 PR。

// ==================================================

2026-06-07
v1.10.2 Secretary Cleanup Edition
- 以 v1.10.1 News Inbox Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 移除 #摘要、#摘要最近、#回顧最近、#標題，降低指令重疊與維護成本。
- 移除 #讀網址，保留 #懶人包 作為唯一明確網址快讀入口。
- 個人聊天室直接貼網址時，改與群組一致，收進 NewsUrlQueue / NewsInbox，不再自動走 WebTaskQueue 快讀摘要。
- 清理 01_Main.gs 中已廢止的 summary_recent / review_recent 分支。
- 清理 02_LineCommands.gs 中已廢止的指令解析、log mode、help 內容與 extractNumber()。
- 清理 09_DeepSeekService.gs 中不再使用的 summary / review / title 模式參數。
- 清理 11_Prompts.gs 中不再使用的 summary / review / title prompt。
- 更新 12_ResponseTexts.gs、13_NewsInbox.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-06
v1.10.1 News Inbox Hotfix
- 以 v1.10.0 News Inbox Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 Gemini 自動新聞分類結果不足時，仍被正規化成「待分類」並以 ok 寫入 NewsInbox 的問題。
- 新增 isWeakAutoNewsClassification_()，自動分類若回傳無效分類、待分類，或標題是網址且簡介空白，會回到 NewsUrlQueue 重試。
- 重試規則沿用 v1.10.0：暫時性錯誤最多重試 3 次，失敗後建立 PendingReplies 通知使用者。
- 修正 #本週新聞 在 LINE 內排版過於擠壓的問題，改由程式端固定輸出分類、標題、來源網址與節目潛力的多行格式。
- 保留 #新聞補充 的 DeepSeek 自然語言解析；人工補充仍可寫入待分類，避免補件流程過度阻擋。
- 同步更新 12_ResponseTexts.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-06
v1.10.0 News Inbox Edition
- 以 v1.9.3 Gemini JSON Mode Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 將「群組直接貼網址」從自動快讀懶人包改為 NewsInbox 新聞素材池收件分類。
- 新增 13_NewsInbox.gs，集中管理 NewsUrlQueue、NewsInbox、#本週新聞、#新聞補充。
- 新增 NewsUrlQueue Sheet，直接貼網址會先進佇列，由 processNewsUrlQueue() 背景排程處理。
- NewsUrlQueue 每次 trigger 最多處理 2 筆，降低 UrlFetchApp / Gemini 連續呼叫壓力。
- 新增 NewsInbox Sheet，儲存標題、網址、分類、50 字內簡介、觀點標籤、節目潛力、來源模式。
- 新聞分類固定為：科技與 AI、社群輿論、ACG娛樂、商業財經、國際政治、生活文化、馬斯克、川普、待分類。
- 直接貼網址成功入隊後只回覆收件，不再建立成功 pending reply；若網址讀不到或重試失敗，才建立 PendingReplies 通知使用者。
- 新增 #本週新聞，讀取最近 7 天 NewsInbox，由 DeepSeek 做秘書式整理，只輸出分類、標題、來源網址與節目潛力。
- 新增 #新聞補充，使用者可用自然語言加網址補充素材，由 DeepSeek 解析後寫入 NewsInbox。
- 新增 #懶人包 作為明確網址快讀指令；#讀網址 保留為舊習慣。
- 同步更新 00_Config.gs、01_Main.gs、02_LineCommands.gs、12_ResponseTexts.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.3 Gemini JSON Mode Hotfix
- 以 v1.9.2 Humanized System Reply Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 修正 Gemini API 400 錯誤：generation_config.response_format.text.mime_type INVALID_ARGUMENT。
- 修改 08_GeminiService.gs，將 Gemini generationConfig 從 responseFormat.text.mimeType/schema 退回 responseMimeType: 'application/json'。
- 保留 getGeminiLazySummarySchema_() 與 getGeminiWebExtractorSchema_()，但暫時只作為程式端資料契約與未來升級參考，不直接送進 Gemini API。
- 補上詳細註解，說明目前 v1beta + gemini-3.1-flash-lite 與 responseFormat.text.mimeType/schema 不相容。
- 更新 12_ResponseTexts.gs 的 #版本 / #版本紀錄 內建版本資訊。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.2 Humanized System Reply Edition
- 以 v1.9.1 Structured Gemini Output Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 新增 12_ResponseTexts.gs，集中管理不經過 LLM 的固定回覆文字、版本資訊與版本紀錄。
- 新增 #版本 指令，可回覆目前版本與本次新增功能。
- 新增 #版本紀錄 指令，可回覆主要版本更新摘要。
- 調整任務接收、pending reply 交付、reset、清空紀錄、#記錄、錯誤提示、封存完成等固定回覆語氣。
- 修改 00_Config.gs，將 #版本 / #版本紀錄 加入 TRIGGER_PREFIXES。
- 修改 01_Main.gs，加入 #版本 / #版本紀錄 指令處理，並改用 12_ResponseTexts.gs 的固定文案。
- 修改 02_LineCommands.gs，新增 version log mode 與 help 說明。
- 修改 07_WebTaskQueue.gs，調整網址任務失敗與快讀結果格式。
- 修改 10_TopicFeatures.gs，調整沒有素材與封存完成時的固定提示。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.1 Structured Gemini Output Edition
- 以 v1.9.0 Service Split Edition 為基礎，維持 Google Apps Script 分檔架構與既有 LINE 指令流程。
- 修改 08_GeminiService.gs，將 Gemini 網頁快讀摘要與 Gemini 網頁正文抽取改為 structured output schema。
- 新增 getGeminiLazySummarySchema_()，集中定義快讀摘要 JSON 欄位、型別、必要欄位與 enum。
- 新增 getGeminiWebExtractorSchema_()，集中定義正文抽取 JSON 欄位、型別與必要欄位。
- 新增 buildGeminiJsonGenerationConfig_()，統一建立 Gemini REST API 的 JSON structured output generationConfig。
- 新增 normalizeGeminiString_()、normalizeGeminiStringArray_()、normalizeGeminiNumber_()、normalizeGeminiEnum_()，作為 structured output 之外的最後防守。
- 保留 parseJsonObjectLoose() fallback，避免偶發格式問題造成 WebTaskQueue 任務整個中斷。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.0 Service Split Edition
- 拆分原本過於肥大的 03_AiLogic.gs。
- 新增 03_Utils.gs、04_Storage.gs、05_Memory.gs、06_WebReader.gs、07_WebTaskQueue.gs、08_GeminiService.gs、09_DeepSeekService.gs、10_TopicFeatures.gs。
- 將原本 04_Prompts.gs 調整為 11_Prompts.gs，讓檔案順序符合系統流程。
- 功能邏輯原則上不變，主要改善可維護性與未來擴充性。
- 每個程式碼檔案補上責任說明與維護註解，方便未來人工或 AI 重新讀取。

// ==================================================

2026-06-04
V1.7.1
- 調整小浣回覆內容，讓回答更精簡。
- 重新定義程式版號。
- 一次性讀網址調整成 3 個。

// ==================================================

版本：V1.7.0 Topic Pool Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. 只要訊息中含網址：不需要 #小浣，也不需要 #讀網址，立刻回覆收到網址，任務寫入 WebTaskQueue，TaskType = web_lazy_summary，由 time-driven trigger 背景處理。
3. UrlFetchApp 抓網頁，Script 做基礎垃圾訊息清理，Gemini Flash-Lite 產生 100 至 500 字快讀摘要。
4. 摘要寫入 WebSummary，作為未來 #統整話題 的素材池，同時寫入 PendingReplies，下一次同聊天室有任何文字訊息時交付結果。
5. #節目話題分析 + 網址：任務寫入 WebTaskQueue，TaskType = program_topic_analysis，Gemini 抽正文，DeepSeek 做節目話題深度分析。
6. #節目話題分析 沒貼網址：讀最近 ConversationLog + WebSummary + WeeklySummary，由 DeepSeek 判斷要分析剛剛聊天內容、正在寫的內容，或近期最有節目潛力的素材。
7. #統整話題：讀最近 ConversationLog + WebSummary + WeeklySummary，整理成近期話題地圖、可做節目段落、素材來源與優先順序。
8. PendingReplies 仍只是交付機制，正式素材保存於 WebSummary。

// ==================================================

版本：V1.6.2 Queue Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. #讀網址 或指令中含網址：立刻回覆收到網址摘要，任務寫入 WebTaskQueue，由 time-driven trigger 背景處理。
3. 處理完成後寫入 PendingReplies，下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果。
4. 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆。

必要 Script Properties：
1. LINE_CHANNEL_ACCESS_TOKEN
2. DEEPSEEK_API_KEY
3. GEMINI_API_KEY
4. SPREADSHEET_ID

// ==================================================

2026-06-04
v1.6.1
- 小甜正式改名為小浣。
- 調整群組回覆口吻。
- 移除 LINE markdown 格式。
- 加入網址 pending reply 流程。

// ==================================================

版本：V1.6.0 Queue Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. #讀網址 或指令中含網址：立刻回覆收到網址摘要，任務寫入 WebTaskQueue，由 time-driven trigger 背景處理。
3. 處理完成後寫入 PendingReplies，下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果。
4. 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆。

必要 Script Properties：
1. LINE_CHANNEL_ACCESS_TOKEN
2. DEEPSEEK_API_KEY
3. GEMINI_API_KEY
4. SPREADSHEET_ID

// ==================================================

版本：V1.5.0 WebReader Integrated

功能：
1. 使用 DeepSeek deepseek-v4-flash 作為主要回覆模型。
2. 使用 Gemini 3.1 Flash-Lite 作為網頁正文抽取模型。
3. 支援 LINE 私訊多輪對話。
4. 支援 LINE 群組指令觸發，避免每句話都回覆。
5. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog。
6. 可讀取最近 N 則對話進行摘要與回顧。
7. 可清除短期記憶與指定聊天室長期紀錄。
8. 可將本週話題封存成極簡長期記憶：WeeklySummary。
9. 回覆時會讀取 WeeklySummary，作為過去討論脈絡。
10. 支援 #讀網址：UrlFetchApp 讀網頁，Gemini 抽正文，DeepSeek 做整理。

// ==================================================

版本：V1.4.0 Integrated

功能：
1. 使用 DeepSeek deepseek-v4-flash。
2. 支援 LINE 私訊多輪對話。
3. 支援 LINE 群組指令觸發，避免每句話都回覆。
4. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog。
5. 可讀取最近 N 則對話進行摘要與回顧。
6. 可清除短期記憶與指定聊天室長期紀錄。
7. 可將本週話題封存成極簡長期記憶：WeeklySummary。
8. 回覆時會讀取 WeeklySummary，作為過去討論脈絡。

// ==================================================
