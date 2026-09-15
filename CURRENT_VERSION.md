# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.15.1 Mixed Tool Continuation Hotfix**（2026-09-16）。

- Baseline：v1.15.0 Unified Research & Capability Edition，main merge commit `30353cb99d73f4fff9af26e5742b0ee4b75c73d5`；其前版 baseline 為 v1.14.4 / `4ab76565a13c78c9ccbd5bf9d2bcc80152db7f58`。
- 本文件描述 v1.15.1 的程式與部署契約；Git 版本不代表 GAS 已部署，執行環境需依部署清單手動同步。
- 實際 `.gs` 優先；AI agent 工作規則見 AGENTS.md，使用方式見 README.md，完整歷史見 99_changelog.md。舊版 Search transport 記錄只代表當時版本。

## 版本邊界

本版修正 v1.15.0 的 Anthropic mixed server Search／client tool continuation regression，以及圖片研究的過度工具暴露、首輪預扣續接時間與錯誤文案誤分類。沿用 capability-driven AI architecture、JSON Schema structured output、四個只讀 internal tools、單輪 tool continuation 與圖片＋Search＋internal data 研究；沒有新增功能或 runtime 重構。

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

圖片路由只依當次已遮蔽的問題選擇 `clientToolNames`，不由圖片內容、聊天 history 或模型自行擴權。AiService 只接受目前 route／trusted scope 所允許工具的子集合；空清單會移除 request 的 clientTools capability 與工具提示。文字 general_chat 保留原四工具可用性，完整語意／history gating 留待 v1.15.2。

| 圖片問題線索 | 可用 client tools |
| --- | --- |
| 只查最新進度／查證 | 無；Vision + server Web Search |
| 收過／收集／舊新聞等 | search_news_inbox |
| 週記憶／封存／上週聊過等 | get_weekly_memory |
| 畫過的重點／人工重點等 | get_topic_highlights |
| 網址／連結／HTTP(S) URL | read_url；執行時仍驗證 SSRF |
| 只有「之前／過去／重複」等模糊舊資料線索 | 保留三種內部資料工具；不自動開 read_url |

多種明確資料線索取聯集。這是有界字面選擇，不是完整自然語言意圖模型；可能漏掉未涵蓋的說法，也不解析完整否定語意。工具可用不代表強制執行。既有短期 history 與 WeeklySummary 前置讀取仍保留，因此無 client tools 不代表完全不讀 Sheet。

### Request / result contract

保留 `runAiTextTask`、`runAiJsonTask`、`runAiMemoryTask`、`runAiMessagesTask`。本版不新增功能重複的入口。

內部 request 帶 task、messages、capabilities、thinking / reasoningEffort / profile、outputMode / outputSchema、可用工具、token budget、timeout / absolute deadline。Feature 不組 Anthropic／Responses payload。

Feature result 保留 `ok`、`text`、`json`、`usage`、`finishReason`、`errorType`、`retryable`、`httpStatus`、task/profile/provider/model 等既有欄位，附 `usedWebSearch`、最多三筆安全 sources。transport 名稱只作既有診斷 metadata，feature 不依它分支。

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
| get_topic_highlights | query、days、limit 同上 | 目前 conversation；尾端300列；active 或 legacy 空 status | 人工 highlight text、tags、timestamp |
| get_weekly_memory | limit 1～10（預設5）、archiveType 可省略或 topic / news | 目前 conversation；沿用 WeeklySummary 尾端100列與 legacy topic default | 既有封存文字格式，截限後回傳 |
| read_url | 一個公開 HTTP(S) URL，≤2048 字元 | 同一 orchestration deadline，最多一次 URL | title、URL、最多3000字元正文、truncated flag |

所有欄位可省略但 read_url.url 必填；未知欄位（含 conversationId、日期、任意 range）拒絕。不開任意日期介面，使用有上限的 days，拒絕未來時間的新聞／重點。

conversationId 由 runAiMemoryTask 的可信參數覆蓋注入，模型永遠不能選 scope。整批 calls 先驗證 allowlist、JSON、ID 唯一性、型別、數值、enum、URL、call count，再開始讀取。最大4 calls、1 URL、1 continuation、每份完整序列化 tool data ≤6000 UTF-16 字元；上限保護同步成本與最終回答預算。

