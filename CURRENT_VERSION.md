# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.16.1 Text Quote & Persona Edition**（2026-09-29），主題「文字引用脈絡與小浣人格調整」。開發基準為最新確認的 main / v1.16.0 / `f37636be695ad6d79465d4c6c6de51432d0cf74b`；v1.16.0 已合併至 main。v1.16.1 在 `feature/v1161-text-quote-persona` 完成本機修改與 mock 驗證，**尚未合併至 main 或部署 GAS；提交／推送狀態以實際 Git refs 為準**。現行 `.gs` 是程式契約的首要依據；Git refs、工作樹修改、GAS production deployment 是不同狀態，正式環境版本仍由維護者確認。

執行環境為 Google Apps Script，資料在 Google Sheets；LINE Messaging API、DeepSeek API、Jina Reader、FxTwitter API 是既有外部服務。DeepSeek Flash 是唯一 active AI provider；Gemini adapter 保留 dormant，沒有自動 fallback。Git 版本與 GAS deployment 不是同一件事。AI agent 工作規則見 `AGENTS.md`，使用方式見 `README.md`，舊版沿革見 `99_changelog.md`。

## 本版邊界

本版完成使用者文字引用的精確查找、說話者／引用上下文、跨作者去重修正與人格／task Prompt 分層；沿用現有 GAS service、Sheet、六輪 Cache memory 及 mocks。**DeepSeek Flash 仍是唯一 active provider；Gemini 仍 dormant；Luna／OpenAI 未接入**，沒有新增 provider、fallback、動態 routing 或分類／改寫模型呼叫。

保留圖片語意記憶、按需週封存、generic／PTT Reader、Required Internal Evidence、一次 client tool continuation、PendingReplies、正式新聞／週故事線／節目分析與 v1.16.0 provider contract。HIGH、sampling policy、各 task token／timeout 與 Search `max_uses=3` 不變，原本群組靜默 caption 的 non-thinking 設定不變。沒有 embeddings、Vector DB、永久圖片索引、使用者姓名系統、新 Queue／Trigger／資料庫、Node/npm runtime、GitHub Actions 或自架 server。沒有重建完整 reply graph、補猜舊引用或建立小浣出站訊息 ID 索引。

Sheet schema：**ConversationLog 追加 `QuotedMessageId`、`QuoteStatus`**。升級先備份 Sheet，執行同版 `setupLogSheet()` 補欄；首次寫入也會自動補缺欄，重複執行不重建、不清空或回填。writer／近期 reader／legacy delete 改以表頭對位，保留未知欄位；共用補欄 helper 修正舊表升級時多留空欄的問題。新 Trigger／Script Property：**none**。GAS runtime 仍為 23 檔。

## 文字引用與說話者

