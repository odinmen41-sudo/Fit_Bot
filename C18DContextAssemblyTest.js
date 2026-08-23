/** C-18D resolver-to-legacy-context assembly in-memory acceptance suite. */
function testC18DContextAssembly_() {
  const tests = [];

  function record(id, passed, details) {
    tests.push({id: id, passed: passed === true, details: details || {}});
  }

  function sheet(values) {
    return {
      getLastRow: function() { return values.length; },
      getLastColumn: function() { return values.length ? values[0].length : 0; },
      getRange: function(row, column, rowCount, columnCount) {
        return {
          getDisplayValues: function() {
            return values.slice(row - 1, row - 1 + rowCount).map(function(sourceRow) {
              return sourceRow.slice(column - 1, column - 1 + columnCount);
            });
          }
        };
      }
    };
  }

  const profileValues = [
    ["User_ID", "Имя", "Возраст", "Рост", "Вес старт", "Текущий вес", "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"],
    ["staging-user-001", "Staging Test", "35", "180", "120", "118,7", "108", "Снижение веса", "Средний", "3"]
  ];
  const sheets = {User_Profile: sheet(profileValues)};
  const spreadsheet = {
    getSheetByName: function(name) { return sheets[name] || null; }
  };
  const required = [
    "Имя=Staging Test",
    "Возраст=35",
    "Рост=180",
    "Текущий вес=118,7",
    "Целевой вес=108",
    "Цель=Снижение веса",
    "Уровень подготовки=Средний",
    "Тренировки в неделю=3"
  ];

  const profile = findUserProfile_("132976932", spreadsheet, {deployment_env: "STAGING"});
  record("C18D-01_PROFILE_READER_COMPLETE", required.every(function(field) {
    return profile.indexOf(field) >= 0;
  }), {stage: "profile_reader", profile: profile, missing: required.filter(function(field) {
    return profile.indexOf(field) < 0;
  })});

  const context = buildLegacyCoachContext_("132976932", "test-chat", {
    spreadsheet: spreadsheet,
    deployment_env: "STAGING",
    chat_history: ""
  });
  const contextMissing = required.filter(function(field) { return context.indexOf(field) < 0; });
  record("C18D-02_LEGACY_CONTEXT_COMPLETE", contextMissing.length === 0,
    {stage: "legacy_context", context: context, missing: contextMissing});

  const formatted = context.indexOf("Профиль: ") === 0;
  record("C18D-03_FORMATTER_PRESERVES_PROFILE", formatted &&
    context.indexOf(profile) >= 0, {stage: "formatter", context: context});

  record("C18D-04_CONTEXT_NOT_TRUNCATED", context.length < CONFIG.MAX_CONTEXT_CHARS &&
    context.indexOf("Тренировки в неделю=3") >= 0, {
      stage: "context_truncation",
      context_length: context.length,
      limit: CONFIG.MAX_CONTEXT_CHARS
    });

  const unknown = buildLegacyCoachContext_("unknown-user", "test-chat", {
    spreadsheet: spreadsheet,
    deployment_env: "STAGING",
    chat_history: ""
  });
  record("C18D-05_UNKNOWN_USER_EMPTY", unknown === "", {context: unknown});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-18D_CONTEXT_ASSEMBLY",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC18DContextAssemblyTests() {
  return testC18DContextAssembly_();
}
