# MEGA浣 / 小浣

住在群組裡的浣熊夥伴，陪群友聊天、看圖、查資料，也協助 Podcast「現正熱潮中」收集與整理每週新聞。使用 Google Apps Script、Google Sheets、LINE Messaging API 與 Gemini。

目前版本為 **v2.0.0 Gemini Architecture Edition**（2026-11-22）。工作分支 `feature/v200-gemini-migration`，基準為 `main` 的 `ad0e861`。實際 Git 狀態以 refs 為準，GAS production deployment 由維護者手動更新。模型配置、配額規則和部署清單見 [CURRENT_VERSION.md](CURRENT_VERSION.md)。

## 現在能做什麼

- 私訊或群組聊天、精確引用群友文字、看圖與圖片研究。
- 明確要求時啟用 Google 搜尋並附來源，也能只讀查目前聊天室的近期對話、新聞與封存。
- 群組貼網址靜默收件，私訊可同步取得簡介。用 `#本週新聞` 查看群組話題、事件整理與分類新聞。
- 可手動封存，或為指定聊天室開啟固定週三週期。私訊和群組都能查看處理狀態及待回覆。

## 使用方式

私訊直接提問；群組一般聊天使用 `#小浣 <問題>`。群組普通文字與圖片保持安靜；直接貼新聞網址會靜默收件。

### 聊天與研究

- `#小浣 幫我想五個標題` 是一般創作，無須聯網。
- `#小浣 幫我查最新進度` 會啟用 Google 搜尋，完成後另附來源。
- `#小浣 我們這週有沒有收過 Anthropic 的新聞？`
- `#小浣 上週是不是聊過這件事？`
- 私訊或 `#小浣` 詢問「這篇網址跟之前收過的新聞有沒有重複？」可只讀比對，不會把研究網址自動新增為新聞。

一般聊天預設不聯網。「幫我查／搜尋／上網查」會啟用 Google 搜尋。明確問「聊過／收過／封存」時，程式先查指定資料。對話查詢限目前聊天室的過去使用者文字與圖片衍生摘要，並標明兩者來源；圖片摘要只表示小浣當時的辨識，不代表使用者說過或圖片主張已查證。查過但沒有結果、取得候選資料、尚未查詢／失敗會分開處理。來源依實際搜尋或工具取得的公開網址列出，最多三筆；來源 bubble 與主回答分開。

### 錯誤回覆

回覆會顯示原因與診斷碼。`MISSING_GEMINI_SEARCH_API_KEY` 表示還沒設定搜尋 Key，`SEARCH_NOT_EXECUTED` 表示搜尋未確認完成，`LOCAL_TIME_BUDGET` 表示同步時間不足。配額等待會附最早可重試時間。排查時提供發生時間、錯誤回覆及 GAS 的 `AI_CALL_METADATA`，憑證與原始請求留在私有環境。

### 文字引用

用 LINE「回覆」引用群友的文字，私訊直接提問，群組加 `#小浣`。例如甲說「公告是測試，不是正式上線」，乙插話後，丙引用甲問「#小浣 他這個說法對嗎？」：程式會先從同聊天室 ConversationLog 精確取得甲的文字，模型收到目前提問者、原作者與引用關係。找到原文只代表知道在談哪句話，公告是否屬實仍要看證據。

查詢限整張 ConversationLog 尾端 500 列，直接原文最多 2,000 字元，可補一層已記錄的上游文字，所有引用資料合計最多 6,000 字元。找不到、資料讀取失敗與不支援會區分，不能猜最近一句。原文仍在範圍且 ID 完整的舊文字可引用；不還原未記錄的歷史關係或小浣出站訊息。群組未觸發時只記錄已確認的文字關係，不增加 AI 或一般 Bot 回答；既有 Pending Reply 交付例外仍適用。

引用中的搜尋或清理指令不等於你現在的要求。原文與當前問題分開；未解析與圖片引用不保存目標 ID，既有圖片路徑仍可使用。`#reset` 清短期脈絡；`#清空紀錄 確認` 刪目前聊天室紀錄並清短期脈絡；不新增引用快取。

