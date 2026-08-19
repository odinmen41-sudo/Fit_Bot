/**
 * Sprint 6.3 — TEST-ONLY Goal V2 finalization and Workout acquisition audit.
 * No goal is persisted and no historical workout row is changed or migrated.
 */
const GOAL_WORKOUT_ACQUISITION_S63_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  PRODUCTION_WRITES_ENABLED: false,
  GOAL_SCHEMA_VERSION: "GOAL_V2_S63_TEST_1",
  WORKOUT_REPORT_VERSION: "WORKOUT_DATA_QUALITY_S63_TEST_1",
  MEMORY_IS_AUTHORITATIVE: false
});

function createGoalV2FinalizationS63Test_(userId, userInput, options) {
  const config = options || {};
  const source = config.source === "AI_MEMORY" ? "AI_MEMORY_NON_AUTHORITATIVE" : "EXPLICIT_USER_INPUT";
  const raw = String(userInput || "").trim();
  const explicit = source === "EXPLICIT_USER_INPUT" ? parseGoalV2FieldsS63Test_(raw, config) : {};
  const memoryCandidate = source === "AI_MEMORY_NON_AUTHORITATIVE"
    ? getMemoryGoalCandidateS63Test_(userId, config.spreadsheet_repository || config.repository)
    : null;
  const targetCandidate = source === "EXPLICIT_USER_INPUT" ? explicit.target_weight : null;
  const currentWeight = source === "EXPLICIT_USER_INPUT" ? explicit.current_weight : null;
  const startDate = source === "EXPLICIT_USER_INPUT" ? explicit.start_date : null;
  const horizon = source === "EXPLICIT_USER_INPUT" ? explicit.desired_horizon : null;
  const milestones = source === "EXPLICIT_USER_INPUT" ? explicit.milestones : [];

  const required = {
    current_weight: currentWeight,
    target_weight: targetCandidate,
    start_date: startDate,
    desired_horizon: horizon
  };
  const missing = Object.keys(required).filter(function(key) {
    return required[key] === null || required[key] === undefined;
  });
  const proposalHash = digestHexDq_(stableStringifyS63Test_({
    user_id: String(userId),
    source: source,
    raw: raw,
    required: required,
    milestones: milestones,
    memory: memoryCandidate
  }));

  return {
    goal_id: "goal-v2-s63-" + proposalHash.slice(0, 16),
    schema_version: GOAL_WORKOUT_ACQUISITION_S63_CONFIG.GOAL_SCHEMA_VERSION,
    user_id: String(userId),
    goal_type: "WEIGHT_LOSS",
    current_weight: currentWeight,
    target_weight: targetCandidate,
    start_date: startDate,
    desired_horizon: horizon,
    milestones: milestones,
    memory_candidate: memoryCandidate,
    source: source,
    source_priority: source === "EXPLICIT_USER_INPUT" ? 2 : 1,
    status: "PENDING_CONFIRMATION",
    confirmation_status: "PENDING_CONFIRMATION",
    completeness_flag: missing.length === 0 ? "COMPLETE" : "PARTIAL",
    missing_fields: missing,
    confidence: source === "EXPLICIT_USER_INPUT" ? (missing.length ? 0.75 : 0.99) : 0.25,
    canonical: false,
    source_fact: false,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function confirmGoalV2FinalizationS63Test_(proposal, confirmation, options) {
  if (!proposal || proposal.status !== "PENDING_CONFIRMATION") {
    throw new Error("PENDING_CONFIRMATION GOAL_V2 proposal is required");
  }
  const result = deepCloneDq_(proposal);
  const intent = detectGoalConfirmationIntentTest_(confirmation);
  if (intent === "REJECT") {
    result.status = "CANCELLED";
    result.confirmation_status = "REJECTED";
    result.canonical = false;
    result.source_fact = false;
    result.write_performed = false;
    return result;
  }
  if (intent !== "CONFIRM") {
    result.error = "EXPLICIT_CONFIRMATION_REQUIRED";
    result.write_performed = false;
    return result;
  }
  if (result.source !== "EXPLICIT_USER_INPUT") {
    result.error = "AI_MEMORY_CANNOT_BE_CONFIRMED_AS_SOURCE_FACT";
    result.confirmation_status = "PENDING_CONFIRMATION";
    result.canonical = false;
    result.source_fact = false;
    result.write_performed = false;
    return result;
  }
  if (result.completeness_flag !== "COMPLETE") {
    result.error = "GOAL_FIELDS_INCOMPLETE";
    result.write_performed = false;
    return result;
  }

  const config = options || {};
  result.status = "CONFIRMED";
  result.confirmation_status = "CONFIRMED";
  result.source = "EXPLICIT_USER_INPUT_CONFIRMED";
  result.source_priority = 3;
  result.confidence = 1;
  result.canonical = true;
  result.source_fact = true;
  result.confirmed_at = String(config.confirmed_at || result.start_date + "T12:00:00+03:00");
  if (result.memory_candidate) {
    result.memory_candidate.status = "SUPERSEDED_AS_CANDIDATE";
    result.memory_candidate.canonical = false;
    result.memory_candidate.source_fact = false;
  }
  result.storage = "IN_MEMORY_ONLY";
  result.write_performed = false;
  return result;
}

function getMemoryGoalCandidateS63Test_(userId, repository) {
  const memory = readTableDq_("AI_MEMORY", repository);
  const indexes = resolveHeaderIndexesDq_(memory.headers, {
    userId: ["user_id"], category: ["category"], key: ["key"], value: ["value"], updatedAt: ["updated_at"]
  });
  const row = memory.rows.filter(function(item) {
    return String(getCellDq_(item, indexes.userId)) === String(userId) &&
      normalizeTextDq_(getCellDq_(item, indexes.category)) === "goal" &&
      normalizeTextDq_(getCellDq_(item, indexes.key)) === "target_weight";
  })[0];
  if (!row) return null;
  return {
    field: "target_weight",
    value: getCellDq_(row, indexes.value),
    updated_at: getCellDq_(row, indexes.updatedAt),
    source: "AI_MEMORY_NON_AUTHORITATIVE",
    status: "PENDING_CONFIRMATION",
    confidence: 0.25,
    canonical: false,
    source_fact: false,
    allowed_action: "PROPOSE_EXPLICIT_USER_CONFIRMATION"
  };
}

function parseGoalV2FieldsS63Test_(message, options) {
  const config = options || {};
  const text = String(message || "").toLowerCase().replace(/ё/g, "е").replace(/,/g, ".");
  const currentMatch = text.match(/(?:текущий\s+вес|сейчас\s+вешу)\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)/i);
  const targetMatch = text.match(/(?:цель|целевой\s+вес|хочу\s+(?:весить\s+)?|снизить\s+до)\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)/i);
  const startMatch = text.match(/(?:дата\s+старта|начинаю|старт)\s*[:=-]?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}|\d{4}-\d{1,2}-\d{1,2})/i);
  const horizonMatch = text.match(/(?:горизонт|срок|за)\s*[:=-]?\s*(\d+)\s*(месяц(?:а|ев)?|недел(?:я|и|ь)|дн(?:я|ей)?)/i);
  const milestoneMatch = text.match(/(?:этапы|milestones?)\s*[:=-]?\s*([\d.,;\s]+)/i);
  const milestones = [];
  if (milestoneMatch) {
    milestoneMatch[1].split(/[;\s]+/).forEach(function(token) {
      const value = Number(String(token).replace(",", "."));
      if (isFinite(value) && value >= 35 && value <= 350 && milestones.indexOf(value) < 0) {
        milestones.push(value);
      }
    });
  }
  return {
    current_weight: currentMatch ? Number(currentMatch[1]) : parseNumberDq_(config.current_weight),
    target_weight: targetMatch ? Number(targetMatch[1]) : parseNumberDq_(config.target_weight),
    start_date: normalizeDateS63Test_(startMatch ? startMatch[1] : config.start_date),
    desired_horizon: horizonMatch ? {
      value: Number(horizonMatch[1]),
      unit: normalizeHorizonUnitS63Test_(horizonMatch[2]),
      source: "EXPLICIT_USER_INPUT",
      confidence: 0.99
    } : (config.desired_horizon || null),
    milestones: milestones.map(function(weight, index) {
      return {
        sequence: index + 1,
        target_weight: weight,
        status: "PLANNED",
        source: "EXPLICIT_USER_INPUT",
        confidence: 0.99
      };
    })
  };
}