- LINE 文字事件先用可信 conversationId、quotedMessageId 查 ConversationLog，再記錄目前發言；原 Text 不拼入引用或作者前綴。命中條件是同聊天室、精確數字字串 ID、`Role=user`、有效的過去／當時 timestamp 與文字，排除 image_input／image_semantic。assistant log 的 MessageId 是觸發文字 ID，不是小浣出站 ID，永遠不作引用原文。完全一致的重複 user rows 可命中，作者／內容／時間／引用 metadata 衝突則失敗；不承諾 webhook 全域 exactly-once。
- `QuoteStatus`：`none` 無引用；`text_found` 取得可信原文；`not_found` 在視窗內未找到；`failed` ID、資料、讀取或期限異常；`unsupported` 命中本版不支援的使用者輸入。舊列空白在 context 表示 `unknown`，不代表當時沒有引用。只有 `text_found` 寫目標 ID；其餘狀態不保存未解析或媒體 ID。此欄記錄文字 lookup 當時結果，不把失敗反推為圖片。
- 新 MessageId／QuotedMessageId 用 Sheets 的前置單引號 literal escape 寫入，getValues 應讀回原始字串；沒有先數值化再改格式。lookup 不接受 Number 或科學記號，已失真的舊 ID 不修復。圖片事件的所有 log（含 assistant）與 derived 的 MessageId 留空，修補先前 assistant image reply 可能沿用觸發圖片 ID 的缺口；不清洗既有列。
- 已確認文字直接走文字路徑，即使當前用了舊「看圖」指令也不下載文字 ID。其他引用仍未知，原有私訊／群組 #小浣 的圖片探測、JPEG/PNG、安全下載及錯誤語意保留。未觸發群組文字可留下已確認引用，但不增加 AI、下載或回覆；原 PendingReplies 交付／靜默網址收件語意不擴張。
- 每個 execution 的引用 lookup 惰性讀取一次尾端最多 **500 列**快照，所有聊天室共用這個列數視窗，再按 scope 過濾。直接引用 **2,000 字元**、最多一層已記錄上游 **1,000 字元**；六輪 history 至多回填六個直接引用，不遞迴，全部引用 JSON **6,000 字元**上限（escaping 超限會繼續裁切並標記）。直接查找不另設 30 天限制，原文仍在範圍且 ID 完整即可命中；既有 research 的 30 天／500 列限制不變，其讀取與引用快照分開計算。
- Sheet 讀取前後檢查同一 webhook deadline，保留 8 秒回答餘裕，引用快照約 **2 秒軟上限**；GAS Sheet RPC 不能中途取消，超時結果丟棄為 failed。無引用且沒有 history 引用時不新增 Sheet 查詢。原文找到不代表外部事實已查證。
- 六輪 history 只增加白名單作者／文字 messageId／quoteStatus／已確認 quotedMessageId，不保存引用 evidence 或媒體 ID。模型端統一轉匿名代稱，當前使用者、其他成員、小浣與未知作者分開；原 UserId 不放進模型文字。舊 cache、legacy caller 沒有作者時保守降級。ConversationLog tools 同時帶來源與作者；圖片摘要的分享者不等於摘要作者。
- `CONVERSATION_TURN`／`TEXT_QUOTE_CONTEXT`／工具結果是資料，當前 user 問題獨立保留；router、required research 與 Search intent 不解析引用。只有當前已要求讀網址、且未提供網址時，才可用精確引用內唯一安全 URL 補足對象。引用中的「搜尋／清空／忽略規則」不新增操作意圖。
- history 與 evidence 只有同一精確文字 messageId、作者、來源及相容完整文字才去重；缺 metadata 不去重。週編輯台保留不同作者的相同文字，並帶入所選素材之間的引用代碼；沒有原文時明示素材缺失，不補猜。節目分析的素材與 memory 共用作者對照。
- 不新增引用快取。`#reset` 清現有短期 history（含新 metadata），不刪 Sheet；`#清空紀錄 確認` 刪目前聊天室的所有 ConversationLog rows 並清 history。後續引用重新讀 Sheet，不從另一份 evidence cache 復活；其他聊天室與已獨立封存的 WeeklySummary 維持原清理範圍。

## 人格與 Prompt 分層

共用人格是住在群組、喜歡翻垃圾找寶物的浣熊夥伴，靠好奇與輕巧幽默呈現，不固定口癖或動作。普通聊天自然收尾，問候／代號／記憶測試簡短；認真或焦急時先處理問題。Podcast 只是背景；節目風格、主持切角、SEO 與錄音用途留在相關 task。自然語言明確要求節目段落仍可協助文字整理，但不虛構收件／保存。

證據規則獨立於角色：保留日期、數字、型號與代號，分清事實／主張／推測／未知，不造熱度起源或工具執行。JSON／分類／抽取／封存走機器任務規則與原 schema／validator，不套可愛前言；圖片嚴謹程度取決於問題而非是否有圖片。固定來源 bubble、只讀工具與 required evidence 不變。

## Provider contract

