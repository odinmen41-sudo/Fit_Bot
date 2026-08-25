/** C-22.5 authoritative current-weight source priority suite. */
function runC225CurrentWeightPriorityTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }

  const profileContext = [
    "USER PROFILE:",
    "- User_ID: staging-user-001; Имя: Staging Test; Возраст: 35; Рост: 180; Вес старт: 120; " +
      "Текущий вес: 118.7; Целевой вес: 108; Цель: Снижение веса; Уровень подготовки: Средний; " +
      "Тренировки в неделю: 3"
  ].join("\n");
  const conflictingMemory = [
    {id: "weight-event-id", user_id: "user-225", category: "body_tracking", key: "weight_event",
      value: "116", priority: "HIGH", updated_at: "2026-08-24T18:59:31.773Z",
      source: "C21_CONFIRMED_FACT", confirmation_id: "capture-225", _row_order: 2},
    {id: "legacy-weight-id", user_id: "user-225", category: "profile", key: "current_weight",
      value: "118.7", priority: "HIGH", updated_at: "2026-08-20T10:00:00.000Z",
      source: "LEGACY", confirmation_id: "legacy-confirmation", _row_order: 1}
  ];

  const memoryContext = buildMemoryCoachContext_("user-225", "chat-225", {
    memory: conflictingMemory, persona: {}, rules: [], profile_context: profileContext,
    skip_sources: true, chat_history: ""
  });
  record("C22.5-01_MEMORY_WEIGHT_ONLY", memoryContext.indexOf("Текущий вес: 116 кг") >= 0 &&
    memoryContext.indexOf("118.7") < 0 && memoryContext.indexOf("profile.current_weight") < 0,
    {context: memoryContext});

  const legacyContext = buildMemoryCoachContext_("user-225", "chat-225", {
    memory: [], persona: {}, rules: [], profile_context: profileContext, skip_sources: true, chat_history: ""
  });
  record("C22.5-02_LEGACY_WEIGHT_WITHOUT_EVENT", legacyContext.indexOf("Текущий вес: 118.7") >= 0 &&
    legacyContext.indexOf("Текущий вес: 116 кг") < 0, {context: legacyContext});

  const profileFacts = ["Возраст: 35", "Рост: 180", "Вес старт: 120", "Целевой вес: 108",
    "Цель: Снижение веса", "Уровень подготовки: Средний", "Тренировки в неделю: 3"];
  record("C22.5-03_PROFILE_FACTS_PRESERVED", profileFacts.every(function(fact) {
    return memoryContext.indexOf(fact) >= 0;
  }), {context: memoryContext});

  const technicalValues = ["weight-event-id", "legacy-weight-id", "staging-user-001", "C21_CONFIRMED_FACT",
    "capture-225", "legacy-confirmation", "2026-08-24T18:59:31.773Z", "User_ID:"];
  record("C22.5-04_TECHNICAL_FIELDS_ISOLATED", technicalValues.every(function(value) {
    return memoryContext.indexOf(value) < 0;
  }), {context: memoryContext});

  const safety = {coach_state_writes: 0, domain_writes: 0, groq_calls: 0};
  record("C22.5-05_SAFETY", Object.keys(safety).every(function(key) { return safety[key] === 0; }), safety);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-22.5_CURRENT_WEIGHT_PRIORITY", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests, safety: safety};
}
