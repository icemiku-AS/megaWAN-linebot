function handleBuiltInCommandIfNeeded_(event, conversationId, userText) {
  const helpText = getHelpTextByCommand_(userText);
  if (helpText) return replyAndLog_(event, conversationId, helpText, 'help');

  if (userText === '#版本' || userText === '#小浣 版本') return replyAndLog_(event, conversationId, getBotVersionTextV1103_(), 'version');
  if (userText === '#版本紀錄' || userText === '#小浣 版本紀錄') return replyAndLog_(event, conversationId, getBotVersionHistoryTextV1103_(), 'version_history');

  if (userText === '#reset' || userText === '#小浣 reset') {
    clearConversationHistory(conversationId);
    return replyAndLog_(event, conversationId, getBotTextResetDone_(), 'reset');
  }

  const normalized = normalizeMaintenanceText_(userText);
  if (normalized.startsWith('#畫重點')) return handleHighlightCommand_(event, conversationId, normalized, userText);

  if (userText === '#封存本週話題') return handleArchiveWeeklyCommand_(event, conversationId);

  return false;
}

function replyAndLog_(event, conversationId, text, mode) {
  replyToLine(event.replyToken, text);
  logAssistantReplyToSheet(event, conversationId, text, mode);
  return true;
}

function handleHighlightCommand_(event, conversationId, normalizedText, originalText) {
  const highlightText = normalizedText.replace('#畫重點', '').trim();
  if (!highlightText) return replyAndLog_(event, conversationId, getBotTextHighlightEmpty_(), 'highlight_empty');
  saveTopicHighlight_(event, conversationId, originalText, highlightText);
  return replyAndLog_(event, conversationId, getBotTextHighlightSaved_(), 'highlight_saved');
}

function handleArchiveWeeklyCommand_(event, conversationId) {
  let archiveReply = '';
  try {
    archiveReply = archiveWeeklyTopics(event, conversationId);
  } catch (error) {
    console.error('archiveWeeklyTopics error:', error && error.stack ? error.stack : error);
    archiveReply = getBotTextArchiveError_();
  }
  return replyAndLog_(event, conversationId, archiveReply, 'archive_weekly');
}
