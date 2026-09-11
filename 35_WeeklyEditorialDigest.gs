// ======================================================
// 35_WeeklyEditorialDigest.gs
// News／Editorial：本週編輯台的模型輸入、partition validator、render coverage、cache 與 fallback。
// 小浣 LINE Bot v1.14.1 Codebase Simplification Edition
//
// 責任邊界：
// 1. GAS 建立固定 itemId、裁切模型輸入、保存原始 NewsInbox item 與網址。
// 2. AI weekly_editorial_digest task 只回傳新聞聚類、未分組 ID 與群組對話話題 JSON。
// 3. 本檔保守正規化模型結果，分開驗證資料 partition 與 LINE rendered coverage。
// 4. 模型結果只用於當次顯示與 10 分鐘快取，不回寫 NewsInbox。
// 5. 本檔不組 provider payload；thinking_json profile 失敗、JSON/partition 違規都使用既有分類 fallback。
// 6. webhook execution context 只負責同步時間上限；預算不足或逾時仍走相同程式端 fallback。
// 7. 主要 caller 是 30_NewsInbox.gs；WEEKLY_EDITORIAL_CACHE_VERSION 只跟資料 contract 變更，不跟 source layout 版本連動。
// ======================================================

function shouldUseWeeklyEditorialDigest_(queryOptions) {
  const options = queryOptions || {};
  return options.viewMode === 'compact' &&
    options.onlyHighPotential === false &&
    !String(options.categoryFilter || '').trim();
}

function tryBuildWeeklyEditorialDigest_(conversationId, items, queryOptions, aiExecutionContext) {
  try {
    const identifiedItems = assignWeeklyEditorialItemIds_(items);
    const selection = selectWeeklyEditorialNewsItems_(identifiedItems);
    const newsPayload = buildWeeklyEditorialNewsPayload_(selection.selectedItems);
    assertWeeklyEditorialNewsPayloadHasNoUrls_(newsPayload);
    let rawConversationItems = [];

    try {
      rawConversationItems = getRecentWeeklyEditorialConversationItems_(
        conversationId,
        (queryOptions && queryOptions.days) || DEFAULT_WEEKLY_NEWS_DAYS,
        MAX_WEEKLY_EDITORIAL_CONVERSATION_SCAN_ROWS
      );
    } catch (conversationError) {
      // ConversationLog 失敗不應阻止新聞聚類；以空對話繼續同一次模型任務。
      console.error(
        'Weekly editorial ConversationLog read failed:',
        conversationError && conversationError.stack ? conversationError.stack : conversationError
      );
      rawConversationItems = [];
    }

    const conversationPayload = prepareWeeklyEditorialConversationPayload_(
      rawConversationItems,
      identifiedItems
    );
    const modelItemIds = selection.selectedItems.map(function(entry) {
      return entry.itemId;
    });
    const cacheKey = buildWeeklyEditorialCacheKey_(conversationId, newsPayload, conversationPayload);
    const cachedResult = getCachedWeeklyEditorialResult_(cacheKey);
    let normalizedResult = null;
    let partition = null;
    let cacheHit = false;

    if (cachedResult) {
      try {
        const cachedValidation = normalizeAndValidateWeeklyEditorialResult_(
          JSON.stringify(cachedResult),
          modelItemIds,
          identifiedItems,
          conversationPayload.length > 0
        );
        normalizedResult = cachedValidation.normalizedResult;
        partition = cachedValidation.partition;
        cacheHit = true;
      } catch (cacheValidationError) {
        // 快取只是效能最佳化。可解析但契約損壞、ID 不相容或 coverage
        // 失敗時一律視為 miss，移除失敗也不能阻止本次 API 呼叫。
        console.warn(
          'Weekly editorial cache revalidation failed; treating as miss:',
          cacheValidationError && cacheValidationError.message
            ? cacheValidationError.message
            : String(cacheValidationError)
        );
        removeCachedWeeklyEditorialResult_(cacheKey);
        normalizedResult = null;
        partition = null;
      }
    }

    if (!cacheHit) {
      const prompt = buildWeeklyEditorialDigestPrompt_(newsPayload, conversationPayload);
      // HIGH JSON 的 itemId、partition 與 rendered coverage 仍由保守 validator 驗證；
      // 使用共用 webhook deadline，失敗走分類 fallback，不在 webhook 內 retry。
      const responseJson = requireAiJson_(runAiJsonTask(
        'weekly_editorial_digest',
        prompt,
        requireAiCallOptionsForExecutionContext_(aiExecutionContext)
      ));
      const apiValidation = normalizeAndValidateWeeklyEditorialResult_(
        JSON.stringify(responseJson),
        modelItemIds,
        identifiedItems,
        conversationPayload.length > 0
      );
      normalizedResult = apiValidation.normalizedResult;
      partition = apiValidation.partition;
      putCachedWeeklyEditorialResult_(cacheKey, normalizedResult);
    }

    return formatWeeklyEditorialDigest_(identifiedItems, partition, queryOptions);
  } catch (error) {
    console.error('Weekly editorial digest failed:', error && error.stack ? error.stack : error);
    return '';
  }
}

function formatWeeklyEditorialFallbackDigest_(items, queryOptions) {
  const identifiedItems = assignWeeklyEditorialItemIds_(items);
  const allItemIds = identifiedItems.map(function(entry) {
    return entry.itemId;
  });
  const partition = {
    newsClusters: [],
    otherItemIds: allItemIds,
    conversationTopics: []
  };

  assertWeeklyEditorialPartitionCoverage_(allItemIds, partition.newsClusters, partition.otherItemIds);
  return formatWeeklyEditorialDigest_(identifiedItems, partition, queryOptions);
}

// ======================================================
// 固定 ID 與模型新聞輸入
// ======================================================

function assignWeeklyEditorialItemIds_(items) {
  return (items || []).map(function(item, index) {
    const numberText = String(index + 1);
    return {
      itemId: 'N' + ('000' + numberText).slice(-Math.max(3, numberText.length)),
      item: item
    };
  });
}

