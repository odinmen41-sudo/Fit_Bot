/**
 * Sprint 6.1 — TEST-ONLY Digital Twin Snapshot Builder.
 *
 * Safety guarantees:
 * - read-only access to existing spreadsheet data;
 * - no Telegram, Groq, webhook or production pipeline calls;
 * - no writes to sheets, properties or AI_MEMORY;
 * - no decisions, recommendations or actions;
 * - AI_MEMORY is inspected only for conflict reporting and is never mapped as a source fact.
 */
const DIGITAL_TWIN_TEST_CONFIG = Object.freeze({
  ALGORITHM_VERSION: "digital-twin-snapshot-test-v1.0",
  SNAPSHOT_PREFIX: "dts-test-",
  TIMEZONE: "Europe/Moscow",
  BODY_MIN_WEIGHTS_FOR_TREND: 8,
  NUTRITION_WINDOW_DAYS: 14,
  MAX_STATE_SOURCE_IDS: 80,
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_ENABLED: false,
  GROQ_ENABLED: false,
  MEMORY_AS_SOURCE_FACT: false,
  SHEETS: Object.freeze({
    PROFILE: "User_Profile",
    BODY: "Body_Tracking",
    WORKOUT: "Workout_Log",
    NUTRITION: "Nutrition_Log",
    RECOVERY: "Recovery_Log",
    MEMORY: "AI_MEMORY",
    BOT_INPUT: "Bot_Input"
  }),
  HEADERS: Object.freeze({
    User_Profile: Object.freeze([
      "User_ID", "Имя", "Возраст", "Рост", "Вес старт", "Текущий вес",
      "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"
    ]),
    Body_Tracking: Object.freeze([
      "Дата", "Вес", "Процент жира", "Талия", "Грудь", "Рука", "Бедро", "Шаги", "Комментарий"
    ]),
    Workout_Log: Object.freeze([
      "Дата", "Тип тренировки", "Упражнение", "Вес", "Подходы", "Повторы", "RPE",
      "Боль/ограничения", "Комментарий"
    ]),
    Nutrition_Log: Object.freeze([
      "Дата", "Приём пищи", "Время", "Описание", "Ккал", "Белок", "Жиры", "Углеводы", "Фото"
    ]),
    Recovery_Log: Object.freeze([
      "Дата", "Сон часы", "Качество сна", "Стресс", "Усталость", "Боль плечо",
      "Боль поясница", "Давление", "Энергия", "Боль другая/локализация", "Комментарий"
    ]),
    AI_MEMORY: Object.freeze([
      "id", "user_id", "category", "key", "value", "priority", "updated_at"
    ]),
    Bot_Input: Object.freeze([
      "Дата", "User_ID", "Источник", "Сообщение", "Тип данных", "Обработано"
    ])
  })
});

/**
 * Build a read-only Digital Twin snapshot.
 * Public contract requires userId; optional options.as_of exists only for deterministic tests.
 */
function buildDigitalTwinSnapshotTest_(userId, options) {
  const normalizedUserId = String(userId == null ? "" : userId).trim();
  if (!normalizedUserId) throw new Error("DIGITAL_TWIN_USER_ID_REQUIRED");

  const opts = options || {};
  const asOf = dtParseDateTime_(opts.as_of) || new Date();
  const mapped = mapExistingDataToObservations_(normalizedUserId, {as_of: asOf});
  const context = {
    user_id: normalizedUserId,
    as_of: asOf,
    profile: mapped.profile,
    memory_index: mapped.memory_index,
    behavior_inputs: mapped.behavior_inputs,
    mapping_report: mapped.mapping_report
  };

  const bodyState = buildBodyState_(mapped.observations, context);
  const trainingState = buildTrainingState_(mapped.observations, context);
  const nutritionState = buildNutritionState_(mapped.observations, context);
  const recoveryState = buildRecoveryState_(mapped.observations, context);
  context.body_state = bodyState;
  const goalState = buildGoalState_(mapped.observations, context);
  const behaviorState = buildBehaviorState_(mapped.observations, context);
  const states = {
    body_state: bodyState,
    training_state: trainingState,
    nutrition_state: nutritionState,
    recovery_state: recoveryState,
    goal_state: goalState,
    behavior_state: behaviorState
  };
  const qualityReport = calculateSnapshotQuality_(states, context);
  const sourceIds = dtUniqueSorted_([].concat(
    bodyState.source_ids,
    trainingState.source_ids,
    nutritionState.source_ids,
    recoveryState.source_ids,
    goalState.source_ids,
    behaviorState.source_ids
  ));
  const missingData = dtUniqueSorted_([].concat(
    bodyState.missing_data.map(function(item) { return "body." + item; }),
    trainingState.missing_data.map(function(item) { return "training." + item; }),
    nutritionState.missing_data.map(function(item) { return "nutrition." + item; }),
    recoveryState.missing_data.map(function(item) { return "recovery." + item; }),
    goalState.missing_data.map(function(item) { return "goal." + item; }),
    behaviorState.missing_data.map(function(item) { return "behavior." + item; })
  ));
  const snapshotCore = {
    user_id: normalizedUserId,
    as_of: dtIso_(asOf),
    body_state: bodyState,
    training_state: trainingState,
    nutrition_state: nutritionState,
    recovery_state: recoveryState,
    goal_state: goalState,
    behavior_state: behaviorState,
    confidence: qualityReport.confidence,
    quality: {
      score: qualityReport.quality_score,
      flags: qualityReport.flags
    },
    freshness: qualityReport.freshness,
    source_ids: sourceIds,
    missing_data: missingData,
    algorithm_version: DIGITAL_TWIN_TEST_CONFIG.ALGORITHM_VERSION
  };
  const snapshotId = DIGITAL_TWIN_TEST_CONFIG.SNAPSHOT_PREFIX +
    dtHash_(dtStableStringify_(snapshotCore)).slice(0, 20);

  const snapshot = {snapshot_id: snapshotId};
  Object.keys(snapshotCore).forEach(function(key) { snapshot[key] = snapshotCore[key]; });
  return snapshot;
}

/**
 * Read existing sources and normalize them as observations.
 * AI_MEMORY is returned as comparison context only and never creates an observation.
 */
