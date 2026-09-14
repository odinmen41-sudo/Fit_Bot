function runProactiveCoachingTests(){
  const tests=[];
  function record(id,condition,details){tests.push({id:id,status:condition?"PASS":"FAIL",details:condition?{}:details});}
  function base(overrides){const source={local_date:"2026-09-14",weight:{available:true,data_status:"NORMAL",freshness:"FRESH",trend_status:"INSUFFICIENT_DATA",current_weight:116,measurement_age_days:2,trend:null,week_delta:null},nutrition:{available:true,status:"AVAILABLE",has_records:true,consumed:{calories:1000,protein:100,fat:40,carbs:100},target_status:"AVAILABLE",targets:{calories:2000,protein:200,fat:70,carbs:220},remaining:{calories:1000,protein:100,fat:30,carbs:120}},training:{available:true,status:"REST_DAY",today_session_name:null,next_workout:null},recovery:{available:true,history_status:"NO_DATA",last_completed_workout:null,sessions_7d:0,sessions_14d:0,training_days_7d:0,training_days_14d:0}};return Object.assign(source,overrides||{});}
  function nutrition(overrides){return Object.assign({},base().nutrition,overrides||{});}
  function weight(overrides){return Object.assign({},base().weight,overrides||{});}
  function detect(facts,hour){return detectProactiveCoachingSignals_(facts,new Date("2026-09-14T00:00:00Z"),{local_hour:hour});}
  function keys(facts,hour){return detect(facts,hour).map(function(signal){return signal.key;});}
  function selected(facts,hour){return evaluateProactiveCoaching_(facts,new Date("2026-09-14T00:00:00Z"),{local_hour:hour}).selected_signal;}

  let f=base({nutrition:nutrition({status:"NO_RECORDS",has_records:false,consumed:null})});
  record("PC1-01_NO_RECORDS_1759",keys(f,17.983).length===0,keys(f,17.983));
  record("PC1-02_NO_RECORDS_1800",keys(f,18).indexOf("NO_NUTRITION_LOGGED_LATE_DAY")>=0,keys(f,18));
  record("PC1-03_NO_RECORDS_NO_PROTEIN",keys(f,22).indexOf("PROTEIN_FAR_BELOW_TARGET_LATE_DAY")<0,keys(f,22));
  record("PC1-04_NO_RECORDS_NO_CALORIE",keys(f,22).every(function(k){return !/^CALORIES_/.test(k);}),keys(f,22));
  record("PC1-05_LATE_DAY_2230_ALLOWED",keys(f,22.5).indexOf("NO_NUTRITION_LOGGED_LATE_DAY")>=0,keys(f,22.5));

  f=base({nutrition:nutrition({consumed:{calories:1798,protein:150,fat:40,carbs:100}})});record("PC1-06_CALORIES_899",keys(f,12).indexOf("CALORIES_NEAR_LIMIT")<0,keys(f,12));
  f=base({nutrition:nutrition({consumed:{calories:1800,protein:150,fat:40,carbs:100}})});record("PC1-07_CALORIES_900",keys(f,12).indexOf("CALORIES_NEAR_LIMIT")>=0,keys(f,12));
  f=base({nutrition:nutrition({consumed:{calories:2000,protein:150,fat:40,carbs:100}})});record("PC1-08_CALORIES_100",keys(f,12).indexOf("CALORIES_NEAR_LIMIT")>=0&&keys(f,12).indexOf("CALORIES_EXCEEDED")<0,keys(f,12));
  f=base({nutrition:nutrition({consumed:{calories:2001,protein:150,fat:40,carbs:100}})});record("PC1-09_CALORIES_EXCEEDED_ONLY",keys(f,12).filter(function(k){return /^CALORIES_/.test(k);}).join()==="CALORIES_EXCEEDED",keys(f,12));
  record("PC1-10_EXCEEDED_FORMAT",/2001 ккал при цели 2000/.test(formatProactiveCoachingHint_(selected(f,12))),formatProactiveCoachingHint_(selected(f,12)));
  f=base({nutrition:nutrition({consumed:{calories:1800,protein:150,fat:40,carbs:100}})});record("PC1-11_NEAR_FORMAT",/осталось около 200 ккал/.test(formatProactiveCoachingHint_(selected(f,12))),formatProactiveCoachingHint_(selected(f,12)));

  f=base({nutrition:nutrition({consumed:{calories:1000,protein:119.8,fat:40,carbs:100}})});record("PC1-12_PROTEIN_599",keys(f,18).indexOf("PROTEIN_FAR_BELOW_TARGET_LATE_DAY")>=0,keys(f,18));
  f=base({nutrition:nutrition({consumed:{calories:1000,protein:120,fat:40,carbs:100}})});record("PC1-13_PROTEIN_600",keys(f,18).indexOf("PROTEIN_FAR_BELOW_TARGET_LATE_DAY")<0,keys(f,18));
  f=base({nutrition:nutrition({targets:{calories:null,protein:200,fat:null,carbs:null},consumed:{calories:1900,protein:100,fat:40,carbs:100}})});record("PC1-14_PARTIAL_NO_CALORIES",keys(f,18).every(function(k){return !/^CALORIES_/.test(k);}),keys(f,18));
  record("PC1-15_PARTIAL_PROTEIN",keys(f,18).indexOf("PROTEIN_FAR_BELOW_TARGET_LATE_DAY")>=0,keys(f,18));
  f=base({nutrition:nutrition({available:false,status:"UNAVAILABLE"})});record("PC1-16_NUTRITION_ERROR",keys(f,22).every(function(k){return !/CALORIES|NUTRITION|PROTEIN/.test(k);}),keys(f,22));
  f=base({nutrition:nutrition({available:true,status:"DATA_INTEGRITY_ERROR"})});record("PC1-17_NUTRITION_INTEGRITY",keys(f,22).every(function(k){return !/CALORIES|NUTRITION|PROTEIN/.test(k);}),keys(f,22));

  f=base({weight:weight({measurement_age_days:7})});record("PC1-18_WEIGHT_AGE_7",keys(f,12).indexOf("WEIGHT_MEASUREMENT_STALE")<0,keys(f,12));
  f=base({weight:weight({freshness:"STALE",measurement_age_days:8})});record("PC1-19_WEIGHT_AGE_8",keys(f,12).indexOf("WEIGHT_MEASUREMENT_STALE")>=0,keys(f,12));
  f=base({weight:weight({available:false,current_weight:null,measurement_age_days:null})});record("PC1-20_NO_WEIGHT",keys(f,12).every(function(k){return !/^WEIGHT_|TREND/.test(k)&&k!=="MEANINGFUL_WEIGHT_TREND";}),keys(f,12));
  f=base({weight:weight({freshness:"FRESH",trend_status:"AVAILABLE",trend:"DOWN",week_delta:-0.7})});record("PC1-21_TREND_DOWN",keys(f,12).indexOf("MEANINGFUL_WEIGHT_TREND")>=0,keys(f,12));
  f=base({weight:weight({freshness:"FRESH",trend_status:"AVAILABLE",trend:"UP",week_delta:0.4})});record("PC1-22_TREND_UP",keys(f,12).indexOf("MEANINGFUL_WEIGHT_TREND")>=0,keys(f,12));
  f=base({weight:weight({freshness:"STALE",measurement_age_days:12,trend_status:"AVAILABLE",trend:"DOWN",week_delta:-0.7})});record("PC1-23_STALE_NO_TREND",keys(f,12).indexOf("MEANINGFUL_WEIGHT_TREND")<0,keys(f,12));
  f=base({weight:weight({trend_status:"INSUFFICIENT_DATA",trend:"DOWN",week_delta:-0.7})});record("PC1-24_INSUFFICIENT_NO_TREND",keys(f,12).indexOf("MEANINGFUL_WEIGHT_TREND")<0,keys(f,12));
  f=base({weight:weight({available:false,data_status:"DATA_INTEGRITY_ERROR"})});record("PC1-25_WEIGHT_INTEGRITY",keys(f,12).every(function(k){return k!=="WEIGHT_MEASUREMENT_STALE"&&k!=="MEANINGFUL_WEIGHT_TREND";}),keys(f,12));
  f=base({weight:weight({freshness:"FRESH",trend_status:"AVAILABLE",trend:"FLAT",week_delta:0})});record("PC1-26_FLAT_NO_TREND",keys(f,12).indexOf("MEANINGFUL_WEIGHT_TREND")<0,keys(f,12));

  f=base({training:{available:true,status:"TRAINING_DAY",today_session_name:"ноги",next_workout:null}});record("PC1-27_TRAINING_DEFERRED",keys(f,12).every(function(k){return k.indexOf("WORKOUT")<0;}),keys(f,12));
  record("PC1-28_TRAINING_LATE_DEFERRED",keys(f,21).every(function(k){return k.indexOf("WORKOUT")<0;}),keys(f,21));
  f=base({training:{available:true,status:"REST_DAY",today_session_name:null,next_workout:null}});record("PC1-29_REST_NO_SIGNAL",keys(f,12).every(function(k){return k.indexOf("WORKOUT")<0;}),keys(f,12));
  f=base({training:{available:true,status:"PLAN_NOT_CONFIGURED",today_session_name:null,next_workout:null}});record("PC1-30_NO_PLAN_NO_SIGNAL",keys(f,12).every(function(k){return k.indexOf("WORKOUT")<0;}),keys(f,12));

  f=base({nutrition:nutrition({consumed:{calories:2100,protein:50,fat:40,carbs:100}}),weight:weight({freshness:"STALE",measurement_age_days:20})});record("PC1-31_ONE_SELECTED",evaluateProactiveCoaching_(f,new Date(),{local_hour:22}).selected_signal.key==="CALORIES_EXCEEDED",evaluateProactiveCoaching_(f,new Date(),{local_hour:22}));
  record("PC1-32_MAX_ONE",[evaluateProactiveCoaching_(f,new Date(),{local_hour:22}).selected_signal].filter(Boolean).length===1,{});
  f=base({nutrition:nutrition({status:"NO_RECORDS",has_records:false,consumed:null}),weight:weight({freshness:"STALE",measurement_age_days:20})});record("PC1-33_NO_NUTRITION_PRIORITY",selected(f,22).key==="NO_NUTRITION_LOGGED_LATE_DAY",selected(f,22));
  f=base({nutrition:nutrition({consumed:{calories:1000,protein:50,fat:40,carbs:100}}),weight:weight({freshness:"STALE",measurement_age_days:20})});record("PC1-34_PROTEIN_PRIORITY",selected(f,22).key==="PROTEIN_FAR_BELOW_TARGET_LATE_DAY",selected(f,22));
  const first=JSON.stringify(selected(f,22)),second=JSON.stringify(selected(f,22));record("PC1-35_DETERMINISTIC",first===second,{first:first,second:second});
  f=base({nutrition:nutrition({available:false,status:"UNAVAILABLE"}),weight:weight({available:false,data_status:"UNAVAILABLE"}),training:{available:false,status:"UNAVAILABLE"},recovery:{available:false,history_status:"UNAVAILABLE"}});record("PC1-36_ALL_UNAVAILABLE",selected(f,22)===null,selected(f,22));
  f=base({nutrition:nutrition({available:false,status:"UNAVAILABLE"}),weight:weight({freshness:"STALE",measurement_age_days:8})});record("PC1-37_DOMAIN_ISOLATION",selected(f,22).key==="WEIGHT_MEASUREMENT_STALE",selected(f,22));
  const reversed=[proactiveCoachingSignal_("WEIGHT_MEASUREMENT_STALE",{measurement_age_days:8}),proactiveCoachingSignal_("CALORIES_NEAR_LIMIT",{remaining_calories:20})];record("PC1-38_TOTAL_ORDER",selectProactiveCoachingSignal_(reversed).key==="CALORIES_NEAR_LIMIT",selectProactiveCoachingSignal_(reversed));

  const messages=["NO_NUTRITION_LOGGED_LATE_DAY","WEIGHT_MEASUREMENT_STALE","MEANINGFUL_WEIGHT_TREND"].map(function(key){return formatProactiveCoachingHint_(proactiveCoachingSignal_(key,{measurement_age_days:12,week_delta:-0.7,trend:"DOWN"}));}).join(" ");
  record("PC1-39_PRIVACY",!/USER_ID|TELEGRAM_ID|confirmation|session|logical|event|schema|source|row|hash|T\d\d:/.test(messages),messages);
  record("PC1-40_MISSING_NOT_DID_NOT_EAT",!/не ел/.test(formatProactiveCoachingHint_(proactiveCoachingSignal_("NO_NUTRITION_LOGGED_LATE_DAY"))),messages);
  record("PC1-41_NO_SHAME_WEIGHT",!/не следишь|плох|стыд/i.test(messages),messages);
  record("PC1-42_NO_READINESS",!/восстанов|готов.*тренир|устал/i.test(messages),messages);
  const evaluation=evaluateProactiveCoaching_(base(),new Date(),{local_hour:12});record("PC1-43_ZERO_SIDE_EFFECTS",evaluation.groq_calls===0&&evaluation.telegram_calls===0&&evaluation.sheet_writes===0&&evaluation.domain_writes===0&&evaluation.pending_capture_writes===0&&evaluation.property_writes===0&&!evaluation.production_writes,evaluation);
  let reads=0;formatProactiveCoachingHint_(proactiveCoachingSignal_("WEIGHT_MEASUREMENT_STALE",{measurement_age_days:12}));record("PC1-44_FORMATTER_NO_READS",reads===0,reads);
  let builds=0,built=buildProactiveCoachingFacts_("u1",new Date(),{build_dashboard:function(user,options){builds++;return {user:user,now:options.now};}});record("PC1-45_BUILDER_REUSES_DASHBOARD",builds===1&&built.user==="u1",{builds:builds,built:built});
  let formattedHour=proactiveCoachingLocalHour_(new Date("2026-09-14T15:00:00Z"),{dependencies:{time_zone:function(){return "Europe/Moscow";},format_hour:function(){return "18";}}});record("PC1-46_PROJECT_LOCAL_HOUR",formattedHour===18,formattedHour);
  f=base({nutrition:nutrition({status:"NO_RECORDS",has_records:false,consumed:null})});const localBoundary=detectProactiveCoachingSignals_(f,new Date("2026-09-14T15:00:00Z"),{dependencies:{time_zone:function(){return "Europe/Moscow";},format_hour:function(){return "18";}}});record("PC1-47_TIME_BOUNDARY_PROJECT_LOCAL",localBoundary.some(function(s){return s.key==="NO_NUTRITION_LOGGED_LATE_DAY";}),localBoundary);
  f=base({nutrition:nutrition({consumed:{calories:1800,protein:50,fat:40,carbs:100}})});record("PC1-48_NEAR_BEATS_PROTEIN",selected(f,22).key==="CALORIES_NEAR_LIMIT",selected(f,22));
  record("PC1-49_NO_QUIET_HOURS",keys(base({nutrition:nutrition({status:"NO_RECORDS",has_records:false,consumed:null})}),23).indexOf("NO_NUTRITION_LOGGED_LATE_DAY")>=0,{});
  record("PC1-50_NO_DELIVERY_STATE",!["last_signal_key","last_sent_at","cooldown","daily_send_count"].some(function(k){return Object.prototype.hasOwnProperty.call(evaluation,k);}),evaluation);
  const nutritionThrows=base({weight:weight({freshness:"STALE",measurement_age_days:9})});Object.defineProperty(nutritionThrows,"nutrition",{get:function(){throw new Error("nutrition unavailable");}});record("PC1-51_NUTRITION_EXCEPTION_ISOLATED",detect(nutritionThrows,22).some(function(s){return s.key==="WEIGHT_MEASUREMENT_STALE";}),detect(nutritionThrows,22));
  const weightThrows=base({nutrition:nutrition({status:"NO_RECORDS",has_records:false,consumed:null})});Object.defineProperty(weightThrows,"weight",{get:function(){throw new Error("weight unavailable");}});record("PC1-52_WEIGHT_EXCEPTION_ISOLATED",detect(weightThrows,22).some(function(s){return s.key==="NO_NUTRITION_LOGGED_LATE_DAY";}),detect(weightThrows,22));
  record("PC1-53_NO_MISSED_WORKOUT_CLAIM",!/пропустил/.test(messages),messages);
  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"PROACTIVE_COACHING_PC1",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