`Feature → AiService → capability/profile → registered adapter → normalized result → business validator`

- Provider Registry 註冊純 `validateRequest(request)` 與 `adapter(request)`，不使用 class／DI／任意全域函式名稱 dispatch；新增 provider 不需修改 AiService 的 vendor switch。Model Registry 宣告六種既有 capabilities（text、thinking、vision、structuredOutput、webSearch、clientTools）與 reasoning modes／efforts／sampling policy。Task/profile 不指定 protocol；`thinking.type` 表達 enabled/disabled 需求，`reasoningEffort` 是由該 model policy 接受的語意標籤。DeepSeek 已驗證 policy 維持 high/max，並不宣稱其他 provider 限於這兩種 effort。
- Resolver 檢查 provider/model 歸屬、profile 預期、model 能力與正數 token／timeout；token 上限必須為整數。Service 建立 messages、output schema、Search mode、工具與 deadline，adapter 純 validation 在 required evidence 前檢查真正可實作的組合；明確要求卻不可用的 clientTools 不得靜默丟棄。Provider 不能執行 Sheet／Reader 工具。
- Adapter 接收 task/model/messages、thinking/reasoning requirement、sampling policy、outputMode/outputSchema、capabilities、webSearchMode、client tools、maxOutputTokens、timeoutSeconds/executionDeadlineAtMs/minimumRequestSeconds；獨立處理 endpoint、authorization、image encoding、vendor payload、usage／finish／HTTP error mapping。設定／序列化／body limit／deadline 通過後，才讀自己的 Script Property。錯誤 body／exception 不原樣回傳；HTTP 禁止自動 redirect。
- Adapter 使用 `buildAiProviderResult_()` 回傳固定欄位：`ok`、`text`、`finishReason`、`usage`、`elapsedMs`、`httpStatus`、`transport`、`usedWebSearch`、`sources`、`toolCalls`、`continueWithToolResults`、`modelCalls`、`errorType`、`errorMessage`、`retryable`。Finish reason 是空值、stop、length、tool_calls、content_filter、incomplete 或 error；例如 DeepSeek aborted 轉為 error，但維持 retryable provider failure。HTTP status 0 保持 0，不假造 200。
- 首輪與 continuation 回傳都經 `validateAiProviderResult_()`：所有欄位必填，usage 六欄各為非負整數或 null；檢查計數、來源、finish／error 與 tools／callback 一致性，再投影成共同結果。缺欄位、primitive 或型別錯誤以不可重試的 `ai_invalid_provider_response` fail closed，不執行工具、不外傳 raw object。Builder defaults 不能代替此邊界檢查。
- 私有 continuation closure 保留 provider turn／reasoning；Service 只傳通用工具結果，最多一次。Callback 不可重複消耗或延長原 deadline；第二輪再要求工具直接失敗。最後交給 feature 的結果不含 tool calls、callback 或 raw state。Search auto／required、執行證據判斷、最多三筆來源、sidecar 分離及 read-only scope 不變。
- Gemini 仍僅公告既有 non-thinking text 能力，沒有擴充 Search／tools／Vision／structured output。補齊 transport、usage、Search/tool 空欄位及安全錯誤；未知 finish reason／malformed response 拒絕，thought parts 不當作正文，沿用共用 deadline。未做 Gemini live API 驗證。
- 舊 `callDeepSeek*`／`callGeminiWeb*`、error helper 和 legacy mode mapper 保留；repo 無正式業務 caller 不足以排除 GAS 手動／外部呼叫，本版不刪 compatibility function。

### Metadata 修正與量測定義

