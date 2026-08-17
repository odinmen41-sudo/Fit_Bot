/**
 * Sprint 6.1.1 — TEST-ONLY Data Quality & Cleanup Layer.
 *
 * Safety contract:
 * - read-only access to existing spreadsheet data;
 * - no sheet, property, Telegram, Groq, webhook or Memory Layer writes;
 * - no automatic corrections and no inferred legacy dates;
 * - no fitness metrics, recommendations or production integration.
 */
const DATA_QUALITY_TEST_CONFIG = Object.freeze({
  ALGORITHM_VERSION: "data-quality-cleanup-test-v1.0",
  MODE: "TEST_ONLY",
  PRODUCTION_VERSION: "v19",
  EXPECTED_LEGACY_WORKOUT_ROWS_WITHOUT_DATE: 73,
  BODY_MIN_RECORDS_FOR_TREND_QUALITY: 8,
  NUTRITION_WINDOW_DAYS: 14,
  NUTRITION_MIN_COVERED_DAYS: 7,
  NUTRITION_FRESHNESS_DAYS: 3,
  SHEETS: Object.freeze({
    PROFILE: "User_Profile",
    BODY: "Body_Tracking",
    WORKOUT: "Workout_Log",
    NUTRITION: "Nutrition_Log",
    RECOVERY: "Recovery_Log",
    GOALS: "Goals",
    MEMORY: "AI_MEMORY"
  })
});

/**
 * Audits every Workout_Log record without changing data.
 *
 * @return {Object} deterministic workout data-quality result.
 */
function auditWorkoutDataQuality_() {
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

  const fields = ["date", "exercise", "weight", "sets", "reps", "rpe", "pain"];
  const missingFields = fields.reduce(function(acc, field) {
    acc[field] = 0;
    return acc;
  }, {});

  const rowAudits = table.rows.map(function(row, rowIndex) {
    const presence = {};
    fields.forEach(function(field) {
      presence[field] = indexes[field] >= 0 && isPresentDq_(row[indexes[field]]);
      if (!presence[field]) missingFields[field] += 1;
    });

    const flags = [];
    if (!presence.date) flags.push("LEGACY_DATE_MISSING");
    if (!presence.exercise) flags.push("EXERCISE_MISSING");
    if (!presence.weight) flags.push("WEIGHT_MISSING_OR_BODYWEIGHT_UNSPECIFIED");
    if (!presence.sets) flags.push("SETS_MISSING");
    if (!presence.reps) flags.push("REPS_MISSING");
    if (!presence.rpe) flags.push("RPE_MISSING");
    if (!presence.pain) flags.push("PAIN_STATUS_NOT_RECORDED");

    return {
      sheet_row: rowIndex + 2,
      has_date: presence.date,
      has_exercise: presence.exercise,
      has_weight: presence.weight,
      has_sets: presence.sets,
      has_reps: presence.reps,
      has_rpe: presence.rpe,
      has_pain: presence.pain,
      flags: flags
    };
  });

  const totalRecords = table.rows.length;
  const datedRecords = totalRecords - missingFields.date;
  const possibleValues = totalRecords * fields.length;
  const missingValues = fields.reduce(function(total, field) {
    return total + missingFields[field];
  }, 0);
  const completeness = possibleValues > 0
    ? roundDq_(100 * (possibleValues - missingValues) / possibleValues, 1)
    : 0;

  const flags = [];
  if (missingFields.date > 0) flags.push("LEGACY_DATE_MISSING");
  if (missingFields.exercise > 0) flags.push("EXERCISE_DATA_INCOMPLETE");
  if (missingFields.weight > 0) flags.push("WEIGHT_DATA_INCOMPLETE");
  if (missingFields.sets > 0) flags.push("SETS_DATA_INCOMPLETE");
  if (missingFields.reps > 0) flags.push("REPS_DATA_INCOMPLETE");
  if (missingFields.rpe > 0) flags.push("RPE_DATA_INCOMPLETE");
  if (missingFields.pain > 0) flags.push("PAIN_DATA_INCOMPLETE");
  if (missingFields.date > 0) flags.push("TRAINING_METRICS_BLOCKED");

  return {
    domain: "TRAINING",
    status: missingFields.date > 0 ? "BAD_DATA" : (flags.length ? "LIMITED_DATA" : "READY"),
    total_records: totalRecords,
    dated_records: datedRecords,
    missing_date_records: missingFields.date,
    missing_fields: missingFields,
    quality_score: completeness,
    flags: flags,
    row_audits: rowAudits,
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.WORKOUT,
    read_only: true
  };
}

