# 小浣 LINE Bot v1.10.3 Highlight & Cleanup Edition

這是 **MEGA浣 / 小浣** 的 LINE Bot 專案。

目前專案定位是：以 **Google Apps Script** 為主體的新聞素材秘書與節目準備輔助工具。

小浣不是 Node.js 專案，也不是部署在自架伺服器上的 Bot。主要執行環境為 Google Apps Script，資料儲存以 Google Sheets 為核心。

---

## 1. 專案定位

小浣的核心用途是協助 Podcast「現正熱潮中」進行素材收集、新聞整理、節目話題分析與長期記憶封存。

v1.10.2 開始，小浣的產品方向正式收斂為「新聞素材秘書」。

v1.10.3 延續這個方向，新增 `TopicHighlights` 這層人工重點資料，讓使用者可以用 `#畫重點` 把重要想法從一般聊天中獨立標記出來。

簡單來說：

- 一般聊天會進 `ConversationLog`。
- 直接貼網址會進 `NewsUrlQueue`，背景整理後進 `NewsInbox`。
- `#懶人包` 會進 `WebTaskQueue`，完成後寫入 `WebSummary`。
- `#畫重點` 會寫入 `TopicHighlights`。
- `#封存本週話題` 會把近期素材壓縮成 `WeeklySummary`。

這樣資料會分層，不會全部混在同一鍋裡。

---

## 2. v1.10.3 本版重點

### 2.1 `#記錄` 升級為 `#畫重點`

v1.10.2 以前的 `#記錄` 實際上仍只是 ConversationLog 的特殊標記。

但因為所有使用者訊息本來就會寫入 ConversationLog，所以 `#記錄` 的實際價值有限。

v1.10.3 將它改為：