- `modelCalls` 是實際 adapter HTTP 嘗試數：驗證失敗／缺 key 為 0，network exception 仍計 1；不是供應商實際計費推理次數。`continuationCount` 是 callback dispatch 嘗試數，因此可能為 1 而第二次 HTTP 尚未發出。
- 正常 adapter 必須明確回報 modelCalls 0 或 1；malformed result 無法提供可信計數時，service metadata 記 null，不猜成 0 或 1。未知第二輪是否 dispatch 時，累計 usage 也不沿用第一輪假裝完整；若兩輪計數皆有效則正常相加。已 fetch 的 status 0 仍計一次 HTTP。
- `requiredEvidenceReads`、`clientToolCalls` 分別計 required／模型請求的工具執行嘗試，包含失敗，尚未通過參數或 deadline 驗證則不計。`contextTextChars` 計首輪組好的文字 context，包含當次 prefetch evidence，不含圖片 bytes／第二輪 raw tool results。
- `toolDefinitionChars` 改成 provider-neutral client tool definitions 的 JSON 字元數，無工具為 0；不再包含 DeepSeek built-in Search definition，不能直接與 v1.15.4 數值當成同一口徑。另有 `webSearchMode`（空值／auto／required），與實際 `usedWebSearch`、sourceCount 分開。
- 六個 usage 欄位都是有效非負整數或 null。Cache miss 僅在已知且合理的 input/cached 值可相減時計算，缺值／反向差值不假設為 0。Anthropic total 沿用已知 input+output 的計算，cache／reasoning 仍為 null。不同 provider output tokens 的包含範圍依其正式 usage 契約，不用相減猜值。
- 失敗仍保留安全 transport、HTTP status、已知 usage、已完成 Search 和來源 metadata；JSON／finish／deadline／tool failure 不再抹掉前面的觀測。續接成功或失敗均合計用量；任一已 dispatch 輪次缺該欄位，累計為 null；第二輪未 dispatch 則保留首輪值。錯誤訊息固定化，未知 error type／finish reason 不原樣進 log。
- Search 必須通過成對且唯一的 server id／result、result array、公開來源 URL 與 protocol markup 檢查；合法空結果可算已執行，pending、錯配、duplicate、error object 或非法來源不可。通過後才保留該輪 Search 觀測到 pause／finish／第二批工具等後段 failure；前一合法輪次的觀測由 service 合併保留，永不保存 partial answer。pending Search 的 client 參數拒絕與 Chat malformed finish／markup 仍保留已知 usage。

### 下一版 provider 導入範圍

若正式導入 Luna，先確認當時官方 API／model 能力與實際帳號可用性，再新增 OpenAI adapter、Provider／Model Registry、必要 execution profile，完成 reasoning／Vision／Search／tools／JSON／usage／錯誤／deadline tests，最後才切需要的 `AI_TASK_ROUTES` 並在 GAS Script Properties 配置 `OPENAI_API_KEY`。本版完全不要求此 Property。LINE webhook、下載圖片、ConversationLog、semantic memory、NewsInbox、WeeklySummary、TopicHighlights、Reader、只讀工具與 business schema／validator 應沿用；供應商無法實作既有能力時 fail closed，不靠改寫業務層假裝支援。

## 圖片語意記憶

流程：`LINE 圖片／引用 → 固定 LINE content endpoint 驗證 JPEG/PNG 與 4 MiB → Vision → AI-derived bounded 文字 → ConversationLog → 同聊天室只讀 research`。

