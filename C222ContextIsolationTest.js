/** C-22.2 user-scoped context isolation and metadata redaction in-memory suite. */
function runC222ContextIsolationTests() {
  const tests = [];
  function record(id, condition, details) { tests.push({id:id, passed:condition === true, details:details || {}}); }
  function fakeSheet(values, throws) {
    return {
      getLastRow:function() { if (throws) throw new Error("READ_SENTINEL"); return values.length; },
      getLastColumn:function() { return values.length ? values[0].length : 0; },
      getRange:function(row, column, rowCount, columnCount) { return {
        getDisplayValues:function() { return values.slice(row - 1, row - 1 + rowCount).map(function(source) {
          return source.slice(column - 1, column - 1 + columnCount);
        }); },
        getValues:function() { return this.getDisplayValues(); }
      }; }
    };
  }
  function fakeSpreadsheet(sheets) { return {getSheetByName:function(name) { return sheets[name] || null; }}; }

  const profileHeaders = C232C2_TARGET_SCHEMA.slice();
  const profile = fakeSheet([
    profileHeaders,
    ["internal-a","Alice Safe",31,170,80,75,68,"Goal A","Средний",3,"telegram-a",2100,130,65,250],
    ["internal-b","Bob Foreign",42,182,100,98,85,"Goal B","Начальный",2,"telegram-b",2500,160,80,300]
  ]);
  const domainHeaders = ["User_ID","Telegram_ID","Дата","Вес","Комментарий","CAPTURE_ID","RAW_MESSAGE","FUTURE_COLUMN"];
  const body = fakeSheet([
    domainHeaders,
    ["internal-a","telegram-a","2026-08-26","74.5","A_COMMENT_SECRET","A_CAPTURE_SECRET","A_RAW_SECRET","A_FUTURE_SECRET"],
    ["internal-b","telegram-b","2026-08-27","97.5","B_COMMENT_SECRET","B_CAPTURE_SECRET","B_RAW_SECRET","B_FUTURE_SECRET"]
  ]);
  const workout = fakeSheet([
    ["User_ID","Дата","Тип тренировки","Упражнение","Вес","Подходы","Повторы","RPE","Комментарий","CAPTURE_ID"],
    ["internal-a","2026-08-27","A Strength","A Squat",80,3,8,7,"A_WORKOUT_RAW","A_WORKOUT_ID"],
    ["internal-b","2026-08-27","B Secret","B Bench",100,4,5,8,"B_WORKOUT_RAW","B_WORKOUT_ID"]
  ]);
  const recovery = fakeSheet([
    ["User_ID","Дата","Сон часы","Качество сна","Стресс","Усталость","Энергия","Боль плечо","Комментарий","SOURCE"],
    ["internal-a","2026-08-27",7,8,3,4,7,"нет","A_RECOVERY_RAW","A_RECOVERY_SOURCE"],
    ["internal-b","2026-08-27",5,4,8,9,3,"B_PAIN","B_RECOVERY_RAW","B_RECOVERY_SOURCE"]
  ]);
  const goals = fakeSheet([
    ["User_ID","Цель","Дата старта","Целевое значение","Статус","Версия цели","Комментарий"],
    ["internal-a","A Goal Safe","2026-08-01",68,"ACTIVE","A_VERSION","A_GOAL_RAW"],
    ["internal-b","B Goal Secret","2026-08-01",85,"ACTIVE","B_VERSION","B_GOAL_RAW"]
  ]);
  const nutrition = fakeSheet([C232B4_NUTRITION_SCHEMA, ["schema","B_MEAL_SECRET","B_CAPTURE_SECRET","internal-b",
    "2026-08-27T10:00:00Z","2026-08-27T10:00:00Z",1,999,99,9,9,"B_ITEMS_SECRET","B_HASH_SECRET","COMMITTED","B_SOURCE","x","x"]]);
  const health = fakeSheet([["User_ID","Condition"],["internal-b","B_HEALTH_SECRET"]]);
  const knowledge = fakeSheet([["Категория","Параметр","Значение","Комментарий","TECH"],
    ["Новая программа","A session — Safe exercise","3x8","Approved note","GLOBAL_TECH_SECRET"]]);
  const sheets = {User_Profile:profile, Body_Tracking:body, Workout_Log:workout, Recovery_Log:recovery,
    Goals:goals, Nutrition_Log:nutrition, Health_Data:health, Knowledge_Base:knowledge};
  const spreadsheet = fakeSpreadsheet(sheets);

  const identityA = resolveSafeContextIdentity_("telegram-a", spreadsheet, {deployment_env:"PRODUCTION"});
  const identityB = resolveSafeContextIdentity_("telegram-b", spreadsheet, {deployment_env:"PRODUCTION"});
  record("C222-01_UNIQUE_TELEGRAM_A", identityA.ok && identityA.internal_user_id === "internal-a", identityA);
  record("C222-02_UNIQUE_TELEGRAM_B", identityB.ok && identityB.internal_user_id === "internal-b", identityB);

  const fallbackProfile = fakeSheet([profileHeaders,
    ["telegram-a","Fallback",31,170,80,75,68,"Goal","Средний",3,"",2100,130,65,250]]);
  record("C222-03_USER_ID_FALLBACK", resolveSafeContextIdentity_("telegram-a", fakeSpreadsheet({User_Profile:fallbackProfile}),
    {deployment_env:"PRODUCTION"}).ok);
  const noIdentityProfile = fakeSheet([["Имя","Возраст"],["Alice",31]]);
  record("C222-04_PROFILE_IDENTITY_REQUIRED", !resolveSafeContextIdentity_("telegram-a",
    fakeSpreadsheet({User_Profile:noIdentityProfile}), {deployment_env:"PRODUCTION"}).ok);
  const duplicateHeader = profileHeaders.slice(); duplicateHeader[1] = "User_ID";
  record("C222-05_DUPLICATE_USER_HEADER", !resolveSafeContextIdentity_("telegram-a",
    fakeSpreadsheet({User_Profile:fakeSheet([duplicateHeader, profileHeaders.map(function() { return "x"; })])}),
    {deployment_env:"PRODUCTION"}).ok);
  const duplicateRows = fakeSheet([profileHeaders,
    ["a1","A1",31,170,80,75,68,"G","M",3,"telegram-a",2100,130,65,250],
    ["a2","A2",31,170,80,75,68,"G","M",3,"telegram-a",2100,130,65,250]]);
  record("C222-06_DUPLICATE_PROFILE_FAILS_CLOSED", !resolveSafeContextIdentity_("telegram-a",
    fakeSpreadsheet({User_Profile:duplicateRows}), {deployment_env:"PRODUCTION"}).ok);
  record("C222-07_ABSENT_USER", !resolveSafeContextIdentity_("absent", spreadsheet, {deployment_env:"PRODUCTION"}).ok);
  const conflictingProfile = fakeSheet([profileHeaders,
    ["telegram-a","Wrong direct owner",31,170,80,75,68,"G","M",3,"other",2100,130,65,250],
    ["internal-a","Right telegram owner",31,170,80,75,68,"G","M",3,"telegram-a",2100,130,65,250]]);
  record("C222-07B_CONFLICTING_IDENTITY", resolveSafeContextIdentity_("telegram-a",
    fakeSpreadsheet({User_Profile:conflictingProfile}), {deployment_env:"PRODUCTION"}).code === "CONFLICTING_PROFILE_IDENTITY");
  const aliasSheet = fakeSheet([profileHeaders,
    ["staging-user-001","Stage",35,180,120,118,108,"Goal","M",3,"",2300,195,70,225]]);
  record("C222-08_STAGING_ALIAS_ALLOWED", resolveSafeContextIdentity_("132976932",
    fakeSpreadsheet({User_Profile:aliasSheet}), {deployment_env:"STAGING"}).ok);
  record("C222-09_STAGING_ALIAS_REJECTED_PRODUCTION", !resolveSafeContextIdentity_("132976932",
    fakeSpreadsheet({User_Profile:aliasSheet}), {deployment_env:"PRODUCTION"}).ok);

  const bodyA = readSafeUserContextSource_("Body_Tracking", identityA, spreadsheet);
  const bodyText = bodyA.ok ? bodyA.fragments.map(function(item) { return item.text; }).join("\n") : "";
  record("C222-10_BODY_A_ALLOWED", /74\.5/.test(bodyText), {text:bodyText});
  record("C222-11_BODY_B_ISOLATED", bodyText.indexOf("97.5") < 0 && bodyText.indexOf("B_") < 0, {text:bodyText});
  record("C222-12_BODY_METADATA_REDACTED", !/(A_COMMENT_SECRET|A_CAPTURE_SECRET|A_RAW_SECRET|A_FUTURE_SECRET)/.test(bodyText), {text:bodyText});
  record("C222-13_IDENTITY_NOT_RENDERED", bodyText.indexOf("internal-a") < 0 && bodyText.indexOf("telegram-a") < 0, {text:bodyText});

  function assertSafeSource(id, name, own, foreign, forbidden) {
    const result = readSafeUserContextSource_(name, identityA, spreadsheet);
    const text = result.ok ? result.fragments.map(function(item) { return item.text; }).join("\n") : "";
    record(id + "_OWN", result.ok && text.indexOf(own) >= 0, {text:text});
    record(id + "_FOREIGN", text.indexOf(foreign) < 0, {text:text});
    record(id + "_REDACT", !forbidden.test(text), {text:text});
  }
  assertSafeSource("C222-14_GOALS", "Goals", "A Goal Safe", "B Goal Secret", /A_VERSION|A_GOAL_RAW/);
  assertSafeSource("C222-15_WORKOUT", "Workout_Log", "A Squat", "B Bench", /A_WORKOUT_RAW|A_WORKOUT_ID/);
  assertSafeSource("C222-16_RECOVERY", "Recovery_Log", "Сон часы: 7", "B_PAIN", /A_RECOVERY_RAW|A_RECOVERY_SOURCE/);

  record("C222-17_MISSING_SHEET_NORMAL", readSafeUserContextSource_("Goals", identityA,
    fakeSpreadsheet({User_Profile:profile})).code === "SHEET_ABSENT");
  const noRows = readSafeUserContextSource_("Goals", identityA, fakeSpreadsheet({Goals:fakeSheet([["User_ID","Цель"]])}));
  record("C222-18_NO_ROWS_NORMAL", noRows.code === "NO_ROWS");
  const noUser = readSafeUserContextSource_("Goals", identityA,
    fakeSpreadsheet({Goals:fakeSheet([["User_ID","Цель"],["internal-b","B"]])}));
  record("C222-19_NO_USER_ROWS", noUser.code === "NO_USER_ROWS");
  const missingIdentity = readSafeUserContextSource_("Goals", identityA,
    fakeSpreadsheet({Goals:fakeSheet([["Цель"],["Unsafe"]])}));
  record("C222-20_MISSING_IDENTITY_OMITTED", missingIdentity.code === "IDENTITY_HEADER_MISSING");
  const dupId = readSafeUserContextSource_("Goals", identityA,
    fakeSpreadsheet({Goals:fakeSheet([["User_ID","user_id","Цель"],["internal-a","internal-a","Unsafe"]])}));
  record("C222-21_DUPLICATE_IDENTITY_OMITTED", dupId.code === "DUPLICATE_IDENTITY_HEADER" && dupId.integrity_failure);
  const readFailure = readSafeUserContextSource_("Goals", identityA,
    fakeSpreadsheet({Goals:fakeSheet([], true)}));
  record("C222-22_READ_FAILURE_OMITTED", readFailure.code === "READ_FAILED");
  record("C222-23_HEALTH_UNSUPPORTED", readSafeUserContextSource_("Health_Data", identityA, spreadsheet).code === "UNSUPPORTED_LAYOUT");

  const legacyA = buildLegacyCoachContext_("telegram-a", "chat-a", {spreadsheet:spreadsheet,
    deployment_env:"PRODUCTION", chat_history:""});
  record("C222-24_LEGACY_ALLOWED", legacyA.indexOf("Alice Safe") >= 0 && legacyA.indexOf("A Squat") >= 0, {context:legacyA});
  record("C222-25_LEGACY_ISOLATED", !/(Bob Foreign|B Bench|B Goal Secret|B_PAIN)/.test(legacyA), {context:legacyA});
  record("C222-26_LEGACY_NO_RAW_NUTRITION", !/(RECENT HISTORY — NUTRITION|B_MEAL_SECRET|B_CAPTURE_SECRET)/.test(legacyA), {context:legacyA});
  record("C222-27_LEGACY_TECH_REDACTED", !/(A_CAPTURE_SECRET|A_RAW_SECRET|A_WORKOUT_ID|internal-a|telegram-a)/.test(legacyA), {context:legacyA});

  const approvedMemory = [{category:"health",key:"shoulder",value:"A shoulder safe",priority:"HIGH",updated_at:"2026-08-27"},
    {category:"secret",key:"raw",value:"A_MEMORY_TECH_SECRET",priority:"HIGH",updated_at:"2026-08-27"}];
  const oldGetSpreadsheet = getSpreadsheet_;
  getSpreadsheet_ = function() { return spreadsheet; };
  let memoryA;
  try {
    memoryA = buildMemoryCoachContext_("telegram-a", "chat-a", {memory:approvedMemory, persona:{role:"Global persona"},
      rules:[], spreadsheet:spreadsheet, identity:identityA, deployment_env:"PRODUCTION", chat_history:""});
  } finally { getSpreadsheet_ = oldGetSpreadsheet; }
  record("C222-28_MEMORY_ALLOWED", memoryA.indexOf("A shoulder safe") >= 0 && memoryA.indexOf("A Squat") >= 0, {context:memoryA});
  record("C222-29_MEMORY_UNKNOWN_FACT_REDACTED", memoryA.indexOf("A_MEMORY_TECH_SECRET") < 0, {context:memoryA});
  record("C222-30_MEMORY_ISOLATED", !/(Bob Foreign|B Bench|B Goal Secret|B_PAIN)/.test(memoryA), {context:memoryA});
  record("C222-31_MEMORY_NO_GENERIC_NUTRITION", memoryA.indexOf("RECENT HISTORY — NUTRITION") < 0 && memoryA.indexOf("B_MEAL_SECRET") < 0, {context:memoryA});
  record("C222-32_KNOWLEDGE_RETAINED_PROJECTED", memoryA.indexOf("Safe exercise") >= 0 && memoryA.indexOf("GLOBAL_TECH_SECRET") < 0, {context:memoryA});

  const trusted = formatNutritionTodayContextBlock_({ok:true, project_local_date:"2026-08-27", meals_count:1,
    logged:{calories:500,protein:50,fat:10,carbs:40}, targets_configured:["calories"], targets_missing:["protein","fat","carbs"],
    targets:{calories:2000}, remaining_based_on_logged:{calories:1500}});
  const c4Messages = buildGroqMessages_(sanitizeNutritionOverlapForC4_(memoryA), "Что мне съесть вечером?", trusted);
  const c4Serialized = JSON.stringify(c4Messages);
  record("C222-33_C4_EXACTLY_ONE_TRUSTED", (c4Serialized.match(/=== NUTRITION_TODAY_TRUSTED ===/g) || []).length === 1);
  const negativeMessages = buildGroqMessages_(memoryA, "Сколько калорий в рисе?", null);
  record("C222-34_C4_NEGATIVE_NO_TRUSTED", JSON.stringify(negativeMessages).indexOf("NUTRITION_TODAY_TRUSTED") < 0);
  record("C222-35_CLASSIFIER_UNCHANGED", detectNutritionAdviceContextIntent_("Что мне съесть вечером?") === true &&
    detectNutritionAdviceContextIntent_("Сколько калорий в рисе?") === false);

  const analytics = refreshUserAnalytics_("telegram-a");
  record("C222-36_ANALYTICS_DISABLED_ZERO_IO", analytics.code === "ANALYTICS_REFRESH_DISABLED_UNSAFE_SOURCE" &&
    analytics.reads === 0 && analytics.writes === 0, analytics);
  record("C222-37_DIAGNOSTICS_NON_PII", JSON.stringify(bodyA.diagnostics).indexOf("telegram-a") < 0 &&
    JSON.stringify(bodyA.diagnostics).indexOf("74.5") < 0, bodyA.diagnostics);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {suite:"C-22.2_CONTEXT_ISOLATION", status:passed === tests.length ? "PASS" : "FAIL",
    total:tests.length, passed:passed, failed:tests.length - passed, tests:tests,
    safety:{sheet_writes:0, property_writes:0, telegram_calls:0, groq_calls:0, locks:0, production_writes:0}};
}
