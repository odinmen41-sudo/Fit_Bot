function runC232B1FoodIdentityReferenceTests() {
  const tests = [];
  const now = new Date("2026-08-26T08:00:00.000Z");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: details || {}});
  }

  function fixture() {
    return {
      aliases: [
        {ALIAS_NORMALIZED: "рис", FOOD_ID: "rice", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "риса", FOOD_ID: "rice", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "куриная грудка", FOOD_ID: "chicken_breast", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "куриную грудку", FOOD_ID: "chicken_breast", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "грудка", FOOD_ID: "chicken_breast", PRIORITY: 90, ACTIVE: true},
        {ALIAS_NORMALIZED: "грудку", FOOD_ID: "chicken_breast", PRIORITY: 90, ACTIVE: true},
        {ALIAS_NORMALIZED: "гречка", FOOD_ID: "buckwheat", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "гречку", FOOD_ID: "buckwheat", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "творог 2", FOOD_ID: "cottage_cheese", VARIANT_HINT: "fat_2_percent", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "творога 2", FOOD_ID: "cottage_cheese", VARIANT_HINT: "fat_2_percent", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "творог 9", FOOD_ID: "cottage_cheese", VARIANT_HINT: "fat_9_percent", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "творога 9", FOOD_ID: "cottage_cheese", VARIANT_HINT: "fat_9_percent", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "банан", FOOD_ID: "banana", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "яйца", FOOD_ID: "egg", PRIORITY: 100, ACTIVE: true},
        {ALIAS_NORMALIZED: "яйцо", FOOD_ID: "egg", PRIORITY: 100, ACTIVE: true}
      ],
      references: [
        reference("rice_boiled_v1", "rice", "Рис", "", "BOILED", 100, "g"),
        reference("rice_dry_v1", "rice", "Рис", "", "DRY", 100, "g"),
        reference("chicken_breast_boiled_v1", "chicken_breast", "Куриная грудка", "", "BOILED", 100, "g"),
        reference("chicken_breast_fried_v1", "chicken_breast", "Куриная грудка", "", "FRIED", 100, "g"),
        reference("buckwheat_boiled_v1", "buckwheat", "Гречка", "", "BOILED", 100, "g"),
        reference("cottage_cheese_2pct_v1", "cottage_cheese", "Творог 2%", "fat_2_percent", "UNKNOWN", 100, "g"),
        reference("cottage_cheese_9pct_v1", "cottage_cheese", "Творог 9%", "fat_9_percent", "UNKNOWN", 100, "g"),
        reference("banana_raw_v1", "banana", "Банан", "", "UNKNOWN", 100, "g"),
        reference("egg_count_v1", "egg", "Яйцо", "", "UNKNOWN", 1, "count"),
        Object.assign(reference("egg_100g_inactive_v1", "egg", "Яйцо", "", "UNKNOWN", 100, "g"), {ACTIVE: false})
      ]
    };
  }

  function reference(id, foodId, name, variant, preparation, basisQuantity, basisUnit) {
    return {REFERENCE_ID: id, FOOD_ID: foodId, CANONICAL_NAME: name, DISPLAY_NAME: name,
      VARIANT: variant, PREPARATION_STATE: preparation, BASIS_QUANTITY: basisQuantity,
      BASIS_UNIT: basisUnit, CALORIES: 0, PROTEIN: 0, FAT: 0, CARBS: 0,
      AUTHORITY: "TEST", SOURCE: "B1_FIXTURE", SOURCE_VERSION: "1", ACTIVE: true};
  }

  function field(item, name) {
    return item && item.fields && item.fields[name] ? item.fields[name].value : undefined;
  }

  function detect(text, options) {
    return detectDomainFactCandidate_(text, options || fixture());
  }

  function environment(options) {
    const rows = [];
    const counters = {domain_writes: 0, groq_calls: 0, ai_memory_writes: 0, coach_state_writes: 0};
    return {
      rows: rows,
      counters: counters,
      reference_options: options || fixture(),
      dependencies: {
        uuid: function() { return "b1000000-0000-4000-8000-000000000001"; },
        detect_confirmation: function() { return null; },
        find_capture: function() { return {ok: false, code: "NO_DOMAIN_CAPTURE"}; },
        get_pending: function() { return {ok: false, code: "NO_ACTIVE_CAPTURE"}; },
        create_pending: function(capture, metadata) {
          rows.push({capture: capture, metadata: metadata, status: "PENDING_CONFIRMATION"});
          return {ok: true, code: "CREATED", capture_id: capture.capture_id};
        },
        confirm: function() { return {ok: false, code: "NOT_USED"}; },
        cancel: function() { return {ok: false, code: "NOT_USED"}; },
        save_domain: function() { counters.domain_writes += 1; return {ok: false, code: "NOT_USED"}; }
      }
    };
  }

  function route(text, env) {
    return routeDomainFactConfirmation_({update_id: "b1-update", message: {
      text: text, from: {id: "user-b1"}, chat: {id: "chat-b1"}
    }}, {now: now, dependencies: env.dependencies, reference_options: env.reference_options});
  }

  let result = detect("съел рис варёный 150 г");
  record("C23.2B1-01_RICE_IDENTITY", field(result.items[0], "food_id") === "rice", result);
  result = detect("съел риса варёного 150 г");
  record("C23.2B1-02_RICE_INFLECTED_ALIAS", field(result.items[0], "food_id") === "rice", result);
  result = detect("съел куриную грудку варёную 200 г");
  record("C23.2B1-03_CHICKEN_BREAST_INFLECTED", field(result.items[0], "food_id") === "chicken_breast", result);
  result = detect("съел грудку варёную 200 г");
  record("C23.2B1-04_BREAST_SHORT_ALIAS", field(result.items[0], "food_id") === "chicken_breast", result);
  result = detect("съел курицу 200 г");
  record("C23.2B1-05_CHICKEN_NOT_BREAST", field(result.items[0], "food_id") !== "chicken_breast" &&
    result.reference_status !== "RESOLVED", result);
  const cottage2 = detect("съел творог 2% 200 г");
  const cottage9 = detect("съел творог 9% 200 г");
  record("C23.2B1-06_COTTAGE_2_IDENTITY", field(cottage2.items[0], "food_variant") === "fat_2_percent", cottage2);
  record("C23.2B1-07_COTTAGE_VARIANTS_DISTINCT", field(cottage2.items[0], "nutrition_reference_id") !==
    field(cottage9.items[0], "nutrition_reference_id"), {two: cottage2, nine: cottage9});

  let env = environment();
  result = route("съел рис 150 г", env);
  record("C23.2B1-08_RICE_PREP_CLARIFICATION", result.code === "CLARIFICATION_REQUIRED" && env.rows.length === 0, result);
  result = detect("съел рис варёный 150 г");
  record("C23.2B1-09_RICE_BOILED", field(result.items[0], "preparation_state") === "BOILED" &&
    result.reference_status === "RESOLVED", result);
  result = detect("съел рис сухой 150 г");
  record("C23.2B1-10_RICE_DRY", field(result.items[0], "preparation_state") === "DRY" &&
    result.reference_status === "RESOLVED", result);
  env = environment(); result = route("съел грудку 200 г", env);
  record("C23.2B1-11_BREAST_PREP_CLARIFICATION", result.code === "CLARIFICATION_REQUIRED" && env.rows.length === 0, result);
  result = detect("съел грудку варёную 200 г");
  record("C23.2B1-12_BREAST_BOILED", field(result.items[0], "nutrition_reference_id") ===
    "chicken_breast_boiled_v1", result);
  result = detect("съел грудку жареную 200 г");
  record("C23.2B1-13_BREAST_FRIED", field(result.items[0], "nutrition_reference_id") ===
    "chicken_breast_fried_v1", result);

  const boiled = detect("съел рис варёный 150 г");
  const dry = detect("съел рис сухой 150 г");
  record("C23.2B1-14_RICE_REFERENCES_DISTINCT", field(boiled.items[0], "nutrition_reference_id") !==
    field(dry.items[0], "nutrition_reference_id"), {boiled: boiled, dry: dry});
  record("C23.2B1-15_COTTAGE_REFERENCES_DISTINCT", field(cottage2.items[0], "nutrition_reference_id") ===
    "cottage_cheese_2pct_v1" && field(cottage9.items[0], "nutrition_reference_id") ===
    "cottage_cheese_9pct_v1", {two: cottage2, nine: cottage9});
  record("C23.2B1-16_BASIS_UNIT_PRESERVED", field(boiled.items[0], "reference_basis_quantity") === 100 &&
    field(boiled.items[0], "reference_basis_unit") === "g", boiled);
  const eggs = detect("3 яйца");
  record("C23.2B1-17_EGG_COUNT_BASIS", field(eggs.items[0], "nutrition_reference_id") === "egg_count_v1" &&
    field(eggs.items[0], "reference_basis_unit") === "count", eggs);
  const gramEgg = detect("съел яйца 100 г");
  record("C23.2B1-18_EGG_BASIS_MISMATCH", gramEgg.reference_status === "UNKNOWN_REFERENCE" &&
    field(gramEgg.items[0], "nutrition_reference_id") === null, gramEgg);

  env = environment(); result = route("съел курицу 200 г", env);
  record("C23.2B1-19_CHICKEN_FAIL_CLOSED", result.code !== "CAPTURE_CREATED" && env.rows.length === 0, result);
  result = detect("съел котлета домашняя 180 г");
  record("C23.2B1-20_HOMEMADE_CUTLET_UNKNOWN", result.reference_status === "UNKNOWN_REFERENCE", result);
  result = detect("съел шаурма 450 г");
  record("C23.2B1-21_SHAWARMA_UNKNOWN", result.reference_status === "UNKNOWN_REFERENCE", result);
  result = detect("съел солянка 300 г");
  record("C23.2B1-22_SOLYANKA_UNKNOWN", result.reference_status === "UNKNOWN_REFERENCE", result);
  const collisionFixture = fixture();
  collisionFixture.aliases.push({ALIAS_NORMALIZED: "рис", FOOD_ID: "wild_rice", PRIORITY: 100, ACTIVE: true});
  result = detect("съел рис 150 г", collisionFixture);
  record("C23.2B1-23_ALIAS_COLLISION", result.reference_status === "AMBIGUOUS_IDENTITY", result);

  result = detect("съел рис варёный 150 г");
  const item = result.items[0];
  record("C23.2B1-24_A_FIELDS_PRESERVED", field(item, "food_display") === "рис вареный" &&
    field(item, "food_normalized") === "рис вареный" && field(item, "quantity_value") === 150 &&
    field(item, "quantity_unit") === "g", item);
  record("C23.2B1-25_FOOD_ID_ADDED", field(item, "food_id") === "rice", item);
  record("C23.2B1-26_REFERENCE_STATUS_ADDED", field(item, "reference_status") === "RESOLVED", item);
  record("C23.2B1-27_NO_CALCULATED_MACROS", ["calories", "protein", "fat", "carbs"].every(function(key) {
    return !Object.prototype.hasOwnProperty.call(item.fields, key);
  }), item);
  env = environment(); result = route("съел рис варёный 150 г", env);
  const payload = env.rows[0] && env.rows[0].capture;
  record("C23.2B1-28_RAW_MESSAGE_EMPTY", payload && payload.raw_message === "" &&
    JSON.stringify(payload).indexOf("съел рис варёный 150 г") < 0, payload);
  record("C23.2B1-29_B1_CAPTURE_SCHEMA", result.code === "CAPTURE_CREATED" && payload &&
    payload.schema_version === "c232b1-nutrition-reference-v1", {result: result, payload: payload});

  env = environment(); result = route("сколько калорий в рисе?", env);
  record("C23.2B1-30_QUESTION_FALLS_THROUGH", !result.handled && env.rows.length === 0, result);
  env = environment(); result = route("съел рис варёный 150 г и пожал 100 кг", env);
  record("C23.2B1-31_MIXED_DOMAIN_AMBIGUOUS", !result.handled && result.code === "AMBIGUOUS_DOMAIN" &&
    env.rows.length === 0, result);
  env = environment(); result = route("мой вес 116 кг", env);
  record("C23.2B1-32_WEIGHT_OWNERSHIP", !result.handled && env.rows.length === 0, result);
  env = environment(); result = route("съел рис варёный 150 г", env);
  record("C23.2B1-33_GROQ_ZERO", result.groq_calls === 0 && env.counters.groq_calls === 0, result);
  record("C23.2B1-34_DOMAIN_WRITES_ZERO", result.domain_writes === 0 && env.counters.domain_writes === 0, result);
  record("C23.2B1-35_AI_MEMORY_ZERO", env.counters.ai_memory_writes === 0, env.counters);
  record("C23.2B1-36_COACH_STATE_UNCHANGED", env.counters.coach_state_writes === 0 &&
    JSON.stringify(payload).indexOf("COACH_STATE") < 0, env.counters);

  const noSheets = {spreadsheet: {getSheetByName: function() { return null; }}};
  result = detect("съел рис 150 г", noSheets);
  record("C23.2B1-37_MISSING_SHEETS_GRACEFUL", result.reference_status === "UNKNOWN_REFERENCE", result);
  const unresolved = detect("съел рис 150 г");
  const unresolvedCapture = buildDomainFactCandidate_(unresolved, {now: now, uuid: function() { return "unresolved"; }});
  record("C23.2B1-38_UNRESOLVED_NOT_VALID", validateDomainFactCandidate_(unresolvedCapture).ready_for_confirmation === false,
    unresolvedCapture);
  const legacyCapture = {
    schema_version: "c232a-nutrition-extraction-v1", mode: "SIMULATION", writes_allowed: false,
    capture_id: "legacy-c232a", source: "C231_DOMAIN_ROUTER", raw_message: "", domain: "NUTRITION",
    confidence: 0.99, requires_clarification: false,
    items: [{category: "NUTRITION_LOG", confidence: 0.99, fields: {
      food_display: {value: "рис"}, food_normalized: {value: "рис"},
      quantity_value: {value: 150}, quantity_unit: {value: "g"}
    }}]
  };
  record("C23.2B1-39_LEGACY_C232A_VALID", validateDomainFactCandidate_(legacyCapture).ready_for_confirmation === true,
    legacyCapture);
  const inactiveOnly = fixture();
  inactiveOnly.references = [Object.assign(reference("inactive", "banana", "Банан", "", "UNKNOWN", 100, "g"),
    {ACTIVE: false})];
  result = detect("съел банан 100 г", inactiveOnly);
  record("C23.2B1-40_INACTIVE_REFERENCE_IGNORED", result.reference_status === "UNKNOWN_REFERENCE", result);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "C-23.2B1_CANONICAL_FOOD_IDENTITY_REFERENCE",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {domain_writes: 0, nutrition_log_writes: 0, ai_memory_writes: 0,
      coach_state_writes: 0, telegram_calls: 0, groq_calls: 0,
      script_property_changes: 0, production_writes: 0}
  };
}
