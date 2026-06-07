# 小浣 LINE Bot v1.10.3 Highlight & Cleanup Edition

這是 MEGA浣 / 小浣 的 LINE Bot 專案。

目前專案定位是：以 Google Apps Script 為主體的新聞素材秘書與節目準備輔助工具。小浣不是 Node.js 專案，也不是自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣用來協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.2 開始，小浣收斂為新聞素材秘書。v1.10.3 延續這個方向，新增 TopicHighlights，讓使用者可以用 #畫重點 把重要想法從一般聊天中獨立標記出來。

資料分層如下：

- ConversationLog：一般聊天與原始訊息。
- NewsUrlQueue：直接貼網址後的待處理網址。
- NewsInbox：整理後的新聞素材池。
- WebTaskQueue：#懶人包 與網址版 #節目話題分析 的背景任務。
- WebSummary：網址快讀摘要。
- TopicHighlights：#畫重點 的人工釘選素材。
- WeeklySummary：#封存本週話題 產生的長期記憶。
- PendingReplies：背景任務完成後等待交付的回覆。

---

## 2. v1.10.3 本版重點

- #記錄 改為 #畫重點。
- 新增 TopicHighlights Sheet。
- #統整話題、無網址版 #節目話題分析、#封存本週話題 會納入 TopicHighlights。
- 節目整理相關功能從 ConversationLog 讀資料時，只讀使用者訊息，不納入小浣回覆。
- 新增分層 help：#help、#help 清理、#help 管理、#help 資料、#help 全部。
- 新增資料維護入口，維護動作只作用於目前聊天室的 conversationId。
- 01_Main.gs 進一步瘦身，內建指令集中到 15_BuiltInCommands.gs。

---

## 3. 常用指令

直接貼網址：收進 NewsUrlQueue，背景整理後進 NewsInbox。

#本週新聞：查看最近 7 天 NewsInbox 新聞素材。

#新聞補充 文字 + 網址：人工補充新聞素材到 NewsInbox。

#懶人包 網址：針對指定網址產生快讀摘要。

#節目話題分析 網址：針對指定網址做較深入的節目話題分析。

#節目話題分析：不附網址時，根據近期使用者聊天、TopicHighlights、WebSummary、WeeklySummary 判斷可分析主題。

#統整話題：整理近期可用節目話題地圖。

#畫重點 內容：將重要內容寫入 TopicHighlights。

#封存本週話題：將近期使用者討論、畫重點與網址摘要整理成 WeeklySummary。

---

## 4. Help 與管理

#help：快速上手。

#help 清理：查看資料維護指令。

#help 管理：查看版本與管理指令。

#help 資料：查看各 Sheet 用途。

#help 全部：查看完整說明。

#版本：查看目前版本。

#版本紀錄：查看近期版本紀錄。

#reset：清除短期記憶，不影響 Google Sheet 長期資料。

---

## 5. 主要檔案

- 00_Config.gs：常數、模型、Sheet 名稱、指令前綴。
- 01_Main.gs：LINE webhook 主流程。
- 02_LineCommands.gs：指令解析、分層 help、LINE reply。
- 03_Utils.gs：共用工具。
- 04_Storage.gs：Google Sheet 入口與既有資料讀寫。
- 05_Memory.gs：短期記憶。
- 06_WebReader.gs：網址擷取與 HTML 清理。
- 07_WebTaskQueue.gs：網址快讀與節目分析背景任務。
- 08_GeminiService.gs：Gemini API。
- 09_DeepSeekService.gs：DeepSeek API。
- 10_TopicFeatures.gs：節目話題分析、統整、封存。
- 11_Prompts.gs：一般 prompt。
- 12_ResponseTexts.gs：既有固定文案。
- 13_NewsInbox.gs：新聞素材池。
- 14_HighlightsCleanup.gs：TopicHighlights 與資料維護工具。
- 15_BuiltInCommands.gs：內建指令分流。
- 16_ResponseTextsV1103.gs：v1.10.3 新增固定文案。
- 17_VersionTextsV1103.gs：v1.10.3 版本顯示文案。

---

## 6. 維護規則

1. 本專案目前是 Google Apps Script 專案，不要預設為 Node.js。
2. GitHub 不應保存 API Key、LINE token、Sheet ID 等 secret value。
3. 99_changelog.md 僅作為歷史紀錄。
4. 若 README、CURRENT_VERSION、changelog 與實際 .gs 不一致，以 .gs 為準。
5. PR 合併後，以 main branch 最新 commit 作為唯一現行程式碼來源。

---

## 7. 建議測試

合併後，先在 Apps Script 執行 setupLogSheet()，再測試 #版本、#help、#help 清理、#畫重點 測試內容、#統整話題、#封存本週話題。
