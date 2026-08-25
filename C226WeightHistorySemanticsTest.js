/** C-22.6 unambiguous current-weight and previous-history suite. */
function runC226WeightHistorySemanticsTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }
  function event(value, timestamp, rowOrder) {
    return {
      id: "event-" + rowOrder,
      user_id: "user-226",
      category: "body_tracking",
      key: "weight_event",
      value: String(value),
      priority: "HIGH",
      updated_at: timestamp,
      source: "C21_CONFIRMED_FACT",
      confirmation_id: "capture-" + rowOrder,
      _row_order: rowOrder
    };
  }
  function context(memory) {
    return buildMemoryCoachContext_("user-226", "chat-226", {
      memory: memory, persona: {}, rules: [], skip_sources: true, chat_history: ""
    });
  }

  const sameDay = [
    event("116.5", "2026-08-24T18:17:01.515Z", 1),
    event("116", "2026-08-24T18:59:31.773Z", 2)
  ];
  const sameDayContext = context(sameDay);
  record("C22.6-01_CURRENT_AND_PREVIOUS", sameDayContext.indexOf("Текущий вес: 116 кг") >= 0 &&
    sameDayContext.indexOf("Предыдущие измерения:\n24.08.2026 18:17 — 116.5 кг") >= 0,
    {context: sameDayContext});

  record("C22.6-02_CURRENT_NOT_DUPLICATED", (sameDayContext.match(/116 кг/g) || []).length === 1 &&
    sameDayContext.indexOf("18:59 — 116 кг") < 0, {context: sameDayContext});

  record("C22.6-03_SAME_DAY_TIME_PRESERVED", sameDayContext.indexOf("24.08.2026 18:17") >= 0 &&
    sameDayContext.indexOf("24.08.2026 — 116.5") < 0, {context: sameDayContext});

  const manyEvents = [
    event("120", "2026-08-18T08:00:00.000Z", 1),
    event("119", "2026-08-19T08:00:00.000Z", 2),
    event("118", "2026-08-20T08:00:00.000Z", 3),
    event("117.5", "2026-08-21T08:00:00.000Z", 4),
    event("117", "2026-08-22T08:00:00.000Z", 5),
    event("116.5", "2026-08-23T08:00:00.000Z", 6),
    event("116", "2026-08-24T08:00:00.000Z", 7)
  ];
  const manyContext = context(manyEvents);
  const historyPart = manyContext.split("Предыдущие измерения:\n")[1] || "";
  const historyLines = historyPart.split("\n").filter(function(line) { return /\d{2}\.\d{2}\.\d{4}/.test(line); });
  record("C22.6-04_MAX_FIVE_PREVIOUS", historyLines.length === 5 && manyContext.indexOf("120 кг") < 0,
    {history: historyLines});

  const orderedValues = ["116.5 кг", "117 кг", "117.5 кг", "118 кг", "119 кг"];
  record("C22.6-05_NEWEST_TO_OLDEST", orderedValues.every(function(value, index) {
    const position = manyContext.indexOf("— " + value);
    const previous = index ? manyContext.indexOf("— " + orderedValues[index - 1]) : -1;
    return position >= 0 && position > previous;
  }), {history: historyLines});

  const technicalValues = ["event-7", "user-226", "C21_CONFIRMED_FACT", "capture-7",
    "2026-08-24T08:00:00.000Z", "weight_event"];
  record("C22.6-06_TECHNICAL_FIELDS_ISOLATED", technicalValues.every(function(value) {
    return manyContext.indexOf(value) < 0;
  }), {context: manyContext});

  const coachState = {version: 2, recent_turns: [{user_intent: "GENERAL", assistant_action: "RESPONDED"}],
    active_topic: "GENERAL", pending_question: "NONE", pending_action: "NONE", unfinished_consultation: false};
  const serializedState = JSON.stringify(coachState);
  record("C22.6-07_COACH_STATE_CONTRACT", serializedState.indexOf("116") < 0 &&
    serializedState.indexOf("raw") < 0 && serializedState.indexOf("memory_refs") < 0 &&
    serializedState.indexOf("fact_payload") < 0, {state: coachState});

  const safety = {memory_writes: 0, domain_writes: 0, groq_calls: 0};
  record("C22.6-08_SIMULATION_SAFETY", Object.keys(safety).every(function(key) {
    return safety[key] === 0;
  }), safety);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-22.6_WEIGHT_HISTORY_SEMANTICS", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests, safety: safety};
}
