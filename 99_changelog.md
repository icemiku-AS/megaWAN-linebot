2026-06-08
v1.10.3 Highlight & Cleanup Edition
- 以 v1.10.2 Secretary Cleanup Edition 為基礎，維持 Google Apps Script 分檔架構，不導入 Node.js / npm。
- 將 #記錄 升級為 #畫重點，新增 TopicHighlights 作為人工重點資料表。
- #畫重點 會將去除指令後的內容寫入 TopicHighlights，而不是只留在 ConversationLog。
- #統整話題、無網址版 #節目話題分析、#封存本週話題 會納入 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀取資料時，只讀使用者訊息，不納入小浣回覆。
- 避免小浣自己的功能性回覆被反覆納入話題整理，降低資料污染。
- 新增分層 help：#help、#help 清理、#help 管理、#help 資料、#help 全部。
- #help 只保留常用入口，清理、管理、資料表說明改由分層 help 顯示。
- 新增多資料表維護入口，所有維護動作只作用於目前 conversationId。
- 維護指令不會跨聊天室處理資料，不刪整張 Sheet，也不刪表頭。
- 新增 14_HighlightsCleanup.gs，集中管理 TopicHighlights 與資料維護工具。
- 新增 15_BuiltInCommands.gs，將 help、version、reset、畫重點、維護、封存等內建指令從 01_Main.gs 中抽離。
- 新增 16_ResponseTextsV1103.gs，放置 v1.10.3 新增固定回覆文案。
- 新增 17_VersionTextsV1103.gs，提供 v1.10.3 的 #版本 與 #版本紀錄顯示。
- 01_Main.gs 進一步瘦身，只保留 webhook 主流程、高階事件分流與一般指令流程。
- 10_TopicFeatures.gs 更新為 user-only ConversationLog + TopicHighlights + WebSummary + WeeklySummary 的話題資料結構。
- CURRENT_VERSION.md 更新為 v1.10.3 版本判定文件。
- README.md 更新 v1.10.3 專案說明與維護規則。

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
