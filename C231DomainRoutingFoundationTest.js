function runC231DomainRoutingFoundationTests() {
  const tests = [];
  const now = new Date("2026-08-25T12:00:00.000Z");

  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: details || {}});
  }

  function update(text, userId, chatId, updateId) {
    return {
      update_id: updateId || "c231-update",
      message: {
        text: text,
        from: {id: userId || "c231-user"},
        chat: {id: chatId || "c231-chat"}
      }
    };
  }

  function environment() {
    const rows = [];
    const counters = {domain_writes: 0, groq_calls: 0, saves: 0};
    let sequence = 0;

    function matching(userId, chatId) {
      return rows.filter(function(row) {
        return row.user_id === String(userId) && row.chat_id === String(chatId) &&
          row.payload && row.payload.source === "C231_DOMAIN_ROUTER";
      }).sort(function(a, b) { return b.created_at.getTime() - a.created_at.getTime(); });
    }

    const dependencies = {
      uuid: function() { sequence += 1; return "00000000-0000-4000-8000-" + String(sequence).padStart(12, "0"); },
      detect_confirmation: detectConfirmationIntent_,
      get_pending: function(userId, chatId, options) {
        const current = matching(userId, chatId).filter(function(row) {
          return row.status === "PENDING_CONFIRMATION" && row.expires_at.getTime() > options.now.getTime();
        });
        return current.length ? {ok: true, capture: current[0]} : {ok: false, code: "NO_ACTIVE_CAPTURE"};
      },
      create_pending: function(capture, metadata) {
        const active = matching(metadata.user_id, metadata.chat_id).filter(function(row) {
          return row.status === "PENDING_CONFIRMATION" && row.expires_at.getTime() > metadata.now.getTime();
        });
        if (active.length) return {ok: false, code: "ACTIVE_CAPTURE_EXISTS"};
        rows.push({
          capture_id: capture.capture_id,
          user_id: String(metadata.user_id),
          chat_id: String(metadata.chat_id),
          created_at: metadata.now,
          expires_at: new Date(metadata.now.getTime() + Number(metadata.ttl_minutes) * 60000),
          status: "PENDING_CONFIRMATION",
          raw_message: capture.raw_message,
          payload_json: JSON.stringify(capture),
          payload: capture
        });
        return {ok: true, code: "CREATED", capture_id: capture.capture_id, status: "PENDING_CONFIRMATION"};
      },
      find_capture: function(userId, chatId, options) {
        const own = matching(userId, chatId);
        const pending = own.filter(function(row) { return row.status === "PENDING_CONFIRMATION"; })[0];
        if (pending) {
          if (pending.expires_at.getTime() <= options.now.getTime()) {
            return {ok: false, code: "CAPTURE_EXPIRED", capture: pending};
          }
          return {ok: true, code: "PENDING_CAPTURE", capture: pending, payload: pending.payload};
        }
        const saved = options.include_saved && own.filter(function(row) { return row.status === "SAVED"; })[0];
        return saved ? {ok: true, code: "SAVED_CAPTURE", capture: saved, payload: saved.payload} :
          {ok: false, code: "NO_DOMAIN_CAPTURE"};
      },
      confirm: function(userId, chatId, captureId, options) {
        const row = rows.filter(function(candidate) { return candidate.capture_id === captureId; })[0];
        if (!row) return {ok: false, code: "NO_ACTIVE_CAPTURE"};
        if (row.user_id !== String(userId) || row.chat_id !== String(chatId)) {
          return {ok: false, code: "OWNER_MISMATCH"};
        }
        if (row.status === "SAVED") return {ok: true, code: "ALREADY_SAVED"};
        if (row.expires_at.getTime() <= options.now.getTime()) return {ok: false, code: "EXPIRED"};
        row.status = "SAVED";
        return {ok: true, code: "SAVED"};
      },
      cancel: function(userId, chatId) {
        const row = matching(userId, chatId).filter(function(candidate) {
          return candidate.status === "PENDING_CONFIRMATION";
        })[0];
        if (!row) return {ok: false, code: "NO_ACTIVE_CAPTURE"};
        row.status = "CANCELLED";
        return {ok: true, code: "CANCELLED"};
      },
      save_domain: function(capture) {
        counters.saves += 1;
        return {ok: true, code: "SAVE_SIMULATED", domain: capture.domain,
          domain_writes: 0, production_writes: false};
      }
    };
    return {rows: rows, counters: counters, dependencies: dependencies};
  }

  function route(text, env, userId, chatId, at) {
    return routeDomainFactConfirmation_(update(text, userId, chatId), {
      now: at || now,
      dependencies: env.dependencies
    });
  }

  let env = environment();
  const weight = route("мой вес 116 кг", env);
  record("C23.1-01_WEIGHT_OWNED_BY_C20A", !weight.handled && weight.code === "NOT_DOMAIN_FACT" &&
    env.rows.length === 0, weight);

  env = environment();
  const workout = route("жим 116 кг", env);
  record("C23.1-02_WORKOUT_ROUTED", workout.handled && workout.ok && workout.domain === "WORKOUT",
    workout);

  env = environment();
  const nutrition = route("съел рис 150 г", env);
  record("C23.1-03_NUTRITION_ROUTED", nutrition.handled && nutrition.ok && nutrition.domain === "NUTRITION",
    nutrition);

  env = environment();
  const recovery = route("сегодня плохо спал", env);
  record("C23.1-04_RECOVERY_ROUTED", recovery.handled && recovery.ok && recovery.domain === "RECOVERY",
    recovery);

  env = environment();
  const recoveryQuestion = route("как мне восстановиться?", env);
  record("C23.1-05_RECOVERY_QUESTION_FALLS_THROUGH", !recoveryQuestion.handled &&
    recoveryQuestion.code === "NOT_DOMAIN_FACT" && env.rows.length === 0, recoveryQuestion);

  env = environment();
  const proteinQuestion = route("сколько белка мне есть?", env);
  record("C23.1-06_NUTRITION_QUESTION_FALLS_THROUGH", !proteinQuestion.handled &&
    proteinQuestion.code === "NOT_DOMAIN_FACT" && env.rows.length === 0, proteinQuestion);

  env = environment();
  const mixed = route("съел рис 150 г и пожал 100 кг", env);
  record("C23.1-07_MIXED_DOMAIN_FAILS_CLOSED", !mixed.handled && mixed.code === "AMBIGUOUS_DOMAIN" &&
    env.rows.length === 0, mixed);

  env = environment();
  const created = route("съел рис 150 г", env);
  const stored = env.rows[0];
  record("C23.1-08_STRUCTURED_PENDING_CAPTURE", created.code === "CAPTURE_CREATED" && stored &&
    stored.status === "PENDING_CONFIRMATION" && stored.payload.domain === "NUTRITION" &&
    stored.payload.items[0].category === "NUTRITION_LOG", {created: created, stored: stored});

  record("C23.1-09_RAW_TEXT_ABSENT", stored.raw_message === "" && stored.payload.raw_message === "" &&
    JSON.stringify(stored.payload).indexOf("съел рис") < 0, stored.payload);

  const otherOwner = route("Да", env, "other-user", "c231-chat");
  record("C23.1-10_OWNER_CHAT_ISOLATION", !otherOwner.handled && stored.status === "PENDING_CONFIRMATION" &&
    env.counters.saves === 0, otherOwner);

  record("C23.1-11_TTL_PRESERVED", stored.expires_at.getTime() - stored.created_at.getTime() === 30 * 60000,
    {created_at: stored.created_at, expires_at: stored.expires_at});

  env = environment();
  route("жим 116 кг", env);
  const cancelled = route("Нет", env);
  record("C23.1-12_NO_CANCELS", cancelled.handled && cancelled.ok && cancelled.code === "CANCELLED" &&
    env.rows[0].status === "CANCELLED", cancelled);

  env = environment();
  route("сегодня плохо спал", env);
  const confirmed = route("Да", env);
  const repeated = route("Да", env);
  record("C23.1-13_DUPLICATE_YES_IDEMPOTENT", confirmed.code === "SAVE_SIMULATED" &&
    repeated.code === "ALREADY_SAVED" && env.counters.saves === 1 && env.rows.length === 1,
    {confirmed: confirmed, repeated: repeated, saves: env.counters.saves});

  record("C23.1-14_SIMULATION_DOMAIN_WRITES_ZERO", confirmed.domain_writes === 0 &&
    confirmed.production_writes === false && confirmed.save.domain_writes === 0,
    confirmed);

  env = environment();
  const preConfirmation = route("жим 116 кг", env);
  record("C23.1-15_GROQ_ZERO_BEFORE_CONFIRMATION", preConfirmation.groq_calls === 0 &&
    env.counters.groq_calls === 0, preConfirmation);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "C-23.1_DOMAIN_ROUTING_FOUNDATION",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {domain_writes: 0, sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}
