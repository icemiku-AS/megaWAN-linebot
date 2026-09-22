# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.15.4 Context & Semantic Memory Edition**（2026-09-23）。前一版本為 v1.15.3 Reader False Positive Hotfix。現行 `.gs` 是程式契約的首要依據；本文件描述 v1.15.4 的版本契約。Git repository 狀態與 GAS production deployment 可能處於不同階段，實際 deployment 由維護者確認。

執行環境為 Google Apps Script，資料在 Google Sheets；LINE Messaging API、DeepSeek API、Jina Reader、FxTwitter API 是既有外部服務。DeepSeek Flash 是唯一 active AI provider；Gemini adapter 保留 dormant，沒有自動 fallback。Git 版本與 GAS deployment 不是同一件事。AI agent 工作規則見 `AGENTS.md`，使用方式見 `README.md`，舊版沿革見 `99_changelog.md`。

## 本版邊界

本版新增圖片語意記憶、按需載入週封存與安全成本 metadata，並局部修正 generic Reader 的正文關鍵字誤判。保留 v1.15.1 的 Required Internal Evidence、ConversationLog Research、一次 client tool continuation、v1.15.2／v1.15.3 的 PTT Reader 契約。沒有 embeddings、圖片封存、永久 message ID mapping、Vector DB、額外 Queue、外部資料庫、新 provider 或 Search budget 變更。

Sheet schema / migration：**none**。新 Trigger：**none**。新 Script Property：**none**。既有環境不需執行 setup／migration；首次建置仍依 README 執行原有 setup。GAS runtime 檔案維持 23 個，沒有新檔案。

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

- `AI_CALL_METADATA` 保留 provider-normalized input／cached／uncached／output／reasoning／total tokens、elapsedMs、Web Search、sourceCount 和 required evidence 狀態，新增 modelCalls、requiredEvidenceReads、clientToolCalls、continuationCount、contextTextChars、toolDefinitionChars。後兩者是文字與工具定義字元數，**不是 tokenizer 或美元估算**；不記 prompt、對話、圖片摘要、工具正文、thinking、URL 正文或 secret。
- 短期 history 的六輪 user/assistant 上限不變。當 required ConversationLog evidence 已在短期 history 中有相同使用者文字時，只保留 evidence 的時間／provenance 與 `inShortTermHistory=true`，避免再次塞入同一段文字。不同 provenance 的記錄不去重。
- 普通 `general_chat` 與圖片 memory task 的閒聊／當輪創作不預載 WeeklySummary；明確「之前／上週／延續／回顧」等舊脈絡問題仍預載。明確要求週封存時由原 required `get_weekly_memory` reader 取得一次，避免先預載又重查。短期 history 與 required evidence 保證不因此略過。
- 固定 base system 與工具規則放在動態 WeeklySummary／required evidence 之前，以利重複 prefix。DeepSeek 官方 disk context cache 自動啟用、命中取決於完整 prefix；`cache_control` 在 DeepSeek Anthropic 相容層被忽略。Chat Completions／Responses usage 有 cache 欄位；目前 active Anthropic Search transport 未確認回傳等價 hit/miss 欄位，因此不宣稱實際 cache hit 改善。
- 一般聊天的五個只讀 client tools 與 server Web Search 仍可用；圖片工具仍由當次問題縮小。工具只讀、scope 由可信 caller 注入；明確 evidence 在第一輪前讀取，最多一次 continuation。Search `max_uses=3` 保留，明確 Search 失敗時 fail closed。沒有因省 token 改低正式聊天、Search、研究或重要 JSON task 的 HIGH effort；只有專屬群組靜默 caption 使用 non-thinking。

## Reader

Generic Jina 文字與 legacy AI 抽取結果仍檢查最短長度及原有 extraction confidence；錯誤頁判斷改看頁面標題或短頁開頭的明確 challenge／拒絕標題。正文中任意提到 Cloudflare、Access Denied、403 Forbidden、Just a moment、Enable JavaScript 不再直接判整頁失敗。HTTP 狀態、SSRF、Reader route、Queue retry、noAi、absolute deadline 與 fallback 未改。

PTT 已驗證 article 的 HTTPS canonicalization、over18、結構驗證、metadata／push／footer 移除、非空正文、最多一次 Jina、404／410 不 fallback 保持 v1.15.2／v1.15.3 契約。Generic detector 只局部改善；複雜 CAPTCHA／登入頁分類仍可能需要後續真實樣本。

## Runtime 與部署

23 個 active `.gs`：`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`、`50_DataCleanup.gs`。數字前綴僅供導航，不代表 GAS load order。

本版需手動同步的修改檔案：`01_Main.gs`、`03_ResponseTexts.gs`、`05_Storage.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`14_AiTools.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`。完整重建時應使用同版全部 23 個 runtime source。`README.md`、`CURRENT_VERSION.md`、`AGENTS.md`、`99_changelog.md` 與 `tests/v1140_smoke.cjs` 不部署至 GAS。維護者建立 GAS version 並更新既有 Web App deployment；Git 合併本身不部署。

沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 非 active runtime 必需。既有 `doPost`、`processWebTaskQueue`、`processNewsUrlQueue` 與 Trigger 名稱不變。保留 PendingReplies acknowledge-after-send、LINE 同批 webhook 40 秒 absolute deadline 與原有 Reader／AI 餘裕檢查。

## 驗證與限制

本機 `node tests/v1140_smoke.cjs` 使用 Node 內建模組與 GAS／LINE／Sheet／DeepSeek mocks，涵蓋 sidecar 分離與失敗、群組 silence／限頻、衍生記憶搜尋與 scope、封存／清理、context fixture、required evidence、generic Reader 與 PTT 回歸。`git diff --check` 應通過。未能本機執行 GAS，也沒有真實 LINE／DeepSeek／Jina／Sheet 呼叫；真實模型是否穩定輸出 sidecar、non-thinking 圖片辨識品質與群組 webhook 延遲仍需部署後 smoke。

建議 production smoke：私訊直接圖、引用圖片、群組直接圖無回覆／限頻、群組引用加 `#小浣`、同聊天室以品牌／作品名回顧圖片、跨聊天室不可見、`#封存本週話題` 不將 derived 當人話、`#清空紀錄` 一起清除、閒聊與「上週聊過」比較 metadata、明確 Search／required evidence、一般文章正文含錯誤頁詞、真正 challenge 頁與 PTT direct／Jina／404。查看安全 metadata 的模型次數、input/cached tokens、耗時；勿輸出原圖、Prompt 或工具正文。

官方契約：[DeepSeek Vision](https://api-docs.deepseek.com/guides/vision/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[Context Caching](https://api-docs.deepseek.com/guides/kv_cache/)、[Anthropic compatibility](https://api-docs.deepseek.com/guides/anthropic_api/)、[Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)。