/**
 * Builds confirmation-only mapping proposals for undated legacy workouts.
 * A date is never guessed or restored.
 *
 * @return {Object} proposal envelope and one proposal per undated row.
 */
function buildWorkoutDateMappingProposal_() {
  const audit = auditWorkoutDataQuality_();
  const proposals = audit.row_audits
    .filter(function(rowAudit) { return !rowAudit.has_date; })
    .map(function(rowAudit) {
      return {
        legacy_row: rowAudit.sheet_row,
        date: null,
        proposal: "NEEDS_USER_CONFIRMATION",
        confidence: 0,
        evidence: [],
        invented_value: false
      };
    });

  return {
    mode: "PROPOSAL_ONLY",
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.WORKOUT,
    proposal_count: proposals.length,
    dates_restored: 0,
    requires_user_confirmation: proposals.length,
    proposals: proposals,
    write_performed: false
  };
}

/**
 * Audits the authoritative goal sources and reports memory-only conflicts.
 * AI_MEMORY is never promoted to an authoritative goal value.
 *
 * @return {Object} goal quality and conflict report.
 */
function auditGoalDataQuality_() {
  const goals = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.GOALS);
  const profile = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.PROFILE);
  const memory = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.MEMORY);

  const goalIndexes = resolveHeaderIndexesDq_(goals.headers, {
    goal: ["Цель", "goal"],
    startDate: ["Дата старта", "start_date"],
    target: ["Целевое значение", "target_weight", "target"],
    current: ["Текущее значение", "current_weight", "current"],
    status: ["Статус", "status"],
    targetDate: ["Дата цели", "target_date"],
    milestones: ["Этапы", "milestones"],
    goalVersion: ["Версия цели", "goal_version"]
  });
  const profileIndexes = resolveHeaderIndexesDq_(profile.headers, {
    userId: ["User_ID", "user_id"],
    goal: ["Цель", "goal"],
    startWeight: ["Вес старт", "start_weight"],
    currentWeight: ["Текущий вес", "current_weight"],
    targetWeight: ["Целевой вес", "target_weight"]
  });
  const memoryIndexes = resolveHeaderIndexesDq_(memory.headers, {
    userId: ["user_id", "User_ID"],
    category: ["category"],
    key: ["key"],
    value: ["value"]
  });

  const goalRow = goals.rows.length ? goals.rows[0] : [];
  const profileRow = profile.rows.length ? profile.rows[0] : [];
  const userId = getCellDq_(profileRow, profileIndexes.userId);

  const baseline = parseNumberDq_(getCellDq_(profileRow, profileIndexes.startWeight));
  const goalTarget = parseNumberDq_(getCellDq_(goalRow, goalIndexes.target));
  const profileTarget = parseNumberDq_(getCellDq_(profileRow, profileIndexes.targetWeight));
  const authoritativeTarget = goalTarget !== null ? goalTarget : profileTarget;
  const startDate = normalizeDateOutputDq_(getCellDq_(goalRow, goalIndexes.startDate));
  const targetDate = normalizeDateOutputDq_(getCellDq_(goalRow, goalIndexes.targetDate));
  const milestones = getCellDq_(goalRow, goalIndexes.milestones);
  const goalVersion = getCellDq_(goalRow, goalIndexes.goalVersion);
  const rawStatus = getCellDq_(goalRow, goalIndexes.status);
  const normalizedStatus = normalizeGoalStatusDq_(rawStatus);
  const rawGoal = getCellDq_(goalRow, goalIndexes.goal) || getCellDq_(profileRow, profileIndexes.goal);

  const memoryTarget = findMemoryValueDq_(memory.rows, memoryIndexes, userId, "goal", "target_weight");
  const conflicts = [];
  if (authoritativeTarget === null && isPresentDq_(memoryTarget)) {
    conflicts.push({
      field: "target_weight",
      type: "AUTHORITATIVE_VALUE_MISSING_MEMORY_VALUE_PRESENT",
      authoritative_value: null,
      memory_value: String(memoryTarget),
      resolution: "NEEDS_USER_CONFIRMATION",
      memory_is_authoritative: false
    });
  } else if (authoritativeTarget !== null && isPresentDq_(memoryTarget)) {
    const parsedMemoryTarget = parseNumberDq_(memoryTarget);
    if (parsedMemoryTarget !== null && parsedMemoryTarget !== authoritativeTarget) {
      conflicts.push({
        field: "target_weight",
        type: "SOURCE_VALUE_CONFLICT",
        authoritative_value: authoritativeTarget,
        memory_value: String(memoryTarget),
        resolution: "NEEDS_USER_CONFIRMATION",
        memory_is_authoritative: false
      });
    }
  }

  const required = {
    baseline_weight: baseline,
    target_weight: authoritativeTarget,
    start_date: startDate,
    target_date: targetDate,
    milestones: milestones,
    goal_version: goalVersion,
    status: normalizedStatus
  };
  const missingFields = Object.keys(required).filter(function(key) {
    return !isPresentDq_(required[key]) || (Array.isArray(required[key]) && required[key].length === 0);
  });
  const qualityScore = roundDq_(100 * (Object.keys(required).length - missingFields.length) / Object.keys(required).length, 1);

  const flags = [];
  if (missingFields.indexOf("target_weight") >= 0) flags.push("GOAL_TARGET_MISSING");
  if (missingFields.indexOf("start_date") >= 0 || missingFields.indexOf("target_date") >= 0) {
    flags.push("GOAL_DATES_INCOMPLETE");
  }
  if (missingFields.indexOf("milestones") >= 0) flags.push("GOAL_MILESTONES_MISSING");
  if (missingFields.indexOf("goal_version") >= 0) flags.push("GOAL_VERSION_MISSING");
  if (conflicts.length > 0) flags.push("GOAL_SOURCE_CONFLICT");
  if (missingFields.length > 0) flags.push("GOALS_V2_MIGRATION_REQUIRED");

  return {
    domain: "GOALS",
    status: missingFields.length > 0 || conflicts.length > 0 ? "BAD_DATA" : "READY",
    user_id: isPresentDq_(userId) ? String(userId) : null,
    goal_type: normalizeGoalTypeDq_(rawGoal),
    baseline_weight: baseline,
    current_weight: parseNumberDq_(getCellDq_(goalRow, goalIndexes.current)) ||
      parseNumberDq_(getCellDq_(profileRow, profileIndexes.currentWeight)),
    target_weight: authoritativeTarget,
    start_date: startDate,
    target_date: targetDate,
    goal_status: normalizedStatus,
    missing_fields: missingFields,
    quality_score: qualityScore,
    flags: flags,
    conflicts: conflicts,
    authoritative_sources: [DATA_QUALITY_TEST_CONFIG.SHEETS.GOALS, DATA_QUALITY_TEST_CONFIG.SHEETS.PROFILE],
    non_authoritative_sources_checked: [DATA_QUALITY_TEST_CONFIG.SHEETS.MEMORY],
    read_only: true
  };
}

