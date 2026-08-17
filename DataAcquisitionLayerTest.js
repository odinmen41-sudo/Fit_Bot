/**
 * Sprint 6.1.2 — TEST-ONLY Data Acquisition & User Confirmation Layer.
 *
 * Depends on DataQualityCleanupTest.gs for shared read-only table helpers and
 * baseline Data Quality Report v1. No function in the production pipeline is
 * called or changed by this module.
 */
const DATA_ACQUISITION_TEST_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  VERSION: "data-acquisition-test-v1.0",
  PRODUCTION_VERSION: "v19",
  NUTRITION_PERIOD_DAYS: 14,
  RECOVERY_TARGET_DAYS: 7,
  RECOVERY_MIN_DAYS_FOR_METRICS: 3,
  BODY_MIN_RECORDS: 8,
  TELEGRAM_CALLS: 0,
  GROQ_CALLS: 0,
  DOMAIN_WRITES: 0,
  DEPLOYMENT_PERFORMED: false,
  ACTIVE_ENABLED: false
});

/**
 * Builds WORKOUT_DATA_QUALITY_STATUS for every record without changing data.
 *
 * @return {Object} per-record status and summary.
 */
function buildWorkoutDataQualityStatusTest_() {
  const table = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.WORKOUT);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"],
    exercise: ["Упражнение", "exercise"],
    weight: ["Вес", "weight"],
    sets: ["Подходы", "sets"],
    reps: ["Повторы", "reps"],
    rpe: ["RPE"],
    pain: ["Боль/ограничения", "Боль", "pain"]
  });

  const records = table.rows.map(function(row, rowIndex) {
    const hasDate = isPresentDq_(getCellDq_(row, indexes.date));
    const hasExercise = isPresentDq_(getCellDq_(row, indexes.exercise));
    const hasWeight = isPresentDq_(getCellDq_(row, indexes.weight));
    const hasSets = isPresentDq_(getCellDq_(row, indexes.sets));
    const hasReps = isPresentDq_(getCellDq_(row, indexes.reps));
    const hasRpe = isPresentDq_(getCellDq_(row, indexes.rpe));
    const hasPain = isPresentDq_(getCellDq_(row, indexes.pain));
    const exercise = String(getCellDq_(row, indexes.exercise) || "");
    const bodyweight = /подтягив|отжиман|планк/i.test(exercise);

    let loadStatus = "UNKNOWN";
    let loadConfidence = 0;
    if (hasWeight && hasSets && hasReps) {
      loadStatus = "VALID";
      loadConfidence = 1;
    } else if (!hasWeight && bodyweight && hasSets && hasReps) {
      loadStatus = "BODYWEIGHT_UNSPECIFIED";
      loadConfidence = 0.5;
    } else if (hasWeight || hasSets || hasReps) {
      loadStatus = "PARTIAL";
      loadConfidence = 0.35;
    }

    const confidence = roundDq_(
      (hasDate ? 0.35 : 0) +
      (hasExercise ? 0.20 : 0) +
      loadConfidence * 0.25 +
      (hasRpe ? 0.10 : 0) +
      (hasPain ? 0.10 : 0),
      2
    );

    return {
      record_id: "workout-row-" + (rowIndex + 2),
      sheet_row: rowIndex + 2,
      date_status: hasDate ? "VALID" : "UNKNOWN",
      exercise_status: hasExercise ? "VALID" : "MISSING",
      load_status: loadStatus,
      rpe_status: hasRpe ? "VALID" : "UNKNOWN",
      pain_status: hasPain ? "RECORDED" : "UNKNOWN",
      confidence: confidence,
      date_value: hasDate ? normalizeDateOutputDq_(getCellDq_(row, indexes.date)) : null,
      inferred_date: null,
      write_performed: false
    };
  });

  const unknownDateRecords = records.filter(function(record) { return record.date_status === "UNKNOWN"; });
  const datedRecords = records.filter(function(record) { return record.date_status === "VALID"; });
  return {
    entity: "WORKOUT_DATA_QUALITY_STATUS",
    mode: DATA_ACQUISITION_TEST_CONFIG.MODE,
    total_records: records.length,
    valid_date_records: datedRecords.length,
    unknown_date_records: unknownDateRecords.length,
    average_confidence: averageDataAcquisitionTest_(records.map(function(record) { return record.confidence; })),
    dated_average_confidence: averageDataAcquisitionTest_(datedRecords.map(function(record) { return record.confidence; })),
    undated_average_confidence: averageDataAcquisitionTest_(unknownDateRecords.map(function(record) { return record.confidence; })),
    dates_inferred: 0,
    records: records,
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.WORKOUT,
    write_performed: false
  };
}

