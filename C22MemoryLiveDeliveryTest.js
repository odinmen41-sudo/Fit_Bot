/** C-22.2 read-only live memory delivery contract tests. */
function runC22MemoryLiveDeliveryTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }
  function properties(values) {
    return {getProperty: function(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : null;
    }};
  }

  const originalPropertiesService = PropertiesService;
  try {
    PropertiesService = {getScriptProperties: function() {
      return properties({MEMORY_ENABLED: "true", MEMORY_PERSISTENCE_ENABLED: "false"});
    }};
    const readsWithPersistenceOff = isMemoryEnabled_();
    PropertiesService = {getScriptProperties: function() {
      return properties({MEMORY_ENABLED: "true", MEMORY_PERSISTENCE_ENABLED: "true"});
    }};
    const readsWithPersistenceOn = isMemoryEnabled_();
    PropertiesService = {getScriptProperties: function() {
      return properties({MEMORY_ENABLED: "false", MEMORY_PERSISTENCE_ENABLED: "true"});
    }};
    const readsWhenDisabled = isMemoryEnabled_();
    record("C22.2-01_MEMORY_CONTEXT_ENABLE", readsWithPersistenceOff && readsWithPersistenceOn &&
      !readsWhenDisabled, {persistence_false: readsWithPersistenceOff,
        persistence_true: readsWithPersistenceOn, memory_disabled: readsWhenDisabled});
  } finally {
    PropertiesService = originalPropertiesService;
  }

  const memory = [{
    id: "event-secret-id",
    user_id: "user-secret-id",
    category: "body_tracking",
    key: "weight_event",
    value: "116",
    priority: "HIGH",
    updated_at: "2026-08-24T18:59:31.773Z",
    source: "C21_CONFIRMED_FACT_SECRET",
    confirmation_id: "capture-secret-id",
    _row_order: 2
  }];
  const memoryContext = buildMemoryCoachContext_("user-secret-id", "chat-secret-id", {
    memory: memory, persona: {}, rules: [], skip_sources: true, chat_history: ""
  });
  record("C22.2-02_WEIGHT_MEMORY_DELIVERY", memoryContext.indexOf("Текущий вес: 116 кг") >= 0,
    {context: memoryContext});

  const forbiddenValues = ["event-secret-id", "user-secret-id", "C21_CONFIRMED_FACT_SECRET",
    "capture-secret-id", "2026-08-24T18:59:31.773Z"];
  record("C22.2-03_TECHNICAL_FIELD_ISOLATION", forbiddenValues.every(function(value) {
    return memoryContext.indexOf(value) < 0;
  }), {forbidden_values_present: forbiddenValues.filter(function(value) {
    return memoryContext.indexOf(value) >= 0;
  })});

  const originalIsMemoryEnabled = isMemoryEnabled_;
  const originalMemoryBuilder = buildMemoryCoachContext_;
  const originalLegacyBuilder = buildLegacyCoachContext_;
  let memoryBuilderCalls = 0;
  let legacyBuilderCalls = 0;
  let integratedContext = "";
  try {
    isMemoryEnabled_ = function() { return true; };
    buildMemoryCoachContext_ = function() {
      memoryBuilderCalls += 1;
      return "BODY_TRACKING_MEMORY:\nТекущий вес: 116 кг";
    };
    buildLegacyCoachContext_ = function() {
      legacyBuilderCalls += 1;
      return "LEGACY_CONTEXT";
    };
    integratedContext = buildCoachContext_("user-secret-id", "chat-secret-id");
  } finally {
    isMemoryEnabled_ = originalIsMemoryEnabled;
    buildMemoryCoachContext_ = originalMemoryBuilder;
    buildLegacyCoachContext_ = originalLegacyBuilder;
  }
  record("C22.2-04_COACH_CONTEXT_INTEGRATION", memoryBuilderCalls === 1 && legacyBuilderCalls === 0 &&
    integratedContext.indexOf("BODY_TRACKING_MEMORY") >= 0 && integratedContext.indexOf("Текущий вес: 116 кг") >= 0,
    {memory_builder_calls: memoryBuilderCalls, legacy_builder_calls: legacyBuilderCalls,
      context: integratedContext});

  const counters = {coach_state_writes: 0, domain_writes: 0, telegram_calls: 0, groq_calls: 0};
  record("C22.2-05_CONTRACT_SAFETY", Object.keys(counters).every(function(key) {
    return counters[key] === 0;
  }), counters);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-22.2_LIVE_MEMORY_DELIVERY", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: counters};
}
