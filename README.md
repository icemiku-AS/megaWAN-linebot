# 小浣 LINE Bot v1.8.0 Modular Edition
這是串LLM的line bot 小浣
正式名稱叫做MEGA浣
形象是長著浣熊耳朵與尾巴、會從垃圾桶探出頭的小幫手
podcast「現正熱潮中」的企劃助理


## 版本簡介
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