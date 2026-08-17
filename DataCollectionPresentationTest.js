/**
 * Sprint 6.5 — Controlled Data Collection Presentation (test-only).
 *
 * Produces prompts, in-memory presentation state and candidate observations.
 * It performs no Telegram/Groq calls, recommendations, decisions or writes.
 */
const DATA_COLLECTION_PRESENTATION_S65_CONFIG = Object.freeze({
  DATA_COLLECTION_MODE: "PRESENTATION_TEST",
  MODES: Object.freeze(["OFF", "SHADOW", "PRESENTATION_TEST", "ACTIVE"]),
  ACTIVE_ENABLED: false,
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  LLM_ENABLED: false,
  DECISION_ENGINE_ENABLED: false,
  RECOMMENDATION_ENGINE_ENABLED: false,
  PRODUCTION_VERSION_EXPECTED: 19,
  COOLDOWN_HOURS: Object.freeze({
    RECOVERY_CHECKIN: 20,
    BODY_WEIGHT_COLLECTION: 24,
    NUTRITION_LOG_COLLECTION: 6,
    GOAL_CONFIRMATION: 720,
    WORKOUT_DATA_COLLECTION: 12
  })
});

function buildDataCollectionPromptS65Test_(collectionEvent) {
  if (!collectionEvent || !collectionEvent.collection_type) {
    throw new Error("DATA_COLLECTION_EVENT is required");
  }
  const requested = (collectionEvent.requested_fields || collectionEvent.missing_fields || []).slice();
  const type = collectionEvent.collection_type;
  const lines = [];

  if (type === "RECOVERY_CHECKIN") {
    lines.push("Чтобы заполнить данные о восстановлении, нужны несколько значений.", "", "Как сегодня:");
    appendPromptFieldS65Test_(lines, requested, "sleep_hours", "Сон (часы):");
    appendPromptFieldS65Test_(lines, requested, "sleep_quality", "Качество сна (1–10):");
    appendPromptFieldS65Test_(lines, requested, "energy", "Энергия (1–10):");
    appendPromptFieldS65Test_(lines, requested, "stress", "Стресс (1–10):");
    appendPromptFieldS65Test_(lines, requested, "fatigue", "Усталость (1–10):");
    if (requested.indexOf("pain") >= 0 || requested.indexOf("pain_presence") >= 0) {
      lines.push("Есть ли боль? Если да — где и насколько (1–10):");
    }
  } else if (type === "BODY_WEIGHT_COLLECTION") {
    lines.push("Чтобы дополнить историю измерений, укажи данные:");
    appendPromptFieldS65Test_(lines, requested, "weight", "Вес (кг):");
    appendPromptFieldS65Test_(lines, requested, "date", "Дата измерения:");
    appendPromptFieldS65Test_(lines, requested, "conditions", "Условия измерения, если хочешь уточнить:");
  } else if (type === "NUTRITION_LOG_COLLECTION") {
    lines.push("Чтобы дополнить журнал питания, укажи данные о приёме пищи:");
    appendPromptFieldS65Test_(lines, requested, "meal", "Приём пищи:");
    appendPromptFieldS65Test_(lines, requested, "foods", "Продукты:");
    appendPromptFieldS65Test_(lines, requested, "quantity", "Количество продуктов:");
  } else if (type === "GOAL_CONFIRMATION") {
    lines.push("Чтобы зафиксировать цель как подтверждённые данные, уточни:");
    appendPromptFieldS65Test_(lines, requested, "target_weight", "Целевой вес (кг):");
    appendPromptFieldS65Test_(lines, requested, "deadline", "Желаемый срок или дата:");
  } else if (type === "WORKOUT_DATA_COLLECTION") {
    lines.push("Чтобы дополнить запись тренировки, укажи данные:");
    appendPromptFieldS65Test_(lines, requested, "exercise", "Упражнение:");
    appendPromptFieldS65Test_(lines, requested, "weight", "Вес (кг):");
    appendPromptFieldS65Test_(lines, requested, "sets", "Подходы:");
    appendPromptFieldS65Test_(lines, requested, "reps", "Повторы:");
    appendPromptFieldS65Test_(lines, requested, "date", "Дата тренировки:");
  } else {
    throw new Error("UNSUPPORTED_COLLECTION_TYPE: " + type);
  }

  const prompt = lines.join("\n").trim();
  const safety = validatePresentationPromptSafetyS65Test_(prompt);
  if (!safety.safe) throw new Error("UNSAFE_COLLECTION_PROMPT: " + safety.violations.join(","));
  return {
    collection_type: type,
    requested_fields: requested,
    prompt: prompt,
    purpose: "DATA_COLLECTION_ONLY",
    analysis_present: false,
    decision_present: false,
    recommendation_present: false,
    safety: safety,
    write_performed: false
  };
}

