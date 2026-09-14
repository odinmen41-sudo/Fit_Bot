function runProactiveCoachingContextTests(){
  const tests=[];
  function record(id,ok,details){tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details});}
  function facts(nutrition,weight){return {local_date:"2026-09-14",nutrition:Object.assign({available:true,status:"AVAILABLE",has_records:true,consumed:{calories:1000,protein:150,fat:40,carbs:100},targets:{calories:2000,protein:200,fat:70,carbs:220}},nutrition||{}),weight:Object.assign({available:true,data_status:"NORMAL",freshness:"FRESH",trend_status:"INSUFFICIENT_DATA",current_weight:100,measurement_age_days:1},weight||{}),training:{available:true,status:"REST_DAY",today_session_name:null,next_workout:null},recovery:{available:true,history_status:"NO_DATA",last_completed_workout:null,sessions_7d:0,sessions_14d:0,training_days_7d:0,training_days_14d:0}};}
  function dashboardDeps(current,calls){return {time_zone:function(){return "Europe/Moscow";},format_date:function(){return "2026-09-14";},build_weight:function(){calls.weight++;return current.weight;},load_consumed:function(){calls.consumed++;return {ok:true,meals_count:current.nutrition.has_records?1:0,consumed:current.nutrition.consumed};},load_targets:function(){calls.targets++;return {ok:true,status:"AVAILABLE",targets:current.nutrition.targets};},build_recovery:function(){calls.recovery++;return {history_status:"NO_DATA",sessions_7d:0,sessions_14d:0,training_days_7d:0,training_days_14d:0,plan_status:"REST_DAY"};},log_error:function(){}};}
  const now=new Date("2026-09-14T19:00:00.000Z");
  let evaluation=evaluateContextualCoachingHint_(facts(),now,"DASHBOARD",{local_hour:12});
  record("PC2-01_DASHBOARD_NO_SIGNAL",evaluation.message===null,evaluation);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:1900,protein:150,fat:40,carbs:100}}),now,"DASHBOARD",{local_hour:12});
  record("PC2-02_DASHBOARD_NEAR",evaluation.selected_signal.key==="CALORIES_NEAR_LIMIT",evaluation);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:2100,protein:20,fat:40,carbs:100}},{freshness:"STALE",measurement_age_days:20}),now,"DASHBOARD",{local_hour:22});
  record("PC2-03_DASHBOARD_ONE_PRIORITY",evaluation.selected_signal.key==="CALORIES_EXCEEDED"&&evaluation.contextual_signals.length===3,evaluation);
  record("PC2-04_APPEND_FORMAT",appendContextualCoachingHint_("Основной ответ",evaluation).indexOf("Основной ответ\n\nПодсказка: ")===0,{});
  record("PC2-05_NO_HINT_UNCHANGED",appendContextualCoachingHint_("Основной ответ",null)==="Основной ответ",{});
  const signals=[proactiveCoachingSignal_("WEIGHT_MEASUREMENT_STALE",{measurement_age_days:10}),proactiveCoachingSignal_("CALORIES_NEAR_LIMIT",{remaining_calories:10})];
  record("PC2-06_DASHBOARD_ALL_SIGNALS",filterProactiveCoachingSignalsForContext_(signals,"DASHBOARD").length===2,{});
  const filtered=filterProactiveCoachingSignalsForContext_(signals,"NUTRITION_LOG_SUCCESS");
  record("PC2-07_NUTRITION_FILTER",filtered.length===1&&filtered[0].key==="CALORIES_NEAR_LIMIT",filtered);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:1000,protein:150,fat:40,carbs:100}},{freshness:"STALE",measurement_age_days:20}),now,"NUTRITION_LOG_SUCCESS",{local_hour:12});
  record("PC2-08_NUTRITION_EXCLUDES_WEIGHT",evaluation.message===null&&evaluation.signals.length===1,evaluation);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:1900,protein:20,fat:40,carbs:100}},{freshness:"STALE",measurement_age_days:20}),now,"NUTRITION_LOG_SUCCESS",{local_hour:22});
  record("PC2-09_FILTER_BEFORE_SELECT",evaluation.selected_signal.key==="CALORIES_NEAR_LIMIT"&&!evaluation.contextual_signals.some(function(s){return s.key==="WEIGHT_MEASUREMENT_STALE";}),evaluation);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:1000,protein:50,fat:40,carbs:100}}),now,"NUTRITION_LOG_SUCCESS",{local_hour:17});
  record("PC2-10_PROTEIN_BEFORE_18_NONE",evaluation.message===null,evaluation);
  evaluation=evaluateContextualCoachingHint_(facts({consumed:{calories:1000,protein:50,fat:40,carbs:100}}),now,"NUTRITION_LOG_SUCCESS",{local_hour:18});
  record("PC2-11_PROTEIN_AFTER_18",evaluation.selected_signal.key==="PROTEIN_FAR_BELOW_TARGET_LATE_DAY",evaluation);
  record("PC2-12_ZERO_SIDE_EFFECTS",evaluation.groq_calls===0&&evaluation.telegram_calls===0&&evaluation.sheet_writes===0&&evaluation.domain_writes===0&&evaluation.pending_capture_writes===0&&!evaluation.production_writes,evaluation);

  let calls={weight:0,consumed:0,targets:0,recovery:0},current=facts({consumed:{calories:1900,protein:150,fat:40,carbs:100}}),route=routeDailyDashboard_({message:{text:"Что у меня сегодня?",from:{id:"u1"}}},{now:now,dependencies:dashboardDeps(current,calls),proactive_options:{local_hour:12}});
  record("PC2-13_DASHBOARD_APPENDS",route.ok&&/\n\nПодсказка: /.test(route.message),route);
  record("PC2-14_DASHBOARD_ONE_BUILD",calls.weight===1&&calls.consumed===1&&calls.targets===1&&calls.recovery===1,calls);
  record("PC2-15_DASHBOARD_MAX_ONE",route.message.split("Подсказка:").length===2,route.message);
  calls={weight:0,consumed:0,targets:0,recovery:0};route=routeDailyDashboard_({message:{text:"Что у меня сегодня?",from:{id:"u1"}}},{now:now,dependencies:dashboardDeps(facts(),calls),proactive_evaluate:function(){throw new Error("pc2");}});
  record("PC2-16_DASHBOARD_FAIL_OPEN",route.ok&&!/Подсказка:/.test(route.message),route);
  record("PC2-17_DASHBOARD_NO_EXTRA_READS",calls.weight===1&&calls.consumed===1&&calls.targets===1&&calls.recovery===1,calls);

  function nutritionEnv(persisted,postFacts){const order=[];const payload={domain:"NUTRITION",schema_version:"c232b2-nutrition-calculation-v1"};return {order:order,selected:{capture:{capture_id:"c1",user_id:"u1",chat_id:"ch",status:"PENDING_CONFIRMATION"},payload:payload},deps:{validate_nutrition_snapshot:function(){return {ok:true};},nutrition_persistence_enabled:function(){return true;},persist_nutrition:function(){order.push("persist");return persisted;},build_dashboard:function(){order.push("facts");return postFacts;},evaluate_contextual:function(f,n,c){order.push("evaluate");return evaluateContextualCoachingHint_(f,n,c,{local_hour:22});},cancel:function(){return {ok:true,code:"CANCELLED"};}}};}
  let env=nutritionEnv({ok:true,code:"NUTRITION_SAVED"},facts({consumed:{calories:1900,protein:150,fat:40,carbs:100}})),saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-18_NUTRITION_SUCCESS_HINT",saved.ok&&/Подсказка:/.test(saved.message),saved);
  record("PC2-19_AFTER_PERSIST_ORDER",env.order.join(",")==="persist,facts,evaluate",env.order);
  record("PC2-20_PRIMARY_PRESERVED",saved.message.indexOf("Данные питания сохранены.")===0,saved.message);
  env=nutritionEnv({ok:true,code:"NUTRITION_SAVED"},facts());saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-21_SUCCESS_NO_SIGNAL_UNCHANGED",saved.message==="Данные питания сохранены.",saved);
  env=nutritionEnv({ok:false,code:"DATA_INTEGRITY_ERROR"},facts({consumed:{calories:2100,protein:50,fat:40,carbs:100}}));saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-22_FAILURE_NO_HINT",!saved.ok&&!/Подсказка:/.test(saved.message)&&env.order.join(",")==="persist",saved);
  env=nutritionEnv({ok:true,code:"NUTRITION_ALREADY_SAVED",idempotent_replay:true},facts({consumed:{calories:2100,protein:50,fat:40,carbs:100}}));saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-23_REPLAY_NO_HINT",saved.ok&&!/Подсказка:/.test(saved.message)&&env.order.join(",")==="persist",saved);
  env=nutritionEnv({ok:true,code:"NUTRITION_SAVED"},facts({consumed:{calories:2100,protein:50,fat:40,carbs:100}}));env.deps.evaluate_contextual=function(){throw new Error("pc2");};saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-24_NUTRITION_FAIL_OPEN",saved.ok&&saved.message==="Данные питания сохранены.",saved);
  env=nutritionEnv({ok:true,code:"NUTRITION_SAVED"},facts({consumed:{calories:2100,protein:50,fat:40,carbs:100}}));saved=handleDomainFactConfirmation_(env.selected,"CANCEL","u1","ch",now,env.deps);
  record("PC2-25_CANCEL_NO_EVALUATION",saved.ok&&!/Подсказка:/.test(saved.message)&&env.order.length===0,saved);
  evaluation=evaluateContextualCoachingHint_(facts(null,{freshness:"STALE",measurement_age_days:12}),now,"DASHBOARD",{local_hour:12});
  record("PC2-26_DASHBOARD_STALE_WEIGHT",evaluation.selected_signal.key==="WEIGHT_MEASUREMENT_STALE"&&/12 дн/.test(evaluation.message),evaluation);
  evaluation=evaluateContextualCoachingHint_(facts(null,{freshness:"FRESH",trend_status:"AVAILABLE",trend:"DOWN",week_delta:-0.7}),now,"DASHBOARD",{local_hour:12});
  record("PC2-27_DASHBOARD_WEIGHT_TREND",evaluation.selected_signal.key==="MEANINGFUL_WEIGHT_TREND"&&/-0,7 кг/.test(evaluation.message),evaluation);
  env=nutritionEnv({ok:true,code:"NUTRITION_SAVED"},facts({consumed:{calories:2100,protein:150,fat:40,carbs:100}}));saved=handleDomainFactConfirmation_(env.selected,"CONFIRM","u1","ch",now,env.deps);
  record("PC2-28_NUTRITION_EXCEEDED",/уже 2100 ккал при цели 2000/.test(saved.message),saved);
  record("PC2-29_POST_MEAL_FACTS",env.order.join(",")==="persist,facts,evaluate"&&/2100 ккал/.test(saved.message),{order:env.order,message:saved.message});
  const allText=tests.map(function(t){return JSON.stringify(t.details||{});}).join(" ");
  record("PC2-30_PRIVACY",!/TELEGRAM_ID|LOGICAL_MEAL_ID|SNAPSHOT_HASH|capture_id/.test(allText),allText);
  record("PC2-31_NO_TRAINING_SIGNALS",!Object.keys(PROACTIVE_COACHING_NUTRITION_SUCCESS_SIGNALS).some(function(k){return /WORKOUT|TRAINING/.test(k);}),PROACTIVE_COACHING_NUTRITION_SUCCESS_SIGNALS);
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;
  return {suite:"PROACTIVE_COACHING_PC2_CONTEXTUAL_HINTS",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
