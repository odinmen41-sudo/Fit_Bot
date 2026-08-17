/** Sprint 6.6 — public TEST_ONLY acceptance runner. */
function runRecoveryPersistenceTests() {
  const before = captureSpreadsheetFingerprintDq_();
  const tests = [];
  const userId = "132976932";
  const observedAt = "2026-08-14";
  const recordedAt = "2026-08-14T10:00:00+03:00";

  const validCandidate = createRecoveryCandidateS66Test_(
    userId,
    "Спал 7 часов, энергия 8, усталость 3",
    {observed_at: observedAt, recorded_at: recordedAt, capture_id: "capture-s66-valid"}
  );
  const contractFields = [
    "observation_id", "user_id", "domain", "metric", "value", "unit", "observed_at",
    "recorded_at", "source", "confidence", "quality_score", "quality_flags",
    "confirmation_status", "capture_id"
  ];
  tests.push(testCaseDq_("S66-C01", "RecoveryObservationV1 contract is complete",
    validCandidate.records.length === 3 && validCandidate.records.every(function(record) {
      return contractFields.every(function(field) { return Object.prototype.hasOwnProperty.call(record, field); }) &&
        record.domain === "RECOVERY" && record.schema_version === "RecoveryObservationV1" &&
        Object.prototype.hasOwnProperty.call(RECOVERY_METRIC_CONTRACT_S66_TEST, record.metric);
    }), {metrics: validCandidate.records.map(function(record) { return record.metric; }), fields: contractFields}));

  const validValidation = validateRecoveryObservationS66Test_(validCandidate);
  tests.push(testCaseDq_("S66-T01", "Test 1: valid Recovery check-in passes validation",
    validValidation.status === "VALID" && validValidation.valid === true && validValidation.errors.length === 0 &&
    validValidation.validated_records.filter(function(record) { return record.metric === "sleep_hours"; })[0].value === 7 &&
    validValidation.validated_records.filter(function(record) { return record.metric === "energy"; })[0].value === 8 &&
    validValidation.validated_records.filter(function(record) { return record.metric === "fatigue"; })[0].value === 3 &&
    validValidation.medical_interpretation_performed === false &&
    validValidation.decision_objects.length === 0 && validValidation.recommendation_objects.length === 0, {
      status: validValidation.status,
      metrics: validValidation.validated_records.map(function(record) { return {metric: record.metric, value: record.value}; })
    }));

  const invalidSleepCandidate = createRecoveryCandidateS66Test_(
    userId,
    "Спал 30 часов",
    {observed_at: observedAt, recorded_at: recordedAt, capture_id: "capture-s66-invalid-sleep"}
  );
  const invalidSleepValidation = validateRecoveryObservationS66Test_(invalidSleepCandidate);
  tests.push(testCaseDq_("S66-T02", "Test 2: sleep above 24 hours is VALIDATION_ERROR",
    invalidSleepValidation.status === "VALIDATION_ERROR" && invalidSleepValidation.valid === false &&
    invalidSleepValidation.errors.some(function(error) {
      return error.code === "OUT_OF_RANGE" && error.field === "sleep_hours" && error.value === 30;
    }) && invalidSleepValidation.validated_records[0].quality_flags.indexOf("OUT_OF_RANGE") >= 0, {
      status: invalidSleepValidation.status,
      errors: invalidSleepValidation.errors
    }));

  const painCandidate = createRecoveryCandidateS66Test_(
    userId,
    "Болит плечо",
    {observed_at: observedAt, recorded_at: recordedAt, capture_id: "capture-s66-pain"}
  );
  const painValidation = validateRecoveryObservationS66Test_(painCandidate);
  tests.push(testCaseDq_("S66-T03", "Test 3: pain is stored as fact without diagnosis",
    painValidation.status === "VALID" &&
    painCandidate.records.some(function(record) { return record.metric === "pain_present" && record.value === true; }) &&
    painCandidate.records.some(function(record) { return record.metric === "pain_location" && record.value === "SHOULDER"; }) &&
    painCandidate.medical_safety.diagnosis === null && painCandidate.medical_safety.pain_interpretation === null &&
    painCandidate.medical_safety.cause_inference === null &&
    painValidation.medical_interpretation_performed === false, {
      facts: painCandidate.records.map(function(record) { return {metric: record.metric, value: record.value}; }),
      medical_safety: painCandidate.medical_safety
    }));

  const pending = createRecoveryConfirmationS66Test_(validCandidate, validValidation, {created_at: recordedAt});
  tests.push(testCaseDq_("S66-F01", "Candidate enters PENDING_CONFIRMATION",
    pending.status === "PENDING_CONFIRMATION" && pending.confirmation_status === "PENDING_CONFIRMATION" &&
    pending.records.every(function(record) {
      return record.status === "PENDING_CONFIRMATION" && record.confirmation_status === "PENDING_CONFIRMATION";
    }) && pending.confirmation_message.indexOf("Подтвердить?") >= 0 &&
    pending.decision_objects.length === 0 && pending.recommendation_objects.length === 0, {
      status: pending.status,
      message: pending.confirmation_message
    }));

  const emptyStore = {mode: "TEST", observations: [], confirmed_capture_ids: [], physical_writes: 0};
  const confirmed = confirmRecoveryObservationS66Test_(pending, "Да", emptyStore, {
    mode: "TEST", recorded_at: "2026-08-14T10:05:00+03:00"
  });
  tests.push(testCaseDq_("S66-F02", "Confirmed candidate becomes canonical in-memory observations",
    confirmed.action === "CANONICAL_CREATED" && confirmed.status === "CANONICAL" &&
    confirmed.confirmed_status === "CONFIRMED" &&
    confirmed.lifecycle.join("|") === "CANDIDATE|PENDING_CONFIRMATION|CONFIRMED|CANONICAL" &&
    confirmed.canonical_observations.length === 3 &&
    confirmed.canonical_observations.every(function(record) {
      return record.status === "CANONICAL" && record.confirmation_status === "CONFIRMED" &&
        record.source === "EXPLICIT_USER_INPUT_CONFIRMED";
    }) && confirmed.canonical_store.observations.length === 3 &&
    confirmed.canonical_store.physical_writes === 0 && confirmed.write_performed === false, {
      action: confirmed.action,
      lifecycle: confirmed.lifecycle,
      canonical_count: confirmed.canonical_observations.length
    }));

  const cancelCandidate = createRecoveryCandidateS66Test_(
    userId,
    "Спал 6 часов, энергия 6",
    {observed_at: observedAt, recorded_at: recordedAt, capture_id: "capture-s66-cancel"}
  );
  const cancelValidation = validateRecoveryObservationS66Test_(cancelCandidate);
  const cancelPending = createRecoveryConfirmationS66Test_(cancelCandidate, cancelValidation, {created_at: recordedAt});
  const cancelled = cancelRecoveryObservationS66Test_(cancelPending, "Не хочу", emptyStore, {
    mode: "TEST", cancelled_at: "2026-08-14T10:06:00+03:00"
  });
  tests.push(testCaseDq_("S66-T04", "Test 4: user cancellation creates no canonical observation",
    cancelled.action === "CANCELLED" && cancelled.status === "CANCELLED" &&
    cancelled.cancelled_bundle.status === "CANCELLED" &&
    cancelled.cancelled_bundle.records.every(function(record) { return record.status === "CANCELLED"; }) &&
    cancelled.canonical_observations.length === 0 && cancelled.canonical_store.observations.length === 0 &&
    cancelled.decision_objects.length === 0 && cancelled.recommendation_objects.length === 0 &&
    cancelled.write_performed === false, {
      action: cancelled.action,
      status: cancelled.status,
      canonical_count: cancelled.canonical_observations.length
    }));

  const repeated = confirmRecoveryObservationS66Test_(pending, "Да", confirmed.canonical_store, {
    mode: "TEST", recorded_at: "2026-08-14T10:07:00+03:00"
  });
  tests.push(testCaseDq_("S66-T05", "Test 5: repeated confirmation is idempotent",
    repeated.action === "ALREADY_CONFIRMED" && repeated.status === "CANONICAL" &&
    repeated.duplicate_created === false && repeated.canonical_observations.length === 3 &&
    repeated.canonical_store.observations.length === 3 && repeated.write_performed === false, {
      action: repeated.action,
      store_count: repeated.canonical_store.observations.length,
      duplicate_created: repeated.duplicate_created
    }));

  const beforeTwin = buildRecoveryStateFromObservationS66Test_([], {as_of: "2026-08-14T23:59:59+03:00"});
  const afterTwin = buildRecoveryStateFromObservationS66Test_(confirmed.canonical_store.observations, {
    as_of: "2026-08-14T23:59:59+03:00"
  });
  tests.push(testCaseDq_("S66-T06", "Test 6: Digital Twin rebuild sees canonical Recovery facts",
    beforeTwin.status === "NO_DATA" && afterTwin.status === "PARTIAL_DATA" &&
    afterTwin.canonical_records_count === 3 && afterTwin.observation_values.sleep_hours === 7 &&
    afterTwin.observation_values.energy === 8 && afterTwin.observation_values.fatigue === 3 &&
    afterTwin.production_snapshot_updated === false && afterTwin.decision_objects.length === 0 &&
    afterTwin.recommendation_objects.length === 0 && afterTwin.write_performed === false, {
      before_status: beforeTwin.status,
      after_status: afterTwin.status,
      canonical_records_count: afterTwin.canonical_records_count,
      values: afterTwin.observation_values
    }));

  const readinessSimulation = simulateReadinessAfterRecoveryS66Test_(0, confirmed.canonical_store.observations);
  tests.push(testCaseDq_("S66-R01", "Recovery readiness simulation increases score without storage update",
    readinessSimulation.before === 0 && readinessSimulation.after === 14.3 &&
    readinessSimulation.confirmed_days_simulated === 1 && readinessSimulation.real_readiness_updated === false &&
    readinessSimulation.decision_objects.length === 0 && readinessSimulation.recommendation_objects.length === 0 &&
    readinessSimulation.write_performed === false, readinessSimulation));

  const canaryStore = normalizeRecoveryCanonicalStoreS66Test_(null, "CANARY");
  tests.push(testCaseDq_("S66-M01", "CANARY mode remains in-memory with physical writes disabled",
    canaryStore.mode === "CANARY" && canaryStore.physical_writes === 0 &&
    RECOVERY_PERSISTENCE_S66_CONFIG.PHYSICAL_WRITES_ENABLED === false, canaryStore));

  let activeError = null;
  try {
    normalizeRecoveryCanonicalStoreS66Test_(null, "ACTIVE");
  } catch (error) {
    activeError = String(error && error.message || error);
  }
  tests.push(testCaseDq_("S66-M02", "ACTIVE Recovery mode is hard-blocked",
    activeError === "ACTIVE_RECOVERY_COLLECTION_MODE_FORBIDDEN" &&
    RECOVERY_PERSISTENCE_S66_CONFIG.ACTIVE_ENABLED === false, {error: activeError}));

  tests.push(testCaseDq_("S66-S01", "No medical interpretation, decisions or recommendations are created",
    validCandidate.medical_safety.status === "FACTS_ONLY" &&
    painCandidate.medical_safety.diagnosis === null &&
    confirmed.decision_objects.length === 0 && confirmed.recommendation_objects.length === 0 &&
    afterTwin.decision_objects.length === 0 && afterTwin.recommendation_objects.length === 0, {
      medical_safety: painCandidate.medical_safety,
      decision_count: 0,
      recommendation_count: 0
    }));

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
    telegram_calls: 0,
    groq_calls: 0,
    decision_count: 0,
    recommendation_count: 0,
    deployments: 0,
    production_version_expected: RECOVERY_PERSISTENCE_S66_CONFIG.PRODUCTION_VERSION_EXPECTED
  };
  tests.push(testCaseDq_("S66-S02", "Regression safety and Google Sheets fingerprint",
    noMutation && before.sheet_count === 17 && beforeMemory && afterMemory && beforeMemory.hash === afterMemory.hash &&
    RECOVERY_PERSISTENCE_S66_CONFIG.PHYSICAL_WRITES_ENABLED === false &&
    RECOVERY_PERSISTENCE_S66_CONFIG.TELEGRAM_CALLS_ENABLED === false &&
    RECOVERY_PERSISTENCE_S66_CONFIG.GROQ_CALLS_ENABLED === false &&
    RECOVERY_PERSISTENCE_S66_CONFIG.DECISION_ENGINE_ENABLED === false &&
    RECOVERY_PERSISTENCE_S66_CONFIG.RECOMMENDATION_ENGINE_ENABLED === false, safety));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  const failed = tests.length - passed;
  const result = {
    suite: "SPRINT_6_6_RECOVERY_PERSISTENCE_TEST_ONLY",
    mode: "TEST",
    status: failed === 0 ? "PASS" : "FAIL",
    passed: passed,
    failed: failed,
    total: tests.length,
    current_readiness: 12.2,
    simulated_recovery_before: readinessSimulation.before,
    simulated_recovery_after: readinessSimulation.after,
    real_readiness_changed: false,
    canonical_store_count: confirmed.canonical_store.observations.length,
    digital_twin_transition: beforeTwin.status + " -> " + afterTwin.status,
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
    simulated_recovery_after: result.simulated_recovery_after,
    digital_twin_transition: result.digital_twin_transition,
    canonical_store_count: result.canonical_store_count,
    sheet_hash_unchanged: noMutation,
    ai_memory_hash_unchanged: beforeMemory && afterMemory ? beforeMemory.hash === afterMemory.hash : false
  }));
  return result;
}
