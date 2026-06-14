// ======================================================
// 18_VersionTexts.gs
// v1.10.9 Social Reader Edition：版本顯示文字。
//
// 這個小檔案只調整 #版本 與 #版本紀錄 的顯示內容，避免為了少量文字整份替換
// 12_ResponseTexts.gs。後續整理固定文案時，可再合併回主文字檔。
// ======================================================

function getBotVersionText_() {
  const changes = [
    'X / Twitter 單篇 /status/{id} 貼文會走 FxTwitter API。',
    'Facebook、fb.watch、Threads.com、Threads.net 改為先走 Jina Reader。',
    '社群網址成功讀取後仍沿用 NewsInbox、#懶人包、#節目話題分析既有流程。',
    '本版不導入 ByCrawl / Apify，不導入 Node.js / npm，也不改 Google Sheet schema。'
  ];

  return [
    '小浣目前版本：',
    'v1.10.9 Social Reader Edition',
    '',
    '更新日期：2026-06-14',
    '',
    '這版補上社群網址讀取第一階段：X / Twitter 用 FxTwitter API，Facebook / Threads 先交給 Jina Reader。',
    '',
    '本次新增 / 修正：',
    formatBulletList_(changes),
    '',
    '想看一路以來的更新，可以輸入：',
    '#版本紀錄'
  ].join('\n');
}