- 私訊直接貼圖、私訊自然引用與群組 `#小浣` 引用仍正常回覆。已分析圖片在**同一次** `image_analysis` 或 `multimodal_research` Vision inference 的末尾請求一段可選 sidecar；AiService 將 sidecar 與主回答分離，主回答才進 LINE 與短期 memory。sidecar 缺失或格式不合時略過，主回答照常處理。不為已分析圖片增加第二次 Vision 呼叫。
- 群組／room 直接貼圖仍不向 LINE 回覆。每聊天室使用 CacheService 文字限頻標記，通常 15 分鐘只嘗試一次；並行 webhook 下這是 best effort gate。當次 webhook 先下載圖片，再以 `image_semantic_caption` 的 DeepSeek Flash Chat Completions **non-thinking** profile、最多 320 output tokens、6 秒下載 cap、8 秒模型 cap 生成短摘要。錯誤或期限不足時直接略過，不保存原圖或排隊重試。這個流程可能延長被選中的群組圖片 webhook，需實際量測；未被選中的圖片不會形成語意記憶。
- 一張圖片的摘要以既有 ConversationLog 欄位表示：`Role=derived`、`Mode=image_semantic`、`Text=[AI-derived image context] ...`，上限 240 UTF-16 字元。圖片與 derived row 的 `MessageId` 留空，不形成永久的 LINE MessageId → 圖片索引。文字保留主題、可辨識品牌／作品／人物物件和少量重要詞；不刻意保存完整 OCR。寫入前移除 data URL、長編碼、完整 URL、電子郵件、長識別碼和常見憑證欄位值。原圖 bytes、Base64、data URL、provider reasoning 和工具結果不進 Sheet、Cache 或 console。
- 摘要只表示「小浣當時辨識到」的圖像內容。圖卡、社群貼文或新聞截圖中的主張不自動變成外部事實。圖片內的命令永遠是資料，不可變成 system instruction。文字清理是 best effort；未知形式的敏感內容與模型辨識錯誤需用 production samples 持續檢查。
- 短期 history 仍只保存文字 placeholder／使用者問題和主回答，避免再放一份 sidecar 造成重複。`#reset` 只清短期 Cache；`#清空紀錄` 二段確認後按 conversationId 刪除 ConversationLog 的使用者、assistant 與 derived rows，並清短期 Cache。`#封存本週話題` 和週編輯台對話來源仍只取真正使用者文字，不默默將 derived 圖像描述當主持人發言。

### ConversationLog research provenance

`search_conversation_log` 保留同聊天室、尾端最多 500 列、最多 30 天、最多 10 筆與 6000 字元工具結果上限。它可讀過去真正的 `Role=user` 文字與 `Role=derived / Mode=image_semantic`，每筆回傳 `provenance=user_text` 或 `image_derived`；不讀 `image_input` placeholder、assistant、其他 derived mode、當次 MessageId 或當次及未來 timestamp。圖片回顧線索可要求 `provenance=image_derived`，例如「之前有人貼過 Duolingo 那張圖？」；查詢仍是字面子字串與有限近期候選，不是向量或全歷史搜尋。

模型 Prompt 明確要求將圖片記憶說成「之前有人分享圖片，小浣當時辨識為……」，不得說成「你之前說過……」，也不得以 derived 圖像描述證明圖中事件為真。研究工具的資料都仍是 evidence/data；外部事實要靠 Web Search、NewsInbox 或其他可靠來源查證。

## Context、Cache、成本

- `AI_CALL_METADATA` 保留 provider-normalized input／cached／uncached／output／reasoning／total tokens、elapsedMs、Web Search、sourceCount 和 required evidence 狀態，並記錄 modelCalls、requiredEvidenceReads、clientToolCalls、continuationCount、contextTextChars、toolDefinitionChars。後兩者是文字與工具定義字元數，**不是 tokenizer 或美元估算**；不記 prompt、對話、圖片摘要、工具正文、thinking、URL 正文或 secret。本版口徑修正見上方 metadata 定義。
- 短期 history 的六輪 user/assistant 上限不變。ConversationLog evidence 與 history 只有同訊息 ID、同作者、user_text 且完整文字相容時才省略重複正文，保留時間、provenance、作者、messageRef 與 `inShortTermHistory=true`。不同成員相同文字、未知作者或缺 ID 的舊 cache 不去重；直接引用也沿用這個身分判斷。
- 普通 `general_chat` 與圖片 memory task 的閒聊／當輪創作不預載 WeeklySummary；明確「之前／上週／延續／回顧」等舊脈絡問題仍預載。明確要求週封存時由原 required `get_weekly_memory` reader 取得一次，避免先預載又重查。短期 history 與 required evidence 保證不因此略過。
- 固定 base system 與工具規則放在動態 WeeklySummary／required evidence 之前，以利重複 prefix。DeepSeek 官方 disk context cache 自動啟用、命中取決於完整 prefix；`cache_control` 在 DeepSeek Anthropic 相容層被忽略。Chat Completions／Responses usage 有 cache 欄位；目前 active Anthropic Search transport 未確認回傳等價 hit/miss 欄位，因此不宣稱實際 cache hit 改善。
- 一般聊天的五個只讀 client tools 與 server Web Search 仍可用；圖片工具仍由當次問題縮小。工具只讀、scope 由可信 caller 注入；明確 evidence 在第一輪前讀取，最多一次 continuation。Search `max_uses=3` 保留，明確 Search 失敗時 fail closed。沒有因省 token 改低正式聊天、Search、研究或重要 JSON task 的 HIGH effort；只有專屬群組靜默 caption 使用 non-thinking。