/**
 * Maps the current goal to a Goals V2 candidate in memory only.
 *
 * @return {Object} in-memory mapping proposal.
 */
function mapCurrentGoalsToGoalsV2Test_() {
  const audit = auditGoalDataQuality_();
  return {
    mapping_version: "goals-v2-test-v1.0",
    mode: "IN_MEMORY_ONLY",
    sheet_created: false,
    write_performed: false,
    user_id: audit.user_id,
    goal_type: audit.goal_type,
    baseline: audit.baseline_weight,
    current: audit.current_weight,
    target: audit.target_weight,
    start_date: audit.start_date,
    target_date: audit.target_date,
    milestones: [],
    goal_version: null,
    status: audit.goal_status,
    missing: audit.missing_fields.slice(),
    conflicts: deepCloneDq_(audit.conflicts),
    proposal: "NEEDS_USER_CONFIRMATION"
  };
}

/**
 * Audits Recovery_Log availability and required check-in fields.
 *
 * @return {Object} recovery data-quality result.
 */
function auditRecoveryDataQuality_() {
  const table = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.RECOVERY);
  const aliases = {
    date: ["Дата", "date"],
    sleep_hours: ["Сон часы", "sleep", "sleep_hours"],
    sleep_quality: ["Качество сна", "sleep_quality"],
    stress: ["Стресс", "stress"],
    fatigue: ["Усталость", "fatigue"],
    shoulder_pain: ["Боль плечо", "shoulder_pain"],
    lower_back_pain: ["Боль поясница", "lower_back_pain"],
    energy: ["Энергия", "energy"],
    other_pain: ["Боль другая/локализация", "other_pain"],
    comment: ["Комментарий", "comment"]
  };
  const indexes = resolveHeaderIndexesDq_(table.headers, aliases);
  const availableFields = Object.keys(indexes).filter(function(key) { return indexes[key] >= 0; });

  const requiredAvailability = {
    sleep: table.rows.some(function(row) {
      return isPresentDq_(getCellDq_(row, indexes.sleep_hours)) ||
        isPresentDq_(getCellDq_(row, indexes.sleep_quality));
    }),
    energy: table.rows.some(function(row) { return isPresentDq_(getCellDq_(row, indexes.energy)); }),
    stress: table.rows.some(function(row) { return isPresentDq_(getCellDq_(row, indexes.stress)); }),
    pain: table.rows.some(function(row) {
      return isPresentDq_(getCellDq_(row, indexes.shoulder_pain)) ||
        isPresentDq_(getCellDq_(row, indexes.lower_back_pain)) ||
        isPresentDq_(getCellDq_(row, indexes.other_pain));
    })
  };
  const missingRequiredData = Object.keys(requiredAvailability).filter(function(key) {
    return !requiredAvailability[key];
  });
  const recordsCount = table.rows.length;

  return {
    domain: "RECOVERY",
    records_count: recordsCount,
    available_fields: availableFields,
    missing_required_data: missingRequiredData,
    status: recordsCount === 0 ? "NO_DATA" : (missingRequiredData.length ? "LIMITED_DATA" : "READY"),
    quality_score: recordsCount === 0 ? 0 : roundDq_(100 * (4 - missingRequiredData.length) / 4, 1),
    flags: recordsCount === 0 ? ["RECOVERY_NO_DATA", "RECOVERY_METRICS_BLOCKED"] :
      (missingRequiredData.length ? ["RECOVERY_DATA_INCOMPLETE"] : []),
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.RECOVERY,
    read_only: true
  };
}

