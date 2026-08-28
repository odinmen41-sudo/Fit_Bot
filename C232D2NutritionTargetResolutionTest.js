function runC232D2NutritionTargetResolutionTests() {
  const tests = [];
  const now = new Date("2026-08-28T12:00:00.000Z");
  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: passed ? {} : details || {}});
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return "d2-sha256-" + (value >>> 0).toString(16) + "-" + text.length;
  }
  function item(index, foodId, display, quantity, preparation) {
    return {item_index:index,food_id:foodId,food_display:display,preparation_state:preparation||"RAW",
      nutrition_reference_id:foodId+"_reference_v1",quantity_value:quantity,quantity_unit:"g",
      reference_basis_quantity:100,reference_basis_unit:"g",reference_calories:89,reference_protein:1.09,
      reference_fat:0.33,reference_carbs:22.84,calculated_calories:quantity*0.89,
      calculated_protein:quantity*0.0109,calculated_fat:quantity*0.0033,calculated_carbs:quantity*0.2284,
      nutrition_authority:"TEST",nutrition_source:"TEST",nutrition_source_version:"v1",nutrition_approximate:true};
  }
  function meal(id, at, items, extra) {
    const sourceItems=items||[item(0,"banana","банан",100)];
    return Object.assign({user_id:"u1",logical_meal_id:"meal:"+id,effective_meal_id:"meal:"+id,
      meal_at:at||"2026-08-28T08:00:00.000Z",confirmed_at:at||"2026-08-28T08:00:00.000Z",
      revision:1,operation_type:"CREATE",schema_version:C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION,
      snapshot_hash:"hash-"+id,source:"test",items:sourceItems,totals:{items_count:sourceItems.length,
        calories:100,protein:1,fat:0.3,carbs:23}},extra||{});
  }
  const aliases=[
    {ALIAS_NORMALIZED:"банан",FOOD_ID:"banana",VARIANT_HINT:"",PREPARATION_HINT:"RAW",PRIORITY:10,ACTIVE:true,CANONICAL_NAME:"Банан"},
    {ALIAS_NORMALIZED:"курица",FOOD_ID:"chicken",VARIANT_HINT:"",PREPARATION_HINT:"",PRIORITY:10,ACTIVE:true,CANONICAL_NAME:"Курица"},
    {ALIAS_NORMALIZED:"курица",FOOD_ID:"chicken_breast",VARIANT_HINT:"",PREPARATION_HINT:"",PRIORITY:10,ACTIVE:true,CANONICAL_NAME:"Грудка"},
    {ALIAS_NORMALIZED:"грудка",FOOD_ID:"chicken_breast",VARIANT_HINT:"",PREPARATION_HINT:"FRIED",PRIORITY:10,ACTIVE:true,CANONICAL_NAME:"Грудка"}
  ].map(foodAliasNormalizeRecord_);
  function deps(meals, extra) {
    return Object.assign({load_effective:function(){return {ok:true,effective_meals:clone(meals||[])};},
      load_food_data:function(){return {available:true,aliases:clone(aliases),references:[]};},sha256:hash,
      time_zone:function(){return "Europe/Moscow";},format_date:function(date){return Utilities.formatDate(date,"Europe/Moscow","yyyy-MM-dd");}},extra||{});
  }
  function resolve(text, meals, extra) {return resolveNutritionTarget_("u1",text,{now:now,dependencies:deps(meals,extra),
    candidate_format_options:{time_zone:"Europe/Moscow",today:"2026-08-28"}});}

  let result=parseNutritionTargetQuery_("последний приём пищи");
  record("C23.2D2-01_PARSE_LAST_MEAL",result.ok&&result.query_spec.relation==="LAST_MEAL",result);
  result=parseNutritionTargetQuery_("банан сегодня");
  record("C23.2D2-02_PARSE_EXACT_FOOD",result.ok&&result.query_spec.relation==="EXACT_FOOD"&&result.query_spec.temporal_scope==="TODAY",result);
  result=parseNutritionTargetQuery_("последний банан вчера");
  record("C23.2D2-03_PARSE_LAST_FOOD",result.ok&&result.query_spec.relation==="LAST_MATCHING_MEAL"&&result.query_spec.temporal_scope==="YESTERDAY",result);
  record("C23.2D2-04_MEAL_LABEL_UNSUPPORTED",parseNutritionTargetQuery_("последний завтрак").reason_code==="MEAL_LABEL_NOT_AVAILABLE");
  record("C23.2D2-05_PRONOUN_UNSUPPORTED",parseNutritionTargetQuery_("тот банан").reason_code==="AUTHORITATIVE_REFERENCE_CONTEXT_MISSING");
  record("C23.2D2-06_DATE_UNSUPPORTED",parseNutritionTargetQuery_("банан 27/08/2026").reason_code==="UNSUPPORTED_TEMPORAL_SCOPE");
  record("C23.2D2-07_MUTATION_VERB_OUTSIDE_PARSER",parseNutritionTargetQuery_("исправь банан").reason_code==="UNSUPPORTED_TARGET_GRAMMAR");

  result=resolve("последний прием пищи",[]);
  record("C23.2D2-08_NO_MEALS",result.status==="NOT_FOUND"&&result.reason_code==="NO_EFFECTIVE_MEALS",result);
  const early=meal("early","2026-08-28T06:00:00.000Z");
  const late=meal("late","2026-08-28T10:00:00.000Z");
  result=resolve("последний прием пищи",[early]);
  record("C23.2D2-09_ONE_LAST_MEAL",result.status==="RESOLVED_MEAL"&&result.resolved_target.logical_meal_id==="meal:early",result);
  result=resolve("последний прием пищи",[late,early]);
  record("C23.2D2-10_LATEST_MEAL_AT",result.status==="RESOLVED_MEAL"&&result.resolved_target.logical_meal_id==="meal:late",result);
  const tied=meal("tied",late.meal_at);
  result=resolve("последний прием пищи",[late,tied]);
  record("C23.2D2-11_EQUAL_TIME_AMBIGUOUS",result.status==="AMBIGUOUS_MEAL"&&result.candidates.length===2,result);
  const replaced=meal("old","2026-08-28T05:00:00.000Z",null,{effective_meal_id:"meal:replacement",revision:2,
    operation_type:"REPLACE",confirmed_at:"2026-08-28T11:59:00.000Z",snapshot_hash:"hash-replacement"});
  result=resolve("последний прием пищи",[replaced,late]);
  record("C23.2D2-12_CONFIRMATION_NOT_RECENCY",result.resolved_target.logical_meal_id==="meal:late",result);
  const brokenMeal=meal("broken");brokenMeal.snapshot_hash="";
  record("C23.2D2-13_FROZEN_IDENTITY_REQUIRED",resolve("последний прием пищи",[brokenMeal]).reason_code==="EFFECTIVE_MEAL_INTEGRITY_ERROR");

  result=resolve("банан",[early]);
  record("C23.2D2-14_CANONICAL_ALIAS",result.status==="RESOLVED_ITEM"&&result.resolved_target.item_selector.food_id==="banana",result);
  record("C23.2D2-15_FROZEN_MEAL_FIELDS",result.resolved_target.meal_target.user_id==="u1"&&
    result.resolved_target.meal_target.snapshot_hash==="hash-early"&&result.resolved_target.meal_target.operation_type==="CREATE",result);
  record("C23.2D2-16_FROZEN_ITEM_FIELDS",result.resolved_target.item_selector.item_index===0&&
    result.resolved_target.item_selector.quantity_value===100&&!!result.resolved_target.item_selector.item_fingerprint,result);
  result=resolve("банан",[early,late]);
  record("C23.2D2-17_MULTIPLE_FOOD_MEALS",result.status==="AMBIGUOUS_MEAL"&&result.reason_code==="MULTIPLE_MATCHING_MEALS",result);
  result=resolve("последний банан",[early,late]);
  record("C23.2D2-18_LAST_MATCHING",result.status==="RESOLVED_ITEM"&&result.resolved_target.meal_target.logical_meal_id==="meal:late",result);
  result=resolve("последний банан",[late,tied]);
  record("C23.2D2-19_LAST_MATCHING_TIE",result.status==="AMBIGUOUS_MEAL"&&result.reason_code==="LATEST_MEAL_TIME_TIE",result);
  const duplicate=meal("duplicate",null,[item(0,"banana","банан",100),item(1,"banana","банан",50)]);
  result=resolve("банан",[duplicate]);
  record("C23.2D2-20_DUPLICATE_ITEM",result.status==="AMBIGUOUS_ITEM"&&result.candidates.length===2,result);
  record("C23.2D2-20A_DUPLICATE_DESCRIPTORS_DISTINGUISH",result.candidate_descriptors[0].items_summary!==
    result.candidate_descriptors[1].items_summary&&result.candidate_descriptors[0].calories!==result.candidate_descriptors[1].calories,
    result.candidate_descriptors);
  result=resolve("банан",[duplicate,late]);
  record("C23.2D2-21_MEAL_AMBIGUITY_PRECEDENCE",result.status==="AMBIGUOUS_MEAL",result);

  const chicken=meal("chicken",null,[item(0,"chicken_breast","грудка жареная",200,"FRIED")]);
  result=resolve("жареная грудка",[chicken]);
  record("C23.2D2-22_PREPARATION_MATCH",result.status==="RESOLVED_ITEM",result);
  result=resolve("вареная грудка",[chicken]);
  record("C23.2D2-23_PREPARATION_MISMATCH",result.status==="NOT_FOUND"&&result.reason_code==="FOOD_NOT_FOUND",result);
  record("C23.2D2-24_ALIAS_NOT_FOUND",resolve("авокадо",[early]).reason_code==="FOOD_ALIAS_NOT_FOUND");
  record("C23.2D2-25_ALIAS_AMBIGUOUS",resolve("курица",[chicken]).reason_code==="FOOD_ALIAS_AMBIGUOUS");
  result=resolve("банан",[early],{load_food_data:function(){return {available:false,aliases:[]};}});
  record("C23.2D2-26_REFERENCE_UNAVAILABLE",result.status==="DATA_INTEGRITY_ERROR"&&result.reason_code==="FOOD_REFERENCE_UNAVAILABLE",result);
  const yogurt=meal("yogurt",null,[item(0,"yogurt","банан",150)]);
  record("C23.2D2-27_NO_DISPLAY_FALLBACK",resolve("банан",[yogurt]).reason_code==="FOOD_NOT_FOUND");

  const malformed=meal("malformed");delete malformed.items[0].food_id;
  result=resolve("банан",[malformed]);
  record("C23.2D2-28_MALFORMED_ITEM_FAILS",result.status==="DATA_INTEGRITY_ERROR"&&result.reason_code==="ITEM_IDENTITY_INVALID",result);
  result=resolve("последний прием пищи",[malformed]);
  record("C23.2D2-29_MEAL_TARGET_IGNORES_ITEM_IDENTITY",result.status==="RESOLVED_MEAL",result);
  const wrongIndex=meal("index");wrongIndex.items[0].item_index=2;
  record("C23.2D2-30_ITEM_INDEX_STRICT",resolve("банан",[wrongIndex]).reason_code==="ITEM_IDENTITY_INVALID");
  const negativeMacro=meal("macro");negativeMacro.items[0].calculated_calories=-1;
  record("C23.2D2-31_ITEM_MACRO_STRICT",resolve("банан",[negativeMacro]).reason_code==="ITEM_IDENTITY_INVALID");

  const fp1=nutritionItemFingerprint_(early.items[0],{sha256:hash});
  const fp2=nutritionItemFingerprint_(clone(early.items[0]),{sha256:hash});
  const changedItem=clone(early.items[0]);changedItem.quantity_value=101;
  record("C23.2D2-32_FINGERPRINT_STABLE",fp1===fp2,{fp1:fp1,fp2:fp2});
  record("C23.2D2-33_FINGERPRINT_CONTENT",fp1!==nutritionItemFingerprint_(changedItem,{sha256:hash}));
  const reorderedItem={food_id:early.items[0].food_id,item_index:0,preparation_state:"RAW",quantity_unit:"g",
    quantity_value:100,nutrition_reference_id:"banana_reference_v1",calculated_carbs:22.84,calculated_fat:0.33,
    calculated_protein:1.09,calculated_calories:89};
  record("C23.2D2-34_FINGERPRINT_CANONICAL",fp1===nutritionItemFingerprint_(reorderedItem,{sha256:hash}));

  record("C23.2D2-35_TODAY_CALENDAR",nutritionCalendarDate_(now,"Europe/Moscow",0,function(){return "2026-08-28";})==="2026-08-28");
  record("C23.2D2-36_YESTERDAY_CALENDAR",nutritionCalendarDate_(now,"Europe/Moscow",-1,function(){return "2026-03-01";})==="2026-02-28");
  let capturedWindow=null;
  result=resolve("банан вчера",[early],{load_effective:function(user,window){capturedWindow=window;return {ok:true,effective_meals:[early]};}});
  record("C23.2D2-37_YESTERDAY_WINDOW",capturedWindow&&capturedWindow.date==="2026-08-27"&&capturedWindow.time_zone==="Europe/Moscow",capturedWindow);
  result=resolve("банан сегодня",[early]);
  record("C23.2D2-38_TODAY_QUERY",result.status==="RESOLVED_ITEM",result);

  result=resolve("банан",[early,late]);
  const descriptors=result.candidate_descriptors;
  record("C23.2D2-39_SAFE_DESCRIPTOR_COUNT",descriptors&&descriptors.length===2,descriptors);
  record("C23.2D2-40_SAFE_DESCRIPTOR_FIELDS",descriptors&&descriptors.every(function(value){return value.ordinal&&value.local_date&&value.local_time&&value.items_summary;}),descriptors);
  const descriptorJson=JSON.stringify(descriptors||[]);
  record("C23.2D2-41_NO_INTERNAL_IDS",descriptorJson.indexOf("logical_meal_id")<0&&descriptorJson.indexOf("snapshot_hash")<0&&descriptorJson.indexOf("nutrition_reference_id")<0,descriptorJson);
  record("C23.2D2-42_NO_USER_ID",descriptorJson.indexOf("user_id")<0&&descriptorJson.indexOf("u1")<0,descriptorJson);

  function row(id,user,status,type,logical,parent,revision,at) {
    const rowItems=[item(0,"banana","банан",100)];
    return {schema_version:type?C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION:C232D1_NUTRITION_LEGACY_SCHEMA_VERSION,
      meal_id:"meal:"+id,capture_id:id,user_id:user||"u1",meal_at:at||"2026-08-28T08:00:00.000Z",
      confirmed_at:at||"2026-08-28T08:00:00.000Z",items_count:1,calories_total:89,protein_total:1.09,
      fat_total:0.33,carbs_total:22.84,items_json:JSON.stringify(rowItems),snapshot_hash:"hash-"+id,
      transaction_status:status||"COMMITTED",source:"test",created_at:at||"2026-08-28T08:00:00.000Z",
      updated_at:at||"2026-08-28T08:00:00.000Z",operation_type:type||"",logical_meal_id:type?logical||"meal:"+id:"",
      replaces_meal_id:type?parent||"":"",revision:type?revision||1:""};
  }
  function table(rows){return {headers:C232B4_NUTRITION_SCHEMA.slice(),rows:rows.map(nutritionMealRecordValues_)};}
  let loaded=loadEffectiveNutritionMeals_("u1",table([row("legacy")]),null,function(){});
  record("C23.2D2-43_D1_LEGACY_SOURCE",loaded.ok&&loaded.effective_meals[0].schema_version===C232D1_NUTRITION_LEGACY_SCHEMA_VERSION,loaded);
  loaded=loadEffectiveNutritionMeals_("u1",table([row("life","u1","COMMITTED","CREATE")]),null,function(){});
  record("C23.2D2-44_D1_LIFECYCLE_SOURCE",loaded.ok&&loaded.effective_meals[0].user_id==="u1"&&loaded.effective_meals[0].snapshot_hash==="hash-life",loaded);
  const root=row("root","u1","COMMITTED","CREATE");
  const replacement=row("replacement","u1","COMMITTED","REPLACE","meal:root","meal:root",2,root.meal_at);
  loaded=loadEffectiveNutritionMeals_("u1",table([root,replacement]),null,function(){});
  record("C23.2D2-45_D1_TERMINAL_REPLACE",loaded.ok&&loaded.effective_meals.length===1&&loaded.effective_meals[0].effective_meal_id==="meal:replacement",loaded);
  const voidRow=row("void","u1","COMMITTED","VOID","meal:root","meal:root",2,root.meal_at);
  voidRow.items_count=0;voidRow.items_json="[]";voidRow.calories_total=0;voidRow.protein_total=0;voidRow.fat_total=0;voidRow.carbs_total=0;
  loaded=loadEffectiveNutritionMeals_("u1",table([root,voidRow]),null,function(){});
  record("C23.2D2-46_D1_VOID_EXCLUDED",loaded.ok&&loaded.effective_meals.length===0&&loaded.voided_meals.length===1,loaded);
  loaded=loadEffectiveNutritionMeals_("u1",table([root,row("preparing","u1","PREPARING","CREATE")]),null,function(){});
  record("C23.2D2-47_D1_PREPARING_EXCLUDED",loaded.ok&&loaded.effective_meals.length===1,loaded);
  const malformedLifecycle=row("bad","u1","COMMITTED","REPLACE","meal:root","meal:missing",2);
  loaded=loadEffectiveNutritionMeals_("u1",table([root,malformedLifecycle]),null,function(){});
  record("C23.2D2-48_D1_INTEGRITY_PROPAGATES",!loaded.ok&&loaded.code==="DATA_INTEGRITY_ERROR",loaded);
  loaded=loadEffectiveNutritionMeals_("u1",table([root,row("foreign","u2","COMMITTED","CREATE")]),null,function(){});
  record("C23.2D2-49_D1_USER_SCOPE",loaded.ok&&loaded.effective_meals.length===1&&loaded.effective_meals[0].user_id==="u1",loaded);

  let calls=0;
  result=resolveNutritionTarget_("u1",{relation:"LAST_MEAL",target_scope_hint:"MEAL",temporal_scope:"ANY",food_text:null},{dependencies:{
    load_effective:function(){calls+=1;return {ok:true,effective_meals:[early]};},time_zone:function(){return "Europe/Moscow";},
    format_date:function(){return "2026-08-28";},sha256:hash}});
  record("C23.2D2-50_FACADE_D1_API_ONCE",result.ok&&calls===1,{result:result,calls:calls});
  record("C23.2D2-51_INVALID_TEMPORAL_SPEC",resolveNutritionTarget_("u1",{relation:"LAST_MEAL",temporal_scope:"WEEK"},{dependencies:deps([early])}).reason_code==="UNSUPPORTED_TEMPORAL_SCOPE");
  record("C23.2D2-52_EFFECTIVE_FAILURE",resolve("банан",[early],{load_effective:function(){return {ok:false};}}).reason_code==="EFFECTIVE_MEAL_INTEGRITY_ERROR");
  record("C23.2D2-53_OPERATION_FROZEN",result.resolved_target.operation_type==="CREATE",result);
  record("C23.2D2-54_ITEMS_DEEP_FROZEN",result.resolved_target.items!==early.items&&result.resolved_target.items[0]!==early.items[0],result);
  record("C23.2D2-55_STATUS_MODEL",["RESOLVED_MEAL","RESOLVED_ITEM","AMBIGUOUS_MEAL","AMBIGUOUS_ITEM","NOT_FOUND","UNSUPPORTED_QUERY","DATA_INTEGRITY_ERROR"].every(function(status){return typeof status==="string";}));
  record("C23.2D2-56_NO_ITEMS_JSON_PROJECTION",loaded.ok&&loaded.effective_meals.every(function(value){return !("items_json" in value);}),loaded);

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2D2_NUTRITION_TARGET_RESOLUTION",status:passed===tests.length?"PASS":"FAIL",
    total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{sheet_writes:0,pending_capture_writes:0,script_property_changes:0,telegram_calls:0,
      groq_calls:0,production_interactions:0,production_writes:0}};
}
