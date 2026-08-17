/**
 * Sprint 6.6 — Recovery Observation V1 persistence (TEST_ONLY).
 * Physical persistence is forbidden; canonical records live in an in-memory store.
 */
const RECOVERY_PERSISTENCE_S66_CONFIG = Object.freeze({
  RECOVERY_COLLECTION_MODE: "TEST",
  MODES: Object.freeze(["OFF", "TEST", "SHADOW", "CANARY", "ACTIVE"]),
  ACTIVE_ENABLED: false,
  PHYSICAL_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  DECISION_ENGINE_ENABLED: false,
  RECOMMENDATION_ENGINE_ENABLED: false,
  PRODUCTION_VERSION_EXPECTED: 19,
  SCHEMA_VERSION: "RecoveryObservationV1"
});

const RECOVERY_METRIC_CONTRACT_S66_TEST = Object.freeze({
  sleep_hours: Object.freeze({unit: "hours", type: "NUMBER", min: 0, max: 24}),
  sleep_quality: Object.freeze({unit: "scale_1_10", type: "NUMBER", min: 1, max: 10}),
  energy: Object.freeze({unit: "scale_1_10", type: "NUMBER", min: 1, max: 10}),
  stress: Object.freeze({unit: "scale_1_10", type: "NUMBER", min: 1, max: 10}),
  fatigue: Object.freeze({unit: "scale_1_10", type: "NUMBER", min: 1, max: 10}),
  pain_present: Object.freeze({unit: "boolean", type: "BOOLEAN"}),
  pain_location: Object.freeze({unit: "text", type: "STRING"}),
  pain_level: Object.freeze({unit: "scale_0_10", type: "NUMBER", min: 0, max: 10}),
  comment: Object.freeze({unit: "text", type: "STRING"})
});

