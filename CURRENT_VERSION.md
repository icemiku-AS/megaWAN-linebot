# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.16.0 Provider Architecture Foundation**（2026-09-26）。前一版本為 v1.15.4 Context & Semantic Memory Edition。現行 `.gs` 是程式契約的首要依據；本文件描述 v1.16.0 的本機版本候選，尚未提交、合併或部署。工作 branch 為 `feature/v1160-provider-architecture`；開始工作時以 GitHub `main` 最新 `fc65c5b21c9e22f47155e3c85556b9d4e0b99a53` 為基準，本機 HEAD 相同。GAS production deployment 由維護者另外確認。

執行環境為 Google Apps Script，資料在 Google Sheets；LINE Messaging API、DeepSeek API、Jina Reader、FxTwitter API 是既有外部服務。DeepSeek Flash 是唯一 active AI provider；Gemini adapter 保留 dormant，沒有自動 fallback。Git 版本與 GAS deployment 不是同一件事。AI agent 工作規則見 `AGENTS.md`，使用方式見 `README.md`，舊版沿革見 `99_changelog.md`。

## 本版邊界

**v1.16.0 只是 Provider Architecture Foundation**：整理 provider dispatch、reasoning policy、能力驗證、adapter 結果與安全 metadata，修正相關既有錯誤路徑。**DeepSeek Flash 仍是唯一 active provider；Gemini 仍 dormant；GPT-6 Luna / OpenAI 尚未接入**，沒有 OpenAI stub、API 呼叫、自動 fallback、動態 routing 或 load balancing。

完整保留 v1.15.4 圖片語意記憶、按需週封存、generic Reader，以及 Required Internal Evidence、ConversationLog provenance、一次 client tool continuation 和 PTT Reader。正式 HIGH 與各 task 預算不變，只有原本的群組靜默 caption 使用 non-thinking；Search `max_uses=3` 不變。不改 Prompt 人格、business JSON schema、圖片／reasoning 持久化政策、LINE webhook URL；沒有 embeddings、Vector DB、圖片封存、新 Queue／Trigger／資料庫、Node/npm runtime、GitHub Actions 或自架 server。

Sheet schema / migration：**none**。新 Trigger：**none**。新 Script Property：**none**。既有環境不需執行 setup／migration；首次建置仍依 README 執行原有 setup。GAS runtime 檔案維持 23 個，沒有新檔案。

## Provider contract

`Feature → AiService → capability/profile → registered adapter → normalized result → business validator`

- Provider Registry 註冊純 `validateRequest(request)` 與 `adapter(request)`，不使用 class／DI／任意全域函式名稱 dispatch；新增 provider 不需修改 AiService 的 vendor switch。Model Registry 宣告六種既有 capabilities（text、thinking、vision、structuredOutput、webSearch、clientTools）與 reasoning modes／efforts／sampling policy。Task/profile 不指定 protocol；`thinking.type` 表達 enabled/disabled 需求，`reasoningEffort` 是由該 model policy 接受的語意標籤。DeepSeek 已驗證 policy 維持 high/max，並不宣稱其他 provider 限於這兩種 effort。
- Resolver 檢查 provider/model 歸屬、profile 預期、model 能力與正數 token／timeout；token 上限必須為整數。Service 建立 messages、output schema、Search mode、工具與 deadline，adapter 純 validation 在 required evidence 前檢查真正可實作的組合；明確要求卻不可用的 clientTools 不得靜默丟棄。Provider 不能執行 Sheet／Reader 工具。
- Adapter 接收 task/model/messages、thinking/reasoning requirement、sampling policy、outputMode/outputSchema、capabilities、webSearchMode、client tools、maxOutputTokens、timeoutSeconds/executionDeadlineAtMs/minimumRequestSeconds；獨立處理 endpoint、authorization、image encoding、vendor payload、usage／finish／HTTP error mapping。設定／序列化／body limit／deadline 通過後，才讀自己的 Script Property。錯誤 body／exception 不原樣回傳；HTTP 禁止自動 redirect。
- Adapter 使用 `buildAiProviderResult_()` 回傳固定欄位：`ok`、`text`、`finishReason`、`usage`、`elapsedMs`、`httpStatus`、`transport`、`usedWebSearch`、`sources`、`toolCalls`、`continueWithToolResults`、`modelCalls`、`errorType`、`errorMessage`、`retryable`。Finish reason 是空值、stop、length、tool_calls、content_filter、incomplete 或 error；例如 DeepSeek aborted 轉為 error，但維持 retryable provider failure。HTTP status 0 保持 0，不假造 200。
- 私有 continuation closure 保留 provider turn／reasoning；Service 只傳通用工具結果，最多一次。Callback 不可重複消耗或延長原 deadline；第二輪再要求工具直接失敗。最後交給 feature 的結果不含 tool calls、callback 或 raw state。Search auto／required、執行證據判斷、最多三筆來源、sidecar 分離及 read-only scope 不變。
- Gemini 仍僅公告既有 non-thinking text 能力，沒有擴充 Search／tools／Vision／structured output。補齊 transport、usage、Search/tool 空欄位及安全錯誤；未知 finish reason／malformed response 拒絕，thought parts 不當作正文，沿用共用 deadline。未做 Gemini live API 驗證。
- 舊 `callDeepSeek*`／`callGeminiWeb*`、error helper 和 legacy mode mapper 保留；repo 無正式業務 caller 不足以排除 GAS 手動／外部呼叫，本版不刪 compatibility function。