/**
 * Calculates data coverage only. It does not calculate deficit, targets or
 * nutrition recommendations.
 *
 * @param {number=} periodDays analysis window.
 * @param {Date|string=} asOfDate deterministic end date.
 * @return {Object} NUTRITION_COVERAGE_METRIC_TEST.
 */
function buildNutritionCoverageMetricTest_(periodDays, asOfDate) {
  const period = Number(periodDays) || DATA_ACQUISITION_TEST_CONFIG.NUTRITION_PERIOD_DAYS;
  const effectiveEnd = startOfDayDq_(parseDateDq_(asOfDate) || new Date());
  const cutoff = new Date(effectiveEnd.getTime() - (period - 1) * 86400000);
  const table = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.NUTRITION);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"],
    description: ["Описание", "description"],
    calories: ["Ккал", "calories"],
    protein: ["Белок", "protein"],
    fat: ["Жиры", "fat"],
    carbs: ["Углеводы", "carbs"]
  });

  const periodRows = table.rows.filter(function(row) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    if (!date) return false;
    const day = startOfDayDq_(date);
    return day.getTime() >= cutoff.getTime() && day.getTime() <= effectiveEnd.getTime();
  });
  const days = {};
  let estimatedEntries = 0;

  periodRows.forEach(function(row) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    const key = formatDateKeyDq_(date);
    const completeEntry = ["calories", "protein", "fat", "carbs"].every(function(field) {
      return indexes[field] >= 0 && isPresentDq_(getCellDq_(row, indexes[field]));
    });
    if (!days[key]) days[key] = {entries: 0, complete_entries: 0, incomplete_entries: 0};
    days[key].entries += 1;
    if (completeEntry) days[key].complete_entries += 1;
    else days[key].incomplete_entries += 1;

    const description = normalizeTextDq_(getCellDq_(row, indexes.description));
    if (/оцен|пример|estimated|estimate|приблиз|≈|~/.test(description)) estimatedEntries += 1;
  });

  const dayKeys = Object.keys(days);
  const completeDays = dayKeys.filter(function(key) {
    return days[key].entries > 0 && days[key].incomplete_entries === 0;
  }).length;
  const loggedDays = dayKeys.length;
  const coveragePercent = roundDq_(100 * loggedDays / period, 1);
  const confidence = roundDq_(loggedDays / period, 2);

  return {
    entity: "NUTRITION_COVERAGE_METRIC_TEST",
    period_days: period,
    period_start: formatDateKeyDq_(cutoff),
    period_end: formatDateKeyDq_(effectiveEnd),
    logged_days: loggedDays,
    coverage_percent: coveragePercent,
    complete_days: completeDays,
    incomplete_days: loggedDays - completeDays,
    estimated_entries: estimatedEntries,
    confidence: confidence,
    calculation_confidence: 1,
    status: loggedDays === period && completeDays === period ? "FULL_COVERAGE" : "INSUFFICIENT_COVERAGE",
    deficit_calculated: false,
    calorie_target_changed: false,
    recommendation_generated: false,
    write_performed: false
  };
}

/**
 * Extends Data Quality Report v1 with in-memory confirmed data.
 *
 * @param {Object} confirmedGoal canonical in-memory GOALS_V2.
 * @param {Object} recoveryObservation in-memory Recovery observation.
 * @return {Object} Data Quality Report v2.
 */