function buildWorkoutDataQualityReportS63Test_(repository) {
  const table = readTableDq_("Workout_Log", repository);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"],
    trainingType: ["Тип тренировки", "training_type"],
    exercise: ["Упражнение", "exercise"],
    weight: ["Вес", "weight"],
    sets: ["Подходы", "sets"],
    reps: ["Повторы", "reps"],
    rpe: ["RPE", "rpe"],
    pain: ["Боль/ограничения", "pain"]
  });
  const missing = {date: 0, training_type: 0, exercise: 0, weight: 0, sets: 0, reps: 0, rpe: 0};
  const rows = table.rows.map(function(row, index) {
    const values = {
      date: normalizeDateS63Test_(getCellDq_(row, indexes.date)),
      training_type: getCellDq_(row, indexes.trainingType),
      exercise: getCellDq_(row, indexes.exercise),
      weight: getCellDq_(row, indexes.weight),
      sets: parseNumberDq_(getCellDq_(row, indexes.sets)),
      reps: getCellDq_(row, indexes.reps),
      rpe: parseNumberDq_(getCellDq_(row, indexes.rpe)),
      pain: getCellDq_(row, indexes.pain)
    };
    Object.keys(missing).forEach(function(field) {
      if (!isPresentDq_(values[field])) missing[field] += 1;
    });
    const coreExceptDate = isPresentDq_(values.training_type) && isPresentDq_(values.exercise) &&
      isPresentDq_(values.sets) && isPresentDq_(values.reps);
    const ready = isPresentDq_(values.date) && coreExceptDate;
    return {
      source_row: index + 2,
      values: values,
      status: ready ? "READY_FOR_FUTURE_NORMALIZATION" :
        (!values.date && coreExceptDate ? "READY_AFTER_DATE_CONFIRMATION" : "INCOMPLETE"),
      write_performed: false
    };
  });
  const readyRows = rows.filter(function(row) { return row.status === "READY_FOR_FUTURE_NORMALIZATION"; });
  const dateConfirmationRows = rows.filter(function(row) { return row.status === "READY_AFTER_DATE_CONFIRMATION"; });
  const sessionPreview = buildWorkoutSessionMappingPreviewS63Test_(readyRows);
  const setPreview = buildExerciseSetMappingPreviewS63Test_(readyRows);

  return {
    schema_version: GOAL_WORKOUT_ACQUISITION_S63_CONFIG.WORKOUT_REPORT_VERSION,
    source_sheet: "Workout_Log",
    total_records: rows.length,
    dated_records: rows.length - missing.date,
    records_without_date: missing.date,
    missing_fields: missing,
    ready_for_future_normalization: readyRows.length,
    ready_after_date_confirmation: dateConfirmationRows.length,
    incomplete_records: rows.length - readyRows.length - dateConfirmationRows.length,
    temporal_coverage: rows.length ? roundDq_((rows.length - missing.date) / rows.length, 3) : 0,
    mapping_contract: {
      WORKOUT_SESSIONS: ["session_id", "user_id", "session_date", "training_type", "source_rows", "quality", "lineage"],
      EXERCISE_SETS: ["set_id", "session_id", "exercise", "set_number", "weight", "reps", "rpe", "source_row", "quality", "lineage"]
    },
    mapping_preview: {
      workout_sessions: sessionPreview,
      exercise_sets: setPreview
    },
    migration_performed: false,
    write_performed: false,
    rows: rows
  };
}

