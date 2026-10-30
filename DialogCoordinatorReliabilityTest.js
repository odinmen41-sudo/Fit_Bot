/** Systemic dialogue ownership and transition regression. */
function runDialogCoordinatorReliabilityTests(){
  const tests=[];function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  const now=new Date("2026-10-29T16:00:00.000Z"),base={row_number:2,user_id:"u1",chat_id:"c1",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()+60000)};
  function pending(source){return {ok:true,code:"ACTIVE_CAPTURE_FOUND",capture:Object.assign({},base,{payload_json:JSON.stringify({source:source})})};}
  const owners={NUTRITION:function(){return {handled:true,ok:true,code:"NUTRITION_OWNED",message:"nutrition"};},WEIGHT:function(){return {handled:true,ok:true,code:"WEIGHT_OWNED",message:"weight"};},WORKOUT:function(){return {handled:true,ok:true,code:"WORKOUT_OWNED",message:"workout"};},RECOVERY:function(){return {handled:true,ok:true,code:"RECOVERY_OWNED",message:"recovery"};}};
  function update(text){return {update_id:1,message:{text:text,from:{id:"u1"},chat:{id:"c1"}}};}
  [["C231_DOMAIN_ROUTER","NUTRITION","NUTRITION_OWNED"],["C20A_WEIGHT_GATE","WEIGHT","WEIGHT_OWNED"],["WORKOUT_LOGGING_HISTORY","WORKOUT","WORKOUT_OWNED"],["SR2_SUBJECTIVE_RECOVERY","RECOVERY","RECOVERY_OWNED"]].forEach(function(row,index){
    const result=routeDialogStateCoordinator_(update("Да, сохраняй"),{now:now,dependencies:{get_pending:function(){return pending(row[0]);},owner_routes:owners}});
    rec("DCR-0"+(index+1)+"_"+row[1]+"_CONFIRMATION_SINGLE_OWNER",result.handled&&result.ok&&result.code===row[2]&&result.active_owner===row[1],result);
  });
  const preserved=routeDialogStateCoordinator_(update("Что я ел сегодня?"),{now:now,dependencies:{get_pending:function(){return pending("C20A_WEIGHT_GATE");},owner_routes:owners}});
  rec("DCR-05_TOPIC_SWITCH_PRESERVES_ACTIVE_ACTION",!preserved.handled&&preserved.code==="ACTIVE_DIALOG_PRESERVED"&&preserved.active_owner==="WEIGHT",preserved);
  const longMeal=routeDialogStateCoordinator_(update("курица 200 г, рис 150 г, помидор 100 г, компот 150 мл"),{now:now,dependencies:{get_pending:function(){return pending("NUTRITION_CLARIFICATION");},owner_routes:owners}});
  rec("DCR-06_LONG_INPUT_NOT_SHORT_REPLY",!longMeal.handled&&longMeal.code==="ACTIVE_DIALOG_PRESERVED",longMeal);
  const shortMeal=routeDialogStateCoordinator_(update("200 г"),{now:now,dependencies:{get_pending:function(){return pending("NUTRITION_CLARIFICATION");},owner_routes:owners}});
  rec("DCR-07_SHORT_REPLY_RETURNS_TO_OWNER",shortMeal.handled&&shortMeal.code==="NUTRITION_OWNED",shortMeal);
  const idleGuide=routeDialogStateCoordinator_(update("Записать еду"),{now:now,dependencies:{get_pending:function(){return {ok:false,code:"NO_ACTIVE_CAPTURE"};},owner_routes:owners}});
  rec("DCR-08_EXPLICIT_ENTRY_NEVER_REACHES_ANALYTICS",idleGuide.handled&&idleGuide.code==="DATA_ENTRY_GUIDE"&&idleGuide.groq_calls===0,idleGuide);
  const conflict=routeDialogStateCoordinator_(update("Да"),{now:now,dependencies:{get_pending:function(){return {ok:false,code:"MULTIPLE_ACTIVE_CAPTURES"};},owner_routes:owners}});
  rec("DCR-09_MULTIPLE_ACTIVE_FAIL_CLOSED",conflict.handled&&!conflict.ok&&conflict.code==="DIALOG_STATE_CONFLICT",conflict);
  const unknown=routeDialogStateCoordinator_(update("Да"),{now:now,dependencies:{get_pending:function(){return pending("UNKNOWN_SOURCE");},owner_routes:owners}});
  rec("DCR-10_UNKNOWN_OWNER_FAIL_CLOSED",unknown.handled&&!unknown.ok&&unknown.code==="UNKNOWN_DIALOG_OWNER",unknown);
  const noPending=routeDialogStateCoordinator_(update("Да"),{now:now,dependencies:{get_pending:function(){return {ok:false,code:"NO_ACTIVE_CAPTURE"};},owner_routes:owners}});
  rec("DCR-11_IDLE_CONFIRMATION_NOT_CLAIMED",!noPending.handled&&noPending.code==="DIALOG_IDLE",noPending);
  const sanitized=sanitizeUserFacingInternalMarkers_("nutrition=MISSING; weight=UNAVAILABLE; recovery=DATA_INTEGRITY_ERROR");
  rec("DCR-12_INTERNAL_STATE_NEVER_RENDERED",!/MISSING|UNAVAILABLE|DATA_INTEGRITY_ERROR/.test(sanitized),sanitized);
  const pendingSheet={getRange:function(){return {getValues:function(){return [SMART_CONFIRMATION_CONFIG.HEADERS];}};}};
  const pendingBook={getSheetByName:function(name){return name===SMART_CONFIRMATION_CONFIG.SHEET_NAME?pendingSheet:null;}};
  rec("DCR-13_PENDING_USES_ENVIRONMENT_SPREADSHEET",smartConfirmationSheet_({spreadsheet:pendingBook})===pendingSheet,{});
  const eightProducts="Бутерброд с ветчиной из индейки и сыром 15% — 200 г, 2 куриных яйца, 1 помидор, томатный суп с фасолью и курицей 250 г, отварная свёкла 150 г, цитрусовый компот 150 мл";
  const parsedEight=extractNutritionFactCandidate_(eightProducts);
  rec("DCR-14_EIGHT_PRODUCT_REPLAY_IS_FRESH_NUTRITION",parsedEight.detected===true&&parsedEight.requires_clarification===false&&parsedEight.items.length===6&&parsedEight.items[0].fields.quantity_value.value===200,parsedEight);
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"DIALOG_COORDINATOR_RELIABILITY",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{sheet_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
