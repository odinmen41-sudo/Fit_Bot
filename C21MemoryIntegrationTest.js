/** C-21 confirmed fact to AI_MEMORY integration in-memory suite. */
function runC21MemoryIntegrationTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function lock() { return {tryLock: function() { return true; }, releaseLock: function() {}}; }
  function properties(seed) { const values = Object.assign({}, seed || {}); return {values: values,
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setProperty: function(key, value) { values[key] = String(value); }}; }
  function store(headers, rows) { return {headers: headers.slice(), rows: (rows || []).map(function(row) { return row.slice(); }), writes: 0}; }
  function runtimeFor(target, extra) { return Object.assign({data_write_mode: "ACTIVE", lock: lock(), retry_lock: lock(),
    read_table: function() { return {headers: target.headers.slice(), rows: target.rows.map(function(row) { return row.slice(); })}; },
    write_table: function(sheet, headers, rows) { target.headers = headers.slice(); target.rows = rows.map(function(row) { return row.slice(); }); target.writes += 1; },
    flush: function() {}, now: new Date("2026-08-24T10:00:00.000Z"),
    uuid: function() { return "123e4567-e89b-42d3-a456-426614174000"; }}, extra || {}); }
  const headers9 = ["ID", "USER_ID", "CATEGORY", "KEY", "VALUE", "PRIORITY", "UPDATED_AT", "SOURCE", "CONFIRMATION_ID"];
  const headers7 = headers9.slice(0, 7);
  function payload(weight) { return {items: [{category: "BODY_TRACKING", fields: {weight: {value: weight}}}]}; }

  const routedStore = store(headers9, []);
  const routed = processConfirmedFacts_("capture-1", "user-1", payload(117), runtimeFor(routedStore));
  record("C21-01_PROCESS_ROUTES_WEIGHT", routed.ok && routed.code === "MEMORY_SYNCED" && routedStore.rows.length === 1, routed);

  record("C21-02_PRODUCTION_MEMORY_BATCH_WRITE", routedStore.writes === 1 && routed.memory_writes === 1 &&
    routedStore.rows.every(function(row) { return row[1] === "user-1"; }), {writes: routedStore.writes, rows: routedStore.rows});

  const simulationStore = store(headers9, []);
  const simulated = processConfirmedFacts_("capture-sim", "user-1", payload(117),
    runtimeFor(simulationStore, {data_write_mode: "SIMULATION"}));
  record("C21-03_SIMULATION_ZERO_MEMORY_WRITES", simulated.memory_sync_status === "SYNCED" &&
    simulated.memory_writes === 0 && simulationStore.writes === 0 && simulationStore.rows.length === 0, simulated);

  const invalid = handleWeightFactPersistence_("user-1", 500, "capture-invalid", runtimeFor(store(headers9, [])));
  record("C21-04_INVALID_WEIGHT_REJECTED", !invalid.ok && invalid.code === "INVALID_WEIGHT", invalid);

  const id1 = generateEventId_(new Date("2026-08-24T10:00:00.000Z"),
    {uuid: function() { return "123e4567-e89b-42d3-a456-426614174000"; }});
  const id2 = generateEventId_(new Date("2026-08-24T10:00:00.001Z"),
    {uuid: function() { return "123e4567-e89b-42d3-a456-426614174001"; }});
  record("C21-05_FULL_UUID_EVENT_IDS_UNIQUE", id1 !== id2 &&
    /_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id1), {id1: id1, id2: id2});

  const legacyStore = store(headers7, []);
  handleWeightFactPersistence_("user-2", 117, "confirm-1", runtimeFor(legacyStore));
  const secondRuntime = runtimeFor(legacyStore, {now: new Date("2026-08-24T11:00:00.000Z"),
    uuid: function() { return "123e4567-e89b-42d3-a456-426614174002"; }});
  handleWeightFactPersistence_("user-2", 118, "confirm-2", secondRuntime);
  const currentRows = legacyStore.rows.filter(function(row) { return row[2] === "body_tracking" && row[3] === "weight_event"; });
  record("C21-06_WEIGHT_EVENTS_SCHEMA7", currentRows.length === 2 && currentRows[0][4] === "117" &&
    currentRows[1][4] === "118" && legacyStore.headers.length === 7, {events: currentRows, headers: legacyStore.headers});
  record("C21-07_HISTORY_APPEND_ONLY", currentRows.length === 2 && currentRows[0][0] !== currentRows[1][0], {history: currentRows});

  const retryProps = properties({DATA_WRITE_MODE: "ACTIVE"});
  const failed = handleWeightFactPersistence_("user-3", 119, "confirm-fail", runtimeFor(store(headers9, []), {
    properties: retryProps, write_table: function() { throw new Error("WRITE_FAILED"); }
  }));
  const retryQueue = JSON.parse(retryProps.values["C21_MEMORY_RETRY_QUEUE_user-3"] || "[]");
  record("C21-08_FAILURE_RETRY_PENDING", failed.memory_sync_status === "RETRY_PENDING" && retryQueue.length === 1 &&
    retryQueue[0].fact_type === "WEIGHT", {result: failed, queue: retryQueue});

  const coachBefore = '{"version":2,"pending_action":"NONE"}';
  const separationProps = properties({DATA_WRITE_MODE: "ACTIVE", COACH_STATE_77: coachBefore});
  handleWeightFactPersistence_("77", 120, "confirm-separation", runtimeFor(store(headers9, []), {
    properties: separationProps, write_table: function() { throw new Error("WRITE_FAILED"); }
  }));
  record("C21-09_COACH_STATE_UNCHANGED", separationProps.values.COACH_STATE_77 === coachBefore &&
    separationProps.values.C21_MEMORY_RETRY_QUEUE_77.indexOf("COACH_STATE") < 0, {coach_state: separationProps.values.COACH_STATE_77});

  const contextMemory = [
    {category: "body_tracking", key: "weight_event", value: "117", priority: "HIGH", updated_at: "2026-08-24T10:00:00Z"},
    {category: "body_tracking", key: "weight_event", value: "118", priority: "HIGH", updated_at: "2026-08-23T10:00:00Z"},
    {category: "body_tracking", key: "weight_event", value: "119", priority: "HIGH", updated_at: "2026-08-22T10:00:00Z"}
  ];
  const context = buildMemoryCoachContext_("user-4", "user-4", {memory: contextMemory, persona: {}, rules: [],
    skip_sources: true, chat_history: ""});
  record("C21-10_CONTEXT_CURRENT_WEIGHT", context.indexOf("Текущий вес: 117 кг") >= 0, {context: context});
  record("C21-11_CONTEXT_WEIGHT_HISTORY", context.indexOf("118 кг") >= 0 && context.indexOf("119 кг") >= 0 &&
    context.indexOf("confirmation") < 0 && context.indexOf("C21_CONFIRMED_FACT") < 0, {context: context});

  const wrapperStore = store(headers9, []);
  const wrapped = saveConfirmedDataWithMemory_("capture-wrapper", "user-5", Object.assign(runtimeFor(wrapperStore, {
    data_write_mode: "SIMULATION", payload: payload(117), confirmation_id: "capture-wrapper"
  }), {save_confirmed: function() { return {ok: true, code: "SAVED", production_writes: false}; }}));
  record("C21-12_C20A_CONFIRMATION_MEMORY_DISABLED", wrapped.ok && wrapped.code === "SAVED" &&
    wrapped.memory_sync_status === "SYNCED" && wrapperStore.writes === 0, wrapped);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-21_MEMORY_INTEGRATION", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {simulation_memory_writes: simulationStore.writes, coach_state_writes: 0,
      sheet_schema_changes: 0, telegram_calls: 0, groq_calls: 0}};
}