### Metadata 修正與量測定義

- `modelCalls` 是實際 adapter HTTP 嘗試數：驗證失敗／缺 key 為 0，network exception 仍計 1；不是供應商實際計費推理次數。`continuationCount` 是 callback dispatch 嘗試數，因此可能為 1 而第二次 HTTP 尚未發出。
- `requiredEvidenceReads`、`clientToolCalls` 分別計 required／模型請求的工具執行嘗試，包含失敗，尚未通過參數或 deadline 驗證則不計。`contextTextChars` 計首輪組好的文字 context，包含當次 prefetch evidence，不含圖片 bytes／第二輪 raw tool results。
- `toolDefinitionChars` 改成 provider-neutral client tool definitions 的 JSON 字元數，無工具為 0；不再包含 DeepSeek built-in Search definition，不能直接與 v1.15.4 數值當成同一口徑。另有 `webSearchMode`（空值／auto／required），與實際 `usedWebSearch`、sourceCount 分開。
- 六個 usage 欄位都是有效非負整數或 null。Cache miss 僅在已知且合理的 input/cached 值可相減時計算，缺值／反向差值不假設為 0。Anthropic total 沿用已知 input+output 的計算，cache／reasoning 仍為 null。不同 provider output tokens 的包含範圍依其正式 usage 契約，不用相減猜值。
- 失敗仍保留安全 transport、HTTP status、已知 usage、已完成 Search 和來源 metadata；JSON／finish／deadline／tool failure 不再抹掉前面的觀測。續接成功或失敗均合計用量；任一已 dispatch 輪次缺該欄位，累計為 null；第二輪未 dispatch 則保留首輪值。錯誤訊息固定化，未知 error type／finish reason 不原樣進 log。

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
- 短期 history 的六輪 user/assistant 上限不變。當 required ConversationLog evidence 已在短期 history 中有相同使用者文字時，只保留 evidence 的時間／provenance 與 `inShortTermHistory=true`，避免再次塞入同一段文字。不同 provenance 的記錄不去重。
- 普通 `general_chat` 與圖片 memory task 的閒聊／當輪創作不預載 WeeklySummary；明確「之前／上週／延續／回顧」等舊脈絡問題仍預載。明確要求週封存時由原 required `get_weekly_memory` reader 取得一次，避免先預載又重查。短期 history 與 required evidence 保證不因此略過。
- 固定 base system 與工具規則放在動態 WeeklySummary／required evidence 之前，以利重複 prefix。DeepSeek 官方 disk context cache 自動啟用、命中取決於完整 prefix；`cache_control` 在 DeepSeek Anthropic 相容層被忽略。Chat Completions／Responses usage 有 cache 欄位；目前 active Anthropic Search transport 未確認回傳等價 hit/miss 欄位，因此不宣稱實際 cache hit 改善。
- 一般聊天的五個只讀 client tools 與 server Web Search 仍可用；圖片工具仍由當次問題縮小。工具只讀、scope 由可信 caller 注入；明確 evidence 在第一輪前讀取，最多一次 continuation。Search `max_uses=3` 保留，明確 Search 失敗時 fail closed。沒有因省 token 改低正式聊天、Search、研究或重要 JSON task 的 HIGH effort；只有專屬群組靜默 caption 使用 non-thinking。

