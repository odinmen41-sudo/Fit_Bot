/** C-18B context-only identity and history isolation in-memory acceptance suite. */
function testC18BUserContextSafety_() {
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

  function spreadsheet(sheets) {
    return {
      getSheetByName: function(name) { return sheets[name] || null; }
    };
  }

  const profileHeaders = [
    "User_ID", "Telegram_ID", "Имя", "Возраст", "Рост", "Вес старт", "Текущий вес",
    "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"
  ];
  const profileRows = [
    ["132976932", "other-telegram", "User-ID Match", "30", "175", "100", "95", "85", "Форма", "Начальный", "2"],
    ["synthetic-user", "132976932", "Telegram Match", "35", "180", "120", "118,7", "108", "Снижение веса", "Средний", "3"]
  ];
  const profileSheet = spreadsheet({User_Profile: sheet([profileHeaders].concat(profileRows))});

  const telegramProfile = findUserProfile_("132976932", profileSheet);
  record("C18B-01_TELEGRAM_ID_PRIORITY", telegramProfile.indexOf("Имя=Telegram Match") >= 0 &&
    telegramProfile.indexOf("Имя=User-ID Match") < 0, {profile: telegramProfile});

  const userIdHeaders = ["User_ID", "Имя", "Возраст", "Рост", "Текущий вес", "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"];
  const userIdProfileSheet = spreadsheet({
    User_Profile: sheet([userIdHeaders, ["132976932", "Fallback User", "37", "185", "119", "108", "Снижение веса", "Средний", "3"]])
  });
  const userIdProfile = findUserProfile_("132976932", userIdProfileSheet);
  record("C18B-02_USER_ID_FALLBACK", userIdProfile.indexOf("Имя=Fallback User") >= 0,
    {profile: userIdProfile});

  const unknownProfile = findUserProfile_("unknown-user", profileSheet);
  record("C18B-03_UNKNOWN_USER_EMPTY", unknownProfile === "", {profile: unknownProfile});

  const requiredFields = [
    "Имя=Telegram Match", "Возраст=35", "Рост=180", "Текущий вес=118,7", "Целевой вес=108",
    "Цель=Снижение веса", "Уровень подготовки=Средний", "Тренировки в неделю=3"
  ];
  record("C18B-04_ALL_PROFILE_COLUMNS", requiredFields.every(function(field) {
    return telegramProfile.indexOf(field) >= 0;
  }), {profile: telegramProfile, required: requiredFields});

  const globalBody = spreadsheet({
    Body_Tracking: sheet([
      ["Дата", "Вес", "Комментарий"],
      ["23.08.2026", "118,7", "global row must not leak"]
    ])
  });
  const globalParts = [];
  addRecentUserSheetContext_(globalParts, "Body_Tracking", "132976932", 2, "Тело", globalBody);
  record("C18B-05_GLOBAL_BODY_FAILS_CLOSED", globalParts.length === 0, {parts: globalParts});

  const isolatedBody = spreadsheet({
    Body_Tracking: sheet([
      ["Дата", "Telegram_ID", "Вес", "Комментарий"],
      ["22.08.2026", "other-user", "90", "foreign"],
      ["23.08.2026", "132976932", "118,7", "own"]
    ])
  });
  const isolatedParts = [];
  addRecentUserSheetContext_(isolatedParts, "Body_Tracking", "132976932", 2, "Тело", isolatedBody);
  record("C18B-06_ONLY_OWN_HISTORY", isolatedParts.length === 1 &&
    isolatedParts[0].indexOf("Вес=118,7") >= 0 && isolatedParts[0].indexOf("Вес=90") < 0,
    {parts: isolatedParts});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-18B_USER_CONTEXT_SAFETY",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC18BUserContextSafetyTests() {
  return testC18BUserContextSafety_();
}
