# CURRENT_VERSION

## 版本與 source of truth

MEGA浣 / 小浣：**v1.17.0 Weekly News Archive Edition**（2026-10-20），主題「固定新聞週期、防重補跑與完整群組話題」。工作分支 `codex/v1170-weekly-news-archive`，依維護者要求以當時本機 main / `8231700b7faf42f0dfc234a5e87afbac0b139277` 為開發基準。現行 `.gs` 是程式契約的首要依據；實際 Git 提交、推送與 merge 狀態請以 repository refs 為準。工作樹修改、Git refs、GAS production deployment 是不同狀態，正式環境版本與部署驗收由維護者另外確認。

執行環境為 Google Apps Script，資料在 Google Sheets；LINE Messaging API、DeepSeek API、Jina Reader、FxTwitter API 是既有外部服務。DeepSeek Flash 是唯一 active AI provider；Gemini adapter 保留 dormant，沒有自動 fallback。Git 版本與 GAS deployment 不是同一件事。AI agent 工作規則見 `AGENTS.md`，使用方式見 `README.md`，舊版沿革見 `99_changelog.md`。

## 本版邊界

本版新增指定聊天室的固定週期新聞封存，手動與每日排程共用期間、防重、失敗補跑及清理取消；修正週編輯台長訊息優先刪除群組話題，並區分讀取失敗、整理失敗與成功但沒有可提煉主題。包含新功能、bugfix、必要共用 helper 抽取、測試及操作文件；不是 provider 或 Prompt 架構重構。**DeepSeek Flash 仍是唯一 active provider；Gemini 仍 dormant；Luna／OpenAI 未接入**，不改既有模型、HIGH、JSON schema、token／timeout、Search、Reader 或 webhook routing。

保留圖片語意記憶、按需週封存、generic／PTT Reader、Required Internal Evidence、一次 client tool continuation、PendingReplies、正式新聞／週故事線／節目分析與 v1.16.0 provider contract。Search `max_uses=3` 及群組靜默 caption 的 non-thinking 設定不變。沒有新 Queue／Sheet／資料庫／外部服務、Node/npm runtime、GitHub Actions、自架 server 或 LINE push 通知；新增的原生 GAS 時間觸發器只在維護者手動安裝後存在。

本版 GAS runtime 為 24 檔。固定封存需手動 setup 追加 WeeklySummary 四欄及私有 Script Properties；普通查詢不追加這四欄。沒有改既有欄位或歷史資料，舊列不補猜 ArchiveKey、不自動合併或搬移。v1.16.0 → v1.16.1 的 ConversationLog `QuotedMessageId`／`QuoteStatus` 補欄要求仍適用，已完成者不用重跑。既有 LastErrorText／PendingReplies 及 v1.16.1 引用／人格契約保留。

## 固定週期新聞封存

