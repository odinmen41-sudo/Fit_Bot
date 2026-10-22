function runNutritionE2E01OatmealTests() {
  const tests = [];
  const now = new Date("2026-10-22T07:30:00.000Z");
  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: passed ? {} : details || {}});
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
    return "test-sha256-" + (value >>> 0).toString(16) + "-" + text.length;
  }
  const foodData = {
    calculation_enabled: true,
    aliases: [
      {ALIAS_NORMALIZED: "овсяная каша", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true,
        CANONICAL_NAME: "Овсяная каша"},
      {ALIAS_NORMALIZED: "овсяную кашу", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true,
        CANONICAL_NAME: "Овсяная каша"}
    ],
    references: [{
      REFERENCE_ID: "oatmeal_cooked_water_usda_sr28_08121_v1", FOOD_ID: "oatmeal",
      CANONICAL_NAME: "Овсяная каша на воде", DISPLAY_NAME: "Овсяная каша на воде", VARIANT: "",
      PREPARATION_STATE: "COOKED_WATER", BASIS_QUANTITY: 100, BASIS_UNIT: "g",
      CALORIES: 71, PROTEIN: 2.54, FAT: 1.52, CARBS: 12,
      AUTHORITY: "USDA", SOURCE: "USDA SR28 NDB 08121", SOURCE_VERSION: "2015", ACTIVE: true
    }]
  };
  const detection = detectDomainFactCandidate_("Съел овсяную кашу на воде 250 г", foodData);
  const detectedItem = detection.items && detection.items[0];
  const detectedFields = detectedItem && detectedItem.fields || {};
  const calculated = detectedFields.calculated_nutrition && detectedFields.calculated_nutrition.value || {};
  record("NUT-E2E-01-01_RECOGNIZED", detection.domain === "NUTRITION" && detection.calculation_status === "CALCULATED", detection);
  record("NUT-E2E-01-02_IDENTITY", detectedFields.food_id.value === "oatmeal" &&
    detectedFields.preparation_state.value === "COOKED_WATER", detectedFields);
  record("NUT-E2E-01-03_EXACT_CALCULATION", calculated.calories === 177.5 && calculated.protein === 6.35 &&
    calculated.fat === 3.8 && calculated.carbs === 30, calculated);
  const ambiguousOatmeal = detectDomainFactCandidate_("Съел овсяную кашу 250 г", foodData);
  record("NUT-E2E-01-03A_MISSING_LIQUID_CLARIFIED", ambiguousOatmeal.reference_status === "CLARIFICATION_REQUIRED" &&
    /на воде или на молоке/.test(ambiguousOatmeal.clarification_message), ambiguousOatmeal);
  record("NUT-E2E-01-03B_CONTEXT_GAP_DOCUMENTED", detectDomainFactCandidate_("на воде", foodData).code === "NOT_DOMAIN_FACT",
    {first:ambiguousOatmeal,follow_up:"NOT_DOMAIN_FACT"});

  const pending = [];
  const captureDependencies = {
    uuid: function() { return "nut-e2e-01-capture"; },
    detect_confirmation: function() { return null; },
    find_capture: function() { return {ok:false, code:"NO_DOMAIN_CAPTURE"}; },
    get_pending: function() { return pending.length ? {ok:true, capture:pending[0]} : {ok:false}; },
    create_pending: function(capture, metadata) {
      pending.push({capture_id:capture.capture_id, user_id:metadata.user_id, chat_id:metadata.chat_id,
        status:"PENDING_CONFIRMATION", expires_at:new Date(now.getTime() + 1800000), payload:capture});
      return {ok:true, code:"CREATED", capture_id:capture.capture_id};
    },
    confirm: function() { return {ok:false, code:"NOT_USED"}; },
    cancel: function() { return {ok:false, code:"NOT_USED"}; },
    save_domain: function() { return {ok:false, code:"NOT_USED"}; }
  };
  const update = {update_id:"nut-e2e-01-update", message:{text:"Съел овсяную кашу на воде 250 г",
    from:{id:"synthetic-user"}, chat:{id:"synthetic-chat"}}};
  const routed = routeDomainFactConfirmation_(update, {now:now, dependencies:captureDependencies,
    reference_options:foodData});
  record("NUT-E2E-01-04_CONFIRMATION_CREATED", routed.ok && routed.code === "CAPTURE_CREATED" && pending.length === 1, routed);
  record("NUT-E2E-01-05_CONFIRMATION_TEXT", /178 ккал/.test(routed.message) && /Б 6,4 г/.test(routed.message) &&
    /Ж 3,8 г/.test(routed.message) && /У 30 г/.test(routed.message) && /Сохранить\? Да \/ Нет/.test(routed.message), routed.message);
  const repeatedBeforeConfirmation = routeDomainFactConfirmation_(update, {now:now, dependencies:captureDependencies,
    reference_options:foodData});
  record("NUT-E2E-01-06_REPEAT_WHILE_PENDING", repeatedBeforeConfirmation.code === "ACTIVE_CAPTURE_EXISTS" && pending.length === 1,
    repeatedBeforeConfirmation);

  const durable = [];
  const capture = pending[0];
  function persistenceIo(failure) {
    return {
      get_capture: function() { return capture; },
      checkpoint_capture: function(target, status, result, confirmedAt, error) {
        target.status = status; target.saved_targets_json = JSON.stringify(result || {});
        target.confirmed_at = confirmedAt || ""; target.error = error || "";
      },
      find_meals: function(captureId) { return durable.map(function(record, index) {
        return {row_number:index + 2, record:clone(record)};
      }).filter(function(row) { return row.record.capture_id === captureId; }); },
      append_meal: function(record) { if (failure && failure.append) throw new Error("synthetic append failure"); durable.push(clone(record)); return durable.length + 1; },
      read_meal: function(row) { return clone(durable[row - 2]); },
      write_meal: function(row, record) { if (failure && failure.commit && record.transaction_status === "COMMITTED") throw new Error("synthetic commit failure"); durable[row - 2] = clone(record); }
    };
  }
  const lock = {tryLock:function(){return true;},releaseLock:function(){}};
  let persisted = persistNutritionSnapshot_({capture:capture,payload:capture.payload}, "synthetic-user", "synthetic-chat",
    {now:now, io:persistenceIo(), lock:lock, sha256:hash});
  record("NUT-E2E-01-07_SINGLE_DURABLE_WRITE", persisted.ok && persisted.code === "NUTRITION_SAVED" &&
    durable.length === 1 && durable[0].transaction_status === "COMMITTED", {persisted:persisted,durable:durable});
  record("NUT-E2E-01-08_DURABLE_EXACT_VALUES", durable[0].calories_total === 177.5 && durable[0].protein_total === 6.35 &&
    durable[0].fat_total === 3.8 && durable[0].carbs_total === 30, durable[0]);
  persisted = persistNutritionSnapshot_({capture:capture,payload:capture.payload}, "synthetic-user", "synthetic-chat",
    {now:now, io:persistenceIo(), lock:lock, sha256:hash});
  record("NUT-E2E-01-09_IDEMPOTENT_CONFIRM_REPLAY", persisted.ok && persisted.code === "NUTRITION_ALREADY_SAVED" &&
    persisted.rows_written === 0 && durable.length === 1, persisted);

  function table() { return {headers:C232B4_NUTRITION_SCHEMA.slice(), rows:durable.map(nutritionMealRecordValues_)}; }
  function formatDateTime(date, zone, pattern) {
    const shifted = new Date(new Date(date).getTime() + 3 * 3600000);
    return pattern === "HH:mm" ? shifted.toISOString().slice(11,16) : shifted.toISOString().slice(0,10);
  }
  const historyDependencies = {time_zone:function(){return "Europe/Moscow";},
    format_date:function(date){return formatDateTime(date,null,"yyyy-MM-dd");},read_table:table};
  const history = routeNutritionHistory_({message:{text:"что я ел сегодня",from:{id:"synthetic-user"},chat:{id:"synthetic-chat"}}},
    {now:now, dependencies:historyDependencies, format_options:{format_date_time:formatDateTime}});
  record("NUT-E2E-01-10_HISTORY_READBACK", history.ok && /овсяную кашу на воде/i.test(history.message) &&
    /177,5 ккал/.test(history.message) && /Б 6,35/.test(history.message), history);

  const effective = loadEffectiveNutritionMeals_("synthetic-user", table(), null, historyDependencies.format_date);
  const resolution = resolveNutritionTargetCandidates_(effective.effective_meals,
    {relation:"LAST_MATCHING_MEAL",target_scope_hint:"ITEM",temporal_scope:"ANY",food_text:"овсяная каша",preparation_state:null},
    {food_id:"oatmeal",preparation_state:null},{});
  const proposal = buildQuantityNutritionReplacement_(resolution, 300, "г");
  record("NUT-E2E-01-11_CORRECTION_PROPOSAL", proposal.ok && resolution.resolved_target.item_selector.quantity_value === 250 &&
    proposal.new_snapshot.items[0].quantity_value === 300 && proposal.new_snapshot.totals.calories === 213 &&
    proposal.new_snapshot.totals.protein === 7.62 && proposal.new_snapshot.totals.fat === 4.56 &&
    proposal.new_snapshot.totals.carbs === 36, proposal);
  const replaceIo = persistenceIo();
  replaceIo.read_table = table;
  const replaced = replaceNutritionMeal_("synthetic-user", proposal, {now:new Date(now.getTime()+60000),
    capture_id:"nut-e2e-01-replace", persistence_enabled:true, io:replaceIo, lock:lock, sha256:hash});
  record("NUT-E2E-01-12_CORRECTION_SINGLE_REVISION", replaced.ok && replaced.rows_written === 1 && durable.length === 2 &&
    durable[1].operation_type === "REPLACE" && durable[1].revision === 2, {replaced:replaced,durable:durable});
  const correctedHistory = routeNutritionHistory_({message:{text:"что я ел сегодня",from:{id:"synthetic-user"},chat:{id:"synthetic-chat"}}},
    {now:now, dependencies:historyDependencies, format_options:{format_date_time:formatDateTime}});
  record("NUT-E2E-01-13_CORRECTED_HISTORY", correctedHistory.ok && /300 г/.test(correctedHistory.message) &&
    /213 ккал/.test(correctedHistory.message) && !/250 г/.test(correctedHistory.message), correctedHistory);

  const serializedCapture = JSON.parse(JSON.stringify(capture));
  record("NUT-E2E-01-14_CONTEXT_SURVIVES_RUNTIME", serializedCapture.payload.domain === "NUTRITION" &&
    serializedCapture.payload.nutrition_calculation.totals.calories === 177.5 && serializedCapture.user_id === "synthetic-user", serializedCapture);

  const failedCapture = clone(capture); failedCapture.capture_id = "nut-e2e-01-failure";
  failedCapture.payload.capture_id = failedCapture.capture_id; failedCapture.status = "PENDING_CONFIRMATION";
  const failingIo = {
    get_capture:function(){return failedCapture;},checkpoint_capture:function(target,status,result,confirmedAt,error){target.status=status;target.saved_targets_json=JSON.stringify(result||{});target.confirmed_at=confirmedAt||"";target.error=error||"";},
    find_meals:function(){return [];},append_meal:function(){throw new Error("synthetic save failure");},read_meal:function(){return null;},write_meal:function(){}
  };
  const failed = persistNutritionSnapshot_({capture:failedCapture,payload:failedCapture.payload}, "synthetic-user", "synthetic-chat",
    {now:now,io:failingIo,lock:lock,sha256:hash});
  record("NUT-E2E-01-15_SAVE_FAILURE_FAILS_CLOSED", !failed.ok && failed.code === "NUTRITION_PREPARING_WRITE_FAILED" &&
    failedCapture.status === "SAVING", {failed:failed,capture:failedCapture});
  const retryRows = [];
  const retryIo = {
    get_capture:function(){return failedCapture;},checkpoint_capture:function(target,status,result,confirmedAt,error){target.status=status;target.saved_targets_json=JSON.stringify(result||{});target.confirmed_at=confirmedAt||"";target.error=error||"";},
    find_meals:function(captureId){return retryRows.map(function(row,index){return {row_number:index+2,record:clone(row)};}).filter(function(row){return row.record.capture_id===captureId;});},
    append_meal:function(record){retryRows.push(clone(record));return retryRows.length+1;},read_meal:function(row){return clone(retryRows[row-2]);},
    write_meal:function(row,record){retryRows[row-2]=clone(record);}
  };
  const retried = persistNutritionSnapshot_({capture:failedCapture,payload:failedCapture.payload}, "synthetic-user", "synthetic-chat",
    {now:new Date(now.getTime()+60000),io:retryIo,lock:lock,sha256:hash});
  record("NUT-E2E-01-16_SAVE_FAILURE_RETRY", retried.ok && retried.code === "NUTRITION_SAVED" &&
    retryRows.length === 1 && retryRows[0].transaction_status === "COMMITTED" && failedCapture.status === "SAVED",
    {retried:retried,rows:retryRows,capture:failedCapture});

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite:"NUT-E2E-01_OATMEAL",status:passed===tests.length?"PASS":"FAIL",total:tests.length,
    passed:passed,failed:tests.length-passed,tests:tests,safety:{real_sheet_reads:0,real_sheet_writes:0,
      telegram_calls:0,groq_calls:0,script_property_changes:0,production_writes:0}};
}
