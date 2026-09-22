# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.15.2 PTT Reader Resilience Hotfix**（2026-09-22，本機候選，尚待 GAS 部署驗收）。

- Stable baseline：v1.15.1 Mixed Tool Continuation Hotfix，main merge commit `795072b32ca09c450130eb7ae506d8e4872bbcdc`。
- Working branch：`v1.15.2PTTReaderResilienceHotfix`；開始時 HEAD `63400e10d0edcd25a81c573a37458751dce60f2e` 與上述 merge commit 的 Git tree 相同。未切換／更新本機 main，未 commit、push、merge 或建立 PR。
- 本文件描述 v1.15.2 的程式與部署契約；Git 版本不代表 GAS 已部署，執行環境需依部署清單手動同步。
- 實際 `.gs` 優先；AI agent 工作規則見 AGENTS.md，使用方式見 README.md，完整歷史見 99_changelog.md。舊版 Search transport 記錄只代表當時版本。

## 版本邊界

本版只修 PTT Web Reader：classic article routing、HTTPS canonicalization、main-content／article-meta 辨識、typed failure 與一次有條件 Jina fallback。Runtime 僅修改 `20_ReaderLayer.gs` 與 `03_ResponseTexts.gs` 版本文字；同步 smoke tests 與版本文件。沒有新產品功能、AI capability、外部 provider 或 unrelated refactor；Context & Cost Optimization 延後。

以下 AI／圖片／工具架構均沿用 v1.15.1：mixed server Search／client tool continuation、Required Internal Evidence 與 ConversationLog Research、capability-driven AI architecture、JSON Schema structured output、單輪 tool continuation。PTT 以外的 caller、模型、Prompt 與預算不變。

DeepSeek Flash 仍是唯一 active provider。沒有 Gemini production route、provider auto fallback、write-capable agent、圖片保存、新 backend、外部 Search provider、第三套 Queue、npm runtime dependency 或新 credentials。

Sheet schema / migration：**none**。Trigger change：**none**。新 Script Property：**none**。既有環境不需 setup / migration，不需清除 cache。研究工具不寫入；既有新聞收件、對話紀錄與最終回答 memory 照原流程保存，畫重點／封存／清理由使用者明確指令執行。

## 現行架構與檔案

`Feature → runAi*Task → Profiles / capabilities / output schema → provider resolver → transport → normalized result → business validator / presentation`

23 個 active runtime source：

| 區段 | 檔案 |
| --- | --- |
| Core / LINE / Shared | `00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs` |
| AI | `10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs` |
| Reader / Jobs | `20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs` |
| News / Editorial | `30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs` |
| Topic | `40_TopicHighlights.gs`、`45_TopicFeatures.gs` |
| Maintenance | `50_DataCleanup.gs` |

v1.15.0 新增的 runtime files 為 `13_AiSchemas.gs`、`14_AiTools.gs`；本 hotfix 無新增檔案。數字前綴不代表 load order；schema 與 tool definition 都在函式內建立，無新增 top-level executable side effects。

### Capability model

model registry 公告 adapter 已實作的能力，task route 宣告附加需求，profile 提供 text / JSON、thinking、token / timeout。共同能力名稱為 `text`、`thinking`、`vision`、`structuredOutput`、`webSearch`、`clientTools`。

所有 active task 維持 HIGH。JSON profile 預設要求 structuredOutput；只有 raw_html_extraction 明確設 `legacyJson:true`。`supportsImages`、`allowsWebSearch`、`allowsClientTools` 是 resolver 產生的相容旗標，source of truth 為 capability list。

未知能力、model 不支持的能力或 adapter 未實作的能力組合在 HTTP 前回 `ai_configuration_error`。沒有把不支持的欄位送出後期待 vendor 忽略。直接呼叫 runAiTextTask / runAiMessagesTask 且未提供 trusted conversation scope 時不提供 internal tools；正常聊天與圖片入口由 runAiMemoryTask 注入 scope。

圖片路由只依當次已遮蔽的問題選擇 `clientToolNames`，不由圖片內容、聊天 history 或模型自行擴權。AiService 只接受目前 route／trusted scope 所允許工具的子集合；空清單會移除 request 的 clientTools capability 與工具提示。文字 general_chat 可用五個只讀工具。文字與圖片共用明確 research intent；available 限制模型可選工具，required 則由 AiService 確保讀取，兩者獨立。

| 圖片問題線索 | 可用 client tools |
| --- | --- |
| 只查最新進度／查證 | 無；Vision + server Web Search |
| 收過／收集／舊新聞等 | search_news_inbox |
| 聊過／討論過／對話紀錄 | search_conversation_log |
| 週記憶／封存／上週聊過等 | get_weekly_memory |
| 畫過的重點／人工重點等 | get_topic_highlights |
| 網址／連結／HTTP(S) URL | read_url；執行時仍驗證 SSRF |
| 只有「之前／過去／重複」等模糊舊資料線索 | 保留三種內部資料工具；不自動開 read_url |

多種明確資料線索取聯集。這是有界字面選擇，不是完整自然語言意圖模型；可能漏掉未涵蓋的說法，也不解析完整否定語意。明確來源會先取得 bounded evidence；只有模糊線索仍是 optional。既有短期 history 與 WeeklySummary 前置讀取保留，後者使用 read-only 路徑，因此無 client tools 不代表完全不讀 Sheet。

### Request / result contract

保留 `runAiTextTask`、`runAiJsonTask`、`runAiMemoryTask`、`runAiMessagesTask`。本版不新增功能重複的入口。

內部 request 帶 task、messages、capabilities、thinking / reasoningEffort / profile、outputMode / outputSchema、可用工具、token budget、timeout / absolute deadline。Feature 不組 Anthropic／Responses payload。

Feature result 保留 `ok`、`text`、`json`、`usage`、`finishReason`、`errorType`、`retryable`、`httpStatus`、task/profile/provider/model 等既有欄位，附 `usedWebSearch`、最多三筆安全 sources、無原始資料的 `researchEvidence` 執行摘要。transport 名稱只作既有診斷 metadata，feature 不依它分支。

