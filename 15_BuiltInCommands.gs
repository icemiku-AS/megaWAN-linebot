// ======================================================
// 15_BuiltInCommands.gs
// v1.10.3：集中處理不需要進入 LLM 的內建指令，避免 01_Main.gs 再次變胖。
// ======================================================

function handleBuiltInCommandIfNeeded_(event, conversationId, userText) {
  const helpText = getHelpTextByCommand_(userText);
  if (helpText) {
    replyToLine(event.replyToken, helpText);
    logAssistantReplyToSheet(event, conversationId, helpText, 'help');
    return true;
  }

  if (userText === '#版本' || userText === '#小浣 版本') {
    const versionText = getBotVersionText_();
    replyToLine(event.replyToken, versionText);
    logAssistantReplyToSheet(event, conversationId, versionText, 'version');
    return true;
  }

  if (userText === '#版本紀錄' || userText === '#小浣 版本紀錄') {
    const versionHistoryText = getBotVersionHistoryText_();
    replyToLine(event.replyToken, versionHistoryText);
    logAssistantReplyToSheet(event, conversationId, versionHistoryText, 'version_history');
    return true;
  }

  if (userText === '#reset' || userText === '#小浣 reset') {
    clearConversationHistory(conversationId);
    const resetText = getBotTextResetDone_();
    replyToLine(event.replyToken, resetText);
    logAssistantReplyToSheet(event, conversationId, resetText, 'reset');
    return true;
  }

  const maintenanceInfo = getCleanupCommandInfo_(userText);
  if (maintenanceInfo) {
    const text = maintenanceInfo.isConfirm
      ? getBotTextAiError_()
      : getBotTextCleanupWarning_(maintenanceInfo);
    replyToLine(event.replyToken, text);
    logAssistantReplyToSheet(event, conversationId, text, 'cleanup_warning');
    return true;
  }

  if (userText.startsWith('#畫重點')) {
    return handleHighlightCommand_(event, conversationId, userText);
  }

  if (userText === '#封存本週話題') {
    return handleArchiveWeeklyCommand_(event, conversationId);
  }

  return false;
}

function handleHighlightCommand_(event, conversationId, userText) {
  const highlightText = userText.replace('#畫重點', '').trim();

  if (!highlightText) {
    const emptyText = getBotTextHighlightEmpty_();
    replyToLine(event.replyToken, emptyText);
    logAssistantReplyToSheet(event, conversationId, emptyText, 'highlight_empty');
    return true;
  }

  saveTopicHighlight_(event, conversationId, userText, highlightText);
  const savedText = getBotTextHighlightSaved_();
  replyToLine(event.replyToken, savedText);
  logAssistantReplyToSheet(event, conversationId, savedText, 'highlight_saved');
  return true;
}

function handleArchiveWeeklyCommand_(event, conversationId) {
  let archiveReply = '';
  try {
    archiveReply = archiveWeeklyTopics(event, conversationId);
  } catch (error) {
    console.error('archiveWeeklyTopics error:', error && error.stack ? error.stack : error);
    archiveReply = getBotTextArchiveError_();
  }

  replyToLine(event.replyToken, archiveReply);
  logAssistantReplyToSheet(event, conversationId, archiveReply, 'archive_weekly');
  return true;
}
