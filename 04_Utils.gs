// ======================================================
// 04_Utils.gs
// 用途：Shared foundation：共用 ID 產生與寬鬆 JSON object 解析。
//
// 職責與協作：
// 1. 提供跨功能使用的基礎 helper；特定功能的規則與驗證留在所屬檔案。
//
// 維護注意：
// 1. 寬鬆 JSON 解析不取代 AiService 的結構檢查或各功能的 business validator。
// 2. GAS 函式共用全域命名空間，底線後綴只是內部 helper 慣例，不提供真正 private 隔離。
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