provider 只在需要工具時交回 generic `{id,name,arguments}` 和不可序列化的 continuation function。AiService 驗證、執行工具後呼叫 closure；raw assistant turn、thinking、tool IDs 的 vendor 結構由 provider closure 保存，從未放進 feature result、Sheet、Cache、PendingReplies、LINE 或 log。

## DeepSeek transport matrix

| 能力／task | Transport | 輸出／特性 |
| --- | --- | --- |
| 普通 text tasks、simple image_analysis | Chat Completions | text、HIGH；圖片在 adapter 編碼 |
| raw_html_extraction | Chat Completions | legacy json_object，28k token / 90 秒 profile |
| 六個 migrated JSON tasks | Responses | `text.format` 的 json_schema / name / schema、HIGH |
| general_chat | Anthropic Messages | auto / forced server Search，加可用的只讀 client tools |
| multimodal_research | Anthropic Messages | 單張 image + Search + client tools，同一 workflow |
| structuredOutput + Search / tools / vision | 不支援本版組合 | HTTP 前 ai_configuration_error |

模型固定 `deepseek-flash`，沿用 `DEEPSEEK_API_KEY`。本版 Search 使用 Anthropic-compatible Messages；Responses 只作 Structured Output transport，其他既有文字／普通圖片任務保留 Chat Completions。

選型依據是 v1.14.4 production capability probe 未取得可靠的 Responses server Search execution，而 Anthropic-compatible Messages 已經 production live 驗證 Search 可用。Responses guide／reference 對 Web Search 的描述曾有版本同步不一致，不能把文件字樣當作執行成功證據。未來若 Responses Search contract 改變，須另行 live capability review，不因文件字樣自動切換 transport。

### Task budgets

| Task | Max output tokens / profile seconds | 格式 |
| --- | --- | --- |
| general_chat | 4,800 / 45 | text |
| news_analysis | 8,000 / 60 | schema |
| web_lazy_summary | 8,000 / 60 | schema |
| raw_html_extraction | 28,000 / 90 | legacy JSON |
| news_question | 7,000 / 90 | text |
| program_topic_analysis | 8,000 / 120 | text |
| integrate_topics | 9,000 / 120 | text |
| archive_topics | 6,000 / 60 | schema |
| archive_news | 7,000 / 60 | schema |
| weekly_editorial_digest | 10,000 / 60 | schema |
| manual_news_supplement | 5,000 / 60 | schema |
| news_memory_bridge | 5,000 / 90 | text |
| image_analysis | 8,000 / 60 | text |
| multimodal_research | 8,000 / 60 | text |

上述是單次 provider request token 上限與 profile timeout，不是 LINE 可等待時間。一般聊天／研究共用最多 30 秒 orchestration；其他同步 caller 仍套 webhook cap。真的呼叫工具時最多兩次模型 request，因此 token 花費可能上升至兩次 request 的總和；不查工具時只有一次。最終成功 usage 累計兩次，未知 usage 欄位保持 null。

## Structured Output migration

`13_AiSchemas.gs` 是清楚的 schema responsibility layer：重用 NewsInbox 與 WebTaskQueue 的既有 schema builders，補上封閉 object、完整 required fields、型別、適用 enum 與信心 0～1；封存與週編輯台 schema 在此依既有 business validator contract 建立。

本地 validator 只支援本版使用的 schema subset，不是完整 JSON Schema engine。不取代語意分類、弱分類拒絕、StoryKey、空摘要、duplicate、partition repair、coverage、render 或 cache revalidation。

| Task | 遷移 | 保留的業務檢查 |
| --- | --- | --- |
| news_analysis | 是 | validateNewsAnalysisContract_、分類 audit、weak classification、Brief / Outline / StoryKey normalizers |
| web_lazy_summary | 是 | normalizeWebLazySummaryResult_、非空摘要、keyPoints / warnings 與分類 |
| archive_topics | 是 | validateArchiveJsonContract_、非空摘要、陣列；來源仍只有使用者 ConversationLog |
| archive_news | 是 | 同一 archive validator；來源仍為 NewsInbox |
| weekly_editorial_digest | 是 | ID / partition / conflict repair / coverage / cache 與 fallback |
| manual_news_supplement | 是 | validateManualNewsSupplementContract_、分類 normalizers 與人工補件 fallback |
| raw_html_extraction | 否 | mainText 長輸出與 legacy extraction validator；保留 28k 空間，待真實長頁 corpus 驗證後再遷移 |

所有 migrated task 都必須成功解析 JSON、通過 schema，才交給 business validator。缺欄／enum／型別／額外欄位不得 silently fallback 到 json_object。JSON malformed、length、HTTP、provider failure 保留 typed failure。新聞／快讀 schema violation 保留可由 Queue 重試語意；封存／週編輯台／人工補件由原 caller 決定 fallback。

## Read-only internal tools

工具 definition 為 provider-neutral name / description / parameters。只有 adapter 轉成 vendor schema；沒有任意 GAS function invocation、任意 Sheet/range/column 或 write tool。

| Tool | 可接受 args | Scope / 讀取視窗 | Compact result |
| --- | --- | --- | --- |
| search_news_inbox | query ≤200 字元、days 1～30（預設7）、limit 1～10（預設5） | 目前 conversation；NewsInbox 尾端最多500列；Status=ok、日期符合 | title、brief、bounded outline、category、raw storyKey、安全 source URL、timestamp |
| search_conversation_log | query、days、limit 同上 | 目前 conversation；ConversationLog 尾端最多500列；只取過去 Role=user，排除當次 MessageId／當次或未來 timestamp | role=user、ISO timestamp、最多800字元且靠近 matching query 的 text snippet；無 userId／MessageId |
| get_topic_highlights | query、days、limit 同上 | 目前 conversation；尾端300列；active 或 legacy 空 status | 人工 highlight text、tags、timestamp |
| get_weekly_memory | limit 1～10（預設5）、archiveType 可省略或 topic / news | 目前 conversation；沿用 WeeklySummary 尾端100列與 legacy topic default | 既有封存文字格式，截限後回傳 |
| read_url | 一個公開 HTTP(S) URL，≤2048 字元 | 同一 orchestration deadline，最多一次 URL | title、URL、最多3000字元正文、truncated flag |

所有欄位可省略但 read_url.url 必填；未知欄位（含 conversationId、日期、任意 range）拒絕。不開任意日期介面，使用有上限的 days，拒絕未來時間的新聞／重點。

