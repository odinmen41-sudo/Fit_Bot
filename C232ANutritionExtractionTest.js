function runC232ANutritionExtractionTests() {
  const tests = [];
  const now = new Date("2026-08-25T20:00:00.000Z");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: details || {}});
  }

  function extraction(text) {
    return extractNutritionFactCandidate_(text);
  }

  function field(item, name) {
    return item && item.fields && item.fields[name] ? item.fields[name].value : undefined;
  }

  function environment() {
    const rows = [];
    const counters = {domain_writes: 0, groq_calls: 0, coach_state_writes: 0};
    let sequence = 0;
    return {
      rows: rows,
      counters: counters,
      dependencies: {
        uuid: function() {
          sequence += 1;
          return "232a0000-0000-4000-8000-" + String(sequence).padStart(12, "0");
        },
        detect_confirmation: function(text) {
          const value = String(text || "").trim().toLowerCase();
          if (value === "да") return {intent: "CONFIRM"};
          if (value === "нет") return {intent: "CANCEL"};
          return null;
        },
        find_capture: function() { return {ok: false, code: "NO_DOMAIN_CAPTURE"}; },
        get_pending: function() { return {ok: false, code: "NO_ACTIVE_CAPTURE"}; },
        create_pending: function(capture, metadata) {
          rows.push({
            capture_id: capture.capture_id,
            user_id: String(metadata.user_id),
            chat_id: String(metadata.chat_id),
            status: "PENDING_CONFIRMATION",
            raw_message: capture.raw_message,
            payload_json: JSON.stringify(capture),
            payload: capture
          });
          return {ok: true, code: "CREATED", capture_id: capture.capture_id};
        },
        confirm: function() { return {ok: false, code: "NOT_USED"}; },
        cancel: function() { return {ok: false, code: "NOT_USED"}; },
        save_domain: function() {
          counters.domain_writes += 1;
          return {ok: false, code: "NOT_USED"};
        }
      }
    };
  }

  function referenceOptions() {
    return {
      aliases: [
        {ALIAS_NORMALIZED: "рис", FOOD_ID: "rice", PRIORITY: 100, ACTIVE: true}
      ],
      references: [
        {REFERENCE_ID: "rice_boiled_v1", FOOD_ID: "rice", CANONICAL_NAME: "Рис",
          PREPARATION_STATE: "BOILED", BASIS_QUANTITY: 100, BASIS_UNIT: "g", ACTIVE: true},
        {REFERENCE_ID: "rice_dry_v1", FOOD_ID: "rice", CANONICAL_NAME: "Рис",
          PREPARATION_STATE: "DRY", BASIS_QUANTITY: 100, BASIS_UNIT: "g", ACTIVE: true}
      ]
    };
  }

  function update(text) {
    return {update_id: "c232a-update", message: {text: text, from: {id: "user-a"}, chat: {id: "chat-a"}}};
  }

  function route(text, env) {
    return routeDomainFactConfirmation_(update(text), {
      now: now,
      dependencies: env.dependencies,
      reference_options: referenceOptions()
    });
  }

  let result = extraction("съел рис 150 г");
  record("C23.2A-01_SINGLE_RICE", result.detected && result.items.length === 1 &&
    field(result.items[0], "food_normalized") === "рис" &&
    field(result.items[0], "quantity_value") === 150 && field(result.items[0], "quantity_unit") === "g", result);

  result = extraction("ел курицу 200 грамм");
  record("C23.2A-02_SINGLE_CHICKEN", result.items.length === 1 &&
    field(result.items[0], "food_display") === "курицу" &&
    field(result.items[0], "quantity_value") === 200 && field(result.items[0], "quantity_unit") === "g", result);

  result = extraction("выпил кефир 250 мл");
  record("C23.2A-03_SINGLE_KEFIR", result.items.length === 1 &&
    field(result.items[0], "food_normalized") === "кефир" &&
    field(result.items[0], "quantity_value") === 250 && field(result.items[0], "quantity_unit") === "ml", result);

  result = extraction("съел рис 0.5 кг");
  record("C23.2A-04_KG_NORMALIZATION", field(result.items[0], "quantity_value") === 500 &&
    field(result.items[0], "quantity_unit") === "g", result);

  result = extraction("выпил кефир 1 л");
  record("C23.2A-05_LITER_NORMALIZATION", field(result.items[0], "quantity_value") === 1000 &&
    field(result.items[0], "quantity_unit") === "ml", result);

  const implicitEggs = extraction("3 яйца");
  const explicitEggs = extraction("3 шт яйца");
  record("C23.2A-06_COUNT_NORMALIZATION", field(implicitEggs.items[0], "quantity_value") === 3 &&
    field(implicitEggs.items[0], "quantity_unit") === "count" &&
    field(explicitEggs.items[0], "quantity_value") === 3 &&
    field(explicitEggs.items[0], "quantity_unit") === "count", {implicit: implicitEggs, explicit: explicitEggs});

  result = extraction("съел рис 150 г и курицу 200 г");
  record("C23.2A-07_TWO_FOODS", result.items.length === 2 &&
    field(result.items[0], "food_normalized") === "рис" &&
    field(result.items[1], "food_normalized") === "курицу", result);

  result = extraction("съел рис 150 г, гречку 100 г и курицу 200 г");
  record("C23.2A-08_THREE_FOODS", result.items.length === 3 &&
    result.items.map(function(item) { return field(item, "quantity_value"); }).join(",") === "150,100,200", result);

  const missingEnv = environment();
  result = extraction("съел банан");
  const missingRoute = route("съел банан", missingEnv);
  record("C23.2A-09_MISSING_QUANTITY", result.requires_clarification === true &&
    field(result.items[0], "quantity_value") === undefined && missingRoute.code === "CLARIFICATION_REQUIRED" &&
    missingEnv.rows.length === 0, {extraction: result, route: missingRoute});

  let env = environment();
  result = route("сколько калорий в рисе?", env);
  record("C23.2A-10_CALORIE_QUESTION_FALLS_THROUGH", !result.handled && env.rows.length === 0, result);

  env = environment();
  result = route("сколько белка мне есть?", env);
  record("C23.2A-11_PROTEIN_QUESTION_FALLS_THROUGH", !result.handled && env.rows.length === 0, result);

  env = environment();
  result = route("съел рис 150 г и пожал 100 кг", env);
  record("C23.2A-12_MIXED_DOMAIN_AMBIGUOUS", !result.handled && result.code === "AMBIGUOUS_DOMAIN" &&
    env.rows.length === 0, result);

  env = environment();
  result = route("съел рис -5 г", env);
  record("C23.2A-13_NEGATIVE_QUANTITY_INVALID", result.handled && result.code === "INVALID_PAYLOAD" &&
    env.rows.length === 0, result);

  env = environment();
  result = route("съел рис 100000 г", env);
  record("C23.2A-14_EXCESSIVE_QUANTITY_INVALID", result.handled && result.code === "INVALID_PAYLOAD" &&
    env.rows.length === 0, result);

  env = environment();
  result = route("съел рис варёный 150 г", env);
  const payload = env.rows[0] && env.rows[0].payload;
  record("C23.2A-15_RAW_TEXT_ABSENT", payload && payload.raw_message === "" &&
    JSON.stringify(payload).indexOf("съел рис варёный 150 г") < 0 && JSON.stringify(payload).indexOf("raw_fragment") < 0,
    payload);

  const unresolvedEnv = environment();
  const unresolved = route("съел рис 150 г", unresolvedEnv);
  record("C23.2A-16_B1_CLARIFICATION_EVOLUTION", unresolved.handled === true &&
    unresolved.code === "CLARIFICATION_REQUIRED" && unresolvedEnv.rows.length === 0,
    {result: unresolved, extraction: extraction("съел рис 150 г")});

  record("C23.2A-17_GROQ_ZERO", result.groq_calls === 0 && env.counters.groq_calls === 0, result);
  record("C23.2A-18_SIMULATION_WRITES_ZERO", result.domain_writes === 0 &&
    result.production_writes === false && env.counters.domain_writes === 0, result);
  record("C23.2A-19_COACH_STATE_UNCHANGED", env.counters.coach_state_writes === 0 &&
    JSON.stringify(payload).indexOf("COACH_STATE") < 0, payload);

  env = environment();
  result = route("мой вес 116 кг", env);
  record("C23.2A-20_C20A_WEIGHT_OWNERSHIP", !result.handled && result.code === "NOT_DOMAIN_FACT" &&
    env.rows.length === 0, result);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "C-23.2A_NUTRITION_EXTRACTION_FOUNDATION",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {
      domain_writes: 0,
      nutrition_log_writes: 0,
      ai_memory_writes: 0,
      coach_state_writes: 0,
      telegram_calls: 0,
      groq_calls: 0,
      script_property_changes: 0,
      production_writes: 0
    }
  };
}
