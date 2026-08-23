/** C-19A bounded structured coach state acceptance suite. */
function runC19ACoachStateTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function properties(initial) { const values = Object.assign({}, initial || {}); return {values: values,
    getProperty: function(key) { return values[key] || null; }, setProperty: function(key, value) { values[key] = String(value); }}; }
  function lock() { return {tryLock: function() { return true; }, releaseLock: function() {}}; }
  const now = Date.parse("2026-08-23T10:00:00.000Z");
  const store = properties();
  const runtime = {properties: store, lock: lock(), now: function() { return now; }};
  const saved = saveCoachStateTurn_("132976932", "Какую тренировку сделать сегодня?", "Начните с разминки.", runtime);
  const state = readCoachState_("132976932", runtime);
  record("C19A-01_STRUCTURED_CONTRACT", saved && state && state.version === 2 && state.active_topic === "TRAINING" &&
    state.recent_turns[0].user_intent === "ASK_TRAINING_GUIDANCE" &&
    !Object.prototype.hasOwnProperty.call(state.recent_turns[0], "user"), state || {});
  [1, 2, 3, 4].forEach(function(index) { saveCoachStateTurn_("132976932", "Продолжим?", "Ответ " + index, runtime); });
  const bounded = readCoachState_("132976932", runtime);
  record("C19A-02_MAX_THREE_TURNS", bounded && bounded.recent_turns.length === 3, {turns: bounded && bounded.recent_turns.length});
  record("C19A-03_TTL", bounded && Date.parse(bounded.expires_at) === now + CONFIG.COACH_STATE_TTL_MS,
    {expires_at: bounded && bounded.expires_at});
  const raw = store.values.COACH_STATE_132976932 || "";
  record("C19A-04_SIZE_BOUND", raw.length <= CONFIG.COACH_STATE_MAX_JSON_CHARS, {length: raw.length});
  record("C19A-05_NO_RAW_TEXT", raw.indexOf("Продолжим") < 0 && raw.indexOf("Ответ") < 0, {serialized: raw});
  const context = loadChatHistory_("132976932", {properties: store, now: function() { return now; }});
  record("C19A-06_STRUCTURED_CONTEXT", context.indexOf("Conversation state:") === 0 &&
    context.indexOf("CONTINUE_CONVERSATION") >= 0 && context.indexOf("Продолжим") < 0, {context: context});
  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-19A_COACH_STATE", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}};
}
