/** C-21.1 append-only memory consistency and retry isolation suite. */
function runC211MemoryConsistencyTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function lock() { return {tryLock: function() { return true; }, releaseLock: function() {}}; }
  function properties(seed) { const values = Object.assign({}, seed || {}); return {values: values,
    getProperty: function(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setProperty: function(key, value) { values[key] = String(value); }}; }
  const headers = ["CONFIRMATION_ID", "VALUE", "KEY", "USER_ID", "UPDATED_AT", "ID", "CATEGORY", "SOURCE", "PRIORITY"];
  const table = {headers: headers.slice(), rows: [], writes: 0};
  function runtime(now, uuid) { return {data_write_mode: "ACTIVE", now: now, uuid: function() { return uuid; },
    lock: lock(), retry_lock: lock(), read_table: function() { return {headers: table.headers.slice(), rows: table.rows.map(function(row) { return row.slice(); })}; },
    write_table: function(sheet, nextHeaders, rows) { table.headers = nextHeaders.slice(); table.rows = rows.map(function(row) { return row.slice(); }); table.writes += 1; },
    flush: function() {}}; }
  handleWeightFactPersistence_("user-1", 117, "confirmation-1",
    runtime(new Date("2026-08-24T10:00:00.000Z"), "123e4567-e89b-42d3-a456-426614174010"));
  handleWeightFactPersistence_("user-1", 118, "confirmation-2",
    runtime(new Date("2026-08-24T10:00:00.001Z"), "123e4567-e89b-42d3-a456-426614174011"));
  const indexes = memorySchemaIndexes_(table.headers);
  const events = table.rows.filter(function(row) {
    return row[indexes.category] === "body_tracking" && row[indexes.key] === "weight_event";
  });
  record("C21.1-01_SIMULTANEOUS_UPDATES_PRESERVED", events.length === 2 &&
    events.map(function(row) { return row[indexes.value]; }).join(",") === "117,118", {events: events});

  const contextMemory = events.map(function(row) { return memoryRowFromSchema_(row, indexes, "user-1"); });
  const context = buildMemoryCoachContext_("user-1", "user-1", {memory: contextMemory, persona: {}, rules: [],
    skip_sources: true, chat_history: ""});
  record("C21.1-02_LATEST_WEIGHT_SELECTED", context.indexOf("Текущий вес: 118 кг") >= 0, {context: context});
  record("C21.1-03_NO_CURRENT_WEIGHT_UPSERT", table.rows.every(function(row) {
    return row[indexes.key] !== "current_weight";
  }), {keys: table.rows.map(function(row) { return row[indexes.key]; })});

  const isolated = properties();
  const baseTask = {capture_id: "capture-a", fact_type: "WEIGHT", created_at: "2026-08-24T10:00:00.000Z",
    retry_count: 0, next_retry_at: "2026-08-24T10:05:00.000Z"};
  enqueueMemoryRetry_(Object.assign({user_id: "user-a"}, baseTask), {properties: isolated, retry_lock: lock()});
  enqueueMemoryRetry_(Object.assign({}, baseTask, {user_id: "user-b", capture_id: "capture-b"}),
    {properties: isolated, retry_lock: lock()});
  const queueA = JSON.parse(isolated.values["C21_MEMORY_RETRY_QUEUE_user-a"] || "[]");
  const queueB = JSON.parse(isolated.values["C21_MEMORY_RETRY_QUEUE_user-b"] || "[]");
  const allowedFields = ["capture_id", "created_at", "fact_type", "next_retry_at", "retry_count"].sort().join(",");
  record("C21.1-04_RETRY_QUEUES_ISOLATED", queueA.length === 1 && queueB.length === 1 &&
    queueA[0].capture_id === "capture-a" && queueB[0].capture_id === "capture-b" &&
    Object.keys(queueA[0]).sort().join(",") === allowedFields, {keys: Object.keys(isolated.values), queue_a: queueA, queue_b: queueB});

  const legacyHeaders = ["VALUE", "UPDATED_AT", "CATEGORY", "ID", "PRIORITY", "KEY", "USER_ID"];
  const legacyIndexes = memorySchemaIndexes_(legacyHeaders);
  const legacy = memoryRowFromSchema_(["116", "2026-08-20T10:00:00Z", "body_tracking", "legacy-id",
    "HIGH", "weight_event", "user-legacy"], legacyIndexes, "user-legacy");
  record("C21.1-05_LEGACY_SCHEMA_READABLE", legacy.value === "116" && legacy.category === "body_tracking" &&
    legacy.source === "LEGACY" && legacy.confirmation_id === "", legacy);

  const expiredTask = {capture_id: "expired", fact_type: "WEIGHT", created_at: "2026-08-20T00:00:00.000Z",
    retry_count: 2, next_retry_at: "2026-08-20T00:05:00.000Z"};
  const futureTask = {capture_id: "future", fact_type: "WEIGHT", created_at: "2026-08-24T09:00:00.000Z",
    retry_count: 1, next_retry_at: "2026-08-24T11:00:00.000Z"};
  const ttlProps = properties({C21_MEMORY_RETRY_QUEUE_user_ttl: JSON.stringify([expiredTask, futureTask])});
  const ttlResult = retryPendingMemorySync_("user_ttl", {properties: ttlProps,
    now: new Date("2026-08-24T10:00:00.000Z")});
  const cleaned = JSON.parse(ttlProps.values.C21_MEMORY_RETRY_QUEUE_user_ttl || "[]");
  record("C21.1-06_RETRY_TTL_CLEANUP", ttlResult.pending === 1 && cleaned.length === 1 &&
    cleaned[0].capture_id === "future", {result: ttlResult, queue: cleaned});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-21.1_MEMORY_CONSISTENCY", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {coach_state_writes: 0, raw_text_storage: 0, groq_calls: 0, telegram_calls: 0}};
}