function mapExistingDataToObservations_(userId, options) {
  const opts = options || {};
  const asOf = dtParseDateTime_(opts.as_of) || new Date();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const observations = [];

  const profileRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.PROFILE);
  const bodyRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.BODY);
  const workoutRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.WORKOUT);
  const nutritionRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.NUTRITION);
  const recoveryRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.RECOVERY);
  const memoryRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.MEMORY);
  const botRows = dtReadSheet_(spreadsheet, DIGITAL_TWIN_TEST_CONFIG.SHEETS.BOT_INPUT);

  const profile = profileRows.filter(function(row) {
    return String(row["User_ID"]) === String(userId);
  })[0] || null;
  if (!profile) throw new Error("DIGITAL_TWIN_PROFILE_NOT_FOUND:" + userId);

  dtMapStableProfileFacts_(observations, profile, userId);
  dtMapBodyObservations_(observations, bodyRows, userId);
  dtMapWorkoutObservations_(observations, workoutRows, userId);
  dtMapNutritionObservations_(observations, nutritionRows, userId);
  dtMapRecoveryObservations_(observations, recoveryRows, userId);

  const behaviorInputs = dtBuildBehaviorInputs_(botRows, userId);
  behaviorInputs.logical_interactions.forEach(function(interaction) {
    observations.push(dtObservation_({
      observation_id: "obs-bot-input-r" + interaction.first_row + "-interaction",
      user_id: userId,
      domain: "BEHAVIOR",
      metric: "behavior.interaction",
      value: {
        message: interaction.message,
        source: interaction.source,
        data_type: interaction.data_type,
        processed: interaction.processed,
        duplicate_rows_collapsed: interaction.duplicate_rows_collapsed,
        correction_signal: interaction.correction_signal,
        logging_signal: interaction.logging_signal
      },
      unit: "interaction",
      observed_at: interaction.observed_at,
      source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.BOT_INPUT,
      source_record_id: "Bot_Input:row:" + interaction.first_row,
      confidence: 0.95,
      quality_score: interaction.duplicate_rows_collapsed ? 70 : 85,
      quality_flags: interaction.duplicate_rows_collapsed ? ["POSSIBLE_LEGACY_DUPLICATES"] : []
    }));
  });

  const memoryIndex = {};
  memoryRows.filter(function(row) {
    return String(row.user_id) === String(userId);
  }).forEach(function(row) {
    memoryIndex[String(row.category) + "." + String(row.key)] = {
      id: String(row.id),
      category: String(row.category),
      key: String(row.key),
      value: row.value,
      priority: row.priority,
      updated_at: row.updated_at,
      source_fact: false
    };
  });

  observations.sort(function(a, b) {
    return String(a.observation_id).localeCompare(String(b.observation_id));
  });
  return {
    user_id: String(userId),
    as_of: dtIso_(asOf),
    observations: observations,
    profile: profile,
    memory_index: memoryIndex,
    behavior_inputs: behaviorInputs,
    mapping_report: {
      observations_total: observations.length,
      observations_by_domain: dtCountBy_(observations, "domain"),
      ai_memory_rows_read_for_conflict_detection: Object.keys(memoryIndex).length,
      ai_memory_observations_created: observations.filter(function(item) {
        return item.source === DIGITAL_TWIN_TEST_CONFIG.SHEETS.MEMORY;
      }).length,
      ai_memory_used_as_source_fact: false,
      production_writes: false,
      telegram_calls: 0,
      groq_calls: 0
    }
  };
}

function buildBodyState_(observations, context) {
  const weightObservations = observations.filter(function(item) {
    return item.domain === "BODY" && item.metric === "body.weight" && item.observed_at;
  }).sort(dtObservationDateSort_);
  const latest = weightObservations.length ? weightObservations[weightObservations.length - 1] : null;
  const count = weightObservations.length;
  const freshness = dtFreshness_(latest && latest.observed_at, context.as_of, 72, 168);
  const flags = [];
  const missing = [];
  if (count < DIGITAL_TWIN_TEST_CONFIG.BODY_MIN_WEIGHTS_FOR_TREND) {
    flags.push("INSUFFICIENT_BODY_TREND_DATA");
    missing.push("weight_history_for_trend");
  }
  if (!observations.some(function(item) { return item.metric === "body.fat_percentage"; })) {
    missing.push("body_fat_percentage");
  }
  if (weightObservations.some(function(item) {
    return item.quality.flags.indexOf("SINGLE_USER_SHEET_ASSUMPTION") >= 0;
  })) flags.push("SINGLE_USER_SHEET_ASSUMPTION");

  const memoryWeight = context.memory_index["profile.current_weight"] || null;
  const sourceConflicts = [];
  if (latest && memoryWeight) {
    sourceConflicts.push({
      field: "current_weight",
      canonical_value: latest.value,
      canonical_unit: latest.unit,
      canonical_source_id: latest.source_record_id,
      ignored_candidate: memoryWeight.value,
      ignored_candidate_source: "AI_MEMORY",
      resolution: "CONFIRMED_BODY_TRACKING_WINS",
      memory_used_as_source_fact: false
    });
    flags.push("MEMORY_VARIANT_IGNORED");
  }
  const confidence = latest ? (count >= DIGITAL_TWIN_TEST_CONFIG.BODY_MIN_WEIGHTS_FOR_TREND ? 0.82 : 0.62) : 0;

  return {
    status: latest ? "PARTIAL_DATA" : "NO_DATA",
    current_weight: latest ? {
      value: latest.value,
      unit: latest.unit,
      observed_at: latest.observed_at,
      source_id: latest.source_record_id
    } : null,
    last_measurement_at: latest ? latest.observed_at : null,
    measurements_count: count,
    trend: count < DIGITAL_TWIN_TEST_CONFIG.BODY_MIN_WEIGHTS_FOR_TREND ?
      "INSUFFICIENT_DATA" : "NOT_CALCULATED_SPRINT_6_1",
    source_conflicts: sourceConflicts,
    confidence: dtRound_(confidence, 2),
    freshness: freshness,
    quality: {
      score: latest ? 80 : 0,
      flags: dtUniqueSorted_(flags)
    },
    source_ids: dtLimitSourceIds_(weightObservations.map(function(item) { return item.source_record_id; })),
    missing_data: dtUniqueSorted_(missing)
  };
}