## Reader

Generic Jina 文字與 legacy AI 抽取結果仍檢查最短長度及原有 extraction confidence；錯誤頁判斷改看頁面標題或短頁開頭的明確 challenge／拒絕標題。正文中任意提到 Cloudflare、Access Denied、403 Forbidden、Just a moment、Enable JavaScript 不再直接判整頁失敗。HTTP 狀態、SSRF、Reader route、Queue retry、noAi、absolute deadline 與 fallback 未改。

PTT 已驗證 article 的 HTTPS canonicalization、over18、結構驗證、metadata／push／footer 移除、非空正文、最多一次 Jina、404／410 不 fallback 保持 v1.15.2／v1.15.3 契約。Generic detector 只局部改善；複雜 CAPTCHA／登入頁分類仍可能需要後續真實樣本。

## Runtime 與部署

23 個 active `.gs`：`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`、`50_DataCleanup.gs`。數字前綴僅供導航，不代表 GAS load order。

從完整 v1.16.0 升級需一起手動同步 **12 個 runtime 檔**：`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs`、`10_AiService.gs`、`12_Prompts.gs`、`14_AiTools.gs`、`25_WebTaskQueue.gs`、`35_WeeklyEditorialDigest.gs`、`45_TopicFeatures.gs`。`00_Config.gs`、`11_AiProfiles.gs`、schema 與兩個 provider adapters 不變。若部署基準不確定，使用同版全部 23 個 `.gs`。Markdown、AGENTS 與 tests 不部署至 GAS。

1. 備份 Spreadsheet；同步同版 `.gs` 後執行 `setupLogSheet()` 補欄，檢查舊列數／內容、欄位位置與重複執行結果。沒有歷史回填，也不用新 Trigger／Property。
2. 維護者建立 GAS version、更新既有 Web App deployment，保留 URL。此步尚未執行，Git 合併不會自動部署。
3. 測試聊天室讓甲貼文字、乙插話、丙引用甲加 `#小浣`；檢查回覆作者與目標正確，ConversationLog.Text 仍只有丙的新發言。接著自我引用、無 trigger 引用、下一輪不同成員追問。
4. 用實際 webhook 的長 ID 核對 Sheet `getValues()` 回讀仍為完全相同字串；確認 assistant 同 ID 不成原文、跨聊天室不命中。文字引用不應呼叫 LINE content endpoint；圖片引用照常且目標 ID 不落新欄。
5. 測試 missing quote／讀取失敗、引用內搜尋與清理字樣、`#reset`、二段 `#清空紀錄` 後再次引用；清理用測試聊天室執行。另測新聞收件、週編輯台故事線、required evidence 與 PendingReplies 交付。

沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 非 active runtime 必需，也不需 `OPENAI_API_KEY`。Secret value 只放 GAS Script Properties，不放 source、fixture、文件範例、Sheet、console 或 metadata。既有 `doPost`、`processWebTaskQueue`、`processNewsUrlQueue` 與 Trigger 名稱不變。保留 PendingReplies acknowledge-after-send、LINE 同批 webhook 40 秒 absolute deadline 與原有 Reader／AI 餘裕檢查。

## 驗證與限制

本機 `node tests/v1140_smoke.cjs`：**23 GAS sources、441 unique functions、224 checks 通過**；修改前基線 202，新增 22 個具名 checks（部分含多個子案例）。全程使用 Node 內建模組及既有 GAS／LINE／Sheet／provider mocks；不是新增 Node runtime。保留新聞收件／JSON business validators、週故事線、sidecar、群組 silence／限頻、required evidence、PendingReplies、Reader／PTT、provider registry／contract／deadline／usage 回歸。既有 writer mock 配合表頭寫入，dedup fixture 改以精確作者／ID 驗證，引用加 research 的 fixture 反映各一次 bounded read。

新增測試直接檢查模型 request、Sheet、cache 與副作用：插話後引用／自引／他引、群組與 room 靜默、assistant 同 ID 排除、舊列／未知作者／跨聊天室／失真 ID／重複與衝突／讀取失敗、補欄冪等與重排表頭、上游一層／掃描／長度／deadline、下一輪回填與跨作者去重、引用注入不改路由／required intent、圖片相容與媒體 ID 不持久化、reset／清理、素材與 history 作者一致、optional tool provenance、明確讀網址時引用補對象及 Prompt task 隔離。另以 `git diff --check` 檢查格式；原 provider／profile／schema／主要預算不變。

未能本機執行 GAS，沒有真實 LINE／DeepSeek／Gemini／OpenAI／Jina／Sheet 呼叫，也沒有部署。Payload parity 以既有三 transport fixtures 驗證，不能取代 production capability／Search metadata／latency／cache／sidecar／圖片辨識品質驗收。

人工人格案例（**尚未 live 評估**，沒有預設示範答案，也不把 mock 回覆算通過）：

| 對話案例 | 驗收重點 |
| --- | --- |
| 「你好，今天想測試一下。」 | 幾句自然回應，不介紹整套功能或推銷節目 |
| 「V1161_MEM_TEST 是這次測試代號。」→「剛才的代號是什麼？」 | 代號逐字保留，不宣稱版本切換／永久保存，不自我辯護 |
| 甲給代號、乙追問；丙引用甲詢問 | 作者與目前提問者分開，不把甲的話說成乙／丙親口說過 |
| 「你怎麼又在翻垃圾？」連續換幾種問法 | 自然接梗、不複製固定口癖、不長篇動作；接著排錯時停止硬插笑話 |
| 引用公告問「這說法對嗎？」／「幫我查最新進度」 | 找到引用與外部查證分開；答案先行，來源／主張／未知清楚 |
| 「之前有人貼過 Duolingo 那張圖嗎？」 | 圖片摘要是 AI-derived；不證明同一原圖，不聲稱重看原圖 |
| 「把這件事整理成節目段落」 | 自然語意可完成節目需求，保留故事線；不虛構收件／保存 |

自然度、幽默重複率、長度與一般聊天是否仍節目化，須用實際模型多輪抽樣判斷；mock 只驗證資料流、Prompt 組成、路由及契約。

建議 production smoke：私訊直接圖、引用圖片、群組直接圖無回覆／限頻、群組引用加 `#小浣`、同聊天室以品牌／作品名回顧圖片、跨聊天室不可見、`#封存本週話題` 不將 derived 當人話、`#清空紀錄` 一起清除、閒聊與「上週聊過」比較 metadata、明確 Search／required evidence、一般文章正文含錯誤頁詞、真正 challenge 頁與 PTT direct／Jina／404。查看安全 metadata 的模型次數、input/cached tokens、耗時；勿輸出原圖、Prompt 或工具正文。

官方契約：[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)、[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
