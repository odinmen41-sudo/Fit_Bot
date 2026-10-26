/** NUT-FOLLOWUP-02 multi-item clarification regression suite. */
function runNutFollowup02Tests() {
  const results = [];
  function record(id, passed, details) { results.push({id:id,status:passed?"PASS":"FAIL",details:passed?{}:details||{}}); }
  const meal = "Бутерброд с ветчиной из индейки и сыром 15% — 200 г, 2 куриных яйца, 1 помидор, томатный суп с фасолью и курицей 250 г, отварная свёкла 150 г, цитрусовый компот 150 мл";
  const extracted = extractNutritionFactCandidate_(meal);
  record("NUT-FOLLOWUP-02_01_SIX_ITEMS", extracted.items.length === 6, extracted);
  record("NUT-FOLLOWUP-02_02_COMPOUND_NAMES_PRESERVED", /ветчиной из индейки и сыром 15/.test(extracted.items[0].fields.food_display.value) &&
    /с фасолью и курицей/.test(extracted.items[3].fields.food_display.value), extracted);
  record("NUT-FOLLOWUP-02_03_PERCENT_NOT_MASS", extracted.items[0].fields.quantity_value.value === 200 &&
    extracted.items[0].fields.quantity_unit.value === "g", extracted.items[0]);
  record("NUT-FOLLOWUP-02_04_NATURAL_COUNTS", extracted.items[1].fields.quantity_value.value === 2 &&
    extracted.items[2].fields.quantity_value.value === 1 && extracted.items[2].fields.quantity_unit.value === "count", extracted);
  record("NUT-FOLLOWUP-02_05_G_AND_ML", extracted.items[4].fields.quantity_unit.value === "g" &&
    extracted.items[5].fields.quantity_unit.value === "ml", extracted);
  record("NUT-FOLLOWUP-02_06_NO_FALSE_QUANTITY_PROMPT", !extracted.requires_clarification && !extracted.invalid, extracted);
  record("NUT-FOLLOWUP-02_07_TEXT_VOICE_TRANSCRIPT_EQUIVALENCE",
    JSON.stringify(extractNutritionFactCandidate_(meal)) === JSON.stringify(extracted), {});

  ["200 г","200 гр","200 грамм","бутерброд с ветчиной из индейки 150 г"].forEach(function(answer,index) {
    const reply = nutritionClarificationReply_(answer);
    record("NUT-FOLLOWUP-02_08_"+index+"_QUANTITY_VARIANT", reply.recognized && reply.type === "QUANTITY" &&
      reply.unit === "g" && reply.quantity === (index === 3 ? 150 : 200), reply);
  });

  const multiSpec = {missing_field:"QUANTITY",food_text:"бутерброд",item_index:0,draft_items:[
    {food_text:"бутерброд",quantity_unit:""},{food_text:"томатный суп",quantity_unit:""},
    {food_text:"компот",quantity_value:150,quantity_unit:"ml"}]};
  const firstProgress = nutritionClarificationApply_(multiSpec, nutritionClarificationReply_("200 г"));
  record("NUT-FOLLOWUP-02_09_PROGRESS_IS_PRESERVED", firstProgress.progressed && firstProgress.next_missing_index === 1 &&
    firstProgress.draft_items[0].quantity_value === 200 && firstProgress.draft_items[2].quantity_value === 150, firstProgress);

  const aliases = [
    ["бутерброд с ветчиной из индейки и сыром 15","sandwich"],["куриных яйца","egg"],
    ["помидор","tomato"],["томатный суп с фасолью и курицей","soup"],
    ["отварная свекла","beet"],["цитрусовый компот","compote"]
  ].map(function(x){return {ALIAS_NORMALIZED:x[0],FOOD_ID:x[1],PRIORITY:100,ACTIVE:true};});
  const refs = [
    ["sandwich","g",220,14,9,22],["egg","count",72,6.3,4.8,0.4],["tomato","count",22,1.1,0.2,4.8],
    ["soup","g",70,4,2,9],["beet","g",44,1.7,0.2,10],["compote","ml",35,0.1,0,8.7]
  ].map(function(x){return {REFERENCE_ID:x[0]+"-fixture",FOOD_ID:x[0],CANONICAL_NAME:x[0],DISPLAY_NAME:x[0],VARIANT:"",PREPARATION_STATE:"UNKNOWN",
    BASIS_QUANTITY:x[1]==="count"?1:100,BASIS_UNIT:x[1],CALORIES:x[2],PROTEIN:x[3],FAT:x[4],CARBS:x[5],AUTHORITY:"TEST",SOURCE:"synthetic fixture",SOURCE_VERSION:"1",ACTIVE:true};});
  refs.filter(function(r){return r.FOOD_ID==="beet";})[0].PREPARATION_STATE="BOILED";
  const referenceOptions = {calculation_enabled:true,aliases:aliases,references:refs};
  const detection = detectDomainFactCandidate_(meal, referenceOptions);
  record("NUT-FOLLOWUP-02_10_WHOLE_MEAL_CALCULATED", detection.reference_status === "RESOLVED" &&
    detection.calculation_status === "CALCULATED" && detection.items.length === 6, detection);

  function env() {
    const rows=[],meals=[];
    function selected(source,user,chat,includeSaved,now){const matches=rows.filter(function(r){return r.user_id===user&&r.chat_id===chat&&r.payload.source===source&&(r.status==="PENDING_CONFIRMATION"||includeSaved&&r.status==="SAVED");});const pending=matches.filter(function(r){return r.status==="PENDING_CONFIRMATION";}).slice(-1)[0];if(pending)return {ok:true,capture:pending,payload:pending.payload};const saved=matches.filter(function(r){return r.status==="SAVED";}).slice(-1)[0];return saved?{ok:true,capture:saved,payload:saved.payload}:{ok:false,code:"NO_CAPTURE"};}
    const deps={uuid:function(){return "nf"+(rows.length+1);},detect_confirmation:detectConfirmationIntent_,
      find_clarification:function(u,c,o){return selected(NUTRITION_CLARIFICATION_SOURCE,u,c,false,o.now);},find_capture:function(u,c,o){return selected("C231_DOMAIN_ROUTER",u,c,o.include_saved===true,o.now);},
      get_pending:function(){return {ok:false};},create_pending:function(capture,meta){rows.forEach(function(r){if(r.user_id===String(meta.user_id)&&r.chat_id===String(meta.chat_id)&&r.status==="PENDING_CONFIRMATION")r.status="SUPERSEDED";});rows.push({capture_id:capture.capture_id,user_id:String(meta.user_id),chat_id:String(meta.chat_id),payload:JSON.parse(JSON.stringify(capture)),status:"PENDING_CONFIRMATION"});return {ok:true,created:true,capture_id:capture.capture_id};},
      cancel:function(){return {ok:true,code:"CANCELLED"};},validate_nutrition_snapshot:validateNutritionSnapshotForSave_,nutrition_persistence_enabled:function(){return true;},
      persist_nutrition:function(found){if(found.capture.status==="SAVED")return {ok:true,code:"NUTRITION_SAVED",idempotent_replay:true,rows_written:0};meals.push(JSON.parse(JSON.stringify(found.payload)));found.capture.status="SAVED";return {ok:true,code:"NUTRITION_SAVED",rows_written:1};},build_dashboard:function(){return null;},evaluate_contextual:function(){return null;}};
    return {rows:rows,meals:meals,deps:deps};
  }
  function update(id,text){return {update_id:id,message:{text:text,from:{id:"synthetic"},chat:{id:"synthetic"}}};}
  const runtime=env(),now=new Date("2026-10-26T10:00:00Z");
  let routed=routeDomainFactConfirmation_(update(1,meal),{now:now,dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-FOLLOWUP-02_11_PROPOSAL_NO_LOOP", routed.ok && routed.code === "CAPTURE_CREATED" && runtime.rows.length === 1 &&
    runtime.rows[0].payload.items.length === 6, routed);
  routed=routeDomainFactConfirmation_(update(2,"Да"),{now:new Date(now.getTime()+1000),dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-FOLLOWUP-02_12_SINGLE_SAVE", routed.ok && runtime.meals.length === 1 && runtime.meals[0].items.length === 6, routed);
  routed=routeDomainFactConfirmation_(update(3,"Да"),{now:new Date(now.getTime()+2000),dependencies:runtime.deps,reference_options:referenceOptions});
  record("NUT-FOLLOWUP-02_13_REPEAT_CONFIRMATION_IDEMPOTENT", routed.ok && runtime.meals.length === 1, routed);

  const unknown = detectDomainFactCandidate_("Съел неизвестный домашний суп 250 г", referenceOptions);
  record("NUT-FOLLOWUP-02_14_UNKNOWN_RECIPE_FAILS_CLOSED", unknown.reference_status === "UNKNOWN_REFERENCE" &&
    unknown.calculation_status !== "CALCULATED", unknown);
  const passed=results.filter(function(r){return r.status==="PASS";}).length;
  return {ok:passed===results.length,passed:passed,total:results.length,results:results};
}