conversationId 由 runAiMemoryTask 的可信參數覆蓋注入，模型永遠不能選 scope。整批 calls 先驗證 allowlist、JSON、ID 唯一性、型別、數值、enum、URL、call count，再開始讀取。最大4 calls、1 URL、1 continuation、每份完整序列化 tool data ≤6000 UTF-16 字元；上限保護同步成本與最終回答預算。

Read-only path 不用 ensureSheet、不建表、不補欄。缺表為空資料；非空表缺必要欄位或服務例外以 `{ok:false,errorCode:'tool_read_failed'}` 返回，無 raw exception / HTTP body。argument / allowlist 等致命錯誤直接終止 orchestration。工具資料帶 `evidenceOnly`、由 reader 產生的 `executionStatus`；查詢資料帶 `limitedWindow`，表示只查近期有限視窗，不保證全歷史檢索。

NewsInbox / TopicHighlights 重用 header reader 並明確投影 allowlist；WeeklySummary 保留既有 read/format path，第四個 readOnly 參數禁止 ensure，舊 caller 三個參數仍相容。模型不會修改任何永久資料。

### Required Internal Evidence / ConversationLog Research

AiService 只解析當次 user text（最多2000字元；圖片問題沿用1000字元上限），不從 history 或 evidence 推定必查來源。明確「收過／聊過／封存／畫重點／網址內容」形成 provider-neutral required research；Web 仍由既有 forceWebSearch 表示 required，只有完成正式 provider Search metadata 才成立。

- 明確內部來源在首輪前 deterministic read-only prefetch，共用現有工具 validator／reader；每種來源至多預讀一次，最多五種。新聞、對話、重點預讀最近30天、最多5筆；仍受全表尾端500／500／300列及每份序列化6000字元上限限制。最多五份有界資料，不傳整張表。
- 「聊過 X／收過 Y」可取各自 clause 的 ≤200字元 literal query；圖中主題、這件事、相關資料等無可靠文字主題時，讀取近期候選資料，標示 `searchMode:recent_candidates`。FOUND 表示已取得候選，並不證明與圖片有關；模型必須再比對，可在一次 continuation 內以精確 query 補查。
- ConversationLog 重用 header／scope reader。只取 `Role=user`，不以 assistant 回答作「聊過」證據；可信入口注入當次 MessageId 與 timestamp，排除本次提問、相同／較晚時間及未來訊息。直接 service caller 未提供時間時，以開始時間作上界。查詢沒有任意日期或跨 scope 介面。
- 明確 URL 在首輪前讀取後，移除可選 read_url，避免第二次 URL fetch；圖片內尚未辨識的 URL 例外，先由 Vision 辨識，再由一次 client continuation 讀取，最終仍驗證完成。沒有明確網址的文字請求、多網址或不安全網址回 typed failure，不猜網址。純貼網址保留既有收件；自然提問讀內容／比對資料走只讀研究。
- Required source 失敗回 `ai_required_evidence_failed`，不保存半回答；文字／圖片均提示「指定資料查詢未完成，不代表沒找到」。空資料是合法成功。Web 成功不能取代內部來源完成，內部資料也不能取代 forced Web Search。
- 只在單次 request 暫放 evidence；以 user data 傳入，另有可信 system boundary 要求忽略資料中的指令、分開回答各來源及避免原文輸出。最終回答可保存；原始資料、query、tool args、scope、thinking 不進 feature result 或 logs。AI_CALL_METADATA 只新增 source／required／status。

| researchEvidence.status | 正式語意 |
| --- | --- |
| NOT_SEARCHED | 尚未完成任何讀取；不能說沒找到 |
| SEARCHED_EMPTY | reader 確實執行，有限查詢範圍無回傳資料 |
| SEARCHED_FOUND | reader 確實執行且回傳有界候選；語意相關性仍需比對 |
| FAILED | 讀取／驗證未成功，不是空結果 |
| COMPLETED | 僅 Web：正式 server use/result 完成；不以 URL 數推定命中數 |

每個來源另外有 `required` 與 `available`。內部 status 來自實際 reader，Web completion 來自 provider metadata，從不分析模型「我查過了」的文字來標成功。短期 memory／一般封存前置上下文不冒充本輪 ConversationLog／required archive execution。

## Tool continuation、deadline 與 privacy

流程為必要 evidence 預讀 → 模型首輪 → 可選一批0～4個工具 → 最後模型回答。所需資料已預讀、首輪沒有 tool call 時可直接回覆；第二輪又要求工具時 `ai_tool_round_limit`，不再執行、不保存半成品。預讀不新增 model round；圖片未知 URL 未真正讀取時不得直接成功。

首輪 `stop_reason=tool_use` 且 client calls 通過既有整批驗證時，允許正式 `web_search` 暫時只有 server use、尚無 result。Provider closure 保存每個 server use/result ID 的配對計數與原始 assistant content；第二輪 result 可引用首輪 ID，無須重複 server use。第二輪結束仍有 pending、跨回合重複／錯配 ID、Search error 或 malformed block 均失敗；這不是新的 client round 或 pause_turn loop。

Continuation 保留相同 tools array 與完整 assistant thinking/tool blocks，緊接的 user message 只包含 client tool_result。只有仍有 pending Search 時改用 `tool_choice:auto`，讓 server 完成待執行 Search，且不重送 forced Search；沒有 pending 時維持 `none`。兩種情況都不移除 web_search definition。Auto 仍由 provider 決定後續 server 行為，不能保證它完全不再搜尋；維持 `max_uses:3`、兩次 model request 與相同 deadline，第二批 client tools 一律拒絕。