任何文字訊息都可優先交付待回覆，包含未觸發的群組普通文字與引用。普通 reply 不代表在問小浣，不追加「重新引用」提醒，也不呼叫 AI；普通網址在交付時仍依既有規則靜默收件。只有已觸發的文字引用問題才追加尚未處理提醒，請重新引用提問，且不額外研究或收件。沒有 Pending Reply 時，普通群組聊天本身保持安靜。

### 圖片

私訊直接傳 JPEG/PNG，或用 LINE「回覆」引用圖片後輸入「這是什麼？」。群組請引用圖片後輸入 `#小浣 <問題>`，舊 `#小浣 看圖 <問題>` 仍可使用。

普通圖片問題使用簡單分析；「幫我查最新進度／查證／來源」才要求圖片加搜尋。明確要求聊過的內容、收過的新聞或封存記憶時，同一流程先取得指定的只讀候選資料。文字中的單一網址先讀內容；網址只在圖中時先辨識，再於一次工具續接內讀取。必要來源未讀取不能當完整成功。單純要求圖片重點或問「這是真的嗎？」不強制開研究；圖片逾時、Search 失敗、指定資料未完成與一般服務異常分開提示。

一次只處理一張 JPEG/PNG，原圖上限 4 MiB，完整 AI request 上限 8 MiB。私訊多圖只處理第一張；缺少有效圖片索引時提示重新選圖。沒有引用時不猜上一張圖片，不保存原圖、Base64 或圖片配對。已分析圖片在同一次 Vision 呼叫中可產生短語意記憶；群組直接貼圖維持靜默，每聊天室限頻產生短文字摘要。語意文字經有界與敏感字串清理，重看細節仍須重新引用或傳圖。

### 新聞收件、週報與封存

| 用法 | 行為 |
| --- | --- |
| 群組直接貼網址 | 靜默進 NewsUrlQueue，背景分析後寫入 NewsInbox；錯誤待下次訊息交付 |
| 私訊直接貼網址 | 同步讀取、回覆 Brief 並收件；預算或配額不足時改由背景 Queue 處理 |
| `#本週新聞` / `#本週新聞 精簡` | 最近七天編輯台、群組話題、多篇事件群與分類新聞 |
| `#本週新聞 高潛力` | 高潛力分類列表，不呼叫編輯台 |
| `#本週新聞 詳細` | 大綱與切角；無篩選時可比對過去新聞封存 |
| `#本週新聞 分類 <分類名>` | 指定分類，例如科技與 AI |
| `#本週新聞 診斷` | 分類信心、故事線與重複素材檢查 |
| `#狀態回報` | 最近七天收件、Queue、失敗及待交付狀態；固定週期封存進度與失敗原因 |
| `#新聞補充 <網址與內容>` | 使用者明確新增素材；解析失敗保留人工補件 fallback |
| `#封存本週新聞` | 已設定聊天室補存最早到期的固定週期；未設定時仍封存最近七天 NewsInbox |

一般網站顯示 raw Title；X/Twitter 單篇 status 優先顯示 `X｜Brief`，缺資料再回退。這只是展示規則，不修改 Title、Brief、StoryKey、排序、cache 或封存契約。

固定週期是台灣時間「週三 12:00（含）～下週三 12:00（不含）」，按 NewsInbox.CreatedAt 入庫時間、同聊天室及 Status=ok 選取；發表日期不影響歸期。每日中午約 12:00～12:30 檢查，週三處理新到期週期，其餘日補跑；GAS 排程不保證準時。每次每聊天室最多一週，優先處理最早未完成的週期。可重試失敗每日一次，同一期自動最多三次。全候選配額預阻擋、零模型 HTTP 時延後，不扣嘗試額度。關閉自動時，狀態明確提示手動補跑。沒有資料只記進度，不建立空摘要。`#本週新聞` 查詢仍是滾動最近七天。

週編輯台保留已驗證的群組話題；長訊息可在少於 1200 字的完整段落分割，容量不足只省略新聞並顯示數量。共用分段同時核對剩餘訊息容量，避免短前言讓原本放得下的長回覆被截斷，搜尋來源仍另占一則。文字切割、來源與省略提示的截斷保留 UTF-16 配對字元，避免把 emoji 拆成半個字元；保留完整字元後仍超限時明示省略。對話讀取失敗、整體整理失敗、模型回空話題，以及話題全數／部分未通過檢查分別提示，不強迫 AI 產生主題。v2.0.0 快取保留這些區別，舊供應商的快取自然失效。對話仍僅讀同聊天室、全表尾端最多 2500 列內的合格使用者文字，保留既有最多 60 則／每則 240 字元／合計 6000 字元限制。