function buildTrainingState_(observations, context) {
  const records = observations.filter(function(item) {
    return item.domain === "TRAINING" && item.metric === "training.exercise_record";
  });
  const sessionKeys = {};
  let undatedRecords = 0;
  let datedRecords = 0;
  let rpeRecords = 0;
  records.forEach(function(item) {
    const value = item.value || {};
    const sessionKey = String(value.date || "NO_DATE") + "|" + String(value.session || "UNSPECIFIED");
    sessionKeys[sessionKey] = true;
    if (item.observed_at) datedRecords += 1;
    else undatedRecords += 1;
    if (value.rpe !== "" && value.rpe != null) rpeRecords += 1;
  });
  const dated = records.filter(function(item) { return !!item.observed_at; }).sort(dtObservationDateSort_);
  const latest = dated.length ? dated[dated.length - 1] : null;
  const freshness = dtFreshness_(latest && latest.observed_at, context.as_of, 168, 336);
  const flags = [];
  const missing = [];
  if (undatedRecords) {
    flags.push("LEGACY_DATE_MISSING");
    missing.push("dates_for_legacy_sessions");
  }
  if (!rpeRecords) {
    flags.push("MISSING_RPE_DATA");
    missing.push("rpe");
  }
  missing.push("recovery_linkage");
  if (freshness.status === "STALE") flags.push("STALE_DATA");
  const recentExercises = records.slice(-6).map(function(item) {
    return {
      exercise: item.value.exercise,
      session: item.value.session,
      observed_at: item.observed_at,
      source_id: item.source_record_id
    };
  });

  return {
    status: records.length ? "PARTIAL_DATA" : "NO_DATA",
    sessions_count: Object.keys(sessionKeys).length,
    exercise_records_count: records.length,
    dated_records_count: datedRecords,
    undated_records_count: undatedRecords,
    has_complete_dates: undatedRecords === 0 && records.length > 0,
    last_training_at: latest ? latest.observed_at : null,
    recent_exercises: recentExercises,
    progress: "NOT_CALCULATED_SPRINT_6_1",
    confidence: records.length ? 0.45 : 0,
    freshness: freshness,
    quality: {
      score: records.length ? 60 : 0,
      flags: dtUniqueSorted_(flags)
    },
    source_ids: dtLimitSourceIds_(records.map(function(item) { return item.source_record_id; })),
    missing_data: dtUniqueSorted_(missing)
  };
}

function buildNutritionState_(observations, context) {
  const records = observations.filter(function(item) {
    return item.domain === "NUTRITION" && item.metric === "nutrition.daily_total";
  }).filter(function(item) { return !!item.observed_at; }).sort(dtObservationDateSort_);
  const latest = records.length ? records[records.length - 1] : null;
  const freshness = dtFreshness_(latest && latest.observed_at, context.as_of, 48, 168);
  const windowDays = DIGITAL_TWIN_TEST_CONFIG.NUTRITION_WINDOW_DAYS;
  const windowStart = dtStartOfDay_(new Date(context.as_of.getTime() - (windowDays - 1) * 86400000));
  const windowEnd = dtEndOfDay_(context.as_of);
  const days = {};
  records.forEach(function(item) {
    const date = dtParseDateTime_(item.observed_at);
    if (date && date.getTime() >= windowStart.getTime() && date.getTime() <= windowEnd.getTime()) {
      days[Utilities.formatDate(date, DIGITAL_TWIN_TEST_CONFIG.TIMEZONE, "yyyy-MM-dd")] = true;
    }
  });
  const daysLogged = Object.keys(days).length;
  const coverageRatio = dtRound_(daysLogged / windowDays, 3);
  const coverageStatus = coverageRatio >= 0.8 ? "SUFFICIENT" : "LOW_COVERAGE";
  const estimatedCount = records.filter(function(item) { return item.value.estimated === true; }).length;
  const completeMacroCount = records.filter(function(item) {
    const value = item.value || {};
    return [value.calories, value.protein, value.fat, value.carbs].every(function(number) {
      return typeof number === "number" && isFinite(number);
    });
  }).length;
  const legacyCount = records.filter(function(item) { return item.value.legacy_import === true; }).length;
  const flags = [];
  const missing = [];
  if (coverageStatus === "LOW_COVERAGE") {
    flags.push("LOW_COVERAGE");
    missing.push("recent_daily_nutrition_records");
  }
  if (freshness.status === "STALE") flags.push("STALE_DATA");
  if (legacyCount) flags.push("LEGACY_IMPORT");
  if (completeMacroCount < records.length) missing.push("complete_kbju");

  return {
    status: records.length ? coverageStatus : "NO_DATA",
    records_count: records.length,
    last_record_at: latest ? latest.observed_at : null,
    coverage: {
      window_days: windowDays,
      days_logged: daysLogged,
      ratio: coverageRatio,
      status: coverageStatus
    },
    kbju_present: completeMacroCount > 0,
    complete_kbju_records_count: completeMacroCount,
    estimated_flag: estimatedCount > 0,
    estimated_records_count: estimatedCount,
    legacy_import_records_count: legacyCount,
    protein_assessment: "NOT_CALCULATED_SPRINT_6_1",
    confidence: records.length ? 0.38 : 0,
    freshness: freshness,
    quality: {
      score: records.length ? 60 : 0,
      flags: dtUniqueSorted_(flags)
    },
    source_ids: dtLimitSourceIds_(records.map(function(item) { return item.source_record_id; })),
    missing_data: dtUniqueSorted_(missing)
  };
}