/**
 * Combines BODY, TRAINING, NUTRITION, RECOVERY and GOALS quality reports.
 *
 * @return {Object} complete read-only Data Quality Report.
 */
function buildDataQualityReport_() {
  const body = auditBodyDataQualityDq_();
  const training = auditWorkoutDataQuality_();
  const nutrition = auditNutritionDataQualityDq_();
  const recovery = auditRecoveryDataQuality_();
  const goals = auditGoalDataQuality_();

  const blockingIssues = [];
  if (body.status !== "READY") {
    blockingIssues.push(blockingIssueDq_(
      "BODY_TREND_DEPTH_INSUFFICIENT", "BODY", body.status === "NO_DATA" ? "BLOCKER" : "HIGH",
      "Недостаточно качественных датированных измерений для устойчивого тренда веса.",
      {records_count: body.records_count, required_records: DATA_QUALITY_TEST_CONFIG.BODY_MIN_RECORDS_FOR_TREND_QUALITY}
    ));
  }
  if (training.missing_date_records > 0) {
    blockingIssues.push(blockingIssueDq_(
      "TRAINING_DATES_MISSING", "TRAINING", "BLOCKER",
      "Тренировочный прогресс, нагрузка и частота заблокированы: у legacy-записей нет дат.",
      {missing_date_records: training.missing_date_records}
    ));
  }
  if (nutrition.status !== "READY") {
    blockingIssues.push(blockingIssueDq_(
      "NUTRITION_COVERAGE_INSUFFICIENT", "NUTRITION", "HIGH",
      "Покрытие и свежесть журнала питания недостаточны для надёжного Metrics Engine.",
      {covered_days: nutrition.recent_window.covered_days, window_days: nutrition.recent_window.window_days}
    ));
  }
  if (recovery.status !== "READY") {
    blockingIssues.push(blockingIssueDq_(
      "RECOVERY_DATA_UNAVAILABLE", "RECOVERY", "BLOCKER",
      "Нет фактических check-in данных по сну, энергии, стрессу и боли.",
      {records_count: recovery.records_count, missing_required_data: recovery.missing_required_data}
    ));
  }
  if (goals.missing_fields.length > 0) {
    blockingIssues.push(blockingIssueDq_(
      "GOAL_DEFINITION_INCOMPLETE", "GOALS", "BLOCKER",
      "Цель неполна и не может использоваться для расчёта goal progress.",
      {missing_fields: goals.missing_fields}
    ));
  }
  if (goals.conflicts.length > 0) {
    blockingIssues.push(blockingIssueDq_(
      "GOAL_SOURCE_CONFLICT", "GOALS", "BLOCKER",
      "Значение цели есть только в неавторитетной памяти и требует подтверждения пользователя.",
      {conflicts: goals.conflicts}
    ));
  }

  const globalQualityScore = roundDq_(
    body.quality_score * 0.20 +
    training.quality_score * 0.30 +
    nutrition.quality_score * 0.20 +
    recovery.quality_score * 0.15 +
    goals.quality_score * 0.15,
    1
  );

  return {
    generated_at: new Date().toISOString(),
    algorithm_version: DATA_QUALITY_TEST_CONFIG.ALGORITHM_VERSION,
    mode: DATA_QUALITY_TEST_CONFIG.MODE,
    production_version_observed: DATA_QUALITY_TEST_CONFIG.PRODUCTION_VERSION,
    principle: "BAD_DATA > NO_DATA > FALSE_CONFIDENCE",
    domains: {
      BODY: body,
      TRAINING: training,
      NUTRITION: nutrition,
      RECOVERY: recovery,
      GOALS: goals
    },
    global_quality_score: globalQualityScore,
    blocking_issues: blockingIssues,
    ready_for_metrics_engine: blockingIssues.every(function(issue) { return issue.severity !== "BLOCKER"; }),
    automatic_fixes_performed: 0,
    writes_performed: 0,
    recommendations_generated: 0
  };
}