- 同一 webhook 所有 events 使用原 40 秒 absolute deadline，原同步 AI cap 約30秒不增加。
- general_chat / research 的 lock、memory、首輪、工具、續接共用同一最多30秒 window，還要受 webhook deadline 限制。
- Required prefetch 也消耗上述同一 window：每個讀取前至少9秒、讀取後／模型前至少8秒，不重新啟動計時。Sheet 同步讀取無法強制中斷，late guard 只能拒絕後續工作／結果；不保證外部服務必在40秒內返回。
- 首輪不為尚未發生的 continuation 預扣10秒，可使用同一 orchestration 的剩餘窗口；這也適用於 tools 有定義但模型直接回答的文字／圖片 request。
- 真正收到 client calls 後，每個工具前檢查至少9秒，final call 前至少8秒；不足回 ai_timeout，不開始讀取或硬開下一輪。晚到的 client call 可能無法續接，不能保證兩個 HIGH request 都能在同步窗口完成。
- read_url timeout cap 5秒，reader deadline 提前8秒保留回答空間。編碼、序列化與真正 HTTP 前重算；返回後若總期限已過則拒絕晚到的答案。
- 不 sleep、不自動 retry、不開 agent loop、不新增 Queue。GAS Sheet／lock／fetch 的真實延遲仍需部署後測試；mock 只證明本地 phase guards。

Prompt 將網站、圖片與所有 retrieved records 限定為 evidence/context，不能覆蓋 system/developer 指示，也不能觸發任意函式或修改資料。人工重點作為可信使用者觀點，但不能直接當作已查證外部事實。

raw tool args/results、search query、retrieved full page、thinking/reasoning、encrypted content、raw provider body 與 opaque state 不保存。Feature result 明確投影安全欄位；memory / ConversationLog 只保存使用者文字（圖片 placeholder）與最後主回答。所有成功結果清除 data URL / 長編碼；內部協議 markup fail closed。Log 沿用安全 AI metadata，不列 query、正文、tool args 或 response text。

## Web Search、Vision 與來源

普通聊天 auto，明確搜尋 forced。圖片研究的「最新／查證／來源／即時」或 explicit Search 也要求 Search；普通看圖保持 Chat Completions。引用非圖片維持自然文字 fallback，群組無 trigger 不下載，沒有 quote 不猜圖，Pending Reply 優先序與多圖限制維持。

圖片 AI failure 只在 errorType=ai_web_search_failed 時顯示 Search-specific 文案；ai_timeout 使用既有看圖逾時提示，其餘 configuration／HTTP／invalid response 等使用一般 AI 服務文案。圖片下載、格式、大小與非圖片 fallback 的原處理不變。沒有因使用者要求 Search 就把所有錯誤歸因給 Search provider。

Search success 只認同一次 orchestration 內一對一、非錯誤的正式 server_tool_use / web_search_tool_result，可在同一 response 或合法的兩輪 response 配對；只見 pending use 時 usedWebSearch=false。不使用模型自述、prompt 或文字網址。required Search 最終未完成仍失敗，pause_turn 不追加續接。Search tool 維持 max_uses:3，continuation 規則見上節。

首次同時 Search + client tools 時，把完整 assistant content（含 thinking、server use 及已回傳的 result）保留於 provider closure 供第二次 request；feature 看不到原始 block 或 pending IDs。Anthropic 官方明訂 mixed continuation 可延後 server result；DeepSeek compatibility 列出所需 blocks。圖片沿用同一原生組合與 adapter，mock 驗證不取代 DeepSeek／GAS live 驗證。

sources 只來自 provider search metadata 或實際送入模型的 NewsInbox／read_url URL。合併、public URL 驗證、去重、最多3筆；不從 final text 抽網址。內部資料只有來源，不會把 usedWebSearch 改成 true。主回答最多4個 LINE bubble，來源獨占最後1個；metadata 不保存到 memory。

## Reader / SSRF

read_url 重用既有 Reader，透過 trusted `noAi:true` 在 Jina 失敗後直接返回，不進 legacy AI extraction。PTT direct 與 Jina fallback 都只是 Reader HTTP；FxTwitter 同樣不呼叫 AI。一般新聞收件的 legacy fallback 完全保留。

### v1.15.2 PTT Reader policy

