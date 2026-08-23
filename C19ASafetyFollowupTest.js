/** C-19A structured-state safety follow-up suite. */
function runC19ASafetyFollowupTests() {
  const tests = [];
  function record(id, passed, details) { tests.push({id: id, passed: Boolean(passed), details: details || {}}); }
  function store() { const values = {}; return {values: values, getProperty: function(k) { return values[k] || null; },
    setProperty: function(k, v) { values[k] = String(v); }}; }
  function lock(events) { return {tryLock: function() { events.push("lock"); return true; },
    releaseLock: function() { events.push("unlock"); }}; }
  const now = Date.parse("2026-08-23T12:00:00.000Z");
  const adversarial = ["Мой вес 118 кг", "Мне 37 лет", "Мой рост 185 см", "Цель 108 кг", "давление сегодня 150 на 90",
    "после тяги тянет внутри бедра", "скинул еще два килограмма", "перешел на 2200 ккал", "у меня мигрень",
    "принимаю таблетки от давления", "врач сказал пока не приседать", "цифры на весах стали меньше",
    "доктор ограничил тяжелые движения"];
  const sensitiveStore = store();
  adversarial.forEach(function(text) { saveCoachStateTurn_("132976932", text, "Персональный ответ с деталями 999", {
    properties: sensitiveStore, lock: lock([]), now: function() { return now; }}); });
  const serialized = sensitiveStore.values.COACH_STATE_132976932 || "";
  record("C19A-S01_ADVERSARIAL_RAW_ABSENT", adversarial.every(function(text) { return serialized.indexOf(text) < 0; }) &&
    ["118", "37", "185", "108", "150", "2200", "999"].every(function(value) { return serialized.indexOf(value) < 0; }),
    {serialized: serialized});
  const safeStore = store();
  ["Какую тренировку сделать сегодня?", "Что лучше съесть после зала?", "Что мы обсуждали вчера?", "Продолжим?",
    "Как восстановиться после тренировки?"].forEach(function(text) { saveCoachStateTurn_("132976932", text, "Нейтральный ответ", {
      properties: safeStore, lock: lock([]), now: function() { return now; }}); });
  const safeRaw = safeStore.values.COACH_STATE_132976932 || "";
  record("C19A-S02_SAFE_ENUM_CONTINUITY", safeRaw.indexOf("ASK_RECOVERY_GUIDANCE") >= 0 &&
    safeRaw.indexOf("Как восстановиться") < 0, {serialized: safeRaw});
  const groupStore = store();
  saveChatTurn_(111, "Продолжим?", "Да", {properties: groupStore, lock: lock([]), now: function() { return now; }});
  saveChatTurn_(222, "Продолжим?", "Да", {properties: groupStore, lock: lock([]), now: function() { return now; }});
  record("C19A-S03_GROUP_USER_ISOLATION", Boolean(groupStore.values.COACH_STATE_111) &&
    Boolean(groupStore.values.COACH_STATE_222) && !groupStore.values["COACH_STATE_-999"], {keys: Object.keys(groupStore.values)});
  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite: "C-19A_SAFETY_FOLLOWUP", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}};
}
