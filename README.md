# MEGA浣 / 小浣

Podcast「現正熱潮中」的 LINE 新聞素材與節目準備助手。使用 Google Apps Script、Google Sheets、LINE Messaging API 與 DeepSeek Flash。

本文件描述 **v1.16.0 Provider Architecture Foundation** 的版本契約，承接 v1.15.4。這只是 Provider Architecture Foundation：**DeepSeek Flash 仍是唯一 active provider，Gemini 仍 dormant，GPT-6 Luna / OpenAI 尚未接入**。Git 版本與 GAS production deployment 可能處於不同階段，實際部署由維護者確認；詳細契約見 [CURRENT_VERSION.md](CURRENT_VERSION.md)。

## 現在能做什麼

- 收集群組新聞網址，整理分類、簡介、大綱與故事線，製作本週編輯台。
- 一般聊天可搜尋最新資訊，也可查目前聊天室的近期使用者對話、新聞、人工重點與封存記憶；研究工具全部只讀。
- 私訊傳圖或引用圖片自然提問。需要查證時，可用同一個圖片研究流程結合網路與聊天室資料，另外列出來源。
- 小浣可把圖片理解保存為同聊天室可搜尋的短文字脈絡，不保存原圖；群組直接貼圖仍不會收到回覆。
- 新聞分析、快讀、封存、週編輯台與人工補充使用 JSON Schema；程式仍負責分類、完整性與資料寫入驗證。
- 保留多輪文字記憶、人工畫重點、明確封存與二段確認清理。

## 使用方式

私訊直接提問；群組一般聊天使用 `#小浣 <問題>`。群組普通文字與圖片保持安靜；直接貼新聞網址會靜默收件。

### 聊天與研究

- `#小浣 幫我想五個節目標題`：一般創作，不需要查資料。
- `#小浣 幫我查最新進度`：明確要求搜尋，失敗時會誠實回報。
- `#小浣 我們這週有沒有收過 Anthropic 的新聞？`
- `#小浣 上週是不是聊過這件事？`
- `#小浣 之前畫過哪些相關重點？`
- 私訊或 `#小浣` 詢問「這篇網址跟之前收過的新聞有沒有重複？」可只讀比對，不會把研究網址自動新增為新聞。

普通聊天由模型判斷是否需要搜尋；「幫我查／搜尋／上網查」會強制要求。明確問「聊過／收過／封存／畫過重點」時，程式先查指定資料。對話查詢限目前聊天室的過去使用者文字與圖片衍生摘要，並標明兩者來源；圖片摘要只表示小浣當時的辨識，不代表使用者說過或圖片主張已查證。查過但沒有結果、取得候選資料、尚未查詢／失敗會分開處理。來源依實際搜尋或工具取得的公開網址列出，最多三筆；來源 bubble 與主回答分開。

### 圖片

私訊直接傳 JPEG/PNG，或用 LINE「回覆」引用圖片後輸入「這是什麼？」。群組請引用圖片後輸入 `#小浣 <問題>`，舊 `#小浣 看圖 <問題>` 仍可使用。

普通圖片問題使用簡單分析；「幫我查最新進度／查證／來源」才要求圖片加搜尋。明確要求聊過的內容、收過的新聞、封存記憶、人工重點時，同一流程先取得指定的只讀候選資料。文字中的單一網址先讀內容；網址只在圖中時先辨識，再於一次工具續接內讀取。必要來源未讀取不能當完整成功。單純要求圖片重點或問「這是真的嗎？」不強制開研究；圖片逾時、Search 失敗、指定資料未完成與一般服務異常分開提示。

一次只處理一張 JPEG/PNG，原圖上限 4 MiB，完整 AI request 上限 8 MiB。私訊多圖只處理第一張；缺少有效圖片索引時提示重新選圖。沒有引用時不猜上一張圖片，不保存原圖、Base64 或圖片配對。已分析圖片在同一次 Vision 呼叫中可產生短語意記憶；群組直接貼圖維持靜默，每聊天室限頻產生短文字摘要。語意文字經有界與敏感字串清理，重看細節仍須重新引用或傳圖。

### 新聞與節目素材