- 期間為 `Asia/Taipei` 每週三 12:00（含）至下週三 12:00（不含）。僅按同聊天室 NewsInbox.CreatedAt 入庫時間與 Status=ok 選取，與新聞發表日期無關；`#本週新聞` 查詢仍是滾動最近七天。跨週才入庫的素材歸入實際入庫週，不追改已完成摘要。
- `#封存本週新聞`：已設定聊天室處理最早未完成且已截止的一週；未設定聊天室維持原本手動最近七天。`autoEnabled=false` 只停自動排程，已設定聊天室的手動入口仍使用固定期間。
- `processScheduledNewsArchives()` 每日台灣時間中午約 12:00～12:30 檢查，週三新增到期工作，其餘日補跑。使用 `atHour(12).nearMinute(15).everyDays(1).inTimezone('Asia/Taipei')`；GAS 為近似時間，不能保證 12:00 準點。依據：[ClockTriggerBuilder 官方契約](https://developers.google.com/apps-script/reference/script/clock-trigger-builder)。
- 每次每聊天室最多一個週期，先舊後新；總檢查預算 180 秒、每次 AI cap 60 秒，輪替聊天室先後以免尾端長期等待。維持原 service deadline，AI 前後均短暫持有 ScriptLock，等待 AI 時不鎖住其他工作。
- ArchiveKey 包含聊天室 SHA-256、news 與精確起迄毫秒，寫入前精確掃描整張 WeeklySummary 防重，不受記憶讀取的最近 100 列限制。摘要寫入／flush 後才推進游標；若進度更新失敗，下次從既有 key 恢復，不再生成摘要。LINE 回覆失敗不撤銷已完成封存。
- 新聞寫入在取得共用 ScriptLock 後才產生 CreatedAt，append／flush 完成後才放鎖；封存來源快照也在此鎖內讀取。先取得鎖並產生截止前時間戳者歸原週；封存先取得鎖時，後續入庫依當下時間歸期。空期與已有新聞的週期同樣受保護。鎖忙不得宣稱收件成功，同步入口回既有 Queue，人工補件回報未完成。背景 Reader／AI 失敗沿用重試規則，Queue 提交失敗另依下節查核。
- 進度包含目前期間、執行 token／五分鐘 lease、自動嘗試數及最近錯誤。過期 lease 可接手；token／游標不符的遲到結果取消寫入。可重試失敗每日一次，同一期自動最多三次（含首次）；不可重試錯誤或達上限須處理後手動補跑。舊週失敗時不越過它處理新週。
- 進度寫入的原生儲存例外可隔日補跑，包含 AI 前的首次領取；明確不可重試的錯誤與三次上限仍保留。`autoEnabled=false` 時，失敗狀態只提示手動補跑，不宣稱隔日排程會處理。
- 不可重試／達上限的狀態，不會被後續 Sheet 恢復檢查失敗改回可重試；已存在的有效 ArchiveKey 仍優先恢復。AI 結果提交最多等鎖 30 秒，且不得超過原 deadline 的剩餘時間，不再呼叫模型；若仍失敗，清除本次 token 並記安全失敗碼。連失敗狀態鎖也拿不到時，只寫本次 token 專屬的 `NEWS_ARCHIVE_STATE_*_FAILURE_*` 安全收據；讀取立即呈現失敗，下一次持鎖更新進度時消化、清除收據，不保存模型內容。Properties 服務也失效時仍以五分鐘 lease／既有 key 保守恢復，需維護者查核失敗紀錄。
- 確實沒有資料只記錄 empty 及推進游標，不呼叫 AI、不新增空摘要。缺表、缺欄、讀取失敗、同聊天室有效來源的無效日期、重複 key 或不完整列均是失敗，不當成空期完成。所有來源必需維持現有 Sheet 契約。
- `#狀態回報` 顯示封存設定、最近完成、待處理週期、嘗試次數及安全錯誤碼。`NEWS_ARCHIVE_STATUS`／`NEWS_ARCHIVE_FAILURE` 僅記安全狀態與代碼，不記素材、Prompt、URL 或完整 exception。自動封存不主動發 LINE 訊息。
- `#清空封存 確認` 同時清除目前聊天室的話題／新聞摘要，取消執行中 token，游標移至最新已截止邊界（不早於首次起點），避免自動復活舊週。下個新週期正常封存，其他聊天室不受影響。清空未完成時須重試原清理指令；不要手動刪進度來補救。
- 所有資料清理，不分是否設定固定封存，從讀取列位置、刪列到 flush 都持有同一把外層 ScriptLock；舊 `deleteConversationLogs` 入口同樣保護。Pending Reply 沿用既有外層鎖，LINE 確認成功後才刪列並 flush，不重複取鎖。清理鎖忙或寫入失敗只回報未完成。

### 上傳 GAS 後的手動啟用順序（本機工作不執行）

1. 維護者審核並合併 PR 後，再同步 GAS 原始碼；備份 WeeklySummary、NewsInbox 與現有 Script Properties，備份與真實 ID／secret 留在私有位置。切換期間先暫停新聞封存指令，保持自動關閉，不安裝新 Trigger。
2. 在 GAS Script Properties 新增 `NEWS_ARCHIVE_CONFIG`。起點是「第一個要封存週期的開始」，必須是帶時區的週三 12:00。範例先保持自動關閉；替換聊天室 ID，日期也需依舊封存確認後選定，**不要原樣套用範例**：

```json
{"conversations":[{"conversationId":"group:REPLACE_WITH_GROUP_ID","firstPeriodStartAt":"2026-10-21T12:00:00+08:00","autoEnabled":false}]}
```

3. 執行 `previewNewsArchiveSetup()`，在執行紀錄查看 `NEWS_ARCHIVE_PREVIEW`：依設定順序顯示 configIndex、第一期起點、最新截止、依目前游標計算的待跑數及舊封存日期。它不補欄、不寫進度、不呼叫 AI。舊列日期無精確時分與來源快照，無法可靠推定覆蓋，先人工比對，不自動補 key 或刪合併。若選 10/21 中午起點，第一期會於 10/28 中午才到期；若希望 10/21 封存，需選 10/14 中午起點並確認舊資料重疊。移動／處理既有 Sheets 由維護者另外決定。
4. 起點確認後，保持 `autoEnabled=false`，執行 `setupNewsArchiveStorage()`。它只在表尾追加 `ArchiveKey / PeriodStartAt / PeriodEndAt / ArchiveOrigin`，保留前 16 欄、舊資料及其他自訂欄位置，初始化已設定聊天室進度，不建立 Trigger。可重複執行；開始處理後若更改 firstPeriodStartAt，驗證會拒絕，不自動重設游標。
5. **先更新 Web App deployment**：建立同版 GAS version，更新既有 Web App deployment 並保留 URL；此時仍保持 `autoEnabled=false`，不要安裝封存觸發器。舊 Web App 仍是滾動七天的手動封存，不能與新自動排程交錯運作。
6. **再驗證新版手動入口**：由 LINE `#版本` 確認 v1.17.0，確認切換前的舊版執行已結束，再於測試聊天室驗收 `#封存本週新聞`、重複手動防重、狀態與 `#本週新聞` 對話整理。驗收通過後才恢復封存指令使用。
7. **最後啟用自動封存**：將已驗收聊天室的 `autoEnabled` 改為 true，再執行 `installNewsArchiveTrigger()`。安裝只替換 handler=processScheduledNewsArchives 的現有觸發器，保留其他排程。由長期維護帳號授權並核對 GAS 觸發器頁面；若其他帳號曾安裝相同 handler，需各自確認移除多餘觸發器。不要刪 NEWS_ARCHIVE_STATE_* 或任意改起點；自動失敗修好原因後用同聊天室 `#封存本週新聞` 補跑。要暫停自動工作，將 autoEnabled 設 false 即可，保留進度與防重資料。

此設定只存在 GAS Script Properties；最多 20 個不同聊天室，未列入者自動關閉。設定錯誤採拒絕處理，不能默默降級成已設定聊天室的舊七日封存。停止自動與移除設定不同：若整個移除聊天室設定，其手動入口會恢復 legacy 七日行為，失去新期間防重保證。停用請優先用 autoEnabled=false。

### 週編輯台修正與現場驗收

共享 LINE splitter 先選完整段落，即使首段少於 1200 字也可採用，再用分類／編號界線；不優先把標題內的編號當切點。若該切點會使後續文字超過剩餘訊息容量，改用每則 4900 字上限切割，避免短前言讓原本可完整送出的聊天／分析／待回覆被截斷；來源 bubble 仍保留第五個名額。硬切、來源與省略提示的截斷共用 UTF-16 配對邊界檢查，必要時切點退一個單位，splitIndexes 使用調整後位置；保留完整字元後仍放不下時，沿用明示省略，不發送半個配對字元。週編輯台沿用同一 splitter，再由 fitter 檢查完整區塊，不再優先 pop 群組話題，容量不足只省略新聞並明示筆數。對話仍只取原本同聊天室、全表尾端最多 2500 列內的合格使用者文字，最新最多 60 則／每則 240 字元／總計 6000 字元；derived 圖片語意、assistant、指令噪音仍排除。

模型確實回空話題、非空話題全數未通過檢查、部分採納及沒有合格對話，分開呈現，不補造主題；ConversationLog 缺表／讀取失敗與 AI／整體驗證失敗另行提示。話題全數被拒絕仍保留本次有效新聞，不追加 AI 呼叫。`WEEKLY_EDITORIAL_STATUS` 記 read 狀態、原始／保留對話筆數、returnedTopicCount／topicCount／rejectedTopicCount／topicValidation、cacheHit、stage 與白名單錯誤碼；未知 itemId 只記固定碼與位置，不記被拒絕原值。

快取改存已驗證結果與安全話題筆數，命中時重驗契約並保留全拒絕／部分採納差異；因此 `WEEKLY_EDITORIAL_CACHE_VERSION` 升為 `v1.17.0`，舊 key 自然失效，不需要清 Sheet 或 migration。模型輸出 schema 不變，拒絕的話題原文與未知 ID 不進快取。

GAS／LINE 實測待部署後執行：測試聊天室先貼一般使用者討論及新聞，核對 #本週新聞 有話題且每則 URL 完整；長列表與超長單則新聞仍保留話題。用已有話題／無主題／來源不可讀樣本核對狀態差異。固定封存於邊界前不能跑、到期後只一列；自動後再手動及反向操作不重複。核對 12:00 邊界歸期、無資料期無空摘要、狀態失敗補跑與最早週優先；清理只在測試聊天室確認，清空後舊週不復活、其他聊天室保留。排程實際執行時間、API 延遲、Sheets flush／權限及真實模型話題品質均未經本機 mock 證明。

## 背景 Queue 提交與清理

NewsUrlQueue、WebTaskQueue 的完成／失敗／重試提交，不使用領取時的列號。領取在 ScriptLock 內標記 processing、flush 並回讀既有 StartedAt；任務只攜帶 TaskId、ConversationId 與本次時間識別。處理前、Reader 後、下一個網址前及提交時，重新按唯一 TaskId 定位，核對聊天室、processing 與 StartedAt。空白或重複 ID 拒絕領取；讀表／schema 錯誤回報失敗，不當成任務消失。

提交與清理共用既有 ScriptLock，重新核對後才保存 NewsInbox／各網址的 WebSummary／PendingReplies，flush 輸出與欄位後才設定 done、failed 或 pending，再 flush 並釋放鎖。Reader／AI 仍在此資料鎖外執行；一般聊天／節目分析的既有 AiService memory lock 保留。快讀先把各網址成功或失敗結果留在記憶體，通過提交檢查後才保存。公開 handler、既有欄位、批次上限（新聞 2／Web 1）及 Reader／AI timeout 不變，沒有新增 Queue 欄位、Script Property、Trigger 或 migration。

`#清空新聞 確認`、`#清空快讀 確認` 刪除目前聊天室 Queue 列後，舊工作以 cancelled 結束，不重建素材或失敗通知；已發出的 HTTP 無法撤回，遲到結果會丟棄。其他聊天室仍能在刪列後正確定位；同聊天室重新入隊的新 TaskId 也照常處理。已存在的 PendingReplies 不在這兩個清理範圍，另用 `#清空待回覆`；單獨清空待回覆不取消正常 Queue 工作。二段確認與資料表範圍不變。

前置檢查最多等鎖 1 秒，提交最多等鎖 5 秒，重用同一次模型結果。新聞 Reader／AI 失敗仍按原次數與退避規則補跑；Web 逐網址失敗仍保存失敗紀錄並維持原回覆格式。鎖忙、資料寫入或 flush 失敗屬提交問題，不再當成 AI 失敗重跑或追加第二份失敗通知。`QUEUE_TASK_STATUS` 只記 Queue 名稱、安全狀態與白名單錯誤碼，不記 TaskId、聊天室 ID、URL 或原始 exception。

**提交鎖持續忙碌或寫入結果不明時需人工查核**：任務可能仍為 processing；先核對 Queue、素材與 PendingReplies，再決定是否補處理，不直接重設為 pending 或重跑模型。Google Sheets 多表寫入沒有交易回復，輸出已保存但 Queue 狀態未成功落盤時可能留下部分結果；本版不新增自動接手／lease 機制，也不承諾跨表 exactly-once。原 Pending Reply 送達後 acknowledge 中斷仍可能重送。

上傳與部署後的 Queue 人工驗收（本機未執行）：以兩個測試聊天室建立新聞、快讀與網址節目分析工作；分別驗證只刪除前方其他聊天室列、處理中清空自己、清空後新入隊，以及多網址混合成功／失敗。核對其他聊天室任務與來源資料不變、舊結果未復活、正常結果只產生原有通知，並回讀 StartedAt／狀態。兩套新舊程式不得混跑；待舊 handler 執行結束後，再以同版程式驗收。既有固定封存補欄與觸發器仍依前述人工啟用順序處理。

## 錯誤回覆與診斷

- 沿用穩定的 `errorType`／`retryable`，新增白名單 `errorReason`。既有 adapter 欄位仍必填；診斷擴充可缺省以保留舊 caller 相容，但若提供未知值、錯誤型別，或成功結果帶失敗原因，guard 會拒絕。Builders 固定輸出此欄，成功為空字串，失敗無細項時使用既有 errorType。
- 供應商 adapter 分類已確認的工具錯誤、結果結構、來源欄位、ID 配對／重複、pending、pause 及內部協議文字；原拒絕條件、HTTP 嘗試數、用量與搜尋完成觀測保留。`errorReason` 穿越 service、一次 continuation、typed Error 與 legacy Reader，不傳遞原始工具內容。
- LINE 顯示中文原因、處理方向及大寫代碼；取得有效 HTTP 狀態才附上狀態碼。`AI_CALL_METADATA.errorReason` 使用同一代碼的小寫值。HTTP 200 仍可能有工具錯誤；未取得回應與本機時間不足分開，不能據此宣稱使用者網路故障。未知供應商 error_code、exception／body、query、來源 URL、reasoning 或 secret 不進診斷碼與錯誤回覆。
- Reader 顯示已知錯誤大類及 HTTP 狀態，不再列出登入／擋爬蟲等未確認原因。已完成搜尋後生成失敗時，回覆明示搜尋已執行但完整回覆未完成；失敗答案不保存。原 Queue retry/backoff、群組靜默、PendingReplies 傳送成功才 acknowledge 的契約不變。
- 內部工具保留欄位不可用、讀取失敗、回傳過大與網址工具失敗；診斷欄留在 service，不加入模型的 tool data。圖片下載保留 HTTP 狀態，下載逾時與本機 deadline 不足分開，確認非圖片引用也有獨立代碼。
- 本輪 review 修正在共用 `getBotTextAiError_()` 顯示可信 `usedWebSearch === true` 的觀測；長度上限、空答案、本機時間不足及必要資料失敗都交代「搜尋已執行，但完整回覆沒有完成」。搜尋專用 helper 避免重複前綴，保留原診斷碼與圖片／指定資料／封存提醒。沒有 metadata、字串 "true"、只有來源或搜尋意圖都不能推定已搜尋；保留前輪合法觀測與後輪失敗原因，不擴大宣稱完整查證。

| 代碼例子 | 可確認的情況 |
| --- | --- |
| API_NO_RESPONSE / AI_TIMEOUT / LOCAL_TIME_BUDGET | 未取得有效 HTTP 回應 / API 逾時 / 本機執行時間不足 |
| AI_AUTH_ERROR / AI_RATE_LIMIT / AI_PROVIDER_HTTP_ERROR | 驗證或存取拒絕 / API 限流 / HTTP 錯誤，附實際狀態 |
| MISSING_DEEPSEEK_API_KEY | 缺少 active provider 的 Script Property，只顯示名稱 |
| SEARCH_UNAVAILABLE / SEARCH_RATE_LIMIT / SEARCH_LIMIT | 工具回報不可用 / 限流 / 本次使用次數上限 |
| SEARCH_NOT_EXECUTED / SEARCH_PENDING / PROVIDER_PAUSED | 無搜尋執行紀錄 / 缺對應結果 / paused turn 未完成 |
| SEARCH_RESULT_MISMATCH / SEARCH_RESULT_DUPLICATE | 搜尋呼叫與結果錯配 / 識別碼重複 |
| SEARCH_SOURCE_URL_INVALID / SEARCH_SOURCE_TITLE_INVALID | 來源網址格式或安全檢查 / 標題型別未通過 |
| API_RESPONSE_NOT_JSON / PROVIDER_PROTOCOL_MARKUP | 非 JSON HTTP 回應 / 混入內部工具協議 |
| AI_TOOL_DATA_UNAVAILABLE / TOOL_READ_FAILED / TOOL_RESULT_TOO_LARGE / TOOL_URL_READ_FAILED | 資料欄位不可用 / 內部讀取失敗 / 回傳過大 / 網址工具未取得正文 |
| IMAGE_DOWNLOAD_TIMEOUT / QUOTED_CONTENT_NOT_IMAGE | 等待 LINE 圖片下載逾時 / 引用內容不是可用 JPEG/PNG 圖片 |

## 文字引用與說話者

- LINE 文字事件先用可信 conversationId、quotedMessageId 查 ConversationLog，再記錄目前發言；原 Text 不拼入引用或作者前綴。命中條件是同聊天室、精確數字字串 ID、`Role=user`、有效的過去／當時 timestamp 與文字，排除 image_input／image_semantic。assistant log 的 MessageId 是觸發文字 ID，不是小浣出站 ID，永遠不作引用原文。完全一致的重複 user rows 可命中，作者／內容／時間／引用 metadata 衝突則失敗；不承諾 webhook 全域 exactly-once。
- `QuoteStatus`：`none` 無引用；`text_found` 取得可信原文；`not_found` 在視窗內未找到；`failed` ID、資料、讀取或期限異常；`unsupported` 命中本版不支援的使用者輸入。舊列空白在 context 表示 `unknown`，不代表當時沒有引用。只有 `text_found` 寫目標 ID；其餘狀態不保存未解析或媒體 ID。此欄記錄文字 lookup 當時結果，不把失敗反推為圖片。
- 新 MessageId／QuotedMessageId 用 Sheets 的前置單引號 literal escape 寫入，getValues 應讀回原始字串；沒有先數值化再改格式。lookup 不接受 Number 或科學記號，已失真的舊 ID 不修復。圖片事件的所有 log（含 assistant）與 derived 的 MessageId 留空，修補先前 assistant image reply 可能沿用觸發圖片 ID 的缺口；不清洗既有列。
- 已確認文字直接走文字路徑，即使當前用了舊「看圖」指令也不下載文字 ID。其他引用仍未知，原有私訊／群組 #小浣 的圖片探測、JPEG/PNG、安全下載及錯誤語意保留。未觸發群組文字可留下已確認引用，但不增加 AI、下載或一般 Bot 回答。Pending Reply 是既有交付例外：任何文字訊息均優先嘗試交付，普通群組 reply 不追加「重新引用」提醒，普通網址在交付時仍經原 helper 靜默收件；只有已觸發的文字引用問題才附「引用問題尚未處理」提醒，且不再呼叫 AI／Reader 或收件。傳送成功後才 acknowledge 的契約不變。
- 每個 execution 的引用 lookup 惰性讀取一次尾端最多 **500 列**快照，所有聊天室共用這個列數視窗，再按 scope 過濾。直接引用 **2,000 字元**、最多一層已記錄上游 **1,000 字元**；六輪 history 至多回填六個直接引用，不遞迴，全部引用 JSON **6,000 字元**上限（escaping 超限會繼續裁切並標記）。直接查找不另設 30 天限制，原文仍在範圍且 ID 完整即可命中；既有 research 的 30 天／500 列限制不變，其讀取與引用快照分開計算。
- Sheet 讀取前後檢查同一 webhook deadline，保留 8 秒回答餘裕，引用快照約 **2 秒軟上限**；GAS Sheet RPC 不能中途取消，超時結果丟棄為 failed。無引用且沒有 history 引用時不新增 Sheet 查詢。原文找到不代表外部事實已查證。
- 六輪 history 只增加白名單作者／文字 messageId／quoteStatus／已確認 quotedMessageId，不保存引用 evidence 或媒體 ID。模型端統一轉匿名代稱，當前使用者、其他成員、小浣與未知作者分開；原 UserId 不放進模型文字。舊 cache、legacy caller 沒有作者時保守降級。ConversationLog tools 同時帶來源與作者；圖片摘要的分享者不等於摘要作者。
- `CONVERSATION_TURN`／`TEXT_QUOTE_CONTEXT`／工具結果是資料，當前 user 問題獨立保留；router、required research 與 Search intent 不解析引用。只有當前已要求讀網址、且未提供網址時，才可用精確引用內唯一安全 URL 補足對象。引用中的「搜尋／清空／忽略規則」不新增操作意圖。
- history 與 evidence 只有同一精確文字 messageId、作者、來源及相容完整文字才去重；缺 metadata 不去重。週編輯台保留不同作者的相同文字，並帶入所選素材之間的引用代碼；沒有原文時明示素材缺失，不補猜。週編輯台與近期對話／封存素材增加輸入欄位 `speakerIdentityKnown`：false 只表示作者身份未知，多筆未知作者不能據此判斷為同一人，也不能判斷為不同人；不更改模型輸出 schema／business validator。節目分析的素材與 memory 共用作者對照。
- 不新增引用快取。`#reset` 清現有短期 history（含新 metadata），不刪 Sheet；`#清空紀錄 確認` 刪目前聊天室的所有 ConversationLog rows 並清 history。後續引用重新讀 Sheet，不從另一份 evidence cache 復活；其他聊天室與已獨立封存的 WeeklySummary 維持原清理範圍。

## 人格與 Prompt 分層

共用人格是住在群組、喜歡翻垃圾找寶物的浣熊夥伴，靠好奇與輕巧幽默呈現，不固定口癖或動作。普通聊天自然收尾，問候／代號／記憶測試簡短；認真或焦急時先處理問題。Podcast 只是背景；節目風格、主持切角、SEO 與錄音用途留在相關 task。自然語言明確要求節目段落仍可協助文字整理，但不虛構收件／保存。

v1.16.2 在相同人類回覆 Prompt 中增加具體反差、短比喻、接梗與輕巧吐槽，參考目前對話避免複製上一輪的起手式、收尾和笑點。簡單問題保持俐落，需要深入時以例子、比較、細節與實際影響豐富內容；不增加隨機模板、持久狀態或改寫模型呼叫。錯誤診斷文案固定清楚，不靠角色表演掩蓋故障。自然度與多樣性仍須實際多輪抽樣驗收。

證據規則獨立於角色：保留日期、數字、型號與代號，分清事實／主張／推測／未知，不造熱度起源或工具執行。JSON／分類／抽取／封存走機器任務規則與原 schema／validator，不套可愛前言；圖片嚴謹程度取決於問題而非是否有圖片。固定來源 bubble、只讀工具與 required evidence 不變。

`news_memory_bridge` 使用相同證據規則及專用 factual Prompt，不套完整人格或 JSON 指令；沒有關聯回空字串，有關聯以「過去脈絡：」開頭、最多 3 點。HIGH、5,000 tokens、90 秒 profile 上限與既有 webhook deadline／失敗 fallback 不變，不增加模型呼叫。

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

24 個 active `.gs`：`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`、`15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`36_NewsArchive.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`、`50_DataCleanup.gs`。數字前綴僅供導航，不代表 GAS load order。

從完整 v1.16.2 升級需手動同步 **12 個 runtime 檔**：`00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`04_Utils.gs`、`05_Storage.gs`、`25_WebTaskQueue.gs`、`30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、新增 `36_NewsArchive.gs`、`45_TopicFeatures.gs`、`50_DataCleanup.gs`。若部署基準不確定，使用同版全部 24 個 `.gs`。Markdown、AGENTS 與 tests 不部署至 GAS。

v1.17.0 必須同步上述檔案，不能只同步新增檔。AiService／Provider、人格 Prompt、搜尋驗證與既有 task 預算不變；webhook router 僅補清理失敗回覆，保留二段確認與其他路由。自動封存以原 archive_news 任務執行新到期或待補跑週期，不改其他工作呼叫次數。

固定封存補欄與啟用依前述手動順序，實際 Sheets／Properties／Trigger 尚待維護者處理。從 v1.16.0 或更早版本升級時，另須先備份 Sheet 並執行 `setupLogSheet()` 補齊 ConversationLog 的兩個引用欄位。

沿用功能的 GAS／LINE 人工驗收（本版未執行 live）：`#版本` 顯示 v1.17.0；私訊／group／room 搜尋與圖片研究正常產生來源；錯誤回覆的代碼對應 `AI_CALL_METADATA.errorReason`，原文與秘密不外傳；封存／直接網址及背景通知保留原因。不要為了誘發故障更改正式 API Key。新封存與週編輯台驗收見前述清單。

1. 若 ConversationLog 尚未完成 v1.16.1 引用補欄，先備份 Spreadsheet，再以同版 `setupLogSheet()` 補欄並檢查舊列數／內容及欄位。已完成者不用重新執行；引用功能沒有歷史回填，也不用新增 Trigger／Property。固定新聞封存的新增設定另依前述執行。
2. 維護者建立 GAS version、更新既有 Web App deployment，保留 URL。部署版本與驗收由維護者另行確認，Git 合併不會自動部署。
3. 測試聊天室讓甲貼文字、乙插話、丙引用甲加 `#小浣`；檢查回覆作者與目標正確，ConversationLog.Text 仍只有丙的新發言。接著自我引用、無 trigger 引用、下一輪不同成員追問。
4. **Deployment / production smoke 必要 gate（未執行 live，mock 不代表通過）**：用真實 LINE webhook 的長 MessageId，走 `原始 LINE message.id → ConversationLog writer → SpreadsheetApp getValues()`，逐項確認 `typeof value === "string"` 與 `value === 原始 message.id`。已確認文字引用的 QuotedMessageId 同樣核對 `typeof value === "string"` 與 `value === 原始 quotedMessageId`。確認 assistant 同 ID 不成原文、跨聊天室不命中；文字引用不呼叫 LINE content endpoint，圖片引用照常且媒體目標 ID 不落新欄。
5. 測試 missing quote／讀取失敗、引用內搜尋與清理字樣、`#reset`、二段 `#清空紀錄` 後再次引用；清理用測試聊天室執行。另測新聞收件、週編輯台故事線、required evidence 與 PendingReplies 交付。
6. 建立測試 Pending Reply，分別以群組 `#小浣` 文字引用及私訊引用觸發，確認交付舊結果並提示重新引用，無額外 AI／Search／Reader／Queue；未觸發 group／room 的普通文字與 reply 也必須交付舊結果，但不追加引用提醒或一般 AI 回答。普通網址需同時照原路徑靜默收件。再驗圖片／research URL 提示、傳送失敗保留 pending 後重試與週編輯台未知作者語意。

沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`；`GEMINI_API_KEY` 非 active runtime 必需，也不需 `OPENAI_API_KEY`。Secret value 只放 GAS Script Properties，不放 source、fixture、文件範例、Sheet、console 或 metadata。既有 `doPost`、`processWebTaskQueue`、`processNewsUrlQueue` 與 Trigger 名稱不變。保留 PendingReplies acknowledge-after-send、LINE 同批 webhook 40 秒 absolute deadline 與原有 Reader／AI 餘裕檢查。

## 驗證與限制

v1.17.0 修改前在本機 main `8231700` 實跑既有 254 checks 通過；PR 初版 `fcc90c0` 為 302 checks，九項修正 `ba20434` 為 326 checks，Queue 補修 `2c1616b` 為 366 checks，三項補修 `e881e9e` 為 374 checks。本輪 Unicode 邊界修正後，`node tests/v1140_smoke.cjs` **24 GAS sources、474 unique functions、254 checks 通過**，`node tests/v1170_archive.cjs` **125 checks 通過**，合計 **379 checks**。新增 5 項檢查涵蓋自然／強制切點附近的配對字元、splitIndexes、四／五則正文與實際 LINE payload、來源與省略提示截斷、完整字元造成的容量不足、Queue 待回覆交付及週編輯台話題／完整網址／省略數。前輪 8 項儲存恢復與長回覆修正，以及原有兩套 Queue、固定封存、防重補跑、截止入庫、跨聊天室清理、話題快取與啟用順序回歸繼續通過；原 fixture 與有效斷言保留，`git diff --check` 通過。Runtime 僅用既有字串／正則能力，不依賴新套件；Unicode 完整性斷言只在 Node 測試中使用。實際 AiService／Provider 與 LINE router 使用 mock 下游；沒有真實 GAS／LINE／Sheets／AI 呼叫，不能證明排程時間、權限或模型品質。

v1.16.2 前版 review fix：修改前在 `817676c` 實跑 245 checks 通過；先新增測試重現「已搜尋但 length 回覆缺提示」（預期 1 次、實際 0 次），修正後 `node tests/v1140_smoke.cjs` **23 GAS sources、444 unique functions、254 checks 通過**。新增 9 項參數化檢查：實際私訊／group／room 與圖片入口的長度、deadline、空答案；文字／圖片必要資料失敗；continuation 的 HTTP／搜尋／長度錯誤；未搜尋／pending／malformed／工具錯誤；read_url 來源；舊 caller／typed Error／嚴格布林／不改 metadata；成功回覆與來源 bubble。原 245 項有效斷言保留，partial answer 不進 LINE、Cache 或 Sheet，固定診斷紀錄保留。未執行 live，仍須正式環境確認後段失敗提示、正常來源 bubble 與既有圖片／查詢提醒。

v1.16.2 `817676c` 基線：**23 GAS sources、444 unique functions、245 checks 通過**（保留 233 項基線，追加 12 項診斷／安全／跨流程及 Prompt 邊界檢查）。新增測試包含六種已知 Search tool error 與未知 code、私訊／group／room、pending／pause、來源與配對、零 HTTP、缺 key、時間不足、continuation、舊 adapter 相容、typed Error／Reader、封存／同步新聞／背景通知、圖片下載與內部工具原因。Mock 的 Prompt 斷言不證明真實模型更有趣。

v1.16.1 基線 `node tests/v1140_smoke.cjs`：**23 GAS sources、441 unique functions、233 checks 通過**。v1.16.0 基線 202，v1.16.1 基礎新增 22，上一輪 review 新增 8；最後一輪修改前實跑 232 通過，將一項錯誤的「未觸發保留 pending」測試替換為兩項原交付契約測試，並擴充 transport 失敗重試覆蓋。原 22 項 v1.16.1 與其他有效 review checks 保留。全程使用 Node 內建模組及既有 GAS／LINE／Sheet／provider mocks；不是新增 Node runtime。保留新聞收件／JSON business validators、週故事線、sidecar、群組 silence／限頻、required evidence、PendingReplies、Reader／PTT、provider registry／contract／deadline／usage 回歸。既有 writer mock 配合表頭寫入，dedup fixture 改以精確作者／ID 驗證，引用加 research 的 fixture 反映各一次 bounded read。

Review fix 覆蓋：私訊／group／room 的 pending 文字引用；未觸發 group／room 的普通文字、可信文字引用及未知引用照常交付但無引用提醒；普通網址透過 enqueueWebTaskFromCurrentMessageIfNeeded_／handleSilentNewsUrlMessage_ 進新聞入隊入口；固定指令不誤報；圖片／research URL 提示；有無 trigger 的 router 傳送失敗保留 pending；實際 machine request 的未知身份 boolean；news memory bridge 的人格隔離／空值／錯誤 fallback；merge-neutral 文件與 live ID gate assertions。

v1.16.1 基線測試直接檢查模型 request、Sheet、cache 與副作用：插話後引用／自引／他引、群組與 room 靜默、assistant 同 ID 排除、舊列／未知作者／跨聊天室／失真 ID／重複與衝突／讀取失敗、補欄冪等與重排表頭、上游一層／掃描／長度／deadline、下一輪回填與跨作者去重、引用注入不改路由／required intent、圖片相容與媒體 ID 不持久化、reset／清理、素材與 history 作者一致、optional tool provenance、明確讀網址時引用補對象及 Prompt task 隔離。另以 `git diff --check` 檢查格式；provider route／profile／schema／主要預算不變。

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
