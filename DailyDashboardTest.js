function runDailyDashboardTests() {
  const tests=[];
  function record(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  function weight(overrides){return Object.assign({data_status:"NORMAL",freshness:"FRESH",trend_status:"AVAILABLE",current_weight:116.2,current_date:"2026-09-14",measurement_age_days:0,trend:"DOWN",week_delta:-0.6,goal:{target_weight:108,kg_to_goal:8.2,progress_percent:68}},overrides||{});}
  function consumed(overrides){return Object.assign({ok:true,code:"DAILY_NUTRITION_SUMMARY",date:"2026-09-14",meals_count:1,consumed:{calories:1420,protein:128,fat:48,carbs:116}},overrides||{});}
  function targets(status,values){return {ok:true,code:"TARGETS_AVAILABLE",status:status||"AVAILABLE",targets:Object.assign({calories:2300,protein:195,fat:70,carbs:225},values||{})};}
  function recovery(overrides){return Object.assign({history_status:"NORMAL",last_completed_workout:{date:"2026-09-13",session_name:"спина",days_ago:1,completed_at:"2026-09-13T18:00:00.000Z"},sessions_7d:3,sessions_14d:5,training_days_7d:3,training_days_14d:5,plan_status:"TRAINING_DAY",planned_today:{session_name:"ноги"},next_workout:{date:"2026-09-16",session_name:"грудь",days_away:2}},overrides||{});}
  function build(config){const c=config||{},calls={weight:0,consumed:0,targets:0,recovery:0};const deps={time_zone:function(){return "Europe/Moscow";},format_date:function(date){return c.local_date||"2026-09-14";},build_weight:function(){calls.weight++;if(c.weight_throw)throw new Error("weight");return c.weight||weight();},load_consumed:function(){calls.consumed++;if(c.consumed_throw)throw new Error("nutrition");return c.consumed||consumed();},load_targets:function(){calls.targets++;if(c.targets_throw)throw new Error("targets");return c.targets||targets();},build_recovery:function(){calls.recovery++;if(c.recovery_throw)throw new Error("recovery");return c.recovery||recovery();},log_error:function(){}};return {facts:buildDailyDashboardFacts_("u1",{now:new Date("2026-09-14T00:30:00.000Z"),dependencies:deps}),calls:calls};}

  let result=build(),f=result.facts,text=formatDailyDashboard_(f);
  record("DASH-01_ALL_VALID",f.has_any_useful_section&&!f.has_domain_errors,f);
  record("DASH-02_ONE_CALL_EACH",result.calls.weight===1&&result.calls.consumed===1&&result.calls.targets===1&&result.calls.recovery===1,result.calls);
  record("DASH-03_FULL_NUTRITION",f.nutrition.consumed.calories===1420&&f.nutrition.remaining.calories===880,f.nutrition);
  record("DASH-04_WEIGHT_PROJECTION",f.weight.current_weight===116.2&&f.weight.week_delta===-0.6,f.weight);
  record("DASH-05_TRAINING_FROM_RECOVERY",f.training.status==="TRAINING_DAY"&&f.training.today_session_name==="ноги",f.training);
  record("DASH-06_RECOVERY_NORMAL",f.recovery.sessions_7d===3&&f.recovery.last_completed_workout.days_ago===1,f.recovery);
  record("DASH-07_ORDER",text.indexOf("Тренировка:")<text.indexOf("Питание:")&&text.indexOf("Питание:")<text.indexOf("Вес:")&&text.indexOf("Вес:")<text.indexOf("Последняя тренировка:"),text);

  f=build({weight:weight({data_status:"NO_DATA",freshness:"UNKNOWN",trend_status:"INSUFFICIENT_DATA",current_weight:null,current_date:null,measurement_age_days:null,trend:null,week_delta:null,goal:{}})}).facts;
  record("DASH-08_WEIGHT_NO_DATA",!f.weight.available&&/подтвержд[её]нных измерений пока нет/i.test(formatDailyDashboard_(f)),f.weight);
  record("DASH-09_FRESH_TREND",/Тренд недели: -0,6 кг/.test(formatDailyDashboard_(build().facts)),{});
  f=build({weight:weight({trend_status:"INSUFFICIENT_DATA",trend:null,week_delta:null})}).facts;
  record("DASH-10_FRESH_INSUFFICIENT",f.weight.freshness==="FRESH"&&f.weight.trend_status==="INSUFFICIENT_DATA"&&!/Тренд недели/.test(formatDailyDashboard_(f)),f.weight);
  f=build({weight:weight({freshness:"STALE",measurement_age_days:21,trend_status:"AVAILABLE"})}).facts;text=formatDailyDashboard_(f);
  record("DASH-11_STALE_VISIBLE",/116,2 кг — измерение 21 дн\. назад/.test(text),text);
  record("DASH-12_STALE_TREND_OMITTED",!/Тренд недели/.test(text),text);
  f=build({weight:weight({data_status:"DATA_INTEGRITY_ERROR",current_weight:null})}).facts;
  record("DASH-13_WEIGHT_ERROR_ISOLATED",f.has_domain_errors&&/Вес: сейчас не удалось/.test(formatDailyDashboard_(f))&&f.nutrition.available,f);

  f=build({consumed:consumed({meals_count:0,consumed:{calories:0,protein:0,fat:0,carbs:0}})}).facts;text=formatDailyDashboard_(f);
  record("DASH-14_NUTRITION_NO_RECORDS",f.nutrition.status==="NO_RECORDS"&&/сегодня записей пока нет/.test(text),f.nutrition);
  record("DASH-15_NO_RECORDS_NOT_ZERO",!/0 из 2300/.test(text),text);
  f=build({targets:targets("NOT_CONFIGURED",{calories:null,protein:null,fat:null,carbs:null})}).facts;text=formatDailyDashboard_(f);
  record("DASH-16_NO_TARGETS_CONSUMED",/Питание: 1420 ккал/.test(text)&&!/из 0/.test(text),text);
  record("DASH-17_NO_TARGETS_REMAINING",f.nutrition.remaining.calories===null&&!/Осталось:/.test(text),f.nutrition);
  f=build({targets:targets("PARTIAL",{fat:null,carbs:null})}).facts;text=formatDailyDashboard_(f);
  record("DASH-18_PARTIAL_TARGETS",f.nutrition.target_status==="PARTIAL"&&f.nutrition.remaining.protein===67&&f.nutrition.remaining.fat===null,f.nutrition);
  record("DASH-19_PARTIAL_NO_ZERO",/Б 128\/195/.test(text)&&/Ж 48(?:\s|·)/.test(text)&&!/Ж 48\/0/.test(text),text);
  f=build({consumed:{ok:false,code:"DATA_INTEGRITY_ERROR"}}).facts;
  record("DASH-20_NUTRITION_ERROR_ISOLATED",f.nutrition.status==="UNAVAILABLE"&&/Питание: сейчас не удалось/.test(formatDailyDashboard_(f))&&f.weight.available,f);

  f=build().facts;record("DASH-21_TRAINING_DAY",/Тренировка: ноги/.test(formatDailyDashboard_(f)),f.training);
  f=build({recovery:recovery({plan_status:"REST_DAY",planned_today:null})}).facts;text=formatDailyDashboard_(f);
  record("DASH-22_REST_DAY",/по плану день отдыха/.test(text)&&!/восстанов/.test(text),text);
  f=build({recovery:recovery({plan_status:"PLAN_NOT_CONFIGURED",planned_today:null,next_workout:null})}).facts;text=formatDailyDashboard_(f);
  record("DASH-23_PLAN_NOT_CONFIGURED",/план пока не настроен/.test(text)&&!/по плану день отдыха/.test(text),text);
  f=build({recovery:recovery({plan_status:"DATA_INTEGRITY_ERROR",planned_today:null})}).facts;
  record("DASH-24_TRAINING_ERROR_ISOLATED",f.training.status==="DATA_INTEGRITY_ERROR"&&f.recovery.available&&/Тренировка: сейчас не удалось/.test(formatDailyDashboard_(f)),f);
  f=build({recovery:recovery({history_status:"NO_DATA",last_completed_workout:null,sessions_7d:0,sessions_14d:0,training_days_7d:0,training_days_14d:0})}).facts;
  record("DASH-25_RECOVERY_NO_DATA",/заверш[её]нных тренировок пока нет/i.test(formatDailyDashboard_(f)),f.recovery);
  f=build({recovery:recovery({history_status:"DATA_INTEGRITY_ERROR",last_completed_workout:null})}).facts;
  record("DASH-26_RECOVERY_ERROR_ISOLATED",f.recovery.history_status==="DATA_INTEGRITY_ERROR"&&f.training.available&&/История тренировок: сейчас не удалось/.test(formatDailyDashboard_(f)),f);
  f=build({weight:weight({data_status:"DATA_INTEGRITY_ERROR",current_weight:null}),consumed:{ok:false,code:"DATA_INTEGRITY_ERROR"}}).facts;
  record("DASH-27_TWO_ERRORS",f.has_domain_errors&&!f.weight.available&&!f.nutrition.available&&f.training.available,f);
  f=build({weight:weight({data_status:"NO_DATA",current_weight:null}),consumed:consumed({meals_count:0}),targets:targets("NOT_CONFIGURED",{calories:null,protein:null,fat:null,carbs:null}),recovery:recovery({history_status:"NO_DATA",last_completed_workout:null,plan_status:"PLAN_NOT_CONFIGURED",planned_today:null,next_workout:null})}).facts;text=formatDailyDashboard_(f);
  record("DASH-28_ALL_ABSENT_DISTINCT",/план пока не настроен/.test(text)&&/сегодня записей пока нет/.test(text)&&/подтвержд[её]нных измерений пока нет/i.test(text)&&/заверш[её]нных тренировок пока нет/i.test(text),text);

  f=build({weight_throw:true}).facts;record("DASH-29_WEIGHT_EXCEPTION",f.weight.data_status==="UNAVAILABLE"&&f.nutrition.available&&f.training.available,f);
  f=build({consumed_throw:true}).facts;record("DASH-30_NUTRITION_EXCEPTION",f.nutrition.status==="UNAVAILABLE"&&f.weight.available&&f.training.available,f);
  f=build({recovery_throw:true}).facts;record("DASH-31_RECOVERY_EXCEPTION",f.training.status==="UNAVAILABLE"&&f.recovery.history_status==="UNAVAILABLE"&&f.weight.available&&f.nutrition.available,f);
  f=build({local_date:"2026-09-15"}).facts;record("DASH-32_LOCAL_DATE",f.local_date==="2026-09-15"&&/^Сегодня, 15 сентября/.test(formatDailyDashboard_(f)),f.local_date);
  record("DASH-33_COMPACT_PUBLIC",JSON.stringify(Object.keys(build().facts).sort())===JSON.stringify(["has_any_useful_section","has_domain_errors","local_date","nutrition","recovery","training","weight"].sort()),Object.keys(build().facts));
  record("DASH-34_NO_RAW_COPIES",!Object.prototype.hasOwnProperty.call(build().facts.weight,"goal")&&!Object.prototype.hasOwnProperty.call(build().facts.recovery,"plan_status"),build().facts);

  ["что у меня сегодня","дай сводку на сегодня","как дела на сегодня","какой статус на сегодня","подведи итог за сегодня"].forEach(function(q,index){record("DASH-"+(35+index)+"_INTENT",detectDailyDashboardIntent_(q).intent==="DAILY_DASHBOARD",q);});
  const specific=["что у меня сегодня по тренировке","какая сегодня тренировка","что мне сегодня делать","что я съел сегодня","сколько калорий осталось","какой у меня вес","сравни вес с прошлой неделей","как я восстановился","мой вес 116","запиши 160 на 5","Да","Нет","неизвестная фраза"];
  record("DASH-40_SPECIFIC_NOT_OWNED",specific.every(function(q){return detectDailyDashboardIntent_(q)===null;}),specific.filter(function(q){return detectDailyDashboardIntent_(q)!==null;}));
  const routed=routeDailyDashboard_({message:{text:"сводка на сегодня",from:{id:"u1"},chat:{id:"u1"}}},{now:new Date("2026-09-14T08:00:00Z"),dependencies:{time_zone:function(){return "Europe/Moscow";},format_date:function(){return "2026-09-14";},build_weight:function(){return weight();},load_consumed:function(){return consumed();},load_targets:function(){return targets();},build_recovery:function(){return recovery();}}});
  record("DASH-41_ROUTE",routed.handled&&routed.ok&&routed.code==="DAILY_DASHBOARD",routed);
  record("DASH-42_GROQ_ZERO",routed.groq_calls===0&&routed.sheet_writes===0&&routed.pending_capture_writes===0,routed);
  record("DASH-43_CONCISE",routed.message.length<1000,routed.message.length);
  record("DASH-44_PRIVACY",!/USER_ID|TELEGRAM_ID|confirmation_id|AI_MEMORY|source|schema|session_id|session_key|event_id|u1|DATA_INTEGRITY_ERROR|UNAVAILABLE/.test(routed.message),routed.message);
  record("DASH-45_FORMATTER_NO_READS",result.calls.weight===1&&result.calls.consumed===1&&result.calls.targets===1&&result.calls.recovery===1,result.calls);
  f=build({targets_throw:true}).facts;text=formatDailyDashboard_(f);record("DASH-46_TARGET_EXCEPTION",f.nutrition.available&&f.nutrition.target_status==="UNAVAILABLE"&&f.has_domain_errors&&/Цели по питанию: сейчас не удалось/.test(text),f);
  record("DASH-47_SPECIFIC_OWNER_ALIASES",detectWorkoutPlanIntent_("что мне сегодня делать").intent==="WORKOUT_TODAY"&&detectDailyNutritionQueryIntent_("что я съел сегодня"),{});
  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"UNIFIED_DAILY_DASHBOARD_DASH1",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