/**
 * Acceptance suite for Sprint 6.1.1.
 *
 * @return {Object} six deterministic test results plus the full report.
 */
function testDataQualityCleanup_() {
  const before = captureSpreadsheetFingerprintDq_();
  const tests = [];

  const workout = auditWorkoutDataQuality_();
  tests.push(testCaseDq_(
    "TEST 1",
    "Workout без дат определяется",
    workout.missing_date_records === DATA_QUALITY_TEST_CONFIG.EXPECTED_LEGACY_WORKOUT_ROWS_WITHOUT_DATE &&
      workout.flags.indexOf("LEGACY_DATE_MISSING") >= 0,
    {
      expected_missing_date_records: DATA_QUALITY_TEST_CONFIG.EXPECTED_LEGACY_WORKOUT_ROWS_WITHOUT_DATE,
      actual_missing_date_records: workout.missing_date_records
    }
  ));

  const mapping = buildWorkoutDateMappingProposal_();
  const noInventedDates = mapping.proposals.every(function(proposal) {
    return proposal.date === null &&
      proposal.proposal === "NEEDS_USER_CONFIRMATION" &&
      proposal.confidence === 0 &&
      proposal.invented_value === false;
  });
  tests.push(testCaseDq_(
    "TEST 2",
    "Система НЕ восстанавливает даты",
    mapping.proposal_count === workout.missing_date_records && mapping.dates_restored === 0 && noInventedDates,
    {
      proposals: mapping.proposal_count,
      dates_restored: mapping.dates_restored,
      all_dates_null: noInventedDates
    }
  ));

  const goals = auditGoalDataQuality_();
  tests.push(testCaseDq_(
    "TEST 3",
    "Goals conflict определяется",
    goals.flags.indexOf("GOAL_SOURCE_CONFLICT") >= 0 && goals.conflicts.length > 0,
    {conflicts: goals.conflicts}
  ));

  const recovery = auditRecoveryDataQuality_();
  tests.push(testCaseDq_(
    "TEST 4",
    "Recovery empty определяется",
    recovery.records_count === 0 && recovery.status === "NO_DATA",
    {records_count: recovery.records_count, status: recovery.status}
  ));

  const reportOne = buildDataQualityReport_();
  const reportTwo = buildDataQualityReport_();
  const stableHashOne = digestHexDq_(JSON.stringify(stableReportDq_(reportOne)));
  const stableHashTwo = digestHexDq_(JSON.stringify(stableReportDq_(reportTwo)));
  tests.push(testCaseDq_(
    "TEST 5",
    "Повторный запуск даёт одинаковый результат",
    stableHashOne === stableHashTwo,
    {first_hash: stableHashOne, second_hash: stableHashTwo}
  ));

  const after = captureSpreadsheetFingerprintDq_();
  tests.push(testCaseDq_(
    "TEST 6",
    "Google Sheets не изменяются",
    before.global_hash === after.global_hash && before.sheet_count === after.sheet_count,
    {
      before_hash: before.global_hash,
      after_hash: after.global_hash,
      sheet_count_before: before.sheet_count,
      sheet_count_after: after.sheet_count
    }
  ));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "Sprint 6.1.1 Data Quality & Cleanup",
    mode: DATA_QUALITY_TEST_CONFIG.MODE,
    production_version_observed: DATA_QUALITY_TEST_CONFIG.PRODUCTION_VERSION,
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    status: passed === tests.length ? "PASS" : "FAIL",
    tests: tests,
    data_quality_report: reportOne,
    workout_date_mapping_proposal: mapping,
    goals_v2_mapping: mapCurrentGoalsToGoalsV2Test_(),
    sheet_integrity: {before: before, after: after},
    deployment_performed: false,
    telegram_calls: 0,
    groq_calls: 0,
    automatic_fixes: 0
  };
}