入庫時間戳與寫入／flush、固定封存來源快照共用短鎖，避免截止時漏封存；AI 在鎖外執行，提交只在原 deadline 內等鎖，失敗保留安全狀態供補跑。清理在同一把外層鎖內讀列、刪列及 flush，包含未設定固定封存的聊天室；鎖忙只回報未完成。Pending Reply 仍在 LINE 成功後才刪除。

新聞 Queue 領取與提交時重新核對任務、聊天室、狀態及開始時間。配額不足依 `NextRunAt` 延後。`#清空新聞 確認` 取消被刪任務的遲到結果，待回覆另用 `#清空待回覆` 清除。鎖持續忙碌或多表寫入中斷時，先核對 Queue、素材與待回覆再決定補處理。

### Help、版本與清理

`#help` 顯示核心功能；其他入口有 `#help 進階`、`#help 清理`、`#help 管理`、`#help 資料`、`#help 全部`。`#版本` 顯示版本，`#版本紀錄` 只列最近六筆。`#reset` 清除目前聊天室的短期快取並推進世代，避免執行中的舊請求寫回。

清理限目前聊天室，必須先看影響範圍，再輸入「原指令 確認」：

| 指令 | 範圍 |
| --- | --- |
| `#清空紀錄` | ConversationLog（含圖片衍生文字）與短期記憶 |
| `#清空封存` | 目前聊天室的全部 WeeklySummary，包含歷史話題與新聞封存；固定週期進度跳到最新已截止邊界並取消執行中工作，舊週不回補，下週照常 |
| `#清空新聞` | NewsInbox、NewsUrlQueue |
| `#清空待回覆` | PendingReplies |

## 現行架構

功能入口由 AI 服務選擇任務及模型，供應商轉接層處理 Gemini 協議。AI 結果通過程式驗證後才回覆 LINE 或入庫。共 22 個 `.gs`，共用 GAS 全域命名空間。

| 領域 | 檔案 |
| --- | --- |
| 設定、LINE 入口和回覆 | `00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs` |
| 工具、儲存、記憶與圖片 | `04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs` |
| AI 調度、模型與提示詞 | `10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs` |
| 結構化輸出、只讀工具 | `13_AiSchemas.gs`、`14_AiTools.gs` |
| 供應商與配額 | `15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`17_GeminiQuota.gs` |
| 網址讀取 | `20_ReaderLayer.gs`、`21_WebReader.gs` |
| 新聞、編輯台與固定封存 | `30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`36_NewsArchive.gs` |
| 資料維護 | `50_DataCleanup.gs` |

Gemini 是唯一啟用的 AI 供應商。DeepSeek 保留為 dormant，日常功能無須 `DEEPSEEK_API_KEY`。模型依任務從 Hydrogen、3.8 Flash 或 3.5 Flash-Lite 起跑，在能力相容及剩餘時間允許時按配額降級。搜尋沿用同一用途的 Key。聊天只在讀快取與提交時持有短鎖。

一般公開網址先用 Jina Reader。X/Twitter 單篇 status 用 FxTwitter，Classic PTT 用直接讀取與 over18 驗證，符合條件時最多一次 Jina。收件保留既有 HTML 抽取後備，`read_url` 工具只讀且不再呼叫 AI。Gemini `url_context` 尚未接入。

活躍資料表為 `ConversationLog`、`WeeklySummary`、`NewsUrlQueue`、`NewsInbox`、`PendingReplies`。舊 `TopicHighlights`、`WebTaskQueue`、`WebSummary` 分頁及歷史話題封存保留。待回覆在 LINE 確認送達後才刪除，若送達後刪除中斷則可能重送。

## Setup、部署與維護