function buildRecoveryState_(observations, context) {
  const records = observations.filter(function(item) {
    return item.domain === "RECOVERY";
  }).filter(function(item) { return !!item.observed_at; }).sort(dtObservationDateSort_);
  const latest = records.length ? records[records.length - 1] : null;
  const missing = [];
  if (!records.some(function(item) { return item.metric === "recovery.sleep"; })) missing.push("sleep");
  if (!records.some(function(item) { return item.metric === "recovery.energy"; })) missing.push("energy");
  if (!records.some(function(item) { return item.metric === "recovery.pain"; })) missing.push("pain");
  const noData = records.length === 0;

  return {
    status: noData ? "NO_DATA" : "PARTIAL_DATA",
    records_count: records.length,
    last_checkin_at: latest ? latest.observed_at : null,
    readiness: "NOT_CALCULATED_SPRINT_6_1",
    confidence: noData ? 0 : 0.5,
    freshness: noData ? dtNoDataFreshness_() : dtFreshness_(latest.observed_at, context.as_of, 24, 36),
    quality: {
      score: noData ? 0 : 60,
      flags: noData ? ["MISSING_RECOVERY_DATA"] : []
    },
    source_ids: dtLimitSourceIds_(records.map(function(item) { return item.source_record_id; })),
    missing_data: dtUniqueSorted_(missing)
  };
}

function buildGoalState_(observations, context) {
  const profile = context.profile || {};
  const goalObservation = observations.filter(function(item) {
    return item.domain === "GOAL" && item.metric === "goal.type";
  })[0] || null;
  const targetObservation = observations.filter(function(item) {
    return item.domain === "GOAL" && item.metric === "goal.target_weight";
  })[0] || null;
  const startObservation = observations.filter(function(item) {
    return item.domain === "BODY" && item.metric === "body.start_weight";
  })[0] || null;
  const memoryGoal = context.memory_index["goal.goal_type"] || null;
  const memoryTarget = context.memory_index["goal.target_weight"] || null;
  const conflicts = [];
  const flags = [];
  const missing = [];

  if (goalObservation && memoryGoal &&
      dtNormalizeText_(goalObservation.value) !== dtNormalizeText_(memoryGoal.value)) {
    conflicts.push({
      field: "goal_type",
      canonical_value: goalObservation.value,
      canonical_source_id: goalObservation.source_record_id,
      ignored_candidate: memoryGoal.value,
      ignored_candidate_source: "AI_MEMORY",
      resolution: "USER_PROFILE_WINS",
      memory_used_as_source_fact: false
    });
    flags.push("GOAL_MEMORY_CONFLICT");
  }
  if (!targetObservation) {
    missing.push("target_weight");
    flags.push("GOAL_TARGET_MISSING");
    if (memoryTarget) {
      conflicts.push({
        field: "target_weight",
        canonical_value: null,
        canonical_source_id: "User_Profile:row:" + String(profile._row_number || ""),
        ignored_candidate: memoryTarget.value,
        ignored_candidate_source: "AI_MEMORY",
        resolution: "MEMORY_ONLY_VALUE_NOT_PROMOTED",
        memory_used_as_source_fact: false
      });
    }
  }
  if (!goalObservation) missing.push("goal_type");
  if (!String(profile["Дата старта"] || "")) missing.push("goal_start_date");
  const sourceIds = [];
  if (goalObservation) sourceIds.push(goalObservation.source_record_id);
  if (targetObservation) sourceIds.push(targetObservation.source_record_id);
  if (startObservation) sourceIds.push(startObservation.source_record_id);
  if (context.body_state && context.body_state.current_weight) {
    sourceIds.push(context.body_state.current_weight.source_id);
  }

  return {
    status: missing.length ? "INCOMPLETE" : "CONFIGURED",
    goal_type: goalObservation ? goalObservation.value : null,
    baseline_weight: startObservation ? {value: startObservation.value, unit: startObservation.unit} : null,
    current_weight: context.body_state ? context.body_state.current_weight : null,
    target_weight: targetObservation ? {value: targetObservation.value, unit: targetObservation.unit} : null,
    milestones: [],
    progress: "NOT_CALCULATED_SPRINT_6_1",
    source_conflicts: conflicts,
    confidence: goalObservation ? 0.45 : 0.2,
    freshness: {
      status: "UNKNOWN_TIMESTAMP",
      latest_observed_at: null,
      age_hours: null,
      score: 0.6
    },
    quality: {
      score: goalObservation ? 55 : 30,
      flags: dtUniqueSorted_(flags.concat(["TIMESTAMP_IMPRECISE"]))
    },
    source_ids: dtLimitSourceIds_(sourceIds),
    missing_data: dtUniqueSorted_(missing)
  };
}

function buildBehaviorState_(observations, context) {
  const records = observations.filter(function(item) {
    return item.domain === "BEHAVIOR" && item.metric === "behavior.interaction";
  }).sort(dtObservationDateSort_);
  const latest = records.length ? records[records.length - 1] : null;
  const corrections = records.filter(function(item) {
    return item.value && item.value.correction_signal === true;
  }).length;
  const loggingActivity = records.filter(function(item) {
    return item.value && item.value.logging_signal === true;
  }).length;
  const collapsed = records.reduce(function(total, item) {
    return total + Number(item.value && item.value.duplicate_rows_collapsed || 0);
  }, 0);
  const flags = [];
  if (collapsed) flags.push("POSSIBLE_LEGACY_DUPLICATES");

  return {
    status: records.length ? "AVAILABLE" : "NO_DATA",
    interactions_count: records.length,
    raw_interaction_rows: context.behavior_inputs.raw_rows_count,
    collapsed_duplicate_rows: collapsed,
    corrections_present: corrections > 0,
    corrections_count: corrections,
    logging_activity_present: loggingActivity > 0,
    logging_activity_count: loggingActivity,
    last_interaction_at: latest ? latest.observed_at : null,
    psychological_inference: "PROHIBITED",
    confidence: records.length ? 0.70 : 0,
    freshness: latest ? dtFreshness_(latest.observed_at, context.as_of, 168, 720) : dtNoDataFreshness_(),
    quality: {
      score: records.length ? 70 : 0,
      flags: flags
    },
    source_ids: dtLimitSourceIds_(records.map(function(item) { return item.source_record_id; })),
    missing_data: records.length ? [] : ["interaction_history"]
  };
}