/**
 * Public Apps Script runner because functions ending with underscore are hidden
 * from the editor's function selector.
 *
 * @return {Object} complete suite result.
 */
function runDataQualityCleanupTests() {
  const result = testDataQualityCleanup_();
  Logger.log(JSON.stringify({
    suite: result.suite,
    status: result.status,
    passed: result.passed,
    total: result.total,
    global_quality_score: result.data_quality_report.global_quality_score,
    ready_for_metrics_engine: result.data_quality_report.ready_for_metrics_engine,
    blocking_issue_codes: result.data_quality_report.blocking_issues.map(function(issue) { return issue.code; }),
    sheet_hash_before: result.sheet_integrity.before.global_hash,
    sheet_hash_after: result.sheet_integrity.after.global_hash
  }, null, 2));

  if (result.status !== "PASS") {
    throw new Error("Data Quality Cleanup test suite failed: " + (result.total - result.passed) + " test(s)");
  }
  return result;
}

/**
 * Public read-only runner for inspecting the full report independently.
 *
 * @return {Object} full Data Quality Report.
 */
function runDataQualityReportTest() {
  const report = buildDataQualityReport_();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

function auditBodyDataQualityDq_() {
  const table = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.BODY);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"],
    weight: ["Вес", "weight"]
  });
  const rows = table.rows.map(function(row, rowIndex) {
    return {
      sheet_row: rowIndex + 2,
      date: normalizeDateOutputDq_(getCellDq_(row, indexes.date)),
      weight: parseNumberDq_(getCellDq_(row, indexes.weight))
    };
  });
  const validRows = rows.filter(function(row) { return row.date !== null && row.weight !== null; });
  const missingDate = rows.filter(function(row) { return row.date === null; }).length;
  const missingWeight = rows.filter(function(row) { return row.weight === null; }).length;
  const completeness = rows.length > 0
    ? 100 * ((rows.length * 2 - missingDate - missingWeight) / (rows.length * 2))
    : 0;
  const depthRatio = Math.min(1, validRows.length / DATA_QUALITY_TEST_CONFIG.BODY_MIN_RECORDS_FOR_TREND_QUALITY);
  const qualityScore = roundDq_(completeness * 0.70 + depthRatio * 100 * 0.30, 1);
  const flags = [];
  if (rows.length === 0) flags.push("BODY_NO_DATA");
  if (missingDate > 0) flags.push("BODY_DATE_MISSING");
  if (missingWeight > 0) flags.push("BODY_WEIGHT_MISSING");
  if (validRows.length < DATA_QUALITY_TEST_CONFIG.BODY_MIN_RECORDS_FOR_TREND_QUALITY) {
    flags.push("BODY_TREND_DEPTH_INSUFFICIENT");
  }

  return {
    domain: "BODY",
    status: rows.length === 0 ? "NO_DATA" :
      (validRows.length < DATA_QUALITY_TEST_CONFIG.BODY_MIN_RECORDS_FOR_TREND_QUALITY ? "LIMITED_DATA" : "READY"),
    records_count: rows.length,
    valid_dated_weight_records: validRows.length,
    missing_fields: {date: missingDate, weight: missingWeight},
    minimum_records_for_trend_quality: DATA_QUALITY_TEST_CONFIG.BODY_MIN_RECORDS_FOR_TREND_QUALITY,
    quality_score: qualityScore,
    flags: flags,
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.BODY,
    read_only: true
  };
}