```text
#畫重點 內容 使用後，小浣會把去掉指令後的文字寫入 TopicHighlights。

TopicHighlights 是人工釘選素材，後續會被以下功能優先參考：

#統整話題
無網址版 #節目話題分析
#封存本週話題
2.2 節目整理只讀使用者訊息

v1.10.3 起，節目整理相關功能從 ConversationLog 讀資料時，預設只讀 role = user。

也就是說，小浣自己的回覆不會被納入：

#統整話題
無網址版 #節目話題分析
#封存本週話題

這是為了避免小浣自己的功能性回覆，例如：

收到，我先整理
已排入背景處理
沒有找到資料
任務完成了

被反覆納入話題整理，造成資料污染。

2.3 分層 help

v1.10.3 將 help 拆成多層，避免主 #help 變成巨大說明書。

目前支援：

#help
#help 清理
#help 管理
#help 資料
#help 全部

群組中也可使用：

#小浣 help
#小浣 help 清理
#小浣 help 管理
#小浣 help 資料
#小浣 help 全部

主 #help 只列常用功能。

細節指令則分流到：

#help 清理
#help 管理
#help 資料
#help 全部
2.4 多資料表維護指令

v1.10.3 新增多個資料表維護入口。

所有維護指令都只作用於目前聊天室的 conversationId。

也就是：

私訊只處理該私訊資料。
群組只處理該群組資料。
不會跨聊天室清資料。
不會刪除整張 Sheet。
不會刪除表頭。

可透過以下指令查看完整資料維護入口：

#help 清理
3. 常用指令
直接貼網址

直接貼上網址時，小浣會將網址加入 NewsUrlQueue，由背景流程抓取網頁資訊、分類與整理，再寫入 NewsInbox。

這是目前小浣最主要的新聞素材收集入口。

個人聊天室與群組聊天室行為一致。

差別只在：

個人聊天室可以直接對小浣說話。
群組聊天室一般聊天不會觸發小浣，除非使用 #小浣 或其他正式指令。
群組中直接貼網址，即使沒有 #小浣，也會被收進新聞素材池。
#本週新聞

查看最近 7 天收集到的 NewsInbox 新聞素材。

小浣會依分類整理近期新聞素材，方便節目準備時快速掃過。

#新聞補充 文字 + 網址

當某些網頁無法順利抓取，或需要手動補充標題、重點、背景時，可以使用此指令。

範例：

#新聞補充 這篇大概是在講某平台政策改動，偏社群輿論，節目潛力高 https://example.com/news

這會將人工補充內容寫入 NewsInbox。

#懶人包 網址

針對指定網址產生快讀摘要。

這是目前唯一保留的明確網址快讀入口。

一般直接貼網址不會產生懶人包，而是收進 NewsInbox。

#節目話題分析 網址

針對指定網址產生較深入的節目話題分析。

此流程會走背景任務，處理完成後透過 PendingReplies 在下一次對話時交付結果。

#節目話題分析

不附網址時，小浣會根據近期內容自行判斷適合分析的主題。

資料來源包括：

使用者的近期聊天內容
TopicHighlights
WebSummary
WeeklySummary

不會納入小浣自己的回覆。

#統整話題

整合近期素材，整理成節目可用的話題地圖。

資料來源包括：

使用者的近期聊天內容
TopicHighlights
WebSummary
WeeklySummary

適合用在節目前準備、整理本週累積素材、決定哪些話題值得聊。

#畫重點 內容

將重要內容寫入 TopicHighlights。

範例：

#畫重點 這次平台政策變更可以從創作者依賴、平台風險與規則不透明三個方向切入

後續 #統整話題、#節目話題分析、#封存本週話題 都會優先參考這些人工標記重點。

#封存本週話題

將近期使用者討論、畫重點與網址快讀摘要整理成 WeeklySummary。

WeeklySummary 是長期記憶摘要，讓小浣未來可以知道某些主題以前討論過，以及當時有哪些觀點。

v1.10.3 的封存資料來源：

使用者聊天內容
TopicHighlights
WebSummary

不納入小浣自己的回覆。

4. Help 與管理指令
#help

快速上手，只列常用功能。

#help 清理

查看資料維護指令。

目前清理類指令會採二段式確認。

常見項目包括：

#清空紀錄
#清空重點
#清空快讀
#清空封存
#清空新聞
#清空待回覆

實際清理前，小浣會先提示影響範圍。

確認後再輸入：

指令 確認
#help 管理

查看管理類指令，例如：

#版本
#版本紀錄
#reset
#help 清理
#help 資料
#help 資料

查看目前各 Google Sheet 的用途。

#help 全部

查看完整說明。

#版本

查看目前版本。

v1.10.3 起，版本顯示由 17_VersionTextsV1103.gs 提供。

#版本紀錄

查看近期版本紀錄摘要。

完整歷史仍以 99_changelog.md 為準。

#reset

清除當前 conversationId 的短期記憶狀態。

這只會清除 CacheService 中的短期對話記憶，不會刪除 Google Sheet 裡的長期資料。

5. 資料表概念

本專案主要使用 Google Sheets 作為資料儲存層。

主要資料表如下：

ConversationLog

保存使用者與小浣的原始對話紀錄。

用途：

保留原始聊天內容
提供近期上下文
支援一般對話與部分節目整理功能

v1.10.3 起，節目整理功能從 ConversationLog 讀資料時，預設只讀使用者訊息，不讀小浣回覆。

TopicHighlights

保存 #畫重點 的人工釘選素材。

用途：

儲存使用者手動標記的重要想法
供 #統整話題 優先參考
供無網址版 #節目話題分析 優先參考
供 #封存本週話題 納入長期記憶
WeeklySummary

保存 #封存本週話題 產生的長期記憶摘要。

用途：

保存過去討論過的重要主題
讓後續話題分析知道以前是否聊過
協助形成極簡長期記憶
WebTaskQueue

保存網址快讀與網址版節目分析的背景任務。

主要來源：

#懶人包 網址
#節目話題分析 網址
WebSummary

保存網址快讀摘要。

主要來源：

#懶人包
網址版 #節目話題分析 的部分處理結果

後續會被以下功能參考：

#統整話題
#節目話題分析
#封存本週話題
NewsUrlQueue

保存直接貼網址後的新聞網址待處理佇列。

直接貼網址時，小浣會先將網址放進這張表，再由背景 trigger 慢慢處理。

NewsInbox

新聞素材池。

主要來源：

直接貼網址
#新聞補充

主要用途：

#本週新聞
PendingReplies

保存背景任務完成後，等待下次訊息交付的回覆。

例如：

#懶人包 完成後的摘要
#節目話題分析 網址 完成後的分析結果
網址抓取失敗後的提醒
6. 檔案配置

目前主要檔案如下：

00_Config.gs

集中管理：

API endpoint
模型名稱
Sheet 名稱
指令前綴
系統常數

v1.10.3 新增：

TOPIC_HIGHLIGHTS_SHEET_NAME
DEFAULT_RECENT_TOPIC_HIGHLIGHT_COUNT
#畫重點
#清空
01_Main.gs

LINE webhook 主流程。

v1.10.3 起進一步瘦身。

主要負責：

接收 LINE event
寫入 ConversationLog
處理 pending reply
處理群組 / 個人聊天室網址收件
將內建指令交給 15_BuiltInCommands.gs
將一般指令交給後續功能流程
02_LineCommands.gs

負責：

LINE 指令解析
#help 分層說明
LINE Reply API

v1.10.3 新增：

#help 清理
#help 管理
#help 資料
#help 全部
#畫重點 的 log mode
清理類指令的 log mode
03_Utils.gs

共用工具函式。

04_Storage.gs

Google Sheet 與 Script Properties 入口。

負責既有資料表：

ConversationLog
WeeklySummary
WebTaskQueue
PendingReplies
WebSummary

v1.10.3 將 TopicHighlights 與清理工具放到 14_HighlightsCleanup.gs，避免 04_Storage.gs 再繼續變胖。

05_Memory.gs

短期對話記憶。

使用 Apps Script CacheService。

06_WebReader.gs

網址擷取與 HTML 清理。

07_WebTaskQueue.gs

背景處理：

#懶人包
網址版 #節目話題分析
08_GeminiService.gs

Gemini API 相關流程。

目前主要負責：

快讀摘要
正文抽取
新聞網址分類
09_DeepSeekService.gs

DeepSeek API 相關流程。

主要負責：

一般對話
節目話題分析
統整話題
封存本週話題
人工新聞補充解析
10_TopicFeatures.gs

節目企劃功能層。

負責：

#節目話題分析
#統整話題
#封存本週話題

v1.10.3 調整：

從 ConversationLog 只讀 user 訊息
加入 TopicHighlights
封存來源改為 user-only ConversationLog + TopicHighlights + WebSummary
11_Prompts.gs

一般 prompt。

12_ResponseTexts.gs

既有固定文案與舊版版本資訊。

v1.10.3 因避免大檔替換風險，未直接大幅改動此檔。

13_NewsInbox.gs

新聞素材池。

負責：

NewsUrlQueue
NewsInbox
直接貼網址收件
#本週新聞
#新聞補充
14_HighlightsCleanup.gs

v1.10.3 新增。

負責：

TopicHighlights Sheet 初始化
#畫重點 寫入
讀取近期人工重點
資料維護指令解析
依 conversationId 清理指定資料表
15_BuiltInCommands.gs

v1.10.3 新增。

負責處理不需要進入 LLM 的內建指令：

help
version
reset
cleanup
highlight
archive weekly

目的：避免 01_Main.gs 再次變胖。

16_ResponseTextsV1103.gs

v1.10.3 新增固定回覆文案。

目前負責：

#畫重點 成功 / 空內容提示
資料維護提示
資料維護完成提示
17_VersionTextsV1103.gs

v1.10.3 版本顯示文案。

負責：

#版本
#版本紀錄

這樣可以避免直接大幅替換 12_ResponseTexts.gs。