function calculateSnapshotQuality_(states, context) {
  const weights = {
    body_state: 0.20,
    training_state: 0.20,
    nutrition_state: 0.20,
    recovery_state: 0.15,
    goal_state: 0.15,
    behavior_state: 0.10
  };
  let confidence = 0;
  let quality = 0;
  const flags = [];
  const missing = [];
  const freshnessDomains = {};
  Object.keys(weights).forEach(function(key) {
    const state = states[key];
    confidence += Number(state.confidence || 0) * weights[key];
    quality += Number(state.quality && state.quality.score || 0) * weights[key];
    (state.quality && state.quality.flags || []).forEach(function(flag) { flags.push(flag); });
    (state.missing_data || []).forEach(function(item) { missing.push(key.replace("_state", "") + "." + item); });
    freshnessDomains[key.replace("_state", "")] = state.freshness.status;
  });
  flags.push("AI_MEMORY_EXCLUDED_AS_SOURCE_FACT");
  if (states.recovery_state.status === "NO_DATA") flags.push("MISSING_RECOVERY_DATA");
  if (states.nutrition_state.status === "LOW_COVERAGE") flags.push("LOW_NUTRITION_COVERAGE");
  if (states.body_state.trend === "INSUFFICIENT_DATA") flags.push("INSUFFICIENT_BODY_TREND_DATA");

  return {
    confidence: dtRound_(confidence, 2),
    quality_score: Math.round(quality),
    freshness: {
      status: "MIXED",
      as_of: dtIso_(context.as_of),
      domains: freshnessDomains
    },
    flags: dtUniqueSorted_(flags),
    missing_data: dtUniqueSorted_(missing),
    algorithm_version: DIGITAL_TWIN_TEST_CONFIG.ALGORITHM_VERSION
  };
}

function testDigitalTwinSnapshot_() {
  const userId = "132976932";
  const referenceAsOf = new Date();
  const sourceSheets = [
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.PROFILE,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.BODY,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.WORKOUT,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.NUTRITION,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.RECOVERY,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.MEMORY,
    DIGITAL_TWIN_TEST_CONFIG.SHEETS.BOT_INPUT
  ];
  const rowsBefore = dtSheetLastRows_(sourceSheets);
  const mapped = mapExistingDataToObservations_(userId, {as_of: referenceAsOf});
  const snapshotA = buildDigitalTwinSnapshotTest_(userId, {as_of: referenceAsOf});
  const snapshotB = buildDigitalTwinSnapshotTest_(userId, {as_of: referenceAsOf});
  const rowsAfter = dtSheetLastRows_(sourceSheets);
  const requiredBlocks = [
    "body_state", "training_state", "nutrition_state",
    "recovery_state", "goal_state", "behavior_state"
  ];
  const requiredEnvelope = ["confidence", "freshness", "quality", "source_ids", "missing_data"];
  const blockEnvelopeOk = requiredBlocks.every(function(block) {
    return snapshotA[block] && requiredEnvelope.every(function(field) {
      return Object.prototype.hasOwnProperty.call(snapshotA[block], field);
    });
  });
  const tests = [
    dtTestResult_(
      "CONFIRMED_WEIGHT_WINS",
      snapshotA.body_state.current_weight && snapshotA.body_state.current_weight.value === 118.7 &&
        snapshotA.body_state.source_conflicts.some(function(conflict) {
          return conflict.resolution === "CONFIRMED_BODY_TRACKING_WINS" &&
            conflict.memory_used_as_source_fact === false;
        }),
      "Body_Tracking 118.7 must win over AI_MEMORY 118.7-119",
      snapshotA.body_state
    ),
    dtTestResult_(
      "RECOVERY_NO_DATA",
      snapshotA.recovery_state.status === "NO_DATA" &&
        ["sleep", "energy", "pain"].every(function(item) {
          return snapshotA.recovery_state.missing_data.indexOf(item) >= 0;
        }),
      "Empty Recovery_Log must produce NO_DATA",
      snapshotA.recovery_state
    ),
    dtTestResult_(
      "NUTRITION_LOW_COVERAGE",
      snapshotA.nutrition_state.status === "LOW_COVERAGE" &&
        snapshotA.nutrition_state.coverage.status === "LOW_COVERAGE" &&
        snapshotA.nutrition_state.protein_assessment === "NOT_CALCULATED_SPRINT_6_1",
      "Incomplete recent nutrition window must be LOW_COVERAGE without a protein conclusion",
      snapshotA.nutrition_state
    ),
    dtTestResult_(
      "WORKOUT_LEGACY_DATE_MISSING",
      snapshotA.training_state.undated_records_count > 0 &&
        snapshotA.training_state.quality.flags.indexOf("LEGACY_DATE_MISSING") >= 0 &&
        snapshotA.training_state.progress === "NOT_CALCULATED_SPRINT_6_1",
      "Undated workout history must be explicit and must not create progress",
      snapshotA.training_state
    ),
    dtTestResult_(
      "SNAPSHOT_REBUILD_DETERMINISTIC",
      dtStableStringify_(snapshotA) === dtStableStringify_(snapshotB) &&
        snapshotA.snapshot_id === snapshotB.snapshot_id,
      "Same user + same as_of + same source data must produce the same snapshot",
      {snapshot_id_a: snapshotA.snapshot_id, snapshot_id_b: snapshotB.snapshot_id}
    ),
    dtTestResult_(
      "SIX_STATE_BLOCKS_WITH_ENVELOPES",
      blockEnvelopeOk,
      "All six blocks must contain confidence, freshness, quality, source_ids and missing_data",
      {blocks: requiredBlocks, envelope: requiredEnvelope}
    ),
    dtTestResult_(
      "AI_MEMORY_NOT_SOURCE_FACT",
      mapped.mapping_report.ai_memory_observations_created === 0 &&
        mapped.mapping_report.ai_memory_used_as_source_fact === false &&
        !snapshotA.source_ids.some(function(id) { return String(id).indexOf("AI_MEMORY") === 0; }),
      "AI_MEMORY may report conflicts but may not create observations or snapshot sources",
      mapped.mapping_report
    ),
    dtTestResult_(
      "INSUFFICIENT_DATA_VISIBLE",
      snapshotA.body_state.trend === "INSUFFICIENT_DATA" &&
        snapshotA.missing_data.length > 0,
      "Sparse inputs must stay visible and must not create a forecast",
      {trend: snapshotA.body_state.trend, missing_data: snapshotA.missing_data}
    ),
    dtTestResult_(
      "NO_SHEET_WRITES",
      dtStableStringify_(rowsBefore) === dtStableStringify_(rowsAfter),
      "Source sheet last rows must not change",
      {before: rowsBefore, after: rowsAfter}
    ),
    dtTestResult_(
      "NO_DECISIONS_RECOMMENDATIONS_OR_INTEGRATIONS",
      !Object.prototype.hasOwnProperty.call(snapshotA, "decisions") &&
        !Object.prototype.hasOwnProperty.call(snapshotA, "recommendations") &&
        DIGITAL_TWIN_TEST_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
        DIGITAL_TWIN_TEST_CONFIG.TELEGRAM_ENABLED === false &&
        DIGITAL_TWIN_TEST_CONFIG.GROQ_ENABLED === false,
      "Sprint 6.1 is FACTS to STATE only",
      {
        production_writes: DIGITAL_TWIN_TEST_CONFIG.PRODUCTION_WRITES_ENABLED,
        telegram_calls: 0,
        groq_calls: 0
      }
    )
  ];
  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  const qualityReport = {
    confidence: snapshotA.confidence,
    quality_score: snapshotA.quality.score,
    freshness: snapshotA.freshness,
    flags: snapshotA.quality.flags,
    algorithm_version: snapshotA.algorithm_version
  };

  return {
    status: passed === tests.length ? "PASS" : "FAIL",
    sprint: "6.1",
    tests_total: tests.length,
    tests_passed: passed,
    tests_failed: tests.length - passed,
    tests: tests,
    snapshot: snapshotA,
    quality_report: qualityReport,
    missing_data: snapshotA.missing_data,
    safety: {
      production_version_expected: "v19",
      production_writes: false,
      telegram_calls: 0,
      groq_calls: 0,
      memory_writes: 0,
      deployment_performed: false
    }
  };
}

