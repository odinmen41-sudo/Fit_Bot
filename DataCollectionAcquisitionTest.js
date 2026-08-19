/**
 * Sprint 6.3 — TEST-ONLY Recovery and Nutrition Data Acquisition.
 *
 * Safety contract:
 * - observations are built in memory only;
 * - no sheet, Telegram or Groq writes/calls;
 * - pain is recorded literally and never interpreted;
 * - nutrition facts and calculated estimates are stored separately.
 */
const DATA_COLLECTION_ACQUISITION_S63_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  MEDICAL_INTERPRETATION_ENABLED: false,
  SOURCE: "EXPLICIT_USER_INPUT",
  RECOVERY_STALE_AFTER_DAYS: 3,
  NUTRITION_WINDOW_DAYS: 14
});

const NUTRITION_FOOD_REFERENCE_S63_TEST = Object.freeze({
  CHICKEN_BREAST: Object.freeze({
    aliases: Object.freeze(["курица", "курицу", "курицы", "куриное филе"]),
    display_name: "Курица",
    estimate_per_100g: Object.freeze({calories: 165, protein_g: 31, fat_g: 3.6, carbs_g: 0})
  }),
  RICE_COOKED: Object.freeze({
    aliases: Object.freeze(["рис", "риса"]),
    display_name: "Рис",
    estimate_per_100g: Object.freeze({calories: 130, protein_g: 2.7, fat_g: 0.3, carbs_g: 28})
  }),
  BUCKWHEAT_COOKED: Object.freeze({
    aliases: Object.freeze(["гречка", "гречку", "гречки"]),
    display_name: "Гречка",
    estimate_per_100g: Object.freeze({calories: 110, protein_g: 4.2, fat_g: 1.1, carbs_g: 21.3})
  }),
  EGG: Object.freeze({
    aliases: Object.freeze(["яйцо", "яйца", "яиц"]),
    display_name: "Яйцо",
    estimate_per_100g: Object.freeze({calories: 143, protein_g: 12.6, fat_g: 9.5, carbs_g: 0.7})
  })
});

function parseRecoveryCheckinS63Test_(message, options) {
  const config = options || {};
  const raw = String(message || "").trim();
  const text = raw.toLowerCase().replace(/ё/g, "е").replace(/,/g, ".");
  const values = {
    sleep_hours: matchNumberS63Test_(text, /(?:спал(?:а)?|сон)\s*(?:[:=-]?\s*)?(\d+(?:\.\d+)?)\s*(?:час|ч\b)/i, 0, 24),
    sleep_quality: matchNumberS63Test_(text, /качеств[оа]\s+сна\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10),
    energy: matchNumberS63Test_(text, /энерги(?:я|и)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10),
    fatigue: matchNumberS63Test_(text, /усталост[ьи]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10),
    stress: matchNumberS63Test_(text, /стресс\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10)
  };
  const pain = parseLiteralPainS63Test_(text);
  values.pain_presence = pain.presence;
  values.pain_location = pain.location;
  values.pain_level = pain.level;

  const observedDate = normalizeDateS63Test_(config.observed_date || config.observed_at || new Date());
  const fieldNames = [
    "sleep_hours", "sleep_quality", "energy", "fatigue", "stress",
    "pain_presence", "pain_location", "pain_level"
  ];
  const fields = {};
  const missingFields = [];
  fieldNames.forEach(function(name) {
    const present = values[name] !== null && values[name] !== undefined && values[name] !== "";
    fields[name] = {
      value: present ? values[name] : null,
      source: present ? DATA_COLLECTION_ACQUISITION_S63_CONFIG.SOURCE : null,
      confidence: present ? (name === "pain_location" && values[name] === "UNKNOWN" ? 0.55 : 0.99) : 0,
      quality: present ? (name === "pain_location" && values[name] === "UNKNOWN" ? "EXPLICIT_UNRESOLVED" : "EXPLICIT") : "MISSING"
    };
    if (!present) missingFields.push(name);
  });

  const presentCount = fieldNames.length - missingFields.length;
  return {
    schema_version: "RECOVERY_OBSERVATION_S63_TEST_1",
    observation_type: "RECOVERY_CHECKIN",
    observed_date: observedDate,
    fields: fields,
    completeness: roundDq_(presentCount / fieldNames.length, 3),
    completeness_flag: presentCount === fieldNames.length ? "COMPLETE" : "PARTIAL",
    missing_fields: missingFields,
    quality_flags: pain.location === "UNKNOWN" ? ["UNKNOWN_PAIN_LOCATION"] : [],
    raw_user_input: raw,
    observation_only: true,
    write_performed: false
  };
}

