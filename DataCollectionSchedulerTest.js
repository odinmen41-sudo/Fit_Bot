/**
 * Sprint 6.4 — Controlled Data Collection Scheduler (TEST / SHADOW only).
 *
 * This layer identifies missing information and creates in-memory collection
 * events. It never makes a fitness decision, recommendation or user-facing
 * call, and it never writes to Sheets.
 */
const DATA_COLLECTION_S64_CONFIG = Object.freeze({
  DATA_COLLECTION_MODE: "SHADOW",
  MODE: "SHADOW",
  MODES: Object.freeze(["OFF", "TEST", "SHADOW", "ACTIVE"]),
  ACTIVE_ENABLED: false,
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  LLM_ENABLED: false,
  DECISION_ENGINE_ENABLED: false,
  RECOMMENDATION_ENGINE_ENABLED: false,
  PRODUCTION_VERSION_EXPECTED: 19
});

const DATA_COLLECTION_TEMPLATES_S64_TEST = Object.freeze({
  RECOVERY_CHECKIN: Object.freeze({
    collection_type: "RECOVERY_CHECKIN",
    domain: "RECOVERY",
    fields: Object.freeze([
      Object.freeze({name: "sleep_hours", type: "NUMBER", unit: "hours"}),
      Object.freeze({name: "sleep_quality", type: "SCALE", range: "0-10"}),
      Object.freeze({name: "energy", type: "SCALE", range: "0-10"}),
      Object.freeze({name: "stress", type: "SCALE", range: "0-10"}),
      Object.freeze({name: "fatigue", type: "SCALE", range: "0-10"}),
      Object.freeze({name: "pain", type: "LITERAL_USER_INPUT"})
    ])
  }),
  BODY_WEIGHT_COLLECTION: Object.freeze({
    collection_type: "BODY_WEIGHT_COLLECTION",
    domain: "BODY",
    fields: Object.freeze([
      Object.freeze({name: "weight", type: "NUMBER", unit: "kg"}),
      Object.freeze({name: "date", type: "DATE"}),
      Object.freeze({name: "conditions", type: "TEXT", optional: true})
    ])
  }),
  NUTRITION_LOG_COLLECTION: Object.freeze({
    collection_type: "NUTRITION_LOG_COLLECTION",
    domain: "NUTRITION",
    fields: Object.freeze([
      Object.freeze({name: "meal", type: "TEXT"}),
      Object.freeze({name: "foods", type: "ARRAY"}),
      Object.freeze({name: "quantity", type: "NUMBER_WITH_UNIT"})
    ])
  }),
  GOAL_CONFIRMATION: Object.freeze({
    collection_type: "GOAL_CONFIRMATION",
    domain: "GOAL",
    fields: Object.freeze([
      Object.freeze({name: "target_weight", type: "NUMBER", unit: "kg"}),
      Object.freeze({name: "deadline", type: "DATE_OR_HORIZON"})
    ])
  }),
  WORKOUT_DATA_COLLECTION: Object.freeze({
    collection_type: "WORKOUT_DATA_COLLECTION",
    domain: "TRAINING",
    fields: Object.freeze([
      Object.freeze({name: "exercise", type: "TEXT"}),
      Object.freeze({name: "weight", type: "NUMBER", unit: "kg", optional: true}),
      Object.freeze({name: "sets", type: "INTEGER"}),
      Object.freeze({name: "reps", type: "INTEGER_OR_SERIES"}),
      Object.freeze({name: "date", type: "DATE"})
    ])
  })
});

function detectMissingDataS64Test_(readinessReport, context) {
  if (!readinessReport || !readinessReport.domains) {
    throw new Error("DATA_READINESS_REPORT with domains is required");
  }
  const config = context || {};
  const domains = readinessReport.domains;
  const missing = [];

  if (domains.body && domains.body.status !== "READY") {
    missing.push(missingDataItemS64Test_(
      "BODY", "BODY_WEIGHT_COLLECTION", ["weight", "date", "conditions"],
      domains.body.reason || "INSUFFICIENT_HISTORY", domains.body
    ));
  }
  if (domains.training && domains.training.status !== "READY") {
    missing.push(missingDataItemS64Test_(
      "TRAINING", "WORKOUT_DATA_COLLECTION", ["exercise", "weight", "sets", "reps", "date"],
      domains.training.reason || "TEMPORAL_DATA_INSUFFICIENT", domains.training
    ));
  }
  if (domains.nutrition && domains.nutrition.status !== "READY") {
    missing.push(missingDataItemS64Test_(
      "NUTRITION", "NUTRITION_LOG_COLLECTION", ["meal", "foods", "quantity"],
      domains.nutrition.reason || "LOW_COVERAGE", domains.nutrition
    ));
  }
  if (domains.recovery && domains.recovery.status !== "READY") {
    missing.push(missingDataItemS64Test_(
      "RECOVERY", "RECOVERY_CHECKIN", ["sleep_hours", "sleep_quality", "energy", "stress", "fatigue", "pain"],
      domains.recovery.reason || "NO_RECOVERY_CHECKINS", domains.recovery
    ));
  }
  if (domains.goal && domains.goal.status !== "READY") {
    const goalReason = config.memory_goal_candidate
      ? "AI_MEMORY_GOAL_REQUIRES_EXPLICIT_CONFIRMATION"
      : (domains.goal.reason || "EXPLICIT_CONFIRMATION_REQUIRED");
    missing.push(missingDataItemS64Test_(
      "GOAL", "GOAL_CONFIRMATION", ["target_weight", "deadline"], goalReason, domains.goal
    ));
  }
  return missing;
}

