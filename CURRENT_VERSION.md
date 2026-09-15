# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.15.0 Unified Research & Capability Edition**。

- 工作分支：`feature/v1150-unified-research-capabilities`。
- Baseline：v1.14.4 Search Transport Correction Hotfix，`4ab76565a13c78c9ccbd5bf9d2bcc80152db7f58`。
- 開工時 HEAD、local main、origin/main 皆為上述 commit，working tree 乾淨，`git diff main...HEAD` 為空。本次沒有 fetch／rebase／merge；origin/main 是本機 remote-tracking ref，未宣稱遠端即時狀態。
- 本文件描述 v1.15.0 工作樹實作；尚未 commit、發布或手動同步 GAS。最後確認：2026-09-15。
- 實際 `.gs` 優先；AI agent 工作規則見 AGENTS.md，使用方式見 README.md，完整歷史見 99_changelog.md。舊版 Search transport 記錄只代表當時版本。

## 版本邊界

本版包含 capability-driven AI architecture、JSON Schema structured output、四個只讀 internal tools、單輪 tool continuation、圖片＋Search＋internal data 研究，以及相關回歸與文件整理。

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

新 runtime files：`13_AiSchemas.gs`、`14_AiTools.gs`。數字前綴不代表 load order，不新增 top-level executable side effects。新 schema 與 tool definition 都在函式內建立。

### Capability model

model registry 公告 adapter 已實作的能力，task route 宣告附加需求，profile 提供 text / JSON、thinking、token / timeout。共同能力名稱為 `text`、`thinking`、`vision`、`structuredOutput`、`webSearch`、`clientTools`。

所有 active task 維持 HIGH。JSON profile 預設要求 structuredOutput；只有 raw_html_extraction 明確設 `legacyJson:true`。`supportsImages`、`allowsWebSearch`、`allowsClientTools` 是 resolver 產生的相容旗標，source of truth 為 capability list。

未知能力、model 不支持的能力或 adapter 未實作的能力組合在 HTTP 前回 `ai_configuration_error`。沒有把不支持的欄位送出後期待 vendor 忽略。直接呼叫 runAiTextTask / runAiMessagesTask 且未提供 trusted conversation scope 時不提供 internal tools；正常聊天與圖片入口由 runAiMemoryTask 注入 scope。

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

模型固定 `deepseek-flash`，沿用 `DEEPSEEK_API_KEY`。沒有 Responses built-in Search，也沒有把 Chat Completions 全部遷移。

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

- 同一 webhook 所有 events 使用原 40 秒 absolute deadline，原同步 AI cap 約30秒不增加。
- general_chat / research 的 lock、memory、首輪、工具、續接共用同一最多30秒 window，還要受 webhook deadline 限制。
- 提供 tools 的首輪保留8秒 final model + 2秒資料讀取；每個工具前再次檢查至少9秒，final call 前至少8秒。
- read_url timeout cap 5秒，reader deadline 提前8秒保留回答空間。編碼、序列化與真正 HTTP 前重算；返回後若總期限已過則拒絕晚到的答案。
- 不 sleep、不自動 retry、不開 agent loop、不新增 Queue。GAS Sheet／lock／fetch 的真實延遲仍需部署後測試；mock 只證明本地 phase guards。

Prompt 將網站、圖片與所有 retrieved records 限定為 evidence/context，不能覆蓋 system/developer 指示，也不能觸發任意函式或修改資料。人工重點作為可信使用者觀點，但不能直接當作已查證外部事實。

raw tool args/results、search query、retrieved full page、thinking/reasoning、encrypted content、raw provider body 與 opaque state 不保存。Feature result 明確投影安全欄位；memory / ConversationLog 只保存使用者文字（圖片 placeholder）與最後主回答。所有成功結果清除 data URL / 長編碼；內部協議 markup fail closed。Log 沿用安全 AI metadata，不列 query、正文、tool args 或 response text。

