/**
 * Sprint 6.4 — TEST/SHADOW acceptance suite.
 * Public runner: runDataCollectionShadowTests().
 */
function runDataCollectionShadowTests() {
  const before = captureSpreadsheetFingerprintDq_();
  const tests = [];
  const userId = "132976932";
  const asOf = "2026-08-14";
  const createdAt = "2026-08-14T12:00:00+03:00";
  const currentReport = buildDataReadinessReportS63Test_({as_of: asOf});
  const memoryGoal = getMemoryGoalCandidateS63Test_(userId);

  const missing = detectMissingDataS64Test_(currentReport, {memory_goal_candidate: memoryGoal});
  const missingByDomain = {};
  missing.forEach(function(item) { missingByDomain[item.domain] = item; });
  tests.push(testCaseDq_("S64-M01", "Missing data is derived from readiness automatically",
    missing.length === 5 &&
    missingByDomain.BODY.missing_data.indexOf("weight") >= 0 &&
    missingByDomain.TRAINING.missing_data.indexOf("date") >= 0 &&
    missingByDomain.NUTRITION.missing_data.indexOf("foods") >= 0 &&
    missingByDomain.RECOVERY.missing_data.indexOf("sleep_hours") >= 0 &&
    missingByDomain.GOAL.reason === "AI_MEMORY_GOAL_REQUIRES_EXPLICIT_CONFIRMATION", {
      missing_domains: Object.keys(missingByDomain),
      collection_types: missing.map(function(item) { return item.collection_type; })
    }));

  const exampleInput = {body_score: 25, training_score: 7, nutrition_score: 28, recovery_score: 0, goal_score: 0};
  const examplePriority = calculateDataCollectionPriority_(exampleInput, {memory_goal_candidate: memoryGoal});
  const repeatedPriority = calculateDataCollectionPriority_(exampleInput, {memory_goal_candidate: memoryGoal});
  tests.push(testCaseDq_("S64-P01", "Priority Engine selects one deterministic next data type",
    examplePriority.priority === "RECOVERY_CHECKIN" &&
    examplePriority.reason === "highest_missing_information_value" &&
    examplePriority.confidence === 0.95 &&
    examplePriority.llm_used === false &&
    stableStringifyS63Test_(examplePriority) === stableStringifyS63Test_(repeatedPriority), examplePriority));

  const templateTypes = [
    "RECOVERY_CHECKIN", "BODY_WEIGHT_COLLECTION", "NUTRITION_LOG_COLLECTION",
    "GOAL_CONFIRMATION", "WORKOUT_DATA_COLLECTION"
  ];
  const templates = templateTypes.map(getDataCollectionTemplateS64Test_);
  tests.push(testCaseDq_("S64-T01", "Five collection templates are structural only",
    templates.length === 5 &&
    templates[0].fields.map(function(field) { return field.name; }).join("|") ===
      "sleep_hours|sleep_quality|energy|stress|fatigue|pain" &&
    templates[1].fields.map(function(field) { return field.name; }).join("|") === "weight|date|conditions" &&
    templates[2].fields.map(function(field) { return field.name; }).join("|") === "meal|foods|quantity" &&
    templates[3].fields.map(function(field) { return field.name; }).join("|") === "target_weight|deadline" &&
    templates[4].fields.map(function(field) { return field.name; }).join("|") === "exercise|weight|sets|reps|date" &&
    templates.every(function(template) {
      return template.analysis_enabled === false && template.recommendations_enabled === false;
    }), {template_types: templateTypes}));

  const actualPriority = calculateDataCollectionPriority_(currentReport, {memory_goal_candidate: memoryGoal});
  const event = createDataCollectionEventS64Test_(userId, actualPriority, {mode: "SHADOW", created_at: createdAt});
  const eventAgain = createDataCollectionEventS64Test_(userId, actualPriority, {mode: "SHADOW", created_at: createdAt});
  tests.push(testCaseDq_("S64-E01", "DATA_COLLECTION_EVENT schema is complete and deterministic",
    event.event_id === eventAgain.event_id && event.user_id === userId &&
    event.collection_type === "RECOVERY_CHECKIN" && Array.isArray(event.requested_fields) &&
    event.reason === "highest_missing_information_value" && event.priority === 100 &&
    event.created_at === "2026-08-14T12:00:00+03:00" && event.status === "CREATED" &&
    event.visibility === "INTERNAL_ONLY" && event.write_performed === false, event));

  const presented = transitionDataCollectionEventS64Test_(event, "PRESENTED", {updated_at: createdAt});
  const completed = transitionDataCollectionEventS64Test_(presented, "COMPLETED", {updated_at: createdAt});
  const completedAgain = transitionDataCollectionEventS64Test_(completed, "COMPLETED", {updated_at: createdAt});
  tests.push(testCaseDq_("S64-E02", "Collection event lifecycle is validated and idempotent",
    presented.status === "PRESENTED" && presented.presentation_performed === true &&
    completed.status === "COMPLETED" && completedAgain.status === "COMPLETED" &&
    completedAgain.event_id === completed.event_id && completed.write_performed === false, {
      statuses: [event.status, presented.status, completed.status],
      repeated_terminal_status: completedAgain.status
    }));

  const recoveryFixture = makeReadinessFixtureS64Test_({
    recovery: {score: 0, status: "NO_DATA", reason: "NO_RECOVERY_CHECKINS"}
  });
  const recoveryShadow = buildDataCollectionScheduleS64Test_(userId, recoveryFixture, {mode: "SHADOW", created_at: createdAt});
  tests.push(testCaseDq_("S64-SH01", "Shadow scenario: no Recovery creates RECOVERY_CHECKIN",
    recoveryShadow.status === "SHADOW_EVENT_CREATED" &&
    recoveryShadow.event.collection_type === "RECOVERY_CHECKIN" &&
    recoveryShadow.event.status === "CREATED" && recoveryShadow.user_flow_changed === false, {
      event: recoveryShadow.event
    }));

  const bodyFixture = makeReadinessFixtureS64Test_({
    body: {score: 0, status: "NO_DATA", reason: "NO_WEIGHT_MEASUREMENTS"}
  });
  const bodyShadow = buildDataCollectionScheduleS64Test_(userId, bodyFixture, {mode: "SHADOW", created_at: createdAt});
  tests.push(testCaseDq_("S64-SH02", "Shadow scenario: no weight creates BODY_WEIGHT_COLLECTION",
    bodyShadow.event.collection_type === "BODY_WEIGHT_COLLECTION" &&
    bodyShadow.event.requested_fields.indexOf("weight") >= 0 && bodyShadow.write_performed === false, {
      event: bodyShadow.event
    }));

  const nutritionFixture = makeReadinessFixtureS64Test_({
    nutrition: {score: 28.6, status: "NOT_READY", reason: "LOW_COVERAGE"}
  });
  const nutritionShadow = buildDataCollectionScheduleS64Test_(userId, nutritionFixture, {mode: "SHADOW", created_at: createdAt});
  tests.push(testCaseDq_("S64-SH03", "Shadow scenario: low nutrition coverage creates NUTRITION_LOG_COLLECTION",
    nutritionShadow.event.collection_type === "NUTRITION_LOG_COLLECTION" &&
    nutritionShadow.event.requested_fields.join("|") === "meal|foods|quantity" &&
    nutritionShadow.user_flow_changed === false, {event: nutritionShadow.event}));

  const goalFixture = makeReadinessFixtureS64Test_({
    goal: {score: 0, status: "NOT_READY", reason: "EXPLICIT_CONFIRMATION_REQUIRED"}
  });
  const goalShadow = buildDataCollectionScheduleS64Test_(userId, goalFixture, {
    mode: "SHADOW", created_at: createdAt, memory_goal_candidate: memoryGoal
  });
  tests.push(testCaseDq_("S64-SH04", "Shadow scenario: AI_MEMORY goal creates GOAL_CONFIRMATION",
    memoryGoal && memoryGoal.canonical === false && memoryGoal.status === "PENDING_CONFIRMATION" &&
    goalShadow.event.collection_type === "GOAL_CONFIRMATION" &&
    goalShadow.missing_data[0].reason === "AI_MEMORY_GOAL_REQUIRES_EXPLICIT_CONFIRMATION", {
      memory_candidate: memoryGoal,
      event: goalShadow.event
    }));

  const actualSchedule = buildDataCollectionScheduleS64Test_(userId, currentReport, {
    mode: "SHADOW", created_at: createdAt, memory_goal_candidate: memoryGoal
  });
  tests.push(testCaseDq_("S64-SH05", "Current Pavel state selects Recovery in internal Shadow mode",
    actualSchedule.priority.collection_type === "RECOVERY_CHECKIN" &&
    actualSchedule.event.visibility === "INTERNAL_ONLY" &&
    actualSchedule.event.presentation_performed === false &&
    actualSchedule.user_flow_changed === false, {
      current_score: currentReport.overall_readiness_score,
      selected: actualSchedule.priority,
      missing_data: actualSchedule.missing_data
    }));

  const evolution = buildDataReadinessEvolutionS64Test_(currentReport, actualPriority);
  tests.push(testCaseDq_("S64-R01", "DATA_READINESS_REPORT includes evolution fields",
    evolution.report_type === "DATA_READINESS_REPORT" && evolution.current_score === 12.2 &&
    evolution.current_readiness === 12.2 && evolution.potential_score === 15.1 &&
    evolution.potential_after_collection === 15.1 &&
    evolution.next_best_data_action === "RECOVERY_CHECKIN" &&
    evolution.ready_for_decision_engine === false, {
      current_score: evolution.current_score,
      potential_score: evolution.potential_score,
      next_best_data_action: evolution.next_best_data_action
    }));

  const offSchedule = buildDataCollectionScheduleS64Test_(userId, currentReport, {
    mode: "OFF", memory_goal_candidate: memoryGoal
  });
  tests.push(testCaseDq_("S64-G01", "OFF mode creates no event",
    offSchedule.mode === "OFF" && offSchedule.status === "DISABLED" && offSchedule.event === null &&
    offSchedule.write_performed === false, offSchedule));

  let activeError = null;
  try {
    buildDataCollectionScheduleS64Test_(userId, currentReport, {mode: "ACTIVE"});
  } catch (error) {
    activeError = String(error && error.message || error);
  }
  tests.push(testCaseDq_("S64-G02", "ACTIVE mode is hard-blocked",
    activeError === "ACTIVE_DATA_COLLECTION_MODE_FORBIDDEN" &&
    DATA_COLLECTION_S64_CONFIG.ACTIVE_ENABLED === false, {error: activeError}));

  const after = captureSpreadsheetFingerprintDq_();
  const noMutation = before.global_hash === after.global_hash && before.sheet_count === after.sheet_count;
  const safety = {
    sheets_before: before.sheet_count,
    sheets_after: after.sheet_count,
    hash_before: before.global_hash,
    hash_after: after.global_hash,
    production_writes: 0,
    telegram_calls: 0,
    groq_calls: 0,
    llm_calls: 0,
    decisions: 0,
    recommendations: 0,
    deployments: 0,
    production_version_expected: DATA_COLLECTION_S64_CONFIG.PRODUCTION_VERSION_EXPECTED
  };
  tests.push(testCaseDq_("S64-G03", "Shadow safety gate and Sheets fingerprint",
    noMutation && before.sheet_count === 17 &&
    DATA_COLLECTION_S64_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    DATA_COLLECTION_S64_CONFIG.TELEGRAM_CALLS_ENABLED === false &&
    DATA_COLLECTION_S64_CONFIG.GROQ_CALLS_ENABLED === false &&
    DATA_COLLECTION_S64_CONFIG.LLM_ENABLED === false &&
    DATA_COLLECTION_S64_CONFIG.DECISION_ENGINE_ENABLED === false &&
    DATA_COLLECTION_S64_CONFIG.RECOMMENDATION_ENGINE_ENABLED === false, safety));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  const failed = tests.length - passed;
  const result = {
    suite: "SPRINT_6_4_CONTROLLED_DATA_COLLECTION_SHADOW",
    mode: "SHADOW",
    status: failed === 0 ? "PASS" : "FAIL",
    passed: passed,
    failed: failed,
    total: tests.length,
    current_readiness: evolution.current_score,
    potential_after_next_collection: evolution.potential_score,
    next_best_data_action: evolution.next_best_data_action,
    largest_information_gap: actualPriority.domain,
    current_schedule: actualSchedule,
    readiness_evolution: evolution,
    safety: safety,
    tests: tests
  };
  console.log(JSON.stringify({
    suite: result.suite,
    status: result.status,
    passed: passed,
    failed: failed,
    total: tests.length,
    current_readiness: result.current_readiness,
    potential_after_next_collection: result.potential_after_next_collection,
    next_best_data_action: result.next_best_data_action,
    largest_information_gap: result.largest_information_gap,
    sheet_hash_unchanged: noMutation
  }));
  return result;
}

function makeReadinessFixtureS64Test_(overrides) {
  const base = {
    body: {score: 100, status: "READY", reason: null, evidence: {}},
    training: {score: 100, status: "READY", reason: null, evidence: {}},
    nutrition: {score: 100, status: "READY", reason: null, evidence: {}},
    recovery: {score: 100, status: "READY", reason: null, evidence: {}},
    goal: {score: 100, status: "READY", reason: null, evidence: {}}
  };
  Object.keys(overrides || {}).forEach(function(key) {
    base[key] = Object.assign({}, base[key], overrides[key]);
  });
  const scores = Object.keys(base).map(function(key) { return base[key].score; });
  const blockers = Object.keys(base).filter(function(key) { return base[key].status !== "READY"; });
  return {
    report_type: "DATA_READINESS_REPORT",
    schema_version: "DATA_READINESS_FIXTURE_S64_TEST_1",
    mode: "TEST_ONLY",
    domains: base,
    overall_readiness_score: roundDq_(scores.reduce(function(sum, score) { return sum + score; }, 0) / scores.length, 1),
    ready_for_decision_engine: blockers.length === 0,
    blockers: blockers.map(function(key) { return {domain: key.toUpperCase(), reason: base[key].reason}; }),
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}
