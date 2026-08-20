/**
 * C-05 — THIN Collection Orchestrator (test-only).
 *
 * Coordinates existing readiness, presentation, Smart Capture, confirmation,
 * save and Digital Twin contracts. It adds no collection-priority policy,
 * parsing rules, retry state machine, Telegram/Groq integration or domain writes.
 */
const COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG = Object.freeze({
  SCHEMA_VERSION: "collection-orchestrator-c05-v1",
  MODE: "TEST_ONLY",
  ALLOWED_SAVE_MODE: "SIMULATION",
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS_ENABLED: false,
  GROQ_CALLS_ENABLED: false,
  CANDIDATE_CATEGORY: Object.freeze({
    RECOVERY_OBSERVATION_CANDIDATE: "RECOVERY_LOG",
    BODY_OBSERVATION_CANDIDATE: "BODY_TRACKING",
    NUTRITION_OBSERVATION_CANDIDATE: "NUTRITION_LOG",
    WORKOUT_OBSERVATION_CANDIDATE: "WORKOUT_LOG"
  }),
  TERMINAL_SAVE_CODES: Object.freeze(["SAVED", "ALREADY_SAVED"])
});

function executeCollectionFlowC05Test_(input, options) {
  const request = input || {};
  const config = options || {};
  const now = config.now instanceof Date ? config.now : new Date();
  const validation = collectionOrchestratorValidateInputC05Test_(request);
  if (!validation.ok) return validation;

  const saveMode = String(config.save_mode || "SIMULATION").toUpperCase();
  if (saveMode !== COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.ALLOWED_SAVE_MODE) {
    return collectionOrchestratorResultC05Test_(false, "SAVE_MODE_FORBIDDEN",
      "C-05 permits SIMULATION only.", {step: "VALIDATION", save_mode: saveMode});
  }

  const repository = config.repository || config.spreadsheet_repository || null;
  if (!collectionOrchestratorRepositoryReadableC05Test_(repository)) {
    return collectionOrchestratorResultC05Test_(false, "REPOSITORY_NOT_INITIALIZED",
      "Explicit read-only spreadsheet repository is required.", {step: "REPOSITORY"});
  }

  let dependencies;
  try {
    dependencies = collectionOrchestratorDependenciesC05Test_(config.dependencies);
  } catch (error) {
    return collectionOrchestratorResultC05Test_(false, "DEPENDENCIES_INVALID",
      String(error && error.message || error), {step: "DEPENDENCIES"});
  }
  const effectiveSaveMode = String(dependencies.resolve_save_mode() || "").trim().toUpperCase();
  if (effectiveSaveMode !== COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.ALLOWED_SAVE_MODE) {
    return collectionOrchestratorResultC05Test_(false, "SAVE_MODE_FORBIDDEN",
      "Underlying save layer must be in SIMULATION mode.", {
        step: "SAVE_MODE", save_mode: saveMode, effective_save_mode: effectiveSaveMode
      });
  }

  const userId = String(request.user_id);
  const chatId = String(request.chat_id);
  const event = request.collection_event;
  const observedDate = request.options && request.options.observed_date || normalizeDateS63Test_(now);
  const flow = {current_step: "BASELINE", steps: [], save_mode: saveMode};
  let readiness = null;
  let presentation = null;
  let response = null;
  let capture = null;
  let captureValidation = null;
  let captureId = "";
  let confirmation = null;
  let saved = null;
  let fingerprintBefore = null;
  let fingerprintAfter = null;
  let twinBefore = null;
  let twinAfter = null;

  try {
    fingerprintBefore = dependencies.fingerprint(repository);
    twinBefore = dependencies.build_twin(userId, repository, now);
    flow.steps.push({step: "BASELINE", status: "COMPLETED"});

    flow.current_step = "READINESS";
    readiness = dependencies.build_readiness(repository, observedDate);
    flow.steps.push({step: "READINESS", status: "COMPLETED"});

    flow.current_step = "PRESENTATION_CHECK";
    const eligibility = dependencies.can_present(event, null, {
      now: now,
      observations: request.options && request.options.existing_observations || []
    });
    if (!eligibility || eligibility.allowed !== true) {
      return collectionOrchestratorResultC05Test_(false,
        String(eligibility && eligibility.reason || "PRESENTATION_NOT_ALLOWED"),
        "Collection presentation is not allowed.", {
          step: flow.current_step, readiness: readiness, eligibility: eligibility || null, flow: flow
        });
    }
    flow.steps.push({step: "PRESENTATION_CHECK", status: "COMPLETED"});

    flow.current_step = "PRESENTATION";
    presentation = dependencies.present(event, null, {now: now, mode: "PRESENTATION_TEST"});
    if (!presentation || presentation.action !== "PRESENT") {
      return collectionOrchestratorResultC05Test_(false,
        String(presentation && presentation.reason || "PRESENTATION_FAILED"),
        "Collection event was not presented.", {
          step: flow.current_step, readiness: readiness, presentation: presentation || null, flow: flow
        });
    }
    flow.steps.push({step: "PRESENTATION", status: "COMPLETED"});

    flow.current_step = "PROCESS_RESPONSE";
    if (typeof request.user_response !== "string" || !request.user_response.trim()) {
      return collectionOrchestratorResultC05Test_(false, "INVALID_RESPONSE",
        "Non-empty user_response is required.", {step: flow.current_step, flow: flow});
    }
    response = dependencies.process_response(
      presentation.event,
      presentation.state,
      request.user_response,
      {now: now, observed_date: observedDate, user_id: userId, mode: "PRESENTATION_TEST"}
    );
    if (response && response.action === "SKIPPED") {
      return collectionOrchestratorResultC05Test_(true, "SKIPPED", "Collection request was skipped.", {
        step: flow.current_step, readiness: readiness, presentation: presentation, response: response, flow: flow
      });
    }
    if (!response || !response.candidate_observation) {
      return collectionOrchestratorResultC05Test_(false, "NO_CANDIDATE",
        "Presentation response did not produce a candidate.", {step: flow.current_step, flow: flow});
    }
    flow.steps.push({step: "PROCESS_RESPONSE", status: "COMPLETED"});

    flow.current_step = "BUILD_CAPTURE";
    const bridge = collectionOrchestratorBuildCaptureC05Test_(response.candidate_observation, {
      user_id: userId,
      now: now
    });
    if (!bridge.ok) {
      return collectionOrchestratorResultC05Test_(false, bridge.code, bridge.message, {
        step: flow.current_step, candidate: response.candidate_observation, flow: flow
      });
    }
    capture = bridge.capture;
    captureId = String(capture.capture_id);
    flow.steps.push({step: "BUILD_CAPTURE", status: "COMPLETED", capture_id: captureId});

    flow.current_step = "CAPTURE_VALIDATION";
    captureValidation = dependencies.validate_capture(capture);
    if (!captureValidation || captureValidation.ready_for_confirmation !== true) {
      return collectionOrchestratorResultC05Test_(false, "VALIDATION_FAILED",
        "Capture validation failed.", {
          step: flow.current_step, capture_id: captureId, validation: captureValidation || null, flow: flow
        });
    }
    flow.steps.push({step: "CAPTURE_VALIDATION", status: "COMPLETED"});

    flow.current_step = "CREATE_PENDING";
    const created = dependencies.create_pending(capture, {
      now: now,
      ttl_minutes: 30,
      user_id: userId,
      chat_id: chatId,
      source_update_id: String(event.event_id),
      capture_id: captureId,
      validation: captureValidation
    });
    if (!created || created.ok !== true) {
      return collectionOrchestratorResultC05Test_(false,
        String(created && created.code || "CAPTURE_CREATION_FAILED"),
        String(created && created.message || "Pending capture creation failed."), {
          step: flow.current_step, create_result: created || null, flow: flow
        });
    }
    flow.steps.push({step: "CREATE_PENDING", status: "COMPLETED", create_code: created.code});

    flow.current_step = "CONFIRMATION";
    if (typeof request.confirmation_response !== "string" || !request.confirmation_response.trim()) {
      return collectionOrchestratorResultC05Test_(false, "CONFIRMATION_REQUIRED",
        "Explicit confirmation_response is required.", {step: flow.current_step, capture_id: captureId, flow: flow});
    }
    confirmation = dependencies.confirm(
      userId,
      chatId,
      captureId,
      request.confirmation_response,
      {now: now}
    );
    if (!confirmation || confirmation.code !== "CONFIRMED_FOR_SAVE") {
      return collectionOrchestratorResultC05Test_(!!(confirmation && confirmation.ok),
        String(confirmation && confirmation.code || "CONFIRMATION_FAILED"),
        String(confirmation && confirmation.message || "Confirmation failed."), {
          step: flow.current_step, capture_id: captureId, confirmation: confirmation || null,
          save_attempted: false, flow: flow
        });
    }
    flow.steps.push({step: "CONFIRMATION", status: "COMPLETED"});

    flow.current_step = "SAVE";
    saved = dependencies.save(captureId, userId, {
      now: now,
      chat_id: chatId,
      retry_failed: config.retry_failed === true
    });
    if (!saved || COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.TERMINAL_SAVE_CODES.indexOf(saved.code) < 0) {
      return collectionOrchestratorResultC05Test_(!!(saved && saved.ok),
        String(saved && saved.code || "SAVE_RESULT_INVALID"),
        String(saved && saved.message || "Save returned an invalid result."), {
          step: flow.current_step, capture_id: captureId, confirmation: confirmation,
          save: saved || null, save_completed: false, retry_save: saved && saved.code === "FAILED",
          flow: flow
        });
    }
    flow.steps.push({step: "SAVE", status: "COMPLETED", save_code: saved.code});

    flow.current_step = "DOMAIN_INTEGRITY";
    fingerprintAfter = dependencies.fingerprint(repository);
    const fingerprintUnchanged = collectionOrchestratorStableC05Test_(fingerprintBefore) ===
      collectionOrchestratorStableC05Test_(fingerprintAfter);
    if (!fingerprintUnchanged) {
      return collectionOrchestratorResultC05Test_(false, "DOMAIN_FINGERPRINT_CHANGED",
        "SIMULATION changed the read-only domain repository.", {
          step: flow.current_step, save: saved, save_completed: true, retry_save: false,
          fingerprint_before: fingerprintBefore, fingerprint_after: fingerprintAfter, flow: flow
        });
    }
    flow.steps.push({step: "DOMAIN_INTEGRITY", status: "COMPLETED"});

    flow.current_step = "DIGITAL_TWIN";
    try {
      twinAfter = dependencies.build_twin(userId, repository, now);
    } catch (twinError) {
      return collectionOrchestratorResultC05Test_(false, "TWIN_BUILD_FAILED",
        String(twinError && twinError.message || twinError), {
          step: flow.current_step, save: saved, save_completed: true,
          save_code: saved.code, retry_save: false, twin_verification_failed: true, flow: flow
        });
    }
    const twinUnchanged = collectionOrchestratorStableC05Test_(twinBefore) ===
      collectionOrchestratorStableC05Test_(twinAfter);
    if (!twinUnchanged) {
      return collectionOrchestratorResultC05Test_(false, "TWIN_FABRICATION_DETECTED",
        "Digital Twin changed although the domain repository did not.", {
          step: flow.current_step, save: saved, save_completed: true, save_code: saved.code,
          retry_save: false, twin_before: twinBefore, twin_after: twinAfter, flow: flow
        });
    }
    flow.steps.push({step: "DIGITAL_TWIN", status: "COMPLETED"});

    return collectionOrchestratorResultC05Test_(true, saved.code, saved.message, {
      flow: flow,
      readiness: readiness,
      presentation: presentation,
      response: response,
      capture_id: captureId,
      confirmation: confirmation,
      save: saved,
      save_completed: true,
      retry_save: false,
      fingerprint_before: fingerprintBefore,
      fingerprint_after: fingerprintAfter,
      fingerprint_unchanged: true,
      twin_before: twinBefore,
      twin: twinAfter,
      twin_unchanged: true,
      no_fabricated_data: true
    });
  } catch (error) {
    return collectionOrchestratorResultC05Test_(false, flow.current_step + "_FAILED",
      String(error && error.message || error), {
        step: flow.current_step,
        capture_id: captureId,
        save: saved,
        save_completed: !!(saved && COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.TERMINAL_SAVE_CODES.indexOf(saved.code) >= 0),
        retry_save: false,
        flow: flow
      });
  }
}

