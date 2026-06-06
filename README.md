# 小浣 LINE Bot v1.10.2 Secretary Cleanup Edition

這是 MEGA浣 / 小浣 的 Google Apps Script 分檔版。

## 本版重點

v1.10.2 將小浣收斂成新聞素材秘書。

直接貼網址會收進 NewsInbox。這個行為在群組與個人聊天室一致。

需要快讀摘要時，請使用 #懶人包。

## 保留指令

- #本週新聞
- #新聞補充
- #懶人包
- #節目話題分析
- #統整話題
- #封存本週話題
- #記錄
- #小浣
- #help
- #版本
- #版本紀錄
- #reset
- #清空紀錄
- #清空紀錄 確認

## 已移除指令

- #摘要
- #摘要最近
- #回顧最近
- #標題
- #讀網址

## 檔案配置

主要程式碼仍位於 00_Config.gs 到 13_NewsInbox.gs。

本專案目前是 Google Apps Script 專案，不是 Node.js 專案。

99_changelog.md 只作為歷史紀錄；若文件與實際 .gs 程式碼衝突，以目前 GitHub 目標版本分支或 main branch 最新 commit 中的 .gs 為準。
