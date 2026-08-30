function runWeightTrendsTests() {
  const tests = [], now = new Date("2026-08-30T12:00:00.000Z");
  function record(id, passed, details) { tests.push({id:id, status:passed?"PASS":"FAIL", details:passed?{}:details||{}}); }
  function event(id, value, at, user, overrides) { return Object.assign({user_id:user||"u1", category:"body_tracking", key:"weight_event", value:String(value), updated_at:at, confirmation_id:"capture-"+id}, overrides||{}); }
  function format(date) { return new Date(new Date(date).getTime()+3*3600000).toISOString().slice(0,10); }
  function deps(rows, profile) { return {time_zone:function(){return "Europe/Moscow";}, format_date:format, read_memory:function(){return rows||[];}, read_profile:function(){return profile||{};}}; }
  function history(rows, date) { return loadAuthoritativeWeightHistory_("u1", {now:date||now, dependencies:deps(rows)}); }
  function facts(rows, profile, date) { return buildWeightTrendFacts_("u1", {now:date||now, dependencies:deps(rows,profile)}); }
  const d = function(day,hour){return "2026-08-"+String(day).padStart(2,"0")+"T"+String(hour||8).padStart(2,"0")+":00:00.000Z";};

  let result=history([]); record("WT-01_NO_EVENTS",result.status==="NO_DATA"&&result.measurements.length===0,result);
  result=history([event("a",118,d(30))]); record("WT-02_ONE_EVENT",result.status==="NORMAL"&&result.measurements[0].weight_kg===118,result);
  result=history([event("b",117,d(30,10)),event("a",118,d(29))]); record("WT-03_ASCENDING",result.measurements[0].weight_kg===118&&result.measurements[1].weight_kg===117,result);
  let f=facts([event("a",118.4,d(30,5)),event("b",118.1,d(30,10))]); record("WT-04_LATEST_DAILY",f.distinct_measurement_days===1&&f.avg_7d===118.1,f);
  result=history([event("a",118,d(30,5)),event("b",118,d(30,10))]); record("WT-05_SAME_VALUE_VALID",result.status==="NORMAL"&&result.measurements.length===2,result);
  record("WT-06_BAD_NUMBER",history([event("a","bad",d(30))]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-07_RANGE",history([event("a",351,d(30))]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-08_BAD_TIMESTAMP",history([event("a",118,"bad")]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-09_FUTURE",history([event("a",118,"2026-08-31T00:00:00Z")]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-10_CONFIRMATION_REQUIRED",history([event("a",118,d(30),"u1",{confirmation_id:""})]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-11_DUP_CONFIRMATION",history([event("a",118,d(29)),event("b",117,d(30),"u1",{confirmation_id:"capture-a"})]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-12_EQUAL_TIMESTAMP",history([event("a",118,d(30)),event("b",117,d(30))]).status==="DATA_INTEGRITY_ERROR",{});
  record("WT-13_OTHER_USER_IGNORED",history([event("x","bad","bad","u2"),event("a",118,d(30))]).status==="NORMAL",{});
  record("WT-14_OTHER_CATEGORY_IGNORED",history([event("x","bad","bad","u1",{category:"profile"}),event("a",118,d(30))]).status==="NORMAL",{});
  result=history([event("a",118,"2026-08-29T22:30:00Z")]); record("WT-15_TIMEZONE_BOUNDARY",result.measurements[0].local_date==="2026-08-30",result);
  f=facts([event("a",119,d(24)),event("b",118,d(30))]); record("WT-16_7D_TODAY",f.avg_7d===118.5,f);
  record("WT-17_7D_INCLUSIVE",f.delta_7d===-1,f);
  f=facts([event("a",120,d(17)),event("b",118,d(30))]); record("WT-18_14D_INCLUSIVE",f.avg_14d===119&&f.delta_14d===-2,f);
  f=facts([event("a",121,"2026-08-01T08:00:00Z"),event("b",118,d(30))]); record("WT-19_30D_INCLUSIVE",f.avg_30d===119.5&&f.delta_30d===-3,f);
  f=facts([event("a",119,d(29,5)),event("b",117,d(29,15)),event("c",118,d(30))]); record("WT-20_DAILY_ONCE",f.avg_7d===117.5&&f.distinct_measurement_days===2,f);
  record("WT-21_DELTA_DAILY",f.delta_7d===1,f);
  const week=[event("p1",119,d(17)),event("p2",118,d(18)),event("c1",118,d(24)),event("c2",117,d(25))]; f=facts(week); record("WT-22_MATCHED_WEEK",f.previous_matched_week_avg===118.5&&f.current_week_avg===117.5&&f.week_delta===-1,f);
  f=facts([event("p1",119,d(17)),event("p2",118,d(18)),event("c1",117,d(24))],{},new Date("2026-08-24T12:00:00Z")); record("WT-23_MONDAY_MATCH",f.current_week_avg===117&&f.previous_matched_week_avg===119&&f.trend_status==="INSUFFICIENT_DATA",f);
  record("WT-24_SUNDAY_MATCH",weightTrendWeekWindows_(now,weightTrendDependencies_(deps([]))).current.start==="2026-08-24",{});
  record("WT-25_CURRENT_DENSITY",facts([event("p1",119,d(17)),event("p2",118,d(18)),event("c1",117,d(24))]).trend_status==="INSUFFICIENT_DATA",{});
  record("WT-26_PREVIOUS_DENSITY",facts([event("p1",119,d(17)),event("c1",118,d(24)),event("c2",117,d(25))]).trend_status==="INSUFFICIENT_DATA",{});
  record("WT-27_NEG_BOUNDARY",weightTrendDirection_(-0.5)==="STABLE",{});
  record("WT-28_POS_BOUNDARY",weightTrendDirection_(0.5)==="STABLE",{});
  record("WT-29_DOWN",weightTrendDirection_(-0.501)==="DOWN",{});
  record("WT-30_UP",weightTrendDirection_(0.501)==="UP",{});
  f=facts([event("a",118,d(30))]); record("WT-31_FRESH_INSUFFICIENT",f.freshness==="FRESH"&&f.trend_status==="INSUFFICIENT_DATA",f);
  f=facts([event("a",118,d(17))]); record("WT-32_STALE",f.freshness==="STALE"&&f.data_status==="NORMAL",f);
  f=facts([],{profile_current_weight:"118.7"}); let text=formatWeightTrendFacts_(f,{intent:"WEIGHT_CURRENT"}); record("WT-33_PROFILE_ONLY_MESSAGE",/profile|\u043f\u0440\u043e\u0444\u0438\u043b/i.test(text)&&/118,7/.test(text),text);
  record("WT-34_PROFILE_NOT_HISTORY",f.data_status==="NO_DATA"&&f.measurements_count===0&&f.current_weight===null,f);
  f=facts([event("a",115,d(30))],{target_weight:110}); record("WT-35_TARGET_DISTANCE",f.goal.kg_to_goal===5,f);
  f=facts([event("a",115,d(30))],{start_weight:120,target_weight:110}); record("WT-36_LOSS_PROGRESS",f.goal.goal_type==="LOSS"&&f.goal.progress_percent===50,f);
  f=facts([event("a",75,d(30))],{start_weight:70,target_weight:80}); record("WT-37_GAIN_PROGRESS",f.goal.goal_type==="GAIN"&&f.goal.progress_percent===50,f);
  f=facts([event("a",75,d(30))],{start_weight:75,target_weight:75}); record("WT-38_MAINTAIN_SAFE",f.goal.goal_type==="MAINTAIN"&&f.goal.progress_percent===null,f);
  f=facts([event("a",108,d(30))],{start_weight:120,target_weight:110}); record("WT-39_LOSS_EXCEEDED",f.goal.goal_reached===true&&f.goal.progress_percent===100,f);
  f=facts([event("a",82,d(30))],{start_weight:70,target_weight:80}); record("WT-40_GAIN_EXCEEDED",f.goal.goal_reached===true&&f.goal.progress_percent===100,f);
  f=facts([event("a",118,d(30))],{}); record("WT-41_GOAL_MISSING",f.goal.start_weight===null&&f.goal.target_weight===null&&f.goal.goal_type==="UNKNOWN",f);
  let routed=routeWeightTrends_({message:{text:"\u043a\u0430\u043a\u043e\u0439 \u0442\u0440\u0435\u043d\u0434 \u0432\u0435\u0441\u0430?",from:{id:"u1"},chat:{id:"u1"}}},{now:now,dependencies:deps(week)}); record("WT-42_GROQ_ZERO",routed.handled&&routed.groq_calls===0,routed);
  record("WT-43_PRIVACY",!/USER_ID|TELEGRAM_ID|confirmation|AI_MEMORY|session_id|capture-|C21_/.test(routed.message),routed.message);
  record("WT-44_LOGGING_NOT_STOLEN",detectWeightTrendIntent_("\u043c\u043e\u0439 \u0432\u0435\u0441 116 \u043a\u0433")===null,{});
  record("WT-45_GOAL_INTENT",detectWeightTrendIntent_("\u0441\u043a\u043e\u043b\u044c\u043a\u043e \u043e\u0441\u0442\u0430\u043b\u043e\u0441\u044c \u0434\u043e \u0446\u0435\u043b\u0438 \u043f\u043e \u0432\u0435\u0441\u0443?").intent==="WEIGHT_GOAL",{});
  record("WT-46_PERIOD_INTENT",detectWeightTrendIntent_("\u0447\u0442\u043e \u0441 \u0432\u0435\u0441\u043e\u043c \u0437\u0430 14 \u0434\u043d\u0435\u0439?").days===14,{});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;
  return {suite:"WEIGHT_TRENDS_V1",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
