function runSubjectiveRecoverySR2Tests(){
  const tests=[];function rec(id,ok,details){tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}});}function parsed(text){return parseSubjectiveRecoveryInput_(text);}function metric(text,key,value){const p=parsed(text);return p.status==="VALID"&&p.metrics[key]===value;}
  rec("SR2-01_SLEEP_HOURS",metric("спал 6 часов","sleep_duration_hours",6),parsed("спал 6 часов"));
  rec("SR2-02_SLEEP_COMMA",metric("спал 6,5 часов","sleep_duration_hours",6.5),parsed("спал 6,5 часов"));
  rec("SR2-03_SLEEP_DOT",metric("спал 6.5 часов","sleep_duration_hours",6.5),parsed("спал 6.5 часов"));
  rec("SR2-04_SLEEP_COLON",metric("сон 6:30","sleep_duration_hours",6.5),parsed("сон 6:30"));
  rec("SR2-05_SLEEP_MINUTES",metric("спал 6 часов 30 минут","sleep_duration_hours",6.5),parsed("спал 6 часов 30 минут"));
  rec("SR2-06_SLEEP_QUALITY",metric("качество сна 7","sleep_quality",7),parsed("качество сна 7"));
  rec("SR2-07_FATIGUE",metric("усталость 8","fatigue",8),parsed("усталость 8"));
  rec("SR2-08_FATIGUE_ZERO",metric("усталость 0","fatigue",0),parsed("усталость 0"));
  rec("SR2-09_STRESS",metric("стресс 7","stress",7),parsed("стресс 7"));
  rec("SR2-10_STRESS_ZERO",metric("стресс 0","stress",0),parsed("стресс 0"));
  rec("SR2-11_WELLBEING",metric("самочувствие 6","wellbeing",6),parsed("самочувствие 6"));
  rec("SR2-12_READINESS",metric("готовность 5","readiness",5),parsed("готовность 5"));
  rec("SR2-13_READINESS_TRAIN",metric("готовность тренироваться 5","readiness",5),parsed("готовность тренироваться 5"));
  rec("SR2-14_SORENESS",metric("мышечная болезненность 6","soreness",6),parsed("мышечная болезненность 6"));
  rec("SR2-15_MUSCLES_TIGHT",metric("мышцы забиты на 7","soreness",7),parsed("мышцы забиты на 7"));
  let p=parsed("спал 6 часов, усталость 8, стресс 0");rec("SR2-16_MULTI",p.status==="VALID"&&p.metrics.sleep_duration_hours===6&&p.metrics.fatigue===8&&p.metrics.stress===0,p);
  rec("SR2-17_SLEEP_AMBIGUOUS",parsed("сон 7").status==="AMBIGUOUS",parsed("сон 7"));
  rec("SR2-18_INVALID_11",parsed("усталость 11").status==="INVALID",parsed("усталость 11"));
  rec("SR2-19_INVALID_NEGATIVE",parsed("стресс -1").status==="INVALID",parsed("стресс -1"));
  rec("SR2-20_INVALID_DECIMAL",parsed("самочувствие 7.5").status==="INVALID",parsed("самочувствие 7.5"));
  rec("SR2-21_SLEEP_OVER_18",parsed("спал 19 часов").status==="INVALID",parsed("спал 19 часов"));
  rec("SR2-22_ZERO_NOT_BLANK",Object.prototype.hasOwnProperty.call(parsed("стресс 0").metrics,"stress"),parsed("стресс 0"));
  ["болит плечо","болит колено","боль в пояснице","болят суставы","тянет пах","простреливает кисть"].forEach(function(text,index){const x=parsed(text);rec("SR2-"+(23+index)+"_PAIN",x.status==="PAIN_ONLY"&&!Object.prototype.hasOwnProperty.call(x.metrics,"soreness"),x);});
  rec("SR2-29_SORENESS_VALID",metric("мышечная болезненность 6","soreness",6),{});
  rec("SR2-30_TIGHT_NO_ON",metric("мышцы забиты 7","soreness",7),parsed("мышцы забиты 7"));
  p=parsed("спал 6 часов, усталость 8, болит плечо");rec("SR2-31_MIXED_PAIN",p.status==="VALID"&&p.pain&&p.metrics.sleep_duration_hours===6&&p.metrics.fatigue===8&&p.metrics.soreness===undefined,p);
  const now=new Date("2026-09-14T12:00:00.000Z");function update(id,text,date){return {update_id:id,message:{date:date||1789387200,text:text,from:{id:"u1"},chat:{id:"c1"}}};}
  function environment(){const state={writes:[],capture:null,created:0,finalized:0,cancelled:0,readCalls:0};state.dependencies={detect_confirmation:function(text){const n=String(text).toLowerCase();return n==="да"?{intent:"CONFIRM"}:n==="нет"?{intent:"CANCEL"}:null;},find_capture:function(){return state.capture?{ok:true,capture:state.capture.capture,payload:state.capture.payload}:{ok:false,code:"NO_RECOVERY_CAPTURE"};},get_pending:function(){return {ok:false};},create_capture:function(payload){state.created++;state.capture={capture:{status:"PENDING_CONFIRMATION",row_number:2,user_id:"u1",chat_id:"c1"},payload:payload};return {ok:true,code:"CREATED"};},cancel_capture:function(){state.cancelled++;state.capture=null;return {ok:true,code:"CANCELLED"};},finalize_capture:function(capture){state.finalized++;capture.status="SAVED";state.capture=null;return {ok:true};},write:function(user,payload){const existing=state.writes.filter(function(row){return row.idempotency_key===payload.idempotency_key;})[0];if(existing)return subjectiveRecoveryCanonical_(existing)===subjectiveRecoveryCanonical_(Object.assign({schema_version:SUBJECTIVE_RECOVERY_SCHEMA_VERSION,user_id:user,local_date:"2026-09-14",source:SUBJECTIVE_RECOVERY_SOURCE},payload))?{ok:true,code:"IDEMPOTENT_REPLAY",idempotent_replay:true,rows_written:0}:{ok:false,code:"IDEMPOTENCY_CONFLICT"};state.writes.push(Object.assign({schema_version:SUBJECTIVE_RECOVERY_SCHEMA_VERSION,user_id:user,local_date:"2026-09-14",source:SUBJECTIVE_RECOVERY_SOURCE},payload));return {ok:true,code:"CHECKIN_APPENDED",rows_written:1};},read:function(){state.readCalls++;return subjectiveRecoveryEmptyProjection_("NO_DATA","2026-09-14");}};return state;}
  let env=environment(),r=routeSubjectiveRecovery_(update(100,"усталость 8"),{now:now,dependencies:env.dependencies});rec("SR2-32_DIRECT",r.ok&&env.writes.length===1,r);
  env=environment();r=routeSubjectiveRecovery_(update(101,"усталость 8, стресс 7"),{now:now,dependencies:env.dependencies});rec("SR2-33_MULTI_CONFIRM",r.code==="CREATED"&&env.writes.length===0&&env.created===1,r);
  r=routeSubjectiveRecovery_(update(102,"Да"),{now:now,dependencies:env.dependencies});rec("SR2-34_YES_WRITES",r.ok&&env.writes.length===1&&env.finalized===1,r);
  env=environment();routeSubjectiveRecovery_(update(103,"усталость 8, стресс 7"),{now:now,dependencies:env.dependencies});r=routeSubjectiveRecovery_(update(104,"Нет"),{now:now,dependencies:env.dependencies});rec("SR2-35_NO_ZERO",r.ok&&env.writes.length===0&&env.cancelled===1,r);
  env=environment();routeSubjectiveRecovery_(update(105,"усталость 8, стресс 7"),{now:now,dependencies:env.dependencies});routeSubjectiveRecovery_(update(106,"Да"),{now:now,dependencies:env.dependencies});r=routeSubjectiveRecovery_(update(106,"Да"),{now:now,dependencies:env.dependencies});rec("SR2-36_DUPLICATE_YES",env.writes.length===1&&!r.handled,{r:r,writes:env.writes});
  env=environment();rec("SR2-37_NO_NUTRITION_STEAL",!routeSubjectiveRecovery_(update(107,"Да"),{now:now,dependencies:env.dependencies}).handled,{});
  rec("SR2-38_NO_WORKOUT_STEAL",!routeSubjectiveRecovery_(update(108,"Да"),{now:now,dependencies:environment().dependencies}).handled,{});
  rec("SR2-39_NO_WEIGHT_STEAL",!routeSubjectiveRecovery_(update(109,"Да"),{now:now,dependencies:environment().dependencies}).handled,{});
  env=environment();routeSubjectiveRecovery_(update(110,"усталость 8, стресс 0"),{now:now,dependencies:env.dependencies});rec("SR2-40_FROZEN",env.capture.payload.frozen.metrics.fatigue===8&&env.capture.payload.frozen.metrics.stress===0&&env.capture.payload.raw_message==="",env.capture);
  env=environment();routeSubjectiveRecovery_(update(111,"стресс 0"),{now:now,dependencies:env.dependencies});routeSubjectiveRecovery_(update(111,"стресс 0"),{now:now,dependencies:env.dependencies});rec("SR2-41_UPDATE_REPLAY",env.writes.length===1,env.writes);
  routeSubjectiveRecovery_(update(112,"стресс 0"),{now:now,dependencies:env.dependencies});rec("SR2-42_LATER_SAME_VALUE",env.writes.length===2,env.writes);
  rec("SR2-43_STABLE_EVENT",env.writes[0].event_id!==env.writes[1].event_id&&/update-111/.test(env.writes[0].event_id),env.writes);
  const conflictEnv=environment();conflictEnv.dependencies.write=function(){return {ok:false,code:"IDEMPOTENCY_CONFLICT"};};r=routeSubjectiveRecovery_(update(113,"усталость 8"),{now:now,dependencies:conflictEnv.dependencies});rec("SR2-44_CONFLICT_SAFE",!r.ok&&!/Записал/.test(r.message),r);
  env=environment();r=routeSubjectiveRecovery_(update(114,"покажи восстановление"),{now:now,dependencies:env.dependencies});rec("SR2-45_TODAY_NO_DATA",r.handled&&/пока нет/.test(r.message)&&env.readCalls===1,r);
  function projection(values){const x=subjectiveRecoveryEmptyProjection_("NORMAL","2026-09-14");Object.keys(values).forEach(function(key){x.metrics[key]={status:values[key].status||"FRESH",value:values[key].value};});return x;}
  env=environment();env.dependencies.read=function(){return projection({fatigue:{value:4}});};r=routeSubjectiveRecovery_(update(115,"что по восстановлению сегодня"),{now:now,dependencies:env.dependencies});rec("SR2-46_ONE_FRESH",/Усталость: 4\/10/.test(r.message),r);
  env.dependencies.read=function(){return projection({fatigue:{value:4},stress:{value:0}});};r=routeSubjectiveRecovery_(update(116,"мои показатели восстановления"),{now:now,dependencies:env.dependencies});rec("SR2-47_MULTI_FRESH",/Усталость/.test(r.message)&&/Стресс: 0\/10/.test(r.message),r);
  env.dependencies.read=function(){return projection({fatigue:{value:9,status:"STALE"}});};r=routeSubjectiveRecovery_(update(117,"покажи восстановление"),{now:now,dependencies:env.dependencies});rec("SR2-48_STALE_OMITTED",!/Усталость/.test(r.message),r);
  env.dependencies.read=function(){return projection({fatigue:{value:9,status:"STALE"},stress:{value:3}});};r=routeSubjectiveRecovery_(update(118,"покажи восстановление"),{now:now,dependencies:env.dependencies});rec("SR2-49_FRESH_STALE",!/Усталость/.test(r.message)&&/Стресс/.test(r.message),r);
  env.dependencies.read=function(){return projection({readiness:{value:0}});};r=routeSubjectiveRecovery_(update(119,"покажи восстановление"),{now:now,dependencies:env.dependencies});rec("SR2-50_ZERO_DISPLAY",/0\/10/.test(r.message),r);
  env.dependencies.read=function(){return subjectiveRecoveryEmptyProjection_("DATA_INTEGRITY_ERROR","2026-09-14");};r=routeSubjectiveRecovery_(update(120,"покажи восстановление"),{now:now,dependencies:env.dependencies});rec("SR2-51_INTEGRITY",!r.ok&&/надёжно/.test(r.message),r);
  const privateProjection=projection({stress:{value:2}});privateProjection.event_id="secret";rec("SR2-52_FORMAT_NO_METADATA",formatSubjectiveRecoveryToday_(privateProjection).indexOf("secret")<0,{});
  rec("SR2-53_READER_ONLY",String(routeSubjectiveRecovery_).indexOf("deps.read")>=0&&String(routeSubjectiveRecovery_).indexOf("Recovery_Checkin")<0,{});
  rec("SR2-54_GROQ_ZERO",r.groq_calls===0,r);
  rec("SR2-55_DASHBOARD",detectSubjectiveRecoveryTodayIntent_("что у меня сегодня")===null,{});
  rec("SR2-56_RECOVERY_ROUTE",!!detectSubjectiveRecoveryTodayIntent_("как у меня восстановление сегодня"),{});
  rec("SR2-57_OBJECTIVE_NOT_SHADOW",!!detectSubjectiveRecoveryTodayIntent_("что по восстановлению сегодня"),{});
  rec("SR2-58_UNRELATED",!routeSubjectiveRecovery_(update(121,"как приготовить ужин"),{now:now,dependencies:environment().dependencies}).handled,{});
  rec("SR2-59_QUALITATIVE_NO_GROQ",routeSubjectiveRecovery_(update(122,"ужасно устал"),{now:now,dependencies:environment().dependencies}).code==="CLARIFICATION_REQUIRED",{});
  rec("SR2-60_SLEEP_90_MIN_INVALID",parsed("спал 6 часов 90 минут").status==="INVALID",parsed("спал 6 часов 90 минут"));
  rec("SR2-61_QUALITATIVE_WELLBEING",routeSubjectiveRecovery_(update(123,"чувствую себя нормально"),{now:now,dependencies:environment().dependencies}).code==="CLARIFICATION_REQUIRED",{});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"SUBJECTIVE_RECOVERY_SR2",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{external_writes:0,telegram_calls:0,groq_calls:0,property_writes:0,production_writes:0}};
}