- 只將 `http(s)://ptt.cc`／`www.ptt.cc` 的 `/bbs/{board}/M.{digits}.A.{hex}.html`（無 port 或對應 scheme 預設 port）送進 classic parser。統一 `https://www.ptt.cc` 並移除 query／fragment；不改寫第三方 host、子網域、列表、非預設 port 或任意 path。term.ptt.cc 使用一般網站 Reader。既有 `isPttHostname_` 相容 helper 保留，但不再決定 article route。
- 一次 direct、最多一次 Jina。Direct 仍使用 over18 cookie 並設定 `followRedirects:false`；不抓取回應 Location。正常頁需完整平衡的 main-content div、article-meta-tag 與至少三個 article-meta-value。巢狀 div 按深度處理；正文排除 metadata、push 與發信站頁尾，沿用60字門檻。未知200頁面不當成刪文。
- fallback 適用：3xx、403、408／429／5xx、fetch exception、over18 gate、未知／不完整 article 結構及不可用正文。Unsafe／malformed classic URL、404／410、其他一般4xx不 fallback。direct 成功不發 Jina。
- 重用 `fetchReadablePageWithJina_` 的 PTT 專用模式，傳 canonical URL、`X-Set-Cookie: over18=1; Domain=www.ptt.cc; Path=/` 與 `X-Respond-With: html`。不使用 target selector，避免倚賴其 title 保留行為；HTML 僅暫存在 request 內，通過同一 parser 才成功。一般網站的 Jina text normalization 不變。依 [Jina 官方 Reader 文件](https://github.com/jina-ai/reader#using-request-headers) 與 [Reader API](https://jina.ai/reader/) 查核 header 契約；未把 mock 視為線上服務驗收。
- 保持標準 webResult。Direct route 為 `ptt_over18_cookie`，fallback route 為既有 `jina_reader`，成功 warnings 說明 direct errorType／HTTP 與 fallback。無新增 route constant 或 caller 特例。Jina 失敗回 `ptt_fallback_failed` 並保留兩次 typed error／status；任一來源暫時失敗可由既有 Queue 重試，合併 httpStatus 選可重試來源，無 HTTP response 保留0。
- Direct failure 類型：`ptt_not_found`（404／410）、`ptt_access_blocked`（403）、`ptt_unexpected_redirect`（3xx）、`ptt_fetch_failed`（其他 HTTP）、`ptt_over18_failed`、`ptt_unexpected_page`、`ptt_empty_content`、`ptt_fetch_exception`。沒有以403推論特定封鎖技術，也不以 BBS terminal DEC 2026 問題解釋 Web HTTP 失敗。
- 每次 fetch 前重算 `applyReaderFetchTimeoutForExecutionContext_`；不足1整秒不發 fallback，回 `reader_sync_budget_exhausted`。兩次 request 共用原 absolute deadline，晚到結果也拒絕。read_url 沿用5秒 cap及預留8秒最終回答空間；不增加全域 timeout、AI call、Queue 或 credentials。GAS／Jina 真實延遲仍需驗收，不能保證同步一定完成。
- `PTT_READER` log 只記 direct HTTP、direct page classification、canonicalized、redirectObserved、fallback 結果、final route／errorType 與 mainText length，不含 URL、title、HTML、正文、cookie、request headers、Jina response 或 exception 原文。Production title 請從 Reader result 人工核對，不將完整 result 寫入 log。

重用 public URL guard：拒絕 localhost、loopback、private、CGNAT、link-local、metadata、非 canonical numeric host、userinfo、IPv6 authority 與非法 port。工具模式下對 Jina/FxTwitter 的 HTTP 也關閉自動 redirect；PTT / raw direct fetch 原有不跟 redirect 的防線維持。沒有另建任意 fetch 或 DNS resolver；Jina 服務端實際抓取與其 DNS/redirect 防護仍屬既有外部 Reader 信任邊界，不能宣稱本地驗證等於服務端網路隔離證明。

## Gemini future portability

Gemini registry 保持 dormant；目前 adapter 只公告 text。thinking、vision、structuredOutput、Search 或 tools 要求一律在 HTTP 前明確失敗，沒有偷偷讀 key 或 fallback。既有 generateContent legacy JSON path 不代表正式支援 JSON Schema。

沿用 v1.15.0 的 shared capability fail-fast 與錯誤原文遮蔽，本 hotfix 不修改 Gemini。未來 re-enable 應重新核對當時 Interactions API，實作 Gemini transport resolver、structured schema / tools / grounding normalization 與 transient continuation，再更新 provider/model registry；feature 不需知道 Gemini raw steps。

Interactions 的 optional server state / storage 不可直接套入本專案 privacy policy；需明確 stateless / store=false review。沒有 production Gemini credential，也沒有雙 provider 成本。

## 2026-09-16 Mixed continuation contract 查核

- [Anthropic server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools) 與 [Web Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)：mixed response 可在 stop_reason=tool_use 時只回 server_tool_use 與 client tool_use；送回 client 結果後，下一次 request 才執行 pending server tool，其 result 依 ID 對應前輪 use。
- [Client tool continuation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)：保留相同 tools 與完整 assistant content；下一個 user message 只能含對應 client tool_result，不加尾隨文字、不代答 server result。
- [DeepSeek Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/) 支援相關 thinking、client 與 server blocks；[Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)／[Tool Calls](https://api-docs.deepseek.com/guides/tool_calls/) 要求續接保留推理上下文。Anthropic transport 使用原始 thinking content，HIGH 與原工具定義維持。
- [Tool choice](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)：auto 由模型決定是否呼叫工具，none 禁止工具選擇。本版 pending 分支依官方預設 auto 的 continuation 範例處理，不假設 none 必然能完成 DeepSeek pending Search，也不沿用首輪 forced choice 強迫另一次 Search。這是本版 payload 決策，仍需目標 provider live 驗證。

### 圖片 research production evidence 與決策

維護者最新 production 回報：文字 explicit Search、普通 quoted Vision、quoted image + Search 均成功，先前 deadline corrective pass 有效；加上「聊過／收過」時，Web 成功但模型明言沒有內部資料。TEST_CHAT_7319／TEST_NEWS_9517 同樣未取得實際 evidence。先前90秒小圖 probe 已證實 image + HIGH + Search 可用，但不能作正常 history／圖片下的 latency 保證。

程式可確認的缺陷：multimodal_research 原本固定帶四工具，AiService 因工具存在便將30秒首輪窗口縮至最多20秒，即使最後根本無 client call；圖片 UX 又把多種錯誤包成 Search failure。文字 Search 也受相同預扣影響；圖片另有 LINE 下載、Base64／body 編碼、更大輸入與8,000-token上限（文字4,800），history／lock／WeeklySummary 同樣會耗時。Provider payload 使用相同 Anthropic contract，未發現需改 transport／parser 的新證據。

採用圖片工具子集＋首輪完整剩餘窗口＋依 errorType 顯示錯誤。保留30秒 orchestration 與40秒 webhook absolute deadline，真正續接才檢查剩餘時間。Mock 以4秒下載、2秒lock、1秒編碼驗證首輪餘27秒，24秒 Search 可成功；也驗證 tools 有定義但無 calls 的25秒回答、20.5秒才回 client call 後仍能在30秒內完成，以及餘裕不足／超時時拒絕保存。

目前缺口可由 code 確認：availability 沒有 execution requirement，模型可直接 end_turn；ConversationLog 根本沒有研究入口，短期 Cache／WeeklySummary 不能替代它。Main 又先記錄當次 user message，故新增 reader 必須排除本次請求。這是 evidence orchestration 缺口，不是新的 image／Search transport 不相容。

### Architecture decisions / Rejected alternatives

採用 hybrid：明確來源 deterministic prefetch，模糊問題與候選資料精查保留 optional tools；新增 search_conversation_log 重用同一只讀 reader／validator，不新建 composite reader、planner 或 storage。一般情況只需一次 HIGH call；metadata 與成功條件由 AiService 掌握，Feature 不接觸 vendor protocol。代價是必要來源的 Sheet I/O 和最多每份6000字元 input；圖片未知主題可能仍需一次精查，late tool call 依原 deadline 失敗。

| 比較方案 | 決定／原因 |
| --- | --- |
| 只要求模型必選 required tools | 拒絕作主要方案：仍依賴模型選齊、通常多一輪 HIGH；作圖片未知 URL 的必要例外，最終檢查完成 |
| 每次預讀所有來源 | 拒絕：無關資料增加 token、latency、privacy 暴露；只預讀明確來源 |
| composite search_chat_context | 拒絕：仍可能不呼叫；重複既有 reader／validation，無需新增模型 schema |
| 純 prefetch 並移除所有工具 | 拒絕：圖片主題／網址需先辨識，可能必須精查；保留一次受限 refinement |
| Vision→planner→Search／資料查詢 | 拒絕：增加 HIGH round、deadline 與維護成本 |
| 擴大40秒／新Queue／換provider／Responses Search | 拒絕：超出本版產品與安全邊界 |

既有 deadline 決策也保留：不為尚未發生的 continuation 任意預扣10秒，不降低 HIGH。無完整自然語言／否定解析、語意索引、全歷史搜尋或新的資料保存；相關性、重複讀取和 token 最佳化留待後續版本，不屬於 v1.15.2。

## v1.15.0 官方 contract 參考（2026-09-15）

以下保留 v1.15.0 的 API 契約參考；文件可能隨供應商更新，Search transport 的選型以本版記錄的 production capability 驗證為依據。

- [DeepSeek Models](https://api-docs.deepseek.com/quick_start/pricing/) 與 [Updates](https://api-docs.deepseek.com/updates/)：canonical model 保持 deepseek-flash；不藉歷史 alias 改模型。
- [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/) 與 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)：legacy JSON 使用 json_object；不把它冒充 JSON Schema。
- [Responses reference](https://api-docs.deepseek.com/api/create-response/) 與 [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)：本版使用 stateless request 與 text.format 的 json_schema / name / schema，不加入 strict 開關。兩份文件的 Web Search 支援描述曾有版本同步不一致；本版不據此宣稱 Responses server Search 可用或永久不支援，選型與未來變更條件見上方 transport matrix。
- [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/) 與 [Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)：tool continuation 必須保留所需推理上下文；本版只在 provider closure 暫存，所有 active routes HIGH，不送 sampling。
- [Vision](https://api-docs.deepseek.com/guides/vision/) 與 [Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)：image source/base64、client tool_use/tool_result、server Search blocks、thinking/output_config.effort 可用；is_error 被忽略，因此工具錯誤使用 provider-neutral data。
- [Anthropic Web Search schema](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)：參照 server tool/result 結構；不把 Anthropic 新 tool 版本當成 DeepSeek 已支援，保留 production 的 web_search_20250305。
- [Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions)、[Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)、[Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)、[Google Search](https://ai.google.dev/gemini-api/docs/google-search)、[Image Understanding](https://ai.google.dev/gemini-api/docs/image-understanding)、[Thinking](https://ai.google.dev/gemini-api/docs/thinking)：確認未來 adapter 可採能力映射；本版不啟用。
- [GAS UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)：現行 advanced parameters 列有 timeoutSeconds；仍在每個 phase 以 Date.now 重算 absolute deadline，不能只依 timeout options 假設總流程未超時。

## 測試與 regression review

執行 `node tests/v1140_smoke.cjs`。v1.15.1 baseline 為23 sources / 420 unique functions / 138 checks；本版23 sources / 424 unique functions / **149 checks PASS**。PTT 舊整頁正文 assertion 改為 main-content 正文，routing fixture 改為真正 classic article path。新增 canonical URL／巢狀 div／metadata／HTTP failures／Jina header、成功與失敗／deadline／read_url noAi 與8秒 reserve／Queue retry／一般 Jina、term、X、legacy 回歸；保留 SSRF 測試，沒有第二套框架。兩輪 review 分別核對功能回歸與安全／版本邊界。

以下為沿用 v1.15.1 的測試範圍：

新增23項 checks：未執行不得成功、FOUND／EMPTY、雙 required source、文字／圖片 × 私訊／群組的雙 sentinel、Group／Private／Room 隔離、當次 ID／時間／assistant 排除、500列／30天／10筆／800字元與6000序列化界限、缺 schema／讀取失敗、週封存／重點實際執行、單模型成功、原 deadline、Web 不得由內部資料代替、URL／typed UX、injection 與原始資料不 persist。以真正 reader 的 Sheet mocks、呼叫計數與安全 execution metadata 驗證，不只斷言模型回答文字。

新增 mixed contract fixture：首輪 server use + search_news_inbox、stop_reason=tool_use、無 server result；第二輪只回對應 result + text。涵蓋 auto／forced 成功、未完成不提前標 Search、非法 continuation、Search error／缺失／重複／錯配、第二批 client tools、多 pending、跨 request state 隔離、私訊／群組圖片、完整 tools/thinking payload、privacy 與 late deadline。

圖片後續回歸涵蓋純 Search 完整剩餘預算、工具定義不等於續接、新聞／記憶／重點／URL與模糊意圖選擇、history不擴大工具清單、不可藉選擇擴權、timeout／Search／generic UX、晚到 client call、圖片第二批工具拒絕、先前 webhook event／下載／lock／編碼耗時與40秒上限。

涵蓋14 routes、payload、每個 migrated JSON task 的 valid/malformed/missing/type/enum（適用時）/extra/length/provider failure、既有 business validators；工具 allowlist、scope、JSON/enum/limit/day/URL/ID、bounded output、no-write、缺表/例外；單/多工具、一次 continuation、再請求工具停止、資料/編碼耗時、late response、thinking/privacy；Search production fixture、配對metadata、來源安全/去重/上限、simple image與multimodal research。

既有 regression 保留：人工指令 routing、清理二段確認與 conversation 刪除隔離、兩種封存實際 schema 寫入、Pending 研究網址不收件、群組 quiet、natural quote、legacy image、Pending delivery transport/lock/acknowledge、NewsUrlQueue retry、WebTask pending fields、X Display Title、分類 audit、header writer、PTT、httpStatus=0、webhook batch deadline、週編輯台 conflict repair/cache/coverage。GAS 全域函式與 top-level const/let/var 名稱無重複。

這是靜態／VM mock 驗證。**未能本機執行 GAS**，沒有真實 LINE、DeepSeek 或 Sheet 呼叫；v1.14.4 搜尋 production 成功是維護者提供的 baseline，並非本版重新實測。

## 沿用 v1.15.0 的 architecture decisions

| 原構想 | 本版決定與理由 | 相容性、成本與風險 |
| --- | --- | --- |
| capability model 可自由設計 | 使用字串能力集合與明確 adapter switch；舊旗標由 resolver 推導 | 無 class/DI/framework，保留 caller 入口 |
| schema 靠近 validator 或獨立層 | 新增13_AiSchemas，重用兩個既有 builders | 不把 business schema 塞入 Profiles；保留 business rules |
| tool continuation opaque state | 使用 provider closure，而不是可序列化 raw state object | 無永久 state，也不需要新的 cache/schema |
| 優先重用讀取 helper | 發現 ensureSheet 副作用；工具使用不建表讀取，WeeklySummary 增 readOnly 參數 | 缺表回空；不會模型觸發建表／補欄 |
| Responses 可選 client tools | 所有研究 client tools 與 Search 使用 Anthropic；Responses 專供 schema | 避免維護第二套工具續接，支援未來 adapter 映射，無 unused Responses tool engine |
| raw_html_extraction 可選遷移 | 明確保留 legacy 28k，待長文實測 | 不壓縮正文空間，不默默跳過 |
| 可統一來源層 | service 合併已執行工具與搜尋的安全 URL | 三筆上限、獨立 bubble、不猜 final text |
| 圖片研究可分階段 | 單一原生 Vision/Search/tools workflow；只有模型要求 internal tools 才續接 | 普通圖片仍一次；研究最多兩次，真實 latency 須驗證 |
| README patch history | 現況優先、後段 v1.x 摘要；v1.8 缺紀錄明示 | changelog 歷史一字未刪 |

## 沿用 v1.15.0 的 removed / retained compatibility

移除未使用的 Responses Web Search payload、web_search_call 成功判定與 collectDeepSeekWebSearchSources_。Responses request/result helpers 改為 active structured transport，維持 protocol guard。沒有刪除 Responses API。

保留公開/manual/compatibility wrappers：callDeepSeekWithWebReading、callDeepSeekWithMemory、callDeepSeekWithMemoryPayload、callDeepSeekDirect、callGeminiWebLazySummary、callGeminiWebExtractor、buildSystemPrompt、resolveLegacyAiTask_ 及 archive parsers。保留 getRecentWeeklySummaryText 舊三參數與 analyzeLineImage_ 字串回傳；後者可選 reply metadata 供來源 bubble，不破壞其他 callers。

## 部署清單

完整建立／重建 GAS source 時，上方列出的 **23 個 active `.gs` 應一致採用 v1.15.2 內容**。

從完整 v1.15.1 升級，**至少同步 `20_ReaderLayer.gs`（PTT hotfix）與 `03_ResponseTexts.gs`（版本文字）**；其餘21個 `.gs` 未修改。完成後建立 GAS version 並切換既有 deployment，保留先前 GAS version 供回復。沒有執行部署或 production acceptance。

若從 v1.15.0 升級，需同步 v1.15.1 的8檔 `01_Main.gs`、`03_ResponseTexts.gs`、`05_Storage.gs`、`07_LineImages.gs`、`10_AiService.gs`、`12_Prompts.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`，另加本版 `20_ReaderLayer.gs`，共9檔，全部採 v1.15.2 內容。

若從 v1.14.4 直接升級至 v1.15.2，下列 **13 個 runtime-changing `.gs` 是至少必須同步的累計清單**，全部取 v1.15.2 內容，涵蓋程式邏輯、Prompt、Help 與版本文字變更：

- `01_Main.gs`
- `02_LineCommands.gs`
- `03_ResponseTexts.gs`
- `05_Storage.gs`
- `07_LineImages.gs`
- `10_AiService.gs`
- `11_AiProfiles.gs`
- `12_Prompts.gs`
- **新增** `13_AiSchemas.gs`
- **新增** `14_AiTools.gs`
- `15_DeepSeekProvider.gs`
- `16_GeminiProvider.gs`
- `20_ReaderLayer.gs`

相對 v1.14.4 baseline，其餘10個 `.gs` 只有註解整理，沒有 runtime behavior change，因此不列入最低升級清單；若要讓 GAS source 與 v1.15.2 repository 完整一致，可一併同步。累計最低清單包含 v1.15.0 新增的兩檔，升級後 GAS 仍應具備全部23個 active sources。

Markdown／tests 不部署。Sheet migration：**none**。Trigger change：**none**。新 Script Property：**none**。首次安裝才需原 setup / install 函式；v1.14.4 升級不重跑。Git merge 不等於 GAS deployment。

### 部署後 manual smoke checklist

**v1.15.2 PTT acceptance：以下均待目標 GAS／LINE 實測，不是已通過記錄。**

先確認 `#版本`／`#版本紀錄` 為 v1.15.2，再依 B → A → C → D → E → F → G 測試，優先隔離 HTTPS 正文問題與 HTTP canonicalization。

| 案例 | URL／操作 | 預期 |
| --- | --- | --- |
| A | `http://www.ptt.cc/bbs/C_Chat/M.1789634041.A.031.html` | 先 canonicalize HTTPS，不因原 HTTP 301 直接永久失敗 |
| B | `https://www.ptt.cc/bbs/C_Chat/M.1789634041.A.031.html` | title 為 `[Vtub] 時雨羽衣聯名活動 被燒到中止`，取得實際正文，不能是錯誤頁或 over18 gate |
| C | `https://www.ptt.cc/bbs/Stock/M.1790010276.A.6F2.html` | title 為 `[新聞] 「啞巴AI」Jev上線3天捲瘋矽谷！70毫秒做...`，取得實際正文 |
| D | 維護者選一篇當下存在且需 over18 cookie 的 board article | 能讀正常文章；若仍是 gate，typed failure 明確，最多一次 fallback |
| E | 維護者確認不存在的 classic PTT article URL | direct 若回404／410，不發 Jina；若回200錯誤頁，辨識 unknown page，不能當成文章 |
| F | 一個 `http://ptt.cc/bbs/{board}/M.{digits}.A.{hex}.html` 有效文章 | 轉成 `https://www.ptt.cc/...`，與對應 HTTPS 結果一致 |
| G | `https://term.ptt.cc/` | 不送 classic PTT parser、不傳 PTT cookie；走一般網站 Reader，可依可讀性失敗 |

每案記錄：direct HTTP status、direct page classification、是否 fallback／結果、final readerRoute、final title、mainText length、失敗 errorType。使用 `PTT_READER` 安全摘要配合 Reader result 人工核對 title；不 `console.log(result)`，不在 production log 留 HTML、正文、cookie、headers 或 Jina response。A/B/C 是維護者提供的現存文章樣本，未由本次本機 smoke test 證明可讀。

補測 private URL 收件、`#懶人包`／既有 Queue，以及 `#小浣 讀這個網址的內容 <B或C網址>` 的 internal read_url。確認 noAi 不進 raw_html_extraction；若同步預算不足，沿用現有 typed failure／收件 Queue 行為，不增加工具 Queue。核對短預算、403／429與 Jina 無 key rate limit 情境的安全診斷；真實 Jina HTML header、title／author／時間與內容品質均需 GAS 驗證。最後回歸一篇一般網站及 X status。

沿用 v1.15.1 的 production acceptance：

1. 群組 A 成員先發 `TEST_CHAT_<unique>`，確認 ConversationLog 的 user row；NewsInbox 另有一筆 Status=ok、標題／摘要含 `TEST_NEWS_<unique>` 的近期新聞。
2. 引用圖片問：`#小浣 這張圖是什麼？幫我查最新資料，另外確認我們以前有沒有聊過 TEST_CHAT_<unique>，以及有沒有收過 TEST_NEWS_<unique>。`
3. 答案分開說明 Web、Conversation、NewsInbox。GAS 安全 AI_CALL_METADATA 應有 usedWebSearch=true／web_search=COMPLETED，兩內部來源 required=true 且 FOUND／EMPTY；符合視窗且 sentinel 存在時應 FOUND。核對日期與短引用，不能只相信「我查過」。
4. 群組 B 問相同 sentinel：兩內部來源應 SEARCHED_EMPTY，不能拿到 A 資料；另做 private A／B 同樣隔離驗證。排除提問自己剛新增的 row。
5. 缺資料合法 empty；實際 reader 失敗需明說未完成，不能說沒找到。確認 cache／Sheet／raw log 沒有新增原始 evidence 或圖片內容。

其他保留回歸：

1. 私訊兩輪普通聊天、群組 #小浣；記憶接續正確。
2. 「幫我查最近 Anthropic 出的 Detecting and countering misuse of AI: September 2026，大綱是在說明什麼？有什麼值得注意的地方？」仍 forced Search、正常摘要、獨立來源、無 DSML。
3. 「你好／幫我想五個標題」不需要工具；模型是否真的避免 Search/Sheet 要用實際 tool metadata 確認。
4. 同聊天室收集新聞後問「我們這週有沒有收過 Anthropic 的新聞？」；其他聊天室同名資料不得出現。比對 Sheet 行數／資料沒有工具造成的寫入。
5. 問上週記憶、新聞封存與人工重點；測 topic/news、空資料與讀取失敗。
6. 私訊引用普通圖片自然提問，群組引用 + #小浣，以及舊 #小浣 看圖；普通圖片仍 simple route。
7. 私訊引用圖片問「這張圖是真的假的？幫我查最新進度」，群組引用問「#小浣 幫我查這張圖」；確認真正 Search、回答與來源。
8. 文字與圖片各測 Search + 舊資料工具混用；圖片分別問近期收過的新聞、上週記憶、畫過的重點。若首輪 Search 尚無 result，確認 client tool_result 續接後完成匹配 Search，答案及來源正常。只有 server use 尚未完成時不得標成功；第二輪再要求 client tools 應 ai_tool_round_limit。驗證時只核對安全 metadata／結果，不把 raw blocks 或 pending IDs 加入 console log。
9. 測至少一個來源達三筆／重複URL／沒有可靠URL；長回答仍4+1 bubble，來源不進 memory。
10. 每個遷移 task 至少跑一次；尤其 NewsInbox分類、#懶人包、兩種封存、#本週新聞、#新聞補充。檢查形狀與 business rules、Sheet欄位一致。
11. 測網址比對觸發 read_url + news；Reader失敗不走 nested AI、不把研究網址入庫；已有 Pending Reply 時先交付並提示重問，普通網址仍收件。
12. 測 HTTP/429/timeout/second-tool-round failure；圖片 timeout 應是看圖逾時，只有 ai_web_search_failed 顯示 Search failure，其他錯誤用一般服務文案。不保存半回答、不退回舊知識；原 Pending Reply 失敗仍留存。保留既有安全 AI_CALL_METADATA 的 task／errorType／httpStatus／elapsedMs，以確認 production 失敗原因；此 elapsedMs 是 AI service 耗時，不含 LINE 下載與 memory 前置階段，需對照整次 GAS 執行時間。勿記原始圖片／payload。
13. 檢查 Cache、ConversationLog、WeeklySummary、NewsInbox、TopicHighlights、PendingReplies、console：無原圖/base64、raw tool data、thinking、query 或 continuation。
14. 確認 #版本 / #版本紀錄 / #help；現有兩個 Queue Trigger不重建、不重複，原LINE deployment URL不變。

### Known limitations / production rollout requirements

靜態與 mock 檢查不能取代目標 GAS 環境的 live 驗證。文字 Search、普通 Vision、image Search 的 production 成功是維護者回報；Required Internal Evidence／ConversationLog 的新部署仍需上述 sentinel 驗收。多資料源增加 input 與同步 Sheet 延遲；無法保證兩個 HIGH calls 都能完成。Pending Search、來源呈現、未知圖片 URL／精查與失敗 UX 也需 live regression。六個 schema 沿用 v1.15.0，本輪沒有改動 Structured Output。

工具是有界字面查詢，不是全歷史語意搜尋；資料會因尾端掃描視窗而漏掉較舊紀錄。只允許一個 client 工具批次，不能用第一次讀取結果再動態開第二批工具；pending Search 可以在 final request 完成，但不為 pause_turn 或仍未完成的 Search 增加第三次 request。成功答案可保存其摘要，沒有保留完整工具 evidence 供後續重播。Global ScriptLock 與實際 Google服務延遲仍限制並行性，無exactly-once保證。

## Deferred to 後續版本 — Context & Cost Optimization

依實際 usage/latency 再評估：減少常駐工具定義與長期記憶成本、相關性選取／壓縮上下文、分 task token budget 調整、避免重複 evidence、聊天室資料讀取索引、窄化 global memory lock。不要現在新增框架或新 storage。Write agent、Gemini production rollout、多圖／圖片保存、新 backend/provider fallback 不屬於本次；後續版本另行定義邊界。
