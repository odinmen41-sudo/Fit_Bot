function runC232D1NutritionLifecycleFoundationTests() {
  const tests = [];
  const today = new Date("2026-08-26T12:00:00.000Z");
  const todayAt = "2026-08-26T08:00:00.000Z";
  const yesterdayAt = "2026-08-25T08:00:00.000Z";
  function record(id, passed, details) {
    tests.push({id:id,status:passed?"PASS":"FAIL",details:passed?{}:details||{}});
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function base(id, user, at, totals) {
    const values = totals || {calories:100,protein:10,fat:3,carbs:12};
    return {schema_version:C232D1_NUTRITION_LEGACY_SCHEMA_VERSION,meal_id:"meal:"+id,capture_id:id,
      user_id:user||"u1",meal_at:at||todayAt,confirmed_at:at||todayAt,items_count:1,
      calories_total:values.calories,protein_total:values.protein,fat_total:values.fat,carbs_total:values.carbs,
      items_json:JSON.stringify([{item_index:0,food_id:"food-"+id}]),snapshot_hash:"hash-"+id,
      transaction_status:"COMMITTED",source:"test",created_at:at||todayAt,updated_at:at||todayAt,
      operation_type:"",logical_meal_id:"",replaces_meal_id:"",revision:""};
  }
  function lifecycle(id, type, logical, parent, revision, at, totals) {
    const row = base(id,"u1",at||todayAt,totals);
    row.schema_version=C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION;
    row.operation_type=type; row.logical_meal_id=logical; row.replaces_meal_id=parent||""; row.revision=revision;
    if (type==="VOID") { row.items_count=0; row.items_json="[]"; row.calories_total=0; row.protein_total=0; row.fat_total=0; row.carbs_total=0; }
    return row;
  }
  function normalize(row) { return normalizeNutritionLifecycleRow_(row); }
  function op(row) { const result=normalize(row); return result.ok?result.operation:null; }
  function rowValues(row) { return nutritionMealRecordValues_(row); }
  function table(rows) { return {headers:C232B4_NUTRITION_SCHEMA.slice(),rows:(rows||[]).map(rowValues)}; }
  function deps(rows) { return {time_zone:function(){return "Europe/Moscow";},
    format_date:function(date){return Utilities.formatDate(date,"Europe/Moscow","yyyy-MM-dd");},
    read_table:function(){return table(rows);}}; }
  function daily(rows,user,now) { return loadDailyNutritionSummary_(user||"u1",{now:now||today,dependencies:deps(rows)}); }

  let legacy=base("legacy"); let result=normalize(legacy);
  record("C23.2D1-01_LEGACY_RECOGNIZED",result.ok,result);
  record("C23.2D1-02_LEGACY_CREATE",result.ok&&result.operation.operation_type==="CREATE",result);
  record("C23.2D1-03_LEGACY_LOGICAL_ID",result.ok&&result.operation.logical_meal_id===legacy.meal_id,result);
  record("C23.2D1-04_LEGACY_REVISION",result.ok&&result.operation.revision===1,result);
  record("C23.2D1-05_LEGACY_NO_MUTATION",legacy.operation_type===""&&legacy.logical_meal_id==="",legacy);
  record("C23.2D1-06_LEGACY_TOTALS",result.ok&&result.operation.totals.calories===100,result);

  const create=lifecycle("create","CREATE","meal:create","",1);
  result=normalize(create);
  record("C23.2D1-07_CREATE_VALID",result.ok,result);
  record("C23.2D1-08_CREATE_IDENTITY",result.ok&&result.operation.logical_meal_id===result.operation.meal_id,result);
  record("C23.2D1-09_CREATE_REVISION",result.ok&&result.operation.revision===1&&!result.operation.replaces_meal_id,result);
  record("C23.2D1-10_CREATE_SCHEMA",result.ok&&result.operation.schema_version===C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION,result);
  record("C23.2D1-11_CREATE_TOTALS",result.ok&&result.operation.totals.protein===10,result);

  const builtCapture={items:[{fields:{food_id:{value:"rice"},food_display:{value:"rice"},preparation_state:{value:"BOILED"},
    nutrition_reference_id:{value:"r"},quantity_value:{value:100},quantity_unit:{value:"g"},
    reference_nutrition_basis:{value:{quantity:100,unit:"g",calories:100,protein:10,fat:3,carbs:12}},
    calculated_nutrition:{value:{calories:100,protein:10,fat:3,carbs:12}},nutrition_authority:{value:"a"},
    nutrition_source:{value:"s"},nutrition_source_version:{value:"v"},nutrition_approximate:{value:true}}}],
    nutrition_calculation:{totals:{calories:100,protein:10,fat:3,carbs:12}}};
  const builtOwner={capture_id:"writer",user_id:"u1"};
  function fakeHash(text){return "hash:"+text;}
  const builtA=buildNutritionMealRecord_(builtCapture,builtOwner,new Date(todayAt),{sha256:fakeHash});
  const builtB=buildNutritionMealRecord_(builtCapture,builtOwner,new Date(todayAt),{sha256:fakeHash});
  record("C23.2D1-12_WRITER_LIFECYCLE_CREATE",builtA.schema_version===C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION&&
    builtA.operation_type==="CREATE"&&builtA.logical_meal_id===builtA.meal_id&&builtA.replaces_meal_id===""&&builtA.revision===1,builtA);
  record("C23.2D1-13_HASH_DETERMINISTIC",builtA.snapshot_hash===builtB.snapshot_hash,builtA);
  const changedBuilt=clone(builtCapture);changedBuilt.nutrition_calculation.totals.calories=101;
  record("C23.2D1-14_HASH_CONTENT_PROTECTED",builtA.snapshot_hash!==buildNutritionMealRecord_(changedBuilt,builtOwner,new Date(todayAt),{sha256:fakeHash}).snapshot_hash,{});

  result=daily([legacy,create]);
  record("C23.2D1-15_MIXED_AGGREGATE",result.ok&&result.meals_count===2&&result.consumed.calories===200,result);

  const invalidPhysical=[
    ["UNKNOWN_SCHEMA",Object.assign(base("x"),{schema_version:"unknown"})],
    ["LEGACY_OPERATION",Object.assign(base("x"),{operation_type:"CREATE"})],
    ["LEGACY_LOGICAL",Object.assign(base("x"),{logical_meal_id:"meal:x"})],
    ["MISSING_OPERATION",Object.assign(lifecycle("x","CREATE","meal:x","",1),{operation_type:""})],
    ["MISSING_LOGICAL",Object.assign(lifecycle("x","CREATE","meal:x","",1),{logical_meal_id:""})],
    ["CREATE_PARENT",lifecycle("x","CREATE","meal:x","meal:p",1)],
    ["CREATE_REVISION",lifecycle("x","CREATE","meal:x","",2)],
    ["NONINTEGER_REVISION",lifecycle("x","CREATE","meal:x","",1.5)],
    ["UNKNOWN_OPERATION",lifecycle("x","DELETE","meal:x","meal:p",2)]
  ];
  invalidPhysical.forEach(function(test,index){const value=normalize(test[1]);record("C23.2D1-"+(16+index)+"_"+test[0],!value.ok&&value.code==="DATA_INTEGRITY_ERROR",value);});

  const root=lifecycle("root","CREATE","meal:root","",1);
  const replace=lifecycle("replace","REPLACE","meal:root","meal:root",2,todayAt,{calories:70,protein:8,fat:2,carbs:9});
  const replace2=lifecycle("replace2","REPLACE","meal:root","meal:replace",3,todayAt,{calories:60,protein:7,fat:2,carbs:8});
  const voidRow=lifecycle("void","VOID","meal:root","meal:replace",3,todayAt);
  function resolve(rows){return resolveNutritionMealLifecycles_(rows.map(op));}
  result=resolve([root]);record("C23.2D1-25_CREATE_CHAIN",result.ok&&result.effective_meals.length===1,result);
  result=resolve([root,replace]);record("C23.2D1-26_REPLACE_CHAIN",result.ok&&result.effective_meals[0].totals.calories===70,result);
  result=resolve([root,replace,replace2]);record("C23.2D1-27_MULTI_REPLACE",result.ok&&result.effective_meals[0].revision===3,result);
  result=resolve([root,lifecycle("void2","VOID","meal:root","meal:root",2,todayAt)]);
  record("C23.2D1-28_CREATE_VOID",result.ok&&result.effective_meals.length===0&&result.voided_meals.length===1,result);
  result=resolve([root,replace,voidRow]);record("C23.2D1-29_REPLACE_VOID",result.ok&&result.effective_meals.length===0,result);

  const invalidChains=[
    ["DUPLICATE_ROOT",[root,lifecycle("root2","CREATE","meal:root","",1)]],
    ["MISSING_PARENT",[root,lifecycle("c","REPLACE","meal:root","meal:missing",2)]],
    ["CROSS_LOGICAL",[root,lifecycle("other","CREATE","meal:other","",1),lifecycle("c","REPLACE","meal:root","meal:other",2)]],
    ["SELF_PARENT",[root,lifecycle("self","REPLACE","meal:root","meal:self",2)]],
    ["REVISION_GAP",[root,lifecycle("gap","REPLACE","meal:root","meal:root",3)]],
    ["DUPLICATE_REVISION",[root,replace,lifecycle("dup","REPLACE","meal:root","meal:replace",2)]],
    ["FORK",[root,replace,lifecycle("fork","VOID","meal:root","meal:root",2)]],
    ["AFTER_VOID",[root,lifecycle("v","VOID","meal:root","meal:root",2),lifecycle("after","REPLACE","meal:root","meal:v",3)]],
    ["MEAL_AT_MISMATCH",[root,lifecycle("date","REPLACE","meal:root","meal:root",2,yesterdayAt)]]
  ];
  invalidChains.forEach(function(test,index){const value=resolve(test[1]);record("C23.2D1-"+(30+index)+"_"+test[0],!value.ok&&value.code==="DATA_INTEGRITY_ERROR",value);});
  const cycleA=clone(op(replace)); const cycleB=clone(op(replace2));
  cycleA.replaces_meal_id=cycleB.meal_id; cycleB.replaces_meal_id=cycleA.meal_id;
  result=resolveNutritionMealLifecycles_([op(root),cycleA,cycleB]);
  record("C23.2D1-39_CYCLE_FAILS_CLOSED",!result.ok&&result.code==="DATA_INTEGRITY_ERROR",result);
  const crossRoot=lifecycle("foreign","CREATE","meal:foreign","",1);crossRoot.user_id="u2";
  const crossChild=lifecycle("cross","REPLACE","meal:foreign","meal:foreign",2);crossChild.user_id="u1";
  result=resolveNutritionMealLifecycles_([op(crossRoot),op(crossChild)]);
  record("C23.2D1-40_CROSS_USER_PARENT",!result.ok&&result.code==="DATA_INTEGRITY_ERROR",result);

  const validVoid=lifecycle("validvoid","VOID","meal:root","meal:root",2);
  record("C23.2D1-41_VOID_VALID",normalize(validVoid).ok,normalize(validVoid));
  [
    ["VOID_CALORIES",function(r){r.calories_total=1;}],
    ["VOID_MACRO",function(r){r.protein_total=1;}],
    ["VOID_ITEMS",function(r){r.items_json=JSON.stringify([{x:1}]);r.items_count=1;}],
    ["VOID_COUNT",function(r){r.items_count=1;}]
  ].forEach(function(test,index){const row=clone(validVoid);test[1](row);const value=normalize(row);
    record("C23.2D1-"+(42+index)+"_"+test[0],!value.ok&&value.code==="DATA_INTEGRITY_ERROR",value);});

  const preparing=lifecycle("prep","CREATE","meal:prep","",1);preparing.transaction_status="PREPARING";
  result=daily([root,preparing]);record("C23.2D1-46_PREPARING_CREATE_IGNORED",result.ok&&result.meals_count===1,result);
  const prepChild=clone(replace);prepChild.transaction_status="PREPARING";
  result=daily([root,prepChild]);record("C23.2D1-47_PREPARING_CHILD_IGNORED",result.ok&&result.consumed.calories===100,result);
  const committedGrand=lifecycle("grand","REPLACE","meal:root","meal:replace",3);
  result=daily([root,prepChild,committedGrand]);record("C23.2D1-48_PREPARING_PARENT_NOT_LINKABLE",!result.ok,result);

  result=daily([lifecycle("old","CREATE","meal:old","",1,yesterdayAt)]);
  record("C23.2D1-49_YESTERDAY_EXCLUDED",result.ok&&result.meals_count===0,result);
  result=daily([root,lifecycle("bad-date","REPLACE","meal:root","meal:root",2,yesterdayAt)]);
  record("C23.2D1-50_GLOBAL_BEFORE_TEMPORAL",!result.ok&&result.code==="DATA_INTEGRITY_ERROR",result);
  result=daily([legacy]);record("C23.2D1-51_C1_LEGACY",result.ok&&result.consumed.calories===100,result);
  result=daily([create]);record("C23.2D1-52_C1_LIFECYCLE",result.ok&&result.consumed.calories===100,result);
  result=daily([root,replace]);record("C23.2D1-53_C1_REPLACE_ONCE",result.ok&&result.meals_count===1&&result.consumed.calories===70,result);
  result=daily([root,lifecycle("v2","VOID","meal:root","meal:root",2)]);
  record("C23.2D1-54_C1_VOID_EXCLUDED",result.ok&&result.meals_count===0&&result.consumed.calories===0,result);

  const target={ok:true,code:"TARGETS_AVAILABLE",status:"AVAILABLE",targets:{calories:2300,protein:195,fat:70,carbs:225}};
  result=loadRemainingNutritionTargets_("u1","REMAINING_ALL",{dependencies:{load_targets:function(){return target;},
    load_consumed:function(){return daily([root,replace]);}}});
  record("C23.2D1-55_C3_INHERITS",result.ok&&result.consumed.calories===70&&result.remaining.calories===2230,result);
  result=loadRemainingNutritionTargets_("u1","REMAINING_ALL",{dependencies:{load_targets:function(){return target;},
    load_consumed:function(){return daily([root,lifecycle("broken","REPLACE","meal:root","meal:missing",2)]);}}});
  record("C23.2D1-56_C3_FAIL_CLOSED",!result.ok&&result.remaining===null,result);
  result=loadNutritionTodayContext_("u1",{dependencies:{load_targets:function(){return target;},load_logged:function(){return daily([root,replace]);}}});
  record("C23.2D1-57_C4_INHERITS",result.ok&&result.logged.calories===70,result);
  result=loadNutritionTodayContext_("u1",{dependencies:{load_targets:function(){return target;},
    load_logged:function(){return daily([root,lifecycle("broken2","REPLACE","meal:root","meal:none",2)]);}}});
  record("C23.2D1-58_C4_FAIL_CLOSED",!result.ok&&result.code==="DATA_INTEGRITY_ERROR",result);

  const otherBroken=Object.assign(base("other","u2"),{schema_version:"unknown"});
  result=daily([legacy,otherBroken],"u1");
  record("C23.2D1-59_USER_ISOLATION",result.ok&&result.meals_count===1,result);
  const userChild=lifecycle("user-child","REPLACE","meal:foreign","meal:foreign",2);userChild.user_id="u1";
  result=daily([crossRoot,userChild],"u1");
  record("C23.2D1-60_CROSS_USER_LINK_FAILS",!result.ok&&result.code==="DATA_INTEGRITY_ERROR",result);

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2D1_NUTRITION_LIFECYCLE_FOUNDATION",status:passed===tests.length?"PASS":"FAIL",
    total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{sheet_writes:0,script_property_changes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
