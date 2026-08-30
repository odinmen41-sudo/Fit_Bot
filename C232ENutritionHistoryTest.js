function runC232ENutritionHistoryTests() {
  const tests=[], now=new Date("2026-08-30T12:00:00.000Z");
  function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  function clone(v){return JSON.parse(JSON.stringify(v));}
  function item(q,index){return {item_index:index||0,food_id:"banana",food_display:"банан",preparation_state:"UNKNOWN",
    nutrition_reference_id:"banana_v1",quantity_value:q,quantity_unit:"g",reference_basis_quantity:100,reference_basis_unit:"g",
    reference_calories:1,reference_protein:0.1,reference_fat:0.01,reference_carbs:0.2,calculated_calories:q,
    calculated_protein:q/10,calculated_fat:q/100,calculated_carbs:q/5,nutrition_authority:"TEST",nutrition_source:"TEST",
    nutrition_source_version:"v1",nutrition_approximate:true};}
  function row(id,type,logical,parent,rev,at,q){const items=type==="VOID"?[]:[item(q)],tot={calories:type==="VOID"?0:q,protein:type==="VOID"?0:q/10,fat:type==="VOID"?0:q/100,carbs:type==="VOID"?0:q/5};return {
    schema_version:C232D1_NUTRITION_LIFECYCLE_SCHEMA_VERSION,meal_id:"meal:"+id,capture_id:id,user_id:"u1",meal_at:at,
    confirmed_at:at,items_count:items.length,calories_total:tot.calories,protein_total:tot.protein,fat_total:tot.fat,
    carbs_total:tot.carbs,items_json:JSON.stringify(items),snapshot_hash:"hash-"+id,transaction_status:"COMMITTED",source:"TEST",
    created_at:at,updated_at:at,operation_type:type,logical_meal_id:logical||"meal:"+id,replaces_meal_id:parent||"",revision:rev||1};}
  function table(rows){return {headers:C232B4_NUTRITION_SCHEMA.slice(),rows:rows.map(nutritionMealRecordValues_)};}
  function fmt(date,zone,pattern){const shifted=new Date(new Date(date).getTime()+3*3600000);return pattern==="HH:mm"?shifted.toISOString().slice(11,16):shifted.toISOString().slice(0,10);}
  function deps(rows,targets){return {time_zone:function(){return "Europe/Moscow";},format_date:function(d){return fmt(d,null,"yyyy-MM-dd");},
    read_table:function(){return table(rows||[]);},load_targets:function(){return targets||{ok:true,status:"AVAILABLE",targets:{calories:200,protein:20,fat:10,carbs:40}};}};}
  function win(scope,date){return resolveNutritionHistoryWindow_(scope,date||now,nutritionDailyReadDependencies_(deps([])));}
  function history(rows,scope){const w=win(scope),loaded=loadNutritionHistory_("u1",w,{dependencies:deps(rows)}),daily=loaded.ok?buildNutritionDailyHistory_(loaded.effective_meals,w,{format_date_time:fmt}):[];return {window:w,loaded:loaded,daily:daily,summary:loaded.ok?buildNutritionPeriodSummary_(daily,w):null};}
  const d28="2026-08-28T09:00:00.000Z",d29="2026-08-29T09:00:00.000Z",d30a="2026-08-30T08:00:00.000Z",d30b="2026-08-30T10:00:00.000Z";

  let h=history([row("a","CREATE",null,null,1,d30a,100)],"TODAY");
  rec("E-01_CREATE_ONCE",h.summary.totals.calories===100&&h.summary.daily[0].totals.meal_count===1,h);
  h=history([row("a","CREATE",null,null,1,d30a,100),row("b","REPLACE","meal:a","meal:a",2,d30a,80)],"TODAY");
  rec("E-02_REPLACE_ONLY",h.summary.totals.calories===80&&h.summary.daily[0].totals.meal_count===1,h);
  h=history([row("a","CREATE",null,null,1,d30a,100),row("v","VOID","meal:a","meal:a",2,d30a,0)],"TODAY");
  rec("E-03_VOID_EXCLUDED",h.summary.logged_days===0,h);
  h=history([row("a","CREATE",null,null,1,d30a,100),row("b","REPLACE","meal:a","meal:a",2,d30a,80),row("c","REPLACE","meal:a","meal:b",3,d30a,60)],"TODAY");
  rec("E-04_REPLACE_CHAIN_TERMINAL",h.summary.totals.calories===60,h);
  h=history([row("a","CREATE",null,null,1,d30a,100),row("b","CREATE",null,null,1,d30b,50)],"TODAY");
  rec("E-05_MIXED_AGGREGATE",h.summary.totals.calories===150&&h.summary.daily[0].totals.meal_count===2,h);
  const corrupt=row("bad","REPLACE","meal:missing","meal:missing",2,d30a,50);h=history([corrupt],"TODAY");
  rec("E-06_CORRUPTION_FAIL_CLOSED",h.loaded.ok===false&&h.loaded.code==="DATA_INTEGRITY_ERROR",h);

  h=history([row("a","CREATE",null,null,1,d30a,100)],"TODAY");rec("E-07_TODAY_ONE",h.summary.logged_days===1,h);
  h=history([row("b","CREATE",null,null,1,d30b,50),row("a","CREATE",null,null,1,d30a,100)],"TODAY");
  rec("E-08_TODAY_CHRONOLOGICAL",h.daily[0].meals[0].local_time==="11:00"&&h.daily[0].meals[1].local_time==="13:00",h.daily);
  h=history([],"TODAY");rec("E-09_TODAY_NO_RECORDS",h.summary.code==="NO_RECORDS",h);
  h=history([row("a","CREATE",null,null,1,d29,100)],"YESTERDAY");rec("E-10_YESTERDAY_ONE",h.summary.logged_days===1,h);
  h=history([],"YESTERDAY");rec("E-11_YESTERDAY_NONE",h.daily[0].record_status==="NO_RECORDS",h);
  h=history([row("a","CREATE",null,null,1,"2026-08-29T22:30:00.000Z",100)],"TODAY");rec("E-12_LOCAL_BOUNDARY",h.summary.logged_days===1,h);

  let w=win("LAST_7_DAYS");rec("E-13_SEVEN_DATES",w.dates.length===7,w);rec("E-14_SEVEN_INCLUDES_TODAY",w.dates[6]==="2026-08-30",w);
  const seven=w.dates.map(function(date,i){return row("d"+i,"CREATE",null,null,1,date+"T09:00:00.000Z",10+i);});h=history(seven,"LAST_7_DAYS");
  rec("E-15_SEVEN_LOGGED",h.summary.logged_days===7,h);h=history([row("a","CREATE",null,null,1,d28,100),row("b","CREATE",null,null,1,d30a,50)],"LAST_7_DAYS");
  rec("E-16_MIXED_MISSING",h.summary.logged_days===2&&h.summary.no_record_days===5,h);h=history([],"LAST_7_DAYS");rec("E-17_ZERO_LOGGED",h.summary.logged_days===0,h);
  rec("E-18_NO_RECORD_NOT_ZERO",h.summary.logged_day_averages.calories===null,h);h=history([row("a","CREATE",null,null,1,d28,100),row("b","CREATE",null,null,1,d30a,50)],"LAST_7_DAYS");
  rec("E-19_PERIOD_TOTAL",h.summary.totals.calories===150,h);rec("E-20_LOGGED_DENOMINATOR",h.summary.logged_day_averages.calories===75,h);

  w=win("CURRENT_WEEK");rec("E-21_WEEK_START_MONDAY",w.dates[0]==="2026-08-24",w);rec("E-22_WEEK_END_TODAY",w.dates[w.dates.length-1]==="2026-08-30",w);
  rec("E-23_NO_FUTURE_SUNDAY",w.dates.length===7,w);w=win("CURRENT_WEEK",new Date("2026-08-24T12:00:00Z"));rec("E-24_MONDAY_ONE_DAY",w.dates.length===1,w);
  w=win("CURRENT_WEEK",new Date("2026-08-30T12:00:00Z"));rec("E-25_SUNDAY_SEVEN",w.dates.length===7,w);
  w=win("LAST_7_DAYS",new Date("2027-01-02T12:00:00Z"));rec("E-26_YEAR_BOUNDARY",w.dates[0]==="2026-12-27"&&w.dates[6]==="2027-01-02",w);

  h=history([row("a","CREATE",null,null,1,d30a,100)],"LAST_7_DAYS");let cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"AVAILABLE",targets:{calories:200,protein:10,fat:5,carbs:20}});
  rec("E-27_CAL_TARGET",cmp.ok&&cmp.evaluated_logged_days===1,cmp);rec("E-28_NO_TARGET",compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"NOT_CONFIGURED",targets:{}}).code==="TARGET_NOT_AVAILABLE",{});
  cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"PARTIAL",targets:{calories:200,protein:null,fat:null,carbs:null}});rec("E-29_PARTIAL_CALORIES",cmp.ok&&cmp.protein_evaluated_logged_days===0,cmp);
  rec("E-30_CAL_BELOW",cmp.daily[0].calories.classification==="AT_OR_BELOW_TARGET",cmp);h=history([row("a","CREATE",null,null,1,d30a,200)],"TODAY");cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"PARTIAL",targets:{calories:200,protein:null,fat:null,carbs:null}});
  rec("E-31_CAL_EQUAL",cmp.daily[0].calories.classification==="AT_OR_BELOW_TARGET",cmp);h=history([row("a","CREATE",null,null,1,d30a,250)],"TODAY");cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"AVAILABLE",targets:{calories:200,protein:25,fat:5,carbs:20}});
  rec("E-32_CAL_OVER",cmp.daily[0].calories.classification==="OVER_TARGET",cmp);const safe=formatNutritionHistory_(h.summary,{scope:"TODAY",mode:"CURRENT_GOAL_COMPARISON"},cmp);
  rec("E-33_NO_ADHERENCE_PRAISE",!/идеал|успеш|хорош/.test(safe),safe);rec("E-34_PROTEIN_EQUAL_MET",cmp.daily[0].protein.classification==="MET_OR_EXCEEDED",cmp);
  h=history([row("a","CREATE",null,null,1,d30a,100)],"TODAY");cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"AVAILABLE",targets:{calories:200,protein:20,fat:5,carbs:20}});
  rec("E-35_PROTEIN_BELOW",cmp.daily[0].protein.classification==="BELOW_TARGET",cmp);h=history([row("a","CREATE",null,null,1,d30a,300)],"TODAY");cmp=compareNutritionToCurrentTargets_(h.summary,{ok:true,status:"AVAILABLE",targets:{calories:200,protein:20,fat:5,carbs:20}});
  rec("E-36_PROTEIN_ABOVE",cmp.daily[0].protein.classification==="MET_OR_EXCEEDED",cmp);rec("E-37_NO_RECORD_EXCLUDED",cmp.protein_evaluated_logged_days===1,cmp);
  rec("E-38_CURRENT_BASIS",cmp.target_basis==="CURRENT_TARGET",cmp);rec("E-39_FORMAT_CURRENT_BASIS",/текущих целей/.test(formatNutritionHistory_(h.summary,{scope:"LAST_7_DAYS",mode:"CURRENT_GOAL_COMPARISON"},cmp)),{});
  rec("E-40_NO_HISTORICAL_TARGET",!/цель .* была|историческ/.test(formatNutritionHistory_(h.summary,{scope:"LAST_7_DAYS",mode:"CURRENT_GOAL_COMPARISON"},cmp)),{});

  function intent(text){return detectNutritionHistoryIntent_(text);}rec("E-41_ROUTE_YESTERDAY",intent("что я ел вчера").scope==="YESTERDAY",{});
  rec("E-42_ROUTE_LAST7",intent("сколько калорий за последние 7 дней").scope==="LAST_7_DAYS",{});rec("E-43_ROUTE_COMPARE",intent("как я соблюдал калории за последние 7 дней").mode==="CURRENT_GOAL_COMPARISON",{});
  rec("E-44_REMAINING_UNTOUCHED",intent("сколько осталось калорий")===null,{});rec("E-45_CREATE_UNTOUCHED",intent("банан 200 г")===null,{});
  rec("E-46_VOID_UNTOUCHED",intent("удали последний банан")===null,{});rec("E-47_REPLACE_UNTOUCHED",intent("исправь последний банан на 200 г")===null,{});
  rec("E-48_TARGET_UNTOUCHED",intent("установи цель 2300 ккал")===null,{});rec("E-49_CONFIRM_UNTOUCHED",intent("Да")===null,{});rec("E-50_GREETING_UNTOUCHED",intent("Привет")===null,{});

  h=history([row("a","CREATE",null,null,1,d30a,100)],"TODAY");const text=formatNutritionHistory_(h.summary,{scope:"TODAY",mode:"HISTORY"},null);
  rec("E-51_NO_USER_ID",!/USER_ID|u1/.test(text),text);rec("E-52_NO_LIFECYCLE_IDS",!/LOGICAL|MEAL_ID|CAPTURE/.test(text),text);
  rec("E-53_NO_HASH",!/hash|SNAPSHOT/.test(text),text);rec("E-54_NO_TECH_METADATA",!/SCHEMA|SOURCE|STATUS|REVISION/.test(text),text);
  rec("E-55_NO_REFERENCE_ID",!/nutrition_reference|banana_v1/.test(text),text);
  const upd=function(value){return {message:{text:value,from:{id:"u1"},chat:{id:"c1"}}};},routeOpts={now:now,dependencies:deps([row("a","CREATE",null,null,1,d30a,100)]),format_options:{format_date_time:fmt}};
  let routed=routeNutritionHistory_(upd("что я ел сегодня"),routeOpts);rec("E-56_DAILY_GROQ_ZERO",routed.ok&&routed.groq_calls===0,routed);
  routed=routeNutritionHistory_(upd("питание за последние 7 дней"),routeOpts);rec("E-57_WEEKLY_GROQ_ZERO",routed.ok&&routed.groq_calls===0,routed);
  routed=routeNutritionHistory_(upd("как я соблюдал калории за последние 7 дней"),routeOpts);rec("E-58_COMPARE_GROQ_ZERO",routed.ok&&routed.groq_calls===0,routed);
  rec("E-59_INVALID_TEMPORAL_TYPED",detectNutritionHistoryIntent_("покажи питание за 3 дня").code==="UNSUPPORTED_TEMPORAL_QUERY",{});
  rec("E-60_FAT_CARBS_FACTUAL_ONLY",cmp.daily[0].fat&&!cmp.daily[0].fat.classification&&cmp.daily[0].carbs&&!cmp.daily[0].carbs.classification,cmp);
  w=win("CURRENT_WEEK",new Date("2026-09-02T12:00:00Z"));rec("E-61_WEEK_MONTH_BOUNDARY",w.dates[0]==="2026-08-31"&&w.dates[2]==="2026-09-02",w);
  rec("E-62_CURRENT_TARGET_VALUES_FORMATTED",/200 ккал/.test(formatNutritionHistory_(h.summary,{scope:"TODAY",mode:"CURRENT_GOAL_COMPARISON"},cmp)),{});
  const failedLoad=loadNutritionHistory_("u1",win("TODAY"),{dependencies:{time_zone:function(){return "Europe/Moscow";},format_date:function(d){return fmt(d,null,"yyyy-MM-dd");},read_table:function(){throw new Error("private failure");}}});
  rec("E-63_READ_FAILURE_TYPED",failedLoad.ok===false&&failedLoad.code==="DATA_INTEGRITY_ERROR",failedLoad);
  rec("E-64_ROUTE_CONSUMED_TODAY",intent("сколько съел сегодня").scope==="TODAY",{});

  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"C-23.2E_NUTRITION_HISTORY",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{telegram_calls:0,groq_calls:0,production_interactions:0}};
}