Read-only path 不用 ensureSheet、不建表、不補欄。缺表為空資料；服務例外以 `{ok:false,errorCode:'tool_read_failed'}` 返回，無 raw exception / HTTP body。argument / allowlist 等致命錯誤直接終止 orchestration。工具資料帶 `evidenceOnly`；查詢資料帶 `limitedWindow`，表示只查近期有限視窗，不保證全歷史檢索。

NewsInbox / TopicHighlights 重用 header reader 並明確投影 allowlist；WeeklySummary 保留既有 read/format path，第四個 readOnly 參數禁止 ensure，舊 caller 三個參數仍相容。模型不會修改任何永久資料。

## Tool continuation、deadline 與 privacy

流程只有：模型首輪 → 一批0～4個工具 → 最後模型回答。首輪沒有 tool call 就直接回覆；第二輪又要求工具時 `ai_tool_round_limit`，不再執行、不保存半成品。

首輪 `stop_reason=tool_use` 且 client calls 通過既有整批驗證時，允許正式 `web_search` 暫時只有 server use、尚無 result。Provider closure 保存每個 server use/result ID 的配對計數與原始 assistant content；第二輪 result 可引用首輪 ID，無須重複 server use。第二輪結束仍有 pending、跨回合重複／錯配 ID、Search error 或 malformed block 均失敗；這不是新的 client round 或 pause_turn loop。

Continuation 保留相同 tools array 與完整 assistant thinking/tool blocks，緊接的 user message 只包含 client tool_result。只有仍有 pending Search 時改用 `tool_choice:auto`，讓 server 完成待執行 Search，且不重送 forced Search；沒有 pending 時維持 `none`。兩種情況都不移除 web_search definition。Auto 仍由 provider 決定後續 server 行為，不能保證它完全不再搜尋；維持 `max_uses:3`、兩次 model request 與相同 deadline，第二批 client tools 一律拒絕。

- 同一 webhook 所有 events 使用原 40 秒 absolute deadline，原同步 AI cap 約30秒不增加。
- general_chat / research 的 lock、memory、首輪、工具、續接共用同一最多30秒 window，還要受 webhook deadline 限制。
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

read_url 重用既有 Reader，透過 trusted `noAi:true` 在 Jina 失敗後直接返回，不進 legacy AI extraction。PTT / FxTwitter 本來就不呼叫 AI；一般新聞收件的 legacy fallback 完全保留。

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

維護者回報：文字 explicit Search 與普通 quoted Vision 成功；quoted image + Search，以及再加舊新聞比對皆失敗。直接 DeepSeek probe（小圖、短 prompt、無完整 history、90秒 timeout）則在 image + HIGH + forced Search 回 HTTP 200／end_turn／一組成功 Search；加入 client definitions 後也成功，兩組 Search、零 client call。這支持 image + Search 可用、工具定義並非必然不相容，但沒有提供 production 失敗時的 errorType／耗時，不能據此確認唯一根因是 latency。

程式可確認的缺陷：multimodal_research 原本固定帶四工具，AiService 因工具存在便將30秒首輪窗口縮至最多20秒，即使最後根本無 client call；圖片 UX 又把多種錯誤包成 Search failure。文字 Search 也受相同預扣影響；圖片另有 LINE 下載、Base64／body 編碼、更大輸入與8,000-token上限（文字4,800），history／lock／WeeklySummary 同樣會耗時。Provider payload 使用相同 Anthropic contract，未發現需改 transport／parser 的新證據。

採用圖片工具子集＋首輪完整剩餘窗口＋依 errorType 顯示錯誤。保留30秒 orchestration 與40秒 webhook absolute deadline，真正續接才檢查剩餘時間。Mock 以4秒下載、2秒lock、1秒編碼驗證首輪餘27秒，24秒 Search 可成功；也驗證 tools 有定義但無 calls 的25秒回答、20.5秒才回 client call 後仍能在30秒內完成，以及餘裕不足／超時時拒絕保存。

