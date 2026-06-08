// ======================================================
// 18_PttOver18DetectionHotfix.gs
// v1.10.6 PTT Over18 Detection Hotfix：修正 PTT 成人確認頁誤判。
//
// 背景：
// 1. v1.10.5 新增 16_ReaderLayer.gs，PTT 網址會走 GAS UrlFetchApp + over18=1 cookie。
// 2. 實測顯示，PTT 文章頁可正常回傳 200，且 body 已是正式文章 HTML。
// 3. 但 v1.10.5 的 looksLikePttOver18Gate_() 只要看到 ask/over18 字樣就判定仍在滿 18 歲確認頁。
// 4. PTT 正常文章頁可能也會包含 ask/over18 相關模板、連結或 script，導致正常文章被誤判為 over18 gate。
//
// 本檔用途：
// - 以同名函式覆寫 v1.10.5 的 looksLikePttOver18Gate_()。
// - 這是小範圍 hotfix，避免為單一判斷式整份替換 16_ReaderLayer.gs。
// - Google Apps Script 會將同一專案的 .gs 檔放在同一個全域執行環境中；本專案採數字前綴檔名維持讀取與維護順序。
//
// 維護原則：
// 1. 正常文章頁只要已出現 PTT 文章結構，就不應被判定為 over18 gate。
// 2. 不再把「出現 ask/over18 字樣」單獨當成 gate 依據。
// 3. 只有真的出現同意按鈕，或同時出現未滿十八歲提示與 over18 form，才判定為 gate。
// 4. 未來若要整理技術債，可將本函式正式合併回 16_ReaderLayer.gs，再移除此相容 hotfix 檔。
// ======================================================

function looksLikePttOver18Gate_(html) {
  const text = String(html || '');

  // PTT 正常文章頁會包含 main-content 與 article-meta 結構。
  // 實測 C_Chat 成人看板文章可正常讀回 200，但頁面內仍可能殘留 ask/over18 字樣；
  // 因此只要已經看到文章結構，就應優先視為正式文章頁，而不是 over18 確認頁。
  const hasArticleStructure =
    text.indexOf('id="main-content"') >= 0 ||
    text.indexOf('class="article-meta-tag"') >= 0 ||
    text.indexOf('class="article-meta-value"') >= 0;

  if (hasArticleStructure) {
    return false;
  }

  // 真正的 PTT over18 gate 會出現明確的同意按鈕文字。
  // 這個訊號足夠強，可以直接判定為成人確認頁。
  const hasAgreeButton = text.indexOf('我同意，我已年滿十八歲') >= 0;

  if (hasAgreeButton) {
    return true;
  }

  // ask/over18 不能單獨使用，因為正常文章頁可能也包含這個字串。
  // 只有同時看見「未滿十八歲」提示與 over18 form / action，才視為 gate。
  const hasUnderAgeWarning = text.indexOf('未滿十八歲') >= 0;
  const hasOver18Form =
    text.indexOf('/ask/over18') >= 0 &&
    (
      text.indexOf('name="yes"') >= 0 ||
      text.indexOf('value="yes"') >= 0 ||
      text.indexOf('method="post"') >= 0
    );

  return hasUnderAgeWarning && hasOver18Form;
}
