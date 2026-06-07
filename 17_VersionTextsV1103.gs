// ======================================================
// 17_VersionTextsV1103.gs
// v1.10.3 專用版本文字。
//
// 說明：
// 1. 12_ResponseTexts.gs 是既有固定文案主檔。
// 2. 本版為避免一次替換主檔過大，將 v1.10.3 的版本顯示文案獨立放在這裡。
// 3. 15_BuiltInCommands.gs 會優先呼叫本檔函式，讓 #版本 與 #版本紀錄 顯示最新版本。
// ======================================================

const BOT_CURRENT_VERSION_V1103 = 'v1.10.3 Highlight & Cleanup Edition';
const BOT_CURRENT_VERSION_DATE_V1103 = '2026-06-08';

const BOT_VERSION_HISTORY_V1103 = [
  {
    version: 'v1.10.3 Highlight & Cleanup Edition',
    date: '2026-06-08',
    summary: '新增 #畫重點、TopicHighlights、分層 help 與資料維護指令，讓節目素材整理更乾淨。',
    changes: [
      '新增 #畫重點，將人工標記的重要內容寫入 TopicHighlights。',
      '#統整話題、#節目話題分析、#封存本週話題 會納入 TopicHighlights。',
      '節目整理相關功能從 ConversationLog 只讀使用者訊息，避免小浣功能性回覆污染素材。',
      '新增 #help 清理、#help 管理、#help 資料、#help 全部。',
      '新增 14_HighlightsCleanup.gs、15_BuiltInCommands.gs、16_ResponseTextsV1103.gs、17_VersionTextsV1103.gs。'
    ]
  },
  {
    version: 'v1.10.2 Secretary Cleanup Edition',
    date: '2026-06-07',
    summary: '收斂小浣功能定位，移除重疊低用量指令，並讓個人聊天室直接貼網址與群組行為一致。',
    changes: [
      '移除 #摘要、#摘要最近、#回顧最近、#標題、#讀網址。',
      '直接貼網址在群組與個人聊天室都會收進 NewsInbox。',
      '保留 #懶人包 作為唯一明確網址快讀入口。'
    ]
  },
  {
    version: 'v1.10.1 News Inbox Hotfix',
    date: '2026-06-06',
    summary: '修正 NewsInbox 自動分類不足仍入庫，以及 #本週新聞 LINE 換行格式不佳的問題。',
    changes: [
      '自動網址分類不足會回到 NewsUrlQueue 重試。',
      '#本週新聞 改由程式端固定排版。'
    ]
  }
];

function getBotVersionTextV1103_() {
  const current = BOT_VERSION_HISTORY_V1103[0];
  return [
    '小浣目前版本：',
    BOT_CURRENT_VERSION_V1103,
    '',
    '更新日期：' + BOT_CURRENT_VERSION_DATE_V1103,
    '',
    '這版我多了一張真正的重點便利貼：#畫重點 會進 TopicHighlights，之後統整、分析、封存都會優先參考。',
    '',
    '本次新增 / 修正：',
    formatBulletList_(current.changes),
    '',
    '想看一路以來的更新，可以輸入：',
    '#版本紀錄'
  ].join('\n');
}

function getBotVersionHistoryTextV1103_() {
  const blocks = BOT_VERSION_HISTORY_V1103.map(function(item) {
    return [item.version + '｜' + item.date, item.summary, formatBulletList_(item.changes)].join('\n');
  });

  return [
    '我把目前記得的版本紀錄翻出來了：',
    '',
    blocks.join('\n\n'),
    '',
    '提醒：這裡是小浣執行時內建的版本摘要，完整歷史仍以 GitHub 的 99_changelog.md 為準。'
  ].join('\n');
}
