/** NUT-DIALOG-01 natural voice meal + protected confirmation regression. */
function runNutDialog01Tests() {
  const results = [];
  function record(id, passed, details) {
    results.push({id:id,status:passed ? "PASS" : "FAIL",details:details || {}});
  }
  ["Да, сохраняй", "да сохраняй", "Да. Сохраняй!", "да, запиши", "всё верно, сохраняй"].forEach(function(text, index) {
    record("NUT-DIALOG-01_CONFIRM_" + (index + 1), detectConfirmationIntent_(text).intent === "CONFIRM", {text:text});
  });
  ["давай сохраним", "да, но исправь 300 г", "сохраняй тренировку завтра"].forEach(function(text, index) {
    record("NUT-DIALOG-01_CONFIRM_REJECT_" + (index + 1), detectConfirmationIntent_(text).intent === "UNKNOWN", {text:text});
  });

  const aliases = [
    {ALIAS_NORMALIZED:"овсяную кашу",FOOD_ID:"oatmeal",PRIORITY:100,ACTIVE:true},
    {ALIAS_NORMALIZED:"капучино",FOOD_ID:"cappuccino",PRIORITY:100,ACTIVE:true}
  ];
  const references = [
    {REFERENCE_ID:"oatmeal-water-v1",FOOD_ID:"oatmeal",CANONICAL_NAME:"Овсяная каша",DISPLAY_NAME:"Овсяная каша на воде",VARIANT:"",PREPARATION_STATE:"COOKED_WATER",BASIS_QUANTITY:100,BASIS_UNIT:"g",CALORIES:71,PROTEIN:2.54,FAT:1.52,CARBS:12,AUTHORITY:"TEST_VERIFIED_SOURCE",SOURCE:"fixture",SOURCE_VERSION:"1",ACTIVE:true},
    {REFERENCE_ID:"cappuccino-v1",FOOD_ID:"cappuccino",CANONICAL_NAME:"Капучино",DISPLAY_NAME:"Капучино",VARIANT:"",PREPARATION_STATE:"UNKNOWN",BASIS_QUANTITY:100,BASIS_UNIT:"ml",CALORIES:43,PROTEIN:2.2,FAT:2.2,CARBS:3.5,AUTHORITY:"TEST_VERIFIED_SOURCE",SOURCE:"fixture",SOURCE_VERSION:"1",ACTIVE:true}
  ];
  const referenceOptions = {calculation_enabled:true,aliases:aliases,references:references};
  const transcript = "Привет! Запиши, пожалуйста, мне на завтрак овсяную кашу на молоке 300 г и капучино без сахара 300 мл";
  const detection = detectDomainFactCandidate_(transcript, referenceOptions);
  record("NUT-DIALOG-01_VOICE_INTENT_SEPARATION", detection.domain === "NUTRITION" && detection.items.length === 2 &&
    detection.items[0].fields.food_display.value === "овсяную кашу на молоке" && /капучино/.test(detection.items[1].fields.food_display.value), detection);
  record("NUT-DIALOG-01_TRUSTED_PARTIAL_ARITHMETIC", detection.calculation_status === "PARTIAL_CALCULATED" &&
    detection.nutrition_calculation.totals.calories === 129 && detection.nutrition_calculation.unknown_items_count === 1 &&
    detection.items[0].fields.calculated_nutrition.value === null, detection.nutrition_calculation);

  const rows = [], meals = [];
  function select(user, chat, includeSaved, now) {
    const matches = rows.filter(function(row) { return row.user_id === user && row.chat_id === chat &&
      row.payload.source === "C231_DOMAIN_ROUTER" && (row.status === "PENDING_CONFIRMATION" || includeSaved && row.status === "SAVED"); });
    const pending = matches.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; }).slice(-1)[0];
    if (pending) return pending.expires_at <= now ? {ok:false,code:"CAPTURE_EXPIRED"} : {ok:true,capture:pending,payload:pending.payload};
    const saved = matches.filter(function(row) { return row.status === "SAVED"; }).slice(-1)[0];
    return saved ? {ok:true,capture:saved,payload:saved.payload} : {ok:false,code:"NO_CAPTURE"};
  }
  const deps = {
    uuid:function(){return "nut-dialog-01";},detect_confirmation:detectConfirmationIntent_,
    find_clarification:function(){return {ok:false,code:"NO_CLARIFICATION_CAPTURE"};},
    find_capture:function(user,chat,opts){return select(user,chat,opts.include_saved === true,opts.now);},
    get_pending:function(){return {ok:false,code:"NO_ACTIVE_CAPTURE"};},
    create_pending:function(capture,meta){
      if (rows.some(function(row){return row.capture_id === capture.capture_id;})) return {ok:true,created:false,capture_id:capture.capture_id};
      rows.push({capture_id:capture.capture_id,user_id:String(meta.user_id),chat_id:String(meta.chat_id),payload:JSON.parse(JSON.stringify(capture)),status:"PENDING_CONFIRMATION",expires_at:new Date(meta.now.getTime()+1800000)});
      return {ok:true,created:true,capture_id:capture.capture_id};
    },
    cancel:function(){return {ok:true,code:"CANCELLED"};},validate_nutrition_snapshot:validateNutritionSnapshotForSave_,
    nutrition_persistence_enabled:function(){return true;},
    persist_nutrition:function(found){
      if (found.capture.status === "SAVED") return {ok:true,code:"NUTRITION_SAVED",idempotent_replay:true,rows_written:0};
      meals.push(JSON.parse(JSON.stringify(found.payload)));found.capture.status = "SAVED";
      return {ok:true,code:"NUTRITION_SAVED",rows_written:1};
    },build_dashboard:function(){return null;},evaluate_contextual:function(){return null;}
  };
  function update(id, user, text) { return {update_id:id,message:{text:text,beta_voice_transcript:true,from:{id:user},chat:{id:user}}}; }
  const now = new Date("2026-10-29T08:00:00Z");
  let routed = routeDomainFactConfirmation_(update(1,"owner",transcript), {now:now,dependencies:deps,reference_options:referenceOptions});
  record("NUT-DIALOG-01_PROPOSAL_NO_WRITE", routed.ok && rows.length === 1 && meals.length === 0 &&
    /129/.test(routed.message) && /Итог неполный/.test(routed.message), routed);
  const other = routeDomainFactConfirmation_(update(2,"other","Да, сохраняй"), {now:new Date(now.getTime()+500),dependencies:deps,reference_options:referenceOptions});
  record("NUT-DIALOG-01_USER_ISOLATION", other.handled === false && meals.length === 0, other);
  routed = routeDomainFactConfirmation_(update(3,"owner","Да, сохраняй"), {now:new Date(now.getTime()+1000),dependencies:deps,reference_options:referenceOptions});
  record("NUT-DIALOG-01_VOICE_CONFIRM_SINGLE_SAVE", routed.ok && meals.length === 1 && rows[0].status === "SAVED", routed);
  routed = routeDomainFactConfirmation_(update(4,"owner","Да, сохраняй"), {now:new Date(now.getTime()+1500),dependencies:deps,reference_options:referenceOptions});
  record("NUT-DIALOG-01_REPEAT_CONFIRM_IDEMPOTENT", routed.ok && meals.length === 1, routed);
  const noOwner = routeUnownedConfirmationFallback_(update(5,"owner","Да, сохраняй"));
  record("NUT-DIALOG-01_NO_AI_FALLTHROUGH", noOwner.handled && noOwner.code === "NO_ACTIVE_PROTECTED_ACTION" && noOwner.groq_calls === 0, noOwner);

  const passed = results.filter(function(item){return item.status === "PASS";}).length;
  return {ok:passed === results.length,passed:passed,total:results.length,results:results};
}