function calculateDataCollectionPriority_(input, context) {
  const normalized = normalizeReadinessInputS64Test_(input);
  const config = context || {};
  const candidates = [];
  addPriorityCandidateS64Test_(candidates, normalized, "RECOVERY", "RECOVERY_CHECKIN", function(score, status) {
    return status === "NO_DATA" || score === 0 ? 100 : (100 - score) * 0.85;
  }, 0.95);
  addPriorityCandidateS64Test_(candidates, normalized, "GOAL", "GOAL_CONFIRMATION", function(score) {
    return score >= 100 ? 0 : (config.memory_goal_candidate ? 96 : 92);
  }, config.memory_goal_candidate ? 0.99 : 0.93);
  addPriorityCandidateS64Test_(candidates, normalized, "TRAINING", "WORKOUT_DATA_COLLECTION", function(score) {
    return (100 - score) * 0.88;
  }, 0.92);
  addPriorityCandidateS64Test_(candidates, normalized, "BODY", "BODY_WEIGHT_COLLECTION", function(score, status) {
    return status === "NO_DATA" || score === 0 ? 96 : (100 - score) * 0.90;
  }, 0.94);
  addPriorityCandidateS64Test_(candidates, normalized, "NUTRITION", "NUTRITION_LOG_COLLECTION", function(score) {
    return (100 - score) * 0.82;
  }, 0.90);

  candidates.sort(function(a, b) {
    if (b.information_value !== a.information_value) return b.information_value - a.information_value;
    return a.tie_break_order - b.tie_break_order;
  });
  const selected = candidates.filter(function(item) { return item.information_value > 0; })[0] || null;
  if (!selected) {
    return {
      priority: null,
      collection_type: null,
      reason: "NO_MISSING_DATA",
      confidence: 1,
      information_value: 0,
      requested_fields: [],
      deterministic: true,
      llm_used: false
    };
  }
  const template = getDataCollectionTemplateS64Test_(selected.collection_type);
  return {
    priority: selected.collection_type,
    collection_type: selected.collection_type,
    domain: selected.domain,
    reason: "highest_missing_information_value",
    confidence: selected.confidence,
    information_value: roundDq_(selected.information_value, 1),
    requested_fields: template.fields.map(function(field) { return field.name; }),
    alternatives: candidates.slice(1).map(function(item) {
      return {collection_type: item.collection_type, information_value: roundDq_(item.information_value, 1)};
    }),
    deterministic: true,
    llm_used: false
  };
}

function buildDataCollectionScheduleS64Test_(userId, readinessReport, options) {
  const config = options || {};
  const mode = resolveDataCollectionModeS64Test_(config.mode || DATA_COLLECTION_S64_CONFIG.DATA_COLLECTION_MODE);
  const context = {
    memory_goal_candidate: config.memory_goal_candidate || null
  };
  const missingData = detectMissingDataS64Test_(readinessReport, context);
  const priority = calculateDataCollectionPriority_(readinessReport, context);
  if (mode === "OFF" || !priority.collection_type) {
    return {
      mode: mode,
      missing_data: missingData,
      priority: priority,
      event: null,
      status: mode === "OFF" ? "DISABLED" : "NO_ACTION_REQUIRED",
      write_performed: false
    };
  }
  const event = createDataCollectionEventS64Test_(userId, priority, {
    mode: mode,
    created_at: config.created_at || new Date()
  });
  return {
    mode: mode,
    missing_data: missingData,
    priority: priority,
    event: event,
    status: mode === "SHADOW" ? "SHADOW_EVENT_CREATED" : "TEST_EVENT_CREATED",
    user_flow_changed: false,
    write_performed: false
  };
}

