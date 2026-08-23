/** C-19B structured short-term coach state acceptance suite. */
function runC19BStructuredCoachStateTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function store(initial, events) { const values = Object.assign({}, initial || {}); return {values: values,
    getProperty: function(k) { if (events) events.push("read:" + k); return values[k] || null; },
    setProperty: function(k, v) { if (events) events.push("write:" + k); values[k] = String(v); }}; }
  function lock(events, behavior) { return {tryLock: function() { events.push("lock");
    if (behavior === "throw_lock") throw new Error("LOCK_FAILED"); return behavior !== "timeout"; },
    releaseLock: function() { events.push("unlock"); if (behavior === "throw_release") throw new Error("UNLOCK_FAILED"); }}; }
  const now = Date.parse("2026-08-23T14:00:00.000Z");
  function runtime(properties, events, behavior) { return {properties: properties, lock: lock(events, behavior),
    now: function() { return now; }}; }

  const identityStore = store();
  saveChatTurn_(111, "Продолжим?", "Да", runtime(identityStore, []));
  saveChatTurn_(222, "Продолжим?", "Да", runtime(identityStore, []));
  record("C19B-01_GROUP_IDENTITY", Boolean(identityStore.values.COACH_STATE_111) &&
    Boolean(identityStore.values.COACH_STATE_222) && !identityStore.values["COACH_STATE_-999"],
    {keys: Object.keys(identityStore.values)});
  const privateStore = store();
  saveChatTurn_(111, "Продолжим?", "Да", runtime(privateStore, []));
  record("C19B-02_PRIVATE_IDENTITY", Boolean(privateStore.values.COACH_STATE_111), {keys: Object.keys(privateStore.values)});

  const sensitive = ["Мой вес 118 кг", "Мне 37 лет", "Мой рост 185 см", "Цель 108 кг",
    "давление сегодня 150 на 90", "после тяги тянет внутри бедра", "скинул еще два килограмма",
    "перешел на 2200 ккал", "у меня мигрень", "принимаю таблетки от давления", "врач сказал пока не приседать",
    "показатели стали хуже без очевидной причины", "специалист запретил часть движений"];
  const privacyStore = store();
  sensitive.forEach(function(text) { saveChatTurn_(111, text, "Ответ модели содержит исходные детали 9876", runtime(privacyStore, [])); });
  const privacyRaw = privacyStore.values.COACH_STATE_111 || "";
  const forbiddenFragments = sensitive.concat(["118", "37", "185", "108", "150", "90", "2200", "9876",
    "вес", "мигрень", "таблетки", "врач"]);
  record("C19B-03_ZERO_RAW_OR_SENSITIVE_VALUES", forbiddenFragments.every(function(fragment) {
    return privacyRaw.toLowerCase().indexOf(String(fragment).toLowerCase()) < 0;
  }), {serialized: privacyRaw});

  const safeStore = store();
  ["Какую тренировку сделать сегодня?", "Что лучше съесть после зала?", "Что мы обсуждали вчера?", "Продолжим?",
    "Как восстановиться после тренировки?"].forEach(function(text) {
    saveChatTurn_(111, text, "Готово", runtime(safeStore, []));
  });
  const safeState = JSON.parse(safeStore.values.COACH_STATE_111);
  record("C19B-04_SAFE_STRUCTURED_CONTINUITY", safeState.recent_turns.length === 3 &&
    safeStore.values.COACH_STATE_111.indexOf("Как восстановиться") < 0 &&
    safeState.recent_turns.every(function(turn) { return turn.user_intent && turn.assistant_action; }), safeState);

  const malformedStore = store({COACH_STATE_111: "{broken"});
  const malformedSaved = saveChatTurn_(111, "Продолжим?", "Да", runtime(malformedStore, []));
  record("C19B-05_MALFORMED_RECOVERS_EMPTY", malformedSaved === true &&
    JSON.parse(malformedStore.values.COACH_STATE_111).recent_turns.length === 1, {});
  const expired = JSON.stringify({version: 2, updated_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now - 1).toISOString(), active_topic: "TRAINING", pending_question: "NONE",
    unfinished_consultation: false, recent_turns: [{user_intent: "ASK_TRAINING_GUIDANCE", assistant_action: "RESPONDED"}]});
  const expiredStore = store({COACH_STATE_111: expired});
  saveChatTurn_(111, "Продолжим?", "Да", runtime(expiredStore, []));
  record("C19B-06_EXPIRED_RECOVERS_EMPTY", JSON.parse(expiredStore.values.COACH_STATE_111).recent_turns.length === 1, {});
  const unsupportedStore = store({COACH_STATE_111: JSON.stringify({version: 1, expires_at: new Date(now + 10000).toISOString(),
    recent_turns: [{user: "RAW_SECRET"}]})});
  saveChatTurn_(111, "Продолжим?", "Да", runtime(unsupportedStore, []));
  record("C19B-07_UNSUPPORTED_VERSION_RECOVERS_EMPTY", unsupportedStore.values.COACH_STATE_111.indexOf("RAW_SECRET") < 0 &&
    JSON.parse(unsupportedStore.values.COACH_STATE_111).version === 2, {});

  const events = [];
  const atomicStore = store({}, events);
  saveChatTurn_(111, "Продолжим?", "Да", runtime(atomicStore, events));
  record("C19B-08_ATOMIC_ORDER", events.join("|") ===
    "lock|read:COACH_STATE_111|write:COACH_STATE_111|unlock", {events: events});
  const atomicState = JSON.parse(atomicStore.values.COACH_STATE_111);
  record("C19B-09_LIMITS", atomicState.recent_turns.length <= 3 &&
    atomicStore.values.COACH_STATE_111.length <= 3200 && Date.parse(atomicState.expires_at) === now + 48 * 60 * 60 * 1000,
    {length: atomicStore.values.COACH_STATE_111.length, expires_at: atomicState.expires_at});

  const timeoutEvents = [];
  const timeoutResult = saveChatTurn_(111, "Продолжим?", "Да", runtime(store(), timeoutEvents, "timeout"));
  const releaseEvents = [];
  const releaseResult = saveChatTurn_(111, "Продолжим?", "Да", runtime(store(), releaseEvents, "throw_release"));
  record("C19B-10_LOCK_FAILURE_BEST_EFFORT", timeoutResult === false && releaseResult === true,
    {timeout_events: timeoutEvents, release_events: releaseEvents});
  const failedStore = store();
  failedStore.setProperty = function() { throw new Error("PROPERTY_FAILED"); };
  record("C19B-11_STORAGE_FAILURE_BEST_EFFORT", saveChatTurn_(111, "Продолжим?", "Да",
    runtime(failedStore, [])) === false, {});

  const legacyStore = store({CHAT_HISTORY_111: JSON.stringify([{user: "RAW_LEGACY", assistant: "RAW_REPLY"}])});
  record("C19B-12_LEGACY_HISTORY_IGNORED", loadChatHistory_(111, {properties: legacyStore,
    now: function() { return now; }}) === "", {keys: Object.keys(legacyStore.values)});

  const directStore = store();
  writeCoachState_(111, {version: 2, recent_turns: [{user: "RAW", assistant: "SECRET"}],
    active_topic: "FREE FORM", pending_question: "RAW QUESTION"}, runtime(directStore, []));
  const directRaw = directStore.values.COACH_STATE_111 || "";
  record("C19B-13_DIRECT_WRITE_ALLOWLIST", directRaw.indexOf("RAW") < 0 && directRaw.indexOf("SECRET") < 0 &&
    directRaw.indexOf("FREE FORM") < 0 && directRaw.indexOf("RAW QUESTION") < 0, {serialized: directRaw});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-19B_STRUCTURED_COACH_STATE", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}};
}