| 用法 | 行為 |
| --- | --- |
| 群組直接貼網址 | 靜默進 NewsUrlQueue，背景分析後寫入 NewsInbox；錯誤待下次訊息交付 |
| 私訊直接貼網址 | 同步讀取、回覆 Brief 並收件；預算不足使用既有背景 Queue |
| `#本週新聞` / `#本週新聞 精簡` | 最近七天編輯台、群組話題、多篇事件群與分類新聞 |
| `#本週新聞 高潛力` | 高潛力分類列表，不呼叫編輯台 |
| `#本週新聞 詳細` | 大綱與切角；無篩選時可比對過去新聞封存 |
| `#本週新聞 分類 <分類名>` | 指定分類，例如科技與 AI |
| `#本週新聞 診斷` | 分類信心、故事線與重複素材檢查 |
| `#新聞問答 <問題>` | 根據 NewsInbox 與新聞封存回答，附原文網址；不自行查外部資料 |
| `#狀態回報` | 最近七天收件、Queue、失敗及待交付狀態 |
| `#新聞補充 <網址與內容>` | 使用者明確新增素材；解析失敗保留人工補件 fallback |
| `#懶人包 <網址>` | 背景快讀，保存至 WebSummary |
| `#節目話題分析 <問題或網址>` | 有網址走背景分析；無網址參考近期對話與素材 |
| `#統整話題` | 整合對話、人工重點、新聞大綱、快讀及封存脈絡 |
| `#畫重點 <內容>` | 保存人工釘選內容至 TopicHighlights |
| `#封存本週話題` | 只封存 ConversationLog 使用者對話 |
| `#封存本週新聞` | 將 NewsInbox 整理為 WeeklySummary 新聞索引 |

一般網站顯示 raw Title；X/Twitter 單篇 status 優先顯示 `X｜Brief`，缺資料再回退。這只是展示規則，不修改 Title、Brief、StoryKey、排序、cache 或封存契約。

### Help、版本與清理

`#help` 顯示核心功能；其他入口有 `#help 進階`、`#help 清理`、`#help 管理`、`#help 資料`、`#help 全部`。`#版本` 顯示版本，`#版本紀錄` 只列最近六筆。`#reset` 只清除目前聊天室的短期 Cache 記憶。

清理限目前聊天室，必須先看影響範圍，再輸入「原指令 確認」：

| 指令 | 範圍 |
| --- | --- |
| `#清空紀錄` | ConversationLog（含圖片衍生文字）與短期記憶 |
| `#清空重點` | TopicHighlights |
| `#清空快讀` | WebSummary、WebTaskQueue |
| `#清空封存` | WeeklySummary |
| `#清空新聞` | NewsInbox、NewsUrlQueue |
| `#清空待回覆` | PendingReplies |

## 現行架構

`Feature → AiService → capability / profile → provider adapter → normalized result → business validator → LINE / deterministic storage`

| 領域 | 檔案 |
| --- | --- |
| Core、LINE、儲存、記憶、圖片 | `00_Config.gs`～`07_LineImages.gs`，共 8 檔 |
| AI service、設定、Prompt | `10_AiService.gs`、`11_AiProfiles.gs`、`12_Prompts.gs` |
| JSON Schema、只讀工具 | `13_AiSchemas.gs`、`14_AiTools.gs` |
| Provider adapters | `15_DeepSeekProvider.gs`、`16_GeminiProvider.gs` |
| Reader、背景任務 | `20_ReaderLayer.gs`、`21_WebReader.gs`、`25_WebTaskQueue.gs` |
| 新聞、編輯台 | `30_NewsInbox.gs`、`35_WeeklyEditorialDigest.gs` |
| 重點、話題 | `40_TopicHighlights.gs`、`45_TopicFeatures.gs` |
| 資料維護 | `50_DataCleanup.gs` |

共 23 個 runtime `.gs`，共用 GAS global namespace；數字只供導航，不是載入順序。

DeepSeek 依能力選擇 Chat Completions（普通文字／Vision／legacy extraction）、Responses（JSON Schema）或 Anthropic Messages（Search／只讀工具／圖片研究）。Gemini 保持 dormant，沒有自動 provider fallback。業務層不建立 vendor payload。

### Provider 維護邊界

