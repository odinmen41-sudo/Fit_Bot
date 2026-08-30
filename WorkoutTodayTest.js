function runWorkoutTodayTests() {
  const tests=[];
  function record(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  function base(overrides){return Object.assign({USER_ID:"profile-u1",TELEGRAM_ID:"u1",WEEKDAY:"SUNDAY",SESSION_KEY:"back",SESSION_NAME:"спина",EXERCISE_KEY:"row",EXERCISE_NAME:"Тяга штанги",EXERCISE_ORDER:1,PLANNED_SETS:3,PLANNED_REPS:"5",PLANNED_LOAD:160,LOAD_UNIT:"kg",NOTES:"",ACTIVE:true},overrides||{});}
  function table(objects){return {headers:WORKOUT_PLAN_SCHEMA.slice(),rows:(objects||[]).map(function(object){return WORKOUT_PLAN_SCHEMA.map(function(header){return object[header];});})};}
  function dependencies(objects){return {time_zone:function(){return "Europe/Moscow";},format_date:function(date){const shifted=new Date(new Date(date).getTime()+3*60*60*1000);return shifted.toISOString().slice(0,10);},read_plan:function(){return objects===null?null:table(objects);},read_workout_log:function(){throw new Error("WORKOUT_LOG_MUST_NOT_BE_READ");},read_ai_memory:function(){throw new Error("AI_MEMORY_MUST_NOT_BE_READ");}};}
  function resolve(objects,intent,now){return resolveWorkoutPlan_("u1",{intent:intent||"WORKOUT_TODAY"},{now:now||new Date("2026-08-30T12:00:00Z"),dependencies:dependencies(objects)});}
  const sunday=[base(),base({EXERCISE_KEY:"pulldown",EXERCISE_NAME:"Тяга верхнего блока",EXERCISE_ORDER:2,PLANNED_SETS:3,PLANNED_REPS:"10-12",PLANNED_LOAD:"",LOAD_UNIT:""}),base({WEEKDAY:"TUESDAY",SESSION_KEY:"legs",SESSION_NAME:"ноги",EXERCISE_KEY:"squat",EXERCISE_NAME:"Присед",EXERCISE_ORDER:1,PLANNED_SETS:4,PLANNED_REPS:6,PLANNED_LOAD:100})];
  let result=resolve(sunday),text=formatWorkoutPlan_(result);
  record("WT-01_TRAINING_DAY",result.status==="TRAINING_DAY"&&result.workout.display_name==="спина",result);
  result=resolve(sunday,"WORKOUT_TODAY",new Date("2026-08-31T12:00:00Z"));record("WT-02_REST_DISTINCT",result.status==="REST_DAY",result);
  result=resolve(null);record("WT-03_NOT_CONFIGURED",result.status==="PLAN_NOT_CONFIGURED",result);
  result=resolve(sunday);record("WT-04_LOCAL_WEEKDAY",result.local_weekday==="SUNDAY"&&result.local_date==="2026-08-30",result);
  result=resolve([sunday[1],sunday[0],sunday[2]]);record("WT-05_ORDER_SORT",result.workout.exercises[0].display_name==="Тяга штанги",result);
  record("WT-06_SETS_DISPLAY",/3 × 5/.test(text),text);record("WT-07_REP_RANGE",/3 × 10–12/.test(text),text);
  record("WT-08_LOAD_DISPLAY",/160 кг/.test(text),text);record("WT-09_LOAD_NOT_FABRICATED",/вес не задан/.test(text)&&!/null кг/.test(text),text);
  record("WT-10_BAD_LOAD",resolve([base({PLANNED_LOAD:"abc"})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-11_BAD_REPS",resolve([base({PLANNED_REPS:"around 10"})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-12_BAD_SETS",resolve([base({PLANNED_SETS:0})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-13_DUPLICATE_ORDER",resolve([base(),base({EXERCISE_KEY:"other",EXERCISE_NAME:"Другое"})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-14_MISSING_NAME",resolve([base({EXERCISE_NAME:""})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-15_INVALID_EXERCISE_STRUCTURE",resolve([base({EXERCISE_KEY:""})]).code==="DATA_INTEGRITY_ERROR",{});
  result=resolve(sunday,"NEXT_WORKOUT",new Date("2026-08-31T12:00:00Z"));record("WT-16_NEXT_FROM_REST",result.local_date==="2026-09-01"&&result.workout.display_name==="ноги",result);
  result=resolve(sunday,"NEXT_WORKOUT");record("WT-17_NEXT_FROM_TRAINING",result.local_date==="2026-09-01",result);
  const wedFri=[base({WEEKDAY:"WEDNESDAY"}),base({WEEKDAY:"FRIDAY",SESSION_KEY:"legs",SESSION_NAME:"ноги",EXERCISE_KEY:"squat",EXERCISE_NAME:"Присед"})];
  result=resolve(wedFri,"WORKOUT_TODAY",new Date("2026-09-03T12:00:00Z"));record("WT-18_NO_AUTO_SHIFT",result.status==="REST_DAY"&&result.next_workout.local_weekday==="FRIDAY",result);
  record("WT-19_NO_WORKOUT_LOG",resolve(sunday).workout_log_reads===0,{});record("WT-20_NO_AI_MEMORY",resolve(sunday).ai_memory_reads===0,{});
  record("WT-21_NO_GROQ_MISSING_PLAN",resolve(null).groq_calls===0,{});record("WT-22_FACT_GROQ_ZERO",resolve(sunday).groq_calls===0,{});
  function intent(value){return detectWorkoutPlanIntent_(value);}
  record("WT-23_CONFIRMATION_NOT_STOLEN",intent("Да")===null,{});record("WT-24_NUTRITION_CREATE_NOT_STOLEN",intent("банан 200 г")===null,{});
  record("WT-25_NUTRITION_HISTORY_NOT_STOLEN",intent("что я ел сегодня")===null,{});record("WT-26_VOID_NOT_STOLEN",intent("удали последний банан")===null,{});
  record("WT-27_REPLACE_NOT_STOLEN",intent("исправь последний банан на 200 г")===null,{});record("WT-28_REMAINING_NOT_STOLEN",intent("сколько осталось калорий")===null,{});
  record("WT-29_WEIGHT_NOT_STOLEN",intent("мой вес 117 кг")===null,{});
  text=formatWorkoutPlan_(resolve(sunday));record("WT-30_PRIVACY",!/USER_ID|SESSION_KEY|EXERCISE_KEY|profile-u1|\bu1\b|SOURCE|SCHEMA/.test(text),text);
  result=resolve([base({WEEKDAY:"MONDAY"})],"WORKOUT_TODAY",new Date("2026-08-30T21:30:00Z"));record("WT-31_TIMEZONE_BOUNDARY",result.local_date==="2026-08-31"&&result.local_weekday==="MONDAY",result);
  result=resolve(sunday);record("WT-32_STABLE_IDENTITIES",result.workout.stable_session_identity==="back"&&result.workout.exercises[0].stable_exercise_identity==="row",result);
  record("WT-33_TODAY_VARIANT",intent("что у меня сегодня по тренировке").intent==="WORKOUT_TODAY",{});record("WT-34_NEXT_VARIANT",intent("когда следующая тренировка").intent==="NEXT_WORKOUT",{});
  record("WT-35_REST_FORMAT",/Сегодня по плану отдых/.test(formatWorkoutPlan_(resolve(sunday,"WORKOUT_TODAY",new Date("2026-08-31T12:00:00Z")))),{});
  record("WT-36_NOT_CONFIGURED_FORMAT",formatWorkoutPlan_(resolve(null))==="План тренировок пока не настроен.",{});
  record("WT-37_BAD_UNIT",resolve([base({LOAD_UNIT:"lb"})]).code==="DATA_INTEGRITY_ERROR",{});record("WT-38_UNIT_WITHOUT_LOAD",resolve([base({PLANNED_LOAD:"",LOAD_UNIT:"kg"})]).code==="DATA_INTEGRITY_ERROR",{});
  record("WT-39_OTHER_USER_ISOLATED",resolve([base({TELEGRAM_ID:"u2",USER_ID:"profile-u2"})]).status==="PLAN_NOT_CONFIGURED",{});
  const route=routeWorkoutPlan_({message:{text:"какая сегодня тренировка",from:{id:"u1"},chat:{id:"u1"}}},{now:new Date("2026-08-30T12:00:00Z"),dependencies:dependencies(sunday)});
  record("WT-40_ROUTE_HANDLED",route.handled&&route.ok&&route.code==="TRAINING_DAY"&&route.groq_calls===0,route);
  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"WORKOUT_TODAY",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,workout_log_reads:0,ai_memory_reads:0,coach_state_reads:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