function canPresentDataCollectionRequestS65Test_(collectionEvent, currentState, options) {
  if (!collectionEvent || !collectionEvent.collection_type) {
    return {action: "NO_REQUEST", allowed: false, reason: "NO_COLLECTION_EVENT"};
  }
  const config = options || {};
  const now = parseTimestampS65Test_(config.now || new Date());
  const today = normalizeDateS63Test_(now);
  const observations = config.observations || [];
  if (hasObservationForCollectionTodayS65Test_(collectionEvent.collection_type, observations, today)) {
    return {action: "NO_REQUEST", allowed: false, reason: "DATA_ALREADY_RECEIVED_TODAY"};
  }
  if (currentState && currentState.user_id === String(collectionEvent.user_id) &&
      currentState.last_requested_type === collectionEvent.collection_type) {
    const cooldown = parseTimestampS65Test_(currentState.cooldown_until);
    if (cooldown && now < cooldown && ["REQUESTED", "COMPLETED", "SKIPPED"].indexOf(currentState.status) >= 0) {
      return {
        action: "NO_REQUEST",
        allowed: false,
        reason: currentState.status === "COMPLETED" ? "DATA_ALREADY_RECEIVED" : "COOLDOWN_ACTIVE",
        cooldown_until: currentState.cooldown_until
      };
    }
  }
  return {action: "PRESENT", allowed: true, reason: "ELIGIBLE_FOR_PRESENTATION"};
}

