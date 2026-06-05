// ======================================================
// 03_Utils.gs
// 通用工具函式。放跨多個模組都會使用、但不屬於特定服務的輔助函式。
//
// 小浣 LINE Bot v1.9 Service Split Edition
//
// 設計說明：
// 1. 此檔從原本肥大的 03_AiLogic.gs 拆出，功能邏輯盡量維持不變。
// 2. Google Apps Script 不需要 import / export；同一專案內函式可直接互相呼叫。
// 3. 檔案拆分的目的，是讓未來維護時能快速判斷：資料、記憶、網頁、排程、模型或節目功能各自在哪裡。
// 4. 函式名稱後綴底線（例如 xxx_）代表內部輔助函式，雖然 GAS 沒有真正 private，但維護時請視為內部使用。
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
