function runC232B3NutritionConfirmationSaveTests() {
  const tests = [];
  const now = new Date("2026-08-26T12:00:00.000Z");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: passed ? {} : details || {}});
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function field(value, source) { return {value: value, confidence: 1, source: source || "TEST"}; }
  function item(foodId, display, preparation, referenceId, quantity, nutrition, provenance) {
    const source = provenance || {};
    return {category: "NUTRITION_LOG", confidence: 0.99, fields: {
      food_display: field(display), food_normalized: field(display),
      quantity_value: field(quantity), quantity_unit: field("g"),
      food_id: field(foodId), canonical_food_name: field(foodId),
      preparation_state: field(preparation), nutrition_reference_id: field(referenceId),
      reference_status: field("RESOLVED"), reference_basis_quantity: field(100),
      reference_basis_unit: field("g"),
      reference_nutrition_basis: field(Object.assign({quantity: 100, unit: "g"}, nutrition.basis)),
      calculated_nutrition: field(Object.assign({}, nutrition.calculated)),
      nutrition_authority: field(source.authority || "TEST_AUTHORITY"),
      nutrition_source: field(source.source || "TEST_SOURCE"),
      nutrition_source_version: field(source.version || "test-v1"),
      nutrition_approximate: field(true, "SYSTEM_POLICY")
    }};
  }
  function capture(twoItems) {
    const rice = item("rice", "рис вареный", "BOILED", "rice_boiled_v1", 150, {
      basis: {calories: 130, protein: 2.69, fat: 0.28, carbs: 28.17},
      calculated: {calories: 195, protein: 4.035, fat: 0.42, carbs: 42.255}
    });
    const items = [rice];
    if (twoItems === true) items.push(item("chicken_breast", "куриная грудка жареная", "FRIED",
      "chicken_breast_fried_v1", 200, {
        basis: {calories: 187, protein: 33.44, fat: 4.71, carbs: 0.51},
        calculated: {calories: 374, protein: 66.88, fat: 9.42, carbs: 1.02}
      }));
    const totals = twoItems === true
      ? {calories: 569, protein: 70.915, fat: 9.84, carbs: 43.275}
      : {calories: 195, protein: 4.035, fat: 0.42, carbs: 42.255};
    return {schema_version: "c232b2-nutrition-calculation-v1", mode: "SIMULATION",
      writes_allowed: false, capture_id: "b3-capture", created_at: now.toISOString(),
      source: "C231_DOMAIN_ROUTER", raw_message: "", domain: "NUTRITION", confidence: 0.99,
      requires_clarification: false, items: items,
      nutrition_calculation: {status: "CALCULATED", items_count: items.length,
        calculable_items_count: items.length, approximate_items_count: items.length, totals: totals}};
  }
  function environment(payload, status) {
    const env = {payload: payload, status: status || "PENDING_CONFIRMATION", confirm_calls: 0,
      cancel_calls: 0, save_calls: 0, counters: {nutrition_log_writes: 0, domain_writes: 0,
        ai_memory_writes: 0, coach_state_writes: 0, groq_calls: 0, production_writes: 0}};
    env.selected = {ok: true, code: env.status === "SAVED" ? "SAVED_CAPTURE" : "PENDING_CAPTURE",
      capture: {capture_id: payload.capture_id, user_id: "b3-user", chat_id: "b3-chat", status: env.status},
      payload: payload};
    env.dependencies = {
      validate_nutrition_snapshot: validateNutritionSnapshotForSave_,
      confirm: function() {
        env.confirm_calls += 1;
        if (env.status === "SAVED") return {ok: true, code: "ALREADY_SAVED"};
        if (env.status !== "PENDING_CONFIRMATION") return {ok: false, code: "NOT_CONFIRMABLE"};
        env.status = "SAVED"; env.selected.capture.status = "SAVED";
        return {ok: true, code: "SAVED"};
      },
      cancel: function() {
        env.cancel_calls += 1;
        if (env.status !== "PENDING_CONFIRMATION") return {ok: false, code: "NO_ACTIVE_CAPTURE"};
        env.status = "CANCELLED"; env.selected.capture.status = "CANCELLED";
        return {ok: true, code: "CANCELLED"};
      },
      save_domain: function(value, userId, options) {
        env.save_calls += 1;
        return simulateDomainFactSave_(value, userId, options);
      }
    };
    return env;
  }
  function confirm(env, userId, chatId) {
    return handleDomainFactConfirmation_(env.selected, "CONFIRM", userId || "b3-user",
      chatId || "b3-chat", now, env.dependencies);
  }
  function cancel(env) {
    return handleDomainFactConfirmation_(env.selected, "CANCEL", "b3-user", "b3-chat", now, env.dependencies);
  }
  function validationMutation(mutator) {
    const value = capture(true); mutator(value); return validateNutritionSnapshotForSave_(value);
  }

  let env = environment(capture(true)); let result = confirm(env);
  record("C23.2B3-01_B2_YES_SAVED", result.code === "SAVE_SIMULATED" && env.status === "SAVED", result);
  env = environment(capture()); result = cancel(env);
  record("C23.2B3-02_B2_NO_CANCELLED", result.code === "CANCELLED" && env.status === "CANCELLED", result);
  env = environment(capture(), "SAVED"); result = confirm(env);
  record("C23.2B3-03_DUPLICATE_YES", result.code === "ALREADY_SAVED" && env.save_calls === 0, result);
  env = environment(capture(), "CANCELLED"); result = confirm(env);
  record("C23.2B3-04_CANCELLED_NO_SAVE", result.ok === false && env.save_calls === 0, result);
  env = environment(capture(), "EXPIRED"); result = confirm(env);
  record("C23.2B3-05_EXPIRED_NO_SAVE", result.ok === false && env.save_calls === 0, result);
  env = environment(capture()); result = confirm(env, "wrong-user", "b3-chat");
  record("C23.2B3-06_OWNER_MISMATCH", result.code === "OWNER_MISMATCH" && env.confirm_calls === 0, result);
  env = environment(capture()); result = confirm(env, "b3-user", "wrong-chat");
  record("C23.2B3-07_CHAT_MISMATCH", result.code === "OWNER_MISMATCH" && env.confirm_calls === 0, result);
  let noCaptureSaves = 0;
  const noCaptureResult = routeDomainFactConfirmation_({update_id: "no-capture", message: {
    text: "да", from: {id: "b3-user"}, chat: {id: "b3-chat"}
  }}, {now: now, dependencies: {
    detect_confirmation: function() { return {intent: "CONFIRM"}; },
    find_capture: function() { return {ok: false, code: "NO_DOMAIN_CAPTURE"}; },
    get_pending: function() { return {ok: false, code: "NO_ACTIVE_CAPTURE"}; },
    create_pending: function() { return {ok: false}; }, confirm: function() { return {ok: false}; },
    cancel: function() { return {ok: false}; }, save_domain: function() { noCaptureSaves += 1; },
    uuid: function() { return "unused"; }
  }, reference_options: {resolution_disabled: true}});
  record("C23.2B3-08_NO_CAPTURE_SAFE", noCaptureResult.handled === false && noCaptureSaves === 0, noCaptureResult);

  let saved = simulateNutritionDomainFactSave_(capture(), {now: now, capture_id: "single"});
  record("C23.2B3-09_SINGLE_SNAPSHOT", saved.items.length === 1 && saved.items[0].calculated_nutrition.protein === 4.035, saved);
  saved = simulateNutritionDomainFactSave_(capture(true), {now: now, capture_id: "multi"});
  record("C23.2B3-10_MULTI_SNAPSHOT", saved.items.length === 2 && saved.items_count === 2, saved);
  record("C23.2B3-11_INTERNAL_TOTALS", saved.nutrition_totals.protein === 70.915 && saved.nutrition_totals.fat === 9.84, saved);
  record("C23.2B3-12_NO_DISPLAY_TOTAL_SUBSTITUTION", saved.nutrition_totals.protein !== 70.9 && saved.nutrition_totals.carbs !== 43.3, saved);
  record("C23.2B3-13_ITEM_ORDER", saved.items[0].food_id === "rice" && saved.items[1].food_id === "chicken_breast", saved.items);
  record("C23.2B3-14_PROVENANCE", saved.items[0].nutrition_authority === "TEST_AUTHORITY" && saved.items[0].nutrition_source_version === "test-v1", saved.items[0]);
  record("C23.2B3-15_REFERENCE_IDS", saved.items[0].nutrition_reference_id === "rice_boiled_v1" && saved.items[1].nutrition_reference_id === "chicken_breast_fried_v1", saved.items);
  record("C23.2B3-16_NO_REFERENCE_REREAD", saved.ok === true && saved.snapshot_preserved === true);
  record("C23.2B3-17_NO_ALIAS_REREAD", saved.ok === true && saved.items[0].food_display === "рис вареный");
  const frozen = capture(); const frozenSave = simulateNutritionDomainFactSave_(frozen, {now: now});
  const unrelatedReference = {CALORIES: 9999};
  record("C23.2B3-18_REFERENCE_MUTATION_NO_EFFECT", unrelatedReference.CALORIES === 9999 && frozenSave.nutrition_totals.calories === 195, frozenSave);

  record("C23.2B3-19_MISSING_CALCULATED", validationMutation(function(v) { delete v.items[0].fields.calculated_nutrition; }).ok === false);
  record("C23.2B3-20_MISSING_TOTALS", validationMutation(function(v) { delete v.nutrition_calculation.totals; }).ok === false);
  record("C23.2B3-21_ITEMS_COUNT_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.items_count = 1; }).ok === false);
  record("C23.2B3-22_CALCULABLE_COUNT_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.calculable_items_count = 1; }).ok === false);
  record("C23.2B3-23_ZERO_ITEMS", validationMutation(function(v) { v.items = []; v.nutrition_calculation.items_count = 0; v.nutrition_calculation.calculable_items_count = 0; v.nutrition_calculation.approximate_items_count = 0; }).ok === false);
  record("C23.2B3-24_OVER_TEN_ITEMS", validationMutation(function(v) { v.items = Array.from({length: 11}, function() { return clone(v.items[0]); }); v.nutrition_calculation.items_count = 11; v.nutrition_calculation.calculable_items_count = 11; v.nutrition_calculation.approximate_items_count = 11; }).ok === false);
  record("C23.2B3-25_NON_FINITE_ITEM", validationMutation(function(v) { v.items[0].fields.calculated_nutrition.value.calories = Infinity; }).ok === false);
  record("C23.2B3-26_NEGATIVE_ITEM", validationMutation(function(v) { v.items[0].fields.calculated_nutrition.value.protein = -1; }).ok === false);
  record("C23.2B3-27_NON_FINITE_TOTAL", validationMutation(function(v) { v.nutrition_calculation.totals.fat = Infinity; }).ok === false);
  record("C23.2B3-28_NEGATIVE_TOTAL", validationMutation(function(v) { v.nutrition_calculation.totals.carbs = -1; }).ok === false);
  record("C23.2B3-29_CALORIES_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.totals.calories += 1; }).ok === false);
  record("C23.2B3-30_PROTEIN_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.totals.protein += 1; }).ok === false);
  record("C23.2B3-31_FAT_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.totals.fat += 1; }).ok === false);
  record("C23.2B3-32_CARBS_MISMATCH", validationMutation(function(v) { v.nutrition_calculation.totals.carbs += 1; }).ok === false);
  record("C23.2B3-33_UNRESOLVED_ITEM", validationMutation(function(v) { v.items[0].fields.reference_status.value = "UNKNOWN_REFERENCE"; }).ok === false);
  record("C23.2B3-34_MISSING_PROVENANCE", validationMutation(function(v) { delete v.items[0].fields.nutrition_source; }).ok === false);
  record("C23.2B3-35_RAW_NONEMPTY", validationMutation(function(v) { v.raw_message = "raw"; }).ok === false);

  record("C23.2B3-36_TOLERANCE_PASS", nutritionSnapshotTotalsMatch_([{fields: {calculated_nutrition: {value: {calories: 1, protein: 1, fat: 0.42, carbs: 1}}}}], {calories: 1.0000005, protein: 1, fat: 0.42, carbs: 1}, 1e-6));
  record("C23.2B3-37_TOLERANCE_FAIL", nutritionSnapshotTotalsMatch_([{fields: {calculated_nutrition: {value: {calories: 1, protein: 1, fat: 1, carbs: 1}}}}], {calories: 1.000002, protein: 1, fat: 1, carbs: 1}, 1e-6) === false);
  record("C23.2B3-38_FLOAT_SAFE", nutritionSnapshotTotalsMatch_([{fields: {calculated_nutrition: {value: {calories: 1, protein: 1, fat: 0.42000000000000004, carbs: 1}}}}], {calories: 1, protein: 1, fat: 0.42, carbs: 1}, 1e-6));

  env = environment(capture()); const processed = {}; let savesForUpdate = 0;
  function processUpdate(id) { if (processed[id]) return "DUPLICATE_UPDATE"; processed[id] = true; const response = confirm(env); savesForUpdate += env.save_calls; env.save_calls = 0; return response.code; }
  const firstUpdate = processUpdate("update-1"); const repeatedUpdate = processUpdate("update-1");
  record("C23.2B3-39_SAME_UPDATE_DEDUP", firstUpdate === "SAVE_SIMULATED" && repeatedUpdate === "DUPLICATE_UPDATE" && savesForUpdate === 1);
  result = confirm(env);
  record("C23.2B3-40_SEPARATE_YES_NO_DUPLICATE", result.code === "ALREADY_SAVED" && env.save_calls === 0, result);
  const stableA = simulateNutritionDomainFactSave_(capture(true), {now: now, capture_id: "stable"});
  const stableB = simulateNutritionDomainFactSave_(capture(true), {now: now, capture_id: "stable"});
  record("C23.2B3-41_SAVE_RESULT_STABLE", JSON.stringify(stableA) === JSON.stringify(stableB));

  const privacyText = JSON.stringify(saved);
  record("C23.2B3-42_RAW_TEXT_ABSENT", privacyText.indexOf("съел рис") < 0, privacyText);
  record("C23.2B3-43_RAW_ALIASES_ABSENT", privacyText.indexOf("raw_alias") < 0 && privacyText.indexOf("regex") < 0, privacyText);
  const userMessage = "Данные подтверждены. Сохранение доменных данных выполнено в режиме SIMULATION.";
  record("C23.2B3-44_TECHNICAL_KEYS_ABSENT", ["nutrition_reference_id", "capture_id", "user_id", "storage"].every(function(key) { return userMessage.indexOf(key) < 0; }), userMessage);

  record("C23.2B3-45_NUTRITION_LOG_ZERO", saved.writes.nutrition_log === false);
  record("C23.2B3-46_DOMAIN_WRITES_ZERO", saved.domain_writes === 0);
  record("C23.2B3-47_AI_MEMORY_ZERO", saved.writes.ai_memory === false);
  record("C23.2B3-48_COACH_STATE_ZERO", saved.writes.coach_state === false);
  record("C23.2B3-49_GROQ_ZERO", saved.groq_calls == null);
  record("C23.2B3-50_PRODUCTION_ZERO", saved.production_writes === false && saved.writes.production === false);

  const legacyA = {schema_version: "c232a-nutrition-extraction-v1", domain: "NUTRITION", capture_id: "a"};
  const legacyB1 = {schema_version: "c232b1-nutrition-reference-v1", domain: "NUTRITION", capture_id: "b1"};
  const workout = {schema_version: "c231-domain-routing-v1", domain: "WORKOUT", capture_id: "w"};
  const recovery = {schema_version: "c231-domain-routing-v1", domain: "RECOVERY", capture_id: "r"};
  record("C23.2B3-51_LEGACY_A_GENERIC", simulateDomainFactSave_(legacyA, "u", {}).schema_version == null);
  record("C23.2B3-52_LEGACY_B1_GENERIC", simulateDomainFactSave_(legacyB1, "u", {}).schema_version == null);
  record("C23.2B3-53_WORKOUT_GENERIC", simulateDomainFactSave_(workout, "u", {}).domain === "WORKOUT");
  record("C23.2B3-54_RECOVERY_GENERIC", simulateDomainFactSave_(recovery, "u", {}).domain === "RECOVERY");
  record("C23.2B3-55_C20A_UNAFFECTED", isB2NutritionCapture_({schema_version: "c20a-weight", domain: "BODY_TRACKING"}) === false);
  record("C23.2B3-56_B1_AMBIGUITY_UNAFFECTED", isB2NutritionCapture_(legacyB1) === false);
  record("C23.2B3-57_B2_ARITHMETIC_UNAFFECTED", validateNutritionCalculatedSnapshot_(capture().items[0]) === true);
  const invalidPendingPayload = capture();
  invalidPendingPayload.nutrition_calculation.totals.protein += 1;
  env = environment(invalidPendingPayload); result = confirm(env);
  record("C23.2B3-58_INVALID_REMAINS_PENDING", result.code === "INVALID_NUTRITION_SNAPSHOT" &&
    env.status === "PENDING_CONFIRMATION" && env.confirm_calls === 0 && env.save_calls === 0, result);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite: "C-23.2B3_NUTRITION_CONFIRMATION_SIMULATION_SAVE", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {nutrition_log_writes: 0, domain_writes: 0, ai_memory_writes: 0,
      coach_state_writes: 0, telegram_calls: 0, groq_calls: 0,
      script_property_changes: 0, production_writes: 0}};
}
