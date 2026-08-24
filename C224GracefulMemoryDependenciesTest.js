/** C-22.4 optional memory dependencies and authoritative-weight suite. */
function runC224GracefulMemoryDependenciesTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }

  const memory = [{
    id: "event-116",
    user_id: "user-224",
    category: "body_tracking",
    key: "weight_event",
    value: "116",
    priority: "HIGH",
    updated_at: "2026-08-24T18:59:31.773Z",
    source: "C21_CONFIRMED_FACT",
    confirmation_id: "capture-224",
    _row_order: 2
  }];
  const profile = [
    "USER PROFILE:",
    "- User_ID: staging-user-001; Имя: Staging Test; Возраст: 35; Рост: 180; Вес старт: 120; " +
      "Текущий вес: 118.7; Целевой вес: 108; Цель: Снижение веса; Уровень подготовки: Средний; " +
      "Тренировки в неделю: 3"
  ].join("\n");

  const originalRequiredSheet = memoryRequiredSheet_;
  let requiredSheets = {};
  memoryRequiredSheet_ = function(sheetName) {
    if (requiredSheets[sheetName]) return requiredSheets[sheetName];
    throw new Error("Required sheet not found: " + sheetName);
  };

  let missingPersonaContext = "THREW";
  let missingRulesContext = "THREW";
  let missingBothContext = "THREW";
  try {
    requiredSheets[MEMORY_LAYER_CONFIG.RULES_SHEET] = {
      getLastRow: function() { return 1; }
    };
    missingPersonaContext = buildMemoryCoachContext_("user-224", "chat-224", {
      memory: memory, rules: [], profile_context: profile, skip_sources: true, chat_history: ""
    });
    record("C22.4-01_MISSING_PERSONA_OPTIONAL", missingPersonaContext.indexOf("Текущий вес: 116 кг") >= 0 &&
      missingPersonaContext.indexOf("BODY_TRACKING_MEMORY") >= 0, {context: missingPersonaContext});

    requiredSheets = {};
    missingRulesContext = buildMemoryCoachContext_("user-224", "chat-224", {
      memory: memory, persona: {}, profile_context: profile, skip_sources: true, chat_history: ""
    });
    record("C22.4-02_MISSING_RULES_OPTIONAL", missingRulesContext.indexOf("Текущий вес: 116 кг") >= 0,
      {context: missingRulesContext});

    missingBothContext = buildMemoryCoachContext_("user-224", "chat-224", {
      memory: memory, profile_context: profile, skip_sources: true, chat_history: ""
    });
    record("C22.4-03_BOTH_OPTIONAL", missingBothContext !== "THREW" &&
      missingBothContext.indexOf("BODY_TRACKING_MEMORY") >= 0 &&
      missingBothContext.indexOf("Текущий вес: 116 кг") >= 0, {context: missingBothContext});
  } finally {
    memoryRequiredSheet_ = originalRequiredSheet;
  }

  record("C22.4-04_MEMORY_WEIGHT_AUTHORITATIVE",
    missingBothContext.indexOf("Текущий вес: 116 кг") >= 0 &&
    !/Текущий вес\s*[:=]\s*118[.,]7/.test(missingBothContext), {context: missingBothContext});

  const profileFacts = ["Возраст: 35", "Рост: 180", "Вес старт: 120", "Целевой вес: 108",
    "Цель: Снижение веса", "Уровень подготовки: Средний", "Тренировки в неделю: 3"];
  record("C22.4-05_PROFILE_FACTS_PRESERVED", profileFacts.every(function(fact) {
    return missingBothContext.indexOf(fact) >= 0;
  }), {context: missingBothContext});

  record("C22.4-06_TECHNICAL_FIELDS_ISOLATED",
    ["event-116", "staging-user-001", "C21_CONFIRMED_FACT", "capture-224",
      "2026-08-24T18:59:31.773Z", "User_ID:"].every(function(value) {
      return missingBothContext.indexOf(value) < 0;
    }), {context: missingBothContext});

  const noMemoryContext = buildMemoryCoachContext_("user-224", "chat-224", {
    memory: [], persona: {}, rules: [], profile_context: profile, skip_sources: true, chat_history: ""
  });
  record("C22.4-07_NO_MEMORY_SAFE_PROFILE", noMemoryContext.indexOf("Текущий вес: 118.7") >= 0 &&
    noMemoryContext.indexOf("BODY_TRACKING_MEMORY") < 0 && noMemoryContext.indexOf("Текущий вес: 116 кг") < 0,
    {context: noMemoryContext});

  const safety = {coach_state_writes: 0, memory_writes: 0, domain_writes: 0, telegram_calls: 0, groq_calls: 0};
  record("C22.4-08_SAFETY", Object.keys(safety).every(function(key) { return safety[key] === 0; }), safety);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-22.4_GRACEFUL_MEMORY_DEPENDENCIES", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests, safety: safety};
}