function createCanonicalRecoveryObservationS63Test_(userId, parsed, registry, options) {
  if (!parsed || parsed.observation_type !== "RECOVERY_CHECKIN") {
    throw new Error("RECOVERY_CHECKIN payload is required");
  }
  const config = options || {};
  const observations = (registry || []).map(deepCloneDq_);
  const contentHash = digestHexDq_(stableStringifyS63Test_({
    user_id: String(userId),
    observed_date: parsed.observed_date,
    fields: parsed.fields,
    raw_user_input: parsed.raw_user_input
  }));
  const duplicate = observations.filter(function(item) {
    return item.user_id === String(userId) && item.content_hash === contentHash;
  })[0];
  if (duplicate) {
    return {
      action: "DUPLICATE_IGNORED",
      observation: deepCloneDq_(duplicate),
      registry: observations,
      write_performed: false
    };
  }

  const previousSameDay = observations.filter(function(item) {
    return item.user_id === String(userId) && item.observed_date === parsed.observed_date;
  }).sort(function(a, b) { return b.sequence - a.sequence; })[0] || null;
  const asOf = parseDateS63Test_(config.as_of || new Date());
  const observedAt = parseDateS63Test_(parsed.observed_date);
  const ageDays = asOf && observedAt
    ? Math.max(0, Math.floor((startOfDayDq_(asOf) - startOfDayDq_(observedAt)) / 86400000))
    : null;
  const stale = ageDays !== null && ageDays > DATA_COLLECTION_ACQUISITION_S63_CONFIG.RECOVERY_STALE_AFTER_DAYS;
  const sequence = previousSameDay ? previousSameDay.sequence + 1 : 1;
  const qualityFlags = parsed.quality_flags.slice();
  if (stale) qualityFlags.push("STALE_RECOVERY");

  const observation = {
    observation_id: "recovery-s63-" + contentHash.slice(0, 16),
    user_id: String(userId),
    observation_type: "RECOVERY_CHECKIN",
    observed_date: parsed.observed_date,
    sequence: sequence,
    supersedes_observation_id: previousSameDay ? previousSameDay.observation_id : null,
    fields: deepCloneDq_(parsed.fields),
    completeness: parsed.completeness,
    completeness_flag: parsed.completeness_flag,
    missing_fields: parsed.missing_fields.slice(),
    confidence: calculateRecoveryConfidenceS63Test_(parsed.fields),
    freshness: {
      status: stale ? "STALE" : "FRESH",
      age_days: ageDays,
      stale_after_days: DATA_COLLECTION_ACQUISITION_S63_CONFIG.RECOVERY_STALE_AFTER_DAYS
    },
    quality: {
      status: stale ? "STALE" : (parsed.completeness_flag === "COMPLETE" ? "COMPLETE" : "PARTIAL"),
      flags: qualityFlags,
      source: DATA_COLLECTION_ACQUISITION_S63_CONFIG.SOURCE
    },
    medical_safety: {
      diagnosis: null,
      pain_interpretation: null,
      cause_inference: null,
      status: "NO_MEDICAL_INTERPRETATION"
    },
    content_hash: contentHash,
    canonical: true,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
  observations.push(observation);
  return {
    action: previousSameDay ? "REPEATED_CHECKIN_ADDED" : "OBSERVATION_CREATED",
    observation: deepCloneDq_(observation),
    registry: observations,
    write_performed: false
  };
}

function detectMealEntryS63Test_(message) {
  const text = normalizeTextDq_(message);
  const foodMention = Object.keys(NUTRITION_FOOD_REFERENCE_S63_TEST).some(function(key) {
    return NUTRITION_FOOD_REFERENCE_S63_TEST[key].aliases.some(function(alias) {
      return text.indexOf(alias) >= 0;
    });
  });
  return {
    intent: foodMention ? "NUTRITION_MEAL_ENTRY" : "UNKNOWN",
    detected: foodMention,
    confidence: foodMention && /\d+(?:[.,]\d+)?\s*(?:г|гр|грамм)/i.test(text) ? 0.99 : (foodMention ? 0.7 : 0),
    source: foodMention ? DATA_COLLECTION_ACQUISITION_S63_CONFIG.SOURCE : null,
    write_performed: false
  };
}

function extractNutritionAcquisitionS63Test_(message, options) {
  const config = options || {};
  const raw = String(message || "").trim();
  const text = raw.toLowerCase().replace(/ё/g, "е").replace(/,/g, ".");
  const detection = detectMealEntryS63Test_(raw);
  const facts = [];

  Object.keys(NUTRITION_FOOD_REFERENCE_S63_TEST).forEach(function(foodId) {
    const reference = NUTRITION_FOOD_REFERENCE_S63_TEST[foodId];
    let matched = null;
    reference.aliases.some(function(alias) {
      const escaped = escapeRegexS63Test_(alias).replace(/а$/, "[а-я]*").replace(/у$/, "[а-я]*").replace(/ы$/, "[а-я]*");
      const pattern = new RegExp("(?:" + escaped + ")\\s*(\\d+(?:\\.\\d+)?)\\s*(?:г|гр|грамм(?:а|ов)?)(?=\\s|$|[.,;])", "i");
      matched = text.match(pattern);
      return !!matched;
    });
    if (!matched) return;
    const grams = Number(matched[1]);
    if (!isFinite(grams) || grams <= 0 || grams > 5000) return;
    facts.push({
      fact_type: "FOOD_CONSUMED",
      food_id: foodId,
      normalized_food: reference.display_name,
      quantity: grams,
      unit: "g",
      source: DATA_COLLECTION_ACQUISITION_S63_CONFIG.SOURCE,
      confidence: 0.99,
      quality: "EXPLICIT",
      is_estimate: false
    });
  });

  const estimates = facts.map(function(fact) {
    const density = NUTRITION_FOOD_REFERENCE_S63_TEST[fact.food_id].estimate_per_100g;
    const ratio = fact.quantity / 100;
    return {
      estimate_type: "REFERENCE_MACROS",
      food_id: fact.food_id,
      quantity_g: fact.quantity,
      calories: roundDq_(density.calories * ratio, 1),
      protein_g: roundDq_(density.protein_g * ratio, 1),
      fat_g: roundDq_(density.fat_g * ratio, 1),
      carbs_g: roundDq_(density.carbs_g * ratio, 1),
      source: "REFERENCE_FOOD_TABLE_TEST",
      confidence: 0.65,
      quality: "ESTIMATE",
      is_estimate: true,
      source_fact: false
    };
  });

  const recognizedMentions = countRecognizedFoodMentionsS63Test_(text);
  const completeness = recognizedMentions > 0 ? facts.length / recognizedMentions : 0;
  return {
    schema_version: "NUTRITION_ACQUISITION_S63_TEST_1",
    record_type: "MEAL_ENTRY",
    meal_date: normalizeDateS63Test_(config.meal_date || new Date()),
    detection: detection,
    facts: facts,
    estimates: estimates,
    fact_estimate_separation: true,
    completeness: roundDq_(Math.min(1, completeness), 3),
    completeness_flag: facts.length > 0 && completeness >= 1 ? "COMPLETE" : "PARTIAL",
    confidence: facts.length ? roundDq_(facts.reduce(function(sum, fact) { return sum + fact.confidence; }, 0) / facts.length, 2) : 0,
    missing_fields: facts.length ? [] : ["food", "quantity_g"],
    raw_user_input: raw,
    storage: "IN_MEMORY_ONLY",
    write_performed: false,
    recommendations: []
  };
}

function calculateNutritionCoverageS63Test_(asOfValue, windowDays, acquiredRecords, repository) {
  const asOf = startOfDayDq_(parseDateS63Test_(asOfValue));
  const days = windowDays || DATA_COLLECTION_ACQUISITION_S63_CONFIG.NUTRITION_WINDOW_DAYS;
  const start = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - days + 1);
  const table = readTableDq_("Nutrition_Log", repository);
  const indexes = resolveHeaderIndexesDq_(table.headers, {date: ["Дата", "date"]});
  const covered = {};
  table.rows.forEach(function(row) {
    const date = parseDateS63Test_(getCellDq_(row, indexes.date));
    if (date && date >= start && date <= asOf) covered[normalizeDateS63Test_(date)] = true;
  });
  const before = Object.keys(covered).length;
  (acquiredRecords || []).forEach(function(record) {
    const date = parseDateS63Test_(record.meal_date);
    if (date && date >= start && date <= asOf && record.facts && record.facts.length) {
      covered[normalizeDateS63Test_(date)] = true;
    }
  });
  const after = Object.keys(covered).length;
  return {
    window_start: normalizeDateS63Test_(start),
    window_end: normalizeDateS63Test_(asOf),
    window_days: days,
    covered_days_before: before,
    coverage_before: roundDq_(before / days, 3),
    covered_days_after: after,
    coverage_after: roundDq_(after / days, 3),
    improvement_points: roundDq_((after - before) / days * 100, 1),
    simulated_records: (acquiredRecords || []).length,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function parseLiteralPainS63Test_(text) {
  if (/боли?\s+нет|без\s+боли/i.test(text)) {
    return {presence: false, location: null, level: 0};
  }
  const known = [
    {pattern: /(?:боль\s+(?:в\s+)?|болит\s+)(?:правое\s+|левое\s+)?плеч[оеае]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, location: "SHOULDER"},
    {pattern: /(?:боль\s+(?:в\s+)?|болит\s+)поясниц[аеуы]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, location: "LOWER_BACK"},
    {pattern: /(?:боль\s+(?:в\s+)?|болит\s+)(?:правый\s+|левый\s+)?лок[о]?т[ьея]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, location: "ELBOW"},
    {pattern: /(?:боль\s+(?:в\s+)?|болит\s+)(?:правое\s+|левое\s+)?колен[оея]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, location: "KNEE"}
  ];
  for (let i = 0; i < known.length; i += 1) {
    const match = text.match(known[i].pattern);
    if (match) {
      const level = Number(match[1]);
      return {presence: level > 0, location: known[i].location, level: level >= 0 && level <= 10 ? level : null};
    }
  }
  const unknown = text.match(/(?:что-то|где-то|не\s+знаю\s+где)?\s*болит(?:\s+[^\d,.]{0,30})?\s*(\d+(?:\.\d+)?)\s*(?:из\s*10)?/i);
  if (unknown) {
    const level = Number(unknown[1]);
    return {presence: level > 0, location: "UNKNOWN", level: level >= 0 && level <= 10 ? level : null};
  }
  if (/болит|боль/i.test(text)) return {presence: true, location: "UNKNOWN", level: null};
  return {presence: null, location: null, level: null};
}

function calculateRecoveryConfidenceS63Test_(fields) {
  const populated = Object.keys(fields).filter(function(key) { return fields[key].value !== null; });
  if (!populated.length) return 0;
  return roundDq_(populated.reduce(function(sum, key) { return sum + fields[key].confidence; }, 0) / populated.length, 2);
}

function countRecognizedFoodMentionsS63Test_(text) {
  let count = 0;
  Object.keys(NUTRITION_FOOD_REFERENCE_S63_TEST).forEach(function(key) {
    const found = NUTRITION_FOOD_REFERENCE_S63_TEST[key].aliases.some(function(alias) {
      return text.indexOf(alias) >= 0;
    });
    if (found) count += 1;
  });
  return count;
}

function matchNumberS63Test_(text, pattern, min, max) {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return isFinite(value) && value >= min && value <= max ? value : null;
}

function parseDateS63Test_(value) {
  const parsed = parseDateDq_(value);
  if (parsed) return parsed;
  const fallback = value instanceof Date ? value : new Date(String(value));
  return isNaN(fallback.getTime()) ? null : fallback;
}

function normalizeDateS63Test_(value) {
  const date = parseDateS63Test_(value);
  return date ? formatDateKeyDq_(date) : null;
}

function escapeRegexS63Test_(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stableStringifyS63Test_(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringifyS63Test_).join(",") + "]";
  return "{" + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ":" + stableStringifyS63Test_(value[key]);
  }).join(",") + "}";
}
