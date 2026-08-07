// ======================================================
// 04_Utils.gs
// Shared foundation：放跨多個領域共用、但不屬於特定功能的純輔助函式。
//
// 小浣 LINE Bot v1.13.1 Source Layout & File Ordering Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 本檔不決定 feature policy、provider route、Sheet schema、Queue retry 或 LINE 回覆格式。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式；GAS 沒有真正 private，仍須避免全域名稱衝突。
// ======================================================

// ======================================================
// ID 與 JSON 工具
// ======================================================

function createSimpleId(prefix) {
  return [
    prefix || 'id',
    new Date().getTime(),
    Math.floor(Math.random() * 1000000)
  ].join('_');
}

function parseJsonObjectLoose(text) {
  const raw = String(text || '').trim();

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);

    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      console.error('parseJsonObjectLoose error:', innerError);
      return null;
    }
  }
}