function collectionOrchestratorBuildCaptureC05Test_(candidate, context) {
  const input = candidate || {};
  const expectedCategory = COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.CANDIDATE_CATEGORY[input.candidate_type];
  if (!expectedCategory) {
    return {ok: false, code: "UNSUPPORTED_CANDIDATE_TYPE", message: "Candidate type is not supported by C-02 domain writers."};
  }
  if (String(input.user_id || "") !== String(context && context.user_id || "")) {
    return {ok: false, code: "CANDIDATE_OWNER_MISMATCH", message: "Candidate belongs to another user."};
  }
  const raw = String(input.payload && input.payload.raw_user_input || "").trim();
  if (!raw) {
    return {ok: false, code: "CANDIDATE_RAW_INPUT_REQUIRED", message: "Candidate must retain explicit raw user input."};
  }
  const intents = detectUserIntent_(raw).filter(function(intent) {
    return intent.category === expectedCategory;
  });
  if (intents.length !== 1) {
    return {ok: false, code: "CANDIDATE_CAPTURE_CONTRACT_MISMATCH", message: "Candidate type and Smart Capture intent do not match."};
  }
  const capture = extractStructuredData_(raw, intents, {
    now: context.now,
    capture_id: "c05-" + String(input.candidate_id)
  });
  if (!capture || !Array.isArray(capture.items) || capture.items.length !== 1 ||
      capture.items[0].category !== expectedCategory) {
    return {ok: false, code: "CANDIDATE_CAPTURE_CONTRACT_MISMATCH", message: "Smart Capture did not produce the expected domain item."};
  }
  capture.candidate_observations = [deepCloneDq_(input)];
  return {ok: true, code: "CAPTURE_BUILT", capture: capture};
}

