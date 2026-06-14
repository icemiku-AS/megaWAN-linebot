# AGENTS.md

本文件是給 Codex / AI coding agent 使用的專案工作規則。

本專案是 MEGA浣 / 小浣 LINE Bot。請在每次開始工作前閱讀並遵守本文件。

---

## 1. 專案身分

本專案正式名稱為 MEGA浣，小名小浣。

用途是協助 Podcast「現正熱潮中」進行新聞素材收集、網址讀取、素材整理、節目話題分析、重點保存與長期記憶封存。

本專案目前是 Google Apps Script 專案。

不要預設本專案是：

* Node.js 專案
* npm 專案
* Express / Next.js / Vite 專案
* 自架伺服器專案
* package.json 驅動的專案
* 需要 npm install / npm start / npm test 的專案

除非維護者明確要求，否則不要新增：

* package.json
* package-lock.json
* node_modules
* clasp 設定檔
* GitHub Actions
* Dockerfile
* 任何自架伺服器架構

---

## 2. 現行程式碼來源

本 repo 目前 branch 的實際檔案是唯一可操作的程式碼來源。

開始任何分析或修改前，請依照以下順序讀取：

1. CURRENT_VERSION.md
2. README.md
3. 與本次任務相關的實際 .gs 檔案
4. 必要時才讀 99_changelog.md

99_changelog.md 只作為歷史紀錄，不可把舊版段落當成目前實作。

若以下來源互相矛盾，優先順序如下：

1. 目前 branch 的實際 .gs 程式碼
2. CURRENT_VERSION.md
3. README.md
4. 99_changelog.md 最新段落
5. 舊版 changelog、舊對話、舊記憶、過去上傳檔案、歷史備份

不要根據舊對話或記憶自行推定目前架構。請以 repo 內現行檔案為準。

---

## 3. 工作模式判斷

每次任務開始時，先判斷本次屬於哪一種模式。

### A. 討論 / 規劃模式

如果使用者只是要求討論、分析、規劃、設計架構或評估方案：

* 不要修改檔案
* 不要建立 branch
* 不要 commit
* 不要開 PR
* 不要更新 CURRENT_VERSION.md
* 不要更新 README.md
* 不要更新 99_changelog.md

請只整理建議、風險、替代方案與下一步。

### B. 程式修改模式

只有在使用者明確要求「修改程式」、「幫我實作」、「更新版本」、「改檔案」、「直接做」時，才進入程式修改模式。

進入程式修改模式前，請先回報：

1. 讀到的版本
2. 目前所在 branch
3. 本次相關檔案
4. 預計修改哪些檔案
5. 本次版本邊界
6. 明確不做哪些事

---

## 4. Branch 與版本管理規則

不要直接修改 main。

如果目前在 main，且任務需要修改程式，請先停止並提醒維護者切換或建立 feature / hotfix branch。

除非維護者明確要求 Codex 自行建立 branch，否則不要自行切 branch。

建議 branch 命名：

* feature/vXXXX-short-topic
* hotfix/vXXXX-short-topic

例如：

* feature/v1110-news-status
* hotfix/v1109-reader-bugfix

GitHub 只作為版本管理來源。正式部署到 Google Apps Script 由維護者手動處理。

不要假設 push 到 GitHub 後會自動部署到 GAS。

---

## 5. 版本邊界規則

每次版本更新前，必須明確定義版本邊界。

請先寫清楚：

* 本版只做什麼
* 本版明確不做什麼
* 是否包含新功能
* 是否包含 bugfix
* 是否包含重構
* 是否包含文件更新
* 是否需要 Google Sheet schema 變更
* 是否需要手動在 Apps Script 執行 setup / migration 函式

避免一版同時混入：

* 新功能
* 大型重構
* 文件大改
* 清理舊程式
* Sheet schema 變更
* Prompt 架構大改

若使用者提出的需求過大，請優先建議拆版本。

---

## 6. 修改策略

優先小步修改。

請遵守：

* 優先新增獨立 .gs 檔案承接新功能
* 主流程檔案只做最小 router 修改
* 避免整份重寫大型檔案
* 避免大範圍格式化無關程式碼
* 避免同時改動多個不相關功能
* 保留既有中文註解
* 新增重要邏輯時補上清楚的繁體中文註解
* 不要刪除看似暫時無用但可能被 GAS 入口、LINE 指令或觸發器呼叫的函式，除非已完成引用檢查

如果需要改大型檔案，請優先做局部 patch。

---

## 7. Google Apps Script 注意事項

本專案執行環境是 Google Apps Script。

請注意：

* GAS 沒有一般 Node.js runtime
* 不可使用 require / import，除非專案已明確導入對應建置流程
* 不可假設可使用 npm 套件
* 不可假設可使用 fs、path、process、axios 等 Node.js API
* 優先使用 GAS 原生服務，例如 UrlFetchApp、SpreadsheetApp、PropertiesService、CacheService、LockService
* 注意 LINE webhook 回覆時間限制
* 注意 GAS 單次執行時間限制
* 注意 UrlFetchApp 配額與外部 API 錯誤處理
* 注意 Google Sheet 寫入資料時的欄位順序與既有資料相容性

---