- `11_AiProfiles.gs` 以 Provider Registry 註冊純 `validateRequest(request)` 與 `adapter(request)` 函式，以 Model Registry 宣告 capabilities、reasoning modes／efforts／sampling policy。Task/profile 表達是否需要推理及 effort；`high/max` 是目前 DeepSeek 已驗證的 policy，不是所有 provider 的限制。正式 task 的 HIGH、token／timeout 與 non-thinking caption 預算不變。
- AiService 只調度 messages、能力、business schema、trusted scope、required evidence、只讀 tools 與共同 deadline；adapter 負責 endpoint、secret、payload、Search、Vision、structured output、finish／usage 及私有 continuation。能力組合先驗證；序列化、body limit 與 deadline 通過後才讀該 provider 的 Script Property，HTTP 不自動跟隨 redirect。
- `buildAiProviderResult_()` 統一 adapter 結果欄位；callback 只在本次 service 內使用，最多一次，原始 turn／reasoning／tool data 不進 feature、history 或 Sheet。錯誤只輸出固定 typed 訊息。Gemini 僅補安全性與契約一致性，不啟用新能力。
- `AI_CALL_METADATA` 保留安全 usage／Search／來源數與成本計數。缺少或無效 token 欄位為 `null`；多輪總數必須每輪都有該欄位才相加。`modelCalls` 計實際 HTTP 嘗試，`requiredEvidenceReads`／`clientToolCalls` 計工具執行嘗試，`continuationCount` 計續接嘗試。`contextTextChars` 計首輪文字 context；`toolDefinitionChars` 自 v1.16.0 起只計 provider-neutral client tool definitions 的 JSON 字元數，無工具為 0，不包含 built-in Search schema。Search intent 另記 `webSearchMode`，實際執行另記 `usedWebSearch`。這些不是 token、帳單或完整 wire payload 大小。

未來增加 provider，工作應集中於新增 adapter、更新 Provider／Model Registry 與必要 profile／route、加入 adapter tests，驗證後才配置該 provider 的 key 與切換 route。LINE、圖片下載、ConversationLog、Reader、client tool implementations 和 business validators 不需因供應商改寫。本版沒有 OpenAI stub、OpenAI API 呼叫或必要的 `OPENAI_API_KEY`；Search `max_uses=3` 不變。

Reader：一般網站先 Jina、X 單篇 status 使用 FxTwitter；X 個人頁等不支援。Classic PTT article 限 `ptt.cc`／`www.ptt.cc`，先正規化 HTTPS，以 over18 cookie 直接讀取並驗證 main-content／article-meta；符合條件的失敗最多使用一次既有 Jina，共用原 deadline。PTT 不進 AI extraction，404／410 不 fallback；term.ptt.cc 走一般網站流程。Facebook／Threads 只嘗試公開可讀內容。一般收件保留 legacy AI extraction fallback；工具 `read_url` 禁止 AI fallback，讀不到便安全回報。

資料表：ConversationLog、TopicHighlights、WeeklySummary、WebTaskQueue、WebSummary、NewsUrlQueue、NewsInbox、PendingReplies。Pending Reply 在 LINE Reply 成功後才刪除；失敗保留，仍可能在 acknowledge 失敗後重送，不承諾 exactly-once。

## Setup、部署與維護

1. 將所有 active `.gs` 同步到 GAS 專案；不可把 tests、Markdown 或 Node 模組部署到 GAS。
2. Script Properties 沿用 `LINE_CHANNEL_ACCESS_TOKEN`、`SPREADSHEET_ID`、`DEEPSEEK_API_KEY`。不得把值提交至 Git。`GEMINI_API_KEY` 非正常 runtime 必需。
3. **首次建立環境**才執行 `setupLogSheet()` 與 `installWebTaskQueueTrigger()` 並完成必要授權。從 v1.15.4 升級無需 setup、migration 或重建 Trigger。
4. 維護者手動建立 GAS version，更新既有 Web App deployment，保留 URL。Git commit／push／merge 不等於 GAS 部署。
5. 部署前後檢查 `doPost`、`processWebTaskQueue`、`processNewsUrlQueue` 與既有排程。具體同步檔案與 manual smoke checklist 見 [CURRENT_VERSION.md](CURRENT_VERSION.md)。

本機檢查：`node tests/v1140_smoke.cjs`。這只是既有開發 smoke test，使用 Node 內建模組，沒有新增 runtime dependency。測試不會呼叫真實 GAS／LINE／DeepSeek；目前結果及 live 限制見 CURRENT_VERSION。

修改規則見 [AGENTS.md](AGENTS.md)：先看現行 caller 與契約、在非 main 工作分支修改、檢查 diff，發布與 GAS 同步由維護者處理。

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
