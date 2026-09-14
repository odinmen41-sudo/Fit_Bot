function runFinalProductCompletionTests(){
  const tests=[];function record(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  const now=new Date("2026-09-14T12:00:00.000Z"),objective={history_status:"NORMAL",last_completed_workout:{date:"2026-09-13",session_name:"спина",days_ago:1},sessions_7d:3,sessions_14d:5,training_days_7d:3,training_days_14d:5,plan_status:"REST_DAY",planned_today:null,next_workout:null};
  function subjective(values){const metrics={};SUBJECTIVE_RECOVERY_METRICS.forEach(function(key){metrics[key]={status:Object.prototype.hasOwnProperty.call(values||{},key)?"FRESH":"MISSING",value:Object.prototype.hasOwnProperty.call(values||{},key)?values[key]:null};});return {data_status:"NORMAL",local_date:"2026-09-14",metrics:metrics};}
  const context={objective:objective,subjective:subjective({sleep_duration_hours:5.5,fatigue:8,readiness:3})},recoveryText=formatRecoveryContext_(context);
  record("FINAL-01_RECOVERY_OBJECTIVE",/последняя заверш[её]нная тренировка/i.test(recoveryText),recoveryText);
  record("FINAL-02_RECOVERY_SUBJECTIVE",/сон: 5,5 ч/i.test(recoveryText)&&/усталость: 8\/10/i.test(recoveryText)&&/готовность: 3\/10/i.test(recoveryText),recoveryText);
  record("FINAL-03_RECOVERY_PRIVACY",!/USER_ID|EVENT_ID|IDEMPOTENCY|SCHEMA|SOURCE/.test(recoveryText),recoveryText);
  record("FINAL-04_RECOVERY_INTENTS",["как я восстанавливаюсь","как восстановление сегодня","что по восстановлению"].every(function(q){const x=detectRecoveryIntent_(q);return x&&x.intent==="RECOVERY_CONTEXT";}),{});

  function dashboardDependencies(subjectiveValue){return {time_zone:function(){return "Europe/Moscow";},format_date:function(){return "2026-09-14";},build_weight:function(){return {data_status:"NO_DATA",freshness:"UNKNOWN",trend_status:"INSUFFICIENT_DATA",goal:{}};},load_consumed:function(){return {ok:true,meals_count:0,consumed:{calories:0,protein:0,fat:0,carbs:0}};},load_targets:function(){return {ok:true,status:"NOT_CONFIGURED",targets:{}};},build_recovery:function(){return objective;},load_subjective:function(){if(subjectiveValue instanceof Error)throw subjectiveValue;return subjectiveValue;},log_error:function(){}};}
  let dashboard=buildDailyDashboardFacts_("u1",{now:now,dependencies:dashboardDependencies(context.subjective)}),dashboardText=formatDailyDashboard_(dashboard);
  record("FINAL-05_DASHBOARD_SUBJECTIVE",dashboard.recovery.subjective_status==="NORMAL"&&/Восстановление сегодня/.test(dashboardText),dashboard);
  dashboard=buildDailyDashboardFacts_("u1",{now:now,dependencies:dashboardDependencies(new Error("unavailable"))});
  record("FINAL-06_DASHBOARD_FAILURE_ISOLATION",dashboard.recovery.subjective_status==="UNAVAILABLE"&&dashboard.training.available===true,dashboard);
  record("FINAL-07_COACH_ALIASES",["как у меня дела","как идет прогресс"].every(function(q){return detectDailyDashboardIntent_(q).intent==="DAILY_DASHBOARD";}),{});

  const signalFacts={recovery:{subjective_status:"NORMAL",today:{fatigue:8,readiness:3,sleep_duration_hours:5.5}}},signals=detectProactiveCoachingSignals_(signalFacts,now,{local_hour:15}),keys=signals.map(function(s){return s.key;});
  record("FINAL-08_RECOVERY_SIGNALS",["SUBJECTIVE_HIGH_FATIGUE","SUBJECTIVE_LOW_READINESS","SUBJECTIVE_SHORT_SLEEP"].every(function(k){return keys.indexOf(k)>=0;}),keys);
  record("FINAL-09_SIGNAL_PRIORITY",selectProactiveCoachingSignal_(signals).key==="SUBJECTIVE_HIGH_FATIGUE",signals);
  record("FINAL-10_SIGNAL_MESSAGE_SAFE",!/diagnos|болезн|лечен/i.test(formatProactiveCoachingHint_(selectProactiveCoachingSignal_(signals))),{});

  function propertyStore(enabled){const values={PROACTIVE_DELIVERY_ENABLED:enabled?"true":"false"};return {values:values,getProperty:function(key){return values[key]||null;},setProperty:function(key,value){values[key]=value;}};}
  function deliveryEnv(enabled){const properties=propertyStore(enabled),sent=[];return {properties:properties,sent:sent,deps:{properties:properties,list_users:function(){return ["101","202"];},time_zone:function(){return "Europe/Moscow";},format_date:function(date,zone,pattern){return pattern==="H"?"15":"2026-09-14";},build_facts:function(user){return user==="101"?signalFacts:{};},evaluate:function(facts,date){return evaluateProactiveCoaching_(facts,date,{local_hour:15});},send:function(user,message){sent.push({user:user,message:message});}}};}
  let delivery=deliveryEnv(false),run=runProactiveCoachingDelivery_({now:now,dependencies:delivery.deps});record("FINAL-11_DELIVERY_GATE",run.code==="DISABLED"&&delivery.sent.length===0,run);
  delivery=deliveryEnv(true);run=runProactiveCoachingDelivery_({now:now,dependencies:delivery.deps});record("FINAL-12_DELIVERY_ONE_SIGNAL",run.sent===1&&delivery.sent[0].user==="101",run);
  const firstState=delivery.properties.values[proactiveDeliveryStateKey_("101")];run=runProactiveCoachingDelivery_({now:now,dependencies:delivery.deps});record("FINAL-13_DELIVERY_DEDUP",run.sent===0&&delivery.sent.length===1&&delivery.properties.values[proactiveDeliveryStateKey_("101")]===firstState,run);
  delivery=deliveryEnv(true);delivery.deps.format_date=function(date,zone,pattern){return pattern==="H"?"23":"2026-09-14";};run=runProactiveCoachingDelivery_({now:now,dependencies:delivery.deps});record("FINAL-14_QUIET_HOURS",run.sent===0&&delivery.sent.length===0,run);
  delivery=deliveryEnv(true);delivery.deps.send=function(){throw new Error("send failed");};run=runProactiveCoachingDelivery_({now:now,dependencies:delivery.deps});record("FINAL-15_NO_FALSE_DELIVERY_STATE",run.code==="PARTIAL_FAILURE"&&!delivery.properties.values[proactiveDeliveryStateKey_("101")],run);

  record("FINAL-16_WORKOUT_QUERY_PARSE",detectWorkoutLoggingHistoryIntent_("какой вес был в прошлый раз в жим").intent==="HISTORY_EXERCISE",{});
  record("FINAL-17_WORKOUT_COUNT_PARSE",detectWorkoutLoggingHistoryIntent_("сколько тренировок было за неделю").intent==="HISTORY_COUNT",{});
  record("FINAL-18_WORKOUT_SESSION_PARSE",detectWorkoutLoggingHistoryIntent_("что было на прошлой тренировке спина").intent==="HISTORY_SESSION",{});
  record("FINAL-19_PROGRESSION_PARSE",detectWorkoutLoggingHistoryIntent_("как прогрессирует жим").intent==="PROGRESSION_EXERCISE",{});
  record("FINAL-20_GENERIC_WORKOUT_QUERY",detectWorkoutLoggingHistoryIntent_("что по тренировкам").intent==="HISTORY_LAST",{});

  const workoutRows=[];let sequence=0;const workoutDeps={uuid:function(){sequence++;return "final-"+sequence;},time_zone:function(){return "Europe/Moscow";},format_date:function(date){return new Date(new Date(date).getTime()+3*3600000).toISOString().slice(0,10);},read_log:function(){return {headers:WORKOUT_LOG_SCHEMA.slice(),rows:workoutRows.slice()};},append_atomic:function(rows){Array.prototype.push.apply(workoutRows,rows);return {ok:true,rows_written:rows.length,verified:true};},load_plan:function(){return {ok:true,configured:false,sessions_by_weekday:{}};},create_capture:function(){return {ok:false};},find_capture:function(){return {ok:false};},cancel_capture:function(){return {ok:false};},finalize_capture:function(){return false;}};
  let workoutResult=executeWorkoutIntent_("u1",{intent:"SETS",exercise_text:"жим",count:3,load:100,unit:"kg",reps:7},"final-set",now,{dependencies:workoutDeps,chat_id:"u1"});
  record("FINAL-21_ACTUAL_WORKOUT_FIXTURE",workoutResult.ok===true,workoutResult);
  workoutResult=executeWorkoutIntent_("u1",{intent:"FINISH"},"final-finish",now,{dependencies:workoutDeps,chat_id:"u1"});
  record("FINAL-22_ACTUAL_COMPLETED",workoutResult.code==="SESSION_COMPLETED",workoutResult);
  const progression=routeWorkoutLoggingHistory_({update_id:"final-progress",message:{text:"как прогрессирует жим",from:{id:"u1"},chat:{id:"u1"}}},{now:now,dependencies:workoutDeps});
  record("FINAL-23_PROGRESSION_ROUTED",progression.handled&&progression.code==="PROGRESSION_GUIDANCE",progression);
  record("FINAL-24_PROGRESSION_ACTUAL",/100 кг/.test(progression.message)&&/7\/7\/7/.test(progression.message),progression.message);
  record("FINAL-25_PROGRESSION_CONSERVATIVE",/оставить 100 кг/.test(progression.message)&&/не форсируй/.test(progression.message),progression.message);

  record("FINAL-26_TARGET_READ_PARSE",detectNutritionTargetReadIntent_("Какие у меня цели по КБЖУ?")==="NUTRITION_TARGET_READ",{});
  const targetRead=routeNutritionTargetRead_({message:{text:"Какие у меня цели по КБЖУ?",from:{id:"u1"},chat:{id:"u1"}}},{dependencies:{load_targets:function(){return {ok:true,code:"TARGETS_AVAILABLE",status:"AVAILABLE",targets:{calories:2300,protein:195,fat:70,carbs:225}};}}});
  record("FINAL-27_TARGET_READ_DETERMINISTIC",targetRead.handled&&targetRead.ok&&targetRead.code==="TARGETS_AVAILABLE"&&targetRead.message==="Ваши цели: 2300 ккал | Б 195 г | Ж 70 г | У 225 г.",targetRead);
  record("FINAL-28_TARGET_READ_NO_UPDATE_CAPTURE",detectExplicitNutritionTargetUpdate_("Какие у меня цели по КБЖУ?")===null,{});
  record("FINAL-29_NUTRITION_WEEK_ALIAS",detectNutritionHistoryIntent_("Что я ел за неделю?").scope==="LAST_7_DAYS",{});

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;return {suite:"FINAL_PRODUCT_COMPLETION",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
