# MEGA浣 / 小浣

住在群組裡的浣熊夥伴，陪群友聊天、看圖、查資料，也協助 Podcast「現正熱潮中」收集與整理每週新聞。使用 Google Apps Script、Google Sheets、LINE Messaging API 與 Gemini。

目前版本為 **v2.2.3 Heartflow, Member Memory & Daily Life Edition**（2026-11-23）。工作分支 `feature/v223-heartflow-member-memory`，基準為 `main` 的 `1c3205e`（v2.1.1）。實際 Git 狀態以 refs 為準，GAS production deployment 由維護者手動更新。 [模型配置與部署清單](CURRENT_VERSION.md)

## 現在能做什麼

- 私訊與群組聊天會帶入近期前文，也可精確引用群友文字、看圖及研究。小浣平時像熟悉的群友，查資料和看圖按證據回答。
- 小浣能在熱聊中接住不同群友的話，也會記住本人在這個聊天室設定的稱呼與偏好。聊到日常時可帶入當天的小浣角色日常。
- 明確要求時啟用 Google 搜尋並附來源，也能只讀查目前聊天室的近期對話、新聞與封存。
- 群組貼網址靜默收件，私訊可同步取得簡介。口述事件也可交辦成手動註記。用 `#本週新聞` 查看註記、群組話題、事件整理與分類新聞。
- 可手動封存，或為指定聊天室開啟固定週三週期。私訊和群組都能查看處理狀態及待回覆。

## 使用方式

私訊直接提問。群組可用 LINE 原生 `@小浣`，或把 `#小浣` 放在訊息任意位置，包括多行訊息的第二行。小浣可帶入同聊天室最近 2 小時、最多 15 則前文，總預算 3,000 字元。

- **直接找小浣**。固定指令、私訊、原生 `@小浣`、`#小浣`、明確點名交辦，或引用小浣回覆後繼續提問，可跳過守門員與 20 秒間隔。「小浣吐嘈啊」「小浣出來面對」也算明確交辦。群組引用只說「好」「笑死」等收尾短噪時保持安靜。
- **熱聊續接**。小浣成功回覆後有 90 秒窗口，不同群友可以交替接話。間隔至少 6 秒，守門員評分至少 5 分，最多續接兩輪。熱聊時的「太不吵」「怎麼又裝死」依續聊規則計數，話題轉走或改叫其他機器人時退場。
- **主動探頭**。守門員評分至少 7 分才會在彩蛋或純閒聊裡插一句。純閒聊每房最多每 2 分鐘探測一次，和關鍵字彩蛋共用 30 分鐘冷卻。`ENABLE_CHAT_AMBIENT_BANTER` 可獨立關閉純閒聊探測，`ENABLE_CHAT_EASTER_EGG` 控制所有主動插話。客觀聊版本更新或換模型時保持安靜。

### 聊天與研究

- `#小浣 幫我想五個標題` 是一般創作，無須聯網。
- `#小浣 幫我查最新進度` 會啟用 Google 搜尋，完成後另附來源。
- `#小浣 我們這週有沒有收過 Anthropic 的新聞？`
- `#小浣 上週是不是聊過這件事？`
- 「小浣，幫我整理這篇」後附網址，或用原生 `@小浣` 請它摘要，會走唯讀研究。直接貼新聞網址會走收件。

明確的外部查詢才會啟用 Google 搜尋，例如「幫我查 LINE 的聊天室功能」。詢問「我們的新聞有沒有這則」、聊過的話題或封存時，程式先查指定的同聊天室資料。對話查詢區分使用者文字與小浣當時的圖片辨識；查無結果、取得候選資料與查詢未完成各有提示。實際搜尋或讀取的公開來源最多三筆，另列在主回答後。

### 錯誤回覆

回覆會顯示原因與診斷碼。`MISSING_GEMINI_SEARCH_API_KEY` 表示還沒設定搜尋 Key，`SEARCH_NOT_EXECUTED` 表示搜尋未確認完成，`LOCAL_TIME_BUDGET` 表示同步時間不足。配額等待會附最早可重試時間。排查時提供發生時間、錯誤回覆及 GAS 的 `AI_CALL_METADATA`。若群組沒有自然接話，可查 `CHAT_WAKE_STATUS` 的結果、觸發類型、分數與續聊輪數。憑證與原始請求留在私有環境。

### 文字引用

用 LINE「回覆」引用群友的文字，私訊直接提問，群組可用原生 `@小浣` 或 `#小浣`。例如乙插話後，丙引用甲的原訊息問「#小浣 他這個說法對嗎？」程式會從同聊天室 ConversationLog 精確取得甲的文字，將提問者、原作者和引用關係交給模型。找到原文後，事實仍依證據判定。

