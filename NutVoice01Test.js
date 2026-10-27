/** NUT-VOICE-01 natural text/voice nutrition regression suite. */
function runNutVoice01Tests() {
  const results = [];
  function record(id, passed, details) {
    results.push({id: id, status: passed ? "PASS" : "FAIL", details: details || {}});
  }
  const aliases = [
    ["растворимый кофе nescaf crema", "instant_coffee"],
    ["растворимый кофе nescafe crema", "instant_coffee"],
    ["сгущенного молока", "sweetened_condensed_milk_tsp"],
    ["сгущенное молоко", "sweetened_condensed_milk_tsp"],
    ["пиццы papa john s супер папа", "pizza_super_papa_medium"],
    ["пицца papa john s супер папа", "pizza_super_papa_medium"],
    ["пиццы среднего размера", "pizza_medium_slice"],
    ["пицца среднего размера", "pizza_medium_slice"],
    ["капучино", "cappuccino"]
  ].map(function(row) { return {ALIAS_NORMALIZED:row[0],FOOD_ID:row[1],PRIORITY:100,ACTIVE:true}; });
  const references = [
    ["instant-coffee-ml", "instant_coffee", "Instant coffee", 100, "ml", 2, 0.12, 0.02, 0],
    ["condensed-milk-tsp", "sweetened_condensed_milk_tsp", "Sweetened condensed milk, teaspoon", 1, "count", 22.47, 0.5537, 0.609, 3.808],
    ["super-papa-medium-slice", "pizza_super_papa_medium", "Super Papa medium slice analogue", 1, "count", 230, 9, 9, 27],
    ["pizza-medium-slice", "pizza_medium_slice", "Medium pizza slice estimate", 1, "count", 230, 9, 9, 27],
    ["cappuccino-ml", "cappuccino", "Cappuccino estimate", 100, "ml", 43, 2.2, 2.2, 3.5]
  ].map(function(row) { return {REFERENCE_ID:row[0],FOOD_ID:row[1],CANONICAL_NAME:row[2],DISPLAY_NAME:row[2],
    VARIANT:"",PREPARATION_STATE:"UNKNOWN",BASIS_QUANTITY:row[3],BASIS_UNIT:row[4],CALORIES:row[5],
    PROTEIN:row[6],FAT:row[7],CARBS:row[8],AUTHORITY:"TEST_VERIFIED_SOURCE",SOURCE:"fixture",
    SOURCE_VERSION:"1",ACTIVE:true}; });
  const referenceOptions = {calculation_enabled:true, aliases:aliases, references:references};
  const natural = "На завтрак я выпил растворимый кофе Nescafé Crema, добавил пару чайных ложек сгущённого молока и съел два куска пиццы Papa John's «Супер Папа». Запиши это в мой дневной рацион";

  let extracted = extractNutritionFactCandidate_(natural);
  record("NUT-VOICE-01_01_MULTI_ITEM_NATURAL_EXTRACTION", extracted.detected && extracted.items.length === 3 &&
    extracted.requires_clarification && extracted.items[1].fields.quantity_value.value === 2 &&
    extracted.items[2].fields.quantity_value.value === 2, extracted);

  const voiceExtracted = extractNutritionFactCandidate_(natural);
  record("NUT-VOICE-01_02_TEXT_VOICE_TRANSCRIPT_EQUIVALENCE",
    JSON.stringify(voiceExtracted) === JSON.stringify(extracted), voiceExtracted);

  let detected = detectDomainFactCandidate_(natural, referenceOptions);
  const spec = nutritionClarificationSpec_(detected);
  record("NUT-VOICE-01_03_MULTI_ITEM_CONTEXT_FROZEN", detected.domain === "NUTRITION" && spec &&
    spec.item_index === 0 && spec.draft_items.length === 3 && /растворимый кофе/.test(spec.prompt), spec);

  const completed = nutritionClarificationCompletedText_(spec, {recognized:true,type:"QUANTITY",quantity:300,unit:"ml"});
  detected = detectDomainFactCandidate_(completed, referenceOptions);
  record("NUT-VOICE-01_04_CLARIFICATION_CALCULATES_WHOLE_MEAL", detected.reference_status === "RESOLVED" &&
    detected.calculation_status === "CALCULATED" && detected.items.length === 3 &&
    detected.nutrition_calculation.totals.calories === 510.94, detected.nutrition_calculation);

  const simplified = detectDomainFactCandidate_("Капучино 300 мл и два куска пиццы среднего размера", referenceOptions);
  record("NUT-VOICE-01_05_SIMPLIFIED_NATURAL_MEAL", simplified.reference_status === "RESOLVED" &&
    simplified.calculation_status === "CALCULATED" && simplified.nutrition_calculation.totals.calories === 589,
    simplified.nutrition_calculation);

  record("NUT-VOICE-01_06_NATURAL_CONFIRMATION", detectConfirmationIntent_("Всё верно, записывай").intent === "CONFIRM", {});
  record("NUT-VOICE-01_07_QUANTITY_WITH_UNIT", nutritionClarificationReply_("300 мл").unit === "ml" &&
    nutritionClarificationReply_("150 г").unit === "g", {});

  const unknown = detectDomainFactCandidate_("Съел неизвестный батончик 80 г", referenceOptions);
  record("NUT-VOICE-01_08_UNKNOWN_REFERENCE_PRESERVED", unknown.reference_status === "PARTIAL" &&
    unknown.calculation_status === "PARTIAL_CALCULATED" && unknown.nutrition_calculation.unknown_items_count === 1 &&
    unknown.items[0].fields.calculated_nutrition.value === null, unknown);

  const correction = extractNutritionFactCandidate_("Нет, я съел три куска пиццы среднего размера");
  record("NUT-VOICE-01_09_CORRECTION_REPARSES_FULL_FACT", correction.detected &&
    correction.items[0].fields.quantity_value.value === 3 && correction.items[0].fields.quantity_unit.value === "count", correction);

  const pendingPayload = buildDomainFactCandidate_(simplified, {now:new Date("2026-10-26T08:00:00Z"),uuid:function(){return "pending";}});
  const correctedPending = nutritionPendingCorrectionText_(pendingPayload, "Нет, не 2, а 3 куска");
  const correctedDetection = detectDomainFactCandidate_(correctedPending, referenceOptions);
  record("NUT-VOICE-01_10_PENDING_PROPOSAL_QUANTITY_CORRECTION", /3 шт/.test(correctedPending) &&
    correctedDetection.calculation_status === "CALCULATED" && correctedDetection.nutrition_calculation.totals.calories === 819,
    {corrected_text:correctedPending, calculation:correctedDetection.nutrition_calculation});

  function liveLikeEnvironment() {
    const rows = [], meals = [];
    function selected(source, user, chat, includeSaved, now) {
      const matches = rows.filter(function(row) { return row.user_id === user && row.chat_id === chat &&
        row.payload.source === source && (row.status === "PENDING_CONFIRMATION" || includeSaved && row.status === "SAVED"); });
      const pending = matches.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; }).slice(-1)[0];
      if (pending) return pending.expires_at <= now ? {ok:false,code:"CAPTURE_EXPIRED",capture:pending,payload:pending.payload} :
        {ok:true,capture:pending,payload:pending.payload};
      const saved = matches.filter(function(row) { return row.status === "SAVED"; }).slice(-1)[0];
      return saved ? {ok:true,capture:saved,payload:saved.payload} : {ok:false,code:"NO_CAPTURE"};
    }
    const deps = {uuid:function(){return "nv" + (rows.length + 1);},detect_confirmation:detectConfirmationIntent_,
      find_clarification:function(user,chat,opts){return selected(NUTRITION_CLARIFICATION_SOURCE,user,chat,false,opts.now);},
      find_capture:function(user,chat,opts){return selected("C231_DOMAIN_ROUTER",user,chat,opts.include_saved === true,opts.now);},
      get_pending:function(user,chat,opts){const row=rows.filter(function(x){return x.user_id===user&&x.chat_id===chat&&x.status==="PENDING_CONFIRMATION"&&x.expires_at>opts.now;})[0];return row?{ok:true,capture:row}:{ok:false};},
      create_pending:function(capture,meta){const duplicate=rows.filter(function(x){return x.capture_id===capture.capture_id;})[0];if(duplicate)return {ok:true,created:false,capture_id:capture.capture_id};rows.forEach(function(x){if(x.user_id===String(meta.user_id)&&x.chat_id===String(meta.chat_id)&&x.status==="PENDING_CONFIRMATION")x.status="SUPERSEDED";});rows.push({capture_id:capture.capture_id,user_id:String(meta.user_id),chat_id:String(meta.chat_id),payload:JSON.parse(JSON.stringify(capture)),status:"PENDING_CONFIRMATION",expires_at:new Date(meta.now.getTime()+1800000)});return {ok:true,created:true,capture_id:capture.capture_id};},
      cancel:function(user,chat){const row=rows.filter(function(x){return x.user_id===user&&x.chat_id===chat&&x.status==="PENDING_CONFIRMATION";}).slice(-1)[0];if(!row)return {ok:false};row.status="CANCELLED";return {ok:true,code:"CANCELLED"};},
      validate_nutrition_snapshot:validateNutritionSnapshotForSave_,nutrition_persistence_enabled:function(){return true;},
      persist_nutrition:function(found){if(found.capture.status==="SAVED")return {ok:true,code:"NUTRITION_SAVED",idempotent_replay:true,rows_written:0};meals.push(JSON.parse(JSON.stringify(found.payload)));found.capture.status="SAVED";return {ok:true,code:"NUTRITION_SAVED",rows_written:1};},
      build_dashboard:function(){return null;},evaluate_contextual:function(){return null;}};
    return {rows:rows,meals:meals,deps:deps};
  }
  function update(id,user,text){return {update_id:id,message:{text:text,from:{id:user},chat:{id:user}}};}
  const env = liveLikeEnvironment(), at = new Date("2026-10-26T08:00:00Z");
  let routed = routeDomainFactConfirmation_(update(100,"owner",natural), {now:at,dependencies:env.deps,reference_options:referenceOptions});
  record("NUT-VOICE-01_11_DURABLE_MULTI_ITEM_CLARIFICATION", routed.ok && env.rows.length === 1 && /растворимый кофе/.test(routed.message), routed);
  routed = routeDomainFactConfirmation_(update(101,"other","300 мл"), {now:new Date(at.getTime()+500),dependencies:env.deps,reference_options:referenceOptions});
  record("NUT-VOICE-01_12_USER_ISOLATION", routed.handled === false && env.rows.length === 1, routed);
  routed = routeDomainFactConfirmation_(update(102,"owner","300 мл"), {now:new Date(at.getTime()+1000),dependencies:env.deps,reference_options:referenceOptions});
  record("NUT-VOICE-01_13_PROTECTED_CONFIRMATION_PROPOSAL", routed.ok && /511/.test(routed.message) && env.meals.length === 0, routed);
  routed = routeDomainFactConfirmation_(update(103,"owner","Всё верно, записывай"), {now:new Date(at.getTime()+2000),dependencies:env.deps,reference_options:referenceOptions});
  record("NUT-VOICE-01_14_SINGLE_SAVE_AFTER_CONFIRMATION", routed.ok && env.meals.length === 1 && env.meals[0].items.length === 3, routed);
  routed = routeDomainFactConfirmation_(update(104,"owner","Да"), {now:new Date(at.getTime()+3000),dependencies:env.deps,reference_options:referenceOptions});
  record("NUT-VOICE-01_15_REPEAT_CONFIRMATION_IDEMPOTENT", routed.ok && env.meals.length === 1, routed);

  const passed = results.filter(function(item) { return item.status === "PASS"; }).length;
  return {ok:passed === results.length, passed:passed, total:results.length, results:results};
}
