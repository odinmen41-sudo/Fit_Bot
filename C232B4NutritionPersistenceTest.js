function runC232B4NutritionPersistenceTests() {
  const tests = [];
  const now = new Date("2026-08-26T12:00:00.000Z");
  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: passed ? {} : details || {}});
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function field(value) { return {value: value, confidence: 1, source: "TEST"}; }
  function item(id, display, preparation, referenceId, quantity, basis, calculated) {
    return {category: "NUTRITION_LOG", fields: {
      food_display: field(display), food_id: field(id), preparation_state: field(preparation),
      nutrition_reference_id: field(referenceId), reference_status: field("RESOLVED"),
      quantity_value: field(quantity), quantity_unit: field("g"), reference_basis_quantity: field(100),
      reference_basis_unit: field("g"), reference_nutrition_basis: field(Object.assign({quantity: 100, unit: "g"}, basis)),
      calculated_nutrition: field(calculated), nutrition_authority: field("TEST_AUTHORITY"),
      nutrition_source: field("TEST_SOURCE"), nutrition_source_version: field("test-v1"),
      nutrition_approximate: field(true)
    }};
  }
  function payload(two) {
    const items = [item("rice", "рис вареный", "BOILED", "rice_boiled_v1", 150,
      {calories: 130, protein: 2.69, fat: 0.28, carbs: 28.17},
      {calories: 195, protein: 4.035, fat: 0.42, carbs: 42.255})];
    if (two) items.push(item("chicken_breast", "куриная грудка жареная", "FRIED",
      "chicken_breast_fried_v1", 200,
      {calories: 187, protein: 33.44, fat: 4.71, carbs: 0.51},
      {calories: 374, protein: 66.88, fat: 9.42, carbs: 1.02}));
    const totals = two ? {calories: 569, protein: 70.915, fat: 9.84, carbs: 43.275} :
      {calories: 195, protein: 4.035, fat: 0.42, carbs: 42.255};
    return {schema_version: "c232b2-nutrition-calculation-v1", capture_id: "b4-capture",
      source: "C231_DOMAIN_ROUTER", raw_message: "", domain: "NUTRITION", items: items,
      nutrition_calculation: {status: "CALCULATED", items_count: items.length,
        calculable_items_count: items.length, approximate_items_count: items.length, totals: totals}};
  }
  function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i += 1) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return "test-sha256-" + (value >>> 0).toString(16) + "-" + text.length;
  }
  function environment(two) {
    const p = payload(two);
    const env = {meals: [], checkpoints: [], writes: 0, reads: 0, lock_acquired: 0, lock_released: 0,
      capture: {capture_id: p.capture_id, user_id: "b4-user", chat_id: "b4-chat",
        status: "PENDING_CONFIRMATION", expires_at: new Date(now.getTime() + 60000), payload: p}};
    env.io = {
      get_capture: function() { return env.capture; },
      checkpoint_capture: function(capture, status, result, confirmedAt, error) {
        capture.status = status; capture.saved_targets_json = JSON.stringify(result || {});
        capture.confirmed_at = confirmedAt || ""; capture.error = error || "";
        env.checkpoints.push({status: status, result: clone(result || {})});
      },
      find_meals: function(captureId) {
        return env.meals.map(function(record, index) { return {row_number: index + 2, record: clone(record)}; })
          .filter(function(row) { return row.record.capture_id === captureId; });
      },
      append_meal: function(record) { env.writes += 1; env.meals.push(clone(record)); return env.meals.length + 1; },
      read_meal: function(row) { env.reads += 1; return clone(env.meals[row - 2]); },
      write_meal: function(row, record) { env.writes += 1; env.meals[row - 2] = clone(record); }
    };
    env.lock = {tryLock: function() { env.lock_acquired += 1; return true; },
      releaseLock: function() { env.lock_released += 1; }};
    env.selected = {capture: env.capture, payload: p};
    env.run = function(extra) { return persistNutritionSnapshot_(env.selected, "b4-user", "b4-chat",
      Object.assign({now: now, io: env.io, lock: env.lock, sha256: hash}, extra || {})); };
    return env;
  }
  function props(values) { return {getProperty: function(name) { return values[name] == null ? null : values[name]; }}; }

  record("C23.2B4-01_GATE_MISSING", !nutritionPersistenceEnabled_({properties: props({})}));
  record("C23.2B4-02_GATE_FALSE", !nutritionPersistenceEnabled_({properties: props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_PERSISTENCE_ENABLED:"false"})}));
  record("C23.2B4-03_GATE_MALFORMED", !nutritionPersistenceEnabled_({properties: props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_PERSISTENCE_ENABLED:"TRUE"})}));
  record("C23.2B4-04_GATE_ALLOWED", nutritionPersistenceEnabled_({properties: props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"SIMULATION",NUTRITION_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2B4-05_PRODUCTION_BLOCKED", !nutritionPersistenceEnabled_({properties: props({DEPLOYMENT_ENV:"PRODUCTION",DATA_WRITE_MODE:"SIMULATION",NUTRITION_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2B4-06_NON_SIMULATION_BLOCKED", !nutritionPersistenceEnabled_({properties: props({DEPLOYMENT_ENV:"STAGING",DATA_WRITE_MODE:"CANARY",NUTRITION_PERSISTENCE_ENABLED:"true"})}));
  record("C23.2B4-07_MISSING_ENV_BLOCKED", !nutritionPersistenceEnabled_({properties: props({DATA_WRITE_MODE:"SIMULATION",NUTRITION_PERSISTENCE_ENABLED:"true"})}));

  record("C23.2B4-08_SCHEMA_EXACT", validateNutritionLogSchema_(C232B4_NUTRITION_SCHEMA.slice()));
  record("C23.2B4-09_SCHEMA_MISSING", !validateNutritionLogSchema_(C232B4_NUTRITION_SCHEMA.slice(0, 16)));
  const wrong = C232B4_NUTRITION_SCHEMA.slice(); wrong[0] = "WRONG";
  record("C23.2B4-10_SCHEMA_WRONG", !validateNutritionLogSchema_(wrong));
  const reordered = C232B4_NUTRITION_SCHEMA.slice(); const swap = reordered[1]; reordered[1] = reordered[2]; reordered[2] = swap;
  record("C23.2B4-11_SCHEMA_REORDERED", !validateNutritionLogSchema_(reordered));
  const duplicate = C232B4_NUTRITION_SCHEMA.slice(); duplicate[2] = duplicate[1];
  record("C23.2B4-12_SCHEMA_DUPLICATE", !validateNutritionLogSchema_(duplicate));

  let env = environment(false); let result = env.run();
  record("C23.2B4-13_SINGLE_ITEM", result.ok && result.items_count === 1, result);
  env = environment(true); result = env.run();
  record("C23.2B4-14_MULTI_ITEM", result.ok && result.items_count === 2, result);
  record("C23.2B4-15_EXACT_TOTALS", result.nutrition_totals.protein === 70.915 && result.nutrition_totals.carbs === 43.275, result);
  const storedItems = JSON.parse(env.meals[0].items_json);
  record("C23.2B4-16_ORDERED_ITEMS", storedItems[0].food_id === "rice" && storedItems[1].food_id === "chicken_breast", storedItems);
  record("C23.2B4-17_PROVENANCE", storedItems[0].nutrition_authority === "TEST_AUTHORITY" && storedItems[1].nutrition_source_version === "test-v1", storedItems);
  record("C23.2B4-18_MEAL_ID", env.meals[0].meal_id === "meal:b4-capture", env.meals[0]);
  const recordA = buildNutritionMealRecord_(payload(true), env.capture, now, {sha256: hash});
  const recordB = buildNutritionMealRecord_(payload(true), env.capture, now, {sha256: hash});
  record("C23.2B4-19_HASH_DETERMINISTIC", recordA.snapshot_hash === recordB.snapshot_hash);
  const changed = payload(true); changed.items[0].fields.calculated_nutrition.value.protein += 1;
  record("C23.2B4-20_HASH_VALUE_CHANGE", recordA.snapshot_hash !== buildNutritionMealRecord_(changed, env.capture, now, {sha256: hash}).snapshot_hash);
  const reversed = payload(true); reversed.items.reverse();
  record("C23.2B4-21_HASH_ORDER_CHANGE", recordA.snapshot_hash !== buildNutritionMealRecord_(reversed, env.capture, now, {sha256: hash}).snapshot_hash);
  record("C23.2B4-22_ONE_ROW", env.meals.length === 1 && result.rows_written === 1, env.meals);
  record("C23.2B4-23_COMMITTED", env.meals[0].transaction_status === "COMMITTED" && env.capture.status === "SAVED", env);
  record("C23.2B4-24_READBACK", env.reads === 2, env.reads);
  record("C23.2B4-25_SINGLE_LOCK", env.lock_acquired === 1 && env.lock_released === 1, env);

  result = env.run();
  record("C23.2B4-26_DUPLICATE_CONFIRM", result.code === "NUTRITION_ALREADY_SAVED" && env.meals.length === 1 && result.idempotent_replay, result);
  record("C23.2B4-27_REPLAY_ZERO_WRITE", result.rows_written === 0 && result.domain_writes === 0, result);
  let preparingEnv = environment(true); const prepared = buildNutritionMealRecord_(preparingEnv.capture.payload, preparingEnv.capture, now, {sha256: hash});
  preparingEnv.meals.push(clone(prepared)); preparingEnv.capture.status = "SAVING"; result = preparingEnv.run();
  record("C23.2B4-28_PREPARING_RESUME", result.ok && preparingEnv.meals.length === 1 && preparingEnv.meals[0].transaction_status === "COMMITTED", result);
  let conflictEnv = environment(true); const conflict = buildNutritionMealRecord_(conflictEnv.capture.payload, conflictEnv.capture, now, {sha256: hash}); conflict.snapshot_hash = "other"; conflictEnv.meals.push(conflict);
  result = conflictEnv.run(); record("C23.2B4-29_HASH_CONFLICT", result.code === "NUTRITION_PERSISTENCE_CONFLICT" && conflictEnv.meals.length === 1, result);
  let duplicateEnv = environment(true); const duplicateRecord = buildNutritionMealRecord_(duplicateEnv.capture.payload, duplicateEnv.capture, now, {sha256: hash}); duplicateEnv.meals.push(clone(duplicateRecord), clone(duplicateRecord));
  result = duplicateEnv.run(); record("C23.2B4-30_DUPLICATE_ROWS_CONFLICT", result.code === "NUTRITION_PERSISTENCE_CONFLICT", result);
  let corruptEnv = environment(true); const corrupt = buildNutritionMealRecord_(corruptEnv.capture.payload, corruptEnv.capture, now, {sha256: hash}); corrupt.transaction_status = "BROKEN"; corruptEnv.meals.push(corrupt);
  result = corruptEnv.run(); record("C23.2B4-31_CORRUPT_ROW", result.code === "NUTRITION_DURABLE_ROW_CORRUPT", result);

  const failurePoints = ["AFTER_CAPTURE_CHECKPOINT", "BEFORE_PREPARING_WRITE", "AFTER_PREPARING_WRITE",
    "AFTER_PREPARING_READ", "AFTER_PREPARING_VERIFY", "BEFORE_COMMIT_WRITE", "AFTER_COMMIT_WRITE",
    "AFTER_COMMIT_READ", "AFTER_COMMIT_VERIFY", "BEFORE_CAPTURE_FINALIZE", "AFTER_CAPTURE_FINALIZE"];
  failurePoints.forEach(function(point, index) {
    const failed = environment(true); const first = failed.run({failure_point: point}); const retry = failed.run();
    record("C23.2B4-" + (32 + index) + "_RECOVER_" + point,
      first.ok === false && retry.ok === true && failed.meals.length === 1 && failed.capture.status === "SAVED",
      {first: first, retry: retry, meals: failed.meals.length, status: failed.capture.status});
  });

  env = environment(true); env.capture.status = "FAILED"; result = env.run();
  record("C23.2B4-43_FAILED_RECOVERY", result.ok && env.meals.length === 1, result);
  env = environment(true); env.capture.status = "SAVING"; env.capture.expires_at = new Date(now.getTime() - 1); result = env.run();
  record("C23.2B4-44_EXPIRED_RECOVERY", result.ok && env.meals.length === 1, result);
  env = environment(true); env.capture.expires_at = new Date(now.getTime() - 1); result = env.run();
  record("C23.2B4-45_EXPIRED_FRESH_BLOCKED", result.code === "EXPIRED" && env.meals.length === 0, result);
  env = environment(true); result = persistNutritionSnapshot_(env.selected, "other", "b4-chat", {now:now,io:env.io,lock:env.lock,sha256:hash});
  record("C23.2B4-46_WRONG_OWNER", result.code === "OWNER_MISMATCH" && env.meals.length === 0, result);
  env = environment(true); result = persistNutritionSnapshot_(env.selected, "b4-user", "other", {now:now,io:env.io,lock:env.lock,sha256:hash});
  record("C23.2B4-47_WRONG_CHAT", result.code === "OWNER_MISMATCH" && env.meals.length === 0, result);
  env = environment(true); env.capture.payload.nutrition_calculation.totals.protein += 1; result = env.run();
  record("C23.2B4-48_INVALID_SNAPSHOT", result.code === "INVALID_NUTRITION_SNAPSHOT" && env.meals.length === 0, result);

  env = environment(true); result = env.run(); const durableText = JSON.stringify(env.meals[0]);
  record("C23.2B4-49_PRIVACY", ["raw_message","update_id","chat_id","raw_alias","regex"].every(function(key) { return durableText.indexOf(key) < 0; }), durableText);
  record("C23.2B4-50_BOUNDED_CAPTURE_RESULT", String(env.capture.saved_targets_json).indexOf("items_json") < 0 && String(env.capture.saved_targets_json).length < 600, env.capture.saved_targets_json);
  record("C23.2B4-51_SIDE_EFFECT_CONTRACT", result.production_writes === false && result.write_target === "Nutrition_Log" && result.domain_writes === 1, result);
  const genericEnv = environment(true); let genericConfirmCalls = 0;
  const generic = handleDomainFactConfirmation_(genericEnv.selected, "CONFIRM", "b4-user", "b4-chat", now, {
    validate_nutrition_snapshot: validateNutritionSnapshotForSave_, nutrition_persistence_enabled: function(){return false;},
    confirm: function(){genericConfirmCalls += 1; return {ok:true,code:"SAVED"};}, cancel:function(){return {ok:false};},
    save_domain:function(value,user,options){return simulateDomainFactSave_(value,user,options);}
  });
  record("C23.2B4-52_GATE_OFF_B3_UNCHANGED", generic.code === "SAVE_SIMULATED" && genericConfirmCalls === 1, generic);
  record("C23.2B4-53_LEGACY_UNAFFECTED", !isB2NutritionCapture_({domain:"NUTRITION",schema_version:"c232b1-nutrition-reference-v1"}));
  record("C23.2B4-54_WORKOUT_UNAFFECTED", simulateDomainFactSave_({domain:"WORKOUT"},"u",{}).domain === "WORKOUT");
  record("C23.2B4-55_RECOVERY_UNAFFECTED", simulateDomainFactSave_({domain:"RECOVERY"},"u",{}).domain === "RECOVERY");
  record("C23.2B4-56_WEIGHT_UNAFFECTED", !isB2NutritionCapture_({domain:"BODY_TRACKING",schema_version:"c20a-weight"}));
  record("C23.2B4-57_NO_AI_STATE_GROQ", durableText.indexOf("AI_MEMORY") < 0 && durableText.indexOf("COACH_STATE") < 0 && durableText.indexOf("Groq") < 0);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite: "C-23.2B4_NUTRITION_PERSISTENCE", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {sheet_writes:0, script_property_changes:0, telegram_calls:0, groq_calls:0, production_writes:0}};
}
