// ======================================================
// 17_ReaderLayerCompat.gs
// v1.10.5 Reader Layer Edition：legacy reader 相容層。
//
// 用途：
// 1. 16_ReaderLayer.gs 會在 Jina Reader 失敗時呼叫 fetchAndExtractWebPageLegacy_()。
// 2. 由於 v1.10.5 採小步修改策略，06_WebReader.gs 的原始 fetchAndExtractWebPage(url)
//    暫時保留不動，避免整份大型檔案替換造成 diff 風險。
// 3. 本檔提供一個極薄的相容 wrapper，將 legacy fallback 導回 06_WebReader.gs 既有流程。
//
// 注意：
// - 這不是新的 reader provider，只是為了讓 Reader Layer 可以安全復用舊流程。
// - 若未來正式把 06_WebReader.gs 重構成 legacy 命名，可再移除此檔。
// ======================================================

function fetchAndExtractWebPageLegacy_(url) {
  return fetchAndExtractWebPage(url);
}
