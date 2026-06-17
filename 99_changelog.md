2026-06-17
v1.12.0 Silent URL Status & News Archive Edition
- 群組直接貼網址改為靜默進 NewsUrlQueue 背景整理，不再主動回覆 Brief。
- 網址不支援、入隊失敗或背景讀取失敗時，改透過 PendingReplies 延後回報。
- 新增 #狀態回報 與 #封存本週新聞；WeeklySummary 追加 ArchiveType / PeriodStart / PeriodEnd / SourceItemCount 以區分話題與新聞封存。
- #封存本週話題 改為只讀 ConversationLog；#本週新聞 移除節目潛力顯示，並可參考過去新聞封存脈絡。
- 本版不刪除既有進階功能，不修改 Reader Layer、WebTaskQueue、NewsInbox Outline 或外部服務。

// ==================================================

2026-06-16
v1.11.2 Brief Range Hotfix
- 將直接貼網址與 NewsInbox Brief 從 20 字內硬限制改為 30～50 字目標區間。
- 短內容例如 X / Twitter 貼文、公告或單句消息可自然少於 30 字，不硬湊字數。
- 程式端不再正常硬裁 Brief，只保留 120 字防爆上限，避免模型失控輸出。
- 本版不修改 NewsInbox schema、Outline、Reader Layer、WebTaskQueue、LINE router 或外部服務。

// ==================================================

2026-06-15
v1.11.1 Compact News Brief Edition
- 直接貼單一網址改為回覆 20 字內 Brief；Gemini 仍維持一次呼叫，同時產生 100～200 字 Outline 與 NewsInbox 分類資料。
- NewsInbox 最右側新增 Outline 欄位；同步與背景網址入庫都會保存完整 Outline。
- #本週新聞 使用短 Brief 並移除切角顯示；#統整話題會讀取近期 NewsInbox Outline，舊資料缺少時退回 Brief。
- 本版不修改 Reader Layer、WebTaskQueue、LINE router、外部 reader 服務或其他 Sheet schema。

// ==================================================

2026-06-14
v1.11.0 Direct URL Summary Edition
- 直接貼單一網址時，改為同步透過 Reader Layer 讀取，並由一次 Gemini 呼叫同時產生 100～200 字內容大綱與 NewsInbox 分類資料。
- 同步成功後直接寫入 NewsInbox 並回覆大綱，不再等待 NewsUrlQueue 或 PendingReplies。
- 多網址、Reader 過慢、同步 API 失敗或結果不足時，退回既有 NewsUrlQueue 背景處理。
- 本版不修改 #本週新聞、#懶人包、#節目話題分析、Reader 路由或 Google Sheet schema。

// ==================================================

2026-06-14
v1.10.10 Version History Maintenance Edition
- 更新 #版本 與 #版本紀錄 的固定文字，並在內建版本紀錄最前方加入 v1.10.10。
- #版本紀錄 改為只顯示最近 6 筆，避免回覆隨版本增加而過長。
- 保留完整歷史以 99_changelog.md 為準的提醒。
- 本版不修改 Reader Layer、NewsInbox、WebTaskQueue、Google Sheet schema 或 LINE webhook 主流程。

// ==================================================

2026-06-14
v1.10.9 Social Reader Edition
- 以 v1.10.8 Manual News Supplement Parse Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 新增 X / Twitter 單篇 status 貼文 reader：/status/{id} 類型網址會透過 FxTwitter API 讀取。
- Facebook、fb.watch、Threads.com、Threads.net 不再提前攔截，改先交給 Jina Reader 嘗試讀取。
- 成功讀取的社群內容會整理成 Reader Layer 統一 webResult 格式，讓 NewsInbox、#懶人包、#節目話題分析 沿用既有流程。
- 本版不導入 Apify / ByCrawl，不修改 Google Sheet schema，不重構 NewsInbox、Gemini / DeepSeek prompt 或 Reader Layer 主架構。

// ==================================================