function collectionOrchestratorDefaultConfirmationC05Test_(userId, chatId, captureId, response, options) {
  const intent = detectConfirmationIntent_(response);
  if (intent.intent === "CONFIRM") {
    return {ok: true, code: "CONFIRMED_FOR_SAVE", message: "Explicit confirmation accepted.", confirmation_intent: intent};
  }
  if (intent.intent === "CANCEL") {
    return cancelPendingCapture_(userId, chatId, {now: options && options.now});
  }
  return {ok: false, code: "UNKNOWN_CONFIRMATION", message: "Explicit Да/Нет confirmation is required.", confirmation_intent: intent};
}

function collectionOrchestratorDependenciesC05Test_(injected) {
  const dependencies = injected || {
    build_readiness: function(repository, observedDate) {
      return buildDataReadinessReportS63Test_({as_of: observedDate, spreadsheet_repository: repository});
    },
    can_present: canPresentDataCollectionRequestS65Test_,
    present: presentDataCollectionEventS65Test_,
    process_response: processDataCollectionResponseS65Test_,
    validate_capture: validateExtractedData_,
    create_pending: createPendingCapture_,
    confirm: collectionOrchestratorDefaultConfirmationC05Test_,
    save: saveConfirmedData_,
    resolve_save_mode: dataWriteMode_,
    build_twin: function(userId, repository, now) {
      return buildDigitalTwinSnapshotTest_(userId, {as_of: now, spreadsheet_repository: repository});
    },
    fingerprint: collectionOrchestratorDomainFingerprintC05Test_
  };
  const required = [
    "build_readiness", "can_present", "present", "process_response", "validate_capture",
    "create_pending", "confirm", "save", "resolve_save_mode", "build_twin", "fingerprint"
  ];
  const invalid = required.filter(function(name) { return typeof dependencies[name] !== "function"; });
  if (invalid.length) throw new Error("C05_DEPENDENCIES_MISSING:" + invalid.join(","));
  return dependencies;
}

