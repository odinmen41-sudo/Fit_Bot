function runRecoveryFactsTests(){
  const tests=[],now=new Date("2026-08-30T12:00:00Z");
  function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  function fmt(date){return new Date(new Date(date).getTime()+3*3600000).toISOString().slice(0,10);}
  function session(name,start,complete,status){return {display_name:name||"\u0441\u043f\u0438\u043d\u0430",started_at:new Date(start),completed_at:complete?new Date(complete):null,status:status||"COMPLETED",sets:[],skipped:[]};}
  function plan(status){return {ok:status!=="DATA_INTEGRITY_ERROR",status:status,workout:status==="TRAINING_DAY"?{display_name:"\u0441\u043f\u0438\u043d\u0430"}:null,next_workout:status==="PLAN_NOT_CONFIGURED"?null:{local_date:"2026-09-01",workout:{display_name:"\u043d\u043e\u0433\u0438"}}};}
  function facts(sessions,planStatus){return buildRecoveryFacts_("u1",{now:now,dependencies:{time_zone:function(){return "Europe/Moscow";},format_date:fmt,load_history:function(){return sessions==="ERROR"?{ok:false,code:"DATA_INTEGRITY_ERROR"}:{ok:true,sessions:sessions||[]};},resolve_plan:function(){return plan(planStatus||"PLAN_NOT_CONFIGURED");}}});}
  let f=facts([]);rec("RC-01_NO_HISTORY",f.history_status==="NO_DATA"&&f.last_completed_workout===null,f);
  f=facts([session("\u0441\u043f\u0438\u043d\u0430","2026-08-29T20:00:00Z","2026-08-29T21:00:00Z")]);rec("RC-02_ONE_COMPLETED",f.history_status==="NORMAL"&&f.sessions_7d===1,f);
  f=facts([session("a","2026-08-28T10:00:00Z","2026-08-28T11:00:00Z"),session("b","2026-08-29T10:00:00Z","2026-08-29T11:00:00Z")]);rec("RC-03_MULTIPLE",f.sessions_7d===2,f);
  f=facts([session("a","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z"),session("b","2026-08-29T12:00:00Z","2026-08-29T13:00:00Z")]);rec("RC-04_SAME_DAY",f.sessions_7d===2&&f.training_days_7d===1,f);
  f=facts([session("a","2026-08-29T08:00:00Z",null,"IN_PROGRESS")]);rec("RC-05_IN_PROGRESS_EXCLUDED",f.sessions_7d===0&&f.history_status==="NO_DATA",f);
  f=facts([{display_name:"a",started_at:new Date("2026-08-29T08:00:00Z"),completed_at:new Date("2026-08-29T09:00:00Z"),status:"COMPLETED",sets:[{revision:2}],skipped:[]}]);rec("RC-06_EFFECTIVE_ALREADY_RESOLVED",f.sessions_7d===1,f);
  f=facts([{display_name:"a",started_at:new Date("2026-08-29T08:00:00Z"),completed_at:new Date("2026-08-29T09:00:00Z"),status:"COMPLETED",sets:[],skipped:[{exercise_name:"x"}]}]);rec("RC-07_SKIP_IGNORED",f.sessions_7d===1,f);
  f=facts("ERROR","REST_DAY");rec("RC-08_HISTORY_ERROR",f.history_status==="DATA_INTEGRITY_ERROR",f);
  f=facts([],"TRAINING_DAY");rec("RC-09_TRAINING_DAY",f.plan_status==="TRAINING_DAY"&&f.planned_today.session_name==="\u0441\u043f\u0438\u043d\u0430",f);
  f=facts([],"REST_DAY");rec("RC-10_REST_DAY",f.plan_status==="REST_DAY",f);
  f=facts([],"PLAN_NOT_CONFIGURED");rec("RC-11_PLAN_MISSING",f.plan_status==="PLAN_NOT_CONFIGURED",f);
  f=facts([],"DATA_INTEGRITY_ERROR");rec("RC-12_PLAN_ERROR",f.plan_status==="DATA_INTEGRITY_ERROR",f);
  f=facts([session("a","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z")],"DATA_INTEGRITY_ERROR");rec("RC-13_HISTORY_VALID_PLAN_BAD",f.history_status==="NORMAL"&&f.plan_status==="DATA_INTEGRITY_ERROR",f);
  f=facts("ERROR","TRAINING_DAY");rec("RC-14_HISTORY_BAD_PLAN_VALID",f.history_status==="DATA_INTEGRITY_ERROR"&&f.plan_status==="TRAINING_DAY",f);
  f=facts([session("a","2026-08-24T08:00:00Z","2026-08-24T09:00:00Z"),session("b","2026-08-30T08:00:00Z","2026-08-30T09:00:00Z")]);rec("RC-15_7D_INCLUSIVE",f.sessions_7d===2,f);
  f=facts([session("a","2026-08-17T08:00:00Z","2026-08-17T09:00:00Z"),session("b","2026-08-30T08:00:00Z","2026-08-30T09:00:00Z")]);rec("RC-16_14D_INCLUSIVE",f.sessions_14d===2,f);
  rec("RC-17_DAYS_DISTINCT",f.training_days_14d===2,f);
  f=facts([session("a","2026-08-29T22:30:00Z","2026-08-29T23:30:00Z")]);rec("RC-18_MIDNIGHT_LOCAL",f.last_completed_workout.date==="2026-08-30",f);
  f=facts([session("old","2026-08-28T08:00:00Z","2026-08-28T09:00:00Z"),session("new","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z")]);rec("RC-19_LAST_SELECTION",f.last_completed_workout.session_name==="new",f);
  f=facts([session("a","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z"),session("b","2026-08-29T10:00:00Z","2026-08-29T09:00:00Z")]);rec("RC-20_TIE_FAIL_CLOSED",f.history_status==="DATA_INTEGRITY_ERROR",f);
  rec("RC-21_WORKOUT_TODAY_UNCHANGED",detectRecoveryIntent_("\u0447\u0442\u043e \u0443 \u043c\u0435\u043d\u044f \u0441\u0435\u0433\u043e\u0434\u043d\u044f \u043f\u043e \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0435")===null,{});
  rec("RC-22_WORKOUT_HISTORY_UNCHANGED",detectRecoveryIntent_("\u043f\u043e\u043a\u0430\u0436\u0438 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044e\u044e \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0443")===null,{});
  rec("RC-23_ROUTING",detectRecoveryIntent_("\u0447\u0442\u043e \u0443 \u043c\u0435\u043d\u044f \u043f\u043e \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044e?").intent==="RECOVERY_CONTEXT",{});
  const routed=routeRecoveryFacts_({message:{text:"\u043a\u043e\u0433\u0434\u0430 \u0431\u044b\u043b\u0430 \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044f\u044f \u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0430?",from:{id:"u1"},chat:{id:"u1"}}},{now:now,dependencies:{time_zone:function(){return "Europe/Moscow";},format_date:fmt,load_history:function(){return {ok:true,sessions:[session("\u0441\u043f\u0438\u043d\u0430","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z")]};},resolve_plan:function(){return plan("REST_DAY");}}});
  rec("RC-24_GROQ_ZERO",routed.handled&&routed.groq_calls===0,routed);
  rec("RC-25_PRIVACY",!/USER_ID|TELEGRAM_ID|session_id|session_key|exercise_key|u1|SCHEMA|SOURCE/.test(routed.message),routed.message);
  const text=formatRecoveryFacts_(facts([session("a","2026-08-29T08:00:00Z","2026-08-29T09:00:00Z")],"REST_DAY"),{intent:"RECOVERY_CONTEXT"});rec("RC-26_PHYSIO_BOUNDARY",/\u0444\u0438\u0437\u0438\u043e\u043b\u043e\u0433/i.test(text)&&/\u0441\u043e\u043d/.test(text),text);
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"RECOVERY_FACTS_V1",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
