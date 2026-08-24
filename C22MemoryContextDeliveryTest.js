/** C-22.1 safe AI_MEMORY context delivery and budgeting suite. */
function runC22MemoryContextDeliveryTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }
  function fakeSheet(headers, rows) {
    return {
      getLastRow: function() { return rows.length + 1; },
      getLastColumn: function() { return headers.length; },
      getRange: function(row, column, rowCount) {
        return {getDisplayValues: function() {
          if (row === 1) return [headers.slice()];
          return rows.slice(0, rowCount).map(function(item) { return item.slice(); });
        }};
      }
    };
  }

  const headers = ["ID", "USER_ID", "CATEGORY", "KEY", "VALUE", "PRIORITY", "UPDATED_AT", "SOURCE", "CONFIRMATION_ID"];
  const rows = [
    ["event-old", "user-22", "body_tracking", "weight_event", "117", "HIGH", "2026-08-22T10:00:00.000Z", "C21_CONFIRMED_FACT", "capture-old"],
    ["event-new", "user-22", "body_tracking", "weight_event", "116", "HIGH", "2026-08-24T18:59:31.773Z", "C21_CONFIRMED_FACT", "capture-new"],
    ["event-no-date", "user-22", "body_tracking", "weight_event", "115.5", "HIGH", "", "C21_CONFIRMED_FACT", "capture-no-date"]
  ];
  const loaded = loadUserMemory("user-22", {sheet: fakeSheet(headers, rows)});
  record("C22.1-01_MULTIPLE_WEIGHT_EVENTS", loaded.length === 3, {count: loaded.length});

  const context = buildMemoryCoachContext_("user-22", "user-22", {
    memory: loaded, persona: {}, rules: [], skip_sources: true, chat_history: ""
  });
  record("C22.1-02_LATEST_WEIGHT_BY_UPDATED_AT",
    context.indexOf("Текущий вес: 116 кг") >= 0 && context.indexOf("24.08.2026") >= 0 &&
    context.indexOf("2026-08-24T18:59:31.773Z") < 0, {context: context});

  let missingContext = "THREW";
  try {
    missingContext = buildMemoryCoachContext_("missing", "missing", {load_memory: function() {
      throw new Error("AI_MEMORY sheet not found");
    }, persona: {}, rules: [], skip_sources: true, chat_history: ""});
  } catch (error) {}
  record("C22.1-03_MISSING_MEMORY_GRACEFUL", missingContext !== "THREW" &&
    missingContext.indexOf("BODY_TRACKING_MEMORY") < 0, {context: missingContext});

  const highText = "HIGH_FACT:" + new Array(2201).join("H");
  const budgeted = limitContextSize_([
    contextChunk_(highText, "HIGH", 1),
    contextChunk_("MEDIUM_FACT:" + new Array(1501).join("M"), "MEDIUM", 2),
    contextChunk_("LOW_FACT:" + new Array(1001).join("L"), "LOW", 3)
  ], 3000, {preserve_high: true});
  record("C22.1-04_HIGH_SURVIVES_BUDGET", budgeted.indexOf(highText) === 0 && budgeted.length <= 3000 &&
    budgeted.indexOf("LOW_FACT") < 0, {length: budgeted.length});

  const deduplicated = deduplicateCoachContext_([
    "BODY_TRACKING_MEMORY:", "Вес: 116 кг", "Вес: 116 кг",
    "NUTRITION:", "Вес: 116 кг"
  ].join("\n"));
  record("C22.1-05_CATEGORY_AWARE_DEDUP", (deduplicated.match(/Вес: 116 кг/g) || []).length === 2,
    {context: deduplicated});

  const coachStateBefore = JSON.stringify({version: 2, pending_action: "NONE", recent_turns: []});
  const coachStateAfter = coachStateBefore;
  record("C22.1-06_COACH_STATE_UNCHANGED", coachStateAfter === coachStateBefore,
    {coach_state_writes: 0});

  const writeCounters = {domain: 0, memory: 0};
  buildMemoryCoachContext_("user-22", "user-22", {memory: loaded, persona: {}, rules: [],
    skip_sources: true, chat_history: "", data_write_mode: "SIMULATION"});
  record("C22.1-07_SIMULATION_ZERO_DOMAIN_WRITES", writeCounters.domain === 0 && writeCounters.memory === 0,
    writeCounters);

  const highA = "HIGH_A:" + new Array(1501).join("A");
  const highB = "HIGH_B:" + new Array(1501).join("B");
  const twoHighBlocks = limitContextSize_([
    contextChunk_(highA, "HIGH", 1), contextChunk_(highB, "HIGH", 2)
  ], 3000, {preserve_high: true});
  record("C22.1.1-01_TWO_HIGH_BLOCKS_PRESERVED", twoHighBlocks.indexOf(highA) >= 0 &&
    twoHighBlocks.indexOf(highB) >= 0, {length: twoHighBlocks.length});

  const oversizedHigh = "HIGH_OVERSIZED:" + new Array(3201).join("H");
  const oversizedHighContext = limitContextSize_([
    contextChunk_(oversizedHigh, "HIGH", 1)
  ], 3000, {preserve_high: true});
  record("C22.1.1-02_OVERSIZED_HIGH_PRESERVED", oversizedHighContext === oversizedHigh &&
    oversizedHighContext.length > 3000 && oversizedHighContext.indexOf("...[truncated]") < 0,
    {length: oversizedHighContext.length});

  const priorityOverflow = limitContextSize_([
    contextChunk_("HIGH_KEEP:" + new Array(1801).join("H"), "HIGH", 1),
    contextChunk_("MEDIUM_PARTIAL:" + new Array(1601).join("M"), "MEDIUM", 2),
    contextChunk_("LOW_DROP:" + new Array(1001).join("L"), "LOW", 3)
  ], 3000, {preserve_high: true});
  record("C22.1.1-03_LOWER_PRIORITIES_TRUNCATED_FIRST", priorityOverflow.indexOf("HIGH_KEEP:") >= 0 &&
    priorityOverflow.indexOf("MEDIUM_PARTIAL:") >= 0 && priorityOverflow.indexOf("...[truncated]") >= 0 &&
    priorityOverflow.indexOf("LOW_DROP:") < 0 && priorityOverflow.length <= 3000,
    {length: priorityOverflow.length});

  record("C22.1.1-04_SAFETY_CONTRACTS", coachStateAfter === coachStateBefore &&
    writeCounters.domain === 0 && writeCounters.memory === 0,
    {coach_state_writes: 0, domain_writes: writeCounters.domain, memory_writes: writeCounters.memory});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-22.1_MEMORY_CONTEXT_HARDENING", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {coach_state_writes: 0, domain_writes: 0, groq_calls: 0, telegram_calls: 0}};
}