function collectionOrchestratorDomainFingerprintC05Test_(repository) {
  const names = Object.keys(DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST).map(function(category) {
    return DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST[category];
  }).concat(["USER_EVENTS"]);
  const domainRepository = {
    readSheet: function(name, options) { return repository.readSheet(name, options); },
    readAllSheets: function(options) {
      return names.map(function(name) { return repository.readSheet(name, options); });
    }
  };
  return captureSpreadsheetFingerprintDq_(domainRepository);
}

function collectionOrchestratorValidateInputC05Test_(input) {
  if (!input || typeof input !== "object") {
    return collectionOrchestratorResultC05Test_(false, "INVALID_INPUT", "Input object is required.", {step: "VALIDATION"});
  }
  if (!String(input.user_id || "").trim() || !String(input.chat_id || "").trim()) {
    return collectionOrchestratorResultC05Test_(false, "INVALID_USER", "user_id and chat_id are required.", {step: "VALIDATION"});
  }
  const event = input.collection_event;
  if (!event || !event.event_id || !event.collection_type || event.status !== "CREATED" ||
      String(event.user_id || "") !== String(input.user_id)) {
    return collectionOrchestratorResultC05Test_(false, "INVALID_COLLECTION_EVENT",
      "Caller must provide a CREATED collection_event owned by the user.", {step: "VALIDATION"});
  }
  return {ok: true};
}