查詢限整張 ConversationLog 尾端 500 列，直接原文最多 2,000 字元，可補一層已記錄的上游文字，所有引用資料合計最多 6,000 字元。找不到、資料讀取失敗與不支援會分開處理。引用已確認送達的小浣回覆時，出站 ID 用於辨識續問。精確引用的使用者原文優先於近期前文與短期記憶。

搜尋或清理的授權取自當前訊息。`#reset` 清除短期記憶，切斷自動帶入的前文與續問視窗。`#清空紀錄 確認` 同時刪除目前聊天室的紀錄。仍保留且在查詢範圍內的文字可明示引用。

任何文字訊息都可優先交付待回覆，包含群組普通文字與引用。普通網址仍可同時靜默收件。當次符合明示引用或網址研究時，交付會附未處理提醒，請在下一則訊息重問。

### 個人記憶與每日狀態

- 對小浣說「以後叫我小美」「記住我的暱稱是小美」或「幫我記住我不吃香菜」。稱呼與筆記只影響目前聊天室的本人記憶，群組與私訊各自保存。
- `#我的記憶` 查看自己的稱呼與筆記，`#忘記我` 清除自己的設定。純設定、查看或清除由程式直接回覆。`#reset` 清短期記憶，也讓小浣從 `MemberMemory` 重讀個人記憶。
- 日常聊天，小浣可用當天已準備好的角色小日常接話。當天第一次生成安排在正常回答送達之後，成功後下一輪開始沿用。

### 圖片

私訊直接傳 JPEG/PNG，或用 LINE「回覆」引用圖片後輸入「這是什麼？」。群組請引用圖片後用 `@小浣` 或 `#小浣` 提問，舊 `#小浣 看圖 <問題>` 仍可使用。

普通圖片問題使用簡單分析；「幫我查最新進度／查證／來源」才要求圖片加搜尋。明確要求聊過的內容、收過的新聞或封存記憶時，同一流程先取得指定的只讀候選資料。文字中的單一網址先讀內容；網址只在圖中時先辨識，再於一次工具續接內讀取。必要來源未讀取不能當完整成功。單純要求圖片重點或問「這是真的嗎？」不強制開研究；圖片逾時、Search 失敗、指定資料未完成與一般服務異常分開提示。

一次只處理一張 JPEG/PNG，原圖上限 4 MiB，完整 AI request 上限 8 MiB。私訊多圖只處理第一張；缺少有效圖片索引時提示重新選圖。沒有引用時不猜上一張圖片，不保存原圖、Base64 或圖片配對。已分析圖片在同一次 Vision 呼叫中可產生短語意記憶；群組直接貼圖維持靜默，每聊天室限頻產生短文字摘要。語意文字經有界與敏感字串清理，重看細節仍須重新引用或傳圖。

### 新聞收件、週報與封存

| 用法 | 行為 |
| --- | --- |
| 群組直接貼網址 | 靜默進 NewsUrlQueue，背景分析後寫入 NewsInbox；錯誤待下次訊息交付 |
| 私訊直接貼網址 | 同步讀取、回覆 Brief 並收件；預算或配額不足時改由背景 Queue 處理 |
| `#小浣 幫我註記進本週新聞` | 把清楚指認的事件放進「本週手動註記」，網址選填 |
| `#本週新聞` / `#本週新聞 精簡` | 最近七天的手動註記、群組話題、多篇事件群與分類新聞，週編輯台可在開頭加一句點評 |
| `#本週新聞 高潛力` | 高潛力分類列表，不呼叫編輯台 |
| `#本週新聞 詳細` | 手動註記、大綱與切角；無篩選時可比對過去新聞封存 |
| `#本週新聞 分類 <分類名>` | 指定分類，例如科技與 AI |
| `#本週新聞 診斷` | 分類信心、故事線與重複素材檢查 |
| `#狀態回報` | 最近七天收件、Queue、失敗及待交付狀態；固定週期封存進度與失敗原因 |
| `#新聞補充 <網址與內容>` | 使用者明確新增素材；解析失敗保留人工補件 fallback |
| `#封存本週新聞` | 已設定聊天室補存最早到期的固定週期；未設定時仍封存最近七天 NewsInbox |

一般網站顯示 raw Title；X/Twitter 單篇 status 優先顯示 `X｜Brief`，缺資料再回退。這只是展示規則，不修改 Title、Brief、StoryKey、排序、cache 或封存契約。