function runDigitalTwinSnapshotTests() {
  const report = testDigitalTwinSnapshot_();
  console.log("[Digital Twin Snapshot Test] " + JSON.stringify({
    status: report.status,
    sprint: report.sprint,
    tests_total: report.tests_total,
    tests_passed: report.tests_passed,
    tests_failed: report.tests_failed,
    snapshot_id: report.snapshot.snapshot_id,
    confidence: report.quality_report.confidence,
    quality_score: report.quality_report.quality_score,
    quality_flags: report.quality_report.flags,
    missing_data: report.missing_data,
    safety: report.safety
  }));
  return report;
}

function dtMapStableProfileFacts_(observations, profile, userId) {
  const row = Number(profile._row_number);
  const sourceId = "User_Profile:row:" + row;
  const common = {
    user_id: userId,
    observed_at: null,
    source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.PROFILE,
    source_record_id: sourceId,
    confidence: 0.90,
    quality_score: 75,
    quality_flags: ["TIMESTAMP_IMPRECISE"]
  };
  if (String(profile["Имя"] || "").trim()) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-name",
      domain: "PROFILE",
      metric: "profile.name",
      value: String(profile["Имя"]),
      unit: "text"
    })));
  }
  const age = dtNumber_(profile["Возраст"]);
  if (age != null) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-age",
      domain: "PROFILE",
      metric: "profile.age",
      value: age,
      unit: "years"
    })));
  }
  const height = dtNumber_(profile["Рост"]);
  if (height != null) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-height",
      domain: "BODY",
      metric: "body.height",
      value: height,
      unit: "cm"
    })));
  }
  const startWeight = dtNumber_(profile["Вес старт"]);
  if (startWeight != null) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-start-weight",
      domain: "BODY",
      metric: "body.start_weight",
      value: startWeight,
      unit: "kg"
    })));
  }
  if (String(profile["Цель"] || "").trim()) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-goal-type",
      domain: "GOAL",
      metric: "goal.type",
      value: String(profile["Цель"]),
      unit: "text"
    })));
  }
  const targetWeight = dtNumber_(profile["Целевой вес"]);
  if (targetWeight != null) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-target-weight",
      domain: "GOAL",
      metric: "goal.target_weight",
      value: targetWeight,
      unit: "kg"
    })));
  }
  const frequency = dtNumber_(profile["Тренировки в неделю"]);
  if (frequency != null) {
    observations.push(dtObservation_(dtMerge_(common, {
      observation_id: "obs-user-profile-r" + row + "-training-frequency",
      domain: "TRAINING",
      metric: "training.planned_frequency",
      value: frequency,
      unit: "sessions_per_week"
    })));
  }
}

function dtMapBodyObservations_(observations, rows, userId) {
  const mappings = [
    ["Вес", "body.weight", "kg"],
    ["Процент жира", "body.fat_percentage", "percent"],
    ["Талия", "body.measurement.waist", "cm"],
    ["Грудь", "body.measurement.chest", "cm"],
    ["Рука", "body.measurement.arm", "cm"],
    ["Бедро", "body.measurement.thigh", "cm"],
    ["Шаги", "activity.steps", "steps"]
  ];
  rows.forEach(function(row) {
    const date = dtParseDateTime_(row["Дата"]);
    const flags = ["SINGLE_USER_SHEET_ASSUMPTION"];
    if (String(row["Комментарий"] || "").indexOf("CANARY ") === 0) flags.push("CANARY_TEST_RECORD");
    mappings.forEach(function(mapping) {
      const value = dtNumber_(row[mapping[0]]);
      if (value == null) return;
      observations.push(dtObservation_({
        observation_id: "obs-body-tracking-r" + row._row_number + "-" + dtSlug_(mapping[1]),
        user_id: userId,
        domain: mapping[1].indexOf("activity.") === 0 ? "BEHAVIOR" : "BODY",
        metric: mapping[1],
        value: value,
        unit: mapping[2],
        observed_at: date ? dtIso_(date) : null,
        source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.BODY,
        source_record_id: "Body_Tracking:row:" + row._row_number,
        confidence: date ? 0.98 : 0.70,
        quality_score: date ? 90 : 60,
        quality_flags: date ? flags : flags.concat(["TIMESTAMP_IMPRECISE"])
      }));
    });
  });
}