function collectionOrchestratorRepositoryReadableC05Test_(repository) {
  return !!repository && typeof repository.readSheet === "function" && typeof repository.readAllSheets === "function";
}

function collectionOrchestratorStableC05Test_(value) {
  return stableStringifyS63Test_(value);
}

function collectionOrchestratorResultC05Test_(ok, code, message, extra) {
  const result = {
    ok: ok === true,
    code: String(code || "UNKNOWN"),
    message: String(message || ""),
    schema_version: COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.SCHEMA_VERSION,
    mode: COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.MODE,
    production_writes: false,
    real_sheet_reads: 0,
    real_sheet_writes: 0,
    telegram_calls: 0,
    groq_calls: 0
  };
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}

function testCollectionOrchestratorC05_() {
  const tests = [];
  const now = new Date("2026-08-14T15:00:00+03:00");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: details || null});
  }
  function run(scenario, changes, environment) {
    const env = environment || collectionOrchestratorHarnessC05Test_(scenario || {});
    const userId = "c05-user";
    const input = {
      user_id: userId,
      chat_id: "c05-chat",
      collection_event: collectionOrchestratorEventFixtureC05Test_(userId, "RECOVERY_CHECKIN", now),
      user_response: "Спал 7 часов, энергия 8, боли нет",
      confirmation_response: "Да",
      options: {observed_date: "2026-08-14"}
    };
    Object.keys(changes && changes.input || {}).forEach(function(key) { input[key] = changes.input[key]; });
    const opts = {now: now, save_mode: "SIMULATION", repository: env.repository, dependencies: env.dependencies};
    Object.keys(changes && changes.options || {}).forEach(function(key) { opts[key] = changes.options[key]; });
    return {result: executeCollectionFlowC05Test_(input, opts), env: env, input: input};
  }

  const happy = run({});
  record("C05-01_HAPPY_PATH", happy.result.ok && happy.result.code === "SAVED", happy.result.code);

  const missingRepo = run({}, {options: {repository: null}});
  record("C05-02_REPOSITORY_MISSING", !missingRepo.result.ok && missingRepo.result.code === "REPOSITORY_NOT_INITIALIZED", missingRepo.result.code);

  const invalidEvent = run({}, {input: {collection_event: {collection_type: "RECOVERY_CHECKIN"}}});
  record("C05-03_INVALID_EVENT", !invalidEvent.result.ok && invalidEvent.result.code === "INVALID_COLLECTION_EVENT", invalidEvent.result.code);

  const notAllowed = run({presentation_allowed: false});
  record("C05-04_PRESENTATION_NOT_ALLOWED", !notAllowed.result.ok && notAllowed.result.code === "COOLDOWN_ACTIVE", notAllowed.result.code);

  const presentationFailure = run({presentation_error: true});
  record("C05-05_PRESENTATION_FAILURE", !presentationFailure.result.ok && presentationFailure.result.code === "PRESENTATION_FAILED", presentationFailure.result.code);

  const invalidResponse = run({}, {input: {user_response: ""}});
  record("C05-06_INVALID_RESPONSE", !invalidResponse.result.ok && invalidResponse.result.code === "INVALID_RESPONSE", invalidResponse.result.code);

  const createFailure = run({create_code: "LOCK_TIMEOUT"});
  record("C05-07_PENDING_CREATE_FAILURE", !createFailure.result.ok && createFailure.result.code === "LOCK_TIMEOUT", createFailure.result.code);

  const cancelled = run({confirmation_code: "CANCELLED"});
  record("C05-08_CONFIRMATION_CANCELLED", cancelled.result.ok && cancelled.result.code === "CANCELLED" && cancelled.result.save_attempted === false, cancelled.result.code);

  const expired = run({confirmation_code: "EXPIRED"});
  record("C05-09_CONFIRMATION_EXPIRED", !expired.result.ok && expired.result.code === "EXPIRED" && expired.result.save_attempted === false, expired.result.code);

  const simulation = run({});
  record("C05-10_SIMULATION_SAVED", simulation.result.ok && simulation.result.code === "SAVED" && simulation.result.save_completed === true, simulation.result.code);

  const failed = run({save_sequence: ["FAILED"]});
  record("C05-11_SAVE_FAILED", !failed.result.ok && failed.result.code === "FAILED" && failed.result.retry_save === true, failed.result.code);

  const retryEnv = collectionOrchestratorHarnessC05Test_({save_sequence: ["FAILED", "SAVED"]});
  const retryFirst = run({}, {}, retryEnv).result;
  const retrySecond = run({}, {options: {retry_failed: true}}, retryEnv).result;
  record("C05-12_EXPLICIT_RETRY", retryFirst.code === "FAILED" && retrySecond.ok && retrySecond.code === "SAVED" && retryEnv.counters.save_calls === 2, {
    first: retryFirst.code, second: retrySecond.code, calls: retryEnv.counters.save_calls
  });

  const alreadyEnv = collectionOrchestratorHarnessC05Test_({});
  const alreadyFirst = run({}, {}, alreadyEnv).result;
  const alreadySecond = run({}, {}, alreadyEnv).result;
  record("C05-13_ALREADY_SAVED", alreadyFirst.code === "SAVED" && alreadySecond.ok && alreadySecond.code === "ALREADY_SAVED", alreadySecond.code);

  record("C05-14_FINGERPRINT_UNCHANGED", simulation.result.fingerprint_unchanged === true &&
    collectionOrchestratorStableC05Test_(simulation.result.fingerprint_before) === collectionOrchestratorStableC05Test_(simulation.result.fingerprint_after), simulation.result.fingerprint_after);
  record("C05-15_NO_FABRICATED_TWIN", simulation.result.no_fabricated_data === true && simulation.result.twin_unchanged === true &&
    collectionOrchestratorStableC05Test_(simulation.result.twin_before) === collectionOrchestratorStableC05Test_(simulation.result.twin), simulation.result.twin);

  const goalRun = run({}, {input: {
    collection_event: collectionOrchestratorEventFixtureC05Test_("c05-user", "GOAL_CONFIRMATION", now),
    user_response: "Хочу 108 кг к декабрю"
  }});
  record("C05-16_UNSUPPORTED_CANDIDATE", !goalRun.result.ok && goalRun.result.code === "UNSUPPORTED_CANDIDATE_TYPE", goalRun.result.code);

  const saving = run({save_sequence: ["SAVING"]});
  record("C05-17_SAVING_PROPAGATED", !saving.result.ok && saving.result.code === "SAVING" && saving.result.save_completed === false, saving.result.code);

  const canaryBlocked = run({effective_save_mode: "CANARY"});
  record("C05-18_EFFECTIVE_CANARY_BLOCKED", !canaryBlocked.result.ok &&
    canaryBlocked.result.code === "SAVE_MODE_FORBIDDEN" && canaryBlocked.env.counters.save_calls === 0,
    {code: canaryBlocked.result.code, save_calls: canaryBlocked.env.counters.save_calls});

  const changedFingerprint = run({fingerprint_changes_after_save: true});
  record("C05-19_FINGERPRINT_CHANGE_DETECTED", !changedFingerprint.result.ok &&
    changedFingerprint.result.code === "DOMAIN_FINGERPRINT_CHANGED" &&
    changedFingerprint.result.save_completed === true && changedFingerprint.result.retry_save === false,
    changedFingerprint.result.code);

  const fabricatedTwin = run({twin_changes_after_save: true});
  record("C05-20_TWIN_FABRICATION_DETECTED", !fabricatedTwin.result.ok &&
    fabricatedTwin.result.code === "TWIN_FABRICATION_DETECTED" &&
    fabricatedTwin.result.save_completed === true && fabricatedTwin.result.retry_save === false,
    fabricatedTwin.result.code);

  const twinFailure = run({twin_error_after_save: true});
  record("C05-21_TWIN_FAILURE_AFTER_SAVE", !twinFailure.result.ok && twinFailure.result.code === "TWIN_BUILD_FAILED" &&
    twinFailure.result.save_completed === true && twinFailure.result.save_code === "SAVED" && twinFailure.result.retry_save === false, twinFailure.result.code);

  record("C05-22_FAKE_IO_ONLY", happy.env.counters.in_memory_technical_writes > 0 &&
    happy.env.counters.real_sheet_reads === 0 && happy.env.counters.real_sheet_writes === 0 &&
    happy.env.counters.domain_writes === 0, happy.env.counters);
  record("C05-23_NO_EXTERNAL_CALLS", happy.result.telegram_calls === 0 && happy.result.groq_calls === 0 &&
    COLLECTION_ORCHESTRATOR_C05_TEST_CONFIG.PRODUCTION_WRITES_ENABLED === false, {
      telegram: happy.result.telegram_calls, groq: happy.result.groq_calls
    });

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "C-05_THIN_COLLECTION_ORCHESTRATOR",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {
      production_writes: 0,
      real_sheet_reads: 0,
      real_sheet_writes: 0,
      domain_writes: 0,
      telegram_calls: 0,
      groq_calls: 0,
      deployment: 0,
      workflow_dispatch: 0
    }
  };
}