function selectWeeklyEditorialNewsItems_(identifiedItems) {
  const entries = (identifiedItems || []).slice();
  const selectedMap = {};
  const storyKeyCounts = {};
  const categoryGroups = {};

  entries.forEach(function(entry) {
    const item = entry.item || {};
    const category = String(item.category || '待分類').trim() || '待分類';
    if (!categoryGroups[category]) categoryGroups[category] = [];
    categoryGroups[category].push(entry);

    const storyKey = getWeeklyEditorialSelectionStoryKey_(item);
    if (storyKey) {
      storyKeyCounts[storyKey] = (storyKeyCounts[storyKey] || 0) + 1;
    }
  });

  let selectedCount = 0;
  Object.keys(categoryGroups).sort(function(a, b) {
    return getNewsCategoryOrderIndex_(a) - getNewsCategoryOrderIndex_(b) ||
      a.localeCompare(b, 'zh-Hant');
  }).forEach(function(category) {
    categoryGroups[category]
      .slice()
      .sort(compareWeeklyEditorialNewestItems_)
      .slice(0, MAX_WEEKLY_EDITORIAL_NEWS_PER_CATEGORY_RESERVE)
      .forEach(function(entry) {
        if (selectedCount < MAX_WEEKLY_EDITORIAL_NEWS_ITEMS && !selectedMap[entry.itemId]) {
          selectedMap[entry.itemId] = true;
          selectedCount++;
        }
      });
  });

  entries.filter(function(entry) {
    return !selectedMap[entry.itemId];
  }).sort(function(a, b) {
    const potentialCompare = getWeeklyEditorialPotentialScore_(b.item && b.item.topicPotential) -
      getWeeklyEditorialPotentialScore_(a.item && a.item.topicPotential);
    if (potentialCompare !== 0) return potentialCompare;

    const aStoryKey = getWeeklyEditorialSelectionStoryKey_(a.item);
    const bStoryKey = getWeeklyEditorialSelectionStoryKey_(b.item);
    const storyCompare = (bStoryKey && storyKeyCounts[bStoryKey] > 1 ? 1 : 0) -
      (aStoryKey && storyKeyCounts[aStoryKey] > 1 ? 1 : 0);
    if (storyCompare !== 0) return storyCompare;

    return compareWeeklyEditorialNewestItems_(a, b);
  }).forEach(function(entry) {
    if (selectedCount < MAX_WEEKLY_EDITORIAL_NEWS_ITEMS) {
      selectedMap[entry.itemId] = true;
      selectedCount++;
    }
  });

  return {
    selectedItems: entries.filter(function(entry) {
      return !!selectedMap[entry.itemId];
    }).sort(function(a, b) {
      return a.itemId.localeCompare(b.itemId);
    }),
    unselectedItems: entries.filter(function(entry) {
      return !selectedMap[entry.itemId];
    })
  };
}

function getWeeklyEditorialSelectionStoryKey_(item) {
  if (!item || item.storyKeyWasMissing) return '';
  const storyKey = sanitizeWeeklyEditorialModelText_(
    item.storyKey,
    MAX_WEEKLY_EDITORIAL_STORY_KEY_LENGTH
  );
  if (!storyKey || storyKey === NEWS_STORY_FALLBACK_KEY) return '';
  return storyKey;
}

function compareWeeklyEditorialNewestItems_(a, b) {
  const bTime = getWeeklyEditorialItemTime_(b && b.item);
  const aTime = getWeeklyEditorialItemTime_(a && a.item);
  return bTime - aTime || String(a && a.itemId || '').localeCompare(String(b && b.itemId || ''));
}

function buildWeeklyEditorialNewsPayload_(selectedItems) {
  return (selectedItems || []).map(function(entry) {
    const item = entry.item || {};
    return {
      itemId: entry.itemId,
      createdDate: formatWeeklyEditorialDate_(item.createdAt, false),
      title: sanitizeWeeklyEditorialModelText_(item.title, MAX_WEEKLY_EDITORIAL_TITLE_LENGTH),
      brief: sanitizeWeeklyEditorialModelText_(item.brief, MAX_WEEKLY_EDITORIAL_BRIEF_LENGTH),
      outline: sanitizeWeeklyEditorialModelText_(item.outline, MAX_WEEKLY_EDITORIAL_OUTLINE_LENGTH),
      category: truncateWeeklyEditorialText_(item.category || '待分類', 40),
      // 舊資料缺 StoryKey 時，NewsInbox reader 會為既有診斷產生 title/category/URL
      // 相容 fallback；週編輯台只送真正入庫保存的候選 StoryKey，缺失時送空字串。
      storyKey: getWeeklyEditorialSelectionStoryKey_(item),
      specialTopic: sanitizeWeeklyEditorialModelText_(item.specialTopic, MAX_WEEKLY_EDITORIAL_SPECIAL_TOPIC_LENGTH),
      matchedEntities: sanitizeWeeklyEditorialModelText_(item.matchedEntities, MAX_WEEKLY_EDITORIAL_MATCHED_ENTITIES_LENGTH),
      topicPotential: normalizeWeeklyEditorialPotential_(item.topicPotential)
    };
  });
}

function sanitizeWeeklyEditorialModelText_(value, maxLength) {
  // 一律先完整移除 URL 再裁切，避免先截斷網址後留下無法辨識的殘片。
  return truncateWeeklyEditorialText_(stripUrlsForWeeklyEditorial_(value), maxLength);
}

function assertWeeklyEditorialNewsPayloadHasNoUrls_(newsPayload) {
  const serializedPayload = JSON.stringify(newsPayload || []);
  if (containsWeeklyEditorialUrl_(serializedPayload)) {
    // 錯誤只使用固定代碼，不得把實際模型 payload 或網址寫入 log / LINE。
    throw new Error('weekly_editorial_news_payload_contains_url');
  }
  return true;
}

// ======================================================
// ConversationLog 去噪、裁切與匿名化
// ======================================================

