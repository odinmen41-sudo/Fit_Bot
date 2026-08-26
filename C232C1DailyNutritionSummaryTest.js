function runC232C1DailyNutritionSummaryTests() {
  const tests = [];
  function record(id, ok, details) { tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}}); }
  const headers = C232B4_NUTRITION_SCHEMA.slice();
  const today = new Date("2026-08-26T12:00:00.000Z");
  function values(id, user, at, status, totals) {
    const record = {schema_version:"v",meal_id:"meal:"+id,capture_id:id,user_id:user,meal_at:at,
      confirmed_at:at,items_count:1,calories_total:totals.calories,protein_total:totals.protein,
      fat_total:totals.fat,carbs_total:totals.carbs,items_json:"DO_NOT_PARSE",snapshot_hash:"hash",
      transaction_status:status,source:"test",created_at:at,updated_at:at};
    return nutritionMealRecordValues_(record);
  }
  function deps(rows, customHeaders, counters) {
    const counts = counters || {};
    return {time_zone:function(){counts.time_zone=(counts.time_zone||0)+1;return "Europe/Moscow";},
      format_date:function(date){return Utilities.formatDate(date,"Europe/Moscow","yyyy-MM-dd");},
      read_table:function(){counts.reads=(counts.reads||0)+1;return {headers:customHeaders||headers,rows:rows||[]};}};
  }
  function load(rows, customHeaders, counters) {
    return loadDailyNutritionSummary_("u1", {now:today,dependencies:deps(rows,customHeaders,counters)});
  }
  const positives = ["сколько я сегодня съел?","сколько сегодня калорий?","что сегодня по КБЖУ?",
    "сколько я съел за сегодня?","сколько калорий я съел сегодня?"];
  record("C23.2C1-01_INTENT_POSITIVE", positives.every(detectDailyNutritionQueryIntent_), positives);
  const negatives = ["сколько калорий в рисе?","сколько белка в куриной грудке?","сколько калорий осталось?",
    "сколько белка осталось?","какой у меня калораж?","сколько мне нужно калорий?","что мне съесть вечером?",
    "рис 150 г","съел рис 150 г","Да","Нет","мой вес 117 кг","жим 100 кг"];
  record("C23.2C1-02_INTENT_COLLISIONS", negatives.every(function(x){return !detectDailyNutritionQueryIntent_(x);}), negatives);
  let result = load([]);
  record("C23.2C1-03_NO_MEALS", result.ok && result.meals_count===0 && result.consumed.calories===0, result);
  const rowA = values("a","u1","2026-08-26T08:00:00.000Z","COMMITTED",{calories:569,protein:70.915,fat:9.84,carbs:43.275});
  result = load([rowA]);
  record("C23.2C1-04_SINGLE_COMMITTED", result.ok && result.meals_count===1 && result.consumed.calories===569, result);
  const rowB = values("b","u1","2026-08-26T10:00:00.000Z","COMMITTED",{calories:100.25,protein:2.125,fat:1.01,carbs:20.005});
  result = load([rowA,rowB]);
  record("C23.2C1-05_MULTIPLE", result.ok && result.meals_count===2, result);
  record("C23.2C1-06_EXACT_TOTALS", result.consumed.protein===73.04 && result.consumed.carbs===63.28, result);
  result = load([rowA,values("other","u2","2026-08-26T09:00:00.000Z","COMMITTED",{calories:999,protein:9,fat:9,carbs:9})]);
  record("C23.2C1-07_USER_ISOLATION", result.ok && result.meals_count===1 && result.consumed.calories===569, result);
  result = load([rowA,values("old","u1","2026-08-25T08:00:00.000Z","COMMITTED",{calories:999,protein:9,fat:9,carbs:9})]);
  record("C23.2C1-08_OTHER_DAY", result.ok && result.meals_count===1 && result.consumed.calories===569, result);
  const boundaryIn = values("midnight","u1","2026-08-25T21:00:00.000Z","COMMITTED",{calories:1,protein:1,fat:1,carbs:1});
  const boundaryOut = values("before","u1","2026-08-25T20:59:59.999Z","COMMITTED",{calories:50,protein:1,fat:1,carbs:1});
  result = load([boundaryIn,boundaryOut]);
  record("C23.2C1-09_LOCAL_BOUNDARY", result.ok && result.meals_count===1 && result.consumed.calories===1, result);
  result = load([rowA,values("prep","u1","2026-08-26T09:00:00.000Z","PREPARING",{calories:999,protein:9,fat:9,carbs:9})]);
  record("C23.2C1-10_PREPARING_EXCLUDED", result.ok && result.meals_count===1 && result.consumed.calories===569, result);
  result = load([values("broken","u1","2026-08-26T09:00:00.000Z","BROKEN",{calories:1,protein:1,fat:1,carbs:1})]);
  record("C23.2C1-10A_INVALID_STATE", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  const malformed = rowA.slice(); malformed[7] = "bad";
  result = load([malformed]);
  record("C23.2C1-11_MALFORMED_TOTAL", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  const noCapture = rowA.slice(); noCapture[2] = "";
  result = load([noCapture]);
  record("C23.2C1-12_EMPTY_CAPTURE", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  const badMeal = rowA.slice(); badMeal[1] = "meal:wrong";
  result = load([badMeal]);
  record("C23.2C1-13_BAD_MEAL_ID", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  const badDate = rowA.slice(); badDate[4] = "not-a-date";
  result = load([badDate]);
  record("C23.2C1-14_BAD_DATE", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  result = load([rowA,rowA.slice()]);
  record("C23.2C1-15_DUPLICATE_CAPTURE", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  result = load([rowA], headers.slice(0,16));
  record("C23.2C1-16_INVALID_SCHEMA", !result.ok && result.code==="DATA_INTEGRITY_ERROR", result);
  const route = routeDailyNutritionSummary_({message:{text:"что сегодня по кбжу?",from:{id:"u1"},chat:{id:"c1"}}},
    {now:today,dependencies:deps([rowA])});
  record("C23.2C1-17_ROUTE_HANDLED", route.handled && route.ok && route.meals_count===1, route);
  const fallthrough = routeDailyNutritionSummary_({message:{text:"рис 150 г",from:{id:"u1"},chat:{id:"c1"}}},
    {now:today,dependencies:deps([rowA])});
  record("C23.2C1-18_ROUTE_FALLTHROUGH", !fallthrough.handled && fallthrough.ok, fallthrough);
  record("C23.2C1-19_FORMAT", formatDailyNutritionSummary_(load([rowA])) ===
    "Сегодня:\n569 ккал\nБ: 70,9 г | Ж: 9,8 г | У: 43,3 г");
  record("C23.2C1-20_EMPTY_FORMAT", formatDailyNutritionSummary_(load([])) ===
    "Сегодня пока нет сохранённых записей о питании.");
  record("C23.2C1-21_ERROR_PRIVACY", formatDailyNutritionSummary_({ok:false,code:"DATA_INTEGRITY_ERROR"}).indexOf("CAPTURE")<0);
  const counts = {}; load([rowA], headers, counts);
  record("C23.2C1-22_ONE_BATCH_READ", counts.reads===1, counts);
  record("C23.2C1-23_SIDE_EFFECTS", !counts.writes && !counts.locks && !counts.groq && !counts.memory && !counts.food, counts);
  const passed = tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2C1_DAILY_NUTRITION_SUMMARY",status:passed===tests.length?"PASS":"FAIL",
    total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{nutrition_log_writes:0,pending_capture_writes:0,ai_memory_reads:0,ai_memory_writes:0,
      coach_state_reads:0,coach_state_writes:0,food_reference_reads:0,food_alias_reads:0,
      groq_calls:0,locks:0,production_writes:0}};
}