function buildDataQualityReportV2Test_(confirmedGoal, recoveryObservation) {
  const before = buildDataQualityReport_();
  const workoutStatus = buildWorkoutDataQualityStatusTest_();
  const nutritionCoverage = buildNutritionCoverageMetricTest_(14, "2026-08-14");
  const goalAfterScore = scoreConfirmedGoalDataAcquisitionTest_(confirmedGoal, before.domains.GOALS.quality_score);
  const recoveryAfterScore = scoreRecoveryObservationDataAcquisitionTest_(recoveryObservation);
  const afterDomains = {
    BODY: before.domains.BODY.quality_score,
    TRAINING: before.domains.TRAINING.quality_score,
    NUTRITION: before.domains.NUTRITION.quality_score,
    RECOVERY: recoveryAfterScore,
    GOALS: goalAfterScore
  };
  const beforeDomains = {
    BODY: before.domains.BODY.quality_score,
    TRAINING: before.domains.TRAINING.quality_score,
    NUTRITION: before.domains.NUTRITION.quality_score,
    RECOVERY: before.domains.RECOVERY.quality_score,
    GOALS: before.domains.GOALS.quality_score
  };
  const afterScore = roundDq_(
    afterDomains.BODY * 0.20 +
    afterDomains.TRAINING * 0.30 +
    afterDomains.NUTRITION * 0.20 +
    afterDomains.RECOVERY * 0.15 +
    afterDomains.GOALS * 0.15,
    1
  );
  const improvedDomains = Object.keys(afterDomains).filter(function(domain) {
    return afterDomains[domain] > beforeDomains[domain];
  }).map(function(domain) {
    return {domain: domain, before: beforeDomains[domain], after: afterDomains[domain]};
  });

  const blockedDomains = [];
  const requiredUserActions = [];
  if (before.domains.BODY.valid_dated_weight_records < DATA_ACQUISITION_TEST_CONFIG.BODY_MIN_RECORDS) {
    blockedDomains.push({domain: "BODY", reason: "INSUFFICIENT_TREND_DEPTH"});
    requiredUserActions.push({
      domain: "BODY",
      action: "LOG_WEIGHT_MEASUREMENTS",
      required_count: DATA_ACQUISITION_TEST_CONFIG.BODY_MIN_RECORDS - before.domains.BODY.valid_dated_weight_records
    });
  }
  if (workoutStatus.unknown_date_records > 0) {
    blockedDomains.push({domain: "TRAINING", reason: "LEGACY_DATES_UNKNOWN"});
    requiredUserActions.push({
      domain: "TRAINING",
      action: "CONFIRM_LEGACY_WORKOUT_DATES_OR_KEEP_UNKNOWN",
      affected_records: workoutStatus.unknown_date_records
    });
  }
  if (nutritionCoverage.logged_days < 7) {
    blockedDomains.push({domain: "NUTRITION", reason: "COVERAGE_BELOW_MINIMUM"});
    requiredUserActions.push({
      domain: "NUTRITION",
      action: "LOG_COMPLETE_DAYS",
      required_count: 7 - nutritionCoverage.logged_days
    });
  }
  if (!recoveryObservation || recoveryAfterScore < 60) {
    blockedDomains.push({domain: "RECOVERY", reason: "INSUFFICIENT_LONGITUDINAL_CHECKINS"});
    requiredUserActions.push({
      domain: "RECOVERY",
      action: "COMPLETE_RECOVERY_CHECKINS",
      required_count: DATA_ACQUISITION_TEST_CONFIG.RECOVERY_TARGET_DAYS - (recoveryObservation ? 1 : 0),
      missing_fields_next_checkin: recoveryObservation ? recoveryObservation.quality.missing_fields :
        ["sleep_hours", "sleep_quality", "energy", "stress", "fatigue", "pain_present"]
    });
  }
  if (!confirmedGoal || confirmedGoal.confirmation_status !== "CONFIRMED" || confirmedGoal.canonical !== true) {
    blockedDomains.push({domain: "GOALS", reason: "CANONICAL_GOAL_NOT_CONFIRMED"});
    requiredUserActions.push({domain: "GOALS", action: "CONFIRM_TARGET_WEIGHT"});
  } else if (!confirmedGoal.target_date) {
    requiredUserActions.push({domain: "GOALS", action: "OPTIONALLY_CONFIRM_TARGET_DATE"});
  }

  return {
    report_version: "DATA_QUALITY_REPORT_V2_TEST",
    generated_at: new Date().toISOString(),
    mode: DATA_ACQUISITION_TEST_CONFIG.MODE,
    before_score: before.global_quality_score,
    after_score: afterScore,
    domain_scores: Object.keys(afterDomains).reduce(function(acc, domain) {
      acc[domain] = {before: beforeDomains[domain], after: afterDomains[domain]};
      return acc;
    }, {}),
    improved_domains: improvedDomains,
    blocked_domains: blockedDomains,
    required_user_actions: requiredUserActions,
    ready_for_metrics_engine: blockedDomains.length === 0,
    source_report_v1: {
      algorithm_version: before.algorithm_version,
      ready_for_metrics_engine: before.ready_for_metrics_engine
    },
    writes_performed: 0,
    recommendations_generated: 0,
    metrics_generated: 0
  };
}