function prepareWeeklyEditorialConversationPayload_(rawItems, identifiedNewsItems) {
  const newsTitleMap = {};
  (identifiedNewsItems || []).forEach(function(entry) {
    const normalizedTitle = normalizeNewsTitleForDuplicateCheck_(entry.item && entry.item.title);
    if (normalizedTitle) newsTitleMap[normalizedTitle] = true;
  });

  const seenTextMap = {};
  const filteredNewestFirst = [];

  for (let i = (rawItems || []).length - 1; i >= 0; i--) {
    const item = rawItems[i] || {};
    const role = String(item.role || '').trim().toLowerCase();
    const mode = String(item.mode || '').trim();
    const originalText = String(item.text || '').trim();
    const textWithoutUrls = stripUrlsForWeeklyEditorial_(originalText);

    // 正式 reader 已是 user-only；保留這層防守，避免測試資料或未來呼叫者
    // 意外把 assistant 訊息送入週編輯台。
    if (role && role !== 'user') continue;
    if (isWeeklyEditorialConversationNoise_(originalText, textWithoutUrls, mode)) continue;
    if (isWeeklyEditorialNewsTitleOnly_(textWithoutUrls, newsTitleMap)) continue;

    const dedupKey = normalizeWeeklyEditorialConversationDedupKey_(textWithoutUrls);
    if (!dedupKey || seenTextMap[dedupKey]) continue;
    seenTextMap[dedupKey] = true;

    filteredNewestFirst.push({
      timestamp: item.timestamp,
      userId: String(item.userId || ''),
      text: truncateWeeklyEditorialText_(textWithoutUrls, MAX_WEEKLY_EDITORIAL_CONVERSATION_ITEM_LENGTH)
    });
  }

  const selectedNewestFirst = [];
  let totalLength = 0;
  for (let j = 0; j < filteredNewestFirst.length; j++) {
    const candidate = filteredNewestFirst[j];
    if (selectedNewestFirst.length >= MAX_WEEKLY_EDITORIAL_CONVERSATION_ITEMS) break;
    if (totalLength + candidate.text.length > MAX_WEEKLY_EDITORIAL_CONVERSATION_TOTAL_LENGTH) continue;
    selectedNewestFirst.push(candidate);
    totalLength += candidate.text.length;
  }

  const selectedChronological = selectedNewestFirst.reverse();
  const userAliasMap = {};
  let nextAliasNumber = 1;

  return selectedChronological.map(function(item) {
    const userKey = item.userId || '__anonymous__';
    if (!userAliasMap[userKey]) {
      userAliasMap[userKey] = 'U' + ('0' + nextAliasNumber).slice(-2);
      nextAliasNumber++;
    }
    return {
      timestamp: formatWeeklyEditorialDate_(item.timestamp, true),
      userAlias: userAliasMap[userKey],
      text: item.text
    };
  });
}

