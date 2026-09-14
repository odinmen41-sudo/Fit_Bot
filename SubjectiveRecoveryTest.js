function runSubjectiveRecoveryTests(){
  const tests=[],now=new Date("2026-09-14T12:00:00.000Z");
  function rec(id,ok,details){tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}});}
  function deps(extra){return Object.assign({time_zone:function(){return "Europe/Moscow";},format_date:function(date){const shifted=new Date(date.getTime()+3*3600000);return shifted.toISOString().slice(0,10);}},extra||{});}
  function event(id,key,reported,metrics,user){const value={schema_version:SUBJECTIVE_RECOVERY_SCHEMA_VERSION,event_id:id,idempotency_key:key,user_id:user||"u1",reported_at:reported||"2026-09-14T08:00:00.000Z",local_date:"2026-09-14",sleep_duration_hours:"",sleep_quality:"",fatigue:"",soreness:"",stress:"",wellbeing:"",readiness:"",source:SUBJECTIVE_RECOVERY_SOURCE,created_at:"2026-09-14T08:01:00.000Z"},source=metrics===undefined?{fatigue:5}:metrics;Object.keys(source).forEach(function(k){value[k]=source[k];});return value;}
  function table(events,headers){return {headers:headers||SUBJECTIVE_RECOVERY_SCHEMA.slice(),rows:(events||[]).map(subjectiveRecoveryRecordValues_)};}
  function read(events,at,headers,user){return loadAuthoritativeSubjectiveRecovery_(user||"u1",{now:at||now,table:table(events,headers),dependencies:deps()});}
  function memory(initial,flags){const env={rows:(initial||[]).map(subjectiveRecoveryRecordValues_),writes:0,reads:0,releases:0,flags:flags||{}};env.dependencies=deps({read_table:function(){return {headers:SUBJECTIVE_RECOVERY_SCHEMA.slice(),rows:env.rows.map(function(r){return r.slice();})};},append_row:function(values){env.writes++;env.rows.push(values.slice());return env.rows.length+1;},read_row:function(row){env.reads++;return env.flags.unreadable?null:env.rows[row-2].slice();},lock:function(){return {tryLock:function(){return env.flags.locked!==false;},releaseLock:function(){env.releases++;}};}});return env;}
  function payload(id,key,metrics,reported){return Object.assign({event_id:id,idempotency_key:key,reported_at:reported||"2026-09-14T08:00:00.000Z"},metrics||{fatigue:5});}

  rec("SR1-01_EXACT_SCHEMA",validateSubjectiveRecoverySchema_(SUBJECTIVE_RECOVERY_SCHEMA.slice()),{});
  rec("SR1-02_MISSING_COLUMN",!validateSubjectiveRecoverySchema_(SUBJECTIVE_RECOVERY_SCHEMA.slice(0,-1)),{});
  const reordered=SUBJECTIVE_RECOVERY_SCHEMA.slice();reordered.reverse();rec("SR1-03_REORDERED_REJECTED",!validateSubjectiveRecoverySchema_(reordered),{});
  rec("SR1-04_EXTRA_REJECTED",!validateSubjectiveRecoverySchema_(SUBJECTIVE_RECOVERY_SCHEMA.concat(["EXTRA"])),{});
  rec("SR1-05_ONE_METRIC",read([event("e1","k1",null,{fatigue:5})]).data_status==="NORMAL",{});
  rec("SR1-06_MULTI_METRIC",read([event("e1","k1",null,{fatigue:5,stress:7,sleep_duration_hours:6.5})]).metrics.stress.value===7,{});
  rec("SR1-07_ALL_BLANK_REJECTED",read([event("e1","k1",null,{})]).data_status==="DATA_INTEGRITY_ERROR",{});
  let r=read([event("e1","k1",null,{fatigue:0})]);rec("SR1-08_ZERO_PRESERVED",r.metrics.fatigue.status==="FRESH"&&r.metrics.fatigue.value===0,r);
  rec("SR1-09_SCALE_0",read([event("e1","k1",null,{readiness:0})]).data_status==="NORMAL",{});
  rec("SR1-10_SCALE_10",read([event("e1","k1",null,{sleep_quality:10})]).data_status==="NORMAL",{});
  rec("SR1-11_SCALE_NEGATIVE",read([event("e1","k1",null,{stress:-1})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-12_SCALE_11",read([event("e1","k1",null,{stress:11})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-13_SCALE_DECIMAL",read([event("e1","k1",null,{stress:7.5})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-14_SLEEP_0",read([event("e1","k1",null,{sleep_duration_hours:0})]).metrics.sleep_duration_hours.value===0,{});
  rec("SR1-15_SLEEP_6_5",read([event("e1","k1",null,{sleep_duration_hours:6.5})]).metrics.sleep_duration_hours.value===6.5,{});
  rec("SR1-16_SLEEP_18",read([event("e1","k1",null,{sleep_duration_hours:18})]).data_status==="NORMAL",{});
  rec("SR1-17_SLEEP_OVER_18",read([event("e1","k1",null,{sleep_duration_hours:18.1})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-18_INVALID_TIMESTAMP",read([event("e1","k1","bad",{fatigue:5})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-19_FUTURE_TIMESTAMP",read([event("e1","k1","2026-09-14T13:00:00.000Z",{fatigue:5})]).data_status==="DATA_INTEGRITY_ERROR",{});
  const wrongDate=event("e1","k1",null,{fatigue:5});wrongDate.local_date="2026-09-13";rec("SR1-20_LOCAL_DATE_MISMATCH",read([wrongDate]).data_status==="DATA_INTEGRITY_ERROR",{});

  const malformedOther=event("bad","bad",null,{fatigue:99},"u2");r=read([event("e1","k1"),malformedOther]);rec("SR1-21_OTHER_USER_MALFORMED_IGNORED",r.data_status==="NORMAL",r);
  rec("SR1-22_CURRENT_USER_MALFORMED",read([event("bad","bad",null,{fatigue:99})]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-23_NO_USER_ROWS",read([event("e2","k2",null,{stress:9},"u2")]).data_status==="NO_DATA",{});
  rec("SR1-24_NO_CROSS_USER_VALUE",read([event("e2","k2",null,{stress:9},"u2")]).metrics.stress.value===null,{});
  rec("SR1-25_UNKNOWN_USER_SCHEMA",read([Object.assign(event("e1","k1"),{schema_version:"future"})]).data_status==="DATA_INTEGRITY_ERROR",{});

  const morning=event("e1","k1","2026-09-14T05:00:00.000Z",{sleep_duration_hours:5.5,fatigue:8,stress:6}),afternoon=event("e2","k2","2026-09-14T11:00:00.000Z",{fatigue:5}),evening=event("e3","k3","2026-09-14T15:00:00.000Z",{stress:8,wellbeing:4});
  r=read([morning,afternoon,evening],new Date("2026-09-14T18:00:00.000Z"));
  rec("SR1-26_LATEST_FATIGUE",r.metrics.fatigue.value===5,r);
  rec("SR1-27_SLEEP_RETAINED",r.metrics.sleep_duration_hours.value===5.5,r);
  rec("SR1-28_LATEST_STRESS",r.metrics.stress.value===8,r);
  rec("SR1-29_WELLBEING_INDEPENDENT",r.metrics.wellbeing.value===4,r);
  rec("SR1-30_MISSING_METRIC",r.metrics.readiness.status==="MISSING"&&r.metrics.readiness.value===null,r);
  const yesterday=event("old","old","2026-09-13T18:00:00.000Z",{stress:9});yesterday.local_date="2026-09-13";r=read([yesterday]);rec("SR1-31_YESTERDAY_STALE",r.metrics.stress.status==="STALE"&&r.metrics.stress.value===9,r);
  rec("SR1-32_TODAY_FRESH",read([event("e1","k1")]).metrics.fatigue.status==="FRESH",{});
  rec("SR1-33_NEXT_DAY_TRANSITION",read([event("e1","k1")],new Date("2026-09-15T08:00:00.000Z")).metrics.fatigue.status==="STALE",{});
  const sameA=event("a","a",null,{fatigue:7}),sameB=event("b","b",null,{stress:4});rec("SR1-34_SAME_TIME_DIFFERENT_METRICS",read([sameA,sameB]).data_status==="NORMAL",{});
  const sameC=event("c","c",null,{fatigue:4});rec("SR1-35_SAME_METRIC_TIE",read([sameA,sameC]).data_status==="DATA_INTEGRITY_ERROR",{});
  rec("SR1-36_NOT_ROW_ORDER",read([afternoon,morning],new Date("2026-09-14T18:00:00.000Z")).metrics.fatigue.value===5,{});

  let env=memory(),write=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k1",{fatigue:5}),{now:now,dependencies:env.dependencies});
  rec("SR1-37_WRITER_APPENDS",write.ok&&write.code==="CHECKIN_APPENDED"&&env.writes===1,write);
  rec("SR1-38_DURABLE_READBACK",write.verified===true&&env.reads===1,write);
  let replay=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k1",{fatigue:5}),{now:now,dependencies:env.dependencies});rec("SR1-39_IDENTICAL_REPLAY",replay.ok&&replay.idempotent_replay&&env.writes===1,replay);
  let conflict=appendSubjectiveRecoveryCheckin_("u1",payload("e2","k1",{fatigue:6}),{now:now,dependencies:env.dependencies});rec("SR1-40_IDEMPOTENCY_CONFLICT",!conflict.ok&&conflict.code==="IDEMPOTENCY_CONFLICT"&&env.writes===1,conflict);
  conflict=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k2",{fatigue:6}),{now:now,dependencies:env.dependencies});rec("SR1-41_EVENT_ID_CONFLICT",!conflict.ok&&conflict.code==="EVENT_ID_CONFLICT",conflict);
  write=appendSubjectiveRecoveryCheckin_("u1",payload("e2","k2",{fatigue:3},"2026-09-14T10:00:00.000Z"),{now:now,dependencies:env.dependencies});rec("SR1-42_DISTINCT_OBSERVATION",write.ok&&env.rows.length===2,write);
  rec("SR1-43_DISTINCT_LATEST",loadAuthoritativeSubjectiveRecovery_("u1",{now:now,table:{headers:SUBJECTIVE_RECOVERY_SCHEMA.slice(),rows:env.rows},dependencies:deps()}).metrics.fatigue.value===3,{});
  env=memory([], {unreadable:true});write=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k1"),{now:now,dependencies:env.dependencies});rec("SR1-44_NO_FALSE_SUCCESS",!write.ok&&write.code==="PERSISTENCE_READBACK_FAILED",write);
  env=memory([], {locked:false});write=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k1"),{now:now,dependencies:env.dependencies});rec("SR1-45_LOCK_REQUIRED",!write.ok&&write.code==="LOCK_TIMEOUT"&&env.writes===0,write);
  env=memory();write=appendSubjectiveRecoveryCheckin_("u1",payload("e1","k1",{}),{now:now,dependencies:env.dependencies});rec("SR1-46_WRITER_REJECTS_EMPTY",!write.ok&&env.writes===0,write);

  const projection=read([event("private-event","private-key",null,{fatigue:5})]),json=JSON.stringify(projection);
  rec("SR1-47_NO_USER_ID",json.indexOf("u1")<0,json);
  rec("SR1-48_NO_EVENT_ID",json.indexOf("private-event")<0,json);
  rec("SR1-49_NO_IDEMPOTENCY_KEY",json.indexOf("private-key")<0,json);
  rec("SR1-50_NO_SOURCE",json.indexOf(SUBJECTIVE_RECOVERY_SOURCE)<0,json);
  rec("SR1-51_NO_SCHEMA_METADATA",json.indexOf(SUBJECTIVE_RECOVERY_SCHEMA_VERSION)<0,json);
  rec("SR1-52_ZERO_SIDE_EFFECTS",projection.groq_calls===undefined&&projection.telegram_calls===undefined,projection);
  rec("SR1-53_CLOSED_RECOVERY",String(buildRecoveryFacts_).indexOf("SubjectiveRecovery")<0,{});
  rec("SR1-54_CLOSED_DASHBOARD",String(buildDailyDashboardFacts_).indexOf("SubjectiveRecovery")<0,{});
  rec("SR1-55_CLOSED_PROACTIVE",String(detectProactiveCoachingSignals_).indexOf("SubjectiveRecovery")<0,{});
  rec("SR1-56_NO_ROUTE",typeof routeSubjectiveRecovery_==="undefined",{});
  rec("SR1-57_SHEET_NAME",SUBJECTIVE_RECOVERY_SHEET==="Recovery_Checkin",{});
  rec("SR1-58_PARTIAL_CHECKIN",read([event("e1","k1",null,{stress:7})]).metrics.fatigue.status==="MISSING",{});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"SUBJECTIVE_RECOVERY_SR1",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{external_writes:0,sheet_creation:0,telegram_calls:0,groq_calls:0,property_writes:0,production_writes:0}};
}