function presentDataCollectionEventS65Test_(collectionEvent, currentState, options) {
  const config = options || {};
  const mode = resolvePresentationModeS65Test_(config.mode || DATA_COLLECTION_PRESENTATION_S65_CONFIG.DATA_COLLECTION_MODE);
  if (mode === "OFF") {
    return {action: "NO_REQUEST", reason: "PRESENTATION_MODE_OFF", event: deepCloneDq_(collectionEvent), state: currentState || null, prompt: null, write_performed: false};
  }
  if (mode === "SHADOW") {
    return {
      action: "SHADOW_ONLY",
      reason: "USER_FLOW_UNCHANGED",
      event: deepCloneDq_(collectionEvent),
      state: currentState || null,
      prompt: buildDataCollectionPromptS65Test_(collectionEvent),
      presented_to_user: false,
      write_performed: false
    };
  }
  const eligibility = canPresentDataCollectionRequestS65Test_(collectionEvent, currentState, config);
  if (!eligibility.allowed) {
    return {action: "NO_REQUEST", reason: eligibility.reason, event: deepCloneDq_(collectionEvent), state: currentState || null, prompt: null, write_performed: false};
  }

  const now = parseTimestampS65Test_(config.now || new Date());
  const presentedEvent = transitionCollectionEventS65Test_(collectionEvent, "PRESENTED", {updated_at: now});
  const cooldownHours = DATA_COLLECTION_PRESENTATION_S65_CONFIG.COOLDOWN_HOURS[collectionEvent.collection_type] || 24;
  const state = {
    user_id: String(collectionEvent.user_id),
    last_requested_type: collectionEvent.collection_type,
    requested_at: normalizeTimestampS64Test_(now),
    completed_at: null,
    cooldown_until: normalizeTimestampS64Test_(new Date(now.getTime() + cooldownHours * 3600000)),
    status: "REQUESTED",
    mode: mode,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
  return {
    action: "PRESENT",
    reason: eligibility.reason,
    event: presentedEvent,
    state: state,
    prompt: buildDataCollectionPromptS65Test_(presentedEvent),
    presented_to_user: true,
    transport: "TEST_HARNESS_ONLY",
    write_performed: false
  };
}

function processDataCollectionResponseS65Test_(collectionEvent, collectionState, responseText, options) {
  if (!collectionEvent || collectionEvent.status !== "PRESENTED") {
    throw new Error("PRESENTED collection event is required");
  }
  if (!collectionState || collectionState.status !== "REQUESTED") {
    throw new Error("REQUESTED DATA_COLLECTION_STATE is required");
  }
  const config = options || {};
  resolvePresentationModeS65Test_(config.mode || DATA_COLLECTION_PRESENTATION_S65_CONFIG.DATA_COLLECTION_MODE);
  const raw = String(responseText || "").trim();
  const now = parseTimestampS65Test_(config.now || new Date());
  const refusal = detectCollectionRefusalS65Test_(raw);

  if (refusal) {
    const skippedEvent = transitionCollectionEventS65Test_(collectionEvent, "SKIPPED", {updated_at: now});
    const skippedState = deepCloneDq_(collectionState);
    skippedState.status = "SKIPPED";
    skippedState.completed_at = normalizeTimestampS64Test_(now);
    skippedState.write_performed = false;
    return {
      action: "SKIPPED",
      event: skippedEvent,
      state: skippedState,
      candidate_observation: null,
      acknowledgement: "Хорошо, запрос пропущен.",
      decision_objects: [],
      recommendation_objects: [],
      negative_inference: null,
      write_performed: false
    };
  }

  const candidate = buildCollectionCandidateS65Test_(collectionEvent, raw, {
    observed_date: config.observed_date || normalizeDateS63Test_(now),
    user_id: collectionEvent.user_id
  });
  const completedEvent = transitionCollectionEventS65Test_(collectionEvent, "COMPLETED", {updated_at: now});
  const completedState = deepCloneDq_(collectionState);
  completedState.status = "COMPLETED";
  completedState.completed_at = normalizeTimestampS64Test_(now);
  completedState.write_performed = false;
  return {
    action: "CANDIDATE_CREATED",
    event: completedEvent,
    state: completedState,
    candidate_observation: candidate,
    acknowledgement: "Спасибо, данные приняты как candidate observation.",
    decision_objects: [],
    recommendation_objects: [],
    analysis: null,
    write_performed: false
  };
}

function expireDataCollectionStateS65Test_(collectionEvent, collectionState, options) {
  if (!collectionEvent || collectionEvent.status !== "PRESENTED") {
    throw new Error("PRESENTED collection event is required");
  }
  if (!collectionState || collectionState.status !== "REQUESTED") {
    throw new Error("REQUESTED DATA_COLLECTION_STATE is required");
  }
  const now = parseTimestampS65Test_((options || {}).now || new Date());
  const cooldownUntil = parseTimestampS65Test_(collectionState.cooldown_until);
  if (now < cooldownUntil) {
    return {
      action: "NOT_EXPIRED",
      event: deepCloneDq_(collectionEvent),
      state: deepCloneDq_(collectionState),
      write_performed: false
    };
  }
  const expiredEvent = transitionCollectionEventS65Test_(collectionEvent, "EXPIRED", {updated_at: now});
  const expiredState = deepCloneDq_(collectionState);
  expiredState.status = "EXPIRED";
  expiredState.expired_at = normalizeTimestampS64Test_(now);
  expiredState.write_performed = false;
  return {
    action: "EXPIRED",
    event: expiredEvent,
    state: expiredState,
    write_performed: false
  };
}

function transitionCollectionEventS65Test_(event, nextStatus, options) {
  if (!event || !event.event_id) throw new Error("DATA_COLLECTION_EVENT is required");
  const allowed = {
    CREATED: ["PRESENTED", "EXPIRED"],
    PRESENTED: ["COMPLETED", "SKIPPED", "EXPIRED"],
    COMPLETED: [], SKIPPED: [], EXPIRED: []
  };
  const target = String(nextStatus || "").toUpperCase();
  if (event.status === target) return deepCloneDq_(event);
  if ((allowed[event.status] || []).indexOf(target) < 0) {
    throw new Error("INVALID_S65_EVENT_TRANSITION: " + event.status + " -> " + target);
  }
  const result = deepCloneDq_(event);
  result.status = target;
  result.updated_at = normalizeTimestampS64Test_((options || {}).updated_at || new Date());
  result.presentation_performed = target === "PRESENTED" ? true : result.presentation_performed;
  result.presented_to_user = target === "PRESENTED" ? true : result.presented_to_user;
  result.write_performed = false;
  return result;
}

function buildCollectionCandidateS65Test_(event, raw, options) {
  const config = options || {};
  const candidateId = "candidate-s65-" + digestHexDq_(stableStringifyS63Test_({
    event_id: event.event_id,
    raw: raw,
    observed_date: config.observed_date
  })).slice(0, 16);
  let payload = null;
  let candidateType = null;
  let status = "PENDING_VALIDATION";

  if (event.collection_type === "RECOVERY_CHECKIN") {
    payload = parseRecoveryCheckinS63Test_(raw, {observed_date: config.observed_date});
    candidateType = "RECOVERY_OBSERVATION_CANDIDATE";
  } else if (event.collection_type === "GOAL_CONFIRMATION") {
    payload = parseGoalResponseCandidateS65Test_(raw);
    candidateType = "GOAL_V2_CANDIDATE";
    status = "PENDING_CONFIRMATION";
  } else if (event.collection_type === "BODY_WEIGHT_COLLECTION") {
    payload = {
      weight: parseNumberDq_(raw),
      date: config.observed_date,
      raw_user_input: raw,
      source: "EXPLICIT_USER_INPUT"
    };
    candidateType = "BODY_OBSERVATION_CANDIDATE";
  } else if (event.collection_type === "NUTRITION_LOG_COLLECTION") {
    payload = extractNutritionAcquisitionS63Test_(raw, {meal_date: config.observed_date});
    candidateType = "NUTRITION_OBSERVATION_CANDIDATE";
  } else if (event.collection_type === "WORKOUT_DATA_COLLECTION") {
    payload = {raw_user_input: raw, source: "EXPLICIT_USER_INPUT", observed_date: config.observed_date};
    candidateType = "WORKOUT_OBSERVATION_CANDIDATE";
  } else {
    throw new Error("UNSUPPORTED_COLLECTION_TYPE: " + event.collection_type);
  }

  return {
    candidate_id: candidateId,
    candidate_type: candidateType,
    user_id: String(config.user_id),
    collection_event_id: event.event_id,
    status: status,
    payload: payload,
    source: "EXPLICIT_USER_INPUT",
    canonical: false,
    source_fact: false,
    decision_objects: [],
    recommendation_objects: [],
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function parseGoalResponseCandidateS65Test_(text) {
  const raw = String(text || "").trim();
  const normalized = raw.toLowerCase().replace(/ё/g, "е").replace(/,/g, ".");
  const targetMatch = normalized.match(/(?:хочу|цель|до)\D{0,20}(\d{2,3}(?:\.\d+)?)\s*кг/i);
  const deadlineMatch = normalized.match(/(?:к|до)\s+([а-я]+|\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/i);
  return {
    target_weight: targetMatch ? Number(targetMatch[1]) : null,
    deadline_text: deadlineMatch ? deadlineMatch[1] : null,
    status: "PENDING_CONFIRMATION",
    source: "EXPLICIT_USER_INPUT",
    confidence: targetMatch ? 0.98 : 0.5,
    missing_fields: [
      targetMatch ? null : "target_weight",
      deadlineMatch ? null : "deadline"
    ].filter(function(value) { return value !== null; }),
    raw_user_input: raw,
    canonical: false,
    write_performed: false
  };
}

function hasObservationForCollectionTodayS65Test_(collectionType, observations, today) {
  return observations.some(function(observation) {
    const observationType = observation.collection_type || observation.observation_type || observation.candidate_type;
    const date = observation.observed_date || (observation.payload && (observation.payload.observed_date || observation.payload.date));
    const sameType = collectionType === "RECOVERY_CHECKIN"
      ? ["RECOVERY_CHECKIN", "RECOVERY_OBSERVATION_CANDIDATE"].indexOf(observationType) >= 0
      : observationType === collectionType;
    return sameType && normalizeDateS63Test_(date) === today;
  });
}

function validatePresentationPromptSafetyS65Test_(prompt) {
  const normalized = normalizeTextDq_(prompt);
  const forbidden = [
    "ты устал", "тебе нужен отдых", "тебе нужно отдохнуть", "увеличь вес",
    "снизь калории", "делай разгрузку", "рекомендую", "советую", "вывод"
  ];
  const violations = forbidden.filter(function(phrase) { return normalized.indexOf(phrase) >= 0; });
  return {safe: violations.length === 0, violations: violations};
}

function detectCollectionRefusalS65Test_(text) {
  const normalized = normalizeTextDq_(text).replace(/[.!?]+$/g, "");
  return ["не хочу", "не буду", "пропустить", "пропусти", "отказ", "позже"].indexOf(normalized) >= 0;
}

function appendPromptFieldS65Test_(lines, requested, field, label) {
  if (requested.indexOf(field) >= 0) lines.push(label);
}

function resolvePresentationModeS65Test_(modeValue) {
  const mode = String(modeValue || "").toUpperCase();
  if (DATA_COLLECTION_PRESENTATION_S65_CONFIG.MODES.indexOf(mode) < 0) {
    throw new Error("UNKNOWN_PRESENTATION_MODE: " + mode);
  }
  if (mode === "ACTIVE" && DATA_COLLECTION_PRESENTATION_S65_CONFIG.ACTIVE_ENABLED !== true) {
    throw new Error("ACTIVE_PRESENTATION_MODE_FORBIDDEN");
  }
  return mode;
}

function parseTimestampS65Test_(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (isNaN(date.getTime())) throw new Error("Invalid timestamp");
  return date;
}