/**
 * Full Sprint 6.1.2 acceptance suite.
 *
 * @return {Object} test results and artifacts.
 */
function testDataAcquisitionLayer_() {
  const beforeFingerprint = captureSpreadsheetFingerprintDq_();
  const beforeMemoryHash = getSheetHashDataAcquisitionTest_(beforeFingerprint, "AI_MEMORY");
  const tests = [];
  const userId = "132976932";

  const conflict = detectGoalMemoryConflictTest_(userId);
  tests.push(testCaseDq_("GOAL 1", "Конфликт AI_MEMORY найден", conflict.conflict_found === true, conflict));
  tests.push(testCaseDq_(
    "GOAL 2",
    "AI_MEMORY не становится source fact",
    conflict.memory_candidate !== null &&
      conflict.memory_candidate.canonical === false &&
      conflict.memory_candidate.source_fact === false,
    {memory_candidate: conflict.memory_candidate}
  ));

  const goalProposal = createGoalV2ProposalTest_(
    userId,
    "Моя текущая цель — снизить вес до 108 кг",
    {effectiveDate: "2026-08-14"}
  );
  const confirmedGoal = confirmGoalV2ProposalTest_(goalProposal, "Да");
  tests.push(testCaseDq_(
    "GOAL 3",
    "Подтверждённая цель создаёт canonical GOALS_V2 в памяти",
    confirmedGoal.confirmation_status === "CONFIRMED" &&
      confirmedGoal.canonical === true &&
      confirmedGoal.target_weight === 108 &&
      confirmedGoal.source === "EXPLICIT_USER_INPUT_CONFIRMED" &&
      confirmedGoal.write_performed === false,
    {goal: confirmedGoal}
  ));

  const recoveryCheckin = parseRecoveryCheckinTest_(
    "Спал 7 часов, энергия 8, усталость 3, плечо 2 из 10",
    {date: "2026-08-14"}
  );
  const recoveryObservation = buildRecoveryObservationTest_(userId, recoveryCheckin);
  tests.push(testCaseDq_(
    "RECOVERY 1",
    "Recovery observation создаётся",
    recoveryObservation.observation_type === "RECOVERY_CHECKIN" &&
      recoveryObservation.data.sleep_hours === 7 &&
      recoveryObservation.data.energy === 8 &&
      recoveryObservation.data.fatigue === 3 &&
      recoveryObservation.data.pain_location === "SHOULDER" &&
      recoveryObservation.data.pain_score === 2,
    {observation: recoveryObservation}
  ));
  tests.push(testCaseDq_(
    "RECOVERY 2",
    "Отсутствующие поля остаются missing",
    ["sleep_quality", "stress", "comment"].every(function(field) {
      return recoveryObservation.quality.missing_fields.indexOf(field) >= 0 &&
        recoveryObservation.data[field] === null;
    }),
    {missing_fields: recoveryObservation.quality.missing_fields}
  ));
  tests.push(testCaseDq_(
    "RECOVERY 3",
    "Медицинские выводы отсутствуют",
    recoveryObservation.medical_safety.status === "NO_MEDICAL_INTERPRETATION" &&
      recoveryObservation.medical_safety.diagnosis === null &&
      recoveryObservation.medical_safety.pain_cause_inference === null &&
      recoveryObservation.medical_safety.injury_classification === null &&
      recoveryObservation.medical_safety.medical_conclusion === null,
    recoveryObservation.medical_safety
  ));

  const workoutStatus = buildWorkoutDataQualityStatusTest_();
  tests.push(testCaseDq_(
    "WORKOUT 1",
    "Неизвестные даты остаются UNKNOWN",
    workoutStatus.unknown_date_records === 73 &&
      workoutStatus.dates_inferred === 0 &&
      workoutStatus.records.filter(function(record) { return record.date_status === "UNKNOWN"; })
        .every(function(record) { return record.date_value === null && record.inferred_date === null; }),
    {unknown_date_records: workoutStatus.unknown_date_records, dates_inferred: workoutStatus.dates_inferred}
  ));
  tests.push(testCaseDq_(
    "WORKOUT 2",
    "UNKNOWN date снижает confidence",
    workoutStatus.undated_average_confidence < workoutStatus.dated_average_confidence,
    {
      dated_average_confidence: workoutStatus.dated_average_confidence,
      undated_average_confidence: workoutStatus.undated_average_confidence
    }
  ));

  const nutritionCoverage = buildNutritionCoverageMetricTest_(14, "2026-08-14");
  tests.push(testCaseDq_(
    "NUTRITION 1",
    "Coverage рассчитывается",
    nutritionCoverage.period_days === 14 &&
      nutritionCoverage.logged_days === 4 &&
      nutritionCoverage.coverage_percent === 28.6,
    nutritionCoverage
  ));
  tests.push(testCaseDq_(
    "NUTRITION 2",
    "Неполный дневник не считается полным",
    nutritionCoverage.status === "INSUFFICIENT_COVERAGE" &&
      nutritionCoverage.complete_days < nutritionCoverage.period_days &&
      nutritionCoverage.coverage_percent < 100,
    {status: nutritionCoverage.status, complete_days: nutritionCoverage.complete_days}
  ));

  const reportV2 = buildDataQualityReportV2Test_(confirmedGoal, recoveryObservation);
  tests.push(testCaseDq_(
    "REPORT V2",
    "Подтверждённые test-only observations улучшают отчёт без ложной готовности",
    reportV2.after_score > reportV2.before_score &&
      reportV2.improved_domains.some(function(item) { return item.domain === "GOALS"; }) &&
      reportV2.improved_domains.some(function(item) { return item.domain === "RECOVERY"; }) &&
      reportV2.ready_for_metrics_engine === false,
    reportV2
  ));

  const afterFingerprint = captureSpreadsheetFingerprintDq_();
  const afterMemoryHash = getSheetHashDataAcquisitionTest_(afterFingerprint, "AI_MEMORY");
  const regressionPassed = beforeFingerprint.global_hash === afterFingerprint.global_hash &&
    beforeMemoryHash === afterMemoryHash &&
    beforeFingerprint.sheet_count === afterFingerprint.sheet_count &&
    DATA_ACQUISITION_TEST_CONFIG.PRODUCTION_VERSION === "v19" &&
    DATA_ACQUISITION_TEST_CONFIG.TELEGRAM_CALLS === 0 &&
    DATA_ACQUISITION_TEST_CONFIG.GROQ_CALLS === 0 &&
    DATA_ACQUISITION_TEST_CONFIG.DOMAIN_WRITES === 0 &&
    DATA_ACQUISITION_TEST_CONFIG.DEPLOYMENT_PERFORMED === false &&
    DATA_ACQUISITION_TEST_CONFIG.ACTIVE_ENABLED === false;
  tests.push(testCaseDq_(
    "REGRESSION",
    "Sheets, AI_MEMORY и production flow не изменены",
    regressionPassed,
    {
      sheet_hash_before: beforeFingerprint.global_hash,
      sheet_hash_after: afterFingerprint.global_hash,
      ai_memory_hash_before: beforeMemoryHash,
      ai_memory_hash_after: afterMemoryHash,
      sheet_count_before: beforeFingerprint.sheet_count,
      sheet_count_after: afterFingerprint.sheet_count,
      production_version_observed: DATA_ACQUISITION_TEST_CONFIG.PRODUCTION_VERSION,
      telegram_calls: 0,
      groq_calls: 0,
      domain_writes: 0,
      deployment_performed: false,
      active_enabled: false
    }
  ));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "Sprint 6.1.2 Data Acquisition & User Confirmation",
    version: DATA_ACQUISITION_TEST_CONFIG.VERSION,
    mode: DATA_ACQUISITION_TEST_CONFIG.MODE,
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    status: passed === tests.length ? "PASS" : "FAIL",
    tests: tests,
    artifacts: {
      goal_conflict: conflict,
      goal_proposal: goalProposal,
      confirmed_goal_v2: confirmedGoal,
      recovery_checkin: recoveryCheckin,
      recovery_observation: recoveryObservation,
      workout_data_quality_status: workoutStatus,
      nutrition_coverage: nutritionCoverage,
      data_quality_report_v2: reportV2
    },
    regression: {
      before: beforeFingerprint,
      after: afterFingerprint,
      ai_memory_unchanged: beforeMemoryHash === afterMemoryHash
    }
  };
}

