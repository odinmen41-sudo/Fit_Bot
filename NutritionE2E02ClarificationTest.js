/** NUT-E2E-02 durable nutrition clarification regression suite. */
function runNutritionE2E02ClarificationTests() {
  const results = [];
  function record(id, passed, details) {
    results.push({id: id, status: passed ? "PASS" : "FAIL", details: details || {}});
  }
  function update(id, user, text) {
    return {update_id: id, message: {text: text, from: {id: user}, chat: {id: user}}};
  }
  const referenceOptions = {calculation_enabled: true, aliases: [
    {ALIAS_NORMALIZED: "овсяная каша", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true},
    {ALIAS_NORMALIZED: "овсяную кашу", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true},
    {ALIAS_NORMALIZED: "овсянка", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true},
    {ALIAS_NORMALIZED: "овсянку", FOOD_ID: "oatmeal", PRIORITY: 100, ACTIVE: true}
  ], references: [
    {REFERENCE_ID: "oatmeal-water", FOOD_ID: "oatmeal", CANONICAL_NAME: "oatmeal",
      DISPLAY_NAME: "Овсяная каша на воде", VARIANT: "", PREPARATION_STATE: "COOKED_WATER",
      BASIS_QUANTITY: 100, BASIS_UNIT: "g", CALORIES: 71, PROTEIN: 2.54, FAT: 1.52, CARBS: 12,
      AUTHORITY: "TEST", SOURCE: "fixture", SOURCE_VERSION: "1", ACTIVE: true}
  ]};

  function environment(options) {
    const runtime = options || {};
    const rows = runtime.rows || [];
    const meals = runtime.meals || [];
    let failSave = runtime.fail_save === true;
    function newest(source, user, chat, includeSaved, now) {
      const matches = rows.filter(function(row) {
        return row.user_id === String(user) && row.chat_id === String(chat) && row.payload.source === source &&
          (row.status === "PENDING_CONFIRMATION" || includeSaved && row.status === "SAVED");
      }).sort(function(a, b) { return b.created_at.getTime() - a.created_at.getTime(); });
      const pending = matches.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; })[0];
      if (pending) return pending.expires_at.getTime() <= now.getTime()
        ? {ok: false, code: "CAPTURE_EXPIRED", capture: pending, payload: pending.payload}
        : {ok: true, code: "PENDING_CAPTURE", capture: pending, payload: pending.payload};
      const saved = matches.filter(function(row) { return row.status === "SAVED"; })[0];
      return saved ? {ok: true, code: "SAVED_CAPTURE", capture: saved, payload: saved.payload}
        : {ok: false, code: "NO_CAPTURE"};
    }
    const deps = {
      uuid: function() { return "uuid" + (rows.length + 1); },
      detect_confirmation: detectConfirmationIntent_,
      find_clarification: function(user, chat, opts) {
        return newest(NUTRITION_CLARIFICATION_SOURCE, user, chat, false, opts.now);
      },
      find_capture: function(user, chat, opts) {
        return newest("C231_DOMAIN_ROUTER", user, chat, opts.include_saved === true, opts.now);
      },
      get_pending: function(user, chat, opts) {
        const active = rows.filter(function(row) { return row.user_id === String(user) && row.chat_id === String(chat) &&
          row.status === "PENDING_CONFIRMATION" && row.expires_at.getTime() > opts.now.getTime(); });
        return active.length ? {ok: true, capture: active[0]} : {ok: false, code: "NO_ACTIVE_CAPTURE"};
      },
      create_pending: function(capture, meta) {
        const existing = rows.filter(function(row) { return row.capture_id === capture.capture_id; })[0];
        if (existing) return {ok: true, code: "CAPTURE_ALREADY_EXISTS", created: false, capture_id: capture.capture_id};
        rows.forEach(function(row) {
          if (row.user_id === String(meta.user_id) && row.chat_id === String(meta.chat_id) && row.status === "PENDING_CONFIRMATION") {
            row.status = "SUPERSEDED";
          }
        });
        rows.push({capture_id: capture.capture_id, user_id: String(meta.user_id), chat_id: String(meta.chat_id),
          source_update_id: String(meta.source_update_id), payload: JSON.parse(JSON.stringify(capture)),
          status: "PENDING_CONFIRMATION", created_at: new Date(meta.now),
          expires_at: new Date(meta.now.getTime() + Number(meta.ttl_minutes) * 60000)});
        return {ok: true, code: "CREATED", created: true, capture_id: capture.capture_id};
      },
      cancel: function(user, chat, opts) {
        const active = rows.filter(function(row) { return row.user_id === String(user) && row.chat_id === String(chat) &&
          row.status === "PENDING_CONFIRMATION" && row.expires_at.getTime() > opts.now.getTime(); })[0];
        if (!active) return {ok: false, code: "NO_ACTIVE_CAPTURE"};
        active.status = "CANCELLED";
        return {ok: true, code: "CANCELLED"};
      },
      validate_nutrition_snapshot: validateNutritionSnapshotForSave_,
      nutrition_persistence_enabled: function() { return true; },
      persist_nutrition: function(selected) {
        if (selected.capture.status === "SAVED") {
          return {ok: true, code: "NUTRITION_SAVED", idempotent_replay: true, rows_written: 0};
        }
        if (failSave) return {ok: false, code: "NUTRITION_COMMIT_FAILED", rows_written: 0};
        meals.push(JSON.parse(JSON.stringify(selected.payload)));
        selected.capture.status = "SAVED";
        return {ok: true, code: "NUTRITION_SAVED", written: true, rows_written: 1};
      },
      build_dashboard: function() { return null; },
      evaluate_contextual: function() { return null; }
    };
    return {rows: rows, meals: meals, deps: deps, allow_save: function() { failSave = false; }};
  }
  function route(env, id, user, text, at) {
    return routeDomainFactConfirmation_(update(id, user, text), {
      now: at, dependencies: env.deps, reference_options: referenceOptions
    });
  }

  const base = new Date("2026-10-22T08:00:00.000Z");
  const env = environment();
  let result = route(env, 1, "u1", "Съел овсяную кашу 250 г", base);
  record("NUT-E2E-02-01_DURABLE_PREPARATION_PROMPT", result.ok && result.message === "На воде или на молоке?" &&
    result.pending_capture_writes === 1 && env.rows[0].payload.clarification.missing_field === "PREPARATION", result);
  result = route(env, 2, "u1", "На воде", new Date(base.getTime() + 1000));
  const pendingMeal = env.rows.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; })[0];
  record("NUT-E2E-02-02_SEPARATE_UPDATE_RESTORES_CONTEXT", result.ok && /178/.test(result.message) &&
    pendingMeal.payload.items[0].fields.preparation_state.value === "COOKED_WATER" &&
    pendingMeal.payload.items[0].fields.quantity_value.value === 250, result);
  result = route(env, 3, "u1", "Да", new Date(base.getTime() + 2000));
  record("NUT-E2E-02-03_SINGLE_AUTHORITATIVE_WRITE", result.ok && env.meals.length === 1 &&
    env.meals[0].nutrition_calculation.totals.calories === 177.5, result);
  result = route(env, 4, "u1", "Да", new Date(base.getTime() + 3000));
  record("NUT-E2E-02-04_REPEATED_CONFIRMATION_IDEMPOTENT", result.ok && result.save.idempotent_replay === true &&
    env.meals.length === 1, result);

  ["на воде", "воде", "на молоке", "молоке"].forEach(function(answer, index) {
    const variant = environment();
    route(variant, 10 + index * 2, "v" + index, "Съел овсяную кашу 250 г", base);
    const completed = route(variant, 11 + index * 2, "v" + index, answer, new Date(base.getTime() + 1000));
    const milk = /молоке/.test(answer);
    const expected = milk ? "COOKED_MILK" : "COOKED_WATER";
    const row = variant.rows.filter(function(item) { return item.status === "PENDING_CONFIRMATION"; })[0];
    record("NUT-E2E-02-05_" + index + "_PREPARATION_VARIANT", milk
      ? !completed.ok && completed.code === "UNKNOWN_REFERENCE" && row.payload.source === NUTRITION_CLARIFICATION_SOURCE
      : completed.ok && row.payload.items[0].fields.preparation_state.value === expected, completed);
  });

  const quantityEnv = environment();
  result = route(quantityEnv, 30, "quantity", "Съел овсянку", base);
  record("NUT-E2E-02-06_QUANTITY_PROMPT", result.ok && result.message === "Сколько граммов?", result);
  result = route(quantityEnv, 31, "quantity", "250", new Date(base.getTime() + 1000));
  record("NUT-E2E-02-07_CHAINED_PREPARATION_PROMPT", result.ok && result.message === "На воде или на молоке?", result);
  result = route(quantityEnv, 32, "quantity", "воде", new Date(base.getTime() + 2000));
  record("NUT-E2E-02-08_QUANTITY_CONTEXT_COMPLETES", result.ok && /178/.test(result.message), result);

  const cancelEnv = environment();
  route(cancelEnv, 40, "cancel", "Съел овсяную кашу 250 г", base);
  result = route(cancelEnv, 41, "cancel", "Отмена", new Date(base.getTime() + 1000));
  record("NUT-E2E-02-09_CANCEL", result.ok && cancelEnv.rows[0].status === "CANCELLED" && cancelEnv.meals.length === 0, result);

  const repeatEnv = environment();
  route(repeatEnv, 50, "repeat", "Съел овсяную кашу 250 г", base);
  result = route(repeatEnv, 50, "repeat", "Съел овсяную кашу 250 г", base);
  record("NUT-E2E-02-10_REPLAYED_UPDATE_NO_DUPLICATE", result.handled && result.pending_capture_writes === 0 &&
    repeatEnv.rows.length === 1, result);

  const expiredEnv = environment();
  route(expiredEnv, 60, "expired", "Съел овсяную кашу 250 г", base);
  result = route(expiredEnv, 61, "expired", "На воде", new Date(base.getTime() + 31 * 60000));
  record("NUT-E2E-02-11_EXPIRED_CONTEXT_FAILS_CLOSED", !result.ok && result.code === "CAPTURE_EXPIRED" &&
    expiredEnv.meals.length === 0, result);

  const sharedRows = [];
  const firstRuntime = environment({rows: sharedRows});
  route(firstRuntime, 70, "restart", "Съел овсяную кашу 250 г", base);
  const secondRuntime = environment({rows: sharedRows, meals: firstRuntime.meals});
  result = route(secondRuntime, 71, "restart", "воде", new Date(base.getTime() + 1000));
  record("NUT-E2E-02-12_INDEPENDENT_RUNTIME_RESTORES_SERIALIZED_CONTEXT", result.ok && /178/.test(result.message), result);

  const isolation = environment();
  route(isolation, 80, "owner", "Съел овсяную кашу 250 г", base);
  result = route(isolation, 81, "other", "воде", new Date(base.getTime() + 1000));
  record("NUT-E2E-02-13_USER_ISOLATION", !result.handled && isolation.rows.length === 1 &&
    isolation.rows[0].user_id === "owner", result);

  const failure = environment({fail_save: true});
  route(failure, 90, "failure", "Съел овсяную кашу 250 г", base);
  route(failure, 91, "failure", "воде", new Date(base.getTime() + 1000));
  result = route(failure, 92, "failure", "Да", new Date(base.getTime() + 2000));
  record("NUT-E2E-02-14_FALSE_SUCCESS_BLOCKED", !result.ok && failure.meals.length === 0 &&
    failure.rows.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; }).length === 1, result);
  failure.allow_save();
  result = route(failure, 93, "failure", "Да", new Date(base.getTime() + 3000));
  record("NUT-E2E-02-15_RETRY_WRITES_ONCE", result.ok && failure.meals.length === 1, result);

  const passed = results.filter(function(item) { return item.status === "PASS"; }).length;
  return {ok: passed === results.length, passed: passed, total: results.length, results: results};
}