## Web Search、Vision 與來源

普通聊天 auto，明確搜尋 forced。圖片研究的「最新／查證／來源／即時」或 explicit Search 也要求 Search；普通看圖保持 Chat Completions。引用非圖片維持自然文字 fallback，群組無 trigger 不下載，沒有 quote 不猜圖，Pending Reply 優先序與多圖限制維持。

Search success 只認一對一、非錯誤的正式 server_tool_use / web_search_tool_result；不使用模型自述、prompt 或文字網址。required Search 沒執行就失敗，pause_turn 不追加無界續接。首輪最多3次 server Search；final continuation 停用工具選擇並移除 server Search definition，避免額外搜尋與超出本版 round budget。

首次同時 Search + client tools 時，把完整 assistant content（含 thinking 與 server result）保留於 provider closure 供第二次 request；feature 看不到原始 block。DeepSeek compatibility 明確列出所需單項能力；官方未提供本專案完全相同的三能力組合實例，採原生組合、mock 驗證、部署後 live 驗證。

sources 只來自 provider search metadata 或實際送入模型的 NewsInbox／read_url URL。合併、public URL 驗證、去重、最多3筆；不從 final text 抽網址。內部資料只有來源，不會把 usedWebSearch 改成 true。主回答最多4個 LINE bubble，來源獨占最後1個；metadata 不保存到 memory。

## Reader / SSRF

read_url 重用既有 Reader，透過 trusted `noAi:true` 在 Jina 失敗後直接返回，不進 legacy AI extraction。PTT / FxTwitter 本來就不呼叫 AI；一般新聞收件的 legacy fallback 完全保留。

重用 public URL guard：拒絕 localhost、loopback、private、CGNAT、link-local、metadata、非 canonical numeric host、userinfo、IPv6 authority 與非法 port。工具模式下對 Jina/FxTwitter 的 HTTP 也關閉自動 redirect；PTT / raw direct fetch 原有不跟 redirect 的防線維持。沒有另建任意 fetch 或 DNS resolver；Jina 服務端實際抓取與其 DNS/redirect 防護仍屬既有外部 Reader 信任邊界，不能宣稱本地驗證等於服務端網路隔離證明。

## Gemini future portability

Gemini registry 保持 dormant；目前 adapter 只公告 text。thinking、vision、structuredOutput、Search 或 tools 要求一律在 HTTP 前明確失敗，沒有偷偷讀 key 或 fallback。既有 generateContent legacy JSON path 不代表正式支援 JSON Schema。

本版只加 shared capability fail-fast 與錯誤原文遮蔽。未來 re-enable 應重新核對當時 Interactions API，實作 Gemini transport resolver、structured schema / tools / grounding normalization 與 transient continuation，再更新 provider/model registry；feature 不需知道 Gemini raw steps。

Interactions 的 optional server state / storage 不可直接套入本專案 privacy policy；需明確 stateless / store=false review。沒有 production Gemini credential，也沒有雙 provider 成本。

## 2026-09-15 官方 contract 查核

以下是本次直接讀取的官方資料；部分 DeepSeek reference 在 web tool timeout 後改用 HTTPS 直接讀取同一官方頁，並非只信 search snippet。

