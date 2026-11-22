# CURRENT_VERSION

## 版本與程式依據

MEGA浣 / 小浣 **v2.0.0 Gemini Architecture Edition**（2026-11-22）。工作分支為 `feature/v200-gemini-migration`，開發基準為 `main` 的 `ad0e861`。以同版 `.gs` 為程式契約，實際提交、推送與合併狀態以 Git refs 為準。GAS production deployment 與 LINE 驗收由維護者手動完成。

## 本版邊界

- Google Apps Script 共 22 個活躍 `.gs` 檔，包含保留供診斷與相容使用的 `15_DeepSeekProvider.gs`。Gemini 是唯一啟用的供應商，DeepSeek 維持 dormant，不參與自動降級。完整檔案表見 [README.md](README.md)。
- 新聞封存集中在 `36_NewsArchive.gs`，`PendingReplies` 交付移至 `05_Storage.gs`，新聞分鐘排程有獨立的 `installNewsUrlQueueTrigger()`。舊安裝入口只清理舊快讀排程並重建新聞排程。
- 退場指令為 `#新聞問答`、`#節目話題分析`、`#統整話題`、`#畫重點`、`#封存本週話題`、`#懶人包`，以及 `#清空重點`、`#清空快讀`。移除 `get_topic_highlights` 和三個舊檔 `25_WebTaskQueue.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`。
- 保留私訊與群組聊天、QuoteLookup、圖片分析與研究、群組靜默收件與私訊網址收件。`#本週新聞` 保留預設、精簡、詳細、高潛力、分類與診斷。`#封存本週新聞` 保留手動及週三固定週期，`#新聞補充`、`#狀態回報`、`#清空封存` 與 `PendingReplies` 照常使用。
- `setupLogSheet()` 只初始化 `ConversationLog`、`WeeklySummary`、`NewsUrlQueue`、`NewsInbox`、`PendingReplies`，v2.0.0 不新增資料欄位或分頁。保留 `TopicHighlights`、`WebTaskQueue`、`WebSummary` 歷史分頁及 `WeeklySummary` 舊 `topic` 列的讀取相容。沒有自動刪表、搬移或回填。`#清空封存 確認` 仍清除本聊天室的**全部** `WeeklySummary` 列，包含舊話題封存。
- 本版未接入 Gemini `url_context`、其他 AI 供應商、外部 Reader、Node／npm 執行環境或 LINE 主動推播。網址讀取沿用 [Reader 路徑](#網址讀取與資料邊界)。

## Gemini 任務路由

以下是 `11_AiProfiles.gs` 的發版配置。模型順序為 Hydrogen（`gemini-4-hydrogen`）→ 3.8 Flash（`gemini-3.8-flash`）→ 3.5 Flash-Lite（`gemini-3.5-flash-lite`）。表內候選依序嘗試，送出前逐一檢查能力、配額與推理等級。

| 任務 | 起點 | 推理強度 | 降級候選 | 輸出上限 / 任務逾時 |
| --- | --- | --- | --- | --- |
| `weekly_editorial_digest` 週編輯台 | Hydrogen | `medium` | 3.8 Flash → 3.5 Flash-Lite | 10,000 tokens / 60 秒 |
| `archive_news` 新聞封存 | Hydrogen | `medium` | 3.8 Flash → 3.5 Flash-Lite | 7,000 tokens / 60 秒 |
| `general_chat` 聊天 | Hydrogen | `low` | 3.8 Flash → 3.5 Flash-Lite | 4,800 tokens / 45 秒 |
| `multimodal_research` 圖片研究 | Hydrogen | `medium` | 3.8 Flash → 3.5 Flash-Lite | 8,000 tokens / 60 秒 |
| `image_analysis` 圖片分析 | Hydrogen | `low` | 3.8 Flash → 3.5 Flash-Lite | 8,000 tokens / 60 秒 |
| `news_analysis` 新聞分析 | Hydrogen | `low` | 3.8 Flash → 3.5 Flash-Lite | 8,000 tokens / 60 秒 |
| `news_memory_bridge` 新聞封存比對 | Hydrogen | `low` | 3.8 Flash → 3.5 Flash-Lite，限派送前選擇 | 5,000 tokens / 90 秒 |
| `raw_html_extraction` 舊版 HTML 抽取 | 3.8 Flash | `low` | 3.5 Flash-Lite | 28,000 tokens / 90 秒 |
| `manual_news_supplement` 人工新聞補充 | 3.5 Flash-Lite | `low` | 無 | 5,000 tokens / 60 秒 |
| `image_semantic_caption` 靜默圖片摘要 | 3.5 Flash-Lite | `minimal` | 無 | 1,024 tokens / 10 秒 |

同步 LINE webhook 同一批事件共用 40 秒總預算，單次 AI 呼叫上限 30 秒。JSON Schema 用於週編輯台、封存、新聞分析與手動補充，仍須通過程式的資料驗證。`raw_html_extraction` 沿用 `legacyJson: true`，只要求 JSON 格式。只讀工具最多一次續接，沿用同一模型與 Key。圖片僅接受單張 JPEG/PNG，原圖上限 4 MiB，Gemini 請求上限 8 MiB。

### Script Properties 與雙 Key

| 屬性 | 用途 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE 回覆與讀取圖片 |
| `SPREADSHEET_ID` | 既有資料試算表 |
| `GEMINI_API_KEY` | 一般聊天、圖片、收件、週報、封存及其他無搜尋的 Gemini 任務 |
| `GEMINI_SEARCH_API_KEY` | 僅在請求實際啟用 Google Search 時讀取 |
| `NEWS_ARCHIVE_CONFIG` | 選用，指定固定週期的聊天室、起點以及自動開關 |

- **免費＋付費雙專案**。一般路徑填免費專案 Key，搜尋路徑填支援 Grounding 的付費專案 Key，各使用自己的 Google 專案配額。
- **同一付費 Key**。Google AI Pro 抵免額已領取並連結至合資格帳務專案時，兩格可同填該專案的付費 Key。兩路都會使用該付費專案，Google 端共用配額與帳務。程式仍按用途分開記錄 `free` 與 `search_paid`，這兩個代碼不表示實際帳務層級。模型存取與抵免額以 AI Studio 的專案與帳務頁為準。 [Google AI Pro 抵免額說明](https://blog.google/innovation-and-ai/technology/developers-tools/google-cloud-credits-gdp-ai-studio/) · [Gemini API 配額](https://aistudio.google.com/docs/rate-limits)
- 一般聊天預設不搜尋，「幫我查／搜尋」等明確要求才啟用 Google Search。圖片研究遇到「最新／查證／來源／即時」也可能觸發。缺少搜尋 Key 只影響搜尋請求，回報 `MISSING_GEMINI_SEARCH_API_KEY`。模型降級時沿用原用途的 Key。日常功能無須 `DEEPSEEK_API_KEY`，憑證值只放 Script Properties。

### 配額、聊天短鎖與診斷

- `17_GeminiQuota.gs` 解析 HTTP 429 的 `QuotaFailure`、`ErrorInfo`、`RetryInfo` 與 `Retry-After`，輸出白名單診斷碼和安全時間。只有明確的非零日額耗盡標為 `quota_rpd`，在 `America/Los_Angeles` 下一個 PT 午夜解除，包含夏令與冬令變化。`quota_rpm`、`quota_tpm`、`quota_unknown` 採短冷卻，缺提示預設 60 秒。`quota_zero` 代表零額度或權限限制，缺提示預設 15 分鐘。 [Gemini API 配額](https://aistudio.google.com/docs/rate-limits)
- `GEMINI_QUOTA_STATE` 由程式按金鑰用途與模型建立，短鎖內重讀、合併、寫回。當日確定的日額阻擋不被短冷卻覆蓋，前一日的遲到 429 不會阻擋新的一天。派送前依序跳過已阻擋或不相容的候選。全部阻擋時零模型 HTTP，回報 `retryNotBeforeMs` 與原因。
- 首輪收到符合條件的 429 時，文字任務至少剩 12 秒、JSON 至少剩 15 秒才可快切一次。逾時、其他 HTTP 錯誤、`quota_zero`、靜默圖片摘要、`news_memory_bridge` 與已進工具續接的請求不在此列。每個同步任務最多兩次模型 HTTP，快切已用完次數時不再續接工具。
- 聊天在短鎖內讀取快取與世代，AI 在鎖外執行。成功後只在同一世代提交，並按完成順序合併到最多六輪的短期記憶。`#reset` 或 `#清空紀錄 確認` 推進世代。遲到回覆仍可送到 LINE，不會寫回已清除或失效的快取。
- `AI_CALL_METADATA` 記 `requestedModel`、`model`、`attemptedModels`、`degraded`、`degradeReason`、`keyScope`、`modelCalls` 與重試時間。無可信數據保留 `null`，記錄不含金鑰、對話、圖片、工具正文或供應商原始錯誤。LINE 搜尋來源須通過 Gemini Grounding 對應與公開網址檢查，最多三筆，保留獨立來源訊息。

## 新聞 Queue、週編輯台與固定封存

- 群組貼網址靜默進 `NewsUrlQueue`。私訊單一網址可同步收到簡介，預算不足時轉背景 Queue。Reader 與 AI 在鎖外，提交時在短鎖內重新核對 `TaskId`、聊天室、狀態與 `StartedAt`。`#清空新聞 確認` 可取消舊任務的遲到結果。
- Queue 依 `retryNotBeforeMs` 延後 `NextRunAt`。零模型 HTTP 的配額預阻擋不計入三次重試額度，純配額等待以原始入隊時間起算七天。實際送出模型請求後收到 429 照既有失敗規則計次。提交狀態不明時先核對 Queue、素材與待回覆，避免直接重設 pending 造成重複寫入。`PendingReplies` 只在 LINE 確認送達後刪除。
- `#本週新聞` 依滾動最近七天查詢，預設與精簡模式保留群組話題、焦點故事線與其他分類新聞。對話資料只取目前聊天室合格使用者文字，與圖片衍生文字分開。長回覆保留完整話題並明示省略的新聞筆數。`WEEKLY_EDITORIAL_CACHE_VERSION` 升為 `v2.0.0`，舊 DeepSeek 編輯台快取自然失效。
- 固定週期為台灣時間週三 12:00（含）至下週三 12:00（不含）。按同聊天室 `NewsInbox.CreatedAt` 與 `Status=ok` 選取。每日中午約 12:00～12:30 檢查，週三開出新到期週期，其餘日期補跑。手動與自動共用防重鍵、短鎖及進度，優先補最早已截止的週期。未設定的聊天室仍可手動封存最近七天。
- 同一期自動嘗試最多三次。全候選先被配額阻擋時保留等待到期時間，零模型 HTTP 不扣嘗試額度，以原 `runId` 核對後復原保留的次數。每日排程實際執行時間可能晚於最早可試時間。實際 HTTP 429 照常計次。`#狀態回報` 顯示進度、配額延後及診斷碼。
- 封存只寫 `ArchiveType=news`。已存在的 `ArchiveKey` 可在中斷後防止重複封存。空期只推進進度，缺表或讀取失敗保留錯誤。`#清空封存 確認` 會取消該聊天室正在執行的封存並移至最新已截止邊界，舊週不回補，下個新週期照常。

## 網址讀取與資料邊界

一般公開頁面先用 Jina Reader，再依既有條件嘗試 Gemini 的 HTML 抽取。X/Twitter 單篇 status 走 FxTwitter。Classic PTT 文章走 HTTPS 與 over18 cookie，驗證文章結構，符合條件時最多一次 Jina。`read_url` 使用唯讀 Reader，禁止再呼叫 AI。`url_context` 尚未接入。

`search_news_inbox`、`search_conversation_log`、`get_weekly_memory` 與 `read_url` 都是只讀，聊天室範圍由程式提供。文字引用只查同聊天室保留的使用者原文，缺原文時會提示補貼。圖片語意摘要是小浣當時的辨識，與使用者文字分開。原圖與影音資料不持久保存。

## GAS 部署與實測

### 上傳 GAS 後的手動啟用順序

1. 備份試算表、GAS 原始碼與 Script Properties，保留既有封存游標。切換前先把既有封存設定的 `autoEnabled=false`，手動卸除舊 `processWebTaskQueue` Trigger，並確認舊執行已結束。有其他帳號安裝的排程時，由各帳號核對。歷史資料保留。
2. 同步同版全部 22 個 `.gs`，新增 `17_GeminiQuota.gs`。從 **GAS 專案**移除 `25_WebTaskQueue.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`，避免舊函式與新來源重複。保留五張活躍表及歷史分頁。填寫上表的 Script Properties，`GEMINI_QUOTA_STATE` 由程式建立。
3. 已完成 v1.17.0 資料建置的專案沿用既有欄位、`NEWS_ARCHIVE_CONFIG` 與進度。首次建置才需 `setupLogSheet()`，從 v1.16.0 或更早升級亦用它補 `QuotedMessageId`／`QuoteStatus`。首次啟用固定封存才需在 `autoEnabled=false` 下設定 `NEWS_ARCHIVE_CONFIG`、執行 `previewNewsArchiveSetup()` 比對舊期間，再執行 `setupNewsArchiveStorage()` 補 `ArchiveKey`、`PeriodStartAt`、`PeriodEndAt`、`ArchiveOrigin` 四欄並建立初始狀態。保留既有期別起點與進度，不刪除 `NEWS_ARCHIVE_STATE_*`。
4. **先更新 Web App deployment**。建立同版 GAS version，更新既有部署並保留 URL。核對 webhook 使用 `doPost`。GAS 觸發器頁面應有每分鐘一個 `processNewsUrlQueue`。缺少或重複時用 `installNewsUrlQueueTrigger()` 重建，再確認已無 `processWebTaskQueue`。
5. **再驗證新版手動入口**。從 LINE `#版本` 確認 `v2.0.0 Gemini Architecture Edition` 和日期。用測試聊天室驗證聊天、搜尋、新聞入庫、`#本週新聞`、`#封存本週新聞` 手動防重及狀態回報，再恢復正式使用。
6. **最後啟用自動封存**。將已驗收聊天室設為 `autoEnabled=true`。確認 `processScheduledNewsArchives` 每日台灣中午只有一個觸發器。初次啟用或需修正排程時執行 `installNewsArchiveTrigger()`。保留測試前既有游標及封存，確認手動與排程交錯只寫一次。

首次設定固定週期可參考以下格式。把聊天室 ID 和起點換成實際值，起點須為帶時區的週三 12:00，並先核對舊封存是否重疊。

```json
{"conversations":[{"conversationId":"group:REPLACE_WITH_GROUP_ID","firstPeriodStartAt":"2026-11-25T12:00:00+08:00","autoEnabled":false}]}
```

### LINE / GAS 上線驗收

- 私訊或群組 `#小浣` 普通聊天使用 `GEMINI_API_KEY`。明確查詢與需要聯網的圖片研究使用 `GEMINI_SEARCH_API_KEY`，並核對獨立來源訊息。確認三個模型在實際專案的可用性與 429 欄位。使用測試部署模擬阻擋，核對 `AI_CALL_METADATA`、下一次可執行時間、重試數與 PT 午夜後的起點。
- 驗證私訊及引用圖片、群組直接收圖的靜默摘要。用同聊天室的文字引用與圖片回顧確認說話者和來源分開。等待模型時執行 `#reset` 或確認 `#清空紀錄`，驗證舊回覆可交付且短期記憶不復活。
- **production smoke 必要檢查**。用真實 LINE webhook 的長 MessageId，沿原始 LINE ID → ConversationLog 寫入 → `Range.getValues()` 回讀，檢查 `typeof value === "string"` 與 `value === 原始 message.id`。已確認文字引用的 `QuotedMessageId` 同樣核對 `typeof value === "string"` 與 `value === 原始 quotedMessageId`。核對跨聊天室查不到原文。
- 驗證群組靜默入庫、私訊網址、`PendingReplies` 送達後刪除與失敗保留、週編輯台長回覆、封存到期與防重。清理測試只在指定測試聊天室執行，核對其他聊天室及歷史分頁完整。

本機 `node tests/v1140_smoke.cjs` 通過 265 項，含 89 項 DeepSeek 相容測試。`node tests/v1170_archive.cjs` 通過 129 項，合計 394 項。未能本機執行 GAS，未執行 live LINE／Sheets／Gemini 或部署。上線驗收須由維護者在實際專案完成。