function createRecoveryCandidateS66Test_(userId, message, options) {
  const config = options || {};
  const raw = String(message || "").trim();
  const normalized = raw.toLowerCase().replace(/ё/g, "е").replace(/,/g, ".");
  const observedAt = normalizeRecoveryObservedAtS66Test_(config.observed_at || config.observed_date || new Date());
  const recordedAt = normalizeTimestampS64Test_(config.recorded_at || new Date());
  const captureSeed = stableStringifyS63Test_({user_id: String(userId), raw: raw, observed_at: observedAt});
  const captureId = config.capture_id || "recovery-capture-s66-" + digestHexDq_(captureSeed).slice(0, 16);
  const explicitValues = extractRecoveryValuesS66Test_(normalized, config);
  const records = [];

  Object.keys(RECOVERY_METRIC_CONTRACT_S66_TEST).forEach(function(metric) {
    if (!Object.prototype.hasOwnProperty.call(explicitValues, metric)) return;
    const value = explicitValues[metric];
    if (value === null || value === undefined || value === "") return;
    const qualityFlags = [];
    if (metric === "pain_location" && value === "UNKNOWN") qualityFlags.push("UNKNOWN_PAIN_LOCATION");
    records.push({
      observation_id: "recovery-observation-s66-" + digestHexDq_(captureId + "|" + metric).slice(0, 16),
      user_id: String(userId),
      domain: "RECOVERY",
      metric: metric,
      value: value,
      unit: RECOVERY_METRIC_CONTRACT_S66_TEST[metric].unit,
      observed_at: observedAt,
      recorded_at: recordedAt,
      source: "EXPLICIT_USER_INPUT",
      confidence: metric === "pain_location" && value === "UNKNOWN" ? 0.7 : 0.99,
      quality_score: metric === "pain_location" && value === "UNKNOWN" ? 70 : 100,
      quality_flags: qualityFlags,
      confirmation_status: "UNCONFIRMED",
      capture_id: captureId,
      status: "CANDIDATE",
      schema_version: RECOVERY_PERSISTENCE_S66_CONFIG.SCHEMA_VERSION
    });
  });

  return {
    candidate_id: "recovery-candidate-s66-" + digestHexDq_(captureSeed).slice(0, 16),
    capture_id: captureId,
    user_id: String(userId),
    domain: "RECOVERY",
    status: "CANDIDATE",
    confirmation_status: "UNCONFIRMED",
    raw_user_input: raw,
    records: records,
    medical_safety: {
      diagnosis: null,
      pain_interpretation: null,
      cause_inference: null,
      conclusion: null,
      status: "FACTS_ONLY"
    },
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function validateRecoveryObservationS66Test_(candidate) {
  if (!candidate || candidate.domain !== "RECOVERY" || candidate.status !== "CANDIDATE") {
    throw new Error("RECOVERY CANDIDATE is required");
  }
  const errors = [];
  const validatedRecords = [];
  if (!candidate.records.length) {
    errors.push({code: "NO_RECOVERY_VALUES", field: null, value: null});
  }
  candidate.records.forEach(function(record) {
    const contract = RECOVERY_METRIC_CONTRACT_S66_TEST[record.metric];
    const recordErrors = [];
    if (!contract) {
      recordErrors.push({code: "METRIC_NOT_ALLOWED", field: "metric", value: record.metric});
    } else if (contract.type === "NUMBER") {
      const number = Number(record.value);
      if (!isFinite(number)) {
        recordErrors.push({code: "NOT_A_NUMBER", field: record.metric, value: record.value});
      } else if (number < contract.min || number > contract.max) {
        recordErrors.push({code: "OUT_OF_RANGE", field: record.metric, value: number, min: contract.min, max: contract.max});
      }
    } else if (contract.type === "BOOLEAN" && typeof record.value !== "boolean") {
      recordErrors.push({code: "NOT_A_BOOLEAN", field: record.metric, value: record.value});
    } else if (contract.type === "STRING" && typeof record.value !== "string") {
      recordErrors.push({code: "NOT_A_STRING", field: record.metric, value: record.value});
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+03:00$/.test(record.observed_at)) {
      recordErrors.push({code: "INVALID_EUROPE_MOSCOW_TIMESTAMP", field: "observed_at", value: record.observed_at});
    }
    recordErrors.forEach(function(error) { errors.push(error); });
    const validated = deepCloneDq_(record);
    validated.validation_status = recordErrors.length ? "VALIDATION_ERROR" : "VALID";
    validated.quality_flags = validated.quality_flags.concat(recordErrors.map(function(error) { return error.code; }));
    validated.quality_score = recordErrors.length ? Math.min(validated.quality_score, 40) : validated.quality_score;
    validatedRecords.push(validated);
  });
  return {
    status: errors.length ? "VALIDATION_ERROR" : "VALID",
    valid: errors.length === 0,
    errors: errors,
    validated_records: validatedRecords,
    medical_interpretation_performed: false,
    diagnosis: null,
    decision_objects: [],
    recommendation_objects: [],
    write_performed: false
  };
}

function createRecoveryConfirmationS66Test_(candidate, validation, options) {
  if (!candidate || candidate.status !== "CANDIDATE") throw new Error("CANDIDATE is required");
  if (!validation || validation.status !== "VALID") throw new Error("VALID recovery validation is required");
  const pendingRecords = validation.validated_records.map(function(record) {
    const result = deepCloneDq_(record);
    result.status = "PENDING_CONFIRMATION";
    result.confirmation_status = "PENDING_CONFIRMATION";
    return result;
  });
  return {
    confirmation_id: "recovery-confirmation-s66-" + digestHexDq_(candidate.capture_id).slice(0, 16),
    candidate_id: candidate.candidate_id,
    capture_id: candidate.capture_id,
    user_id: candidate.user_id,
    domain: "RECOVERY",
    status: "PENDING_CONFIRMATION",
    confirmation_status: "PENDING_CONFIRMATION",
    records: pendingRecords,
    confirmation_message: buildRecoveryConfirmationMessageS66Test_(pendingRecords),
    created_at: normalizeTimestampS64Test_((options || {}).created_at || new Date()),
    medical_interpretation_performed: false,
    decision_objects: [],
    recommendation_objects: [],
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function confirmRecoveryObservationS66Test_(pending, confirmationText, canonicalStore, options) {
  if (!pending || pending.capture_id === undefined) throw new Error("Recovery confirmation bundle is required");
  const mode = resolveRecoveryCollectionModeS66Test_((options || {}).mode || RECOVERY_PERSISTENCE_S66_CONFIG.RECOVERY_COLLECTION_MODE);
  const store = normalizeRecoveryCanonicalStoreS66Test_(canonicalStore, mode);
  const existing = store.observations.filter(function(record) {
    return record.capture_id === pending.capture_id && record.status === "CANONICAL";
  });
  if (existing.length) {
    return {
      action: "ALREADY_CONFIRMED",
      status: "CANONICAL",
      confirmation_status: "CONFIRMED",
      canonical_observations: deepCloneDq_(existing),
      canonical_store: store,
      duplicate_created: false,
      write_performed: false
    };
  }
  if (pending.status !== "PENDING_CONFIRMATION") throw new Error("PENDING_CONFIRMATION bundle is required");
  if (detectGoalConfirmationIntentTest_(confirmationText) !== "CONFIRM") {
    return {
      action: "EXPLICIT_CONFIRMATION_REQUIRED",
      status: "PENDING_CONFIRMATION",
      canonical_observations: [],
      canonical_store: store,
      duplicate_created: false,
      write_performed: false
    };
  }

  const recordedAt = normalizeTimestampS64Test_((options || {}).recorded_at || new Date());
  const canonical = pending.records.map(function(record) {
    const result = deepCloneDq_(record);
    result.status = "CANONICAL";
    result.confirmation_status = "CONFIRMED";
    result.source = "EXPLICIT_USER_INPUT_CONFIRMED";
    result.recorded_at = recordedAt;
    result.confidence = Math.min(1, Math.max(result.confidence, 0.95));
    result.quality_flags = result.quality_flags.filter(function(flag) { return flag !== "UNCONFIRMED"; });
    return result;
  });
  canonical.forEach(function(record) { store.observations.push(record); });
  store.confirmed_capture_ids.push(pending.capture_id);
  return {
    action: "CANONICAL_CREATED",
    lifecycle: ["CANDIDATE", "PENDING_CONFIRMATION", "CONFIRMED", "CANONICAL"],
    status: "CANONICAL",
    confirmed_status: "CONFIRMED",
    confirmation_status: "CONFIRMED",
    canonical_observations: deepCloneDq_(canonical),
    canonical_store: store,
    duplicate_created: false,
    decision_objects: [],
    recommendation_objects: [],
    write_performed: false
  };
}

function cancelRecoveryObservationS66Test_(pending, reason, canonicalStore, options) {
  if (!pending || pending.status !== "PENDING_CONFIRMATION") {
    throw new Error("PENDING_CONFIRMATION bundle is required");
  }
  const store = normalizeRecoveryCanonicalStoreS66Test_(canonicalStore, (options || {}).mode || "TEST");
  const cancelled = deepCloneDq_(pending);
  cancelled.status = "CANCELLED";
  cancelled.confirmation_status = "CANCELLED";
  cancelled.cancelled_at = normalizeTimestampS64Test_((options || {}).cancelled_at || new Date());
  cancelled.cancel_reason = String(reason || "USER_CANCELLED");
  cancelled.records.forEach(function(record) {
    record.status = "CANCELLED";
    record.confirmation_status = "CANCELLED";
  });
  cancelled.write_performed = false;
  return {
    action: "CANCELLED",
    status: "CANCELLED",
    cancelled_bundle: cancelled,
    canonical_store: store,
    canonical_observations: [],
    decision_objects: [],
    recommendation_objects: [],
    write_performed: false
  };
}

function buildRecoveryStateFromObservationS66Test_(canonicalObservations, options) {
  const records = (canonicalObservations || []).filter(function(record) {
    return record && record.domain === "RECOVERY" && record.status === "CANONICAL" &&
      record.confirmation_status === "CONFIRMED";
  });
  const adapted = records.map(function(record) {
    return {
      domain: "RECOVERY",
      metric: mapRecoveryMetricToTwinS66Test_(record.metric),
      value: record.value,
      unit: record.unit,
      observed_at: record.observed_at,
      source_record_id: record.observation_id,
      confidence: record.confidence,
      quality_flags: record.quality_flags.slice()
    };
  });
  const context = {as_of: (options || {}).as_of || new Date()};
  const state = buildRecoveryState_(adapted, context);
  state.canonical_records_count = records.length;
  state.observation_values = {};
  records.forEach(function(record) { state.observation_values[record.metric] = record.value; });
  state.decision_objects = [];
  state.recommendation_objects = [];
  state.production_snapshot_updated = false;
  state.storage = "IN_MEMORY_ONLY";
  state.write_performed = false;
  return state;
}

function simulateReadinessAfterRecoveryS66Test_(beforeRecoveryScore, canonicalObservations) {
  const confirmed = (canonicalObservations || []).filter(function(record) {
    return record.status === "CANONICAL" && record.confirmation_status === "CONFIRMED";
  });
  const days = {};
  confirmed.forEach(function(record) { days[record.observed_at.slice(0, 10)] = true; });
  const uniqueDays = Object.keys(days).length;
  const afterScore = roundDq_(Math.min(100, uniqueDays / DATA_READINESS_S63_CONFIG.RECOVERY_MIN_CHECKINS * 100), 1);
  return {
    domain: "RECOVERY",
    before: numericScoreS64Test_(beforeRecoveryScore),
    after: Math.max(numericScoreS64Test_(beforeRecoveryScore), afterScore),
    confirmed_days_simulated: uniqueDays,
    real_readiness_updated: false,
    decision_objects: [],
    recommendation_objects: [],
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function extractRecoveryValuesS66Test_(text, options) {
  const values = {};
  const matchers = {
    sleep_hours: /(?:спал(?:а)?|сон)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*(?:час|ч\b)/i,
    sleep_quality: /качеств[оа]\s+сна\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
    energy: /энерги(?:я|и)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
    stress: /стресс\s*[:=-]?\s*(\d+(?:\.\d+)?)/i,
    fatigue: /усталост[ьи]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i
  };
  Object.keys(matchers).forEach(function(metric) {
    const match = text.match(matchers[metric]);
    if (match) values[metric] = Number(match[1]);
  });
  if (/боли?\s+нет|без\s+боли/i.test(text)) {
    values.pain_present = false;
    values.pain_level = 0;
  } else if (/болит|боль/i.test(text)) {
    values.pain_present = true;
    values.pain_location = detectPainLocationS66Test_(text);
    const levelMatch = text.match(/(?:болит|боль)[^\d]{0,40}(\d+(?:\.\d+)?)\s*(?:из\s*10)?/i);
    if (levelMatch) values.pain_level = Number(levelMatch[1]);
  }
  if (isPresentDq_((options || {}).comment)) values.comment = String(options.comment).trim();
  return values;
}

function detectPainLocationS66Test_(text) {
  if (/плеч/i.test(text)) return "SHOULDER";
  if (/поясниц/i.test(text)) return "LOWER_BACK";
  if (/лок[о]?т/i.test(text)) return "ELBOW";
  if (/колен/i.test(text)) return "KNEE";
  return "UNKNOWN";
}

function buildRecoveryConfirmationMessageS66Test_(records) {
  const labels = {
    sleep_hours: "Сон", sleep_quality: "Качество сна", energy: "Энергия", stress: "Стресс",
    fatigue: "Усталость", pain_present: "Боль", pain_location: "Локализация боли",
    pain_level: "Уровень боли", comment: "Комментарий"
  };
  const values = records.map(function(record) {
    const value = record.metric === "pain_present" ? (record.value ? "есть" : "нет") : String(record.value);
    return labels[record.metric] + ": " + value;
  });
  return "Проверь данные:\n" + values.join("\n") + "\n\nПодтвердить?";
}

function normalizeRecoveryCanonicalStoreS66Test_(store, mode) {
  const resolvedMode = resolveRecoveryCollectionModeS66Test_(mode || "TEST");
  if (!store) {
    return {mode: resolvedMode, observations: [], confirmed_capture_ids: [], physical_writes: 0};
  }
  const result = deepCloneDq_(store);
  result.mode = resolvedMode;
  result.observations = result.observations || [];
  result.confirmed_capture_ids = result.confirmed_capture_ids || [];
  result.physical_writes = 0;
  return result;
}

function mapRecoveryMetricToTwinS66Test_(metric) {
  if (metric === "sleep_hours" || metric === "sleep_quality") return "recovery.sleep";
  if (metric === "energy") return "recovery.energy";
  if (["pain_present", "pain_location", "pain_level"].indexOf(metric) >= 0) return "recovery.pain";
  return "recovery." + metric;
}

function normalizeRecoveryObservedAtS66Test_(value) {
  if (value instanceof Date) return normalizeTimestampS64Test_(value);
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text + "T12:00:00+03:00";
  return normalizeTimestampS64Test_(new Date(text));
}

function resolveRecoveryCollectionModeS66Test_(modeValue) {
  const mode = String(modeValue || "").toUpperCase();
  if (RECOVERY_PERSISTENCE_S66_CONFIG.MODES.indexOf(mode) < 0) {
    throw new Error("UNKNOWN_RECOVERY_COLLECTION_MODE: " + mode);
  }
  if (mode === "ACTIVE" && RECOVERY_PERSISTENCE_S66_CONFIG.ACTIVE_ENABLED !== true) {
    throw new Error("ACTIVE_RECOVERY_COLLECTION_MODE_FORBIDDEN");
  }
  return mode;
}
