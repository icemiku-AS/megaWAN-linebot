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
