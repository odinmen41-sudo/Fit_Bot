/** C-20A.2 temporal comparison, boundary, and exercise-filter suite. */
function runC20A2TemporalBoundaryPatchTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function properties() { const values = {}; return {values: values, getProperty: function(k) { return values[k] || null; },
    setProperty: function(k, v) { values[k] = String(v); }}; }
  const temporalInputs = [
    ["раньше был 120, сейчас 118", 118],
    ["был 117, теперь 118", 118],
    ["в прошлом месяце был 120, сейчас 117", 117]
  ];
  const temporalResults = temporalInputs.map(function(item) {
    return {text: item[0], expected: item[1], result: detectTemporalWeightComparison_(item[0])};
  });
  record("C20A2-01_TEMPORAL_CURRENT_ONLY", temporalResults.every(function(item) {
    return item.result && item.result.value === item.expected && JSON.stringify(item.result).indexOf("120") < 0;
  }), {results: temporalResults});

  const isolatedPast = ["раньше был 117", "мой вес был 117", "когда-то весил 120"];
  record("C20A2-02_ISOLATED_PAST_REJECTED", isolatedPast.every(function(text) {
    return detectExplicitWeightUpdate_(text) === null && detectTemporalWeightComparison_(text) === null;
  }), {inputs: isolatedPast});

  const exerciseInputs = ["жим 117 кг", "присед 117 кг", "тяга 117 кг", "штанга 117 кг",
    "гантели 30 кг", "рабочий вес 117 кг"];
  record("C20A2-03_EXERCISE_CONTEXT_REJECTED", exerciseInputs.every(function(text) {
    return detectExplicitWeightUpdate_(text) === null && detectInvalidExplicitWeightBoundary_(text) === null;
  }) && detectExplicitWeightUpdate_("сейчас вешу 117 кг").value === 117, {inputs: exerciseInputs});

  const stateProperties = properties();
  let createCalls = 0;
  let saveCalls = 0;
  const dependencies = {
    read_state: function() { return {version: 2, pending_action: "NONE"}; },
    create_pending: function() { createCalls += 1; return {ok: true}; },
    save: function() { saveCalls += 1; return {ok: true}; }
  };
  function update(text) { return {update_id: 2001, message: {text: text, from: {id: 77}, chat: {id: 77}}}; }
  const invalidLow = routeWeightFactConfirmation_(update("мой вес 20 кг"), {
    dependencies: dependencies, state_options: {properties: stateProperties}
  });
  const invalidHigh = routeWeightFactConfirmation_(update("мой вес 500 кг"), {
    dependencies: dependencies, state_options: {properties: stateProperties}
  });
  record("C20A2-04_BOUNDARY_DETERMINISTIC_REJECTION", invalidLow.handled && !invalidLow.ok &&
    invalidLow.code === "WEIGHT_OUT_OF_RANGE" && invalidHigh.code === "WEIGHT_OUT_OF_RANGE" &&
    createCalls === 0 && saveCalls === 0 && Object.keys(stateProperties.values).length === 0,
  {low: invalidLow, high: invalidHigh, create_calls: createCalls, save_calls: saveCalls});

  const temporalProperties = properties();
  const temporalStateOptions = {properties: temporalProperties,
    lock: {tryLock: function() { return true; }, releaseLock: function() {}},
    now: function() { return new Date("2026-08-24T00:00:00.000Z").getTime(); }};
  let pendingCapture = null;
  const temporalRoute = routeWeightFactConfirmation_(update("раньше был 120, сейчас 118"), {
    now: new Date("2026-08-24T00:00:00.000Z"),
    state_options: temporalStateOptions,
    dependencies: {
      read_state: readCoachState_,
      set_pending_action: updateCoachPendingAction_,
      uuid: function() { return "uuid"; },
      format_date: function() { return "2026-08-24"; },
      validate_capture: function() { return {ready_for_confirmation: true}; },
      create_pending: function(value) { pendingCapture = value; return {ok: true, capture_id: value.capture_id}; }
    }
  });
  const temporalState = temporalProperties.values.COACH_STATE_77 || "";
  record("C20A2-05_COACH_STATE_HAS_NO_WEIGHT", temporalRoute.ok &&
    temporalState.indexOf("WEIGHT_UPDATE_CONFIRMATION") >= 0 && temporalState.indexOf("118") < 0 &&
    temporalState.indexOf("120") < 0 && temporalState.indexOf("раньше") < 0,
  {result: temporalRoute, state: temporalState});
  record("C20A2-06_PENDING_RAW_FREE_SIMULATION", pendingCapture && pendingCapture.raw_message === "" &&
    pendingCapture.mode === "SIMULATION" && pendingCapture.writes_allowed === false &&
    JSON.stringify(pendingCapture).indexOf("раньше") < 0,
  {raw_message: pendingCapture && pendingCapture.raw_message, mode: pendingCapture && pendingCapture.mode,
    writes_allowed: pendingCapture && pendingCapture.writes_allowed});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-20A.2_TEMPORAL_BOUNDARY_PATCH", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {pending_capture_writes_on_invalid: createCalls, state_writes_on_invalid: 0,
      save_calls_on_invalid: saveCalls, sheet_writes: 0, groq_calls: 0}};
}