function isWeeklyEditorialConversationNoise_(originalText, textWithoutUrls, mode) {
  const raw = String(originalText || '').trim();
  const cleaned = String(textWithoutUrls || '').replace(/\s+/g, ' ').trim();

  if (!raw || raw.startsWith('#')) return true;
  if (!isWeeklyEditorialConversationModeAllowed_(mode)) return true;

  // 含網址但仍有實質評論時保留評論；只有移除網址後無有效內容才排除。
  if (!cleaned || !/[A-Za-z0-9\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(cleaned)) {
    return true;
  }

  const compact = cleaned.replace(/[\s，,。．.!！?？~～…、:：;；\x22'「」『』（）()\[\]【】]/g, '').toLowerCase();
  const meaninglessPhrases = [
    '好', '嗯', '喔', '哦', '好喔', '好哦', '好的', '笑死', '哈哈', '哈哈哈', '呵呵', '等等看',
    '再看看', '沒事', '收到', '了解', '可以', '真的', '對啊', '是喔', '來源', '原文', '連結', '網址',
    'ok', 'okay', 'lol'
  ];
  return compact.length < 2 || meaninglessPhrases.indexOf(compact) >= 0;
}

function stripUrlsForWeeklyEditorial_(text) {
  // 不直接重用 extractUrls()：這裡需要保留每個網址在原字串中的位置、
  // 支援 www. 與重複網址，才能只移除 URL 而保留同一則訊息的評論。
  const urlCandidatePattern = /(?:[：:]\s*)?(?:[（(\[【「『]\s*)?(?:https?:\/\/|www\.)[^\s<>\x22'「」『』，。！？；：、）)\]}】!]+(?:[，。！？；：、）)\]}】!]+)?/gi;

  return String(text || '')
    .replace(urlCandidatePattern, function(candidate, offset, wholeText) {
      const proseSuffixIndex = findWeeklyEditorialTextSuffixInUrlCandidate_(
        candidate,
        String(wholeText || '').slice(offset + candidate.length)
      );
      return proseSuffixIndex >= 0 ? ' ' + candidate.slice(proseSuffixIndex) + ' ' : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// URL 與緊貼其後的自然語句若只用 ASCII 標點分隔，寬鬆 candidate
// 可能把第一個詞一起吃進去。本 helper 只找明確 prose 邊界，不做訊息語意判斷。
function findWeeklyEditorialTextSuffixInUrlCandidate_(candidate, trailingText) {
  const raw = String(candidate || '');
  const urlStart = raw.search(/(?:https?:\/\/|www\.)/i);
  if (urlStart < 0) return -1;

  const prefixMatch = raw.slice(urlStart).match(/^(?:https?:\/\/|www\.)/i);
  const authorityStart = urlStart + (prefixMatch ? prefixMatch[0].length : 0);
  const pathIndexes = [
    raw.indexOf('/', authorityStart),
    raw.indexOf('?', authorityStart),
    raw.indexOf('#', authorityStart)
  ].filter(function(index) {
    return index >= 0;
  });
  const contentStart = pathIndexes.length ? Math.min.apply(null, pathIndexes) : raw.length;
  const cjkPattern = /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/;

  for (let i = authorityStart; i < raw.length - 1; i++) {
    const punctuation = raw.charAt(i);
    if (',;.:'.indexOf(punctuation) < 0) continue;

    // 逗號與分號不能出現在 hostname；句號與冒號則只在 path/query/fragment
    // 之後才視為可能的自然語句分隔，避免切壞網域與 port。
    if (punctuation !== ',' && punctuation !== ';' && i < contentStart) continue;

    const suffix = raw.slice(i + 1);
    if (cjkPattern.test(suffix.charAt(0))) {
      return i + 1;
    }

    // 無空白的英文 URL/評論邊界本質上有歧義。只保留明確評論開頭詞，
    // 或後方仍接英文句子且首詞大寫的情境；不把一般 foo,bar / foo;topic
    // path 殘片誤當成評論。
    const normalizedSuffix = suffix.toLowerCase();
    const explicitCommentStarters = [
      'agree', 'disagree', 'wrong', 'right', 'no', 'not', 'never', 'yes',
      'why', 'what', 'how', 'this', 'that', 'i', 'we', 'you',
      'bad', 'weird', 'unfair', 'ridiculous', 'seriously', 'thoughts'
    ];
    if (explicitCommentStarters.indexOf(normalizedSuffix) >= 0 ||
        (/^\s+[A-Za-z]/.test(String(trailingText || '')) && /^[A-Z][A-Za-z]*$/.test(suffix))) {
      return i + 1;
    }
  }

  return -1;
}

function normalizeWeeklyEditorialConversationDedupKey_(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isWeeklyEditorialNewsTitleOnly_(text, newsTitleMap) {
  const rawText = String(text || '');
  const normalizeCandidate = function(candidateText) {
    return normalizeNewsTitleForDuplicateCheck_(
      String(candidateText || '')
        .replace(/^標題[：:]\s*/, '')
        .replace(/(?:來源|原文|連結|網址)\s*[：:]?\s*$/, '')
    );
  };
  const directNormalizedText = normalizeCandidate(rawText);
  if (directNormalizedText && newsTitleMap && newsTitleMap[directNormalizedText]) {
    return true;
  }

  const withoutNeutralPrefix = rawText.replace(
    /^(?:分享一下|新聞連結|分享|轉貼|新聞|連結)(?:\s*[：:]\s*|\s+)/,
    ''
  );
  const strippedNormalizedText = normalizeCandidate(withoutNeutralPrefix);
  return !!strippedNormalizedText && !!(newsTitleMap && newsTitleMap[strippedNormalizedText]);
}

function truncateWeeklyEditorialText_(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const safeMaxLength = Math.max(0, Number(maxLength) || 0);
  if (!safeMaxLength || text.length <= safeMaxLength) return text;
  return text.slice(0, Math.max(0, safeMaxLength - 1)).trim() + '…';
}

function containsWeeklyEditorialUrl_(value) {
  return /(?:https?:\/\/|www\.)/i.test(String(value || ''));
}

function formatWeeklyEditorialDate_(value, includeTime) {
  const date = value instanceof Date ? value : new Date(value);
  if (!isFinite(date.getTime())) return '';
  try {
    return Utilities.formatDate(
      date,
      Session.getScriptTimeZone(),
      includeTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd'
    );
  } catch (error) {
    return includeTime ? date.toISOString().slice(0, 16) : date.toISOString().slice(0, 10);
  }
}

// ======================================================
// Prompt 與快取
// ======================================================

function buildWeeklyEditorialDigestPrompt_(newsPayload, conversationPayload) {
  const contractExample = {
    newsClusters: [{ title: '', itemIds: ['N001', 'N002'] }],
    ungroupedNewsIds: ['N003'],
    conversationTopics: [{
      title: '',
      summary: '',
      talkingPoint: '',
      relatedNewsIds: []
    }]
  };

  return [
    '請根據以下 JSON 資料完成一次本週編輯台判斷，並只輸出合法 JSON object。',
    '',
    '新聞聚類規則：',
    '1. 至少兩則明確屬於同一事件、同一持續發展或確實適合同一節目段落，才可成立 newsCluster。',
    '2. 只有一則的新聞必須放進 ungroupedNewsIds，不得建立單篇 cluster。',
    '3. 不得只因人物、公司、作品、平台、實體或分類相同就合併。',
    '4. 不確定時寧可不合併。StoryKey 只是候選提示，文字相同或不同都不是最終答案。',
    '5. 每個 itemId 必須恰好出現在一個 cluster 或 ungroupedNewsIds，不得遺漏或重複。',
    '6. cluster title 使用繁體中文、簡短可讀，最多 40 字。',
    '',
    '群組話題規則：',
    '1. 最多提出 3 個真正有節目價值的 conversationTopics，依重要性由高到低排列；沒有足夠內容時回空陣列。',
    '2. 不要整理聊天流水帳；只保留主持人的觀點、疑問、爭論、情緒差異或節目切角。',
    '3. 若對話與新聞重複，不要重述新聞，只保留對話額外形成的觀點。',
    '4. relatedNewsIds 可以是空陣列，只能使用提供的 itemId。',
    '5. title 最多 60 字、summary 最多 160 字、talkingPoint 最多 100 字。',
    '',
    '輸出契約：',
    JSON.stringify(contractExample),
    '',
    '新聞資料（不含網址）：',
    JSON.stringify(newsPayload || []),
    '',
    '最近七天有效使用者對話（網址已由 GAS 移除，UserId 已匿名化）：',
    JSON.stringify(conversationPayload || [])
  ].join('\n');
}

function buildWeeklyEditorialCacheKey_(conversationId, newsPayload, conversationPayload) {
  const conversationHash = computeWeeklyEditorialInputHash_(String(conversationId || '')).slice(0, 16);
  const inputHash = computeWeeklyEditorialInputHash_(JSON.stringify({
    version: WEEKLY_EDITORIAL_CACHE_VERSION,
    news: newsPayload || [],
    conversations: conversationPayload || []
  }));
  return 'weekly_editorial:' + WEEKLY_EDITORIAL_CACHE_VERSION + ':' + conversationHash + ':' + inputHash;
}

function computeWeeklyEditorialInputHash_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
}

function getCachedWeeklyEditorialResult_(cacheKey) {
  let raw = '';
  try {
    raw = CacheService.getScriptCache().get(cacheKey);
  } catch (error) {
    console.warn('Weekly editorial cache read failed:', error && error.stack ? error.stack : error);
    return null;
  }

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('Weekly editorial cache value was not an object; treating as miss');
      removeCachedWeeklyEditorialResult_(cacheKey);
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Weekly editorial cache JSON invalid; treating as miss');
    removeCachedWeeklyEditorialResult_(cacheKey);
    return null;
  }
}

function removeCachedWeeklyEditorialResult_(cacheKey) {
  try {
    CacheService.getScriptCache().remove(cacheKey);
  } catch (error) {
    // 壞 cache 移除失敗不能阻止後續 API 呼叫或安全 fallback。
    console.warn('Weekly editorial cache remove failed:', error && error.stack ? error.stack : error);
  }
}

function putCachedWeeklyEditorialResult_(cacheKey, normalizedResult) {
  try {
    CacheService.getScriptCache().put(
      cacheKey,
      JSON.stringify(normalizedResult),
      WEEKLY_EDITORIAL_CACHE_TTL_SECONDS
    );
  } catch (error) {
    // 快取不是正確性依賴；寫入失敗仍使用本次已驗證結果。
    console.warn('Weekly editorial cache write failed:', error && error.stack ? error.stack : error);
  }
}

function normalizeWeeklyEditorialPotential_(value) {
  return normalizeTopicPotential_(value);
}

function getWeeklyEditorialPotentialScore_(value) {
  const potential = normalizeWeeklyEditorialPotential_(value);
  return potential === '高' ? 3 : (potential === '中' ? 2 : 1);
}

function getWeeklyEditorialItemTime_(item) {
  const time = item && item.createdAt ? new Date(item.createdAt).getTime() : 0;
  return isFinite(time) ? time : 0;
}

// ======================================================
// JSON normalizer：頂層錯誤整體失敗，局部錯誤保守部分採納
// ======================================================

function normalizeAndValidateWeeklyEditorialResult_(
  responseText,
  modelItemIds,
  identifiedItems,
  hasConversationPayload
) {
  const normalizedResult = parseAndNormalizeWeeklyEditorialResult_(responseText, modelItemIds);

  // 沒有任何通過 GAS 機械過濾的對話時，即使 cache / 模型意外回傳話題也不採用。
  // 新聞聚類仍可正常繼續，不把空 ConversationLog 視為整體錯誤。
  if (!hasConversationPayload) {
    normalizedResult.conversationTopics = [];
  }

  const partition = validateWeeklyEditorialPartition_(
    identifiedItems,
    normalizedResult,
    modelItemIds
  );

  return {
    normalizedResult: normalizedResult,
    partition: partition
  };
}

function parseAndNormalizeWeeklyEditorialResult_(responseText, knownItemIds) {
  const parsed = parseJsonObjectLoose(responseText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('weekly_editorial_invalid_json_object');
  }

  if (!Array.isArray(parsed.newsClusters) ||
      !Array.isArray(parsed.ungroupedNewsIds) ||
      !Array.isArray(parsed.conversationTopics)) {
    throw new Error('weekly_editorial_invalid_top_level_contract');
  }

  const normalizedNews = normalizeWeeklyEditorialNewsClusters_(
    parsed.newsClusters,
    parsed.ungroupedNewsIds,
    knownItemIds
  );

  return {
    newsClusters: normalizedNews.newsClusters,
    ungroupedNewsIds: normalizedNews.ungroupedNewsIds,
    conversationTopics: normalizeWeeklyEditorialConversationTopics_(
      parsed.conversationTopics,
      knownItemIds
    )
  };
}

function normalizeWeeklyEditorialNewsClusters_(rawClusters, rawUngroupedIds, knownItemIds) {
  const knownMap = {};
  (knownItemIds || []).forEach(function(itemId) {
    knownMap[itemId] = true;
  });

  const membershipCounts = {};
  const candidates = [];
  (rawClusters || []).forEach(function(rawCluster, clusterIndex) {
    if (!rawCluster || typeof rawCluster !== 'object' || Array.isArray(rawCluster) ||
        !Array.isArray(rawCluster.itemIds)) {
      console.warn('Weekly editorial cluster discarded: invalid itemIds at index ' + clusterIndex);
      return;
    }
    const itemIds = normalizeWeeklyEditorialIdArray_(
      rawCluster.itemIds,
      knownMap,
      'cluster_' + clusterIndex
    );
    itemIds.forEach(function(itemId) {
      membershipCounts[itemId] = (membershipCounts[itemId] || 0) + 1;
    });

    let normalizedTitle = '';
    if (typeof rawCluster.title !== 'string') {
      console.warn('Weekly editorial cluster discarded: invalid title at index ' + clusterIndex);
    } else if (containsWeeklyEditorialUrl_(rawCluster.title)) {
      console.warn('Weekly editorial cluster discarded: model title contained URL at index ' + clusterIndex);
    } else {
      normalizedTitle = truncateWeeklyEditorialText_(
        rawCluster.title,
        MAX_WEEKLY_EDITORIAL_CLUSTER_TITLE_LENGTH
      );
    }

    candidates.push({
      title: normalizedTitle,
      itemIds: itemIds
    });
  });

  const normalizedUngroupedIds = normalizeWeeklyEditorialIdArray_(
    rawUngroupedIds,
    knownMap,
    'ungrouped'
  );
  const rawUngroupedMap = {};
  normalizedUngroupedIds.forEach(function(itemId) {
    rawUngroupedMap[itemId] = true;
  });

  const conflictMap = {};
  Object.keys(membershipCounts).forEach(function(itemId) {
    if (membershipCounts[itemId] > 1 || rawUngroupedMap[itemId]) {
      conflictMap[itemId] = true;
      console.warn('Weekly editorial itemId conflict returned to other news: ' + itemId);
    }
  });

  const otherMap = {};
  normalizedUngroupedIds.forEach(function(itemId) {
    otherMap[itemId] = true;
  });
  Object.keys(conflictMap).forEach(function(itemId) {
    otherMap[itemId] = true;
  });

  const validClusters = [];
  candidates.forEach(function(candidate) {
    const cleanedIds = candidate.itemIds.filter(function(itemId) {
      return !conflictMap[itemId];
    });

    if (!candidate.title || cleanedIds.length < 2) {
      cleanedIds.forEach(function(itemId) {
        otherMap[itemId] = true;
      });
      return;
    }

    validClusters.push({
      title: candidate.title,
      itemIds: cleanedIds
    });
  });

  const keptClusters = validClusters.slice(0, MAX_WEEKLY_EDITORIAL_CLUSTER_COUNT);
  validClusters.slice(MAX_WEEKLY_EDITORIAL_CLUSTER_COUNT).forEach(function(cluster) {
    cluster.itemIds.forEach(function(itemId) {
      otherMap[itemId] = true;
    });
  });

  const claimedMap = {};
  keptClusters.forEach(function(cluster) {
    cluster.itemIds.forEach(function(itemId) {
      claimedMap[itemId] = true;
    });
  });

  (knownItemIds || []).forEach(function(itemId) {
    if (!claimedMap[itemId]) otherMap[itemId] = true;
  });

  return {
    newsClusters: keptClusters.map(function(cluster) {
      return { title: cluster.title, itemIds: cluster.itemIds };
    }),
    ungroupedNewsIds: (knownItemIds || []).filter(function(itemId) {
      return !!otherMap[itemId] && !claimedMap[itemId];
    })
  };
}

function normalizeWeeklyEditorialIdArray_(rawIds, knownMap, sourceLabel) {
  if (!Array.isArray(rawIds)) return [];
  const seenMap = {};
  const normalized = [];

  rawIds.forEach(function(rawId) {
    const itemId = typeof rawId === 'string' ? rawId.trim() : '';
    if (!itemId || !knownMap[itemId]) {
      if (itemId) console.warn('Weekly editorial unknown itemId in ' + sourceLabel + ': ' + itemId);
      return;
    }
    if (seenMap[itemId]) return;
    seenMap[itemId] = true;
    normalized.push(itemId);
  });

  return normalized;
}

function normalizeWeeklyEditorialConversationTopics_(rawTopics, knownItemIds) {
  const knownMap = {};
  (knownItemIds || []).forEach(function(itemId) {
    knownMap[itemId] = true;
  });

  const topics = [];
  (rawTopics || []).forEach(function(rawTopic, topicIndex) {
    if (topics.length >= MAX_WEEKLY_EDITORIAL_CONVERSATION_TOPIC_COUNT) return;
    if (!rawTopic || typeof rawTopic !== 'object' || Array.isArray(rawTopic)) {
      console.warn('Weekly editorial conversation topic discarded at index ' + topicIndex);
      return;
    }
    if (typeof rawTopic.title !== 'string' ||
        typeof rawTopic.summary !== 'string' ||
        typeof rawTopic.talkingPoint !== 'string') {
      console.warn('Weekly editorial conversation topic discarded: invalid core field type at index ' + topicIndex);
      return;
    }
    if (containsWeeklyEditorialUrl_(rawTopic.title) ||
        containsWeeklyEditorialUrl_(rawTopic.summary) ||
        containsWeeklyEditorialUrl_(rawTopic.talkingPoint)) {
      console.warn('Weekly editorial conversation topic discarded: model text contained URL at index ' + topicIndex);
      return;
    }

    const title = truncateWeeklyEditorialText_(
      rawTopic.title,
      MAX_WEEKLY_EDITORIAL_CONVERSATION_TITLE_LENGTH
    );
    const summary = truncateWeeklyEditorialText_(
      rawTopic.summary,
      MAX_WEEKLY_EDITORIAL_CONVERSATION_SUMMARY_LENGTH
    );
    const talkingPoint = truncateWeeklyEditorialText_(
      rawTopic.talkingPoint,
      MAX_WEEKLY_EDITORIAL_TALKING_POINT_LENGTH
    );

    if (!title || !summary || !talkingPoint) {
      console.warn('Weekly editorial conversation topic discarded: missing core field at index ' + topicIndex);
      return;
    }

    if (!Array.isArray(rawTopic.relatedNewsIds)) {
      console.warn('Weekly editorial relatedNewsIds normalized to empty array at index ' + topicIndex);
    }

    topics.push({
      title: title,
      summary: summary,
      talkingPoint: talkingPoint,
      relatedNewsIds: normalizeWeeklyEditorialIdArray_(
        Array.isArray(rawTopic.relatedNewsIds) ? rawTopic.relatedNewsIds : [],
        knownMap,
        'conversation_topic_' + topicIndex
      )
    });
  });

  return topics;
}

// 將模型只看過的新聞 partition 與未送模型新聞合併，形成完整資料分區。
function validateWeeklyEditorialPartition_(identifiedItems, normalizedResult, modelItemIds) {
  const allItemIds = (identifiedItems || []).map(function(entry) {
    return entry.itemId;
  });
  const modelItemMap = {};
  (modelItemIds || []).forEach(function(itemId) {
    modelItemMap[itemId] = true;
  });

  const clusters = (normalizedResult.newsClusters || []).map(function(cluster) {
    return {
      title: cluster.title,
      itemIds: cluster.itemIds.slice()
    };
  });
  const otherMap = {};
  (normalizedResult.ungroupedNewsIds || []).forEach(function(itemId) {
    otherMap[itemId] = true;
  });

  // 未送模型的新聞不參與焦點故事線，必定進入其他新聞。
  allItemIds.forEach(function(itemId) {
    if (!modelItemMap[itemId]) otherMap[itemId] = true;
  });

  const otherItemIds = allItemIds.filter(function(itemId) {
    return !!otherMap[itemId];
  });
  assertWeeklyEditorialPartitionCoverage_(allItemIds, clusters, otherItemIds);

  return {
    newsClusters: clusters,
    otherItemIds: otherItemIds,
    conversationTopics: (normalizedResult.conversationTopics || []).slice()
  };
}

// 資料層 invariant：容量控制前，每則原始新聞恰好位於一個 cluster 或 other。
function assertWeeklyEditorialPartitionCoverage_(allOriginalIds, clusters, otherItemIds) {
  const expectedMap = {};
  const counts = {};
  (allOriginalIds || []).forEach(function(itemId) {
    if (expectedMap[itemId]) throw new Error('weekly_editorial_duplicate_original_id: ' + itemId);
    expectedMap[itemId] = true;
    counts[itemId] = 0;
  });

  (clusters || []).forEach(function(cluster) {
    if (!cluster || !cluster.title || !Array.isArray(cluster.itemIds) || cluster.itemIds.length < 2) {
      throw new Error('weekly_editorial_invalid_partition_cluster');
    }
    cluster.itemIds.forEach(function(itemId) {
      if (!expectedMap[itemId]) throw new Error('weekly_editorial_partition_unknown_id: ' + itemId);
      counts[itemId]++;
    });
  });

  (otherItemIds || []).forEach(function(itemId) {
    if (!expectedMap[itemId]) throw new Error('weekly_editorial_partition_unknown_other_id: ' + itemId);
    counts[itemId]++;
  });

  Object.keys(expectedMap).forEach(function(itemId) {
    if (counts[itemId] !== 1) {
      throw new Error('weekly_editorial_partition_coverage_failed: ' + itemId + ' count=' + counts[itemId]);
    }
  });
  return true;
}

// ======================================================
// 固定排版與 LINE 完整 block 容量控制
// ======================================================

function formatWeeklyEditorialDigest_(identifiedItems, partition, queryOptions) {
  const outputState = buildWeeklyEditorialOutputBlocks_(
    identifiedItems,
    partition,
    queryOptions
  );
  return fitWeeklyEditorialOutputBlocks_(outputState);
}

function buildWeeklyEditorialOutputBlocks_(identifiedItems, partition, queryOptions) {
  const entryMap = {};
  (identifiedItems || []).forEach(function(entry) {
    entryMap[entry.itemId] = entry;
  });

  const clusters = (partition.newsClusters || []).map(function(cluster) {
    const clusterItems = cluster.itemIds.map(function(itemId) {
      return entryMap[itemId];
    }).filter(function(entry) {
      return !!entry;
    }).sort(compareWeeklyEditorialNewsItems_);

    if (clusterItems.length < 2) {
      throw new Error('weekly_editorial_render_cluster_too_small');
    }

    return {
      title: cluster.title,
      items: clusterItems
    };
  }).sort(compareWeeklyEditorialClusters_);

  const otherItems = (partition.otherItemIds || []).map(function(itemId) {
    return entryMap[itemId];
  }).filter(function(entry) {
    return !!entry;
  }).sort(compareWeeklyEditorialNewsItems_);

  const options = queryOptions || {};
  const isPlainCompact = options.viewMode === 'compact' &&
    !options.onlyHighPotential &&
    !String(options.categoryFilter || '').trim();

  return {
    intro: isPlainCompact
      ? '我把最近 ' + (Number(options.days) || DEFAULT_WEEKLY_NEWS_DAYS) + ' 天可聊的素材整理好了：'
      : buildWeeklyNewsDigestHeader_(options),
    topics: (partition.conversationTopics || []).slice(),
    clusters: clusters,
    otherItems: otherItems,
    showOtherHeading: isPlainCompact,
    allOriginalIds: (identifiedItems || []).map(function(entry) {
      return entry.itemId;
    })
  };
}

function compareWeeklyEditorialClusters_(a, b) {
  const aHighCount = (a.items || []).filter(function(entry) {
    return normalizeWeeklyEditorialPotential_(entry.item && entry.item.topicPotential) === '高';
  }).length;
  const bHighCount = (b.items || []).filter(function(entry) {
    return normalizeWeeklyEditorialPotential_(entry.item && entry.item.topicPotential) === '高';
  }).length;
  if (bHighCount !== aHighCount) return bHighCount - aHighCount;
  if ((b.items || []).length !== (a.items || []).length) return b.items.length - a.items.length;

  const aLatest = Math.max.apply(null, (a.items || []).map(function(entry) {
    return getWeeklyEditorialItemTime_(entry.item);
  }).concat([0]));
  const bLatest = Math.max.apply(null, (b.items || []).map(function(entry) {
    return getWeeklyEditorialItemTime_(entry.item);
  }).concat([0]));
  return bLatest - aLatest || String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant');
}

function compareWeeklyEditorialNewsItems_(a, b) {
  const potentialCompare = getWeeklyEditorialPotentialScore_(b.item && b.item.topicPotential) -
    getWeeklyEditorialPotentialScore_(a.item && a.item.topicPotential);
  if (potentialCompare !== 0) return potentialCompare;

  const timeCompare = getWeeklyEditorialItemTime_(b.item) - getWeeklyEditorialItemTime_(a.item);
  if (timeCompare !== 0) return timeCompare;

  const titleCompare = String(a.item && a.item.title || '').localeCompare(
    String(b.item && b.item.title || ''),
    'zh-Hant'
  );
  if (titleCompare !== 0) return titleCompare;

  const urlCompare = String(a.item && a.item.url || '').localeCompare(String(b.item && b.item.url || ''));
  return urlCompare || a.itemId.localeCompare(b.itemId);
}

function renderWeeklyEditorialOutputState_(state, omittedItemIds) {
  const pieces = [];
  const protectedRanges = [];
  const renderedItemIds = [];
  let text = '';

  function addPiece(pieceText, protect, itemId) {
    const safeText = String(pieceText || '').trim();
    if (!safeText) return;
    if (text) text += '\n\n';
    const start = text.length;
    text += safeText;
    const end = text.length;
    pieces.push(safeText);
    if (protect) protectedRanges.push({ start: start, end: end });
    if (itemId) renderedItemIds.push(itemId);
  }

  addPiece(state.intro, false, '');

  if (state.topics.length) {
    addPiece('本週群組話題', false, '');
    state.topics.forEach(function(topic, index) {
      addPiece([
        (index + 1) + '. ' + topic.title,
        topic.summary,
        '可聊點：' + topic.talkingPoint
      ].join('\n'), true, '');
    });
  }

  if (state.clusters.length) {
    addPiece('本週焦點故事線', false, '');
    state.clusters.slice().sort(compareWeeklyEditorialClusters_).forEach(function(cluster) {
      const sortedItems = cluster.items.slice().sort(compareWeeklyEditorialNewsItems_);
      addPiece('【' + cluster.title + '｜' + sortedItems.length + ' 則】', false, '');
      sortedItems.forEach(function(entry, index) {
        addPiece(formatWeeklyEditorialNewsBlock_(entry, index), true, entry.itemId);
      });
    });
  }

  if (state.otherItems.length) {
    if (state.showOtherHeading) addPiece('其他新聞', false, '');
    const groupedResult = groupWeeklyEditorialOtherItemsByCategory_(state.otherItems);
    groupedResult.categories.forEach(function(category) {
      const categoryItems = groupedResult.grouped[category];
      addPiece('【' + category + '｜' + categoryItems.length + ' 則】', false, '');
      categoryItems.forEach(function(entry, index) {
        addPiece(formatWeeklyEditorialNewsBlock_(entry, index), true, entry.itemId);
      });
    });
  }

  const omittedCount = (omittedItemIds || []).length;
  if (omittedCount) {
    addPiece('尚有 ' + omittedCount + ' 則未顯示', false, '');
  }

  return {
    text: text,
    pieces: pieces,
    protectedRanges: protectedRanges,
    renderedItemIds: renderedItemIds,
    omittedNoticeCount: omittedCount
  };
}

function formatWeeklyEditorialNewsBlock_(entry, index) {
  const item = entry.item || {};
  return [
    (index + 1) + '. [' + normalizeWeeklyEditorialPotential_(item.topicPotential) + '] ' +
      getWeeklyNewsDisplayTitle_(item),
    '來源：' + (String(item.url || '').trim() || '未記錄網址')
  ].join('\n');
}

function groupWeeklyEditorialOtherItemsByCategory_(entries) {
  const grouped = {};
  (entries || []).slice().sort(compareWeeklyEditorialNewsItems_).forEach(function(entry) {
    const category = String(entry.item && entry.item.category || '待分類').trim() || '待分類';
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(entry);
  });

  return {
    grouped: grouped,
    categories: Object.keys(grouped).sort(function(a, b) {
      return getNewsCategoryOrderIndex_(a) - getNewsCategoryOrderIndex_(b) ||
        a.localeCompare(b, 'zh-Hant');
    })
  };
}

function fitWeeklyEditorialOutputBlocks_(outputState) {
  const state = {
    intro: outputState.intro,
    topics: outputState.topics.slice(),
    clusters: outputState.clusters.map(function(cluster) {
      return { title: cluster.title, items: cluster.items.slice() };
    }),
    otherItems: outputState.otherItems.slice(),
    showOtherHeading: outputState.showOtherHeading,
    allOriginalIds: outputState.allOriginalIds.slice()
  };
  const omittedItemIds = [];
  const omittedMap = {};
  const maxIterations = state.topics.length + state.allOriginalIds.length + 5;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const rendered = renderWeeklyEditorialOutputState_(state, omittedItemIds);
    const splitMeta = splitTextForLineMessagesWithMeta_(rendered.text);
    const safeSplit = !splitMeta.wasTruncated &&
      splitMeta.messages.length <= LINE_REPLY_MAX_MESSAGE_COUNT &&
      splitMeta.messageLengths.every(function(length) {
        return length <= LINE_TEXT_MESSAGE_MAX_LENGTH;
      }) &&
      !hasUnsafeWeeklyEditorialSplit_(splitMeta.splitIndexes, rendered.protectedRanges);

    if (safeSplit) {
      assertWeeklyEditorialRenderedCoverage_(
        state.allOriginalIds,
        rendered.renderedItemIds,
        omittedItemIds,
        rendered.omittedNoticeCount
      );
      return rendered.text;
    }

    // 先移除最低順位的群組話題，不增加新聞省略數。
    if (state.topics.length) {
      state.topics.pop();
      continue;
    }

    const omissionCandidate = getWeeklyEditorialOmissionCandidate_(state);
    if (!omissionCandidate || omittedMap[omissionCandidate.itemId]) {
      throw new Error('weekly_editorial_line_capacity_unresolved');
    }

    if (!removeWeeklyEditorialRenderedItem_(state, omissionCandidate.itemId)) {
      throw new Error('weekly_editorial_line_remove_failed: ' + omissionCandidate.itemId);
    }
    omittedMap[omissionCandidate.itemId] = true;
    omittedItemIds.push(omissionCandidate.itemId);
  }

  throw new Error('weekly_editorial_line_capacity_iterations_exhausted');
}

function hasUnsafeWeeklyEditorialSplit_(splitIndexes, protectedRanges) {
  const ranges = protectedRanges || [];
  if (ranges.some(function(range) {
    return range.end - range.start > LINE_TEXT_MESSAGE_MAX_LENGTH;
  })) {
    return true;
  }

  return (splitIndexes || []).some(function(splitIndex) {
    return ranges.some(function(range) {
      return splitIndex > range.start && splitIndex < range.end;
    });
  });
}

function getWeeklyEditorialOmissionCandidate_(state) {
  const candidates = [];
  state.otherItems.forEach(function(entry) {
    candidates.push({
      entry: entry,
      locationScore: 0,
      isOversized: formatWeeklyEditorialNewsBlock_(entry, 0).length > LINE_TEXT_MESSAGE_MAX_LENGTH
    });
  });
  state.clusters.forEach(function(cluster) {
    cluster.items.forEach(function(entry) {
      candidates.push({
        entry: entry,
        locationScore: 1,
        isOversized: formatWeeklyEditorialNewsBlock_(entry, 0).length > LINE_TEXT_MESSAGE_MAX_LENGTH
      });
    });
  });

  candidates.sort(function(a, b) {
    // 單篇 block 已不可能放進一則 LINE 時先省略，避免為了保留一則
    // 注定無法顯示的長網址或長標題，反而先犧牲多則可安全顯示的新聞。
    if (a.isOversized !== b.isOversized) return a.isOversized ? -1 : 1;

    const potentialCompare = getWeeklyEditorialPotentialScore_(a.entry.item && a.entry.item.topicPotential) -
      getWeeklyEditorialPotentialScore_(b.entry.item && b.entry.item.topicPotential);
    if (potentialCompare !== 0) return potentialCompare;
    if (a.locationScore !== b.locationScore) return a.locationScore - b.locationScore;

    const timeCompare = getWeeklyEditorialItemTime_(a.entry.item) - getWeeklyEditorialItemTime_(b.entry.item);
    return timeCompare || a.entry.itemId.localeCompare(b.entry.itemId);
  });

  return candidates.length ? candidates[0].entry : null;
}

function removeWeeklyEditorialRenderedItem_(state, itemId) {
  for (let i = 0; i < state.otherItems.length; i++) {
    if (state.otherItems[i].itemId === itemId) {
      state.otherItems.splice(i, 1);
      return true;
    }
  }

  for (let clusterIndex = 0; clusterIndex < state.clusters.length; clusterIndex++) {
    const cluster = state.clusters[clusterIndex];
    const itemIndex = cluster.items.findIndex(function(entry) {
      return entry.itemId === itemId;
    });
    if (itemIndex < 0) continue;

    cluster.items.splice(itemIndex, 1);
    if (cluster.items.length < 2) {
      // 容量省略只移除選中的新聞；故事線剩餘單篇改回其他新聞，仍保留顯示。
      cluster.items.forEach(function(entry) {
        state.otherItems.push(entry);
      });
      state.clusters.splice(clusterIndex, 1);
      state.otherItems.sort(compareWeeklyEditorialNewsItems_);
    }
    return true;
  }

  return false;
}

// 畫面層 invariant：rendered 與 omitted 分開，聯集等於原始新聞；省略數必須精確。
function assertWeeklyEditorialRenderedCoverage_(allOriginalIds, renderedItemIds, omittedItemIds, omittedNoticeCount) {
  const expectedMap = {};
  const renderedCounts = {};
  const omittedMap = {};

  (allOriginalIds || []).forEach(function(itemId) {
    if (expectedMap[itemId]) throw new Error('weekly_editorial_render_duplicate_original_id: ' + itemId);
    expectedMap[itemId] = true;
  });

  (renderedItemIds || []).forEach(function(itemId) {
    if (!expectedMap[itemId]) throw new Error('weekly_editorial_render_unknown_id: ' + itemId);
    renderedCounts[itemId] = (renderedCounts[itemId] || 0) + 1;
  });

  (omittedItemIds || []).forEach(function(itemId) {
    if (!expectedMap[itemId]) throw new Error('weekly_editorial_omitted_unknown_id: ' + itemId);
    if (omittedMap[itemId]) throw new Error('weekly_editorial_omitted_duplicate_id: ' + itemId);
    omittedMap[itemId] = true;
  });

  if (Object.keys(omittedMap).length !== Number(omittedNoticeCount || 0)) {
    throw new Error('weekly_editorial_omitted_notice_count_mismatch');
  }

  Object.keys(expectedMap).forEach(function(itemId) {
    const renderedCount = renderedCounts[itemId] || 0;
    const omittedCount = omittedMap[itemId] ? 1 : 0;
    if (renderedCount > 1 || renderedCount + omittedCount !== 1) {
      throw new Error(
        'weekly_editorial_rendered_coverage_failed: ' + itemId +
        ' rendered=' + renderedCount + ' omitted=' + omittedCount
      );
    }
  });
  return true;
}
