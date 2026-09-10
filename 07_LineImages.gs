// ======================================================
// 07_LineImages.gs
// LINE 圖片：Get message content、輸入驗證與 image_analysis 功能入口。
// 小浣 LINE Bot v1.14.0 DeepSeek Flash Multimodal Edition
//
// 01_Main.gs 決定私訊／群組觸發；本檔只接受 webhook 提供的 message ID。
// 10_AiService.gs 接收 text + image bytes；15_DeepSeekProvider.gs 才產生 Base64/data URL。
// 不保存原圖，不建立圖片 queue；memory / ConversationLog 只保存 placeholder 與分析文字。
// ======================================================

const LINE_MESSAGE_CONTENT_ENDPOINT_PREFIX = 'https://api-data.line.me/v2/bot/message/';
const LINE_IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 10;

/** 私訊直接傳圖，或以 #小浣 看圖 引用圖片。所有錯誤只回固定文案，不附外部原始錯誤。 */
function analyzeLineImage_(event, conversationId, messageId, question, executionContext) {
  if (!messageId) return getBotTextImageError_('image_need_quote');
  const safeQuestion = redactAiMediaText_(question).trim().slice(0, 1000);
  const historyText = '[使用者提供圖片]' + (safeQuestion ? ' ' + safeQuestion : ' 請描述圖片重點。');
  if (event.message.type === 'image') {
    logMessageToSheet({ event: event, conversationId: conversationId, role: 'user', text: historyText, mode: 'image_input' });
  }

  try {
    // 私訊 image event 明確標示 external 時不抓任意 URL；引用圖片則由 LINE content API 驗證。
    if (event.message.type === 'image' && event.message.contentProvider && event.message.contentProvider.type !== 'line') {
      return getBotTextImageError_('image_unavailable');
    }
    const downloaded = downloadLineImage_(messageId, executionContext);
    if (!downloaded.ok) return getBotTextImageError_(downloaded.errorType);

    const result = runAiMemoryTask('image_analysis', conversationId, historyText, [
      { type: 'text', text: safeQuestion || '請描述這張圖片的重點；如果有文字或錯誤訊息，請說明可辨識的內容。' },
      downloaded.image
    ], requireAiCallOptionsForExecutionContext_(executionContext));
    return result.ok ? result.text : getBotTextImageError_(result.errorType);
  } catch (error) {
    // 不記錄 exception：下載錯誤可能包含 URL/token，序列化錯誤可能包含圖片。
    return getBotTextImageError_(error && error.errorType);
  }
}

/**
 * 只從 LINE 固定 endpoint 取資料，拒絕 redirect；messageId 必須為 webhook 的數字字串。
 * GAS 會先緩衝 HTTP response，無法串流提早截斷；header 與實際 bytes 雙重檢查後才交給 AI。
 */
function downloadLineImage_(messageId, executionContext) {
  if (typeof messageId !== 'string' || !/^\d{1,64}$/.test(messageId)) {
    return { ok: false, errorType: 'image_unavailable' };
  }
  try {
    const aiOptions = requireAiCallOptionsForExecutionContext_(executionContext);
    const token = getRequiredScriptProperty_('LINE_CHANNEL_ACCESS_TOKEN');
    const response = UrlFetchApp.fetch(LINE_MESSAGE_CONTENT_ENDPOINT_PREFIX + messageId + '/content', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      followRedirects: false,
      muteHttpExceptions: true,
      timeoutSeconds: resolveAiRequestTimeoutSeconds_(LINE_IMAGE_DOWNLOAD_TIMEOUT_SECONDS, aiOptions)
    });
    const status = response.getResponseCode();
    if (status !== 200) {
      return { ok: false, errorType: status === 408 || status === 429 || status >= 500 ? 'image_download_failed' : 'image_unavailable' };
    }
    const headers = response.getAllHeaders();
    const contentTypeKey = Object.keys(headers).find(function(key) { return key.toLowerCase() === 'content-type'; });
    const lengthKey = Object.keys(headers).find(function(key) { return key.toLowerCase() === 'content-length'; });
    const mimeType = String(headers[contentTypeKey] || '').split(';')[0].trim().toLowerCase();
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') {
      return { ok: false, errorType: 'image_unsupported_format' };
    }
    if (lengthKey && (!/^\d+$/.test(String(headers[lengthKey])) || Number(headers[lengthKey]) > AI_IMAGE_MAX_BYTES)) {
      return { ok: false, errorType: 'image_too_large' };
    }
    const bytes = response.getContent();
    if (!bytes || !bytes.length) return { ok: false, errorType: 'image_download_failed' };
    if (bytes.length > AI_IMAGE_MAX_BYTES) return { ok: false, errorType: 'image_too_large' };
    // 重用 service 的 bytes/MIME/signature 驗證，避免 HTTP 200 HTML 或偽裝格式送到供應商。
    let image;
    try {
      image = normalizeAiMessages_([{ role: 'user', content: [{ type: 'image', mimeType: mimeType, bytes: bytes }] }])[0].content[0];
    } catch (invalidImage) {
      return { ok: false, errorType: 'image_unsupported_format' };
    }
    // 圖片下載與驗證耗時都從同一 webhook deadline 扣除；不足就停止，不再做 HIGH request。
    requireAiCallOptionsForExecutionContext_(executionContext);
    return { ok: true, image: image };
  } catch (error) {
    const isTimeout = error && error.errorType === 'ai_timeout' || /timeout|timed out/i.test(String(error && error.message || ''));
    return { ok: false, errorType: isTimeout ? 'ai_timeout' : 'image_download_failed' };
  }
}