手動註記可以直接寫事件、引用原訊息，或由同一人先把事件說清楚，在五分鐘內接一句「#小浣 幫我註記進本週新聞」。純註記直接回報實際結果。附帶提問時，小浣會在回執後接著回答。沒有新聞網址也可整理已有的手動註記與合格群聊，分類或高潛力查無符合新聞則回報無匹配。

固定週期是台灣時間「週三 12:00（含）～下週三 12:00（不含）」，按 NewsInbox.CreatedAt 入庫時間、同聊天室及 Status=ok 選取；發表日期不影響歸期。每日中午約 12:00～12:30 檢查，週三處理新到期週期，其餘日補跑；GAS 排程不保證準時。每次每聊天室最多一週，優先處理最早未完成的週期。可重試失敗每日一次，同一期自動最多三次。全候選配額預阻擋、零模型 HTTP 時延後，不扣嘗試額度。關閉自動時，狀態明確提示手動補跑。沒有資料只記進度，不建立空摘要。`#本週新聞` 查詢仍是滾動最近七天。

週編輯台保留已驗證的群組話題，長訊息依完整區塊分割，篇幅不足會標示省略的新聞和註記筆數，切割保留完整的 Unicode 字元。對話限同聊天室及全表尾端 2,500 列內的合格使用者文字，最多 60 則、每則 240 字元、合計 6,000 字元。`openingComment` 可以在同一次編輯台整理中輸出一到兩句有個性的開頭。空值、驗證未通過或分類備援時使用中性開場。週編輯台快取版本為 `v2.1.0`。

入庫時間戳與寫入／flush、固定封存來源快照共用短鎖，避免截止時漏封存；AI 在鎖外執行，提交只在原 deadline 內等鎖，失敗保留安全狀態供補跑。清理在同一把外層鎖內讀列、刪列及 flush，包含未設定固定封存的聊天室；鎖忙只回報未完成。Pending Reply 仍在 LINE 成功後才刪除。

新聞 Queue 領取與提交時重新核對任務、聊天室、狀態及開始時間。配額不足依 `NextRunAt` 延後。`#清空新聞 確認` 會一併清除本週手動註記，取消被刪任務的遲到結果。待回覆另用 `#清空待回覆` 清除。鎖持續忙碌或多表寫入中斷時，先核對 Queue、素材與待回覆再決定補處理。

### Help、版本與清理

`#help` 顯示核心功能；其他入口有 `#help 進階`、`#help 清理`、`#help 管理`、`#help 資料`、`#help 全部`。`#版本` 顯示版本，`#版本紀錄` 只列最近六筆。`#reset` 清除目前聊天室的短期快取並推進世代，避免執行中的舊請求寫回。

清理限目前聊天室，必須先看影響範圍，再輸入「原指令 確認」：

| 指令 | 範圍 |
| --- | --- |
| `#清空紀錄` | ConversationLog（含圖片衍生文字）與短期記憶 |
| `#清空封存` | 目前聊天室的全部 WeeklySummary，包含歷史話題與新聞封存；固定週期進度跳到最新已截止邊界並取消執行中工作，舊週不回補，下週照常 |
| `#清空新聞` | NewsInbox、NewsUrlQueue 與本週手動註記 |
| `#清空待回覆` | PendingReplies |

## 現行架構

功能入口由 AI 服務選擇任務及模型，供應商轉接層處理 Gemini 協議。AI 結果通過程式驗證後才回覆 LINE 或入庫。共 26 個活躍 `.gs`，共用 GAS 全域命名空間。

| 領域 | 檔案 |
| --- | --- |
| 設定、LINE 入口和回覆 | `00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs` |
| 工具、儲存、記憶與圖片 | `04_Utils.gs`、`05_Storage.gs`、`06_Memory.gs`、`07_LineImages.gs` |
| 自然喚醒、事件去重與限頻 | `08_ChatWake.gs` |
| 台灣日期角色日常 | `09_BotDailyState.gs` |
| AI 調度、模型與提示詞 | `10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs` |
| 結構化輸出、只讀工具 | `13_AiSchemas.gs`、`14_AiTools.gs` |
| 供應商與配額 | `15_DeepSeekProvider.gs`、`16_GeminiProvider.gs`、`17_GeminiQuota.gs` |
| 網址讀取 | `20_ReaderLayer.gs`、`21_WebReader.gs` |
| 新聞、編輯台與固定封存 | `30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs`、`36_NewsArchive.gs` |
| 本週手動註記 | `37_WeeklyNotes.gs` |
| 聊天室個人記憶與稱呼 | `38_MemberMemory.gs` |
| 資料維護 | `50_DataCleanup.gs` |