function dtMapWorkoutObservations_(observations, rows, userId) {
  rows.forEach(function(row) {
    if (!String(row["Тип тренировки"] || "").trim() && !String(row["Упражнение"] || "").trim()) return;
    const date = dtParseDateTime_(row["Дата"]);
    const flags = date ? ["LEGACY_IMPORT"] : ["LEGACY_IMPORT", "LEGACY_DATE_MISSING"];
    observations.push(dtObservation_({
      observation_id: "obs-workout-log-r" + row._row_number + "-exercise",
      user_id: userId,
      domain: "TRAINING",
      metric: "training.exercise_record",
      value: {
        date: date ? Utilities.formatDate(date, DIGITAL_TWIN_TEST_CONFIG.TIMEZONE, "yyyy-MM-dd") : null,
        session: String(row["Тип тренировки"] || ""),
        exercise: String(row["Упражнение"] || ""),
        loads: dtNumberList_(row["Вес"]),
        sets: dtNumber_(row["Подходы"]),
        reps: dtNumberList_(row["Повторы"]),
        rpe: dtNumber_(row["RPE"]),
        pain_or_constraints: String(row["Боль/ограничения"] || ""),
        comment: String(row["Комментарий"] || "")
      },
      unit: "exercise_record",
      observed_at: date ? dtIso_(date) : null,
      source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.WORKOUT,
      source_record_id: "Workout_Log:row:" + row._row_number,
      confidence: date ? 0.80 : 0.55,
      quality_score: date ? 75 : 45,
      quality_flags: flags
    }));
  });
}

function dtMapNutritionObservations_(observations, rows, userId) {
  rows.forEach(function(row) {
    const date = dtParseDateTime_(row["Дата"]);
    if (!date) return;
    const description = String(row["Описание"] || "");
    const estimated = /оцен|пример|estimate/i.test(description);
    const legacy = /перенесено|import/i.test(description);
    observations.push(dtObservation_({
      observation_id: "obs-nutrition-log-r" + row._row_number + "-daily-total",
      user_id: userId,
      domain: "NUTRITION",
      metric: "nutrition.daily_total",
      value: {
        meal_type: String(row["Приём пищи"] || ""),
        description: description,
        calories: dtNumber_(row["Ккал"]),
        protein: dtNumber_(row["Белок"]),
        fat: dtNumber_(row["Жиры"]),
        carbs: dtNumber_(row["Углеводы"]),
        estimated: estimated,
        legacy_import: legacy
      },
      unit: "daily_total",
      observed_at: dtIso_(date),
      source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.NUTRITION,
      source_record_id: "Nutrition_Log:row:" + row._row_number,
      confidence: legacy ? 0.75 : 0.90,
      quality_score: legacy ? 70 : 85,
      quality_flags: legacy ? ["LEGACY_IMPORT"] : []
    }));
  });
}

function dtMapRecoveryObservations_(observations, rows, userId) {
  rows.forEach(function(row) {
    const date = dtParseDateTime_(row["Дата"]);
    if (!date) return;
    const sourceId = "Recovery_Log:row:" + row._row_number;
    const base = {
      user_id: userId,
      domain: "RECOVERY",
      observed_at: dtIso_(date),
      source: DIGITAL_TWIN_TEST_CONFIG.SHEETS.RECOVERY,
      source_record_id: sourceId,
      confidence: 0.90,
      quality_score: 85,
      quality_flags: []
    };
    const sleep = dtNumber_(row["Сон часы"]);
    if (sleep != null) observations.push(dtObservation_(dtMerge_(base, {
      observation_id: "obs-recovery-log-r" + row._row_number + "-sleep",
      metric: "recovery.sleep",
      value: sleep,
      unit: "hours"
    })));
    const energy = dtNumber_(row["Энергия"]);
    if (energy != null) observations.push(dtObservation_(dtMerge_(base, {
      observation_id: "obs-recovery-log-r" + row._row_number + "-energy",
      metric: "recovery.energy",
      value: energy,
      unit: "score"
    })));
    const painParts = [row["Боль плечо"], row["Боль поясница"], row["Боль другая/локализация"]]
      .filter(function(value) { return String(value || "").trim(); });
    if (painParts.length) observations.push(dtObservation_(dtMerge_(base, {
      observation_id: "obs-recovery-log-r" + row._row_number + "-pain",
      metric: "recovery.pain",
      value: painParts.join("; "),
      unit: "text"
    })));
  });
}

function dtBuildBehaviorInputs_(rows, userId) {
  const relevant = rows.filter(function(row) {
    return String(row["User_ID"]) === String(userId) && String(row["Сообщение"] || "").trim();
  }).map(function(row) {
    const date = dtParseDateTime_(row["Дата"]);
    const message = String(row["Сообщение"] || "").trim();
    return {
      row_number: row._row_number,
      observed_at: date ? dtIso_(date) : null,
      date_ms: date ? date.getTime() : null,
      message: message,
      normalized_message: dtNormalizeText_(message),
      source: String(row["Источник"] || ""),
      data_type: String(row["Тип данных"] || ""),
      processed: String(row["Обработано"] || ""),
      correction_signal: /исправ|ошиб|хромает логик|нет[,;:].*(?:был|была|вес)|неправиль/i.test(message),
      logging_signal: /\bвес\b|тренир|жим|присед|тяга|ел\b|кушал|спал|сон\b|энерг/i.test(message)
    };
  }).sort(function(a, b) {
    return (a.date_ms || 0) - (b.date_ms || 0) || a.row_number - b.row_number;
  });
  const logical = [];
  relevant.forEach(function(item) {
    const previous = logical.length ? logical[logical.length - 1] : null;
    const withinThirtyMinutes = previous && previous.date_ms != null && item.date_ms != null &&
      item.date_ms - previous.date_ms <= 30 * 60 * 1000;
    if (previous && previous.normalized_message === item.normalized_message && withinThirtyMinutes) {
      previous.duplicate_rows_collapsed += 1;
      previous.date_ms = item.date_ms;
      previous.observed_at = item.observed_at;
      previous.last_row = item.row_number;
      previous.correction_signal = previous.correction_signal || item.correction_signal;
      previous.logging_signal = previous.logging_signal || item.logging_signal;
    } else {
      logical.push({
        first_row: item.row_number,
        last_row: item.row_number,
        observed_at: item.observed_at,
        date_ms: item.date_ms,
        message: item.message,
        normalized_message: item.normalized_message,
        source: item.source,
        data_type: item.data_type,
        processed: item.processed,
        correction_signal: item.correction_signal,
        logging_signal: item.logging_signal,
        duplicate_rows_collapsed: 0
      });
    }
  });
  return {
    raw_rows_count: relevant.length,
    logical_interactions: logical,
    collapsed_rows_count: relevant.length - logical.length
  };
}

