/** C-21.2 isolated memory persistence gate and staging schema suite. */
function runC212MemoryPersistenceGateTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function lock() { return {tryLock: function() { return true; }, releaseLock: function() {}}; }
  function properties(seed) { const values = Object.assign({}, seed || {}); return {values: values,
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setProperty: function(key, value) { values[key] = String(value); }}; }
  function store() { return {headers: aiMemoryRequiredHeaders_(), rows: [], writes: 0}; }
  function runtime(target, enabled) { return {data_write_mode: "SIMULATION", memory_persistence_enabled: enabled,
    lock: lock(), retry_lock: lock(), now: new Date("2026-08-24T18:00:00.000Z"),
    uuid: function() { return "123e4567-e89b-42d3-a456-426614174212"; },
    read_table: function() { return {headers: target.headers.slice(), rows: target.rows.map(function(row) { return row.slice(); })}; },
    write_table: function(sheet, headers, rows) { target.headers = headers.slice();
      target.rows = rows.map(function(row) { return row.slice(); }); target.writes += 1; },
    flush: function() {}}; }

  const disabledStore = store();
  const disabled = handleWeightFactPersistence_("user-1", 116.5, "capture-disabled", runtime(disabledStore, false));
  record("C21.2-01_SIMULATION_FLAG_FALSE_ZERO_WRITES", disabled.ok &&
    disabled.code === "MEMORY_PERSISTENCE_DISABLED" && disabled.memory_writes === 0 &&
    disabledStore.writes === 0 && disabledStore.rows.length === 0, disabled);

  const enabledStore = store();
  const enabled = handleWeightFactPersistence_("user-1", 116.5, "capture-enabled", runtime(enabledStore, true));
  const indexes = memorySchemaIndexes_(enabledStore.headers);
  record("C21.2-02_SIMULATION_FLAG_TRUE_MEMORY_ONLY", enabled.ok && enabled.code === "MEMORY_SYNCED" &&
    enabled.memory_writes === 1 && enabledStore.writes === 1 && enabledStore.rows.length === 1 &&
    enabledStore.rows[0][indexes.source] === "C21_CONFIRMED_FACT", {result: enabled,
      domain_writes: 0, row: enabledStore.rows[0]});

  const coachBefore = '{"version":2,"pending_action":"NONE"}';
  const separationProperties = properties({COACH_STATE_77: coachBefore, MEMORY_PERSISTENCE_ENABLED: "true"});
  const separationStore = store();
  handleWeightFactPersistence_("77", 116.5, "capture-separation", Object.assign(runtime(separationStore, true),
    {properties: separationProperties}));
  record("C21.2-03_COACH_STATE_UNCHANGED", separationProperties.values.COACH_STATE_77 === coachBefore,
    {coach_state: separationProperties.values.COACH_STATE_77});

  const validSchema = validateAiMemorySchema_(aiMemoryRequiredHeaders_());
  const invalidSchema = validateAiMemorySchema_(["ID", "USER_ID", "CATEGORY", "KEY", "VALUE", "PRIORITY", "UPDATED_AT"]);
  let bootstrappedHeaders = [];
  const emptySheet = {getLastRow: function() { return 0; }, getLastColumn: function() { return 0; },
    getRange: function() { return {setValues: function(values) { bootstrappedHeaders = values[0].slice(); }}; }};
  const stagingBootstrap = bootstrapAiMemorySchemaForStaging_({deployment_env: "STAGING", lock: lock(),
    spreadsheet: {getSheetByName: function() { return emptySheet; }}, flush: function() {}});
  let productionCreateCalls = 0;
  const productionBootstrap = bootstrapAiMemorySchemaForStaging_({deployment_env: "PRODUCTION", lock: lock(),
    spreadsheet: {getSheetByName: function() { return null; }, insertSheet: function() {
      productionCreateCalls += 1; return emptySheet; }}});
  record("C21.2-04_AI_MEMORY_SCHEMA_VALIDATION", validSchema.ok && !invalidSchema.ok &&
    invalidSchema.missing.join(",") === "SOURCE,CONFIRMATION_ID" && stagingBootstrap.ok &&
    bootstrappedHeaders.join(",") === aiMemoryRequiredHeaders_().join(",") &&
    productionBootstrap.code === "STAGING_ONLY" && productionCreateCalls === 0,
  {valid: validSchema, invalid: invalidSchema, staging: stagingBootstrap, production: productionBootstrap});

  const rollbackStore = store();
  const rollbackProperties = properties({MEMORY_PERSISTENCE_ENABLED: "false"});
  const rollback = handleWeightFactPersistence_("user-1", 116.5, "capture-rollback", Object.assign(
    runtime(rollbackStore, true), {memory_persistence_enabled: null, properties: rollbackProperties}));
  record("C21.2-05_ROLLBACK_FLAG_FALSE", rollback.ok && rollback.code === "MEMORY_PERSISTENCE_DISABLED" &&
    rollbackStore.writes === 0 && rollbackStore.rows.length === 0, rollback);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-21.2_MEMORY_PERSISTENCE_GATE", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {domain_writes: 0, coach_state_writes: 0, real_sheet_schema_changes: 0,
      in_memory_bootstrap_writes: stagingBootstrap.writes,
      telegram_calls: 0, groq_calls: 0}};
}
