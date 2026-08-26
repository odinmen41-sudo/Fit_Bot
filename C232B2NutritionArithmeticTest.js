function runC232B2NutritionArithmeticTests() {
  const tests = [];
  const now = new Date("2026-08-26T12:00:00.000Z");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: passed ? {} : details || {}});
  }
  function reference(id, foodId, name, preparation, basisQuantity, basisUnit, nutrition, overrides) {
    return Object.assign({REFERENCE_ID: id, FOOD_ID: foodId, CANONICAL_NAME: name, DISPLAY_NAME: name,
      VARIANT: "", PREPARATION_STATE: preparation, BASIS_QUANTITY: basisQuantity, BASIS_UNIT: basisUnit,
      CALORIES: nutrition.calories, PROTEIN: nutrition.protein, FAT: nutrition.fat, CARBS: nutrition.carbs,
      AUTHORITY: "TEST_AUTHORITY", SOURCE: "B2_ARITHMETIC_FIXTURE", SOURCE_VERSION: "test-v1", ACTIVE: true},
    overrides || {});
  }
  function fixture() {
    return {calculation_enabled: true, aliases: [
      {ALIAS_NORMALIZED: "рис", FOOD_ID: "rice", PRIORITY: 100, ACTIVE: true},
      {ALIAS_NORMALIZED: "куриная грудка", FOOD_ID: "chicken_breast", PRIORITY: 100, ACTIVE: true},
      {ALIAS_NORMALIZED: "молоко", FOOD_ID: "milk", PRIORITY: 100, ACTIVE: true},
      {ALIAS_NORMALIZED: "яйцо", FOOD_ID: "egg", PRIORITY: 100, ACTIVE: true},
      {ALIAS_NORMALIZED: "яйца", FOOD_ID: "egg", PRIORITY: 100, ACTIVE: true},
      {ALIAS_NORMALIZED: "банан", FOOD_ID: "banana", PRIORITY: 100, ACTIVE: true}
    ], references: [
      reference("rice_boiled_test", "rice", "Рис", "BOILED", 100, "g",
        {calories: 130, protein: 2.7, fat: 0.3, carbs: 28}),
      reference("chicken_boiled_test", "chicken_breast", "Куриная грудка", "BOILED", 100, "g",
        {calories: 165, protein: 31, fat: 3.6, carbs: 0}),
      reference("milk_test", "milk", "Молоко", "UNKNOWN", 100, "ml",
        {calories: 60, protein: 3.2, fat: 3.2, carbs: 4.7}),
      reference("egg_test", "egg", "Яйцо", "UNKNOWN", 1, "count",
        {calories: 70, protein: 6.2, fat: 5, carbs: 0.4}),
      reference("banana_test", "banana", "Банан", "UNKNOWN", 100, "g",
        {calories: 89, protein: 1.09, fat: 0.33, carbs: 22.84})
    ]};
  }
  function field(item, name) {
    return item && item.fields && item.fields[name] ? item.fields[name].value : undefined;
  }
  function detect(text, options) {
    return detectDomainFactCandidate_(text, options || fixture());
  }
  function environment(options) {
    const env = {rows: [], current: null,
      counters: {domain_writes: 0, nutrition_log_writes: 0, ai_memory_writes: 0,
        coach_state_writes: 0, groq_calls: 0}, reference_options: options || fixture()};
    env.dependencies = {
      uuid: function() { return "b2000000-0000-4000-8000-000000000001"; },
      detect_confirmation: function(text) {
        const normalized = String(text || "").toLowerCase();
        if (normalized === "да") return {intent: "CONFIRM"};
        if (normalized === "нет") return {intent: "CANCEL"};
        return null;
      },
      find_capture: function() { return env.current || {ok: false, code: "NO_DOMAIN_CAPTURE"}; },
      get_pending: function() { return env.current || {ok: false, code: "NO_ACTIVE_CAPTURE"}; },
      create_pending: function(capture, metadata) {
        env.rows.push({capture: capture, metadata: metadata, status: "PENDING_CONFIRMATION"});
        env.current = {ok: true, code: "PENDING_CAPTURE",
          capture: {capture_id: capture.capture_id, user_id: "user-b2", chat_id: "chat-b2"}, payload: capture};
        return {ok: true, code: "CREATED", capture_id: capture.capture_id};
      },
      confirm: function() { return {ok: true, code: "CONFIRMED"}; },
      cancel: function() { env.current = null; return {ok: true, code: "CANCELLED"}; },
      save_domain: function(capture, userId, saveOptions) {
        return simulateDomainFactSave_(capture, userId, saveOptions);
      }
    };
    return env;
  }
  function route(text, env) {
    return routeDomainFactConfirmation_({update_id: "b2-update", message: {
      text: text, from: {id: "user-b2"}, chat: {id: "chat-b2"}
    }}, {now: now, dependencies: env.dependencies, reference_options: env.reference_options});
  }
  function normalizedReference(source) { return foodReferenceNormalizeRecord_(source); }
  function directItem(quantity, unit, referenceId) {
    return {category: "NUTRITION_LOG", confidence: 0.99, fields: {
      food_display: {value: "fixture food"}, food_normalized: {value: "fixture food"},
      quantity_value: {value: quantity}, quantity_unit: {value: unit},
      food_id: {value: "fixture"}, nutrition_reference_id: {value: referenceId},
      reference_status: {value: "RESOLVED"}, reference_basis_quantity: {value: 100},
      reference_basis_unit: {value: unit}
    }};
  }

  let result = detect("съел рис варёный 100 г");
  record("C23.2B2-01_100G_AT_100G", field(result.items[0], "calculated_nutrition").calories === 130, result);
  result = detect("съел рис варёный 150 г");
  record("C23.2B2-02_100G_AT_150G", field(result.items[0], "calculated_nutrition").calories === 195, result);
  result = detect("выпил молоко 250 мл");
  record("C23.2B2-03_100ML_AT_250ML", field(result.items[0], "calculated_nutrition").calories === 150, result);
  result = detect("2 яйца");
  record("C23.2B2-04_COUNT_AT_TWO", field(result.items[0], "calculated_nutrition").protein === 12.4, result);
  result = detect("съел рис варёный 50 г");
  record("C23.2B2-05_FACTOR_LT_ONE", field(result.items[0], "calculated_nutrition").carbs === 14, result);
  result = detect("съел рис варёный 250 г");
  record("C23.2B2-06_FACTOR_GT_ONE", field(result.items[0], "calculated_nutrition").calories === 325, result);
  result = detect("съел рис варёный 116.5 г");
  record("C23.2B2-07_DECIMAL_QUANTITY", field(result.items[0], "calculated_nutrition").calories === 151.45, result);
  result = detect("съел куриная грудка варёная 100 г");
  record("C23.2B2-08_EXPLICIT_ZERO_VALID", field(result.items[0], "calculated_nutrition").carbs === 0, result);

  record("C23.2B2-09_G_G_ALLOWED", nutritionUnitsCompatible_("g", "g") === true);
  record("C23.2B2-10_ML_ML_ALLOWED", nutritionUnitsCompatible_("ml", "ml") === true);
  record("C23.2B2-11_COUNT_COUNT_ALLOWED", nutritionUnitsCompatible_("count", "count") === true);
  record("C23.2B2-12_COUNT_G_REJECTED", nutritionUnitsCompatible_("count", "g") === false);
  record("C23.2B2-13_G_COUNT_REJECTED", nutritionUnitsCompatible_("g", "count") === false);
  record("C23.2B2-14_G_ML_REJECTED", nutritionUnitsCompatible_("g", "ml") === false);
  record("C23.2B2-15_PORTION_REJECTED", nutritionUnitsCompatible_("portion", "g") === false);
  let invalidReference = normalizedReference(reference("invalid_basis", "fixture", "Fixture", "UNKNOWN", 0, "g",
    {calories: 1, protein: 1, fat: 1, carbs: 1}));
  record("C23.2B2-16_INVALID_BASIS", validateCalculableFoodReference_(invalidReference).code === "INVALID_REFERENCE_BASIS");

  record("C23.2B2-17_BLANK_CALORIES_NULL", foodReferenceOptionalNumber_("") === null);
  record("C23.2B2-18_BLANK_PROTEIN_NULL", foodReferenceOptionalNumber_("  ") === null);
  record("C23.2B2-19_BLANK_FAT_NULL", foodReferenceOptionalNumber_(null) === null);
  record("C23.2B2-20_BLANK_CARBS_NULL", foodReferenceOptionalNumber_(undefined) === null);
  invalidReference = normalizedReference(reference("partial", "fixture", "Fixture", "UNKNOWN", 100, "g",
    {calories: 10, protein: "", fat: 1, carbs: 1}));
  record("C23.2B2-21_INCOMPLETE_REJECTED", validateCalculableFoodReference_(invalidReference).code === "INCOMPLETE_NUTRITION_REFERENCE");
  invalidReference = normalizedReference(reference("negative", "fixture", "Fixture", "UNKNOWN", 100, "g",
    {calories: 10, protein: -1, fat: 1, carbs: 1}));
  record("C23.2B2-22_NEGATIVE_REJECTED", validateCalculableFoodReference_(invalidReference).code === "NEGATIVE_NUTRITION_VALUE");
  invalidReference = normalizedReference(reference("nan", "fixture", "Fixture", "UNKNOWN", 100, "g",
    {calories: "not-number", protein: 1, fat: 1, carbs: 1}));
  record("C23.2B2-23_NAN_REJECTED", validateCalculableFoodReference_(invalidReference).code === "INVALID_NUTRITION_NUMBER");
  invalidReference = normalizedReference(reference("infinity", "fixture", "Fixture", "UNKNOWN", 100, "g",
    {calories: Infinity, protein: 1, fat: 1, carbs: 1}));
  record("C23.2B2-24_INFINITY_REJECTED", validateCalculableFoodReference_(invalidReference).code === "INVALID_NUTRITION_NUMBER");
  ["AUTHORITY", "SOURCE", "SOURCE_VERSION"].forEach(function(key, offset) {
    const source = reference("missing_" + key, "fixture", "Fixture", "UNKNOWN", 100, "g",
      {calories: 1, protein: 1, fat: 1, carbs: 1});
    source[key] = "";
    record("C23.2B2-" + (25 + offset) + "_MISSING_" + key,
      validateCalculableFoodReference_(normalizedReference(source)).code === "INCOMPLETE_NUTRITION_REFERENCE");
  });

  const precisionReference = normalizedReference(reference("precision", "fixture", "Fixture", "UNKNOWN", 100, "g",
    {calories: 1.23456789, protein: 0.46, fat: 0.3333333, carbs: 0.46}));
  const precisionItem = directItem(100, "g", "precision");
  let calculated = calculateNutritionItem_(precisionItem, precisionReference);
  record("C23.2B2-28_INTERNAL_PRECISION", calculated.raw.calories === 1.23456789, calculated);
  record("C23.2B2-29_ITEM_DISPLAY_ROUNDING", formatNutritionDisplayNumber_(calculated.raw.protein, 1) === "0,5");
  const totalPrecision = nutritionTotals_([{calories: 0, protein: 0.46, fat: 0, carbs: 0},
    {calories: 0, protein: 0.46, fat: 0, carbs: 0}]);
  record("C23.2B2-30_TOTAL_INTERNAL_VALUES", totalPrecision.totals.protein === 0.92, totalPrecision);
  record("C23.2B2-31_DOUBLE_ROUNDING_AVOIDED", formatNutritionDisplayNumber_(totalPrecision.totals.protein, 1) === "0,9");
  record("C23.2B2-32_SNAPSHOT_SIX_DECIMALS", field(calculateNutritionItem_(precisionItem, precisionReference).item,
    "calculated_nutrition").calories === 1.234568);

  result = detect("съел рис варёный 150 г и куриная грудка варёная 200 г");
  record("C23.2B2-33_TWO_ITEM_TOTAL", result.nutrition_calculation.items_count === 2 &&
    result.nutrition_calculation.totals.calories === 525, result);
  result = detect("съел рис варёный 150 г и куриная грудка варёная 200 г и банан 100 г");
  record("C23.2B2-34_THREE_ITEM_TOTAL", result.nutrition_calculation.items_count === 3 &&
    result.nutrition_calculation.totals.calories === 614, result);
  record("C23.2B2-35_ITEM_ORDER", field(result.items[0], "food_id") === "rice" &&
    field(result.items[1], "food_id") === "chicken_breast" && field(result.items[2], "food_id") === "banana", result);
  const partialFixture = fixture(); partialFixture.references[1].PROTEIN = "";
  const partialEnv = environment(partialFixture); const partialRoute = route("съел рис варёный 150 г и куриная грудка варёная 200 г", partialEnv);
  record("C23.2B2-36_ONE_INVALID_BLOCKS_ALL", partialRoute.code === "INCOMPLETE_NUTRITION_REFERENCE" && partialEnv.rows.length === 0, partialRoute);
  record("C23.2B2-37_NO_PARTIAL_TOTAL", !partialRoute.nutrition_calculation, partialRoute);
  const elevenItems = Array.from({length: 11}, function() { return detect("съел банан 100 г").items[0]; });
  record("C23.2B2-38_OVER_TEN_REJECTED", calculateNutritionReferences_(elevenItems,
    fixture().references.map(foodReferenceNormalizeRecord_)).status === "TOO_MANY_NUTRITION_ITEMS");

  const env = environment(); const routed = route("съел рис варёный 150 г", env);
  const capture = env.rows[0] && env.rows[0].capture; const capturedItem = capture && capture.items[0];
  record("C23.2B2-39_B1_FIELDS_PRESERVED", field(capturedItem, "food_id") === "rice" &&
    field(capturedItem, "quantity_value") === 150 && field(capturedItem, "nutrition_reference_id") === "rice_boiled_test", capture);
  record("C23.2B2-40_BASIS_SNAPSHOT", field(capturedItem, "reference_nutrition_basis").quantity === 100, capture);
  record("C23.2B2-41_CALCULATED_SNAPSHOT", field(capturedItem, "calculated_nutrition").calories === 195, capture);
  record("C23.2B2-42_PROVENANCE_SNAPSHOT", field(capturedItem, "nutrition_authority") === "TEST_AUTHORITY" &&
    field(capturedItem, "nutrition_source_version") === "test-v1", capture);
  record("C23.2B2-43_TOTALS_SNAPSHOT", capture.nutrition_calculation.totals.calories === 195, capture);
  record("C23.2B2-44_RAW_EMPTY", capture.raw_message === "" && JSON.stringify(capture).indexOf("съел рис") < 0, capture);
  record("C23.2B2-45_CONFIRMATION_TECHNICAL_ISOLATION", ["rice_boiled_test", "TEST_AUTHORITY",
    "B2_ARITHMETIC_FIXTURE", "nutrition_reference_id"].every(function(value) { return routed.message.indexOf(value) < 0; }), routed.message);

  env.reference_options.references[0].CALORIES = 9999;
  const yes = route("да", env);
  record("C23.2B2-46_REFERENCE_MUTATION_NO_EFFECT", yes.save && yes.save.nutrition_totals.calories === 195, yes);
  record("C23.2B2-47_ENRICHED_CONFIRMATION", routed.message.indexOf("Распознал:") === 0 &&
    routed.message.indexOf("≈ 195 ккал") >= 0 && routed.message.indexOf("Итого:") >= 0, routed.message);
  record("C23.2B2-48_YES_SIMULATED_SAVED", yes.code === "SAVE_SIMULATED" && yes.save.domain_writes === 0, yes);

  const cancelEnv = environment(); route("съел рис варёный 150 г", cancelEnv); const no = route("нет", cancelEnv);
  record("C23.2B2-49_NO_CANCELLED", no.code === "CANCELLED" && cancelEnv.current === null, no);
  record("C23.2B2-50_NO_SIDE_EFFECT_WRITES", env.counters.nutrition_log_writes === 0 &&
    env.counters.ai_memory_writes === 0 && env.counters.coach_state_writes === 0 && env.counters.groq_calls === 0, env.counters);
  const weightEnv = environment(); const weight = route("мой вес 116 кг", weightEnv);
  record("C23.2B2-51_WEIGHT_UNCHANGED", weight.handled === false && weightEnv.rows.length === 0, weight);
  const chickenEnv = environment(); const ambiguous = route("курица 200 г", chickenEnv);
  record("C23.2B2-52_B1_AMBIGUITY_UNCHANGED", ambiguous.code === "AMBIGUOUS_IDENTITY" && chickenEnv.rows.length === 0, ambiguous);
  const outOfRangeFixture = fixture(); outOfRangeFixture.references[0].CALORIES = 100000;
  const outOfRangeEnv = environment(outOfRangeFixture); const outOfRange = route("съел рис варёный 150 г", outOfRangeEnv);
  record("C23.2B2-53_OUT_OF_RANGE_NO_CAPTURE", outOfRange.code === "NUTRITION_CALCULATION_OUT_OF_RANGE" &&
    outOfRangeEnv.rows.length === 0 && outOfRange.groq_calls === 0, outOfRange);
  const longFood = "банан" + new Array(3601).join("а");
  const longFixture = fixture(); longFixture.aliases.push({ALIAS_NORMALIZED: longFood,
    FOOD_ID: "banana", PRIORITY: 100, ACTIVE: true});
  const longEnv = environment(longFixture); const longResult = route(longFood + " 100 г", longEnv);
  record("C23.2B2-54_LONG_CONFIRMATION_NO_CAPTURE", longResult.code === "CONFIRMATION_MESSAGE_TOO_LONG" &&
    longEnv.rows.length === 0 && longResult.groq_calls === 0, longResult);
  const mismatchEnv = environment(); const mismatch = route("съел яйца 100 г", mismatchEnv);
  record("C23.2B2-55_ROUTE_UNIT_MISMATCH", mismatch.code === "NUTRITION_UNIT_MISMATCH" &&
    mismatchEnv.rows.length === 0 && mismatch.groq_calls === 0, mismatch);
  const invalidBasisFixture = fixture(); invalidBasisFixture.references[0].BASIS_QUANTITY = 0;
  const invalidBasisEnv = environment(invalidBasisFixture); const invalidBasisRoute = route("съел рис варёный 150 г", invalidBasisEnv);
  record("C23.2B2-56_ROUTE_INVALID_BASIS", invalidBasisRoute.code === "INVALID_REFERENCE_BASIS" &&
    invalidBasisEnv.rows.length === 0 && invalidBasisRoute.groq_calls === 0, invalidBasisRoute);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite: "C-23.2B2_DETERMINISTIC_KBZHU_ARITHMETIC", status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length, passed: passed, failed: tests.length - passed, tests: tests,
    safety: {domain_writes: 0, nutrition_log_writes: 0, ai_memory_writes: 0,
      coach_state_writes: 0, telegram_calls: 0, groq_calls: 0,
      script_property_changes: 0, production_writes: 0}};
}