function dtObservation_(input) {
  return {
    observation_id: String(input.observation_id),
    user_id: String(input.user_id),
    domain: String(input.domain),
    metric: String(input.metric),
    value: input.value,
    unit: String(input.unit || "unitless"),
    observed_at: input.observed_at || null,
    source: String(input.source),
    source_record_id: String(input.source_record_id),
    confidence: dtRound_(Number(input.confidence || 0), 2),
    quality: {
      score: Math.round(Number(input.quality_score || 0)),
      flags: dtUniqueSorted_(input.quality_flags || [])
    }
  };
}

function dtReadSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("DIGITAL_TWIN_MISSING_SHEET:" + sheetName);
  const expected = DIGITAL_TWIN_TEST_CONFIG.HEADERS[sheetName];
  if (!expected) throw new Error("DIGITAL_TWIN_MISSING_HEADER_CONTRACT:" + sheetName);
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const values = sheet.getRange(1, 1, lastRow, expected.length).getDisplayValues();
  const actual = values[0];
  if (dtStableStringify_(actual) !== dtStableStringify_(expected)) {
    throw new Error("DIGITAL_TWIN_HEADER_MISMATCH:" + sheetName);
  }
  return values.slice(1).map(function(valuesRow, index) {
    const row = {_row_number: index + 2};
    expected.forEach(function(header, column) { row[header] = valuesRow[column]; });
    return row;
  }).filter(function(row) {
    return expected.some(function(header) { return String(row[header] || "").trim() !== ""; });
  });
}

function dtFreshness_(latestValue, asOfValue, freshHours, cautionHours) {
  const latest = dtParseDateTime_(latestValue);
  const asOf = dtParseDateTime_(asOfValue);
  if (!latest || !asOf) return dtNoDataFreshness_();
  const ageHours = dtRound_((asOf.getTime() - latest.getTime()) / 3600000, 1);
  if (ageHours < -1) {
    return {status: "FUTURE_DATA", latest_observed_at: dtIso_(latest), age_hours: ageHours, score: 0.2};
  }
  if (ageHours <= freshHours) {
    return {status: "FRESH", latest_observed_at: dtIso_(latest), age_hours: ageHours, score: 1};
  }
  if (ageHours <= cautionHours) {
    return {status: "CAUTION", latest_observed_at: dtIso_(latest), age_hours: ageHours, score: 0.7};
  }
  return {status: "STALE", latest_observed_at: dtIso_(latest), age_hours: ageHours, score: 0.35};
}

function dtNoDataFreshness_() {
  return {status: "NO_DATA", latest_observed_at: null, age_hours: null, score: 0};
}

function dtParseDateTime_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (value == null || value === "") return null;
  const text = String(value).trim();
  const ru = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (ru) {
    return new Date(
      Number(ru[3]), Number(ru[2]) - 1, Number(ru[1]),
      Number(ru[4] || 12), Number(ru[5] || 0), Number(ru[6] || 0)
    );
  }
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function dtIso_(value) {
  const date = dtParseDateTime_(value);
  return date ? date.toISOString() : null;
}

function dtNumber_(value) {
  if (typeof value === "number" && isFinite(value)) return value;
  const text = String(value == null ? "" : value).trim().replace(/\s/g, "").replace(",", ".");
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return isFinite(number) ? number : null;
}

function dtNumberList_(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return [];
  return text.split(/[\/;]+/).map(function(part) { return dtNumber_(part); }).filter(function(number) {
    return number != null;
  });
}

function dtObservationDateSort_(a, b) {
  const aDate = dtParseDateTime_(a.observed_at);
  const bDate = dtParseDateTime_(b.observed_at);
  return (aDate ? aDate.getTime() : 0) - (bDate ? bDate.getTime() : 0) ||
    String(a.observation_id).localeCompare(String(b.observation_id));
}

function dtStartOfDay_(value) {
  const date = dtParseDateTime_(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function dtEndOfDay_(value) {
  const date = dtParseDateTime_(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function dtNormalizeText_(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9.,-]+/gi, " ").trim();
}

function dtSlug_(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function dtRound_(value, digits) {
  const factor = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * factor) / factor;
}

function dtUniqueSorted_(values) {
  const seen = {};
  (values || []).forEach(function(value) {
    const key = String(value == null ? "" : value);
    if (key) seen[key] = true;
  });
  return Object.keys(seen).sort();
}

function dtLimitSourceIds_(values) {
  return dtUniqueSorted_(values).slice(0, DIGITAL_TWIN_TEST_CONFIG.MAX_STATE_SOURCE_IDS);
}

function dtCountBy_(values, key) {
  const result = {};
  (values || []).forEach(function(value) {
    const group = String(value[key] || "UNKNOWN");
    result[group] = (result[group] || 0) + 1;
  });
  return result;
}

function dtStableStringify_(value) {
  if (value === null || value === undefined) return "null";
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) {
    return "[" + value.map(function(item) { return dtStableStringify_(item); }).join(",") + "]";
  }
  if (typeof value === "object") {
    return "{" + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ":" + dtStableStringify_(value[key]);
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function dtHash_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    const hex = normalized.toString(16);
    return hex.length === 1 ? "0" + hex : hex;
  }).join("");
}

function dtMerge_(base, extra) {
  const result = {};
  Object.keys(base || {}).forEach(function(key) { result[key] = base[key]; });
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}

function dtTestResult_(id, passed, expected, actual) {
  return {
    id: String(id),
    status: passed ? "PASS" : "FAIL",
    expected: expected,
    actual: actual
  };
}

function dtSheetLastRows_(sheetNames) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const result = {};
  (sheetNames || []).forEach(function(sheetName) {
    const sheet = spreadsheet.getSheetByName(sheetName);
    result[sheetName] = sheet ? sheet.getLastRow() : null;
  });
  return result;
}
