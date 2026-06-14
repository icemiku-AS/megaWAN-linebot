// ======================================================
// 19_UnsupportedUrlTextV1109.gs
// v1.10.9：更新非 status 社群網址提示。
// ======================================================

function getBotTextUnsupportedSocialUrl_(urls) {
  const count = urls && urls.length ? urls.length : 1;
  return [
    '這 ' + count + ' 個網址目前不能自動讀取。',
    'v1.10.9 已支援 X / Twitter 單篇 /status/{id} 貼文；請確認網址是不是單篇貼文格式。Facebook、fb.watch、Threads.com、Threads.net 會先走 Jina Reader，不會再提前攔截。',
    '',
    '你可以改用：',
    '#新聞補充 這篇大概在講某某事件，偏社群輿論，節目潛力高，後面附上原文網址'
  ].join('\n');
}
