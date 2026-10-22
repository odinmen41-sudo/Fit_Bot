/** WEIGHT-E2E-01 — authoritative weight persistence and consistent readers. */
function runWeightE2E01AuthoritativeTests() {
  const tests=[];
  function record(id,passed,details){tests.push({id:id,status:passed?"PASS":"FAIL",details:passed?{}:details||{}});}
  const now=new Date("2026-10-22T09:00:00.000Z"), headers=aiMemoryRequiredHeaders_();
  function memoryRow(id,user,value,at,confirmation){return [id,user,"body_tracking","weight_event",String(value),"HIGH",at,"WEIGHT_E2E_AUTHORITATIVE",confirmation];}
  function store(initialMemory,initialBody){
    const memory=(initialMemory||[]).map(function(r){return r.slice();});
    const body=(initialBody||[["Дата","Вес","Процент жира","Талия","Грудь","Рука","Бедро","Шаги","Комментарий"],["14.08.2026",118.7]]).map(function(r){return r.slice();});
    return {memory:memory,body:body,options:{allow_test_write:true,deployment_env:"STAGING",uuid:function(){return "uuid";},memory_sheet:{},body_sheet:{},
      read_memory:function(){return {headers:headers.slice(),rows:memory.map(function(r){return r.slice();})};},
      append_memory:function(sheet,row){memory.push(row.slice());},
      read_body:function(){return body.map(function(r){return r.slice();});},
      write_body:function(sheet,row,values){body[row-1]=values.slice();},flush:function(){},
      verify_memory:function(){return {headers:headers.slice(),rows:memory.map(function(r){return r.slice();})};},
      verify_body:function(){return body[body.length-1].slice();}}};
  }

  let candidate=detectExplicitWeightUpdate_("Сегодня мой вес 118,2 кг");
  record("WE2E-01_INPUT",candidate&&candidate.value===118.2,candidate);
  candidate=detectExplicitWeightUpdate_("Исправь сегодняшний вес на 118 кг");
  record("WE2E-02_CORRECTION_INPUT",candidate&&candidate.value===118,candidate);
  let capture=buildWeightPendingCapture_(candidate,{now:now,update_id:"1",raw_text:"Исправь сегодняшний вес на 118 кг",format_date:function(){return "2026-10-22";},uuid:function(){return "u";}});
  record("WE2E-03_CORRECTION_FROZEN",capture.operation==="CORRECT_TODAY"&&capture.items[0].fields.date.value==="2026-10-22",capture);

  let s=store(), result=persistAuthoritativeWeight_("u1",118.2,"2026-10-22","c1",now,s.options);
  record("WE2E-04_FIRST_WRITE",result.ok&&result.memory_written&&result.body_written&&result.writes===2,result);
  record("WE2E-05_MEMORY_EXACT",s.memory.length===1&&Number(s.memory[0][4])===118.2&&s.memory[0][8]==="c1",s.memory);
  record("WE2E-06_BODY_EXACT",s.body.length===3&&s.body[2][0]==="22.10.2026"&&s.body[2][1]===118.2,s.body);
  const replay=persistAuthoritativeWeight_("u1",118.2,"2026-10-22","c1",now,s.options);
  record("WE2E-07_REPLAY_NO_MEMORY_DUP",replay.ok&&!replay.memory_written&&s.memory.length===1,replay);
  const conflict=persistAuthoritativeWeight_("u1",119,"2026-10-22","c1",now,s.options);
  record("WE2E-08_IDEMPOTENCY_CONFLICT",!conflict.ok&&conflict.code==="IDEMPOTENCY_CONFLICT",conflict);
  const later=new Date("2026-10-22T10:00:00.000Z");
  result=persistAuthoritativeWeight_("u1",118,"2026-10-22","c2",later,s.options);
  record("WE2E-09_CORRECTION_APPEND_EVENT",result.ok&&s.memory.length===2&&Number(s.memory[1][4])===118,result);
  record("WE2E-10_CORRECTION_UPSERT_BODY",s.body.length===3&&s.body[2][1]===118,s.body);

  const events=s.memory.map(function(row){return {user_id:row[1],category:row[2],key:row[3],value:row[4],updated_at:row[6],confirmation_id:row[8]};});
  const deps={time_zone:function(){return "Europe/Moscow";},format_date:function(date){return new Date(date.getTime()+3*3600000).toISOString().slice(0,10);},read_memory:function(){return events;},read_profile:function(){return {profile_current_weight:118.7,start_weight:120,target_weight:108};}};
  let facts=buildWeightTrendFacts_("u1",{now:later,dependencies:deps});
  record("WE2E-11_CURRENT_AUTHORITATIVE",facts.current_weight===118&&facts.profile_weight_fallback===118.7,facts);
  let routed=routeWeightTrends_({message:{text:"Какой у меня сейчас вес?",from:{id:"u1"},chat:{id:"u1"}}},{now:later,dependencies:deps});
  record("WE2E-12_CURRENT_RESPONSE",routed.ok&&/118 кг/.test(routed.message)&&!/118,7/.test(routed.message),routed);
  routed=routeWeightTrends_({message:{text:"Покажи динамику веса",from:{id:"u1"},chat:{id:"u1"}}},{now:later,dependencies:deps});
  record("WE2E-13_DYNAMIC_ROUTE",routed.handled&&routed.groq_calls===0,routed);
  const dashboard=buildDailyDashboardFacts_("u1",{now:later,dependencies:{time_zone:deps.time_zone,format_date:deps.format_date,build_weight:function(){return facts;},load_consumed:function(){return {ok:true,meals_count:0,totals:{calories:0,protein:0,fat:0,carbs:0}};},load_targets:function(){return {ok:true,status:"NOT_CONFIGURED",targets:{calories:null,protein:null,fat:null,carbs:null}};},build_recovery:function(){return {history_status:"NO_DATA",plan_status:"PLAN_NOT_CONFIGURED"};},load_subjective:function(){return {data_status:"NO_DATA"};}}});
  record("WE2E-14_DASHBOARD_CURRENT",dashboard.weight.current_weight===118&&/Вес: 118 кг/.test(formatDailyDashboard_(dashboard)),dashboard.weight);
  const other=loadAuthoritativeWeightHistory_("u2",{now:later,dependencies:deps});
  record("WE2E-15_USER_ISOLATION",other.status==="NO_DATA",other);

  s=store();
  const broken=Object.assign({},s.options,{verify_body:function(){const row=s.body[s.body.length-1].slice();row[1]=117;return row;}});
  result=persistAuthoritativeWeight_("u1",118.2,"2026-10-22","c3",now,broken);
  record("WE2E-16_READBACK_FAILURE",!result.ok&&result.code==="READBACK_FAILED",result);
  result=persistAuthoritativeWeight_("u1",118.2,"2026-10-22","c3",now,s.options);
  record("WE2E-17_RETRY_RECONCILES",result.ok&&!result.memory_written&&s.memory.length===1,result);
  const prod=persistAuthoritativeWeight_("u1",118.2,"2026-10-22","c4",now,Object.assign({},s.options,{allow_test_write:false,deployment_env:"PRODUCTION"}));
  record("WE2E-18_PRODUCTION_BLOCKED",!prod.ok&&prod.code==="STAGING_ONLY"&&prod.writes===0,prod);

  const pending={capture_id:"c5",user_id:"u1",chat_id:"u1",status:"PENDING_CONFIRMATION",row_number:2,payload_json:JSON.stringify(buildWeightPendingCapture_(detectExplicitWeightUpdate_("Сегодня мой вес 118,2 кг"),{now:now,update_id:"5",format_date:function(){return "2026-10-22";},uuid:function(){return "u";}}))};
  let marked=0;
  result=saveConfirmedWeightFact_("c5","u1",{now:now,chat_id:"u1",lock:{tryLock:function(){return true;},releaseLock:function(){}},pending_sheet:{},find_capture:function(){return pending;},persistence_options:s.options,mark_saved:function(sheet,row,readback){if(readback&&readback.ok)marked+=1;},flush:function(){}});
  record("WE2E-19_SUCCESS_AFTER_READBACK",result.ok&&result.code==="SAVED"&&marked===1,result);
  const failedSave=saveConfirmedWeightFact_("c5","u1",{now:now,chat_id:"u1",lock:{tryLock:function(){return true;},releaseLock:function(){}},pending_sheet:{},find_capture:function(){return pending;},persistence_options:Object.assign({},s.options,{verify_body:function(){return ["22.10.2026",1];}}),mark_saved:function(){marked+=100;},flush:function(){}});
  record("WE2E-20_NO_FALSE_SUCCESS",!failedSave.ok&&marked===1,failedSave);

  const passed=tests.filter(function(t){return t.status==="PASS";}).length;
  return {suite:"WEIGHT_E2E_01_AUTHORITATIVE",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{telegram_calls:0,groq_calls:0,production_writes:0}};
}