function auditNutritionDataQualityDq_() {
  const table = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.NUTRITION);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"],
    calories: ["Ккал", "calories"],
    protein: ["Белок", "protein"],
    fat: ["Жиры", "fat"],
    carbs: ["Углеводы", "carbs"]
  });
  const required = ["date", "calories", "protein", "fat", "carbs"];
  const missing = required.reduce(function(acc, field) { acc[field] = 0; return acc; }, {});
  const dates = [];

  table.rows.forEach(function(row) {
    required.forEach(function(field) {
      if (indexes[field] < 0 || !isPresentDq_(row[indexes[field]])) missing[field] += 1;
    });
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    if (date) dates.push(date);
  });

  const totalRecords = table.rows.length;
  const totalPossible = totalRecords * required.length;
  const totalMissing = required.reduce(function(total, field) { return total + missing[field]; }, 0);
  const completeness = totalPossible > 0 ? 100 * (totalPossible - totalMissing) / totalPossible : 0;
  const today = startOfDayDq_(new Date());
  const cutoff = new Date(today.getTime() - (DATA_QUALITY_TEST_CONFIG.NUTRITION_WINDOW_DAYS - 1) * 86400000);
  const coveredDaysMap = {};
  dates.forEach(function(date) {
    const day = startOfDayDq_(date);
    if (day.getTime() >= cutoff.getTime() && day.getTime() <= today.getTime()) {
      coveredDaysMap[formatDateKeyDq_(day)] = true;
    }
  });
  const coveredDays = Object.keys(coveredDaysMap).length;
  const latestDate = dates.length ? dates.reduce(function(latest, date) {
    return date.getTime() > latest.getTime() ? date : latest;
  }) : null;
  const ageDays = latestDate ? Math.max(0, Math.floor((today.getTime() - startOfDayDq_(latestDate).getTime()) / 86400000)) : null;
  const coverageScore = Math.min(100, 100 * coveredDays / DATA_QUALITY_TEST_CONFIG.NUTRITION_WINDOW_DAYS);
  const freshnessScore = ageDays === null ? 0 : (ageDays <= DATA_QUALITY_TEST_CONFIG.NUTRITION_FRESHNESS_DAYS ? 100 : 0);
  const qualityScore = roundDq_(completeness * 0.60 + coverageScore * 0.25 + freshnessScore * 0.15, 1);
  const ready = totalRecords > 0 &&
    coveredDays >= DATA_QUALITY_TEST_CONFIG.NUTRITION_MIN_COVERED_DAYS &&
    ageDays !== null && ageDays <= DATA_QUALITY_TEST_CONFIG.NUTRITION_FRESHNESS_DAYS &&
    totalMissing === 0;
  const flags = [];
  if (totalRecords === 0) flags.push("NUTRITION_NO_DATA");
  if (totalMissing > 0) flags.push("NUTRITION_FIELDS_INCOMPLETE");
  if (coveredDays < DATA_QUALITY_TEST_CONFIG.NUTRITION_MIN_COVERED_DAYS) flags.push("NUTRITION_COVERAGE_LOW");
  if (ageDays === null || ageDays > DATA_QUALITY_TEST_CONFIG.NUTRITION_FRESHNESS_DAYS) flags.push("NUTRITION_DATA_STALE");

  return {
    domain: "NUTRITION",
    status: totalRecords === 0 ? "NO_DATA" : (ready ? "READY" : "LIMITED_DATA"),
    records_count: totalRecords,
    missing_fields: missing,
    recent_window: {
      window_days: DATA_QUALITY_TEST_CONFIG.NUTRITION_WINDOW_DAYS,
      covered_days: coveredDays,
      minimum_covered_days: DATA_QUALITY_TEST_CONFIG.NUTRITION_MIN_COVERED_DAYS,
      latest_record_date: latestDate ? formatDateKeyDq_(latestDate) : null,
      data_age_days: ageDays
    },
    quality_score: qualityScore,
    flags: flags,
    source_sheet: DATA_QUALITY_TEST_CONFIG.SHEETS.NUTRITION,
    read_only: true
  };
}

function readTableDq_(sheetName) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("Required sheet not found: " + sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow === 0 || lastColumn === 0) {
    return {sheet_name: sheetName, headers: [], rows: []};
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values.length ? values[0] : [];
  const rows = values.slice(1).filter(function(row) {
    return row.some(isPresentDq_);
  });
  return {sheet_name: sheetName, headers: headers, rows: rows};
}

function resolveHeaderIndexesDq_(headers, aliasesByField) {
  const normalizedHeaders = headers.map(normalizeTextDq_);
  const indexes = {};
  Object.keys(aliasesByField).forEach(function(field) {
    indexes[field] = -1;
    aliasesByField[field].some(function(alias) {
      const found = normalizedHeaders.indexOf(normalizeTextDq_(alias));
      if (found >= 0) {
        indexes[field] = found;
        return true;
      }
      return false;
    });
  });
  return indexes;
}