Script Properties 沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`。`GEMINI_API_KEY` 供一般任務，`GEMINI_SEARCH_API_KEY` 只在啟用 Google 搜尋時讀取。可分用免費與付費專案，或兩格同填已連結 Google AI Pro 抵免額的付費 Key。填同一 Key 時兩路共用該專案的配額與帳務。憑證值只放 Script Properties。 [Google AI Pro 抵免額說明](https://blog.google/innovation-and-ai/technology/developers-tools/google-cloud-credits-gdp-ai-studio/)

1. 依 [CURRENT_VERSION.md](CURRENT_VERSION.md) 備份，先將自動封存設定為 `autoEnabled=false`，手動卸除 `processWebTaskQueue` Trigger，確認舊工作結束。同步 22 個同版 `.gs`，加入 `17_GeminiQuota.gs`，從 GAS 移除 `25_WebTaskQueue.gs`、`40_TopicHighlights.gs` 與 `45_TopicFeatures.gs`。Markdown 與測試留在 Git。
2. 首次建置執行 `setupLogSheet()`。首次啟用固定封存先設定 `NEWS_ARCHIVE_CONFIG`，保持自動關閉，再執行 `previewNewsArchiveSetup()` 及 `setupNewsArchiveStorage()`。已完成 v1.17.0 建置者沿用現有資料與封存進度。
3. **先更新 Web App deployment**。在 GAS 建立版本並更新原部署，保留 URL。核對每分鐘一個 `processNewsUrlQueue`，必要時執行 `installNewsUrlQueueTrigger()`。
4. **再驗證新版手動入口**。以 LINE `#版本`、一般聊天、搜尋、圖片、新聞入庫、週報與手動封存驗證 v2.0.0。按 [CURRENT_VERSION.md](CURRENT_VERSION.md) 完成 production smoke，確認真實 `MessageId` 和 `QuotedMessageId` 寫入後仍是原字串。
5. **最後啟用自動封存**。將已通過測試的聊天室設為 `autoEnabled=true`，核對既有 `processScheduledNewsArchives`。首次安裝或需重建時執行 `installNewsArchiveTrigger()`。

本機回歸使用 `node tests/smoke.cjs` 與 `node tests/news_workflows.cjs`，由記憶體模擬 GAS／LINE／Sheets／Gemini。修改規則見 [AGENTS.md](AGENTS.md)，完整部署步驟與未驗收項目見 [CURRENT_VERSION.md](CURRENT_VERSION.md)。

## 版本沿革摘要

以下按系列整理，歷史依 [99_changelog.md](99_changelog.md)；完整 patch、revert 與 hotfix 記錄保持在 changelog。

| 系列 | 主要進展 |
| --- | --- |
| v1.6 | 小浣命名與純文字回覆；網址 Queue、Pending Reply 交付 |
| v1.7 | WebSummary 素材池、快讀、節目分析與跨素材統整；一次最多三個網址 |
| v1.8 | 現有 changelog 未記錄此系列，沒有補造沿革 |
| v1.9 | GAS 責任分檔、固定回覆人性化、Gemini JSON 契約與相容性修正 |
| v1.10 | NewsInbox、Reader、人工重點、多表清理與社群讀取；精簡舊指令 |
| v1.11 | 私訊同步新聞收件、Brief 與 Outline 分工 |
| v1.12 | 群組靜默收件、週新聞查詢／診斷、新聞問答、分類稽核與編輯台 |
| v1.13 | Provider-neutral AI routing、GAS 檔案導航、X 展示標題 |
| v1.14 | DeepSeek Flash 圖片、自然引用、Search transport 校正、SSRF 與 Pending Reply 修正 |
| v1.15 | 能力路由、JSON Schema、只讀資料工具、圖片交叉研究、圖片語意記憶與 context 成本整理 |
| v1.16 | Provider Architecture Foundation：registry dispatch、model reasoning policy、統一 adapter 契約、secret 與 metadata hardening；未接入 Luna／OpenAI |
| v1.16.1 | 使用者文字引用、作者脈絡、跨作者去重修正與人格／task 分層；ConversationLog 補兩欄，部署需另行驗收 |
| v1.16.2 | AI／搜尋／Reader／圖片錯誤診斷碼與自然聊天變化；無新資料欄位、設定或模型呼叫 |
| v1.17.0 | 固定週三新聞封存、手動／自動防重與補跑；保留週編輯台話題，啟用需補四欄、設定與手動安裝 Trigger |
| v2.0 | Gemini 雙 Key 與三段配額降級、聊天短鎖、舊快讀與話題功能退場；保留新聞收件與週三封存 |
