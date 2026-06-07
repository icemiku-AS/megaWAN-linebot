// ======================================================
// 16_ResponseTextsV1103.gs
// v1.10.3 extra fixed response text helpers.
// ======================================================

function getBotTextHighlightSaved_() {
  return ['我幫你畫起來了。', '這段會進 TopicHighlights，之後整理話題時會優先參考。'].join('\n');
}

function getBotTextHighlightEmpty_() {
  return ['你要我畫哪一段重點？', '#畫重點 這段內容之後節目可以從某個角度切入'].join('\n');
}

function getBotTextCleanupWarning_(cleanupInfo) {
  return [
    '這是資料維護動作，請先確認。',
    '',
    '項目：' + cleanupInfo.label,
    '資料表：' + cleanupInfo.affectedSheets.join('、'),
    '範圍：目前聊天室。',
    '',
    '確認請輸入：',
    cleanupInfo.confirmCommand
  ].join('\n');
}

function getBotTextCleanupDone_(cleanupInfo, cleanupResult) {
  const details = (cleanupResult.details || []).map(function(item) {
    return '・' + item.sheetName + '：' + item.count + ' 筆';
  }).join('\n');

  return ['資料維護完成。', '項目：' + cleanupInfo.label, '合計筆數：' + cleanupResult.total, details || '沒有符合資料'].join('\n');
}