## Reader

Generic Jina 文字與 legacy AI 抽取結果仍檢查最短長度及原有 extraction confidence；錯誤頁判斷改看頁面標題或短頁開頭的明確 challenge／拒絕標題。正文中任意提到 Cloudflare、Access Denied、403 Forbidden、Just a moment、Enable JavaScript 不再直接判整頁失敗。HTTP 狀態、SSRF、Reader route、Queue retry、noAi、absolute deadline 與 fallback 未改。

PTT 已驗證 article 的 HTTPS canonicalization、over18、結構驗證、metadata／push／footer 移除、非空正文、最多一次 Jina、404／410 不 fallback 保持 v1.15.2／v1.15.3 契約。Generic detector 只局部改善；複雜 CAPTCHA／登入頁分類仍可能需要後續真實樣本。

## Runtime 與部署

23 個 active `.gs`：`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`、`50_DataCleanup.gs`。數字前綴僅供導航，不代表 GAS load order。

從完整 v1.15.4 升級需手動同步 6 個修改 runtime 檔：`02_LineCommands.gs`、`03_ResponseTexts.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`。Service／registry／adapters 是同一契約，應一起同步；完整重建時應使用同版全部 23 個 runtime source。`README.md`、`CURRENT_VERSION.md`、`AGENTS.md`、`99_changelog.md` 與 `tests/v1140_smoke.cjs` 不部署至 GAS。維護者建立 GAS version 並更新既有 Web App deployment；Git 合併本身不部署。

沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 非 active runtime 必需，也不需 `OPENAI_API_KEY`。Secret value 只放 GAS Script Properties，不放 source、fixture、文件範例、Sheet、console 或 metadata。既有 `doPost`、`processWebTaskQueue`、`processNewsUrlQueue` 與 Trigger 名稱不變。保留 PendingReplies acknowledge-after-send、LINE 同批 webhook 40 秒 absolute deadline 與原有 Reader／AI 餘裕檢查。

## 驗證與限制

本機 `node tests/v1140_smoke.cjs` 使用 Node 內建模組與 GAS／LINE／Sheet／provider mocks：23 GAS sources、434 unique functions、190 checks 通過（基準 168，新增 22）。保留 sidecar、群組 silence／限頻、provenance／scope、封存／清理、context／WeeklySummary、required evidence、generic Reader 與 PTT 回歸，新增 registry/profile/capability 拒絕、lazy keys、adapter 統一契約、usage／error／deadline／單次 continuation／metadata 測試。測試 VM 的假 adapter 以不同 effort 接既有 text／JSON／Vision 功能，無 production registry entry。另執行 `git diff --check` 與 source inspection，Service／feature 不含 DeepSeek protocol symbols；歷史版本文字、registry 與 compatibility wrappers 的供應商名稱合理保留。

未能本機執行 GAS，沒有真實 LINE／DeepSeek／Gemini／OpenAI／Jina／Sheet 呼叫，也沒有部署。Payload parity 以既有三 transport fixtures 驗證，不能取代 production capability／Search metadata／latency／cache／sidecar／圖片辨識品質驗收。

建議 production smoke：私訊直接圖、引用圖片、群組直接圖無回覆／限頻、群組引用加 `#小浣`、同聊天室以品牌／作品名回顧圖片、跨聊天室不可見、`#封存本週話題` 不將 derived 當人話、`#清空紀錄` 一起清除、閒聊與「上週聊過」比較 metadata、明確 Search／required evidence、一般文章正文含錯誤頁詞、真正 challenge 頁與 PTT direct／Jina／404。查看安全 metadata 的模型次數、input/cached tokens、耗時；勿輸出原圖、Prompt 或工具正文。

官方契約：[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)、[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
