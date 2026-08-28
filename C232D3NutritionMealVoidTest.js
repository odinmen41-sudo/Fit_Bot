function runC232D3NutritionMealVoidTests() {
  const tests=[];
  const now=new Date("2026-08-28T12:00:00.000Z");
  const mealAt="2026-08-28T08:00:00.000Z";
  function record(id,passed,details){tests.push({id:id,status:passed?"PASS":"FAIL",details:passed?{}:details||{}});}
  function clone(value){return JSON.parse(JSON.stringify(value));}
  function hash(text){let value=2166136261;for(let i=0;i<text.length;i+=1)value=Math.imul(value^text.charCodeAt(i),16777619);return "d3-sha-"+(value>>>0).toString(16)+"-"+text.length;}
  function persistedItem(food,quantity){return {item_index:0,food_id:food||"banana",food_display:food==="rice"?"рис":"банан",
    preparation_state:food==="rice"?"BOILED":"RAW",nutrition_reference_id:(food||"banana")+"_v1",
    quantity_value:quantity||100,quantity_unit:"g",reference_basis_quantity:100,reference_basis_unit:"g",
    reference_calories:100,reference_protein:2,reference_fat:1,reference_carbs:20,
    calculated_calories:100,calculated_protein:2,calculated_fat:1,calculated_carbs:20,
    nutrition_authority:"TEST",nutrition_source:"TEST",nutrition_source_version:"v1",nutrition_approximate:true};}
  function lifecycleRecord(id,user,type,logical,parent,revision,at,food){
    const items=type==="VOID"?[]:[persistedItem(food||"banana",100)];
    const totals=type==="VOID"?{calories:0,protein:0,fat:0,carbs:0}:{calories:100,protein:2,fat:1,carbs:20};
    const canonical={capture_id:id,user_id:user||"u1",operation_type:type||"CREATE",logical_meal_id:logical||"meal:"+id,
      replaces_meal_id:parent||"",revision:revision||1,items:items,totals:totals};
    return {schema_version:C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION,meal_id:"meal:"+id,capture_id:id,user_id:user||"u1",
      meal_at:at||mealAt,confirmed_at:at||mealAt,items_count:items.length,calories_total:totals.calories,
      protein_total:totals.protein,fat_total:totals.fat,carbs_total:totals.carbs,items_json:JSON.stringify(items),
      snapshot_hash:nutritionSnapshotHash_(canonical,{sha256:hash}),transaction_status:"COMMITTED",source:"test",
      created_at:at||mealAt,updated_at:at||mealAt,operation_type:type||"CREATE",logical_meal_id:logical||"meal:"+id,
      replaces_meal_id:parent||"",revision:revision||1};
  }
  function legacyRecord(id,user){const row=lifecycleRecord(id,user);row.schema_version=C232D1_NUTRITION_LEGACY_SCHEMA_VERSION;
    row.operation_type="";row.logical_meal_id="";row.replaces_meal_id="";row.revision="";return row;}
  function table(records){return {headers:C232B4_NUTRITION_SCHEMA.slice(),rows:records.map(nutritionMealRecordValues_)};}
  function effective(records,user){return loadEffectiveNutritionMeals_(user||"u1",table(records),null,function(){});}
  function target(records,user){const loaded=effective(records,user);if(!loaded.ok)return nutritionTargetResolutionResult_("DATA_INTEGRITY_ERROR","EFFECTIVE_MEAL_INTEGRITY_ERROR");
    return resolveNutritionTargetCandidates_(loaded.effective_meals,{relation:"LAST_MEAL",target_scope_hint:"MEAL",temporal_scope:"ANY"},null,{sha256:hash});}
  function itemTarget(records,user){const mealTarget=target(records,user);if(!mealTarget.ok)return mealTarget;
    return nutritionTargetResolutionResult_("RESOLVED_ITEM","ITEM_TARGET_RESOLVED",{resolved_target:
      buildNutritionFrozenItemTarget_(effective(records,user).effective_meals[0],effective(records,user).effective_meals[0].items[0],{sha256:hash})});}
  function environment(records,flags){const env={meals:clone(records||[]),writes:0,appends:0,reads:0,locks:0,releases:0,flags:flags||{}};
    env.io={read_table:function(){if(env.flags.table_read_fail)throw new Error("read");return table(env.meals);},
      find_meals:function(captureId){return env.meals.map(function(value,index){return {row_number:index+2,record:clone(value)};})
        .filter(function(value){return value.record.capture_id===captureId;});},
      append_meal:function(meal){if(env.flags.append_fail)throw new Error("append");env.appends+=1;env.writes+=1;env.meals.push(clone(meal));return env.meals.length+1;},
      read_meal:function(row){env.reads+=1;if(env.flags.read_fail){env.flags.read_fail=false;throw new Error("read");}
        const value=clone(env.meals[row-2]);if(env.flags.corrupt_read)value.snapshot_hash="corrupt";return value;},
      write_meal:function(row,meal){if(env.flags.write_fail)throw new Error("write");env.writes+=1;env.meals[row-2]=clone(meal);}};
    env.lock={tryLock:function(){env.locks+=1;return env.flags.lock_fail!==true;},releaseLock:function(){env.releases+=1;}};
    env.run=function(resolution,action,extra){return voidNutritionMeal_("u1",resolution,Object.assign({now:now,capture_id:action,
      persistence_enabled:true,io:env.io,lock:env.lock,sha256:hash},extra||{}));};return env;}

  const root=lifecycleRecord("root","u1","CREATE","meal:root","",1,mealAt,"banana");
  let frozen=target([root]);
  let built=buildNutritionVoidRecord_(frozen.resolved_target,"void-shape",now,{sha256:hash});
  record("C23.2D3-01_RECORD_SCHEMA",built.schema_version===C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION&&built.source==="C232D3_NUTRITION_VOID",built);
  record("C23.2D3-02_RECORD_OPERATION",built.operation_type==="VOID"&&built.transaction_status==="PREPARING",built);
  record("C23.2D3-03_ZERO_PAYLOAD",built.items_count===0&&built.items_json==="[]"&&built.calories_total===0&&built.protein_total===0&&built.fat_total===0&&built.carbs_total===0,built);
  record("C23.2D3-04_REVISION_INCREMENT",built.revision===2,built);
  record("C23.2D3-05_PREDECESSOR",built.replaces_meal_id==="meal:root",built);
  record("C23.2D3-06_LOGICAL_ID",built.logical_meal_id==="meal:root",built);
  record("C23.2D3-07_MEAL_AT",built.meal_at===mealAt,built);
  record("C23.2D3-08_UNIQUE_MEAL_ID",built.meal_id==="meal:void-shape"&&built.capture_id==="void-shape",built);
  record("C23.2D3-09_HASH_PRESENT",!!built.snapshot_hash,built);
  record("C23.2D3-10_HASH_DETERMINISTIC",built.snapshot_hash===buildNutritionVoidRecord_(frozen.resolved_target,"void-shape",now,{sha256:hash}).snapshot_hash,built);

  let env=environment([root]);let result=env.run(frozen,"void-create");
  record("C23.2D3-11_CREATE_VOID",result.ok&&result.code==="MEAL_VOIDED"&&result.written,result);
  record("C23.2D3-12_PREPARING_COMMITTED",env.writes===2&&env.meals[1].transaction_status==="COMMITTED",env);
  record("C23.2D3-13_EFFECTIVE_DISAPPEARS",effective(env.meals).effective_meals.length===0,effective(env.meals));
  record("C23.2D3-14_D1_VOIDED_CHAIN",effective(env.meals).voided_meals.length===1,effective(env.meals));

  const replace=lifecycleRecord("replace","u1","REPLACE","meal:root","meal:root",2,mealAt,"rice");
  frozen=target([root,replace]);env=environment([root,replace]);result=env.run(frozen,"void-replace");
  record("C23.2D3-15_REPLACE_VOID",result.ok&&env.meals[2].revision===3,result);
  record("C23.2D3-16_REPLACE_LINK",env.meals[2].replaces_meal_id==="meal:replace",env.meals[2]);
  record("C23.2D3-17_REPLACE_EFFECTIVE_GONE",effective(env.meals).effective_meals.length===0,effective(env.meals));

  const legacy=legacyRecord("legacy","u1");frozen=target([legacy]);env=environment([legacy]);result=env.run(frozen,"void-legacy");
  record("C23.2D3-18_LEGACY_VOID",result.ok&&env.meals[1].logical_meal_id==="meal:legacy"&&env.meals[1].revision===2,result);

  const second=lifecycleRecord("second","u1","CREATE","meal:second","",1,"2026-08-28T09:00:00.000Z","rice");
  frozen=target([root,second]);env=environment([root,second]);result=env.run(frozen,"void-second");
  const dailyDeps={time_zone:function(){return "Europe/Moscow";},format_date:function(date){return Utilities.formatDate(date,"Europe/Moscow","yyyy-MM-dd");},read_table:function(){return table(env.meals);}};
  let daily=loadDailyNutritionSummary_("u1",{now:now,dependencies:dailyDeps});
  record("C23.2D3-19_C1_COUNT",daily.ok&&daily.meals_count===1,daily);
  record("C23.2D3-20_C1_TOTALS",daily.consumed.calories===100&&daily.consumed.protein===2,daily);
  const targets={ok:true,code:"TARGETS_AVAILABLE",targets:{calories:2300,protein:195,fat:70,carbs:225}};
  let c3=loadRemainingNutritionTargets_("u1","REMAINING_ALL",{dependencies:{load_targets:function(){return targets;},load_consumed:function(){return daily;}}});
  record("C23.2D3-21_C3_INHERITS",c3.ok&&c3.remaining.calories===2200&&c3.consumed.calories===100,c3);
  let c4=loadNutritionTodayContext_("u1",{dependencies:{load_targets:function(){return targets;},load_logged:function(){return daily;}}});
  record("C23.2D3-22_C4_INHERITS",c4.ok&&c4.logged.calories===100&&c4.remaining_based_on_logged.calories===2200,c4);

  frozen=target([root]);env=environment([root]);let stale=clone(frozen);stale.resolved_target.snapshot_hash="stale";
  result=env.run(stale,"void-stale-hash");record("C23.2D3-23_HASH_MISMATCH",result.code==="STALE_TARGET_CONFLICT"&&env.appends===0,result);
  stale=clone(frozen);stale.resolved_target.revision=9;result=env.run(stale,"void-stale-revision");
  record("C23.2D3-24_REVISION_MISMATCH",result.code==="STALE_TARGET_CONFLICT"&&env.appends===0,result);
  stale=clone(frozen);stale.resolved_target.effective_meal_id="meal:other";result=env.run(stale,"void-stale-meal");
  record("C23.2D3-25_EFFECTIVE_ID_MISMATCH",result.code==="STALE_TARGET_CONFLICT"&&env.appends===0,result);
  stale=clone(frozen);stale.resolved_target.logical_meal_id="meal:other";result=env.run(stale,"void-stale-logical");
  record("C23.2D3-26_LOGICAL_MISMATCH",result.code==="MEAL_NOT_FOUND"&&env.appends===0,result);

  env=environment([root]);result=env.run(frozen,"void-replay");const replay=env.run(frozen,"void-replay");
  record("C23.2D3-27_REPLAY_IDEMPOTENT",result.ok&&replay.ok&&replay.code==="VOID_ALREADY_COMMITTED"&&replay.idempotent_replay,replay);
  record("C23.2D3-28_REPLAY_ONE_ROW",env.meals.filter(function(value){return value.operation_type==="VOID";}).length===1,env.meals);
  const otherAction=env.run(frozen,"void-other-action");
  record("C23.2D3-29_ALREADY_VOIDED",!otherAction.ok&&otherAction.code==="MEAL_ALREADY_VOIDED"&&env.meals.length===2,otherAction);

  const foreignTarget=clone(frozen);foreignTarget.resolved_target.user_id="u2";env=environment([root]);result=env.run(foreignTarget,"void-foreign");
  record("C23.2D3-30_FOREIGN_REJECTED",result.code==="OWNER_MISMATCH"&&env.writes===0,result);
  const ambiguous=nutritionTargetResolutionResult_("AMBIGUOUS_MEAL","MULTIPLE_MATCHING_MEALS",{candidates:[]});
  result=env.run(ambiguous,"void-ambiguous");record("C23.2D3-31_AMBIGUOUS_ZERO_WRITE",result.code==="MULTIPLE_MATCHING_MEALS"&&env.writes===0,result);
  [
    nutritionTargetResolutionResult_("NOT_FOUND","FOOD_NOT_FOUND"),
    nutritionTargetResolutionResult_("UNSUPPORTED_QUERY","MEAL_LABEL_NOT_AVAILABLE"),
    nutritionTargetResolutionResult_("DATA_INTEGRITY_ERROR","EFFECTIVE_MEAL_INTEGRITY_ERROR")
  ].forEach(function(value,index){const local=environment([root]);const answer=local.run(value,"void-reject-"+index);
    record("C23.2D3-"+(32+index)+"_TARGET_REJECT",!answer.ok&&local.writes===0,answer);});

  const itemResolution=itemTarget([root]);env=environment([root]);result=env.run(itemResolution,"void-item");
  record("C23.2D3-35_ITEM_TARGET_VOIDS_MEAL",result.ok&&effective(env.meals).effective_meals.length===0,result);
  const badParent=lifecycleRecord("bad","u1","REPLACE","meal:root","meal:missing",2,mealAt);
  env=environment([root,badParent]);result=env.run(frozen,"void-bad-chain");
  record("C23.2D3-36_MALFORMED_LIFECYCLE",result.code==="EFFECTIVE_MEAL_INTEGRITY_ERROR"&&env.appends===0,result);

  env=environment([root],{read_fail:true});result=env.run(frozen,"void-recover");
  record("C23.2D3-37_PREPARING_LEFT_SAFE",result.code==="VOID_PREPARING_READ_FAILED"&&env.meals[1].transaction_status==="PREPARING",result);
  const recovered=env.run(frozen,"void-recover");
  record("C23.2D3-38_PREPARING_RECOVERY",recovered.ok&&env.meals[1].transaction_status==="COMMITTED"&&env.meals.length===2,recovered);
  env=environment([root],{append_fail:true});result=env.run(frozen,"void-write-fail");
  record("C23.2D3-39_APPEND_FAILURE",result.code==="VOID_PREPARING_WRITE_FAILED"&&env.meals.length===1,result);
  env=environment([root],{corrupt_read:true});result=env.run(frozen,"void-readback-fail");
  record("C23.2D3-40_READBACK_FAILURE",result.code==="VOID_PREPARING_VERIFY_FAILED"&&env.meals[1].transaction_status==="PREPARING",result);
  env=environment([root],{lock_fail:true});result=env.run(frozen,"void-lock");
  record("C23.2D3-41_LOCK_TIMEOUT",result.code==="LOCK_TIMEOUT"&&env.writes===0&&env.releases===0,result);
  env=environment([root]);result=voidNutritionMeal_("u1",frozen,{capture_id:"void-disabled",io:env.io,lock:env.lock,
    properties:{getProperty:function(){return null;}}});
  record("C23.2D3-42_GATE_FAIL_CLOSED",result.code==="PERSISTENCE_DISABLED"&&env.writes===0,result);
  env=environment([root]);result=env.run(frozen,"");record("C23.2D3-43_ACTION_ID_REQUIRED",result.code==="ACTION_ID_REQUIRED"&&env.writes===0,result);
  record("C23.2D3-44_NO_PENDING",result.pending_capture_writes===0,result);
  record("C23.2D3-45_NO_GROQ",result.groq_calls===0,result);
  record("C23.2D3-46_NO_PRODUCTION",result.production_writes===false,result);

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2D3_NUTRITION_MEAL_VOID",status:passed===tests.length?"PASS":"FAIL",total:tests.length,
    passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,pending_capture_writes:0,
      script_property_changes:0,telegram_calls:0,groq_calls:0,production_interactions:0,production_writes:0}};
}