function collectionOrchestratorHarnessC05Test_(scenario) {
  const config = scenario || {};
  const counters = {
    fake_repository_reads: 0,
    in_memory_technical_writes: 0,
    domain_writes: 0,
    real_sheet_reads: 0,
    real_sheet_writes: 0,
    save_calls: 0,
    twin_calls: 0,
    fingerprint_calls: 0
  };
  const captures = {};
  const domain = {
    Body_Tracking: [], Workout_Log: [], Nutrition_Log: [], Recovery_Log: [], USER_EVENTS: []
  };
  const repository = {
    readSheet: function(name) {
      counters.fake_repository_reads += 1;
      return {exists: true, sheet_id: Object.keys(domain).indexOf(name) + 1, name: name,
        last_row: 0, last_column: 0, values: deepCloneDq_(domain[name] || [])};
    },
    readAllSheets: function() {
      counters.fake_repository_reads += 1;
      return Object.keys(domain).map(function(name, index) {
        return {exists: true, sheet_id: index + 1, name: name, last_row: 0, last_column: 0, values: deepCloneDq_(domain[name])};
      });
    }
  };
  const saveSequence = (config.save_sequence || []).slice();
  const dependencies = {
    build_readiness: function(repo) {
      repo.readSheet("Body_Tracking");
      return {report_type: "DATA_READINESS_REPORT", overall_readiness_score: 0, ready_for_decision_engine: false};
    },
    can_present: function(event, state, options) {
      if (config.presentation_allowed === false) return {allowed: false, reason: "COOLDOWN_ACTIVE"};
      return canPresentDataCollectionRequestS65Test_(event, state, options);
    },
    present: function(event, state, options) {
      if (config.presentation_error === true) throw new Error("PRESENTATION_FIXTURE_FAILURE");
      return presentDataCollectionEventS65Test_(event, state, options);
    },
    process_response: processDataCollectionResponseS65Test_,
    validate_capture: validateExtractedData_,
    create_pending: function(capture, metadata) {
      if (config.create_code) return {ok: false, code: config.create_code, message: "Injected create failure."};
      if (!captures[metadata.capture_id]) {
        captures[metadata.capture_id] = {status: "PENDING_CONFIRMATION", capture: deepCloneDq_(capture)};
        counters.in_memory_technical_writes += 1;
        return {ok: true, code: "CREATED", capture_id: metadata.capture_id};
      }
      return {ok: true, code: "CAPTURE_ALREADY_EXISTS", capture_id: metadata.capture_id};
    },
    confirm: function(userId, chatId, captureId, response) {
      if (config.confirmation_code === "CANCELLED") {
        counters.in_memory_technical_writes += 1;
        return {ok: true, code: "CANCELLED", message: "Cancelled."};
      }
      if (config.confirmation_code === "EXPIRED") {
        counters.in_memory_technical_writes += 1;
        return {ok: false, code: "EXPIRED", message: "Expired."};
      }
      return collectionOrchestratorDefaultConfirmationC05Test_(userId, chatId, captureId, response, {});
    },
    save: function(captureId, userId, saveOptions) {
      counters.save_calls += 1;
      const stored = captures[captureId];
      if (stored && stored.status === "SAVED") {
        return {ok: true, code: "ALREADY_SAVED", message: "Already saved.", production_writes: false};
      }
      let code = saveSequence.length ? saveSequence.shift() : "SAVED";
      if (stored && stored.status === "FAILED" && saveOptions.retry_failed !== true && code === "SAVED") {
        code = "RECOVERY_RETRY_REQUIRED";
      }
      if (code === "SAVED") {
        if (stored) stored.status = "SAVED";
        counters.in_memory_technical_writes += 1;
        return {ok: true, code: code, message: "Saved in simulation.", transaction: {simulated: true}, production_writes: false};
      }
      if (code === "FAILED") {
        if (stored) stored.status = "FAILED";
        counters.in_memory_technical_writes += 1;
        return {ok: false, code: code, message: "Injected save failure.", transaction: {retryable: true}, production_writes: false};
      }
      return {ok: false, code: code, message: "Injected non-terminal save state.", production_writes: false};
    },
    resolve_save_mode: function() { return String(config.effective_save_mode || "SIMULATION"); },
    build_twin: function(userId, repo, timestamp) {
      counters.twin_calls += 1;
      if (config.twin_error_after_save === true && counters.twin_calls > 1) throw new Error("INJECTED_TWIN_FAILURE");
      const snapshot = repo.readAllSheets();
      return {snapshot_id: "c05-twin-fixture", user_id: String(userId), as_of: timestamp.toISOString(),
        domain: deepCloneDq_(snapshot), injected_change: config.twin_changes_after_save === true && counters.twin_calls > 1};
    },
    fingerprint: function(repo) {
      counters.fingerprint_calls += 1;
      const suffix = config.fingerprint_changes_after_save === true && counters.fingerprint_calls > 1 ? "|changed" : "";
      return {domain_hash: digestHexDq_(stableStringifyS63Test_(repo.readAllSheets()) + suffix)};
    }
  };
  return {repository: repository, dependencies: dependencies, counters: counters, captures: captures, domain: domain};
}

function collectionOrchestratorEventFixtureC05Test_(userId, collectionType, now) {
  const fields = {
    RECOVERY_CHECKIN: ["sleep_hours", "energy", "pain"],
    BODY_WEIGHT_COLLECTION: ["weight", "date"],
    NUTRITION_LOG_COLLECTION: ["foods", "quantity"],
    GOAL_CONFIRMATION: ["target_weight", "deadline"],
    WORKOUT_DATA_COLLECTION: ["exercise", "weight", "sets", "reps", "date"]
  };
  return {
    event_id: "c05-event-" + String(collectionType).toLowerCase(),
    user_id: String(userId),
    collection_type: collectionType,
    requested_fields: (fields[collectionType] || []).slice(),
    reason: "CALLER_SUPPLIED_TEST_FIXTURE",
    priority: collectionType,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    status: "CREATED",
    write_performed: false
  };
}

function runCollectionOrchestratorC05Tests() {
  return testCollectionOrchestratorC05_();
}
