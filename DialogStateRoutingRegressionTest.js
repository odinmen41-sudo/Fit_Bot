/** Cross-domain dialogue state/routing regression for NUT-DIALOG-01. */
function runDialogStateRoutingRegressionTests(){
  const tests=[];function rec(id,pass,details){tests.push({id:id,status:pass?"PASS":"FAIL",details:pass?{}:details||{}});}
  const now=new Date("2026-10-29T13:12:00.000Z"),rows=[
    {row_number:2,user_id:"u1",chat_id:"c1",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()-1000),payload_json:JSON.stringify({source:"NUTRITION_CLARIFICATION"})},
    {row_number:3,user_id:"u2",chat_id:"c2",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()-1000),payload_json:JSON.stringify({source:"C20A_WEIGHT_GATE"})},
    {row_number:4,user_id:"u1",chat_id:"c1",status:"SAVED",expires_at:new Date(now.getTime()-1000),payload_json:JSON.stringify({source:"C231_DOMAIN_ROUTER"})}
  ],expired=[];
  const lock={tryLock:function(){return true;},releaseLock:function(){}};
  const reconciled=reconcileOwnedPendingState_("u1","c1",{now:now,dependencies:{sheet:{},read_rows:function(){return rows;},lock:lock,
    mark_expired:function(row){expired.push(row.row_number);row.status="EXPIRED";},flush:function(){}}});
  rec("DSR-01_EXPIRED_OWNER_STATE_TERMINATED",reconciled.ok&&reconciled.expired_count===1&&expired[0]===2&&rows[0].status==="EXPIRED",reconciled);
  rec("DSR-02_OTHER_USER_UNCHANGED",rows[1].status==="PENDING_CONFIRMATION",rows[1]);
  const longMeal={message:{text:"курица 200 г, рис 150 г, помидор 100 г, компот 150 мл",from:{id:"u1"},chat:{id:"c1"}}};
  const fresh=routeExpiredStateRecovery_(longMeal,reconciled);
  rec("DSR-03_LONG_FRESH_MEAL_NOT_TREATED_AS_OLD_REPLY",fresh.handled===false&&fresh.code==="FRESH_INPUT_AFTER_EXPIRY",fresh);
  const short=routeExpiredStateRecovery_({message:{text:"200 г",from:{id:"u1"},chat:{id:"c1"}}},reconciled);
  rec("DSR-04_SHORT_REPLY_GETS_EXPLICIT_EXPIRY",short.handled&&short.code==="EXPIRED_STATE_RECOVERY"&&/истекло/.test(short.message),short);
  [
    ["Записать еду","NUTRITION"],["Записать вес","WEIGHT"],["Записать тренировку","WORKOUT"],["Записать восстановление","RECOVERY"]
  ].forEach(function(item,index){const decision=naturalDialogDecision_(item[0]);rec("DSR-0"+(5+index)+"_"+item[1]+"_ENTRY_GUIDE",
    decision&&decision.domain===item[1]&&decision.mutation_policy==="GUIDE",decision);});
  const routed=routeNaturalDialogAction_({update_id:1,message:{text:"Записать еду",from:{id:"u1"},chat:{id:"c1"}}},{});
  rec("DSR-09_ENTRY_GUIDE_NO_AI_OR_WRITE",routed.handled&&routed.ok&&routed.code==="DATA_ENTRY_GUIDE"&&routed.groq_calls===0&&/продукты/.test(routed.message),routed);
  const sanitized=sanitizeUserFacingInternalMarkers_("weight=MISSING; recovery=UNAVAILABLE; status=DATA_INTEGRITY_ERROR");
  rec("DSR-10_INTERNAL_MARKERS_NEVER_USER_VISIBLE",!/MISSING|UNAVAILABLE|DATA_INTEGRITY_ERROR/.test(sanitized),sanitized);
  const activeRows=[{row_number:5,user_id:"u1",chat_id:"c1",status:"PENDING_CONFIRMATION",expires_at:new Date(now.getTime()+60000),payload_json:"{}"}],activeExpired=[];
  const current=reconcileOwnedPendingState_("u1","c1",{now:now,dependencies:{sheet:{},read_rows:function(){return activeRows;},lock:lock,mark_expired:function(r){activeExpired.push(r);}}});
  rec("DSR-11_ACTIVE_STATE_PRESERVED",current.ok&&current.expired_count===0&&activeExpired.length===0&&activeRows[0].status==="PENDING_CONFIRMATION",current);
  rec("DSR-12_BARE_MUTATION_VERB_NOT_DEFAULTED_TO_NUTRITION",naturalDialogDecision_("записать")===null,naturalDialogDecision_("записать"));
  const passed=tests.filter(function(t){return t.status==="PASS";}).length;return {suite:"DIALOG_STATE_ROUTING_REGRESSION",status:passed===tests.length?"PASS":"FAIL",total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,safety:{production_writes:0,groq_calls:0,telegram_calls:0}};
}
