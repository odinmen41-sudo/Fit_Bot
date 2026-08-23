/** C-20A deterministic weight fact confirmation in-memory suite. */
function runC20AWeightFactConfirmationTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function properties() { const values = {}; return {values: values, getProperty: function(k) { return values[k] || null; },
    setProperty: function(k, v) { values[k] = String(v); }}; }
  function lock(events) { return {tryLock: function() { if (events) events.push("lock"); return true; },
    releaseLock: function() { if (events) events.push("unlock"); }}; }
  const now = new Date("2026-08-23T15:00:00.000Z");

  const detected = ["мой вес 117 кг", "сейчас вешу 117", "вес сегодня 117 кг"].map(detectExplicitWeightUpdate_);
  record("C20A-01_EXPLICIT_WEIGHT_DETECTED", detected.every(function(item) {
    return item && item.value === 117 && item.category === "BODY_TRACKING";
  }), {detected: detected});
  const rejected = ["присед 100 кг", "скинул 2 кг", "117", "мой вес примерно 117 кг", "мой вес 10 кг"];
  record("C20A-02_AMBIGUOUS_AND_WORKOUT_REJECTED", rejected.every(function(text) {
    return detectExplicitWeightUpdate_(text) === null;
  }), {rejected: rejected});

  const capture = buildWeightPendingCapture_(detected[0], {now: now, update_id: "501", uuid: function() { return "uuid"; },
    format_date: function() { return "2026-08-23"; }});
  const captureValidation = validateExtractedData_(capture);
  record("C20A-03_RAW_FREE_STRUCTURED_CAPTURE", capture.raw_message === "" && capture.source === "C20A_WEIGHT_GATE" &&
    capture.items.length === 1 && capture.items[0].category === "BODY_TRACKING" &&
    capture.writes_allowed === false && captureValidation.ready_for_confirmation === true &&
    JSON.stringify(capture).indexOf("мой вес") < 0, {capture: capture, validation: captureValidation});

  const collisionRows = [{capture_id: "recovery-1", user_id: "111", chat_id: "-999",
    status: "PENDING_CONFIRMATION", expires_at: new Date(now.getTime() + 60000)}];
  let appended = 0;
  const collision = createWeightPendingCaptureC20A_(capture, {
    now: now, capture_id: capture.capture_id, user_id: "111", chat_id: "-999",
    validation: {ready_for_confirmation: true}
  }, {skip_mode_check: true, lock: lock([]), sheet: {}, read_rows: function() { return collisionRows; },
    append_row: function() { appended += 1; }, flush: function() {}});
  record("C20A-04_ATOMIC_COLLISION_REJECTED", collision.code === "ACTIVE_CAPTURE_EXISTS" && appended === 0,
    {result: collision, appended: appended});

  const stateProperties = properties();
  const stateOptions = {properties: stateProperties, lock: lock([]), now: function() { return now.getTime(); }};
  const pendingRows = [];
  let saveCalls = 0;
  let cancelCalls = 0;
  let domainWrites = 0;
  const dependencies = {
    read_state: readCoachState_,
    set_pending_action: updateCoachPendingAction_,
    validate_capture: function(value) { return {capture_id: value.capture_id, ready_for_confirmation: true,
      items: [{category: "BODY_TRACKING", status: "PASS", errors: []}]}; },
    uuid: function() { return "uuid"; },
    format_date: function() { return "2026-08-23"; },
    detect_confirmation: detectConfirmationIntent_,
    create_pending: function(value, metadata) {
      if (pendingRows.some(function(row) { return row.status === "PENDING_CONFIRMATION"; })) {
        return {ok: false, code: "ACTIVE_CAPTURE_EXISTS"};
      }
      pendingRows.push({capture_id: value.capture_id, user_id: String(metadata.user_id), chat_id: String(metadata.chat_id),
        expires_at: new Date(now.getTime() + 30 * 60000), status: "PENDING_CONFIRMATION",
        raw_message: "", payload_json: JSON.stringify(value)});
      return {ok: true, code: "CREATED", capture_id: value.capture_id};
    },
    get_pending: function(userId, chatId) {
      const row = pendingRows.filter(function(item) { return item.user_id === String(userId) &&
        item.chat_id === String(chatId) && item.status === "PENDING_CONFIRMATION"; })[0];
      return row ? {ok: true, code: "ACTIVE_CAPTURE_FOUND", capture: row} : {ok: false, code: "NO_ACTIVE_CAPTURE"};
    },
    save: function(captureId, userId, options) {
      saveCalls += 1;
      const row = pendingRows.filter(function(item) { return item.capture_id === captureId; })[0];
      if (row.status === "SAVED") return {ok: true, code: "ALREADY_SAVED", production_writes: false};
      if (row.user_id !== String(userId) || row.chat_id !== String(options.chat_id)) return {ok: false, code: "OWNER_MISMATCH"};
      row.status = "SAVED";
      return {ok: true, code: "SAVED", production_writes: false,
        transaction: {mode: "SIMULATION", operations: [{category: "BODY_TRACKING", written: false}]}};
    },
    cancel: function(userId, chatId) {
      cancelCalls += 1;
      const row = pendingRows.filter(function(item) { return item.user_id === String(userId) &&
        item.chat_id === String(chatId) && item.status === "PENDING_CONFIRMATION"; })[0];
      if (!row) return {ok: false, code: "NO_ACTIVE_CAPTURE"};
      row.status = "CANCELLED";
      return {ok: true, code: "CANCELLED", production_writes: false};
    },
    cancel_created: function(userId, chatId, captureId) {
      cancelCalls += 1;
      const row = pendingRows.filter(function(item) { return item.capture_id === String(captureId) &&
        item.user_id === String(userId) && item.chat_id === String(chatId); })[0];
      if (!row || row.status !== "PENDING_CONFIRMATION") return {ok: false, code: "NOT_CONFIRMABLE"};
      row.status = "CANCELLED";
      return {ok: true, code: "CANCELLED"};
    }
  };
  function update(id, text, chat) { return {update_id: id, message: {text: text, from: {id: 111}, chat: {id: chat || -999}}}; }

  const requested = routeWeightFactConfirmation_(update(601, "мой вес 117 кг"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  const stateRaw = stateProperties.values.COACH_STATE_111 || "";
  record("C20A-05_PENDING_ACTION_WITHOUT_VALUE", requested.ok && stateRaw.indexOf("WEIGHT_UPDATE_CONFIRMATION") >= 0 &&
    stateRaw.indexOf("117") < 0 && stateRaw.indexOf("мой вес") < 0, {result: requested, state: stateRaw});
  record("C20A-06_PENDING_RAW_MESSAGE_EMPTY", pendingRows[0] && pendingRows[0].raw_message === "" &&
    JSON.parse(pendingRows[0].payload_json).source === "C20A_WEIGHT_GATE", {pending: pendingRows[0]});

  const ownerMismatch = verifyWeightPendingCapture_({ok: true, capture: pendingRows[0]}, "222", "-999", now);
  record("C20A-07_OWNER_ISOLATION", ownerMismatch.code === "OWNER_MISMATCH", ownerMismatch);
  const yes = routeWeightFactConfirmation_(update(602, "Да"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  record("C20A-08_YES_SIMULATION_SAVE", yes.ok && yes.code === "SAVED" && saveCalls === 1 && domainWrites === 0 &&
    JSON.parse(stateProperties.values.COACH_STATE_111).pending_action === "NONE", {result: yes, save_calls: saveCalls});
  const duplicate = dependencies.save(pendingRows[0].capture_id, "111", {chat_id: "-999", now: now});
  record("C20A-09_DUPLICATE_IDEMPOTENT", duplicate.code === "ALREADY_SAVED" && domainWrites === 0, duplicate);

  pendingRows.length = 0;
  routeWeightFactConfirmation_(update(603, "вес сегодня 118 кг"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  const no = routeWeightFactConfirmation_(update(604, "Нет"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  record("C20A-10_NO_CANCELS", no.ok && no.code === "CANCELLED" && cancelCalls === 1 &&
    pendingRows[0].status === "CANCELLED", {result: no});

  pendingRows.length = 0;
  routeWeightFactConfirmation_(update(605, "сейчас вешу 119"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  pendingRows[0].expires_at = new Date(now.getTime() - 1);
  const expired = routeWeightFactConfirmation_(update(606, "Да"), {
    now: now, dependencies: dependencies, state_options: stateOptions
  });
  record("C20A-11_EXPIRED_REJECTED", !expired.ok && expired.code === "EXPIRED" &&
    JSON.parse(stateProperties.values.COACH_STATE_111).pending_action === "NONE", expired);

  pendingRows.length = 0;
  const rollbackDeps = Object.assign({}, dependencies, {
    set_pending_action: function() { return false; },
    cancel_created: function() { cancelCalls += 1; if (pendingRows[0]) pendingRows[0].status = "CANCELLED";
      return {ok: true, code: "CANCELLED"}; }
  });
  const rollback = routeWeightFactConfirmation_(update(607, "мой вес 120 кг"), {
    now: now, dependencies: rollbackDeps, state_options: stateOptions
  });
  record("C20A-12_STATE_FAILURE_CANCELS_CAPTURE", !rollback.ok && rollback.code === "STATE_UPDATE_FAILED" &&
    pendingRows[0].status === "CANCELLED", {result: rollback, pending: pendingRows[0]});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-20A_WEIGHT_FACT_CONFIRMATION", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {sheet_writes: 0, domain_writes: domainWrites, telegram_calls: 0, groq_calls: 0}};
}
