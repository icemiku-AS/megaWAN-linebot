// ======================================================
// 13_AiSchemas.gs
// 用途：AI output contracts：provider-neutral JSON Schema 與結構驗證。
//
// 職責與協作：
// 1. 重用功能 schema builders，集中 structured output 的形狀、型別與必要欄位。
// 2. 供 AiService 及工具參數驗證使用；不在此組 vendor payload 或執行資料寫入。
//
// 維護注意：
// 1. schema 不取代分類、非空摘要、partition、coverage 與其他 business validator。
// 2. 本地 validator 僅支援實際使用的 subset，未知規則不得靜默忽略。
// 3. raw_html_extraction 保留 legacy JSON；遷移與重試語意須依既有 caller 契約處理。
// ======================================================

// ======================================================
// Task 輸出契約與 object schema
// ======================================================

function getAiTaskOutputSchema_(task) {
  let schema;
  switch (task) {
    case 'news_analysis':
    case 'manual_news_supplement':
      schema = buildNewsAnalysisSchema_();
      schema.properties.category.enum = NEWS_PRIMARY_CATEGORIES.slice();
      schema.properties.topicPotential.enum = ['低', '中', '高'];
      schema.properties.categoryConfidence.minimum = 0;
      schema.properties.categoryConfidence.maximum = 1;
      if (task === 'manual_news_supplement') {
        delete schema.properties.outline;
        schema.required = schema.required.filter(function(key) { return key !== 'outline'; });
      }
      break;
    case 'web_lazy_summary':
      schema = getWebLazySummarySchema_();
      schema.properties.contentTypeLabel.enum = ['新聞資訊', '社群爭議', '平台政策', '技術文章', '娛樂事件', '財經資訊', '政治公共議題', '生活資訊', '其他'];
      schema.properties.topicPotential.enum = ['低', '中', '高'];
      schema.properties.extractionConfidence.minimum = 0;
      schema.properties.extractionConfidence.maximum = 1;
      break;
    case 'archive_topics':
    case 'archive_news':
      schema = { type: 'object', properties: {
        topicTitle: { type: 'string' }, summary: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' } },
        reusableAngles: { type: 'array', items: { type: 'string' } },
        followUpQuestions: { type: 'array', items: { type: 'string' } }
      } };
      break;
    case 'weekly_editorial_digest':
      schema = { type: 'object', properties: {
        newsClusters: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, itemIds: { type: 'array', items: { type: 'string' } }
        } } },
        ungroupedNewsIds: { type: 'array', items: { type: 'string' } },
        conversationTopics: { type: 'array', items: { type: 'object', properties: {
          title: { type: 'string' }, summary: { type: 'string' }, talkingPoint: { type: 'string' },
          relatedNewsIds: { type: 'array', items: { type: 'string' } }
        } } }
      } };
      break;
    // 28k 長文抽取保留 legacy JSON；沒有增加 tool 或偷偷降級結構化 task。
    default: return null;
  }
  return closeAiObjectSchema_(schema);
}

function closeAiObjectSchema_(schema) {
  if (schema.type === 'object') {
    schema.additionalProperties = false;
    schema.required = Object.keys(schema.properties);
    Object.keys(schema.properties).forEach(function(key) { closeAiObjectSchema_(schema.properties[key]); });
  }
  if (schema.type === 'array') closeAiObjectSchema_(schema.items);
  return schema;
}

// ======================================================
// 結構驗證與失敗重試語意
// ======================================================

/** 保留既有功能的缺欄重試語意：新聞／快讀可由 Queue retry，封存與編輯台仍由 caller fallback。 */
function isAiStructuredValidationRetryable_(task) {
  return task === 'news_analysis' || task === 'web_lazy_summary';
}

/** 僅實作本版實際使用的 JSON Schema subset；未知 keyword 是設定錯誤，不能靜默忽略。 */
function validateAiSchemaValue_(value, schema) {
  const keywords = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'maxLength', 'maxItems', 'description'];
  if (!schema || Object.keys(schema).some(function(key) { return keywords.indexOf(key) < 0; }) ||
      ['object', 'array', 'string', 'number', 'integer', 'boolean'].indexOf(schema.type) < 0) {
    throw createAiConfigurationError_('Unsupported local schema contract.');
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const own = function(key) { return Object.prototype.hasOwnProperty.call(value, key); };
    if ((schema.required || []).some(function(key) { return !own(key); })) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(function(key) {
      return !Object.prototype.hasOwnProperty.call(schema.properties, key);
    })) return false;
    return Object.keys(schema.properties).every(function(key) {
      return !own(key) || validateAiSchemaValue_(value[key], schema.properties[key]);
    });
  }
  if (schema.type === 'array') return Array.isArray(value) &&
    (schema.maxItems === undefined || value.length <= schema.maxItems) &&
    value.every(function(item) { return validateAiSchemaValue_(item, schema.items); });
  if (schema.type === 'integer' ? !Number.isInteger(value) : typeof value !== schema.type) return false;
  if (typeof value === 'number' && (!isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))) return false;
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) return false;
  return !schema.enum || schema.enum.indexOf(value) >= 0;
}