2026-06-08
v1.10.8 Manual News Supplement Parse Hotfix
- 以 v1.10.7 NewsInbox Queue Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 #新聞補充 的 JSON parser 命名錯誤：parseLooseJson() 並不存在，應使用 parseJsonObjectLoose()。
- 避免人工補充表面成功、實際每次靜默掉進 fallback，導致 DeepSeek 解析結果沒有被使用。
- 保留 fallback 防守；若 DeepSeek API 失敗或回傳非 JSON，仍可用使用者原文建立人工補充素材。
- 本版不修改 NewsUrlQueue、Reader Layer、Gemini 自動分類、DeepSeek 主聊天流程，不導入 Apify / ByCrawl。

// ==================================================

2026-06-08
v1.10.7 NewsInbox Queue Hotfix
- 以 v1.10.6 PTT Over18 Detection Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 X / Facebook / Threads 直接貼網址時被寫入 NewsUrlQueue 並重試三次的問題。
- NewsInbox 入隊前會先攔截 unsupported_social_platform；混合網址時只讓可支援網址入隊。
- NewsUrlQueue 遇到 unsupported_social_platform / unsafe_url 這類永久性錯誤時會直接 failed，不再重試三次。
- 修正 NewsInbox failed 後誤呼叫不存在的 createPendingReply()，改用 createPendingReplyFromTask() 建立 PendingReplies。
- 本版不導入 Apify / ByCrawl，不支援 X / Facebook / Threads 自動擷取。

// ==================================================

2026-06-08
v1.10.6 PTT Over18 Detection Hotfix
- 以 v1.10.5 Reader Layer Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 PTT 正常文章頁被 looksLikePttOver18Gate_() 誤判為滿 18 歲確認頁的問題。
- 將 PTT over18 gate 修正與 legacy fallback wrapper 整合回 16_ReaderLayer.gs，避免 Reader Layer 檔案過度分散。
- 正常文章頁若已出現 main-content 或 article-meta 結構，就不再判定為 over18 gate。
- 本版不修改 Jina Reader、NewsInbox schema、DeepSeek / Gemini 主流程，不導入 Apify / ByCrawl。

// ==================================================

2026-06-08
v1.10.5 Reader Layer Edition
- 以 v1.10.4 Data Cleanup Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 新增 16_ReaderLayer.gs，集中管理一般網站 Jina Reader、PTT over18 cookie 特例與社群平台未支援偵測。
- #懶人包、#節目話題分析 + 網址、NewsInbox 自動分類改走 Reader Layer 取得 mainText。
- 保留 legacy raw HTML + Gemini extractor 作為 fallback，不在本版刪除舊流程。
- 本版不導入 Apify / ByCrawl，不支援 X / Facebook / Threads 自動擷取，不修改資料清理層。

// ==================================================

2026-06-08
v1.10.4 Data Cleanup Edition
- 以 v1.10.3 Highlight Layer Edition 為基礎，維持 Google Apps Script 分檔架構。
- 新增分層 help 與資料維護流程，讓常用說明、管理說明、資料表說明與清理說明分開。
- 新增 15_DataCleanup.gs，集中管理目前聊天室範圍內的資料維護邏輯。
- 新增多資料表清理入口，採二段式確認，並只作用於目前 conversationId。
- 本版不修改 AI prompt 主邏輯、不修改網址讀取架構、不導入 Node.js / npm。

// ==================================================

2026-06-08
v1.10.3 Highlight Layer Edition
- 以乾淨 v1.10.2 Secretary Cleanup Edition baseline 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 將 #記錄 升級為 #畫重點，新增 TopicHighlights 作為人工重點資料表。
- #畫重點 會將使用者手動標記的重要內容寫入 TopicHighlights，而不是只留在 ConversationLog。
- #統整話題、無網址版 #節目話題分析、#封存本週話題 會納入 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀取資料時，只讀使用者訊息，不納入小浣回覆。
- 新增 14_TopicHighlights.gs，集中管理 TopicHighlights 的建立、寫入與讀取。
- 本版不導入 #清空重點、#清空快讀、#清空封存、#清空新聞 等多資料表清理指令；清理功能留待後續版本。

// ==================================================