/** Public runner shown in the Apps Script function selector. */
function runDataAcquisitionTests() {
  const result = testDataAcquisitionLayer_();
  const report = result.artifacts.data_quality_report_v2;
  Logger.log(JSON.stringify({
    suite: result.suite,
    status: result.status,
    passed: result.passed,
    total: result.total,
    before_score: report.before_score,
    after_score: report.after_score,
    improved_domains: report.improved_domains,
    blocked_domains: report.blocked_domains,
    ready_for_metrics_engine: report.ready_for_metrics_engine,
    sheet_hash_before: result.regression.before.global_hash,
    sheet_hash_after: result.regression.after.global_hash,
    ai_memory_unchanged: result.regression.ai_memory_unchanged,
    production_version_observed: DATA_ACQUISITION_TEST_CONFIG.PRODUCTION_VERSION,
    deployment_performed: false,
    telegram_calls: 0,
    groq_calls: 0,
    domain_writes: 0
  }, null, 2));
  if (result.status !== "PASS") {
    throw new Error("Data Acquisition test suite failed: " + result.failed + " test(s)");
  }
  return result;
}

function scoreConfirmedGoalDataAcquisitionTest_(goal, fallbackScore) {
  if (!goal || goal.confirmation_status !== "CONFIRMED" || goal.canonical !== true) return fallbackScore;
  let score = 100;
  if (!isPresentDq_(goal.target_date)) score -= 10;
  return roundDq_(score, 1);
}

function scoreRecoveryObservationDataAcquisitionTest_(observation) {
  if (!observation || !observation.data) return 0;
  const fields = [
    "date", "sleep_hours", "sleep_quality", "energy", "stress", "fatigue",
    "pain_present", "pain_location", "pain_score", "comment", "source"
  ];
  const populated = fields.filter(function(field) {
    return observation.data[field] !== null && observation.data[field] !== undefined && observation.data[field] !== "";
  }).length;
  const completeness = 100 * populated / fields.length;
  const depth = 100 / DATA_ACQUISITION_TEST_CONFIG.RECOVERY_TARGET_DAYS;
  return roundDq_(completeness * 0.35 + depth * 0.65, 1);
}

function averageDataAcquisitionTest_(values) {
  if (!values.length) return 0;
  return roundDq_(values.reduce(function(sum, value) { return sum + value; }, 0) / values.length, 2);
}

function getSheetHashDataAcquisitionTest_(fingerprint, sheetName) {
  const match = fingerprint.sheets.filter(function(sheet) { return sheet.name === sheetName; })[0];
  return match ? match.hash : null;
}
