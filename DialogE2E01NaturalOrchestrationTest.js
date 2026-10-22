/** DIALOG-E2E-01 deterministic natural-dialog orchestration acceptance suite. */
function runDialogE2E01NaturalOrchestrationTests() {
  const tests=[];
  function record(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  const groups=[
    ["NUTRITION","HISTORY_TODAY",["покажи что я сегодня ел","что было из еды сегодня","покажи питание за сегодня","напомни что я ел сегодня"]],
    ["NUTRITION","DAILY_TOTAL",["сколько я сегодня съел","сколько калорий уже набрал","какой итог по еде сегодня","подведи итог питания за сегодня"]],
    ["NUTRITION","REMAINING",["сколько еще могу съесть","какой остаток по калориям","сколько осталось на сегодня","что еще можно съесть сегодня"]],
    ["WEIGHT","CURRENT",["мой вес сейчас","сколько я сейчас вешу","покажи последний вес","какой мой последний вес"]],
    ["WEIGHT","TREND",["как меняется мой вес","что с весом за последнее время","покажи изменение веса","есть ли прогресс по весу"]],
    ["WORKOUT","TODAY",["какой план на сегодня","что тренируем сегодня","покажи план тренировки","какая тренировка по плану"]],
    ["WORKOUT","START",["давай тренироваться","начать занятие","поехали тренироваться","запусти тренировку"],"SESSION_MUTATION"],
    ["WORKOUT","NEXT",["следующее упражнение","что теперь делать в тренировке","покажи следующее упражнение","куда дальше по тренировке"]],
    ["WORKOUT","DONE",["что уже успел сделать","покажи выполненные упражнения","что выполнено в тренировке","сколько уже сделал в зале"]],
    ["WORKOUT","OVERVIEW",["покажи план и факт","как идет моя тренировка","покажи текущую тренировку целиком","сверь план и выполнение"]],
    ["DASHBOARD","TODAY",["как у меня дела сегодня","дай сводку за сегодня","покажи мой день","что у меня сегодня по всем показателям"]],
    ["RECOVERY","STATUS",["как я восстановился","что с восстановлением","оцени мое восстановление","как у меня с восстановлением"]]
  ];
  let ordinal=1;
  groups.forEach(function(group){group[2].forEach(function(text){const result=naturalDialogDecision_(text),policy=group[3]||"READ_ONLY";record("DE-"+String(ordinal++).padStart(2,"0"),result&&result.domain===group[0]&&result.action===group[1]&&result.confidence===1&&result.mutation_policy===policy,{text:text,result:result});});});
  const routed=[];const routeMocks={};groups.forEach(function(group){const key=group[0]+":"+group[1];routeMocks[key]=function(update){routed.push({key:key,text:update.message.text});return {handled:true,ok:true,code:"MOCK_"+group[1],message:"ok",sheet_writes:0};};});
  groups.forEach(function(group,index){const result=routeNaturalDialogAction_({update_id:"route-"+index,message:{text:group[2][0],from:{id:"u1"},chat:{id:"u1"}}},{routes:routeMocks});record("DE-ROUTE-"+String(index+1).padStart(2,"0"),result.handled&&result.ok&&result.orchestrated&&result.decision.domain===group[0]&&routed[index].text===result.decision.canonical&&result.groq_calls===0&&result.production_writes===false,result);});
  const detectorByKey={"NUTRITION:HISTORY_TODAY":detectNutritionHistoryIntent_,"NUTRITION:DAILY_TOTAL":detectDailyNutritionQueryIntent_,"NUTRITION:REMAINING":detectRemainingNutritionQueryIntent_,"WEIGHT:CURRENT":detectWeightTrendIntent_,"WEIGHT:TREND":detectWeightTrendIntent_,"WORKOUT:TODAY":detectWorkoutPlanIntent_,"WORKOUT:START":detectWorkoutLoggingHistoryIntent_,"WORKOUT:NEXT":detectWorkoutLoggingHistoryIntent_,"WORKOUT:DONE":detectWorkoutLoggingHistoryIntent_,"WORKOUT:OVERVIEW":detectWorkoutLoggingHistoryIntent_,"DASHBOARD:TODAY":detectDailyDashboardIntent_,"RECOVERY:STATUS":detectRecoveryIntent_};
  groups.forEach(function(group,index){const decision=naturalDialogDecision_(group[2][0]),detector=detectorByKey[group[0]+":"+group[1]],detected=detector&&detector(decision.canonical);record("DE-CANONICAL-CONTRACT-"+String(index+1).padStart(2,"0"),!!detected,{canonical:decision.canonical,detected:detected});});
  ["Да","нет","Отмена","воде","на молоке","250"].forEach(function(text){record("DE-SHORT-"+text,naturalDialogDecision_(text)===null,{text:text,result:naturalDialogDecision_(text)});});
  const dialogRows=[];const dialogDeps={find_dialog:function(user,chat){const row=dialogRows.filter(function(item){return item.user_id===user&&item.chat_id===chat&&item.status==="PENDING_CONFIRMATION";})[0];return row?{ok:true,capture:row,payload:row.payload}:{ok:false,code:"NO_DIALOG_CLARIFICATION"};},get_pending:function(){return {ok:false,code:"NO_ACTIVE_CAPTURE"};},create_capture:function(payload,meta){dialogRows.push({user_id:String(meta.user_id),chat_id:String(meta.chat_id),status:"PENDING_CONFIRMATION",payload:payload});return {ok:true,created:true};},cancel_capture:function(user,chat){const row=dialogRows.filter(function(item){return item.user_id===user&&item.chat_id===chat&&item.status==="PENDING_CONFIRMATION";})[0];if(!row)return {ok:false,code:"NO_ACTIVE_CAPTURE"};row.status="CANCELLED";return {ok:true,code:"CANCELLED"};}};
  const ambiguous=routeNaturalDialogAction_({update_id:"ambiguous",message:{text:"удали последнее",from:{id:"u1"},chat:{id:"u1"}}},{now:new Date("2026-10-22T10:00:00Z"),dependencies:dialogDeps});
  record("DE-AMBIGUOUS-NO-DOMAIN-MUTATION",ambiguous.handled&&ambiguous.ok&&ambiguous.code==="DIALOG_CLARIFICATION_REQUIRED"&&ambiguous.sheet_writes===0&&ambiguous.groq_calls===0&&ambiguous.pending_capture_writes===1,ambiguous);
  record("DE-AMBIGUOUS-OPTIONS",/приём пищи/.test(ambiguous.message)&&/подход/.test(ambiguous.message),ambiguous);
  const continuationRoutes={"NUTRITION:VOID":function(){return {handled:true,ok:true,code:"VOID_CONFIRMATION_REQUESTED",message:"Подтвердите удаление",nutrition_log_writes:0};}};
  const originalVoid=routeNutritionMealVoid_;routeNutritionMealVoid_=function(update){return continuationRoutes["NUTRITION:VOID"](update);};
  const continued=routeNaturalDialogAction_({update_id:"answer",message:{text:"приём пищи",from:{id:"u1"},chat:{id:"u1"}}},{now:new Date("2026-10-22T10:00:01Z"),dependencies:dialogDeps});
  routeNutritionMealVoid_=originalVoid;
  record("DE-DURABLE-CLARIFICATION-CONTINUES",continued.handled&&continued.ok&&continued.dialog_continuation&&continued.code==="VOID_CONFIRMATION_REQUESTED"&&dialogRows[0].status==="CANCELLED",continued);
  const isolation=routeNaturalDialogAction_({message:{text:"приём пищи",from:{id:"u2"},chat:{id:"u2"}}},{now:new Date("2026-10-22T10:00:01Z"),dependencies:dialogDeps});
  record("DE-CLARIFICATION-USER-ISOLATION",isolation.handled===false&&dialogRows.length===1,isolation);
  const punctuation=naturalDialogDecision_("  КАК МЕНЯЕТСЯ МОЙ ВЕС?!  ");
  record("DE-NORMALIZATION",punctuation&&punctuation.domain==="WEIGHT"&&punctuation.action==="TREND",punctuation);
  const switched=routeNaturalDialogAction_({message:{text:"какой план на сегодня",from:{id:"u1"},chat:{id:"u1"}}},{active_pending_domain:"NUTRITION",routes:routeMocks});
  record("DE-CROSS-TOPIC-READ-PRESERVES-PENDING",switched.ok&&switched.decision.domain==="WORKOUT"&&switched.decision.mutation_policy==="READ_ONLY",switched);
  const passed=tests.filter(function(test){return test.status==="PASS";}).length;
  return {suite:"DIALOG_E2E_01_NATURAL_ORCHESTRATION",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{external_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