function getCellDq_(row, index) {
  return index >= 0 && index < row.length ? row[index] : null;
}

function findMemoryValueDq_(rows, indexes, userId, category, key) {
  const targetUserId = isPresentDq_(userId) ? String(userId) : null;
  for (let i = 0; i < rows.length; i += 1) {
    const rowUserId = getCellDq_(rows[i], indexes.userId);
    const sameUser = targetUserId === null || String(rowUserId) === targetUserId;
    if (sameUser &&
        normalizeTextDq_(getCellDq_(rows[i], indexes.category)) === normalizeTextDq_(category) &&
        normalizeTextDq_(getCellDq_(rows[i], indexes.key)) === normalizeTextDq_(key)) {
      return getCellDq_(rows[i], indexes.value);
    }
  }
  return null;
}

function normalizeGoalTypeDq_(value) {
  const normalized = normalizeTextDq_(value);
  if (normalized.indexOf("снижен") >= 0 && normalized.indexOf("вес") >= 0) return "WEIGHT_LOSS";
  if (normalized.indexOf("жиров") >= 0) return "WEIGHT_LOSS";
  if (normalized.indexOf("мыш") >= 0) return "MUSCLE_GAIN";
  return normalized ? "OTHER" : "UNKNOWN";
}

function normalizeGoalStatusDq_(value) {
  const normalized = normalizeTextDq_(value);
  if (normalized === "активна" || normalized === "активная" || normalized === "active") return "ACTIVE";
  if (normalized === "завершена" || normalized === "completed") return "COMPLETED";
  if (normalized === "пауза" || normalized === "paused") return "PAUSED";
  return normalized ? String(value).trim().toUpperCase() : null;
}

function normalizeDateOutputDq_(value) {
  const date = parseDateDq_(value);
  return date ? formatDateKeyDq_(date) : null;
}

function parseDateDq_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return new Date(value.getTime());
  if (!isPresentDq_(value)) return null;
  const text = String(value).trim();
  let match = text.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return null;
}

function parseNumberDq_(value) {
  if (typeof value === "number" && isFinite(value)) return value;
  if (!isPresentDq_(value)) return null;
  const match = String(value).replace(/\s/g, "").replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function isPresentDq_(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function normalizeTextDq_(value) {
  return isPresentDq_(value)
    ? String(value).trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ")
    : "";
}

function startOfDayDq_(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDateKeyDq_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone() || "Europe/Moscow", "yyyy-MM-dd");
}

function roundDq_(value, decimals) {
  const factor = Math.pow(10, decimals || 0);
  return Math.round(value * factor) / factor;
}

function blockingIssueDq_(code, domain, severity, message, evidence) {
  return {
    code: code,
    domain: domain,
    severity: severity,
    message: message,
    evidence: evidence,
    automatic_resolution_allowed: false
  };
}

function testCaseDq_(id, name, passed, details) {
  return {
    id: id,
    name: name,
    status: passed ? "PASS" : "FAIL",
    details: details
  };
}

function stableReportDq_(report) {
  const clone = deepCloneDq_(report);
  delete clone.generated_at;
  return clone;
}

function deepCloneDq_(value) {
  return JSON.parse(JSON.stringify(value));
}

function captureSpreadsheetFingerprintDq_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = spreadsheet.getSheets().slice().sort(function(a, b) {
    return a.getSheetId() - b.getSheetId();
  });
  const sheetFingerprints = sheets.map(function(sheet) {
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    const values = lastRow > 0 && lastColumn > 0
      ? sheet.getRange(1, 1, lastRow, lastColumn).getValues().map(function(row) {
          return row.map(normalizeFingerprintValueDq_);
        })
      : [];
    return {
      sheet_id: sheet.getSheetId(),
      name: sheet.getName(),
      last_row: lastRow,
      last_column: lastColumn,
      hash: digestHexDq_(JSON.stringify(values))
    };
  });
  return {
    sheet_count: sheetFingerprints.length,
    sheets: sheetFingerprints,
    global_hash: digestHexDq_(JSON.stringify(sheetFingerprints))
  };
}

function normalizeFingerprintValueDq_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return {type: "DATE", value: value.toISOString()};
  if (typeof value === "number") return {type: "NUMBER", value: value};
  if (typeof value === "boolean") return {type: "BOOLEAN", value: value};
  if (value === null || value === undefined || value === "") return {type: "EMPTY", value: ""};
  return {type: "STRING", value: String(value)};
}

function digestHexDq_(text) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}
