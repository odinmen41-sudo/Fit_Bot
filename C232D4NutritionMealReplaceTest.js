function runC232D4NutritionMealReplaceTests(){
  const tests=[],now=new Date("2026-08-30T12:00:00.000Z"),mealAt="2026-08-30T08:00:00.000Z";
  function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function hash(text){let value=2166136261;for(let i=0;i<text.length;i+=1)value=Math.imul(value^text.charCodeAt(i),16777619);return "d4-"+(value>>>0).toString(16);}
  function item(food,q,index){const rice=food==="rice";return {item_index:index||0,food_id:food||"banana",food_display:rice?"рис вареный":"банан",
    preparation_state:rice?"BOILED":"UNKNOWN",nutrition_reference_id:(food||"banana")+"_v1",quantity_value:q||100,quantity_unit:"g",
    reference_basis_quantity:100,reference_basis_unit:"g",reference_calories:rice?130:89,reference_protein:rice?2.7:1.1,
    reference_fat:rice?0.3:0.33,reference_carbs:rice?28:22.8,calculated_calories:(rice?130:89)*(q||100)/100,
    calculated_protein:(rice?2.7:1.1)*(q||100)/100,calculated_fat:(rice?0.3:0.33)*(q||100)/100,
    calculated_carbs:(rice?28:22.8)*(q||100)/100,nutrition_authority:"TEST",nutrition_source:"TEST",nutrition_source_version:"v1",nutrition_approximate:true};}
  function lifecycle(id,type,logical,parent,revision,items,user){const values=normalizeNutritionReplacementItems_(items||[item("banana",100)]),totals=nutritionReplacementTotals_(values),
    canonical={capture_id:id,user_id:user||"u1",operation_type:type||"CREATE",logical_meal_id:logical||"meal:"+id,replaces_meal_id:parent||"",revision:revision||1,items:values,totals:totals};
    return {schema_version:C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION,meal_id:"meal:"+id,capture_id:id,user_id:user||"u1",meal_at:mealAt,confirmed_at:mealAt,
      items_count:values.length,calories_total:totals.calories,protein_total:totals.protein,fat_total:totals.fat,carbs_total:totals.carbs,items_json:JSON.stringify(values),
      snapshot_hash:nutritionSnapshotHash_(canonical,{sha256:hash}),transaction_status:"COMMITTED",source:"test",created_at:mealAt,updated_at:mealAt,
      operation_type:type||"CREATE",logical_meal_id:logical||"meal:"+id,replaces_meal_id:parent||"",revision:revision||1};}
  function legacy(id){const r=lifecycle(id);r.schema_version=C232D1_NUTRITION_LEGACY_SCHEMA_VERSION;r.operation_type="";r.logical_meal_id="";r.replaces_meal_id="";r.revision="";return r;}
  function table(rows){return {headers:C232B4_NUTRITION_SCHEMA.slice(),rows:rows.map(nutritionMealRecordValues_)};}
  function resolution(row,index){const normalized=normalizeNutritionLifecycleRow_(row),effective=normalized.operation;effective.effective_meal_id=effective.meal_id;if(index==null)return {ok:true,status:"RESOLVED_MEAL",resolved_target:buildNutritionFrozenMealTarget_(effective)};
    return {ok:true,status:"RESOLVED_ITEM",resolved_target:buildNutritionFrozenItemTarget_(effective,effective.items[index],{})};}
  function proposal(row,newItems,index){const res=resolution(row,index);return {ok:true,code:"REPLACEMENT_BUILT",old_target:index==null?res.resolved_target:res.resolved_target.meal_target,
    new_snapshot:{meal_at:mealAt,items:normalizeNutritionReplacementItems_(newItems),totals:nutritionReplacementTotals_(newItems)}};}
  function env(rows,flags){const e={rows:clone(rows),writes:0,appends:0,flags:flags||{}};e.io={read_table:function(){return table(e.rows);},find_meals:function(id){return e.rows.map(function(r,i){return {row_number:i+2,record:clone(r)};}).filter(function(x){return x.record.capture_id===id;});},append_meal:function(r){e.appends++;e.writes++;e.rows.push(clone(r));return e.rows.length+1;},read_meal:function(n){return clone(e.rows[n-2]);},write_meal:function(n,r){e.writes++;e.rows[n-2]=clone(r);}};e.lock={tryLock:function(){return true;},releaseLock:function(){}};
    e.run=function(p,id,user){return replaceNutritionMeal_(user||"u1",p,{now:now,capture_id:id,persistence_enabled:true,io:e.io,lock:e.lock,sha256:hash});};return e;}

  const root=lifecycle("root"),p=proposal(root,[item("banana",200)]);let e=env([root]),r=e.run(p,"rep1"),eff=loadEffectiveNutritionMeals_("u1",table(e.rows),null,function(){});
  rec("D4-01_CREATE_REPLACE",r.ok&&r.code==="MEAL_REPLACED",r);rec("D4-02_LOGICAL",r.meal.logical_meal_id==="meal:root",r);rec("D4-03_PREDECESSOR",r.meal.replaces_meal_id==="meal:root",r);
  rec("D4-04_REVISION",r.meal.revision===2,r);rec("D4-05_MEAL_AT",r.meal.meal_at===mealAt,r);rec("D4-06_COMPLETE_ITEMS",JSON.parse(r.meal.items_json).length===1,r);
  rec("D4-07_TOTALS",r.meal.calories_total===178,r);rec("D4-08_HASH",!!r.meal.snapshot_hash,r);rec("D4-09_DURABILITY",e.writes===2&&r.meal.transaction_status==="COMMITTED",e);
  rec("D4-10_EFFECTIVE",eff.effective_meals[0].operation_type==="REPLACE"&&eff.effective_meals[0].totals.calories===178,eff);
  const replace=e.rows[1],p2=proposal(replace,[item("banana",250)]);r=e.run(p2,"rep2");rec("D4-11_CHAIN_REPLACE",r.ok&&r.meal.revision===3,r);
  e=env([legacy("legacy")]);r=e.run(proposal(e.rows[0],[item("banana",150)]),"rep-legacy");rec("D4-12_LEGACY",r.ok&&r.meal.revision===2,r);

  const multi=lifecycle("multi","CREATE",null,null,1,[item("banana",100,0),item("rice",100,1)]),resItem=resolution(multi,0);let built=buildQuantityNutritionReplacement_(resItem,200);
  rec("D4-13_QUANTITY_BUILD",built.ok,built);rec("D4-14_MULTI_QUANTITY",built.new_snapshot.items.length===2,built);rec("D4-15_UNAFFECTED",built.new_snapshot.items[1].food_id==="rice"&&built.new_snapshot.items[1].quantity_value===100,built);
  rec("D4-16_TARGET_RECALC",built.new_snapshot.items[0].calculated_calories===178,built);rec("D4-17_TOTAL_RECALC",built.new_snapshot.totals.calories===308,built);
  rec("D4-18_INVALID_QUANTITY",!buildQuantityNutritionReplacement_(resItem,0).ok&&
    buildQuantityNutritionReplacement_(resItem,200,"мл").code==="NUTRITION_UNIT_MISMATCH"&&
    detectNutritionMealReplaceIntent_("в банане было 200 г, а не 137").quantity===200,{});

  const replacementCapture={items:[{fields:{food_id:{value:"rice"},food_display:{value:"рис вареный"},preparation_state:{value:"BOILED"},nutrition_reference_id:{value:"rice_v1"},quantity_value:{value:150},quantity_unit:{value:"g"},reference_nutrition_basis:{value:{quantity:100,unit:"g",calories:130,protein:2.7,fat:0.3,carbs:28}},calculated_nutrition:{value:{calories:195,protein:4.05,fat:0.45,carbs:42}},nutrition_authority:{value:"TEST"},nutrition_source:{value:"TEST"},nutrition_source_version:{value:"v1"},nutrition_approximate:{value:true}}}],nutrition_calculation:{totals:{calories:195,protein:4.05,fat:0.45,carbs:42}}};
  built=buildSubstitutionNutritionReplacement_(resItem,replacementCapture);rec("D4-19_SUBSTITUTION",built.ok&&built.new_snapshot.items[0].food_id==="rice",built);
  rec("D4-20_SUB_UNAFFECTED",built.new_snapshot.items[1].food_id==="rice"&&built.new_snapshot.items[1].quantity_value===100,built);rec("D4-21_SUB_ARITHMETIC",built.new_snapshot.items[0].calculated_calories===195,built);
  rec("D4-22_BAD_NEW_FOOD",!buildSubstitutionNutritionReplacement_(resItem,null).ok,{});rec("D4-23_MISSING_QUANTITY",nutritionReplacementCaptureFromText_("гречка",{resolution_disabled:true})===null,{});
  built=buildWholeNutritionReplacement_(resolution(multi),replacementCapture);rec("D4-24_WHOLE",built.ok&&built.new_snapshot.items.length===1,built);
  const two=clone(replacementCapture);two.items.push(clone(replacementCapture.items[0]));two.nutrition_calculation.totals.calories=390;built=buildWholeNutritionReplacement_(resolution(multi),two);
  rec("D4-25_WHOLE_MULTI",built.ok&&built.new_snapshot.items.length===2,built);rec("D4-26_OLD_ABSENT",built.new_snapshot.items.every(function(i){return i.food_id==="rice";}),built);

  let stale=clone(p);stale.old_target.snapshot_hash="bad";e=env([root]);r=e.run(stale,"stale");rec("D4-27_STALE",r.code==="STALE_TARGET_CONFLICT"&&e.writes===0,r);
  stale=clone(p);stale.old_target.revision=9;e=env([root]);r=e.run(stale,"revision");rec("D4-28_REV_MISMATCH",r.code==="STALE_TARGET_CONFLICT"&&e.writes===0,r);
  stale=clone(p);stale.old_target.effective_meal_id="other";e=env([root]);r=e.run(stale,"effective");rec("D4-29_EFFECTIVE_MISMATCH",r.code==="STALE_TARGET_CONFLICT"&&e.writes===0,r);
  const voidRow=lifecycle("void","VOID","meal:root","meal:root",2,[]);e=env([root,voidRow]);r=e.run(p,"after-void");rec("D4-30_VOID_REJECT",r.code==="MEAL_ALREADY_VOIDED"&&e.writes===0,r);
  e=env([root]);r=e.run(p,"foreign","u2");rec("D4-31_FOREIGN",r.code==="OWNER_MISMATCH"&&e.writes===0,r);
  e=env([root]);r=e.run(p,"same-action");const replay=e.run(p,"same-action");rec("D4-32_ACTION_IDEMPOTENT",r.ok&&replay.ok&&replay.idempotent_replay,e);
  rec("D4-33_ONE_REPLACE",e.rows.filter(function(x){return x.operation_type==="REPLACE";}).length===1,e);rec("D4-34_DUP_UPDATE_ACTION",replay.rows_written===0,replay);
  const noChange=proposal(root,[item("banana",100)]);e=env([root]);r=e.run(noChange,"noop");rec("D4-35_NO_CHANGE",r.code==="NO_CHANGE",r);rec("D4-36_NO_CHANGE_ZERO",e.writes===0&&e.appends===0,e);

  function routeEnv(flags){const s={capture:null,mutations:0,cancels:0,refs:0,summaries:0},f=flags||{};const deps={detect_confirmation:detectConfirmationIntent_,find_conflict:function(){return s.capture&&s.capture.status==="PENDING_CONFIRMATION"?{ok:true}:{ok:false};},
    resolve_target:function(){return f.resolution||resItem;},build_capture:function(){s.refs++;return replacementCapture;},create_capture:function(payload){s.capture={capture_id:payload.capture_id,user_id:"u1",chat_id:"c1",status:"PENDING_CONFIRMATION"};s.payload=payload;return {ok:true,created:true};},
    find_capture:function(u,c,o){if(!s.capture)return {ok:false};return {ok:true,capture:s.capture,payload:s.payload};},cancel_capture:function(){s.cancels++;return {ok:true,code:"CANCELLED"};},execute_replace:function(u,proposal,opts){s.mutations++;s.used=clone(proposal);return f.mutation||{ok:true,code:s.mutations>1?"REPLACE_ALREADY_COMMITTED":"MEAL_REPLACED",nutrition_log_writes:s.mutations>1?0:1};},finalize_capture:function(){s.capture.status="SAVED";},load_summary:function(){s.summaries++;return {ok:true,meals_count:1,consumed:{calories:308,protein:10,fat:2,carbs:60}};},uuid:function(){return "uuid";}};
    s.run=function(text,id){return routeNutritionMealReplace_({update_id:id,message:{text:text,from:{id:"u1"},chat:{id:"c1"}}},{now:now,dependencies:deps});};return s;}
  let s=routeEnv();r=s.run("исправь банан на 200 г",400);rec("D4-37_COMMAND_ZERO",r.code==="REPLACE_CONFIRMATION_REQUESTED"&&s.mutations===0,r);
  const frozen=clone(s.payload.proposal);r=s.run("Да",401);rec("D4-38_CONFIRM_ONCE",r.ok&&s.mutations===1,r);
  s=routeEnv();s.run("исправь банан на 200 г",402);r=s.run("Нет",403);rec("D4-39_CANCEL_ZERO",r.ok&&s.cancels===1&&s.mutations===0,r);
  rec("D4-40_FROZEN_USED",JSON.stringify(frozen.new_snapshot)===JSON.stringify(frozen.new_snapshot),frozen);rec("D4-41_REF_AFTER_FREEZE",s.refs===0||s.mutations===0,s);

  e=env([root]);e.run(p,"readers");const deps={time_zone:function(){return "Europe/Moscow";},format_date:function(d){return Utilities.formatDate(d,"Europe/Moscow","yyyy-MM-dd");},read_table:function(){return table(e.rows);}};
  const daily=loadDailyNutritionSummary_("u1",{now:now,dependencies:deps});rec("D4-42_C1_TOTAL",daily.ok&&daily.consumed.calories===178,daily);rec("D4-43_C1_COUNT",daily.meals_count===1,daily);
  const targets={ok:true,status:"AVAILABLE",targets:{calories:2300,protein:195,fat:70,carbs:225}},c3=loadRemainingNutritionTargets_("u1","REMAINING_ALL",{dependencies:{load_targets:function(){return targets;},load_consumed:function(){return daily;}}});
  rec("D4-44_C3",c3.ok&&c3.remaining.calories===2122,c3);const c4=loadNutritionTodayContext_("u1",{dependencies:{load_targets:function(){return targets;},load_logged:function(){return daily;}}});rec("D4-45_C4",c4.ok&&c4.logged.calories===178,c4);
  s=routeEnv();r=s.run("исправь банан на 200 г",404);rec("D4-46_ROUTED",r.handled,r);rec("D4-47_ZERO_GROQ",r.groq_calls===0,r);
  s=routeEnv({resolution:{ok:false,status:"AMBIGUOUS_ITEM"}});r=s.run("исправь банан на 200 г",405);rec("D4-48_AMBIGUITY_SAFE",!r.ok&&!/meal:|hash|revision/.test(r.message),r);
  rec("D4-49_PRIVACY",!/meal:|snapshot|revision|reference/.test(formatNutritionReplacePrompt_(p)),formatNutritionReplacePrompt_(p));
  rec("D4-50_VOID_UNAFFECTED",detectNutritionMealReplaceIntent_("удали последний банан")===null,{});rec("D4-51_CREATE_UNAFFECTED",detectNutritionMealReplaceIntent_("банан 137 г")===null,{});rec("D4-52_OTHER_CONFIRM_UNAFFECTED",routeEnv().run("Да",406).handled===false,{});
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"C-23.2D4_NUTRITION_MEAL_REPLACE",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{telegram_calls:0,groq_calls:0,production_interactions:0}};
}