function getDataCollectionTemplateS64Test_(collectionType) {
  const template = DATA_COLLECTION_TEMPLATES_S64_TEST[collectionType];
  if (!template) throw new Error("Unknown collection type: " + collectionType);
  const result = deepCloneDq_(template);
  result.analysis_enabled = false;
  result.recommendations_enabled = false;
  result.storage = "IN_MEMORY_ONLY";
  return result;
}

function createDataCollectionEventS64Test_(userId, priorityResult, options) {
  if (!priorityResult || !priorityResult.collection_type) {
    throw new Error("Priority result with collection_type is required");
  }
  const config = options || {};
  const mode = resolveDataCollectionModeS64Test_(config.mode || DATA_COLLECTION_S64_CONFIG.DATA_COLLECTION_MODE);
  if (mode === "OFF") throw new Error("DATA_COLLECTION_MODE_OFF");
  const createdAt = normalizeTimestampS64Test_(config.created_at || new Date());
  const eventId = "collection-s64-" + digestHexDq_(stableStringifyS63Test_({
    user_id: String(userId),
    collection_type: priorityResult.collection_type,
    requested_fields: priorityResult.requested_fields,
    created_at: createdAt,
    mode: mode
  })).slice(0, 16);
  return {
    event_id: eventId,
    user_id: String(userId),
    collection_type: priorityResult.collection_type,
    requested_fields: priorityResult.requested_fields.slice(),
    reason: priorityResult.reason,
    priority: priorityResult.information_value,
    created_at: createdAt,
    status: "CREATED",
    mode: mode,
    visibility: "INTERNAL_ONLY",
    presentation_performed: false,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function transitionDataCollectionEventS64Test_(event, nextStatus, options) {
  if (!event || !event.event_id) throw new Error("DATA_COLLECTION_EVENT is required");
  const allowed = {
    CREATED: ["PRESENTED", "EXPIRED", "CANCELLED"],
    PRESENTED: ["COMPLETED", "EXPIRED", "CANCELLED"],
    COMPLETED: [], EXPIRED: [], CANCELLED: []
  };
  const target = String(nextStatus || "").toUpperCase();
  if (event.status === target) return deepCloneDq_(event);
  if ((allowed[event.status] || []).indexOf(target) < 0) {
    throw new Error("INVALID_COLLECTION_EVENT_TRANSITION: " + event.status + " -> " + target);
  }
  const result = deepCloneDq_(event);
  result.status = target;
  result.updated_at = normalizeTimestampS64Test_((options || {}).updated_at || new Date());
  result.presentation_performed = target === "PRESENTED" ? true : result.presentation_performed;
  result.write_performed = false;
  return result;
}

function buildDataReadinessEvolutionS64Test_(readinessReport, priorityResult) {
  if (!readinessReport || readinessReport.report_type !== "DATA_READINESS_REPORT") {
    throw new Error("DATA_READINESS_REPORT is required");
  }
  const currentScore = readinessReport.overall_readiness_score;
  const domainKey = priorityResult && priorityResult.domain ? priorityResult.domain.toLowerCase() : null;
  const currentDomainScore = domainKey && readinessReport.domains[domainKey]
    ? readinessReport.domains[domainKey].score
    : null;
  const potentialDomainScore = calculatePotentialDomainScoreS64Test_(priorityResult, readinessReport, currentDomainScore);
  const potentialScore = currentDomainScore === null
    ? currentScore
    : roundDq_(currentScore + (potentialDomainScore - currentDomainScore) / 5, 1);
  const result = deepCloneDq_(readinessReport);
  result.schema_version = "DATA_READINESS_S64_SHADOW_1";
  result.mode = DATA_COLLECTION_S64_CONFIG.DATA_COLLECTION_MODE;
  result.current_score = currentScore;
  result.current_readiness = currentScore;
  result.potential_score = potentialScore;
  result.potential_after_collection = potentialScore;
  result.next_best_data_action = priorityResult ? priorityResult.collection_type : null;
  result.next_best_data_action_details = priorityResult ? {
    reason: priorityResult.reason,
    confidence: priorityResult.confidence,
    requested_fields: priorityResult.requested_fields.slice(),
    single_event_assumption: true
  } : null;
  result.ready_for_decision_engine = false;
  result.decision_engine_created = false;
  result.recommendation_engine_created = false;
  result.storage = "IN_MEMORY_ONLY";
  result.write_performed = false;
  return result;
}

function resolveDataCollectionModeS64Test_(modeValue) {
  const mode = String(modeValue || "").toUpperCase();
  if (DATA_COLLECTION_S64_CONFIG.MODES.indexOf(mode) < 0) {
    throw new Error("UNKNOWN_DATA_COLLECTION_MODE: " + mode);
  }
  if (mode === "ACTIVE" && DATA_COLLECTION_S64_CONFIG.ACTIVE_ENABLED !== true) {
    throw new Error("ACTIVE_DATA_COLLECTION_MODE_FORBIDDEN");
  }
  return mode;
}

function normalizeReadinessInputS64Test_(input) {
  if (input && input.domains) {
    return {
      BODY: normalizeDomainStateS64Test_(input.domains.body),
      TRAINING: normalizeDomainStateS64Test_(input.domains.training),
      NUTRITION: normalizeDomainStateS64Test_(input.domains.nutrition),
      RECOVERY: normalizeDomainStateS64Test_(input.domains.recovery),
      GOAL: normalizeDomainStateS64Test_(input.domains.goal)
    };
  }
  const source = input || {};
  return {
    BODY: {score: numericScoreS64Test_(source.body_score), status: numericScoreS64Test_(source.body_score) === 0 ? "NO_DATA" : "NOT_READY"},
    TRAINING: {score: numericScoreS64Test_(source.training_score), status: numericScoreS64Test_(source.training_score) === 0 ? "NO_DATA" : "NOT_READY"},
    NUTRITION: {score: numericScoreS64Test_(source.nutrition_score), status: numericScoreS64Test_(source.nutrition_score) === 0 ? "NO_DATA" : "NOT_READY"},
    RECOVERY: {score: numericScoreS64Test_(source.recovery_score), status: numericScoreS64Test_(source.recovery_score) === 0 ? "NO_DATA" : "NOT_READY"},
    GOAL: {score: numericScoreS64Test_(source.goal_score), status: numericScoreS64Test_(source.goal_score) === 0 ? "NOT_READY" : "READY"}
  };
}

function addPriorityCandidateS64Test_(candidates, normalized, domain, collectionType, valueFunction, confidence) {
  const state = normalized[domain] || {score: 0, status: "NO_DATA"};
  const template = getDataCollectionTemplateS64Test_(collectionType);
  candidates.push({
    domain: domain,
    collection_type: collectionType,
    information_value: Math.max(0, valueFunction(state.score, state.status)),
    confidence: confidence,
    requested_fields: template.fields.map(function(field) { return field.name; }),
    tie_break_order: candidates.length
  });
}

function missingDataItemS64Test_(domain, collectionType, fields, reason, domainState) {
  return {
    domain: domain,
    collection_type: collectionType,
    missing_data: fields.slice(),
    reason: reason,
    domain_score: domainState.score,
    domain_status: domainState.status,
    data_quality_only: true
  };
}

function normalizeDomainStateS64Test_(domain) {
  const source = domain || {};
  return {score: numericScoreS64Test_(source.score), status: source.status || "NO_DATA"};
}

function numericScoreS64Test_(value) {
  const number = Number(value);
  return isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

function calculatePotentialDomainScoreS64Test_(priorityResult, report, currentScore) {
  if (!priorityResult || currentScore === null) return currentScore;
  if (priorityResult.collection_type === "RECOVERY_CHECKIN") {
    return roundDq_(Math.min(100, currentScore + 100 / DATA_READINESS_S63_CONFIG.RECOVERY_MIN_CHECKINS), 1);
  }
  if (priorityResult.collection_type === "BODY_WEIGHT_COLLECTION") {
    return roundDq_(Math.min(100, currentScore + 100 / DATA_READINESS_S63_CONFIG.BODY_MIN_MEASUREMENTS), 1);
  }
  if (priorityResult.collection_type === "NUTRITION_LOG_COLLECTION") {
    return roundDq_(Math.min(100, currentScore + 100 / 14), 1);
  }
  if (priorityResult.collection_type === "GOAL_CONFIRMATION") return 100;
  if (priorityResult.collection_type === "WORKOUT_DATA_COLLECTION") {
    const evidence = report.domains.training.evidence || {};
    const total = Number(evidence.total_records) || 0;
    const dated = Number(evidence.dated_records) || 0;
    return total ? roundDq_(Math.min(100, (dated + 1) / total * 100), 1) : currentScore;
  }
  return currentScore;
}

function normalizeTimestampS64Test_(value) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (isNaN(date.getTime())) throw new Error("Invalid timestamp");
  return Utilities.formatDate(date, Session.getScriptTimeZone() || "Europe/Moscow", "yyyy-MM-dd'T'HH:mm:ssXXX");
}
