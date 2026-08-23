/** C-18C temporary staging-only context identity resolver acceptance suite. */
function testC18CIdentityResolver_() {
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

  function spreadsheet(values) {
    return {getSheetByName: function(name) { return name === "User_Profile" ? sheet(values) : null; }};
  }

  const fullHeaders = [
    "User_ID", "Telegram_ID", "Имя", "Возраст", "Рост", "Вес старт", "Текущий вес",
    "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"
  ];
  const directRows = [
    fullHeaders,
    ["synthetic-a", "other-user", "Foreign", "29", "170", "90", "88", "80", "Чужая цель", "Начальный", "2"],
    ["synthetic-b", "132976932", "Direct Telegram", "37", "185", "123", "119", "108", "Снижение веса", "Средний", "3"]
  ];
  const directProfile = findUserProfile_("132976932", spreadsheet(directRows), {deployment_env: "STAGING"});
  record("C18C-01_TELEGRAM_ID_FOUND", directProfile.indexOf("Имя=Direct Telegram") >= 0 &&
    directProfile.indexOf("Имя=Foreign") < 0, {profile: directProfile});

  const fallbackRows = [
    ["User_ID", "Имя", "Возраст", "Рост", "Цель", "Уровень подготовки", "Тренировки в неделю"],
    ["132976932", "User ID Fallback", "37", "185", "Снижение веса", "Средний", "3"]
  ];
  const fallbackProfile = findUserProfile_("132976932", spreadsheet(fallbackRows), {deployment_env: "PRODUCTION"});
  record("C18C-02_USER_ID_FALLBACK", fallbackProfile.indexOf("Имя=User ID Fallback") >= 0,
    {profile: fallbackProfile});

  const stagingRows = [
    ["User_ID", "Имя", "Возраст", "Рост", "Текущий вес", "Целевой вес", "Цель", "Уровень подготовки", "Тренировки в неделю"],
    ["unrelated-user", "Foreign", "40", "190", "100", "90", "Чужая цель", "Продвинутый", "5"],
    ["staging-user-001", "Staging Test", "35", "180", "118,7", "108", "Снижение веса", "Средний", "3"]
  ];
  const stagingProfile = findUserProfile_("132976932", spreadsheet(stagingRows), {deployment_env: "STAGING"});
  record("C18C-03_STAGING_ALIAS_FOUND", stagingProfile.indexOf("User_ID=staging-user-001") >= 0 &&
    stagingProfile.indexOf("Имя=Staging Test") >= 0, {profile: stagingProfile});

  const requiredContext = [
    "Возраст=35", "Рост=180", "Цель=Снижение веса", "Уровень подготовки=Средний", "Тренировки в неделю=3"
  ];
  record("C18C-04_REQUIRED_CONTEXT_FIELDS", requiredContext.every(function(field) {
    return stagingProfile.indexOf(field) >= 0;
  }), {profile: stagingProfile, required: requiredContext});

  const productionAlias = findUserProfile_("132976932", spreadsheet(stagingRows), {deployment_env: "PRODUCTION"});
  record("C18C-05_ALIAS_STAGING_ONLY", productionAlias === "", {profile: productionAlias});

  const unknownProfile = findUserProfile_("999999999", spreadsheet(stagingRows), {deployment_env: "STAGING"});
  record("C18C-06_UNKNOWN_USER_EMPTY", unknownProfile === "", {profile: unknownProfile});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-18C_IDENTITY_RESOLVER",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC18CIdentityResolverTests() {
  return testC18CIdentityResolver_();
}