function buildWorkoutSessionMappingPreviewS63Test_(readyRows) {
  const sessions = {};
  readyRows.forEach(function(row) {
    const key = row.values.date + "|" + String(row.values.training_type);
    if (!sessions[key]) {
      sessions[key] = {
        session_id: "preview-session-" + digestHexDq_(key).slice(0, 12),
        user_id: "132976932",
        session_date: row.values.date,
        training_type: row.values.training_type,
        source_rows: [],
        quality: "MAPPABLE",
        lineage: {source_sheet: "Workout_Log"},
        preview_only: true
      };
    }
    sessions[key].source_rows.push(row.source_row);
  });
  return Object.keys(sessions).sort().map(function(key) { return sessions[key]; });
}

function buildExerciseSetMappingPreviewS63Test_(readyRows) {
  const preview = [];
  readyRows.forEach(function(row) {
    const sessionKey = row.values.date + "|" + String(row.values.training_type);
    const sessionId = "preview-session-" + digestHexDq_(sessionKey).slice(0, 12);
    const weights = splitSeriesS63Test_(row.values.weight);
    const reps = splitSeriesS63Test_(row.values.reps);
    const setCount = row.values.sets || Math.max(weights.length, reps.length);
    for (let i = 0; i < setCount; i += 1) {
      preview.push({
        set_id: "preview-set-" + digestHexDq_([row.source_row, i + 1].join("|")).slice(0, 12),
        session_id: sessionId,
        exercise: row.values.exercise,
        set_number: i + 1,
        weight: weights[i] !== undefined ? weights[i] : null,
        reps: reps[i] !== undefined ? reps[i] : null,
        rpe: row.values.rpe,
        source_row: row.source_row,
        quality: "MAPPING_PREVIEW",
        lineage: {source_sheet: "Workout_Log", source_row: row.source_row},
        preview_only: true
      });
    }
  });
  return preview;
}

function splitSeriesS63Test_(value) {
  if (!isPresentDq_(value)) return [];
  return String(value).split("/").map(function(item) { return parseNumberDq_(item); });
}

function normalizeHorizonUnitS63Test_(value) {
  const text = normalizeTextDq_(value);
  if (text.indexOf("месяц") === 0) return "MONTHS";
  if (text.indexOf("недел") === 0) return "WEEKS";
  return "DAYS";
}
