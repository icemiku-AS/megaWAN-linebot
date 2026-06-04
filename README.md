# 小浣 LINE Bot v1.8 Modular Edition

這份分檔版以原本 v1.7 Topic Pool Edition 為基礎，原則上不改功能，只做檔案拆分，方便後續維護。

## 檔案配置

1. `00_Config.gs`
   - API endpoint、模型名稱、Sheet 名稱、TaskType、LINE 指令、記憶與網頁讀取相關常數。

2. `01_Main.gs`
   - `setupLogSheet()`
   - `installWebTaskQueueTrigger()`
   - `doPost(e)`
   - `handleLineEvent(event)`
   - 主要入口、Webhook、防呆與主流程。

3. `02_LineCommands.gs`
   - LINE 指令解析、mode 判斷、conversationId、LINE Reply API、Help 文字。

4. `03_AiLogic.gs`
   - DeepSeek / Gemini 呼叫。
   - 網址讀取與 HTML 清理。
   - WebTaskQueue / PendingReplies。
   - Google Sheet 操作。
   - 短期記憶。
   - `#統整話題`、`#節目話題分析`、`#封存本週話題` 等功能。

5. `04_Prompts.gs`
   - `buildSystemPrompt(mode)`
   - 小浣人格、節目分析、摘要、標題、封存等 Prompt。

## 使用方式

把這五個 `.gs` 檔案內容分別貼到同一個 Google Apps Script 專案中即可。

注意：
- 不需要使用 `import` 或 `require`。
- 這些檔案在 Apps Script 專案中會共用同一個全域作用域。
- 舊的單一 `index.js` / `.gs` 請不要和分檔版同時保留，避免函式重複定義。
- 貼上後建議先手動執行 `setupLogSheet()`，再執行 `installWebTaskQueueTrigger()`。

## 建議測試順序

1. `setupLogSheet()` 是否成功。
2. `installWebTaskQueueTrigger()` 是否成功。
3. LINE 私訊 `#help`。
4. LINE 群組 `#小浣 測試`。
5. 群組直接貼網址，確認任務進入 `WebTaskQueue`。
6. 等排程處理後，再傳任意文字，確認 Pending Reply 交付。
7. 測試 `#統整話題`。
8. 測試 `#節目話題分析`。
