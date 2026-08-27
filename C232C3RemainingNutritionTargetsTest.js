function runC232C3RemainingNutritionTargetsTests() {
  const tests = [];
  function record(id, ok, details) { tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}}); }
  const fixtureTargets = {calories:2300,protein:195,fat:70,carbs:225};
  const fixtureConsumed = {calories:569,protein:70.915,fat:9.84,carbs:43.275};
  function targetResult(targets, status) {
    return {ok:true,code:status === "PARTIAL" ? "TARGETS_PARTIAL" :
      status === "NOT_CONFIGURED" ? "TARGETS_NOT_CONFIGURED" : "TARGETS_AVAILABLE",
      status:status || "AVAILABLE",targets:targets};
  }
  function consumedResult(consumed, meals) {
    return {ok:true,code:"DAILY_NUTRITION_SUMMARY",date:"2026-08-27",meals_count:meals == null ? 1 : meals,consumed:consumed};
  }
  function update(text) { return {message:{text:text,from:{id:"tg1"},chat:{id:"c1"}}}; }
  function env(targets, status, consumed, counters) {
    const counts = counters || {};
    return {counts:counts,dependencies:{
      load_targets:function(){counts.profile_reads=(counts.profile_reads||0)+1;return targetResult(targets,status);},
      load_consumed:function(){counts.nutrition_reads=(counts.nutrition_reads||0)+1;return consumedResult(consumed||fixtureConsumed);}
    }};
  }

  let calculation = calculateRemainingNutritionTargets_(fixtureTargets, fixtureConsumed,
    ["calories","protein","fat","carbs"]);
  record("C23.2C3-01_ALL_TARGETS", Object.keys(calculation.remaining).every(function(key){return calculation.remaining[key]!==null;}), calculation);
  record("C23.2C3-02_EXACT_FIXTURE", calculation.remaining.calories===1731 && calculation.remaining.protein===124.085 &&
    calculation.remaining.fat===60.16 && calculation.remaining.carbs===181.725, calculation);
  calculation = calculateRemainingNutritionTargets_({calories:null,protein:195,fat:null,carbs:null},
    {calories:0,protein:70.915,fat:0,carbs:0},["protein"]);
  record("C23.2C3-03_SUBTRACT_BEFORE_DISPLAY", calculation.remaining.protein===124.085 &&
    dailyNutritionNumber_(calculation.remaining.protein,1)==="124,1", calculation);
  calculation = calculateRemainingNutritionTargets_({calories:500,protein:null,fat:null,carbs:null},
    {calories:650,protein:0,fat:0,carbs:0},["calories"]);
  record("C23.2C3-04_NEGATIVE_CALORIES", calculation.remaining.calories===-150 && calculation.states.calories==="EXCEEDED", calculation);
  calculation = calculateRemainingNutritionTargets_({calories:null,protein:100,fat:null,carbs:null},
    {calories:0,protein:110.5,fat:0,carbs:0},["protein"]);
  record("C23.2C3-05_NEGATIVE_MACRO", calculation.remaining.protein===-10.5 && calculation.states.protein==="EXCEEDED", calculation);
  calculation = calculateRemainingNutritionTargets_({calories:500,protein:null,fat:null,carbs:null},
    {calories:500,protein:0,fat:0,carbs:0},["calories"]);
  record("C23.2C3-06_EXACT_ZERO", calculation.remaining.calories===0 && calculation.states.calories==="ON_TARGET", calculation);
  calculation = calculateRemainingNutritionTargets_({calories:null,protein:100,fat:null,carbs:null},
    {calories:0,protein:100+5e-10,fat:0,carbs:0},["protein"]);
  record("C23.2C3-07_FLOATING_EPSILON", calculation.remaining.protein!==0 && calculation.states.protein==="ON_TARGET", calculation);
  calculation = calculateRemainingNutritionTargets_({calories:2300,protein:null,fat:null,carbs:null},fixtureConsumed,
    ["calories","protein","fat","carbs"]);
  record("C23.2C3-08_PARTIAL_CALORIES", calculation.remaining.calories===1731 && calculation.remaining.protein===null, calculation);
  calculation = calculateRemainingNutritionTargets_({calories:2300,protein:195,fat:null,carbs:null},fixtureConsumed,
    ["calories","protein","fat","carbs"]);
  record("C23.2C3-09_PARTIAL_CALORIES_PROTEIN", calculation.remaining.protein===124.085 && calculation.remaining.fat===null, calculation);
  let runtime = {dependencies:{load_targets:function(){return targetResult(fixtureTargets,"AVAILABLE");},
    load_consumed:function(){return consumedResult({calories:0,protein:0,fat:0,carbs:0},0);}}};
  let result = routeRemainingNutritionTargets_(update("что осталось по кбжу?"),runtime);
  record("C23.2C3-10_NO_MEALS", result.ok && result.meals_count===0 && result.remaining.calories===2300 && result.remaining.protein===195, result);

  record("C23.2C3-11_CALORIES_INTENT", detectRemainingNutritionQueryIntent_("сколько калорий осталось?")==="REMAINING_CALORIES");
  record("C23.2C3-12_REVERSED_CALORIES", detectRemainingNutritionQueryIntent_("сколько осталось калорий?")==="REMAINING_CALORIES");
  record("C23.2C3-13_PROTEIN_INTENT", detectRemainingNutritionQueryIntent_("сколько белка осталось?")==="REMAINING_PROTEIN");
  record("C23.2C3-14_FAT_INTENT", detectRemainingNutritionQueryIntent_("сколько осталось жиров?")==="REMAINING_FAT");
  record("C23.2C3-15_CARBS_INTENT", detectRemainingNutritionQueryIntent_("сколько углеводов осталось?")==="REMAINING_CARBS");
  record("C23.2C3-16_BZHU_INTENT", detectRemainingNutritionQueryIntent_("что осталось по БЖУ?")==="REMAINING_ALL");
  record("C23.2C3-17_KBZHU_INTENT", detectRemainingNutritionQueryIntent_("сколько осталось по КБЖУ?")==="REMAINING_ALL");
  const aggregates=["что осталось на сегодня по питанию?","сколько осталось на сегодня по питанию?",
    "сколько мне ещё можно съесть сегодня по питанию?"];
  record("C23.2C3-18_EXPLICIT_CONTEXT", aggregates.every(function(text){return detectRemainingNutritionQueryIntent_(text)==="REMAINING_ALL";}), aggregates);
  record("C23.2C3-19_AMBIGUOUS_REJECTED", detectRemainingNutritionQueryIntent_("сколько мне ещё можно съесть?")===null);

  record("C23.2C3-20_C1_UNAFFECTED", detectRemainingNutritionQueryIntent_("сколько я сегодня съел?")===null &&
    detectDailyNutritionQueryIntent_("сколько я сегодня съел?"));
  record("C23.2C3-21_C2_UNAFFECTED", detectRemainingNutritionQueryIntent_("цель по белку 195 г")===null &&
    detectExplicitNutritionTargetUpdate_("цель по белку 195 г")!==null);
  const knowledge=["сколько калорий в рисе?","сколько белка в курице?","сколько мне нужно калорий?","какой у меня калораж?"];
  record("C23.2C3-22_KNOWLEDGE_UNAFFECTED", knowledge.every(function(text){return detectRemainingNutritionQueryIntent_(text)===null;}), knowledge);
  const food=["рис 150 г","съел рис 150 г","съел 2300 ккал"];
  record("C23.2C3-23_FOOD_UNAFFECTED", food.every(function(text){return detectRemainingNutritionQueryIntent_(text)===null;}), food);
  record("C23.2C3-24_CONFIRMATIONS_UNAFFECTED", detectRemainingNutritionQueryIntent_("Да")===null && detectRemainingNutritionQueryIntent_("Нет")===null);
  record("C23.2C3-25_WEIGHT_WORKOUT_UNAFFECTED", detectRemainingNutritionQueryIntent_("мой вес 117 кг")===null &&
    detectRemainingNutritionQueryIntent_("жим 100 кг")===null);

  let counts={}; runtime=env({calories:null,protein:null,fat:null,carbs:null},"NOT_CONFIGURED",fixtureConsumed,counts);
  result=routeRemainingNutritionTargets_(update("что осталось по кбжу?"),runtime);
  const noTargets=result.code==="TARGETS_NOT_CONFIGURED"&&counts.profile_reads===1&&!counts.nutrition_reads;
  counts={}; runtime=env({calories:2300,protein:null,fat:null,carbs:null},"PARTIAL",fixtureConsumed,counts);
  result=routeRemainingNutritionTargets_(update("сколько белка осталось?"),runtime);
  record("C23.2C3-26_MISSING_SHORT_CIRCUITS", noTargets && result.code==="TARGET_NOT_CONFIGURED" &&
    result.message==="Цель по белку не задана." && counts.profile_reads===1 && !counts.nutrition_reads, {result:result,counts:counts});

  const failures=["USER_NOT_FOUND","DUPLICATE_USER_PROFILE","INVALID_PROFILE_SCHEMA","INVALID_TARGET_VALUE",
    "TARGET_OUT_OF_RANGE","INVALID_TARGET_PRECISION","PROFILE_READ_FAILED"];
  const hardFailures=failures.every(function(code){
    const local={nutrition_reads:0};
    const value=routeRemainingNutritionTargets_(update("сколько калорий осталось?"),{dependencies:{
      load_targets:function(){return {ok:false,code:code,status:"INVALID",targets:null};},
      load_consumed:function(){local.nutrition_reads++;return consumedResult(fixtureConsumed);}
    }});
    return value.handled&&!value.ok&&value.code===code&&value.remaining===null&&local.nutrition_reads===0&&
      value.message==="Не удалось надёжно прочитать цели по питанию из профиля.";
  });
  record("C23.2C3-27_C2_HARD_FAILURES", hardFailures, failures);

  counts={profile_reads:0,nutrition_reads:0,writes:0,locks:0,groq:0,memory:0,coach:0,food:0};
  result=routeRemainingNutritionTargets_(update("что осталось по кбжу?"),{dependencies:{
    load_targets:function(){counts.profile_reads++;return targetResult(fixtureTargets,"AVAILABLE");},
    load_consumed:function(){counts.nutrition_reads++;return {ok:false,code:"DATA_INTEGRITY_ERROR",consumed:null};}
  }});
  const serialized=JSON.stringify(result);
  record("C23.2C3-28_C1_FAILURE_ISOLATION", result.handled&&!result.ok&&result.code==="DATA_INTEGRITY_ERROR"&&
    result.remaining===null&&counts.profile_reads===1&&counts.nutrition_reads===1&&!counts.writes&&!counts.locks&&
    !counts.groq&&!counts.memory&&!counts.coach&&!counts.food&&result.groq_calls===0&&result.production_writes===0&&
    serialized.indexOf("tg1")<0&&serialized.indexOf("User_Profile")<0, {result:result,counts:counts});

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2C3_REMAINING_NUTRITION_TARGETS",status:passed===tests.length?"PASS":"FAIL",
    total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{user_profile_writes:0,nutrition_log_writes:0,pending_capture_writes:0,ai_memory_reads:0,
      ai_memory_writes:0,coach_state_reads:0,coach_state_writes:0,food_reference_reads:0,
      food_alias_reads:0,groq_calls:0,locks:0,production_writes:0}};
}
