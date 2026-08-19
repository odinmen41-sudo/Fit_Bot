/**
 * Sprint 6.3 — TEST-ONLY Data Readiness Layer and acceptance suite.
 *
 * DATA_READINESS_REPORT is a calculated in-memory object, not a sheet.
 */
const DATA_READINESS_S63_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  PRODUCTION_VERSION_EXPECTED: 19,
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  DEPLOYMENT_ENABLED: false,
  BODY_MIN_MEASUREMENTS: 8,
  TRAINING_MIN_TEMPORAL_COVERAGE: 0.8,
  NUTRITION_MIN_COVERAGE: 0.7,
  RECOVERY_MIN_CHECKINS: 7
});

function buildDataReadinessReportS63Test_(options) {
  const config = options || {};
  const repository = resolveSpreadsheetRepositoryTest_(config);
  const asOf = normalizeDateS63Test_(config.as_of || new Date());
  const body = calculateBodyReadinessS63Test_(repository);
  const workoutAudit = config.workout_audit || buildWorkoutDataQualityReportS63Test_(repository);
  const trainingScore = workoutAudit.total_records
    ? roundDq_(workoutAudit.dated_records / workoutAudit.total_records * 100, 1)
    : 0;
  const trainingReady = workoutAudit.temporal_coverage >= DATA_READINESS_S63_CONFIG.TRAINING_MIN_TEMPORAL_COVERAGE;

  const nutritionCoverage = config.nutrition_coverage || calculateNutritionCoverageS63Test_(asOf, 14, [], repository);
  const nutritionRatio = config.use_acquired_nutrition
    ? nutritionCoverage.coverage_after
    : nutritionCoverage.coverage_before;
  const nutritionScore = roundDq_(nutritionRatio * 100, 1);
  const nutritionReady = nutritionRatio >= DATA_READINESS_S63_CONFIG.NUTRITION_MIN_COVERAGE;

  const recoveryObservations = (config.recovery_observations || []).filter(function(item) {
    return item && item.observation_type === "RECOVERY_CHECKIN";
  });
  const freshRecovery = recoveryObservations.filter(function(item) {
    return item.freshness && item.freshness.status === "FRESH";
  });
  const uniqueRecoveryDays = {};
  freshRecovery.forEach(function(item) { uniqueRecoveryDays[item.observed_date] = true; });
  const recoveryCount = Object.keys(uniqueRecoveryDays).length;
  const recoveryScore = roundDq_(Math.min(1, recoveryCount / DATA_READINESS_S63_CONFIG.RECOVERY_MIN_CHECKINS) * 100, 1);
  const recoveryReady = recoveryCount >= DATA_READINESS_S63_CONFIG.RECOVERY_MIN_CHECKINS;

  const goal = config.confirmed_goal || null;
  const goalReady = !!(goal && goal.status === "CONFIRMED" && goal.canonical === true &&
    goal.source === "EXPLICIT_USER_INPUT_CONFIRMED" && goal.completeness_flag === "COMPLETE");
  const goalScore = goalReady ? 100 : 0;

  const domains = {
    body: {
      status: body.ready ? "READY" : (body.measurement_count ? "NOT_READY" : "NO_DATA"),
      reason: body.ready ? null : "INSUFFICIENT_HISTORY",
      score: body.score,
      evidence: body
    },
    training: {
      status: trainingReady ? "READY" : (workoutAudit.total_records ? "NOT_READY" : "NO_DATA"),
      reason: trainingReady ? null : "TEMPORAL_COVERAGE_INSUFFICIENT",
      score: trainingScore,
      evidence: {
        total_records: workoutAudit.total_records,
        dated_records: workoutAudit.dated_records,
        records_without_date: workoutAudit.records_without_date,
        temporal_coverage: workoutAudit.temporal_coverage
      }
    },
    nutrition: {
      status: nutritionReady ? "READY" : (nutritionRatio > 0 ? "NOT_READY" : "NO_DATA"),
      reason: nutritionReady ? null : "LOW_COVERAGE",
      score: nutritionScore,
      evidence: nutritionCoverage
    },
    recovery: {
      status: recoveryReady ? "READY" : (recoveryCount ? "NOT_READY" : "NO_DATA"),
      reason: recoveryReady ? null : (recoveryCount ? "INSUFFICIENT_HISTORY" : "NO_RECOVERY_CHECKINS"),
      score: recoveryScore,
      evidence: {
        fresh_checkin_days: recoveryCount,
        minimum_checkin_days: DATA_READINESS_S63_CONFIG.RECOVERY_MIN_CHECKINS,
        stale_observations: recoveryObservations.length - freshRecovery.length
      }
    },
    goal: {
      status: goalReady ? "READY" : "NOT_READY",
      reason: goalReady ? null : "EXPLICIT_CONFIRMATION_REQUIRED",
      score: goalScore,
      evidence: goal ? {
        goal_id: goal.goal_id,
        status: goal.status,
        source: goal.source,
        canonical: goal.canonical,
        persisted: false
      } : null
    }
  };
  const scores = Object.keys(domains).map(function(key) { return domains[key].score; });
  const overallScore = roundDq_(scores.reduce(function(sum, value) { return sum + value; }, 0) / scores.length, 1);
  const blockers = Object.keys(domains).filter(function(key) { return domains[key].status !== "READY"; }).map(function(key) {
    return {domain: key.toUpperCase(), reason: domains[key].reason};
  });
  return {
    report_type: "DATA_READINESS_REPORT",
    schema_version: "DATA_READINESS_S63_TEST_1",
    mode: DATA_READINESS_S63_CONFIG.MODE,
    as_of: asOf,
    domains: domains,
    overall_readiness_score: overallScore,
    ready_for_decision_engine: blockers.length === 0,
    blockers: blockers,
    decision_engine_created: false,
    recommendation_engine_created: false,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function runDataCollectionReadinessTests(options) {
  const repository = resolveSpreadsheetRepositoryTest_(options);
  const before = captureSpreadsheetFingerprintDq_(repository);
  const tests = [];
  const asOf = "2026-08-14";
  const userId = "132976932";

  const fullParsed = parseRecoveryCheckinS63Test_(
    "Спал 7.5 часов, качество сна 8, энергия 7, усталость 4, стресс 3, боль в плече 2 из 10",
    {observed_date: asOf}
  );
  const full = createCanonicalRecoveryObservationS63Test_(userId, fullParsed, [], {as_of: asOf});
  tests.push(testCaseDq_("S63-R01", "Recovery full check-in", fullParsed.completeness_flag === "COMPLETE" &&
    full.observation.fields.pain_location.value === "SHOULDER" &&
    full.observation.medical_safety.status === "NO_MEDICAL_INTERPRETATION", {
      completeness: fullParsed.completeness,
      pain_location: full.observation.fields.pain_location.value,
      confidence: full.observation.confidence
    }));

  const partialParsed = parseRecoveryCheckinS63Test_("Спал 6 часов, энергия 5", {observed_date: asOf});
  const partial = createCanonicalRecoveryObservationS63Test_(userId, partialParsed, [], {as_of: asOf});
  tests.push(testCaseDq_("S63-R02", "Recovery partial check-in preserves missing data",
    partialParsed.completeness_flag === "PARTIAL" && partialParsed.missing_fields.indexOf("stress") >= 0 &&
    partial.observation.fields.stress.value === null, {
      missing_fields: partialParsed.missing_fields,
      completeness: partialParsed.completeness
    }));

  const unknownPainParsed = parseRecoveryCheckinS63Test_("Что-то болит 4 из 10", {observed_date: asOf});
  const unknownPain = createCanonicalRecoveryObservationS63Test_(userId, unknownPainParsed, [], {as_of: asOf});
  tests.push(testCaseDq_("S63-R03", "Unknown pain remains unresolved",
    unknownPain.observation.fields.pain_presence.value === true &&
    unknownPain.observation.fields.pain_location.value === "UNKNOWN" &&
    unknownPain.observation.quality.flags.indexOf("UNKNOWN_PAIN_LOCATION") >= 0 &&
    unknownPain.observation.medical_safety.pain_interpretation === null, {
      pain: unknownPain.observation.fields.pain_location,
      safety: unknownPain.observation.medical_safety
    }));

  const duplicate = createCanonicalRecoveryObservationS63Test_(userId, fullParsed, full.registry, {as_of: asOf});
  tests.push(testCaseDq_("S63-R04", "Exact repeated Recovery check-in is idempotent",
    duplicate.action === "DUPLICATE_IGNORED" && duplicate.registry.length === 1 &&
    duplicate.observation.observation_id === full.observation.observation_id, {
      action: duplicate.action,
      registry_size: duplicate.registry.length
    }));

  const repeatedParsed = parseRecoveryCheckinS63Test_("Спал 8 часов, энергия 8, боли нет", {observed_date: asOf});
  const repeated = createCanonicalRecoveryObservationS63Test_(userId, repeatedParsed, full.registry, {as_of: asOf});
  tests.push(testCaseDq_("S63-R05", "Different same-day Recovery check-in is versioned",
    repeated.action === "REPEATED_CHECKIN_ADDED" && repeated.observation.sequence === 2 &&
    repeated.observation.supersedes_observation_id === full.observation.observation_id && repeated.registry.length === 2, {
      action: repeated.action,
      sequence: repeated.observation.sequence,
      supersedes: repeated.observation.supersedes_observation_id
    }));

  const staleParsed = parseRecoveryCheckinS63Test_("Спал 7 часов, энергия 6", {observed_date: "2026-08-08"});
  const stale = createCanonicalRecoveryObservationS63Test_(userId, staleParsed, [], {as_of: asOf});
  tests.push(testCaseDq_("S63-R06", "Stale Recovery is flagged",
    stale.observation.freshness.status === "STALE" && stale.observation.freshness.age_days === 6 &&
    stale.observation.quality.flags.indexOf("STALE_RECOVERY") >= 0, stale.observation.freshness));

  const mealText = "Ел курицу 250 грамм и рис 200 грамм";
  const mealDetection = detectMealEntryS63Test_(mealText);
  const meal = extractNutritionAcquisitionS63Test_(mealText, {meal_date: asOf});
  tests.push(testCaseDq_("S63-N01", "Meal entry detection", mealDetection.detected === true &&
    mealDetection.intent === "NUTRITION_MEAL_ENTRY" && mealDetection.confidence >= 0.9, mealDetection));
  tests.push(testCaseDq_("S63-N02", "Nutrition facts are normalized explicit data",
    meal.facts.length === 2 && meal.facts.every(function(fact) {
      return fact.source === "EXPLICIT_USER_INPUT" && fact.is_estimate === false && fact.confidence === 0.99;
    }), {facts: meal.facts}));
  tests.push(testCaseDq_("S63-N03", "Macro estimates remain separate from facts",
    meal.fact_estimate_separation === true && meal.estimates.length === 2 &&
    meal.estimates.every(function(item) { return item.is_estimate === true && item.source_fact === false; }) &&
    meal.recommendations.length === 0, {estimates: meal.estimates}));
  const coverage = calculateNutritionCoverageS63Test_(asOf, 14, [meal], repository);
  tests.push(testCaseDq_("S63-N04", "Nutrition coverage improvement is calculated without write",
    coverage.covered_days_before === 4 && coverage.covered_days_after === 5 &&
    coverage.coverage_before === 0.286 && coverage.coverage_after === 0.357 && coverage.write_performed === false, coverage));

  const memoryGoal = createGoalV2FinalizationS63Test_(userId, "", {
    source: "AI_MEMORY",
    spreadsheet_repository: repository
  });
  tests.push(testCaseDq_("S63-G01", "AI_MEMORY goal stays pending and non-authoritative",
    memoryGoal.status === "PENDING_CONFIRMATION" && memoryGoal.canonical === false &&
    memoryGoal.source_fact === false && memoryGoal.memory_candidate.value === "105-110 кг" &&
    memoryGoal.memory_candidate.status === "PENDING_CONFIRMATION", memoryGoal.memory_candidate));

  const goalMessage = "Текущий вес 118.7. Цель 108. Дата старта 14.08.2026. Горизонт 6 месяцев. Этапы 115 112 108";
  const goalProposal = createGoalV2FinalizationS63Test_(userId, goalMessage, {source: "EXPLICIT_USER_INPUT"});
  tests.push(testCaseDq_("S63-G02", "Explicit Goal V2 proposal is complete but pending",
    goalProposal.status === "PENDING_CONFIRMATION" && goalProposal.completeness_flag === "COMPLETE" &&
    goalProposal.current_weight === 118.7 && goalProposal.target_weight === 108 && goalProposal.canonical === false, {
      status: goalProposal.status,
      missing_fields: goalProposal.missing_fields,
      current_weight: goalProposal.current_weight,
      target_weight: goalProposal.target_weight
    }));
  tests.push(testCaseDq_("S63-G03", "Goal V2 milestones are explicit and ordered",
    goalProposal.milestones.length === 3 && goalProposal.milestones[0].target_weight === 115 &&
    goalProposal.milestones[2].target_weight === 108 &&
    goalProposal.milestones.every(function(item) { return item.source === "EXPLICIT_USER_INPUT"; }), {
      milestones: goalProposal.milestones
    }));
  const confirmedGoal = confirmGoalV2FinalizationS63Test_(goalProposal, "Да", {confirmed_at: "2026-08-14T12:00:00+03:00"});
  tests.push(testCaseDq_("S63-G04", "Only explicit confirmation creates canonical Goal V2",
    confirmedGoal.status === "CONFIRMED" && confirmedGoal.canonical === true &&
    confirmedGoal.source_fact === true && confirmedGoal.source === "EXPLICIT_USER_INPUT_CONFIRMED" &&
    confirmedGoal.write_performed === false, {
      status: confirmedGoal.status,
      source: confirmedGoal.source,
      canonical: confirmedGoal.canonical
    }));

  const workout = buildWorkoutDataQualityReportS63Test_(repository);
  tests.push(testCaseDq_("S63-W01", "Workout data quality counts are exact",
    workout.total_records === 79 && workout.dated_records === 6 && workout.records_without_date === 73 &&
    workout.missing_fields.rpe === 79, {
      total_records: workout.total_records,
      dated_records: workout.dated_records,
      records_without_date: workout.records_without_date,
      missing_fields: workout.missing_fields
    }));
  tests.push(testCaseDq_("S63-W02", "Workout normalization readiness is classified",
    workout.ready_for_future_normalization === 6 && workout.ready_after_date_confirmation === 73 &&
    workout.mapping_preview.workout_sessions.length === 1, {
      ready: workout.ready_for_future_normalization,
      after_date_confirmation: workout.ready_after_date_confirmation,
      session_previews: workout.mapping_preview.workout_sessions.length
    }));
  tests.push(testCaseDq_("S63-W03", "Workout mappings are preview-only",
    workout.mapping_contract.WORKOUT_SESSIONS.length > 0 && workout.mapping_contract.EXERCISE_SETS.length > 0 &&
    workout.mapping_preview.exercise_sets.length === 23 && workout.mapping_preview.exercise_sets.every(function(item) {
      return item.preview_only === true;
    }) && workout.migration_performed === false && workout.write_performed === false, {
      exercise_set_previews: workout.mapping_preview.exercise_sets.length,
      migration_performed: workout.migration_performed
    }));

  const baseline = buildDataReadinessReportS63Test_({
    as_of: asOf,
    workout_audit: workout,
    spreadsheet_repository: repository
  });
  tests.push(testCaseDq_("S63-D01", "Baseline DATA_READINESS_REPORT exposes all blockers",
    baseline.report_type === "DATA_READINESS_REPORT" && baseline.overall_readiness_score === 12.2 &&
    baseline.domains.body.status === "NOT_READY" && baseline.domains.training.status === "NOT_READY" &&
    baseline.domains.nutrition.status === "NOT_READY" && baseline.domains.recovery.status === "NO_DATA" &&
    baseline.domains.goal.status === "NOT_READY" && baseline.ready_for_decision_engine === false, {
      score: baseline.overall_readiness_score,
      blockers: baseline.blockers
    }));

  const afterAcquisition = buildDataReadinessReportS63Test_({
    as_of: asOf,
    workout_audit: workout,
    nutrition_coverage: coverage,
    use_acquired_nutrition: true,
    recovery_observations: [full.observation],
    confirmed_goal: confirmedGoal,
    spreadsheet_repository: repository
  });
  tests.push(testCaseDq_("S63-D02", "Readiness improves but Decision Engine remains blocked",
    afterAcquisition.overall_readiness_score === 36.5 && afterAcquisition.domains.goal.status === "READY" &&
    afterAcquisition.domains.nutrition.score === 35.7 && afterAcquisition.domains.recovery.score === 14.3 &&
    afterAcquisition.ready_for_decision_engine === false && afterAcquisition.blockers.length === 4, {
      score: afterAcquisition.overall_readiness_score,
      domains: afterAcquisition.domains,
      blockers: afterAcquisition.blockers
    }));

  const after = captureSpreadsheetFingerprintDq_(repository);
  const noSheetMutation = before.global_hash === after.global_hash && before.sheet_count === after.sheet_count;
  const guardrails = {
    mode: DATA_READINESS_S63_CONFIG.MODE,
    sheets_before: before.sheet_count,
    sheets_after: after.sheet_count,
    hash_before: before.global_hash,
    hash_after: after.global_hash,
    production_writes: 0,
    telegram_calls: 0,
    groq_calls: 0,
    deployments: 0,
    production_version_expected: DATA_READINESS_S63_CONFIG.PRODUCTION_VERSION_EXPECTED
  };
  tests.push(testCaseDq_("S63-S01", "TEST_ONLY guardrails and spreadsheet fingerprint",
    noSheetMutation && before.sheet_count === 17 &&
    DATA_COLLECTION_ACQUISITION_S63_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    GOAL_WORKOUT_ACQUISITION_S63_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    DATA_READINESS_S63_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    DATA_READINESS_S63_CONFIG.TELEGRAM_CALLS_ENABLED === false &&
    DATA_READINESS_S63_CONFIG.GROQ_CALLS_ENABLED === false &&
    DATA_READINESS_S63_CONFIG.DEPLOYMENT_ENABLED === false, guardrails));

  const passed = tests.filter(function(item) { return item.status === "PASS"; }).length;
  const failed = tests.length - passed;
  const report = {
    suite: "SPRINT_6_3_DATA_COLLECTION_READINESS",
    mode: "TEST_ONLY",
    status: failed === 0 ? "PASS" : "FAIL",
    passed: passed,
    failed: failed,
    total: tests.length,
    baseline_readiness: baseline,
    post_acquisition_readiness: afterAcquisition,
    guardrails: guardrails,
    tests: tests
  };
  console.log(JSON.stringify({
    suite: report.suite,
    status: report.status,
    passed: passed,
    failed: failed,
    total: tests.length,
    baseline_score: baseline.overall_readiness_score,
    post_acquisition_score: afterAcquisition.overall_readiness_score,
    ready_for_decision_engine: afterAcquisition.ready_for_decision_engine,
    sheet_hash_unchanged: noSheetMutation
  }));
  return report;
}

function calculateBodyReadinessS63Test_(repository) {
  const table = readTableDq_("Body_Tracking", repository);
  const indexes = resolveHeaderIndexesDq_(table.headers, {date: ["Дата", "date"], weight: ["Вес", "weight"]});
  const valid = table.rows.map(function(row) {
    return {date: parseDateS63Test_(getCellDq_(row, indexes.date)), weight: parseNumberDq_(getCellDq_(row, indexes.weight))};
  }).filter(function(item) { return item.date && item.weight !== null; }).sort(function(a, b) { return a.date - b.date; });
  const count = valid.length;
  const spanDays = count > 1 ? Math.round((startOfDayDq_(valid[count - 1].date) - startOfDayDq_(valid[0].date)) / 86400000) : 0;
  return {
    measurement_count: count,
    minimum_measurements: DATA_READINESS_S63_CONFIG.BODY_MIN_MEASUREMENTS,
    history_span_days: spanDays,
    latest_weight: count ? valid[count - 1].weight : null,
    score: roundDq_(Math.min(1, count / DATA_READINESS_S63_CONFIG.BODY_MIN_MEASUREMENTS) * 100, 1),
    ready: count >= DATA_READINESS_S63_CONFIG.BODY_MIN_MEASUREMENTS
  };
}
