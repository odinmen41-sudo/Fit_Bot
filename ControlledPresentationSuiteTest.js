/** Sprint 6.5 — public TEST_ONLY acceptance runner. */
function runControlledPresentationTests() {
  const before = captureSpreadsheetFingerprintDq_();
  const tests = [];
  const userId = "132976932";
  const now = "2026-08-14T10:00:00+03:00";
  const today = "2026-08-14";
  const currentReadiness = buildDataReadinessReportS63Test_({as_of: today});
  const memoryGoal = getMemoryGoalCandidateS63Test_(userId);
  const schedule = buildDataCollectionScheduleS64Test_(userId, currentReadiness, {
    mode: "SHADOW",
    created_at: now,
    memory_goal_candidate: memoryGoal
  });
  const recoveryEvent = schedule.event;

  const recoveryPrompt = buildDataCollectionPromptS65Test_(recoveryEvent);
  tests.push(testCaseDq_("S65-P01", "Recovery prompt asks only for requested data",
    recoveryPrompt.collection_type === "RECOVERY_CHECKIN" &&
    recoveryPrompt.prompt.indexOf("Сон (часы):") >= 0 &&
    recoveryPrompt.prompt.indexOf("Энергия (1–10):") >= 0 &&
    recoveryPrompt.prompt.indexOf("Есть ли боль?") >= 0 &&
    recoveryPrompt.analysis_present === false &&
    recoveryPrompt.decision_present === false &&
    recoveryPrompt.recommendation_present === false && recoveryPrompt.safety.safe === true, {
      prompt: recoveryPrompt.prompt,
      safety: recoveryPrompt.safety
    }));

  const presented = presentDataCollectionEventS65Test_(recoveryEvent, null, {
    mode: "PRESENTATION_TEST",
    now: now,
    observations: []
  });
  tests.push(testCaseDq_("S65-T01", "Test 1: missing Recovery is PRESENTED in test harness",
    schedule.priority.collection_type === "RECOVERY_CHECKIN" &&
    presented.action === "PRESENT" && presented.event.status === "PRESENTED" &&
    presented.presented_to_user === true && presented.transport === "TEST_HARNESS_ONLY" &&
    presented.write_performed === false, {
      event_status: presented.event.status,
      transport: presented.transport,
      prompt: presented.prompt.prompt
    }));

  const requiredStateFields = ["user_id", "last_requested_type", "requested_at", "completed_at", "cooldown_until", "status"];
  tests.push(testCaseDq_("S65-ST01", "DATA_COLLECTION_STATE schema is complete",
    requiredStateFields.every(function(field) { return Object.prototype.hasOwnProperty.call(presented.state, field); }) &&
    presented.state.status === "REQUESTED" && presented.state.completed_at === null &&
    presented.state.last_requested_type === "RECOVERY_CHECKIN" &&
    presented.state.cooldown_until === "2026-08-15T06:00:00+03:00" &&
    presented.state.storage === "IN_MEMORY_ONLY" && presented.state.write_performed === false, presented.state));

  const existingToday = canPresentDataCollectionRequestS65Test_(recoveryEvent, null, {
    now: now,
    observations: [{observation_type: "RECOVERY_CHECKIN", observed_date: today}]
  });
  tests.push(testCaseDq_("S65-T02", "Test 2: Recovery already received today returns NO_REQUEST",
    existingToday.action === "NO_REQUEST" && existingToday.allowed === false &&
    existingToday.reason === "DATA_ALREADY_RECEIVED_TODAY", existingToday));

  const response = processDataCollectionResponseS65Test_(
    presented.event,
    presented.state,
    "Сон 7 часов, энергия 8",
    {mode: "PRESENTATION_TEST", now: "2026-08-14T10:05:00+03:00", observed_date: today}
  );
  const recoveryCandidate = response.candidate_observation;
  tests.push(testCaseDq_("S65-T03", "Test 3: Recovery response creates candidate observation only",
    response.action === "CANDIDATE_CREATED" && response.event.status === "COMPLETED" &&
    response.state.status === "COMPLETED" &&
    recoveryCandidate.candidate_type === "RECOVERY_OBSERVATION_CANDIDATE" &&
    recoveryCandidate.status === "PENDING_VALIDATION" && recoveryCandidate.canonical === false &&
    recoveryCandidate.payload.fields.sleep_hours.value === 7 &&
    recoveryCandidate.payload.fields.energy.value === 8 &&
    response.decision_objects.length === 0 && response.recommendation_objects.length === 0 &&
    recoveryCandidate.decision_objects.length === 0 && recoveryCandidate.recommendation_objects.length === 0 &&
    response.write_performed === false, {
      event_status: response.event.status,
      state_status: response.state.status,
      candidate: recoveryCandidate
    }));

  const refusal = processDataCollectionResponseS65Test_(
    presented.event,
    presented.state,
    "Не хочу",
    {mode: "PRESENTATION_TEST", now: "2026-08-14T10:06:00+03:00", observed_date: today}
  );
  tests.push(testCaseDq_("S65-T04", "Test 4: refusal is SKIPPED without negative inference",
    refusal.action === "SKIPPED" && refusal.event.status === "SKIPPED" &&
    refusal.state.status === "SKIPPED" && refusal.candidate_observation === null &&
    refusal.negative_inference === null && refusal.decision_objects.length === 0 &&
    refusal.recommendation_objects.length === 0 && refusal.write_performed === false, {
      event_status: refusal.event.status,
      state_status: refusal.state.status,
      acknowledgement: refusal.acknowledgement
    }));

  const cooldown = canPresentDataCollectionRequestS65Test_(recoveryEvent, presented.state, {
    now: "2026-08-14T12:00:00+03:00",
    observations: []
  });
  tests.push(testCaseDq_("S65-T05", "Test 5: repeated request during cooldown returns NO_REQUEST",
    cooldown.action === "NO_REQUEST" && cooldown.allowed === false &&
    cooldown.reason === "COOLDOWN_ACTIVE" && cooldown.cooldown_until === "2026-08-15T06:00:00+03:00", cooldown));

  const completedCooldown = canPresentDataCollectionRequestS65Test_(recoveryEvent, response.state, {
    now: "2026-08-14T12:00:00+03:00",
    observations: []
  });
  tests.push(testCaseDq_("S65-CD01", "Completed data suppresses repeated request during cooldown",
    completedCooldown.action === "NO_REQUEST" && completedCooldown.reason === "DATA_ALREADY_RECEIVED", completedCooldown));

  const goalEvent = buildPresentationEventFixtureS65Test_(userId, "GOAL_CONFIRMATION", now);
  const goalPresented = presentDataCollectionEventS65Test_(goalEvent, null, {
    mode: "PRESENTATION_TEST", now: now, observations: []
  });
  const goalResponse = processDataCollectionResponseS65Test_(
    goalPresented.event,
    goalPresented.state,
    "Хочу 108 кг к декабрю",
    {mode: "PRESENTATION_TEST", now: "2026-08-14T10:10:00+03:00", observed_date: today}
  );
  tests.push(testCaseDq_("S65-G01", "Goal response creates PENDING_CONFIRMATION candidate",
    goalResponse.candidate_observation.candidate_type === "GOAL_V2_CANDIDATE" &&
    goalResponse.candidate_observation.status === "PENDING_CONFIRMATION" &&
    goalResponse.candidate_observation.payload.target_weight === 108 &&
    goalResponse.candidate_observation.payload.deadline_text === "декабрю" &&
    goalResponse.candidate_observation.canonical === false &&
    goalResponse.candidate_observation.write_performed === false, goalResponse.candidate_observation));

  const expiredEvent = transitionCollectionEventS65Test_(recoveryEvent, "EXPIRED", {updated_at: now});
  const expiredAgain = transitionCollectionEventS65Test_(expiredEvent, "EXPIRED", {updated_at: now});
  tests.push(testCaseDq_("S65-L01", "Collection lifecycle supports CREATED to EXPIRED idempotently",
    expiredEvent.status === "EXPIRED" && expiredAgain.status === "EXPIRED" &&
    expiredAgain.event_id === expiredEvent.event_id && expiredEvent.write_performed === false, {
      statuses: [recoveryEvent.status, expiredEvent.status, expiredAgain.status]
    }));

  const expiredStateResult = expireDataCollectionStateS65Test_(
    presented.event,
    presented.state,
    {now: "2026-08-15T06:00:01+03:00"}
  );
  tests.push(testCaseDq_("S65-L02", "REQUESTED DATA_COLLECTION_STATE can expire with its event",
    expiredStateResult.action === "EXPIRED" &&
    expiredStateResult.event.status === "EXPIRED" &&
    expiredStateResult.state.status === "EXPIRED" &&
    expiredStateResult.state.expired_at === "2026-08-15T06:00:01+03:00" &&
    expiredStateResult.write_performed === false, {
      event_status: expiredStateResult.event.status,
      state_status: expiredStateResult.state.status,
      expired_at: expiredStateResult.state.expired_at
    }));

  const shadowPreview = presentDataCollectionEventS65Test_(recoveryEvent, null, {
    mode: "SHADOW", now: now, observations: []
  });
  tests.push(testCaseDq_("S65-M01", "SHADOW mode produces internal preview without presentation",
    shadowPreview.action === "SHADOW_ONLY" && shadowPreview.event.status === "CREATED" &&
    shadowPreview.presented_to_user === false && shadowPreview.state === null &&
    shadowPreview.prompt.safety.safe === true && shadowPreview.write_performed === false, {
      action: shadowPreview.action,
      event_status: shadowPreview.event.status,
      presented_to_user: shadowPreview.presented_to_user
    }));

  const offResult = presentDataCollectionEventS65Test_(recoveryEvent, null, {mode: "OFF", now: now});
  tests.push(testCaseDq_("S65-M02", "OFF mode produces NO_REQUEST",
    offResult.action === "NO_REQUEST" && offResult.reason === "PRESENTATION_MODE_OFF" &&
    offResult.prompt === null && offResult.write_performed === false, offResult));

  let activeError = null;
  try {
    presentDataCollectionEventS65Test_(recoveryEvent, null, {mode: "ACTIVE", now: now});
  } catch (error) {
    activeError = String(error && error.message || error);
  }
  tests.push(testCaseDq_("S65-M03", "ACTIVE presentation mode is hard-blocked",
    activeError === "ACTIVE_PRESENTATION_MODE_FORBIDDEN" &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.ACTIVE_ENABLED === false, {error: activeError}));

  const promptTypes = [
    "RECOVERY_CHECKIN", "BODY_WEIGHT_COLLECTION", "NUTRITION_LOG_COLLECTION",
    "GOAL_CONFIRMATION", "WORKOUT_DATA_COLLECTION"
  ];
  const promptSafety = promptTypes.map(function(type) {
    const promptResult = buildDataCollectionPromptS65Test_(buildPresentationEventFixtureS65Test_(userId, type, now));
    return {type: type, safe: promptResult.safety.safe, decision: promptResult.decision_present, recommendation: promptResult.recommendation_present};
  });
  tests.push(testCaseDq_("S65-P02", "All presentation templates pass no-advice safety gate",
    promptSafety.every(function(item) { return item.safe && item.decision === false && item.recommendation === false; }), promptSafety));

  const after = captureSpreadsheetFingerprintDq_();
  const beforeMemory = before.sheets.filter(function(sheet) { return sheet.name === "AI_MEMORY"; })[0];
  const afterMemory = after.sheets.filter(function(sheet) { return sheet.name === "AI_MEMORY"; })[0];
  const noMutation = before.global_hash === after.global_hash && before.sheet_count === after.sheet_count;
  const safety = {
    sheet_count_before: before.sheet_count,
    sheet_count_after: after.sheet_count,
    hash_before: before.global_hash,
    hash_after: after.global_hash,
    ai_memory_hash_before: beforeMemory ? beforeMemory.hash : null,
    ai_memory_hash_after: afterMemory ? afterMemory.hash : null,
    production_writes: 0,
    telegram_production_calls: 0,
    groq_calls: 0,
    llm_calls: 0,
    decision_objects: 0,
    recommendation_objects: 0,
    deployments: 0,
    production_version_expected: DATA_COLLECTION_PRESENTATION_S65_CONFIG.PRODUCTION_VERSION_EXPECTED
  };
  tests.push(testCaseDq_("S65-S01", "Safety regression and spreadsheet fingerprint",
    noMutation && before.sheet_count === 17 && beforeMemory && afterMemory && beforeMemory.hash === afterMemory.hash &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.TELEGRAM_CALLS_ENABLED === false &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.GROQ_CALLS_ENABLED === false &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.LLM_ENABLED === false &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.DECISION_ENGINE_ENABLED === false &&
    DATA_COLLECTION_PRESENTATION_S65_CONFIG.RECOMMENDATION_ENGINE_ENABLED === false, safety));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  const failed = tests.length - passed;
  const result = {
    suite: "SPRINT_6_5_CONTROLLED_PRESENTATION",
    mode: "PRESENTATION_TEST",
    status: failed === 0 ? "PASS" : "FAIL",
    passed: passed,
    failed: failed,
    total: tests.length,
    current_readiness: currentReadiness.overall_readiness_score,
    readiness_changed: false,
    next_best_data_action: schedule.priority.collection_type,
    lifecycle: ["CREATED", "PRESENTED", "COMPLETED|SKIPPED|EXPIRED"],
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
    readiness_changed: result.readiness_changed,
    next_best_data_action: result.next_best_data_action,
    sheet_hash_unchanged: noMutation,
    ai_memory_hash_unchanged: beforeMemory && afterMemory ? beforeMemory.hash === afterMemory.hash : false
  }));
  return result;
}

function buildPresentationEventFixtureS65Test_(userId, collectionType, createdAt) {
  const template = getDataCollectionTemplateS64Test_(collectionType);
  return createDataCollectionEventS64Test_(userId, {
    collection_type: collectionType,
    requested_fields: template.fields.map(function(field) { return field.name; }),
    reason: "highest_missing_information_value",
    information_value: 100
  }, {mode: "SHADOW", created_at: createdAt});
}
