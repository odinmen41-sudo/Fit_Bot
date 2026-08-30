function runC232D31TelegramNutritionVoidFlowTests() {
  const tests = [];
  const now = new Date("2026-08-30T09:00:00.000Z");
  function record(id, passed, details) { tests.push({id:id, status:passed ? "PASS" : "FAIL", details:passed ? {} : details || {}}); }
  function target(user) { return {target_scope:"MEAL", user_id:user || "u1", logical_meal_id:"meal-1",
    effective_meal_id:"physical-1", revision:1, meal_at:"2026-08-30T08:12:00.000Z", snapshot_hash:"safe-hash",
    operation_type:"CREATE", items:[{item_index:0,food_id:"banana",food_display:"банан",preparation_state:"RAW",
      nutrition_reference_id:"banana-v1",quantity_value:137,quantity_unit:"g",calculated_calories:122,
      calculated_protein:1,calculated_fat:0,calculated_carbs:30}], totals:{calories:122,protein:1,fat:0,carbs:30}}; }
  function update(text, id, user, chat) { return {update_id:id || 1,message:{text:text,from:{id:user || "u1"},chat:{id:chat || "c1"}}}; }
  function env(flags) {
    const f=flags || {}, state={capture:null,writes:0,voids:0,cancels:0,summaries:0,resolves:0,groq:0};
    const deps={detect_confirmation:detectConfirmationIntent_,uuid:function(){return "uuid";},
      find_conflict:function(){return state.capture && state.capture.status==="PENDING_CONFIRMATION" ? {ok:true} : {ok:false};},
      resolve_target:function(user,text){state.resolves+=1;state.targetText=text;if(f.resolution)return f.resolution;
        return {ok:true,status:f.item ? "RESOLVED_ITEM":"RESOLVED_MEAL",resolved_target:f.item ?
          {target_scope:"ITEM",meal_target:target(user),item_selector:{item_index:0,item_fingerprint:"fingerprint"}}:target(user)};},
      create_capture:function(capture){if(f.createFail)return {ok:false,code:"FAIL"};state.capture={capture_id:capture.capture_id,
        user_id:capture.user_id,chat_id:capture.chat_id,status:"PENDING_CONFIRMATION",row_number:2};state.payload=capture;state.writes+=1;
        return {ok:true,created:true};},
      find_capture:function(user,chat,opts){if(!state.capture)return {ok:false};if(f.foreign)return {ok:true,capture:Object.assign({},state.capture,{user_id:"u2"}),payload:state.payload};
        if(state.capture.status==="SAVED"&&!opts.include_saved)return {ok:false};return {ok:true,capture:state.capture,payload:state.payload};},
      cancel_capture:function(){state.cancels+=1;state.capture.status="CANCELLED";return {ok:true,code:"CANCELLED"};},
      execute_void:function(user,resolution,opts){state.voids+=1;state.action=opts.capture_id;if(f.voidResult)return f.voidResult;
        return {ok:true,code:state.voids>1?"VOID_ALREADY_COMMITTED":"MEAL_VOIDED",nutrition_log_writes:state.voids>1?0:1};},
      finalize_capture:function(){state.capture.status="SAVED";return true;},
      load_summary:function(){state.summaries+=1;return {ok:true,meals_count:1,consumed:{calories:500,protein:40,fat:10,carbs:60}};}};
    state.run=function(text,id,user,chat){return routeNutritionMealVoid_(update(text,id,user,chat),{now:now,dependencies:deps,
      candidate_format_options:{time_zone:"Europe/Moscow",today:"2026-08-30",format_date_time:function(date,zone,pattern){return pattern==="HH:mm"?"11:12":"2026-08-30";}}});};
    return state;
  }

  let e=env(), r=e.run("удали последний приём пищи",101);
  record("C23.2D3.1-01_DELETE_LAST_ROUTE",r.handled&&r.code==="VOID_CONFIRMATION_REQUESTED",r);
  record("C23.2D3.1-02_COMMAND_ZERO_MUTATION",e.voids===0&&r.nutrition_log_writes===0,e);
  record("C23.2D3.1-03_CONFIRMATION_REQUIRED",/Да \/ Нет/.test(r.message)&&e.writes===1,r);
  e=env();r=e.run("отмени последний приём пищи",102);
  record("C23.2D3.1-04_CANCEL_VERB_ROUTE",r.handled&&e.targetText==="последний прием пищи",{r:r,e:e});
  e=env({item:true});r=e.run("удали последний банан",103);
  record("C23.2D3.1-05_FOOD_USES_D2",e.resolves===1&&e.targetText==="последний банан",e);
  record("C23.2D3.1-06_SAFE_PROMPT",/банан 137 г/.test(r.message)&&!/meal-1|physical-1|safe-hash|fingerprint/.test(r.message),r);
  r=e.run("Да",104);
  record("C23.2D3.1-07_CONFIRM_EXECUTES_ONCE",r.ok&&e.voids===1&&r.nutrition_log_writes===1,r);
  record("C23.2D3.1-08_ACTION_FROZEN",e.action==="void-103",e);
  record("C23.2D3.1-09_AUTHORITATIVE_C1",e.summaries===1&&/500 ккал/.test(r.message),r);
  record("C23.2D3.1-10_NO_GROQ",r.groq_calls===0&&e.groq===0,r);
  r=e.run("Да",104);
  record("C23.2D3.1-11_DUPLICATE_CONFIRM_IDEMPOTENT",r.ok&&e.voids===2&&r.nutrition_log_writes===0,r);

  e=env();e.run("удали последний приём пищи",105);r=e.run("Нет",106);
  record("C23.2D3.1-12_NO_CANCELS",r.ok&&e.cancels===1&&e.voids===0,r);
  e=env({voidResult:{ok:false,code:"STALE_TARGET_CONFLICT",nutrition_log_writes:0}});e.run("удали последний приём пищи",107);r=e.run("Да",108);
  record("C23.2D3.1-13_STALE_ZERO_MUTATION",!r.ok&&r.nutrition_log_writes===0&&/изменился/.test(r.message),r);

  [
    ["AMBIGUOUS_MEAL","AMBIGUOUS_MEAL"],["AMBIGUOUS_ITEM","AMBIGUOUS_ITEM"],["NOT_FOUND","NOT_FOUND"],
    ["UNSUPPORTED_QUERY","UNSUPPORTED_QUERY"],["DATA_INTEGRITY_ERROR","DATA_INTEGRITY_ERROR"]
  ].forEach(function(pair,index){e=env({resolution:{ok:false,status:pair[0],candidates:[target()]}});r=e.run("удали банан сегодня",110+index);
    record("C23.2D3.1-"+(14+index)+"_"+pair[1],!r.ok&&e.voids===0&&r.nutrition_log_writes===0,r);});

  e=env({foreign:true});e.run("удали последний приём пищи",120);r=e.run("Да",121);
  record("C23.2D3.1-19_FOREIGN_REJECTED",r.code==="OWNER_MISMATCH"&&e.voids===0,r);
  e=env();r=e.run("Что мне делать сегодня?",122);
  record("C23.2D3.1-20_GENERIC_UNCHANGED",!r.handled&&e.resolves===0,r);
  e=env();r=e.run("вес 80",123);
  record("C23.2D3.1-21_WEIGHT_UNCHANGED",!r.handled,r);
  e=env();r=e.run("цель 2300 ккал",124);
  record("C23.2D3.1-22_TARGET_UNCHANGED",!r.handled,r);
  e=env();r=e.run("удали последний приём пищи",125);const replay=e.run("удали последний приём пищи",125);
  record("C23.2D3.1-23_DUPLICATE_COMMAND_NO_VOID",e.voids===0&&replay.code==="ACTIVE_CAPTURE_EXISTS",replay);
  record("C23.2D3.1-24_PRODUCTION_ZERO",r.production_writes===false,r);

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2D3.1_TELEGRAM_VOID_FLOW",status:passed===tests.length?"PASS":"FAIL",total:tests.length,
    passed:passed,failed:tests.length-passed,tests:tests,safety:{telegram_calls:0,groq_calls:0,production_interactions:0}};
}
