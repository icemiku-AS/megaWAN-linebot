# CURRENT_VERSION

## 版本與程式依據

MEGA浣 / 小浣 **v2.2.5 Group Chat Reply Handoff Edition**（2026-11-27）。工作分支為 `hotfix/v225-chat-reply-handoff`，開發基準為 `main` 的 `5d82d20`（v2.2.4）。以同版 `.gs` 為程式依據，實際提交、推送與合併狀態以 Git refs 為準。GAS production deployment 與 LINE 驗收由維護者手動完成。

## 本版邊界

- 修正群組自然接話在等待模型期間遇到同一人補話的情況。符合資格的後一則可以接手一次，重新判斷並以自己的 LINE reply token 回覆。
- Google Apps Script 共 26 個活躍 `.gs` 檔。從 v2.2.4 升級更新 4 個既有 `.gs` 檔，新增檔案、Sheet migration 與新手動 Script Property 均為 0。Gemini 是唯一啟用的供應商，`15_DeepSeekProvider.gs` 保留供相容與診斷使用。 [完整檔案表](README.md#現行架構)
- 本週手動註記與選填開頭點評照常顯示。`#本週新聞` 保留預設、精簡、詳細、高潛力、分類與診斷。`#封存本週新聞`、`#新聞補充`、`#狀態回報` 與 `PendingReplies` 沿用既有流程。
- 既有資料表與排程照常使用。`WeeklySummary` 舊 `topic` 列仍可相容讀取，`#清空封存 確認` 會清除目前聊天室的全部封存。
- v2.0.0 已移除舊快讀、話題與懶人包指令，以及 `25_WebTaskQueue.gs`、`40_TopicHighlights.gs`、`45_TopicFeatures.gs`。舊 `installWebTaskQueueTrigger()` 是重建新聞分鐘排程的相容入口。

## Gemini 任務路由

以下是 `11_AiProfiles.gs` 的發版配置。模型順序為 Hydrogen（`gemini-4-hydrogen`）→ 3.8 Flash（`gemini-3.8-flash`）→ 3.5 Flash-Lite（`gemini-3.5-flash-lite`）。表內候選依序嘗試，送出前逐一檢查能力、配額與推理等級。

| 任務 | 起點 | 推理強度 | 降級候選 | 輸出上限 / 任務逾時 |
| --- | --- | --- | --- | --- |
| `chat_gatekeeper` 自然喚醒守門員 | 3.5 Flash-Lite | `minimal` | 無 | 256 tokens / 8 秒 |
| `bot_daily_state` 角色日常 | 3.5 Flash-Lite | `minimal` | 無 | 256 tokens / 4 秒 |
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

同步 LINE webhook 同一批事件共用 40 秒總預算，單次 AI 呼叫上限 30 秒。自然喚醒的分類與主回答合計最多兩次模型 HTTP，並保留 LINE 回覆時間。每日狀態獨立在整批主回覆交付後才使用剩餘預算。JSON Schema 用於守門員、週編輯台、封存、新聞分析與手動補充，輸出須通過程式驗證。`raw_html_extraction` 沿用 `legacyJson: true`，只要求 JSON 格式。只讀工具最多一次續接，沿用同一模型與 Key。圖片僅接受單張 JPEG/PNG，原圖上限 4 MiB，Gemini 請求上限 8 MiB。

### Script Properties 與雙 Key

| 屬性 | 用途 |
| --- | --- |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE 回覆與讀取圖片 |
| `SPREADSHEET_ID` | 既有資料試算表 |
| `GEMINI_API_KEY` | 自然喚醒守門員、角色日常、一般聊天、圖片、收件、週報、封存及其他無搜尋的 Gemini 任務 |
| `GEMINI_SEARCH_API_KEY` | 僅在請求實際啟用 Google Search 時讀取 |
| `NEWS_ARCHIVE_CONFIG` | 選用，指定固定週期的聊天室、起點以及自動開關 |

- **免費＋付費雙專案**。一般路徑填免費專案 Key，搜尋路徑填支援 Grounding 的付費專案 Key，各使用自己的 Google 專案配額。
- **同一付費 Key**。Google AI Pro 抵免額已領取並連結至合資格帳務專案時，兩格可同填該專案的付費 Key。兩路都會使用該付費專案，Google 端共用配額與帳務。程式仍按用途分開記錄 `free` 與 `search_paid`，這兩個代碼不表示實際帳務層級。模型存取與抵免額以 AI Studio 的專案與帳務頁為準。 [Google AI Pro 抵免額說明](https://blog.google/innovation-and-ai/technology/developers-tools/google-cloud-credits-gdp-ai-studio/) · [Gemini API 配額](https://aistudio.google.com/docs/rate-limits)
- Google Search 依當前分句的查詢對象判定。「幫我查 LINE 的聊天室功能」走外部搜尋，「幫我查我們的新聞有沒有這則」查同聊天室的 NewsInbox。圖片研究遇到「最新／查證／來源／即時」也可能觸發搜尋。缺少搜尋 Key 的明示搜尋請求回報 `MISSING_GEMINI_SEARCH_API_KEY`。守門員、彩蛋和每日狀態使用一般 Key，模型降級沿用原用途的 Key。憑證值只放 Script Properties。

### 配額、聊天短鎖與診斷

- `17_GeminiQuota.gs` 解析 HTTP 429 的 `QuotaFailure`、`ErrorInfo`、`RetryInfo` 與 `Retry-After`，輸出白名單診斷碼和安全時間。只有明確的非零日額耗盡標為 `quota_rpd`，在 `America/Los_Angeles` 下一個 PT 午夜解除，包含夏令與冬令變化。`quota_rpm`、`quota_tpm`、`quota_unknown` 採短冷卻，缺提示預設 60 秒。`quota_zero` 代表零額度或權限限制，缺提示預設 15 分鐘。 [Gemini API 配額](https://aistudio.google.com/docs/rate-limits)
- `GEMINI_QUOTA_STATE` 由程式按金鑰用途與模型建立，短鎖內重讀、合併、寫回。當日確定的日額阻擋不被短冷卻覆蓋，前一日的遲到 429 不會阻擋新的一天。派送前依序跳過已阻擋或不相容的候選。全部阻擋時零模型 HTTP，回報 `retryNotBeforeMs` 與原因。
- 首輪收到符合條件的 429 時，文字任務至少剩 12 秒、JSON 至少剩 15 秒才可快切一次。逾時、其他 HTTP 錯誤、`quota_zero`、靜默圖片摘要、`news_memory_bridge` 與已進工具續接的請求不在此列。每個同步任務最多兩次模型 HTTP，快切已用完次數時不再續接工具。
- 聊天在短鎖內讀取快取與世代，AI 在鎖外執行。LINE 確認送達後，在有效世代與時間界線內按完成順序提交最多六輪的短期記憶。`#reset` 與 `#清空紀錄 確認` 推進世代並設定 `resetAtMs`，切斷自動前文與續問視窗。明示文字引用與週報仍使用各自的資料範圍。
- `AI_CALL_METADATA` 記 `requestedModel`、`model`、`attemptedModels`、`degraded`、`degradeReason`、`keyScope`、`modelCalls` 與重試時間。無可信數據保留 `null`，記錄不含金鑰、對話、圖片、工具正文或供應商原始錯誤。LINE 搜尋來源須通過 Gemini Grounding 對應與公開網址檢查，最多三筆，保留獨立來源訊息。

## 近期對話、自然喚醒與人設

- 群組、多人聊天室及私訊從同一 `ConversationLog` 的尾端最多掃描 500 列，帶入當前訊息之前、最近 4 小時內最多 30 則合格文字，前文總預算 6,000 字元。一般群聊與小浣回覆可入選，純系統指令排除，圖片衍生摘要由既有圖片回憶路徑取用。守門員最多參考 8 則，熱聊時保留已確認送達的前一回。精確 LINE 文字引用優先，近期前文與六輪短期記憶共用成員代稱，以可信訊息 ID 去重。`#reset` 切斷自動前文。
- **明確找小浣**。固定指令、私訊、原生 `@小浣`、任意位置的 `#小浣`、明確點名交辦，以及引用已確認送達的小浣回覆，都跳過守門員與一般 20 秒間隔。群組只有「好」「笑死」等收尾短噪的引用保持安靜。
- **熱聊續接**。小浣送達正常對話、主動插話或新聞點評後開啟 90 秒窗口，群友可交替續接。間隔至少 6 秒，守門員評分至少 4 分，最多連續兩輪。熱聊中「太不吵」「怎麼又裝死」一類省略姓名的虧句也按續聊計數。話題轉走、改叫其他機器人、分數不足或達兩輪時退場。
- **主動探頭**。純閒聊排除網址、指令和短噪，去掉標點與空白後滿 4 字且符合插話條件時進 `chat_gatekeeper`。彩蛋與純閒聊主動插話至少 5 分，和新聞點評共用同房 2 分鐘冷卻。兩類插話使用一般 Key，不開 Search、不寫手動註記。`ENABLE_CHAT_EASTER_EGG` 控制彩蛋與純閒聊主動插話，`ENABLE_CHAT_AMBIENT_BANTER` 可單獨關閉純閒聊探頭。舊版已寫入的冷卻紀錄按原定時間到期。
- 其餘群組候選由 `chat_gatekeeper` 判斷是否直接叫小浣或有工作協作需求。這兩種分類無額外分數門檻，在熱聊窗外仍遵守一般自動回覆的 20 秒間隔。客觀的技術敘述、守門員逾時、配額阻擋或錯誤時保持安靜。
- 正式 webhook 以 `webhookEventId` 先登記再處理。`PendingReplies` 優先使用 reply token，鎖忙時自動接話讓位。同聊天室一次只持有一個回覆處理資格，重設與確認清理可以作廢舊回合。`LINE_CHAT_STATE_*` 保存熱聊與處理狀態。`CHAT_WAKE_STATUS` 只記結果、觸發類型、分數與續聊輪數。
- **補話接手**。同房同一人於前一則後 15 秒內送出另一則符合資格的自然插話或續聊，且舊輪仍在處理、LINE 尚未開始送出時，後一則可以接手一次。新輪以自己的 webhook 截止時間和 reply token，重新載入同房前文並交守門員判斷。接手後再收到符合條件的補話時，仍在處理的輪次立即讓出回覆資格，原作者的自然接話自退場起暫停固定 15 秒。這段時間明確指令與其他群友依各自規則取得資格。獨立 webhook 可交接，同批事件依原順序處理並共用 40 秒預算。`CHAT_WAKE_STATUS` 以 `gatekeeper_reply_after_handoff`、`skipped_stale_reply` 或 `skipped_reply_handoff_limit` 標記結果。
- 一般聊天的靜態 `system` prompt 用《崩壞：星穹鐵道》開拓者式的無厘頭口吻接梗，避開複述與小編式收尾。日常插話與新聞點評以一句約 15～45 字為目標，程式只取第一行非空純文字、上限 100 字元，保留「真的假的？」等短起手後的笑點。近期前文、個人記憶、回執狀態與最近開頭在使用者訊息區組裝。查證與看圖依證據回答，JSON 任務沿用各自的格式，週編輯台只有 `openingComment` 使用小浣口吻。

### 個人記憶與每日狀態

- `MemberMemory` 依 `ConversationId`、`UserId` 保存 `Nickname`、`Notes` 與 `UpdatedAt`。本人可設定稱呼或筆記，用 `#我的記憶` 查看、`#忘記我` 清除。純設定、查看與刪除直接由程式處理，有附帶問題才呼叫模型。個人記憶與本週手動註記分開。
- 稱呼上限 24 字，每人最多 5 條筆記，每條 80 字。讀取快取為 5 分鐘，寫入、更正、清除及 `#reset` 立即使本房快取失效。`#reset` 和 `#清空紀錄 確認` 都保留 `MemberMemory` 的儲存內容。
- 模型可收到當前發言者、可信引用作者或近期脈絡中出現的成員稱呼和筆記。`MEMBER_MEMORY_CONTEXT` 與當前發言者稱呼都放在使用者訊息區。聊天室搜尋沿用同一組代稱與稱呼，原始 LINE `UserId` 只用於程式對照。
- 每日狀態依台灣日期保存在自動建立的 `BOT_DAILY_STATE`，保留最近 3 天、總長最多 1,500 bytes。通常引導生成 40～80 字，程式接受 15～120 字的純文字，折疊換行並允許單一「～」。有正常聊天送達且剩餘預算至少 18 秒時才嘗試，逾時或驗證失敗時略過。生成後從下一輪放入 `LINE_TURN_STATUS.dailyState`，聊到日常時才使用。

## 新聞 Queue、週編輯台與固定封存

- 群組直接貼新聞網址靜默進 `NewsUrlQueue`。私訊單一網址可同步收到簡介，預算不足時轉背景 Queue。明確要求讀取、摘要、分析或比對網址會分流到研究。Reader 與 AI 在鎖外，提交時在短鎖內重新核對 `TaskId`、聊天室、狀態與 `StartedAt`。`#清空新聞 確認` 會清除同聊天室的入庫新聞、Queue 與本週手動註記，並取消舊 Queue 任務的遲到結果。
- `ENABLE_NEWS_URL_COMMENT` 預設開啟，可獨立關閉。成功入隊的單一公開網址，在沒有待回覆衝突、同房 lease 可用且冷卻結束時，優先採用發文附言，再由唯讀 Reader 補標題或前段摘要。外部素材最多 600 字元，按不可信資料處理。`general_chat` 使用一般 `GEMINI_API_KEY`，Search 與內部工具皆關閉。
- 點評同步預算最多 30 秒，仍受整批 webhook 的 40 秒期限約束。Reader 單次設定上限 15 秒，預留 Gemini 8 秒及 LINE 10 秒後，預設整段唯讀讀取最多可用 12 秒。點評送達後啟動 2 分鐘冷卻及 90 秒熱聊，`CHAT_WAKE_STATUS` 記 `news_url_comment`。逾時、缺少可用素材或已在冷卻時照常收件，點評保持安靜。
- Queue 依 `retryNotBeforeMs` 延後 `NextRunAt`。零模型 HTTP 的配額預阻擋不計入三次重試額度，純配額等待以原始入隊時間起算七天。實際送出模型請求後收到 429 照既有失敗規則計次。提交狀態不明時先核對 Queue、素材與待回覆，避免直接重設 pending 造成重複寫入。`PendingReplies` 只在 LINE 確認送達後刪除。
- 使用者明確請小浣把事件註記進本週新聞或週報，即可持久保存，網址選填。優先採用明示引用的原文，對「剛才那件事」也可用同一發言者五分鐘內的上一則有效文字。程式依來源訊息與事件摘要去重，純註記直接確認結果，額外提問才進主回答模型。註記存放在各聊天室的 `WEEKLY_NOTES_*`，滾動保留最近七天，每房最多 30 筆且序列化上限 8,700 bytes。
- `#本週新聞` 依滾動最近七天查詢。預設、精簡與詳細以獨立區塊列出本週手動註記，並標示容量淘汰或篇幅省略的筆數。沒有網址新聞時，有有效註記或合格對話也可整理。分類或高潛力查無符合新聞時回覆無匹配。清理界線在送出註記回執與週報前會重新核對。
- 週編輯台的對話輸入只取同聊天室合格使用者文字，排除純操作語句與圖片衍生摘要。尾端最多掃描 2,500 列，取最多 60 則、每則 240 字元、合計 6,000 字元。選填 `openingComment` 可根據本次新聞與群聊素材寫一到兩句、最多 120 字元的純文字。內部換行折成空白，允許單個「～」。空值、含 Markdown／網址／控制字元等驗證失敗時，或週編輯台走分類備援時，使用中性開場。點評沿用同一次編輯台呼叫，`WEEKLY_EDITORIAL_CACHE_VERSION` 為 `v2.1.0`。
- 固定週期為台灣時間週三 12:00（含）至下週三 12:00（不含）。按同聊天室 `NewsInbox.CreatedAt` 與 `Status=ok` 選取。每日中午約 12:00～12:30 檢查，週三開出新到期週期，其餘日期補跑。手動與自動共用防重鍵、短鎖及進度，優先補最早已截止的週期。未設定的聊天室仍可手動封存最近七天。
- 同一期自動嘗試最多三次。全候選先被配額阻擋時保留等待到期時間，零模型 HTTP 不扣嘗試額度，以原 `runId` 核對後復原保留的次數。每日排程實際執行時間可能晚於最早可試時間。實際 HTTP 429 照常計次。`#狀態回報` 顯示進度、配額延後及診斷碼。
- 封存只寫 `ArchiveType=news`。已存在的 `ArchiveKey` 可在中斷後防止重複封存。空期只推進進度，缺表或讀取失敗保留錯誤。`#清空封存 確認` 會取消該聊天室正在執行的封存並移至最新已截止邊界，舊週不回補，下個新週期照常。

## 網址讀取與資料邊界

新聞背景收件的一般公開頁面先用 Jina Reader，再依既有條件嘗試 Gemini 的 HTML 抽取。X/Twitter 單篇 status 走 FxTwitter。Classic PTT 文章走 HTTPS 與 over18 cookie，符合條件時最多一次 Jina。`read_url` 與群組新聞點評使用唯讀 Reader。點評的 Jina 結果只有標題時可直接使用，正文不足且沒有可用標題時可補讀靜態 `<title>`。`url_context` 尚未接入。

`search_news_inbox`、`search_conversation_log`、`get_weekly_memory` 與 `read_url` 都是只讀，聊天室範圍由程式提供。文字引用只查同聊天室保留的使用者原文，缺原文時會提示補貼。圖片語意摘要是小浣當時的辨識，與使用者文字分開。原圖與影音資料不持久保存。

## GAS 部署與實測

### 上傳 GAS 後的手動啟用順序

1. 備份現有試算表、GAS 原始碼、Script Properties 和觸發器配置，保留封存游標。已開啟固定封存的聊天室在切換期間先暫設 `autoEnabled=false`，並確認執行中的工作完成。
2. 從 v2.2.4 升級至 v2.2.5，同步以下 4 個既有 `.gs` 檔。首次建置或需對齊較舊來源時，同步全部 26 個同版 `.gs`。

   - 更新 `00_Config.gs`、`01_Main.gs`、`03_ResponseTexts.gs`、`08_ChatWake.gs`。

3. 本次升級為 0 個新增檔案、0 個 Sheet migration、0 個新手動 Script Property，沿用既有憑證與排程。新環境用 `setupLogSheet()` 建立資料表。首次配置固定封存時，先在 `autoEnabled=false` 下填寫 `NEWS_ARCHIVE_CONFIG`，執行 `previewNewsArchiveSetup()` 比對舊期間，再用 `setupNewsArchiveStorage()` 建立封存欄位與初始狀態。
4. **先更新 Web App deployment**。建立同版 GAS version，更新既有部署並保留 URL，核對 webhook 使用 `doPost`。確認每分鐘一個 `processNewsUrlQueue` 觸發器，缺少或重複時用 `installNewsUrlQueueTrigger()` 修正。既有 v2.0.0 專案應已移除舊 `processWebTaskQueue` 觸發器。
5. **再驗證新版手動入口**。從 LINE `#版本` 確認 `v2.2.5 Group Chat Reply Handoff Edition` 與 `2026-11-27`。按下方驗收項目檢查補話接手、直通、續聊、新聞點評、個人記憶、每日狀態、註記、週報、收件及手動封存。
6. **最後啟用自動封存**。已驗收且需要自動封存的聊天室恢復 `autoEnabled=true`，核對每日台灣中午只有一個 `processScheduledNewsArchives`。初次啟用或需修正排程時執行 `installNewsArchiveTrigger()`，驗證手動與排程交錯只寫一次。

首次設定固定週期可參考以下格式。把聊天室 ID 和起點換成實際值，起點須為帶時區的週三 12:00，並先核對舊封存是否重疊。

```json
{"conversations":[{"conversationId":"group:REPLACE_WITH_GROUP_ID","firstPeriodStartAt":"2026-11-25T12:00:00+08:00","autoEnabled":false}]}
```

### LINE / GAS 上線驗收

- 在測試聊天室測試明確點名、原生 `@小浣`、第二行 `#小浣`、私訊及固定指令直通。小浣回答後 20 秒內，用「沒有，只是想問你上一句」引用它的回覆，再核對只有「好」的引用保持安靜。重放五句連發與 webhook 重送，核對同房只取得一個回覆資格。
- 請兩位群友在小浣回覆後交替續聊，核對 90 秒窗口、6 秒間隔與兩輪上限。用「太不吵」「怎麼又裝死」核對熱聊虧句的 `CHAT_WAKE_STATUS`，再用客觀的換模型敘述或其他機器人指令驗證退場。確認純閒聊略過後下一則滿 4 字的候選能送守門員，並核對 5 分／4 分門檻與 2 分鐘共用冷卻。
- 在測試群組的熱聊窗口內，由同一人分開傳「今天是重活」和「畫超多圖」。確認兩則在 15 秒內且收到第二個 webhook 時舊回覆仍在生成，只能看到第二則接手後的回覆或守門員保持安靜。同一人再補兩則並執行 `#版本`，核對第三則觸發退場、第四則安靜及版本指令正常回覆。
- 用「以後叫我小美」「幫我記住我不吃香菜」驗證稱呼與筆記，引用兩小時以前的群友發言並核對稱呼脈絡。用 `#我的記憶` 和 `#忘記我` 交叉檢查兩位成員、兩個群及私訊的隔離。手動更正試算表後用 `#reset` 確認重讀，並驗證 `#清空紀錄 確認` 保留個人記憶。
- 用當天首次有餘裕的正常聊天核對 `BOT_DAILY_STATE` 只在主回覆送達後生成，下一輪聊日常時可取用，同一天重複聊天沿用同一份狀態。
- 用「幫我查我們的新聞有沒有這則」核對只讀內部 NewsInbox。用「幫我查 LINE 的聊天室功能」或明示聯網圖片研究核對 `GEMINI_SEARCH_API_KEY` 與獨立來源。確認守門員只讀一般 Key，並在測試部署核對 429、`AI_CALL_METADATA`、延後時間、重試數與 PT 午夜後的起點。
- 驗證私訊與引用圖片、群組直接收圖的靜默摘要。測試 `#reset` 與 `#清空紀錄 確認` 後的近期前文、續問與遲到回合。明示引用仍可取用清理範圍外的已保留原文。
- **production smoke 必要檢查**。用真實 LINE webhook 的長 MessageId，沿原始 LINE ID → ConversationLog 寫入 → `Range.getValues()` 回讀，檢查 `typeof value === "string"` 與 `value === 原始 message.id`。已確認文字引用的 `QuotedMessageId` 同樣核對 `typeof value === "string"` 與 `value === 原始 quotedMessageId`。核對跨聊天室查不到原文。
- 先在測試聊天室描述無網址的事件，再以同作者請小浣註記進本週新聞。驗證純註記回執、明示引用、重複註記、附帶提問、零篇新聞週報與選填開頭點評。確認高潛力或分類查無匹配。用 `#清空新聞 確認` 檢查註記、NewsInbox 和 Queue 的清除範圍。
- 群組連貼單篇公開網址時，核對每篇都先入隊，冷卻中只收件。點評送達後用另一位群友接話，確認 90 秒熱聊及 `news_url_comment` 紀錄。切換 `ENABLE_NEWS_URL_COMMENT` 驗證純收件，另驗證明確要求摘要、私訊同步收件、待回覆優先和送達後才刪除。用長週報核對話題與來源，並確認封存到期及防重。清理只在指定測試聊天室驗收，核對其他聊天室及歷史分頁完整。

本機 `node tests/smoke.cjs` 通過 305 項，含 89 項 DeepSeek 相容測試。`node tests/news_workflows.cjs` 通過 162 項，合計 467 項。測試以 26 個 GAS 原始檔執行本機模擬。未能本機執行 GAS，未執行 live LINE／Sheets／Gemini 或部署。上線驗收由維護者在實際專案完成。