2026-06-08
v1.10.2 Restore Baseline
- 回溯並整理目前 main 的正式基準為 v1.10.2 Secretary Cleanup Edition。
- v1.10.3 Highlight & Cleanup Edition 曾嘗試導入 #畫重點、TopicHighlights、分層 help 與多資料表清理，但該批變更已被 revert，不視為目前正式實作。
- 修復 README.md 中殘留 v1.10.3 內容導致 markdown 結構混亂的問題。
- 更新 CURRENT_VERSION.md，明確宣告目前 Source of Truth 為 main branch 最新 commit。
- 後續若要重新導入 #畫重點 / TopicHighlights，建議從乾淨 v1.10.2 baseline 重新規劃與開新 PR。

// ==================================================

2026-06-07
v1.10.2 Secretary Cleanup Edition
- 以 v1.10.1 News Inbox Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 移除 #摘要、#摘要最近、#回顧最近、#標題，降低指令重疊與維護成本。
- 移除 #讀網址，保留 #懶人包 作為唯一明確網址快讀入口。
- 個人聊天室直接貼網址時，改與群組一致，收進 NewsUrlQueue / NewsInbox，不再自動走 WebTaskQueue 快讀摘要。
- 清理 01_Main.gs 中已廢止的 summary_recent / review_recent 分支。
- 清理 02_LineCommands.gs 中已廢止的指令解析、log mode、help 內容與 extractNumber()。
- 清理 09_DeepSeekService.gs 中不再使用的 summary / review / title 模式參數。
- 清理 11_Prompts.gs 中不再使用的 summary / review / title prompt。
- 更新 12_ResponseTexts.gs、13_NewsInbox.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-06
v1.10.1 News Inbox Hotfix
- 以 v1.10.0 News Inbox Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 修正 Gemini 自動新聞分類結果不足時，仍被正規化成「待分類」並以 ok 寫入 NewsInbox 的問題。
- 新增 isWeakAutoNewsClassification_()，自動分類若回傳無效分類、待分類，或標題是網址且簡介空白，會回到 NewsUrlQueue 重試。
- 重試規則沿用 v1.10.0：暫時性錯誤最多重試 3 次，失敗後建立 PendingReplies 通知使用者。
- 修正 #本週新聞 在 LINE 內排版過於擠壓的問題，改由程式端固定輸出分類、標題、來源網址與節目潛力的多行格式。
- 保留 #新聞補充 的 DeepSeek 自然語言解析；人工補充仍可寫入待分類，避免補件流程過度阻擋。
- 同步更新 12_ResponseTexts.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-06
v1.10.0 News Inbox Edition
- 以 v1.9.3 Gemini JSON Mode Hotfix 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 將「群組直接貼網址」從自動快讀懶人包改為 NewsInbox 新聞素材池收件分類。
- 新增 13_NewsInbox.gs，集中管理 NewsUrlQueue、NewsInbox、#本週新聞、#新聞補充。
- 新增 NewsUrlQueue Sheet，直接貼網址會先進佇列，由 processNewsUrlQueue() 背景排程處理。
- NewsUrlQueue 每次 trigger 最多處理 2 筆，降低 UrlFetchApp / Gemini 連續呼叫壓力。
- 新增 NewsInbox Sheet，儲存標題、網址、分類、50 字內簡介、觀點標籤、節目潛力、來源模式。
- 新聞分類固定為：科技與 AI、社群輿論、ACG娛樂、商業財經、國際政治、生活文化、馬斯克、川普、待分類。
- 直接貼網址成功入隊後只回覆收件，不再建立成功 pending reply；若網址讀不到或重試失敗，才建立 PendingReplies 通知使用者。
- 新增 #本週新聞，讀取最近 7 天 NewsInbox，由 DeepSeek 做秘書式整理，只輸出分類、標題、來源網址與節目潛力。
- 新增 #新聞補充，使用者可用自然語言加網址補充素材，由 DeepSeek 解析後寫入 NewsInbox。
- 新增 #懶人包 作為明確網址快讀指令；#讀網址 保留為舊習慣。
- 同步更新 00_Config.gs、01_Main.gs、02_LineCommands.gs、12_ResponseTexts.gs、README.md、CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.3 Gemini JSON Mode Hotfix
- 以 v1.9.2 Humanized System Reply Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 修正 Gemini API 400 錯誤：generation_config.response_format.text.mime_type INVALID_ARGUMENT。
- 修改 08_GeminiService.gs，將 Gemini generationConfig 從 responseFormat.text.mimeType/schema 退回 responseMimeType: 'application/json'。
- 保留 getGeminiLazySummarySchema_() 與 getGeminiWebExtractorSchema_()，但暫時只作為程式端資料契約與未來升級參考，不直接送進 Gemini API。
- 補上詳細註解，說明目前 v1beta + gemini-3.1-flash-lite 與 responseFormat.text.mimeType/schema 不相容。
- 更新 12_ResponseTexts.gs 的 #版本 / #版本紀錄 內建版本資訊。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.2 Humanized System Reply Edition
- 以 v1.9.1 Structured Gemini Output Edition 為基礎，維持 Google Apps Script 分檔架構、既有 LINE 指令流程與主要 Sheet 架構。
- 新增 12_ResponseTexts.gs，集中管理不經過 LLM 的固定回覆文字、版本資訊與版本紀錄。
- 新增 #版本 指令，可回覆目前版本與本次新增功能。
- 新增 #版本紀錄 指令，可回覆主要版本更新摘要。
- 調整任務接收、pending reply 交付、reset、清空紀錄、#記錄、錯誤提示、封存完成等固定回覆語氣。
- 修改 00_Config.gs，將 #版本 / #版本紀錄 加入 TRIGGER_PREFIXES。
- 修改 01_Main.gs，加入 #版本 / #版本紀錄 指令處理，並改用 12_ResponseTexts.gs 的固定文案。
- 修改 02_LineCommands.gs，新增 version log mode 與 help 說明。
- 修改 07_WebTaskQueue.gs，調整網址任務失敗與快讀結果格式。
- 修改 10_TopicFeatures.gs，調整沒有素材與封存完成時的固定提示。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.1 Structured Gemini Output Edition
- 以 v1.9.0 Service Split Edition 為基礎，維持 Google Apps Script 分檔架構與既有 LINE 指令流程。
- 修改 08_GeminiService.gs，將 Gemini 網頁快讀摘要與 Gemini 網頁正文抽取改為 structured output schema。
- 新增 getGeminiLazySummarySchema_()，集中定義快讀摘要 JSON 欄位、型別、必要欄位與 enum。
- 新增 getGeminiWebExtractorSchema_()，集中定義正文抽取 JSON 欄位、型別與必要欄位。
- 新增 buildGeminiJsonGenerationConfig_()，統一建立 Gemini REST API 的 JSON structured output generationConfig。
- 新增 normalizeGeminiString_()、normalizeGeminiStringArray_()、normalizeGeminiNumber_()、normalizeGeminiEnum_()，作為 structured output 之外的最後防守。
- 保留 parseJsonObjectLoose() fallback，避免偶發格式問題造成 WebTaskQueue 任務整個中斷。
- 同步更新 README.md 與 CURRENT_VERSION.md。