## 8. Secret 與安全規則

GitHub repo 不應保存任何 secret value。

不要把以下內容寫入程式碼或文件：

* LINE Channel Access Token
* DeepSeek API Key
* Gemini API Key
* Google Sheet ID
* webhook secret
* private endpoint
* 個人帳號 token
* OAuth refresh token

Secret value 應由維護者放在 Apps Script Script Properties。

如果程式需要讀取 secret，請使用既有的 PropertiesService / 設定函式模式。

---

## 9. 重要資料表

本專案主要使用 Google Sheets 作為資料儲存層。

常見資料表包含：

* ConversationLog
* TopicHighlights
* WeeklySummary
* WebTaskQueue
* WebSummary
* NewsUrlQueue
* NewsInbox
* PendingReplies

修改任何資料表相關邏輯時，必須注意：

* 是否只作用於目前 conversationId
* 是否會誤刪其他聊天室資料
* 是否需要二段式確認
* 是否影響舊資料相容性
* 是否需要新增欄位
* 是否需要 migration / setup 函式

未經明確要求，不要做跨聊天室全域清理。

---

## 10. Reader Layer 規則

Reader Layer 的目標是把「讀網址」與「後續 LLM 整理」拆開。

修改網址讀取流程時，請優先維持統一 webResult 契約，讓下游流程可以繼續使用穩定欄位。

目前讀取策略請以 CURRENT_VERSION.md 與 16_ReaderLayer.gs 為準。

不要自行假設已整合：

* Apify
* ByCrawl
* PDF reader
* 圖片 OCR
* 影片內容讀取
* X / Twitter 個人頁自動擷取
* Facebook 私人貼文擷取
* Threads 登入牆擷取

除非使用者明確要求，否則不要導入新的外部 reader 服務。

---

## 11. 文件更新規則

### CURRENT_VERSION.md

如果本次是版本更新，必須更新 CURRENT_VERSION.md，並清楚標註：

* 本次版本
* working branch
* source of truth
* 本版包含哪些功能
* 本版明確不包含哪些功能
* 建議測試流程

如果只是討論或小型非版本化修正，不要自動更新 CURRENT_VERSION.md，除非維護者要求。

### README.md

README.md 可以在使用者功能、指令、架構或維護方式改變時更新。

不要為了小型內部修正大改 README。

### 99_changelog.md

99_changelog.md 只作為歷史紀錄。

若需要更新，只在最前面新增本版簡短段落。

不要：

* 重排整份歷史
* 刪除舊段落
* 大量改寫舊版本內容
* 同時做 README 大改與 changelog 大整理

更新後必須檢查 diff，確認沒有大量 deletions。

如果 changelog 修改出現截斷、衝突、大量刪除或不確定風險，請停止修改 changelog 並回報。

---

## 12. Diff 檢查規則

修改完成後，請檢查 diff。

確認：

* changed files 是否合理
* 沒有誤刪歷史文件
* 沒有大量格式化無關程式碼
* 沒有誤新增 Node.js / npm / package.json
* 沒有寫入 secret
* 99_changelog.md 沒有大量 deletions
* 主流程檔案沒有被不必要地整份重寫
* 文件內容與實際程式碼一致

如果 diff 過大，請先停下來整理原因，不要直接繼續擴大修改。

---

## 13. 測試與檢查

本專案不預設有 npm test。

完成修改後，請依照任務性質整理可行檢查。

常見檢查包含：

* 靜態閱讀相關 .gs 是否有語法錯誤
* 搜尋函式名稱是否有重複或拼錯
* 搜尋被修改函式的所有呼叫點
* 檢查 Sheet 欄位順序是否一致
* 檢查 LINE 指令是否有 router 入口
* 檢查 help / 版本文字是否需要同步
* 檢查錯誤處理與 fallback 是否保留
* 整理需要維護者在 GAS / LINE 手動測試的項目

如果無法在本機真正執行 GAS，請明確說明「未能本機執行 GAS」，並提供手動測試清單。

---

## 14. 回報格式

### 修改前回報

開始改檔前，請先回報：

* 讀到的版本
* 目前 branch
* 本次模式：討論 / 規劃 / 程式修改
* 本次相關檔案
* 預計修改檔案
* 本次版本邊界
* 明確不做的事

### 修改完成回報

完成後請回報：

* branch 名稱
* 修改檔案
* 每個檔案的修改重點
* 明確沒有做的事
* diff 風險檢查結果
* 測試或檢查結果
* 需要維護者手動同步到 GAS 的注意事項
* 建議在 LINE / GAS 測試的項目

如果本次沒有建立 PR，請不要虛構 PR 編號。

如果使用者透過 GitHub Desktop 手動 commit / push / PR，請只整理本機修改結果，不要假設 PR 已建立。

---

## 15. 不確定時的處理方式

如果遇到不確定情況：

* 先讀現行程式碼
* 不要根據舊記憶猜測
* 不要把歷史 changelog 當成現行實作
* 不要硬改不確定的主流程
* 優先縮小修改範圍
* 必要時先提出最小安全方案

如果工具、環境、權限或檔案狀態異常，請停止該部分修改並誠實回報。

不要為了完成任務而擴大風險。
