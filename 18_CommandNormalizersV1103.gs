// ======================================================
// 18_CommandNormalizersV1103.gs
// v1.10.3 群組指令相容層。
//
// 說明：
// 1. 私訊中通常直接輸入 #help 清理。
// 2. 群組中使用者可能輸入 #小浣 help 清理 或 #小浣 清空快讀。
// 3. 這個檔案先把 #小浣 後面的自然寫法補成正式 # 指令，再交給原本 parser。
// ======================================================

function normalizeHashCommandAfterBotMentionV1103_(text) {
  let normalized = String(text || '').trim();

  if (normalized.startsWith('#小浣')) {
    normalized = normalized.replace('#小浣', '').trim();
  }

  if (normalized && normalized.charAt(0) !== '#') {
    normalized = '#' + normalized;
  }

  return normalized;
}

function getHelpTextByCommandV1103_(text) {
  return getHelpTextByCommand_(normalizeHashCommandAfterBotMentionV1103_(text));
}

function getCleanupCommandInfoV1103_(text) {
  return getCleanupCommandInfo_(normalizeHashCommandAfterBotMentionV1103_(text));
}
