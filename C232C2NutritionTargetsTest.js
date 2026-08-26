function runC232C2NutritionTargetsTests() {
  const tests = [];
  const now = new Date("2026-08-26T12:00:00.000Z");
  function record(id, ok, details) { tests.push({id:id,status:ok?"PASS":"FAIL",details:ok?{}:details||{}}); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function row(userId, telegramId, targets) {
    const values = [userId,"Test",35,180,120,118,108,"Цель","Средний",3,telegramId];
    const t = targets || {};
    return values.concat([t.calories == null ? "" : t.calories,t.protein == null ? "" : t.protein,
      t.fat == null ? "" : t.fat,t.carbs == null ? "" : t.carbs]);
  }
  function update(text,user,chat) { return {update_id:"u1",message:{text:text,from:{id:user||"tg1"},chat:{id:chat||"c1"}}}; }
  function detection(text) { return detectExplicitNutritionTargetUpdate_(text); }
  function props(values) { return {getProperty:function(key){return values[key] == null ? null : values[key];}}; }

  record("C23.2C2-01_SCHEMA_EXACT", nutritionTargetSchema_(C232C2_TARGET_SCHEMA.slice()).ok);
  record("C23.2C2-02_SCHEMA_MISSING", !nutritionTargetSchema_(C232C2_TARGET_SCHEMA.slice(0,14)).ok);
  const duplicateHeaders=C232C2_TARGET_SCHEMA.slice(); duplicateHeaders[14]=duplicateHeaders[13];
  record("C23.2C2-03_SCHEMA_DUPLICATE", !nutritionTargetSchema_(duplicateHeaders).ok);
  const reordered=C232C2_TARGET_SCHEMA.slice(); const temp=reordered[11]; reordered[11]=reordered[12]; reordered[12]=temp;
  record("C23.2C2-04_SCHEMA_REORDERED", !nutritionTargetSchema_(reordered).ok);

  let resolved=resolveNutritionTargetProfileRow_(C232C2_TARGET_SCHEMA,[row("profile","tg1",{})],"tg1");
  record("C23.2C2-05_TELEGRAM_ID", resolved.ok && resolved.row_index===0,resolved);
  resolved=resolveNutritionTargetProfileRow_(C232C2_TARGET_SCHEMA,[row("tg1","",{})],"tg1");
  record("C23.2C2-06_USER_ID_FALLBACK", resolved.ok,resolved);
  resolved=resolveNutritionTargetProfileRow_(C232C2_TARGET_SCHEMA,[row("profile","other",{})],"tg1");
  record("C23.2C2-07_USER_MISSING", !resolved.ok && resolved.code==="USER_NOT_FOUND",resolved);
  resolved=resolveNutritionTargetProfileRow_(C232C2_TARGET_SCHEMA,[row("a","tg1",{}),row("b","tg1",{})],"tg1");
  record("C23.2C2-08_DUPLICATE_USER", !resolved.ok && resolved.code==="DUPLICATE_USER_PROFILE",resolved);

  let result=loadAuthoritativeNutritionTargets_("tg1",{table:{headers:C232C2_TARGET_SCHEMA,rows:[row("p","tg1",{calories:2300,protein:190,fat:70,carbs:220})]}});
  record("C23.2C2-09_READ_AVAILABLE", result.ok&&result.status==="AVAILABLE"&&result.targets.protein===190,result);
  result=loadAuthoritativeNutritionTargets_("tg1",{table:{headers:C232C2_TARGET_SCHEMA,rows:[row("p","tg1",{calories:2300})]}});
  record("C23.2C2-10_READ_PARTIAL", result.ok&&result.status==="PARTIAL"&&result.targets.protein===null,result);
  result=loadAuthoritativeNutritionTargets_("tg1",{table:{headers:C232C2_TARGET_SCHEMA,rows:[row("p","tg1",{})]}});
  record("C23.2C2-11_READ_EMPTY", result.ok&&result.status==="NOT_CONFIGURED",result);
  result=loadAuthoritativeNutritionTargets_("tg1",{table:{headers:C232C2_TARGET_SCHEMA,rows:[row("p","tg1",{protein:"bad"})]}});
  record("C23.2C2-12_READ_MALFORMED", !result.ok&&result.status==="INVALID",result);
  result=loadAuthoritativeNutritionTargets_("tg1",{table:{headers:C232C2_TARGET_SCHEMA,rows:[row("p","tg1",{calories:100})]}});
  record("C23.2C2-13_READ_RANGE", !result.ok&&result.code==="TARGET_OUT_OF_RANGE",result);

  record("C23.2C2-14_CALORIES_INTENT", detection("моя цель 2300 ккал").proposed_targets.calories===2300);
  record("C23.2C2-15_PROTEIN_INTENT", detection("поставь цель по белку 195 г").proposed_targets.protein===195);
  record("C23.2C2-16_FAT_INTENT", detection("цель по жирам 70 г").proposed_targets.fat===70);
  record("C23.2C2-17_CARBS_INTENT", detection("цель по углеводам 225 г").proposed_targets.carbs===225);
  const multi=detection("мои цели: 2300 ккал, белок 195, жиры 70, углеводы 225");
  record("C23.2C2-18_MULTI_INTENT", multi&&multi.ok&&multi.explicit_fields.length===4,multi);
  record("C23.2C2-19_COMMA_DECIMAL", detection("цель по белку 195,5 г").proposed_targets.protein===195.5);
  const negatives=["калории 2300","белка 195 г","углеводы 225","сколько калорий мне есть?",
    "какая у меня цель по белку?","сколько осталось калорий?","сколько я сегодня съел?","рис вареный 150 г",
    "съел 2300 ккал","ужин 70 г жиров","мой вес 117 кг","цель по весу 108 кг","жим 100 кг","Да","Нет"];
  record("C23.2C2-20_COLLISIONS", negatives.every(function(text){return detection(text)===null;}),negatives.filter(function(text){return detection(text)!==null;}));
  record("C23.2C2-21_C1_UNAFFECTED", detectDailyNutritionQueryIntent_("сколько я сегодня съел?")&&!detection("сколько я сегодня съел?"));
  record("C23.2C2-22_FOOD_UNAFFECTED", detectDomainFactCandidate_("рис вареный 150 г",{resolution_disabled:true}).domain==="NUTRITION");
  record("C23.2C2-23_WEIGHT_UNAFFECTED", detectExplicitWeightUpdate_("мой вес 117 кг").value===117);
  record("C23.2C2-24_WORKOUT_UNAFFECTED", detectDomainFactCandidate_("жим 100 кг",{resolution_disabled:true}).domain==="WORKOUT");

  const current={ok:true,targets:{calories:2300,protein:190,fat:70,carbs:220}};
  const proteinDetection=detection("измени цель по белку на 200 г");
  const capture=buildNutritionTargetCapture_(proteinDetection,current,{now:now,uuid:function(){return "uuid";}});
  record("C23.2C2-25_CAPTURE_PRIVACY", capture.raw_message===""&&JSON.stringify(capture).indexOf("измени")<0,capture);
  record("C23.2C2-26_EXPLICIT_BASE_ONLY", capture.explicit_fields.length===1&&capture.base_values.protein===190&&capture.base_values.calories===undefined,capture);
  record("C23.2C2-27_CAPTURE_VALID", validateNutritionTargetCapture_(capture).ok,capture);

  function routeEnv(active) {
    const env={rows:active?[{status:"PENDING_CONFIRMATION"}]:[],created:0};
    env.dependencies={uuid:function(){return "route-uuid";},detect_confirmation:detectConfirmationIntent_,
      find_capture:function(){return {ok:false,code:"NO_TARGET_CAPTURE"};},
      find_conflict:function(){return env.rows.length?{ok:true,capture:env.rows[0]}:{ok:false};},
      load_targets:function(){return current;},create_capture:function(value){env.created+=1;env.capture=value;return {ok:true,code:"CREATED"};},
      cancel_capture:function(){return {ok:true,code:"CANCELLED"};},persistence_enabled:function(){return false;},persist:function(){return {ok:false};}};
    return env;
  }
  let env=routeEnv(true); result=routeNutritionTargetConfirmation_(update("цель по белку 200 г"),{now:now,dependencies:env.dependencies});
  record("C23.2C2-28_REJECT_ACTIVE", result.code==="ACTIVE_CAPTURE_EXISTS"&&env.created===0,result);
  env=routeEnv(false); result=routeNutritionTargetConfirmation_(update("цель по белку 200 г"),{now:now,dependencies:env.dependencies});
  record("C23.2C2-29_ROUTE_CREATE", result.ok&&result.code==="TARGET_CONFIRMATION_REQUESTED"&&env.created===1,result);
  result=routeNutritionTargetConfirmation_(update("Да"),{now:now,dependencies:routeEnv(false).dependencies});
  record("C23.2C2-30_MEAL_CONFIRM_FALLTHROUGH", !result.handled&&result.code==="NO_TARGET_CAPTURE",result);

  const selected={capture:{capture_id:"cap",user_id:"tg1",chat_id:"c1",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()+60000)},payload:capture};
  result=handleNutritionTargetConfirmation_(selected,"CONFIRM","tg1","c1",now,{persistence_enabled:function(){return false;}});
  record("C23.2C2-31_GATE_OFF_PENDING", result.code==="PERSISTENCE_DISABLED"&&selected.capture.status==="PENDING_CONFIRMATION",result);
  let cancelled=0; result=handleNutritionTargetConfirmation_(selected,"CANCEL","tg1","c1",now,{cancel_capture:function(){cancelled++;return {ok:true,code:"CANCELLED"};}});
  record("C23.2C2-32_CANCEL", result.ok&&result.code==="CANCELLED"&&cancelled===1,result);
  result=handleNutritionTargetConfirmation_(selected,"CONFIRM","other","c1",now,{persistence_enabled:function(){return true;},persist:function(){return {ok:true};}});
  record("C23.2C2-33_OWNER", result.code==="OWNER_MISMATCH",result);
  result=handleNutritionTargetConfirmation_(selected,"CONFIRM","tg1","other",now,{persistence_enabled:function(){return true;},persist:function(){return {ok:true};}});
  record("C23.2C2-34_CHAT", result.code==="OWNER_MISMATCH",result);

  function persistEnv(mutate) {
    const table={headers:C232C2_TARGET_SCHEMA.slice(),rows:[row("p","tg1",{calories:2300,protein:190,fat:70,carbs:220})]};
    const state={writes:0,marks:0,reads:0,locks:0,releases:0,capture:{capture_id:"cap",user_id:"tg1",chat_id:"c1",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()+60000),payload:clone(capture)}};
    const io={get_capture:function(){return state.capture;},read_profile:function(){state.reads++;return clone(table);},
      write_targets:function(rowIndex,changes){state.writes++;changes.forEach(function(change){table.rows[rowIndex][change.column_index]=change.after;});if(mutate)mutate(table,state);},
      flush:function(){},mark_saved:function(value,resultValue){state.marks++;value.status="SAVED";state.result=resultValue;}};
    const lock={tryLock:function(){state.locks++;return true;},releaseLock:function(){state.releases++;}};
    return {table:table,state:state,io:io,lock:lock,run:function(){return persistNutritionTargets_(selected,"tg1","c1",{now:now,io:io,lock:lock});}};
  }
  let penv=persistEnv(); result=penv.run();
  record("C23.2C2-35_PARTIAL_PERSIST", result.ok&&penv.table.rows[0][12]===200&&penv.table.rows[0][11]===2300&&penv.table.rows[0][13]===70,result);
  record("C23.2C2-36_VERIFY_BEFORE_SAVED", penv.state.reads===2&&penv.state.marks===1&&penv.state.capture.status==="SAVED",penv.state);
  result=penv.run(); record("C23.2C2-37_IDEMPOTENT", result.code==="ALREADY_SAVED"&&penv.state.writes===1,result);
  penv=persistEnv(); penv.table.rows[0][12]=195; result=penv.run();
  record("C23.2C2-38_STALE", result.code==="STALE_TARGET_PROFILE"&&penv.state.writes===0&&penv.state.marks===0,result);
  penv=persistEnv(function(){throw new Error("write failed");}); result=penv.run();
  record("C23.2C2-39_WRITE_FAILURE", result.code==="TARGET_SAVE_FAILED"&&penv.state.marks===0&&penv.state.capture.status==="PENDING_CONFIRMATION",result);
  penv=persistEnv(function(table){table.rows[0][12]=199;}); result=penv.run();
  record("C23.2C2-40_READBACK_FAILURE", result.code==="READBACK_FAILED"&&penv.state.marks===0,result);
  penv=persistEnv(); penv.state.capture.expires_at=new Date(now.getTime()-1); result=penv.run();
  record("C23.2C2-41_TTL", result.code==="EXPIRED"&&penv.state.writes===0,result);
  record("C23.2C2-42_SINGLE_LOCK", penv.state.locks===1&&penv.state.releases===1,penv.state);

  record("C23.2C2-43_GATE_ABSENT", !nutritionTargetPersistenceEnabled_({properties:props({})}));
  record("C23.2C2-44_GATE_FALSE", !nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_TARGET_PERSISTENCE_ENABLED:"false"})}));
  record("C23.2C2-45_GATE_CASE", !nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_TARGET_PERSISTENCE_ENABLED:"TRUE"})}));
  record("C23.2C2-46_GATE_ONE", !nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_TARGET_PERSISTENCE_ENABLED:"1"})}));
  record("C23.2C2-47_GATE_ALLOWED", nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_TARGET_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2C2-48_PRODUCTION_BLOCKED", !nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"PRODUCTION",DATA_WRITE_MODE:"SIMULATION",NUTRITION_TARGET_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2C2-49_MODE_BLOCKED", !nutritionTargetPersistenceEnabled_({properties:props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"ACTIVE",NUTRITION_TARGET_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2C2-50_ISOLATION", result.ai_memory_writes===0&&result.coach_state_writes===0&&result.nutrition_log_writes===0&&result.production_writes===false,result);

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2C2_NUTRITION_TARGETS",status:passed===tests.length?"PASS":"FAIL",total:tests.length,
    passed:passed,failed:tests.length-passed,tests:tests,safety:{live_sheet_writes:0,script_property_changes:0,
      telegram_calls:0,groq_calls:0,ai_memory_writes:0,coach_state_writes:0,nutrition_log_writes:0,production_writes:0}};
}