// ==================================================

2026-06-05
v1.9.0 Service Split Edition
- 拆分原本過於肥大的 03_AiLogic.gs。
- 新增 03_Utils.gs、04_Storage.gs、05_Memory.gs、06_WebReader.gs、07_WebTaskQueue.gs、08_GeminiService.gs、09_DeepSeekService.gs、10_TopicFeatures.gs。
- 將原本 04_Prompts.gs 調整為 11_Prompts.gs，讓檔案順序符合系統流程。
- 功能邏輯原則上不變，主要改善可維護性與未來擴充性。
- 每個程式碼檔案補上責任說明與維護註解，方便未來人工或 AI 重新讀取。

// ==================================================

2026-06-04
V1.7.1
- 調整小浣回覆內容，讓回答更精簡。
- 重新定義程式版號。
- 一次性讀網址調整成 3 個。

// ==================================================

版本：V1.7.0 Topic Pool Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. 只要訊息中含網址：不需要 #小浣，也不需要 #讀網址，立刻回覆收到網址，任務寫入 WebTaskQueue，TaskType = web_lazy_summary，由 time-driven trigger 背景處理。
3. UrlFetchApp 抓網頁，Script 做基礎垃圾訊息清理，Gemini Flash-Lite 產生 100 至 500 字快讀摘要。
4. 摘要寫入 WebSummary，作為未來 #統整話題 的素材池，同時寫入 PendingReplies，下一次同聊天室有任何文字訊息時交付結果。
5. #節目話題分析 + 網址：任務寫入 WebTaskQueue，TaskType = program_topic_analysis，Gemini 抽正文，DeepSeek 做節目話題深度分析。
6. #節目話題分析 沒貼網址：讀最近 ConversationLog + WebSummary + WeeklySummary，由 DeepSeek 判斷要分析剛剛聊天內容、正在寫的內容，或近期最有節目潛力的素材。
7. #統整話題：讀最近 ConversationLog + WebSummary + WeeklySummary，整理成近期話題地圖、可做節目段落、素材來源與優先順序。
8. PendingReplies 仍只是交付機制，正式素材保存於 WebSummary。