Gemini 是唯一啟用的 AI 供應商。DeepSeek 保留為 dormant。多數模型任務依能力與時間按配額降級。`chat_gatekeeper` 與 `bot_daily_state` 固定使用 3.5 Flash-Lite、`minimal` 及一般 Key，任務逾時上限分別為 8 秒和 4 秒。LINE 回覆先確認送達，再提交有效世代的短期記憶與續問狀態。

一般公開網址先用 Jina Reader。X/Twitter 單篇 status 用 FxTwitter，Classic PTT 用直接讀取與 over18 驗證，符合條件時最多一次 Jina。收件保留既有 HTML 抽取後備，`read_url` 工具只讀且不再呼叫 AI。Gemini `url_context` 尚未接入。

活躍資料表為 `ConversationLog`、`WeeklySummary`、`NewsUrlQueue`、`NewsInbox`、`PendingReplies` 與 `MemberMemory`。新表保存聊天室 ID、成員 ID、稱呼、筆記和更新時間。每日角色狀態使用程式自動建立的 `BOT_DAILY_STATE`。舊 `TopicHighlights`、`WebTaskQueue`、`WebSummary` 分頁及歷史話題封存保留。待回覆在 LINE 確認送達後才刪除，若送達後刪除中斷則可能重送。

## Setup、部署與維護

Script Properties 沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`。`GEMINI_API_KEY` 供一般任務，`GEMINI_SEARCH_API_KEY` 只在啟用 Google 搜尋時讀取。可分用免費與付費專案，或兩格同填已連結 Google AI Pro 抵免額的付費 Key。填同一 Key 時兩路共用該專案的配額與帳務。憑證值只放 Script Properties。 [Google AI Pro 抵免額說明](https://blog.google/innovation-and-ai/technology/developers-tools/google-cloud-credits-gdp-ai-studio/)

1. 備份現行 GAS、試算表、Properties 和封存游標。已開啟固定封存時，在切換期間暫設 `autoEnabled=false`。從 v2.1.1 升級至 v2.2.3，同步以下 14 個 `.gs`。新環境或需要對齊較舊版本時，同步全部 26 個同版 `.gs`。Markdown 與測試留在 Git。

   - 更新 `00_Config.gs`、`01_Main.gs`、`02_LineCommands.gs`、`03_ResponseTexts.gs`、`05_Storage.gs`、`06_Memory.gs`、`08_ChatWake.gs`、`10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs`、`13_AiSchemas.gs`、`14_AiTools.gs`。
   - 新增 `09_BotDailyState.gs`、`38_MemberMemory.gs`。

2. 既有五張表需執行 0 個 Sheet migration，手動新增 0 個 Script Property。可執行 `setupLogSheet()` 預建 `MemberMemory`，或待首次寫入自動建立。新專案也用 `setupLogSheet()` 初始化。首次啟用固定封存依序用 `previewNewsArchiveSetup()` 與 `setupNewsArchiveStorage()`。
3. **先更新 Web App deployment**。在 GAS 建立版本並更新原部署，保留 URL。核對每分鐘一個 `processNewsUrlQueue`，需要時執行 `installNewsUrlQueueTrigger()`。
4. **再驗證新版手動入口**。以 LINE `#版本` 核對 v2.2.3，測試明確點名、引用直通、群友交替續聊、稱呼與筆記、每日狀態、純註記、零新聞週報及手動封存。production smoke 要確認真實 `MessageId` 與 `QuotedMessageId` 回讀後仍是原字串。 [完整 LINE／GAS 驗收清單](CURRENT_VERSION.md#line--gas-上線驗收)
5. **最後啟用自動封存**。恢復已驗收聊天室需要的 `autoEnabled=true` 設定，核對既有 `processScheduledNewsArchives`。首次安裝或需修正時執行 `installNewsArchiveTrigger()`。

本機 `node tests/smoke.cjs` 通過 299 項，`node tests/news_workflows.cjs` 通過 156 項，合計 455 項。測試使用 GAS／LINE／Sheets／Gemini 模擬。 [專案修改規則](AGENTS.md) · [完整部署步驟](CURRENT_VERSION.md#gas-部署與實測)

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
| v2.1 | 近期群聊前文、自然喚醒守門員與小浣人設、本週手動註記、零新聞週報及開頭點評 |
| v2.1.1 | 放寬自然點名與玩笑，新增純閒聊 2 分鐘探測，主動插話共用 30 分鐘冷卻 |
| v2.2.3 | 明確點名及引用直通、跨群友心流續聊、分房個人記憶與台灣日期角色日常 |