- [DeepSeek Models](https://api-docs.deepseek.com/quick_start/pricing/) 與 [Updates](https://api-docs.deepseek.com/updates/)：canonical model 保持 deepseek-flash；不藉歷史 alias 改模型。
- [Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/) 與 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/)：legacy JSON 使用 json_object；不把它冒充 JSON Schema。
- [Responses reference](https://api-docs.deepseek.com/api/create-response/) 與 [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)：text.format 支援 json_schema / name / schema；function tools 支援，built-in web_search ignored，stateless。依 reference 欄位實作，不自行加入未列出的 strict 開關。
- [Tool calls](https://api-docs.deepseek.com/guides/tool_calls/) 與 [Thinking](https://api-docs.deepseek.com/guides/thinking_mode/)：tool continuation 必須保留所需推理上下文；本版只在 provider closure 暫存，所有 active routes HIGH，不送 sampling。
- [Vision](https://api-docs.deepseek.com/guides/vision/) 與 [Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)：image source/base64、client tool_use/tool_result、server Search blocks、thinking/output_config.effort 可用；is_error 被忽略，因此工具錯誤使用 provider-neutral data。
- [Anthropic Web Search schema](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)：參照 server tool/result 結構；不把 Anthropic 新 tool 版本當成 DeepSeek 已支援，保留 production 的 web_search_20250305。
- [Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions)、[Structured Output](https://ai.google.dev/gemini-api/docs/structured-output)、[Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)、[Google Search](https://ai.google.dev/gemini-api/docs/google-search)、[Image Understanding](https://ai.google.dev/gemini-api/docs/image-understanding)、[Thinking](https://ai.google.dev/gemini-api/docs/thinking)：確認未來 adapter 可採能力映射；本版不啟用。
- [GAS UrlFetchApp](https://developers.google.com/apps-script/reference/url-fetch/url-fetch-app)：現行 advanced parameters 列有 timeoutSeconds；仍在每個 phase 以 Date.now 重算 absolute deadline，不能只依 timeout options 假設總流程未超時。

## 測試與 regression review

執行 `node tests/v1140_smoke.cjs`。Baseline 21 sources / 405 unique functions / 62 checks；本版23 sources / 417 unique functions / **97 checks PASS**。保留原 suite 名稱並擴充，沒有第二套大量重複測試。

涵蓋14 routes、payload、每個 migrated JSON task 的 valid/malformed/missing/type/enum（適用時）/extra/length/provider failure、既有 business validators；工具 allowlist、scope、JSON/enum/limit/day/URL/ID、bounded output、no-write、缺表/例外；單/多工具、一次 continuation、再請求工具停止、資料/編碼耗時、late response、thinking/privacy；Search production fixture、配對metadata、來源安全/去重/上限、simple image與multimodal research。

既有 regression 保留：人工指令 routing、清理二段確認與 conversation 刪除隔離、兩種封存實際 schema 寫入、Pending 研究網址不收件、群組 quiet、natural quote、legacy image、Pending delivery transport/lock/acknowledge、NewsUrlQueue retry、WebTask pending fields、X Display Title、分類 audit、header writer、PTT、httpStatus=0、webhook batch deadline、週編輯台 conflict repair/cache/coverage。GAS 全域函式與 top-level const/let/var 名稱無重複。

這是靜態／VM mock 驗證。**未能本機執行 GAS**，沒有真實 LINE、DeepSeek 或 Sheet 呼叫；v1.14.4 搜尋 production 成功是維護者提供的 baseline，並非本版重新實測。

## Architecture improvements / deviations

| 原構想 | 本次決定與理由 | 相容性、成本與風險 |
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

## Removed / retained compatibility

移除未使用的 Responses Web Search payload、web_search_call 成功判定與 collectDeepSeekWebSearchSources_。Responses request/result helpers 改為 active structured transport，維持 protocol guard。沒有刪除 Responses API。

保留公開/manual/compatibility wrappers：callDeepSeekWithWebReading、callDeepSeekWithMemory、callDeepSeekWithMemoryPayload、callDeepSeekDirect、callGeminiWebLazySummary、callGeminiWebExtractor、buildSystemPrompt、resolveLegacyAiTask_ 及 archive parsers。保留 getRecentWeeklySummaryText 舊三參數與 analyzeLineImage_ 字串回傳；後者可選 reply metadata 供來源 bubble，不破壞其他 callers。

## 部署清單

先由維護者 review 工作樹，再自行 commit / push / PR / merge。本版沒有代為執行。保留 v1.14.4 GAS version 供回復；先同步全部檔案再切換 deployment，避免混用契約。

需要手動同步的 `.gs`：

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

其餘10個 `.gs` 保留 baseline。GAS 共23檔；Markdown 與 tests 不部署。Sheet migration：**none**。Trigger change：**none**。新 Script Property：**none**。首次安裝才需原 setup / install 函式；v1.14.4 升級不重跑。

### 部署後 manual smoke checklist

1. 私訊兩輪普通聊天、群組 #小浣；記憶接續正確。
2. 「幫我查最近 Anthropic 出的 Detecting and countering misuse of AI: September 2026，大綱是在說明什麼？有什麼值得注意的地方？」仍 forced Search、正常摘要、獨立來源、無 DSML。
3. 「你好／幫我想五個標題」不需要工具；模型是否真的避免 Search/Sheet 要用實際 tool metadata 確認。
4. 同聊天室收集新聞後問「我們這週有沒有收過 Anthropic 的新聞？」；其他聊天室同名資料不得出現。比對 Sheet 行數／資料沒有工具造成的寫入。
5. 問上週記憶、新聞封存與人工重點；測 topic/news、空資料與讀取失敗。
6. 私訊引用普通圖片自然提問，群組引用 + #小浣，以及舊 #小浣 看圖；普通圖片仍 simple route。
7. 私訊引用圖片問「這張圖是真的假的？幫我查最新進度」，群組引用問「#小浣 幫我查這張圖」；確認真正 Search、回答與來源。
8. 圖片加舊資料查詢觸發工具；確認原生 thinking/image/Search/client-tools 組合能完成一次續接，最後一輪不再要求工具。
9. 測至少一個來源達三筆／重複URL／沒有可靠URL；長回答仍4+1 bubble，來源不進 memory。
10. 每個遷移 task 至少跑一次；尤其 NewsInbox分類、#懶人包、兩種封存、#本週新聞、#新聞補充。檢查形狀與 business rules、Sheet欄位一致。
11. 測網址比對觸發 read_url + news；Reader失敗不走 nested AI、不把研究網址入庫；已有 Pending Reply 時先交付並提示重問，普通網址仍收件。
12. 測 HTTP/429/timeout/second-tool-round failure；不保存半回答、不退回舊知識；原 Pending Reply 失敗仍留存。
13. 檢查 Cache、ConversationLog、WeeklySummary、NewsInbox、TopicHighlights、PendingReplies、console：無原圖/base64、raw tool data、thinking、query 或 continuation。
14. 確認 #版本 / #版本紀錄 / #help；現有兩個 Queue Trigger不重建、不重複，原LINE deployment URL不變。

### Known limitations / merge and rollout gates

靜態與 mock 檢查無已知未修正 blocker。production rollout 前必須完成上述 live 組合驗證，尤其 Responses 六個 schema、Search+tools+image、最終 tool_choice none 與真正30秒延遲。若維護者把 live acceptance 設為 merge gate，這些尚未實測項目就是 pending gate；本文件不宣稱可略過。

工具是有界字面查詢，不是全歷史語意搜尋；資料會因尾端掃描視窗而漏掉較舊紀錄。只允許一個工具批次，不能用第一次讀取結果再動態開第二批工具。final turn 不新增網路搜尋。成功答案可保存其摘要，沒有保留完整工具 evidence 供後續重播。Global ScriptLock 與實際 Google服務延遲仍限制並行性，無exactly-once保證。

## Deferred to v1.15.1 — Context & Cost Optimization

依實際 usage/latency 再評估：減少常駐工具定義與長期記憶成本、相關性選取／壓縮上下文、分 task token budget 調整、避免重複 evidence、聊天室資料讀取索引、窄化 global memory lock。不要現在新增框架或新 storage。Write agent、Gemini production rollout、多圖／圖片保存、新 backend/provider fallback 不屬於本次或必然屬於 v1.15.1。