// ==================================================

版本：V1.6.2 Queue Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. #讀網址 或指令中含網址：立刻回覆收到網址摘要，任務寫入 WebTaskQueue，由 time-driven trigger 背景處理。
3. 處理完成後寫入 PendingReplies，下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果。
4. 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆。

必要 Script Properties：
1. LINE_CHANNEL_ACCESS_TOKEN
2. DEEPSEEK_API_KEY
3. GEMINI_API_KEY
4. SPREADSHEET_ID

// ==================================================

2026-06-04
v1.6.1
- 小甜正式改名為小浣。
- 調整群組回覆口吻。
- 移除 LINE markdown 格式。
- 加入網址 pending reply 流程。

// ==================================================

版本：V1.6.0 Queue Edition

核心架構：
1. 一般聊天、摘要、標題：即時呼叫 DeepSeek 回覆。
2. #讀網址 或指令中含網址：立刻回覆收到網址摘要，任務寫入 WebTaskQueue，由 time-driven trigger 背景處理。
3. 處理完成後寫入 PendingReplies，下次同聊天室有任何文字訊息時，優先用新的 replyToken 交付結果。
4. 交付後直接刪除 PendingReplies 該筆資料，避免跟後續任務混淆。

必要 Script Properties：
1. LINE_CHANNEL_ACCESS_TOKEN
2. DEEPSEEK_API_KEY
3. GEMINI_API_KEY
4. SPREADSHEET_ID

// ==================================================

版本：V1.5.0 WebReader Integrated

功能：
1. 使用 DeepSeek deepseek-v4-flash 作為主要回覆模型。
2. 使用 Gemini 3.1 Flash-Lite 作為網頁正文抽取模型。
3. 支援 LINE 私訊多輪對話。
4. 支援 LINE 群組指令觸發，避免每句話都回覆。
5. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog。
6. 可讀取最近 N 則對話進行摘要與回顧。
7. 可清除短期記憶與指定聊天室長期紀錄。
8. 可將本週話題封存成極簡長期記憶：WeeklySummary。
9. 回覆時會讀取 WeeklySummary，作為過去討論脈絡。
10. 支援 #讀網址：UrlFetchApp 讀網頁，Gemini 抽正文，DeepSeek 做整理。

// ==================================================

版本：V1.4.0 Integrated

功能：
1. 使用 DeepSeek deepseek-v4-flash。
2. 支援 LINE 私訊多輪對話。
3. 支援 LINE 群組指令觸發，避免每句話都回覆。
4. 將使用者與 AI 回覆寫入 Google Sheet：ConversationLog。
5. 可讀取最近 N 則對話進行摘要與回顧。
6. 可清除短期記憶與指定聊天室長期紀錄。
7. 可將本週話題封存成極簡長期記憶：WeeklySummary。
8. 回覆時會讀取 WeeklySummary，作為過去討論脈絡。

// ==================================================