Rejected alternatives：只移除無關工具仍無法解決「需要工具定義、實際未呼叫」的預扣；任意把10秒 reserve 改成另一常數缺乏 latency 依據；固定 Vision→Search／額外 planner 會增加 HIGH round、費用與 privacy state；放大同步 deadline、降 thinking、換 provider 或新增 Queue 都不是本 hotfix 的解法。模糊圖片意圖保留三種內部工具以減少漏查；不在本輪對已成功的文字流程引入全新語意 gating。

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

執行 `node tests/v1140_smoke.cjs`。v1.15.0 baseline 為23 sources / 417 unique functions / 97 checks；本版23 sources / 418 unique functions / **115 checks PASS**。保留既有106 checks 並擴充；舊圖片 fixture 的 client call 配合問題選擇，編碼耗盡 fixture 改為耗盡完整30秒窗口，沒有第二套測試框架。

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

完整建立／重建 GAS source 時，上方列出的 **23 個 active `.gs` 應一致採用 v1.15.1 內容**。

從 v1.15.0 升級至本版，**至少同步以下5個 `.gs`**：`03_ResponseTexts.gs`（版本回覆）、`07_LineImages.gs`（圖片工具選擇／錯誤文案分流）、`10_AiService.gs`（工具子集與deadline分配）、`12_Prompts.gs`（實際工具可用性與無 client tools 時的研究資料信任邊界）、`15_DeepSeekProvider.gs`（mixed continuation）。其餘18個 `.gs` 與 v1.15.0 baseline 相同。即使先前已部署 v1.15.1，也應核對並同步這份完整清單，完成後切換 deployment，保留先前 GAS version 供回復。

若從 v1.14.4 直接升級至 v1.15.1，下列 **13 個 runtime-changing `.gs` 是至少必須同步的累計清單**，全部取 v1.15.1 內容，涵蓋程式邏輯、Prompt、Help 與版本文字變更：

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

相對 v1.14.4 baseline，其餘10個 `.gs` 只有註解整理，沒有 runtime behavior change，因此不列入最低升級清單；若要讓 GAS source 與 v1.15.1 repository 完整一致，可一併同步。累計最低清單包含 v1.15.0 新增的兩檔，升級後 GAS 仍應具備全部23個 active sources。

Markdown／tests 不部署。Sheet migration：**none**。Trigger change：**none**。新 Script Property：**none**。首次安裝才需原 setup / install 函式；v1.14.4 升級不重跑。Git merge 不等於 GAS deployment。

### 部署後 manual smoke checklist

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

靜態與 mock 檢查不能取代目標 GAS 環境的 live 驗證。部署後需完成上述 checklist，特別用真實圖片及正常 history 重測純 image Search 與 Search＋internal tools，觀察失敗時安全 metadata；90秒小圖 probe 不是 production latency 保證。Pending Search＋client tools、相同 tools／auto continuation、錯誤文案與真實30秒延遲仍需驗證。首輪可用時間增加，最壞費用／等待時間也可能增加；晚到的工具要求可能沒有續接餘裕。六個 schema 沿用 v1.15.0，本輪沒有改動 Structured Output。

工具是有界字面查詢，不是全歷史語意搜尋；資料會因尾端掃描視窗而漏掉較舊紀錄。只允許一個 client 工具批次，不能用第一次讀取結果再動態開第二批工具；pending Search 可以在 final request 完成，但不為 pause_turn 或仍未完成的 Search 增加第三次 request。成功答案可保存其摘要，沒有保留完整工具 evidence 供後續重播。Global ScriptLock 與實際 Google服務延遲仍限制並行性，無exactly-once保證。

## Deferred to v1.15.2 — Context & Cost Optimization

依實際 usage/latency 再評估：減少常駐工具定義與長期記憶成本、相關性選取／壓縮上下文、分 task token budget 調整、避免重複 evidence、聊天室資料讀取索引、窄化 global memory lock。不要現在新增框架或新 storage。Write agent、Gemini production rollout、多圖／圖片保存、新 backend/provider fallback 不屬於本次或必然屬於 v1.15.2。
