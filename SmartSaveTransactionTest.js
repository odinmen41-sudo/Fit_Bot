/**
 * Smart Data Capture — Save Transaction Layer.
 *
 * Safety guarantees through Sprint 5.5:
 * - not connected to doPost(), Telegram or generateCoachReply_();
 * - SIMULATION never writes to domain sheets or USER_EVENTS;
 * - CANARY can write one BODY_TRACKING row and one body_weight_recorded event only;
 * - DATA_WRITE_MODE=ACTIVE is hard-blocked in this module;
 * - all other categories remain blocked from real writes.
 */
const DATA_WRITE_CONFIG = Object.freeze({
  MODE_PROPERTY: "DATA_WRITE_MODE",
  DEFAULT_MODE: "SIMULATION",
  ALLOWED_MODES: Object.freeze(["OFF", "SIMULATION", "CANARY", "ACTIVE"]),
  PRODUCTION_WRITES_ENABLED: false,
  CANARY_WRITES_ENABLED: true,
  CANARY_CATEGORY: "BODY_TRACKING",
  CANARY_EVENT: "body_weight_recorded",
  CANARY_EVENT_SOURCE: "SMART_CAPTURE_CANARY",
  EVENT_SOURCE: "SMART_CAPTURE_CONFIRMATION",
  DOMAIN_ALLOWLIST: Object.freeze({
    BODY_TRACKING: "Body_Tracking",
    WORKOUT_LOG: "Workout_Log",
    NUTRITION_LOG: "Nutrition_Log",
    RECOVERY_LOG: "Recovery_Log"
  }),
  USER_EVENTS_SCHEMA: Object.freeze([
    "date",
    "user_id",
    "event",
    "value",
    "source",
    "category",
    "capture_id"
  ])
});

/**
 * Execute a validated pending capture through SIMULATION or a gated CANARY transaction.
 * Signature is intentionally explicit: the caller supplies a capture id and owner.
 */
function saveConfirmedData_(captureId, userId, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const mode = dataWriteMode_();
  const isSimulation = mode === "SIMULATION";
  const isCanary = mode === "CANARY";

  if (mode === "OFF") {
    return dataWriteResult_(false, "DATA_WRITES_OFF", "Save layer отключён.", {
      mode: mode,
      production_writes: false
    });
  }
  if (mode === "ACTIVE" || dataWriteDomainWritesAllowed_()) {
    return dataWriteResult_(false, "ACTIVE_NOT_ENABLED", "ACTIVE режим заблокирован в Sprint 5.5.", {
      mode: mode,
      production_writes: false
    });
  }
  if (!isSimulation && !isCanary) {
    return dataWriteResult_(false, "INVALID_MODE", "Недопустимый DATA_WRITE_MODE.", {
      mode: mode,
      production_writes: false
    });
  }
  if (isCanary) {
    try {
      dataWriteAssertCanaryWriteContext_();
    } catch (error) {
      return dataWriteResult_(false, DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION_ERROR,
        "CANARY write запрещён в production-контексте.", {
          mode: mode,
          canary_writes: false,
          production_writes: false
        });
    }
  }
  if (isCanary && (!dataWriteCanaryWritesAllowed_() || opts.canary_write !== true)) {
    return dataWriteResult_(false, "CANARY_AUTH_REQUIRED", "CANARY требует явного test-only разрешения.", {
      mode: mode,
      canary_writes: false,
      production_writes: false
    });
  }
  if (!smartConfirmationTechnicalWritesAllowed_()) {
    return dataWriteResult_(false, "TECHNICAL_WRITES_DISABLED", "PENDING_CAPTURES недоступен вне TEST/SHADOW.", {
      mode: mode,
      production_writes: false
    });
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return dataWriteResult_(false, "LOCK_TIMEOUT", "Не удалось получить блокировку save transaction.", {
      mode: mode,
      production_writes: false
    });
  }

  let selected = null;
  let transaction = null;
  let currentCategory = "";
  try {
    const sheet = smartConfirmationSheet_();
    selected = smartConfirmationFindByCaptureId_(sheet, captureId);
    if (!selected) {
      return dataWriteResult_(false, "CAPTURE_NOT_FOUND", "Pending capture не найден.", {
        capture_id: String(captureId || ""),
        production_writes: false
      });
    }
    if (String(selected.user_id) !== String(userId)) {
      return dataWriteResult_(false, "OWNER_MISMATCH", "Capture принадлежит другому пользователю.", {
        capture_id: selected.capture_id,
        production_writes: false
      });
    }
    if (opts.chat_id != null && String(selected.chat_id) !== String(opts.chat_id)) {
      return dataWriteResult_(false, "OWNER_MISMATCH", "Capture принадлежит другому чату.", {
        capture_id: selected.capture_id,
        production_writes: false
      });
    }
    if (selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVED) {
      const savedTransaction = dataWriteParseJson_(selected.saved_targets_json, {});
      return dataWriteResult_(true, "ALREADY_SAVED", "Capture уже обработан; дубль не создан.", {
        capture_id: selected.capture_id,
        status: selected.status,
        transaction: savedTransaction,
        duplicate_created: false,
        production_writes: false
      });
    }
    if (selected.status !== SMART_CONFIRMATION_CONFIG.STATUSES.PENDING) {
      return dataWriteResult_(false, "NOT_SAVEABLE", "Capture имеет статус " + selected.status + ".", {
        capture_id: selected.capture_id,
        status: selected.status,
        production_writes: false
      });
    }
    if (smartConfirmationDate_(selected.expires_at).getTime() <= now.getTime()) {
      smartConfirmationUpdateState_(
        sheet,
        selected.row_number,
        SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED,
        "[]",
        "",
        "TTL expired before save transaction"
      );
      SpreadsheetApp.flush();
      return dataWriteResult_(false, "EXPIRED", "Срок действия capture истёк.", {
        capture_id: selected.capture_id,
        status: SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED,
        production_writes: false
      });
    }

    const payload = dataWriteParseJson_(selected.payload_json, null);
    const validation = dataWriteParseJson_(selected.validation_json, null);
    const validatedItems = dataWriteValidatedItems_(payload, validation);
    if (!validatedItems.ok) {
      return dataWriteResult_(false, validatedItems.code, validatedItems.message, {
        capture_id: selected.capture_id,
        validation_errors: validatedItems.errors || [],
        production_writes: false
      });
    }
    if (isCanary) {
      const canaryScope = dataWriteValidateCanaryScope_(selected, payload, validatedItems, opts);
      if (!canaryScope.ok) {
        return dataWriteResult_(false, canaryScope.code, canaryScope.message, {
          capture_id: selected.capture_id,
          mode: mode,
          canary_writes: false,
          production_writes: false
        });
      }
    }

    transaction = dataWriteTransaction_(selected, now, mode);
    transaction.step_status.validation = "COMPLETED";
    transaction.step_status.transaction = "SAVING";
    smartConfirmationUpdateStatus_(sheet, selected.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.SAVING);
    SpreadsheetApp.flush();

    validatedItems.items.forEach(function(validatedItem) {
      const category = validatedItem.payload.category;
      currentCategory = category;
      transaction.step_status.domain_adapters[category] = "PLANNING";
      if (isCanary && opts.simulate_canary_error_before_write === true) {
        throw new Error("SIMULATED_CANARY_ERROR_BEFORE_WRITE:" + category);
      }
      if (String(opts.simulate_adapter_error || "") === category) {
        throw new Error("SIMULATED_ADAPTER_ERROR:" + category);
      }
      const adapter = dataWriteAdapter_(category);
      let operation = adapter(validatedItem, {
        now: now,
        mode: mode,
        user_id: String(selected.user_id),
        capture_id: String(selected.capture_id),
        source_update_id: String(selected.source_update_id || "")
      });
      if (!operation || operation.ok !== true || operation.written !== false) {
        throw new Error("INVALID_ADAPTER_RESULT:" + category);
      }
      if (isCanary) {
        operation = dataWriteCommitCanaryOperation_(operation, {
          now: now,
          user_id: String(selected.user_id),
          capture_id: String(selected.capture_id),
          transaction_id: transaction.transaction_id
        });
        if (!operation || operation.ok !== true || operation.written !== true) {
          throw new Error("CANARY_COMMIT_FAILED:" + category);
        }
      }
      transaction.operations.push(operation);
      transaction.real_rows_changed += Number(operation.rows_changed || 0);
      transaction.completed_operations.push(dataWriteOperationSummary_(operation));
      transaction.step_status.domain_adapters[category] = "COMPLETED";
      if (operation.event) transaction.events.push(operation.event);
    });

    transaction.status = SMART_CONFIRMATION_CONFIG.STATUSES.SAVED;
    transaction.step_status.transaction = "SAVED";
    transaction.step_status.user_events = isCanary ? "WRITTEN" : "PLANNED_NOT_WRITTEN";
    transaction.retryable = false;
    transaction.completed_at = now.toISOString();
    transaction.recovery = {
      required: false,
      retryable: false,
      note: isCanary ? "Controlled CANARY write completed." : "Simulation completed; no domain rollback is required."
    };
    smartConfirmationUpdateState_(
      sheet,
      selected.row_number,
      SMART_CONFIRMATION_CONFIG.STATUSES.SAVED,
      JSON.stringify(transaction),
      now,
      ""
    );
    SpreadsheetApp.flush();
    return dataWriteResult_(true, "SAVED", isCanary ?
      "CANARY transaction выполнена: BODY_TRACKING и один USER_EVENT записаны." :
      "Save transaction выполнена в SIMULATION; реальных записей нет.", {
      capture_id: selected.capture_id,
      status: SMART_CONFIRMATION_CONFIG.STATUSES.SAVED,
      transaction: transaction,
      duplicate_created: false,
      canary_writes: isCanary,
      production_writes: false
    });
  } catch (error) {
    const errorText = String(error && error.message ? error.message : error);
    const failedCategory = currentCategory || dataWriteFailedCategory_(errorText);
    if (!transaction && selected) transaction = dataWriteTransaction_(selected, now, mode);
    if (transaction) {
      transaction.status = SMART_CONFIRMATION_CONFIG.STATUSES.FAILED;
      transaction.step_status.transaction = "FAILED";
      transaction.step_status.user_events = "NOT_STARTED";
      if (failedCategory && failedCategory !== "UNKNOWN") {
        transaction.step_status.domain_adapters[failedCategory] = "FAILED";
        transaction.failed_operations.push({
          category: failedCategory,
          status: "FAILED",
          error: errorText,
          written: false
        });
      }
      transaction.retryable = true;
      transaction.failed_at = now.toISOString();
      transaction.error = errorText;
      transaction.recovery = {
        required: true,
        retryable: true,
        capture_id: transaction.capture_id,
        transaction_id: transaction.transaction_id,
        failed_category: failedCategory,
        step_status: transaction.step_status,
        completed_operations: transaction.completed_operations,
        failed_operations: transaction.failed_operations,
        completed_categories: transaction.operations.map(function(operation) { return operation.category; }),
        pending_categories: dataWritePendingCategories_(selected, transaction.operations),
        production_rollback_required: transaction.completed_operations.some(function(operation) { return operation.written === true; }),
        rollback_plan: isCanary ?
          "Locate exact Body_Tracking and USER_EVENTS rows by capture_id, verify transaction_id, then delete only those rows in descending row order." :
          "No physical rollback in SIMULATION. Before ACTIVE, reconcile by transaction_id and capture_id before retry.",
        note: isCanary ?
          "CANARY failed. Do not retry until completed_operations are reconciled." :
          "No domain rows were written; retry may re-run the whole simulation after correction."
      };
    }
    if (selected && selected.row_number) {
      try {
        smartConfirmationUpdateState_(
          smartConfirmationSheet_(),
          selected.row_number,
          SMART_CONFIRMATION_CONFIG.STATUSES.FAILED,
          JSON.stringify(transaction || {}),
          "",
          JSON.stringify(transaction ? transaction.recovery : {retryable: true, error: errorText})
        );
        SpreadsheetApp.flush();
      } catch (ignored) {}
    }
    return dataWriteResult_(false, "FAILED", "Save transaction завершилась ошибкой.", {
      capture_id: selected ? selected.capture_id : String(captureId || ""),
      status: SMART_CONFIRMATION_CONFIG.STATUSES.FAILED,
      transaction: transaction,
      error: errorText,
      canary_writes: isCanary,
      production_writes: false
    });
  } finally {
    lock.releaseLock();
  }
}

function saveBodyTracking_(validatedItem, context) {
  dataWriteAssertValidatedItem_(validatedItem, "BODY_TRACKING");
  const item = validatedItem.payload;
  const fields = item.fields || {};
  const event = dataWriteUserEvent_(context, "BODY_TRACKING", "weight_recorded",
    dataWriteCompactNumber_(dataWriteField_(fields, "weight")) + "kg");
  return dataWriteOperation_("BODY_TRACKING", [
    dataWriteField_(fields, "date"),
    dataWriteField_(fields, "weight"),
    "", "", "", "", "", "",
    "Smart Capture " + context.capture_id
  ], event, []);
}

function saveWorkoutLog_(validatedItem, context) {
  dataWriteAssertValidatedItem_(validatedItem, "WORKOUT_LOG");
  const item = validatedItem.payload;
  const fields = item.fields || {};
  const exercise = dataWriteField_(fields, "exercise");
  const weight = dataWriteField_(fields, "weight");
  const reps = dataWriteField_(fields, "reps");
  const sets = dataWriteField_(fields, "sets");
  const eventValue = dataWriteExerciseSlug_(exercise) + "_" +
    dataWriteCompactNumber_(weight) + "kg_x" + dataWriteCompactNumber_(reps) + "x" + dataWriteCompactNumber_(sets);
  const event = dataWriteUserEvent_(context, "WORKOUT_LOG", "training_completed", eventValue);
  return dataWriteOperation_("WORKOUT_LOG", [
    dataWriteField_(fields, "date"),
    dataWriteField_(fields, "training_type"),
    exercise,
    weight,
    sets,
    reps,
    "", "",
    "Smart Capture " + context.capture_id
  ], event, []);
}

function saveNutritionLog_(validatedItem, context) {
  dataWriteAssertValidatedItem_(validatedItem, "NUTRITION_LOG");
  const item = validatedItem.payload;
  const fields = item.fields || {};
  const foods = dataWriteField_(fields, "foods") || [];
  const description = foods.map(function(food) {
    return food.name + " " + dataWriteCompactNumber_(food.quantity_g) + " г";
  }).join("; ");
  const eventValue = foods.map(function(food) {
    return dataWriteFoodSlug_(food.name) + "_" + dataWriteCompactNumber_(food.quantity_g) + "g";
  }).join("_");
  const event = dataWriteUserEvent_(context, "NUTRITION_LOG", "nutrition_logged", eventValue);
  return dataWriteOperation_("NUTRITION_LOG", [
    dataWriteField_(fields, "date"),
    "Не определён",
    "",
    description,
    dataWriteField_(fields, "estimated_calories"),
    dataWriteField_(fields, "estimated_protein"),
    dataWriteField_(fields, "estimated_fat"),
    dataWriteField_(fields, "estimated_carbs"),
    ""
  ], event, ["КБЖУ оценочные; требуется подтверждение food assumptions перед ACTIVE."]);
}

function saveRecoveryLog_(validatedItem, context) {
  dataWriteAssertValidatedItem_(validatedItem, "RECOVERY_LOG");
  const item = validatedItem.payload;
  const fields = item.fields || {};
  const sleep = dataWriteField_(fields, "sleep_hours");
  const energy = dataWriteField_(fields, "energy");
  const pain = dataWriteField_(fields, "pain");
  const parts = [];
  if (sleep !== "") parts.push("sleep_" + dataWriteCompactNumber_(sleep) + "h");
  if (energy !== "") parts.push("energy_" + dataWriteCompactNumber_(energy) + "of10");
  if (pain !== "") parts.push("pain_" + dataWriteGenericSlug_(pain));
  const warnings = [];
  const event = dataWriteUserEvent_(context, "RECOVERY_LOG", "recovery_logged", parts.join("_"));
  return dataWriteOperation_("RECOVERY_LOG", [
    dataWriteField_(fields, "date"),
    sleep,
    "", "", "", "", "", "",
    energy,
    pain,
    "Smart Capture " + context.capture_id
  ], event, warnings);
}

function testSaveTransaction_() {
  const referenceDate = new Date("2026-08-14T15:00:00+03:00");
  const runId = "save-test-" + new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6);
  const results = [];
  const captures = {};

  function prepare(id, message) {
    const captureId = runId + "-" + id.toLowerCase();
    const userId = runId + "-user-" + id.toLowerCase();
    const chatId = runId + "-chat-" + id.toLowerCase();
    const built = smartConfirmationBuildTestCapture_(message, captureId, referenceDate);
    const created = createPendingCapture_(built.capture, {
      now: referenceDate,
      ttl_minutes: 30,
      user_id: userId,
      chat_id: chatId,
      source_update_id: runId + "-update-" + id.toLowerCase(),
      capture_id: captureId,
      validation: built.validation
    });
    captures[id] = {capture_id: captureId, user_id: userId, chat_id: chatId, created: created};
    return captures[id];
  }

  function record(id, passed, details) {
    const result = {id: id, status: passed ? "PASS" : "FAIL", details: details};
    results.push(result);
    console.log("[Save Transaction Test] " + JSON.stringify(result));
  }

  const body = prepare("BODY", "Вес сегодня 118.7");
  const bodySaved = saveConfirmedData_(body.capture_id, body.user_id, {now: referenceDate, chat_id: body.chat_id});
  record("BODY_TRACKING", body.created.ok && bodySaved.ok && bodySaved.code === "SAVED" &&
    bodySaved.transaction.operations.length === 1 && bodySaved.transaction.operations[0].category === "BODY_TRACKING" &&
    bodySaved.transaction.operations[0].written === false && bodySaved.transaction.events[0].event === "weight_recorded",
    bodySaved);

  const workout = prepare("WORKOUT", "Сегодня грудь, жим 100 кг 8х3");
  const workoutSaved = saveConfirmedData_(workout.capture_id, workout.user_id, {now: referenceDate, chat_id: workout.chat_id});
  record("WORKOUT_LOG", workout.created.ok && workoutSaved.ok && workoutSaved.code === "SAVED" &&
    workoutSaved.transaction.operations[0].category === "WORKOUT_LOG" &&
    workoutSaved.transaction.events[0].event === "training_completed" &&
    workoutSaved.transaction.events[0].value === "bench_press_100kg_x8x3",
    workoutSaved);

  const nutrition = prepare("NUTRITION", "Курица 250 грамм рис 200 грамм");
  const nutritionSaved = saveConfirmedData_(nutrition.capture_id, nutrition.user_id, {now: referenceDate, chat_id: nutrition.chat_id});
  record("NUTRITION_LOG", nutrition.created.ok && nutritionSaved.ok && nutritionSaved.code === "SAVED" &&
    nutritionSaved.transaction.operations[0].category === "NUTRITION_LOG" &&
    nutritionSaved.transaction.operations[0].written === false && nutritionSaved.transaction.events[0].event === "nutrition_logged",
    nutritionSaved);

  const recovery = prepare("RECOVERY", "Спал 7 часов, энергия 8");
  const recoverySaved = saveConfirmedData_(recovery.capture_id, recovery.user_id, {now: referenceDate, chat_id: recovery.chat_id});
  record("RECOVERY_LOG", recovery.created.ok && recoverySaved.ok && recoverySaved.code === "SAVED" &&
    recoverySaved.transaction.operations[0].category === "RECOVERY_LOG" &&
    recoverySaved.transaction.operations[0].row_values.length === 11 &&
    recoverySaved.transaction.operations[0].row_values[8] === 8 &&
    recoverySaved.transaction.events[0].event === "recovery_logged",
    recoverySaved);

  const multi = prepare("MULTI", "Вес сегодня 118.7. Сегодня грудь. Жим 100 кг 8х3. Ел курицу 250 грамм и рис 200 грамм. Спал 7 часов, энергия 8.");
  const multiSaved = saveConfirmedData_(multi.capture_id, multi.user_id, {now: referenceDate, chat_id: multi.chat_id});
  const multiCategories = multiSaved.ok ? multiSaved.transaction.operations.map(function(operation) { return operation.category; }).sort() : [];
  record("MULTI_CATEGORY", multi.created.ok && multiSaved.ok && multiSaved.code === "SAVED" &&
    JSON.stringify(multiCategories) === JSON.stringify(["BODY_TRACKING", "NUTRITION_LOG", "RECOVERY_LOG", "WORKOUT_LOG"]) &&
    multiSaved.transaction.events.length === 4,
    multiSaved);

  const failure = prepare("FAILURE", "Сегодня грудь. Жим 90 кг 10х3. Ел курицу 250 грамм и рис 200 грамм.");
  const failedSave = saveConfirmedData_(failure.capture_id, failure.user_id, {
    now: referenceDate,
    chat_id: failure.chat_id,
    simulate_adapter_error: "NUTRITION_LOG"
  });
  const failedRow = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), failure.capture_id);
  const failedRecovery = dataWriteParseJson_(failedRow.error, {});
  record("ONE_ADAPTER_ERROR", failure.created.ok && !failedSave.ok && failedSave.code === "FAILED" &&
    failedRow.status === "FAILED" && failedRecovery.retryable === true &&
    failedRecovery.failed_category === "NUTRITION_LOG" &&
    failedRecovery.completed_operations.length === 1 &&
    failedRecovery.completed_operations[0].category === "WORKOUT_LOG" &&
    failedRecovery.failed_operations.length === 1 &&
    failedRecovery.failed_operations[0].category === "NUTRITION_LOG" &&
    failedRecovery.production_rollback_required === false,
    failedSave);

  const beforeRepeat = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), body.capture_id);
  const beforeTransaction = dataWriteParseJson_(beforeRepeat.saved_targets_json, {});
  const beforeRowCount = smartConfirmationSheet_().getLastRow();
  const repeatedSave = saveConfirmedData_(body.capture_id, body.user_id, {now: referenceDate, chat_id: body.chat_id});
  const afterRepeat = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), body.capture_id);
  const afterTransaction = dataWriteParseJson_(afterRepeat.saved_targets_json, {});
  const afterRowCount = smartConfirmationSheet_().getLastRow();
  record("REPEATED_SAVE_IDEMPOTENT", repeatedSave.ok && repeatedSave.code === "ALREADY_SAVED" &&
    repeatedSave.duplicate_created === false && beforeRowCount === afterRowCount &&
    beforeTransaction.transaction_id === afterTransaction.transaction_id &&
    beforeTransaction.operations.length === afterTransaction.operations.length,
    repeatedSave);

  const passed = results.filter(function(result) { return result.status === "PASS"; }).length;
  const report = {
    ok: passed === results.length && dataWriteMode_() === "SIMULATION" && dataWriteDomainWritesAllowed_() === false,
    run_id: runId,
    data_write_mode: dataWriteMode_(),
    smart_capture_mode: smartCaptureMode_(),
    production_writes_enabled: dataWriteDomainWritesAllowed_(),
    domain_write_calls: 0,
    user_event_write_calls: 0,
    total_tests: results.length,
    passed: passed,
    failed: results.length - passed,
    results: results,
    sample_transaction: multiSaved.transaction || null,
    user_events_schema: DATA_WRITE_CONFIG.USER_EVENTS_SCHEMA.slice()
  };
  console.log("[Save Transaction Summary] " + JSON.stringify({
    ok: report.ok,
    run_id: report.run_id,
    data_write_mode: report.data_write_mode,
    smart_capture_mode: report.smart_capture_mode,
    production_writes_enabled: report.production_writes_enabled,
    domain_write_calls: report.domain_write_calls,
    user_event_write_calls: report.user_event_write_calls,
    total_tests: report.total_tests,
    passed: report.passed,
    failed: report.failed
  }));
  return report;
}

// Public runner only. It forces the explicitly approved Sprint 5.3 mode.
function runSaveTransactionTests() {
  PropertiesService.getScriptProperties().setProperty(DATA_WRITE_CONFIG.MODE_PROPERTY, "SIMULATION");
  return testSaveTransaction_();
}

function dataWriteMode_() {
  let configured = "";
  try {
    configured = PropertiesService.getScriptProperties().getProperty(DATA_WRITE_CONFIG.MODE_PROPERTY) || "";
  } catch (error) {
    configured = "";
  }
  const mode = String(configured || DATA_WRITE_CONFIG.DEFAULT_MODE).trim().toUpperCase();
  return DATA_WRITE_CONFIG.ALLOWED_MODES.indexOf(mode) >= 0 ? mode : "OFF";
}

function dataWriteDomainWritesAllowed_() {
  return DATA_WRITE_CONFIG.PRODUCTION_WRITES_ENABLED === true;
}

function dataWriteValidatedItems_(payload, validation) {
  if (!payload || !Array.isArray(payload.items) || !payload.items.length) {
    return {ok: false, code: "INVALID_PAYLOAD", message: "Payload не содержит items.", errors: ["missing items"]};
  }
  if (!validation || validation.ready_for_confirmation !== true || !Array.isArray(validation.items)) {
    return {ok: false, code: "VALIDATION_FAILED", message: "Validation не разрешает сохранение.", errors: ["ready_for_confirmation must be true"]};
  }
  if (String(validation.capture_id || "") !== String(payload.capture_id || "")) {
    return {ok: false, code: "CAPTURE_ID_MISMATCH", message: "Payload и validation относятся к разным capture.", errors: ["capture_id mismatch"]};
  }
  const items = [];
  const errors = [];
  payload.items.forEach(function(item) {
    const validationItem = validation.items.filter(function(candidate) {
      return candidate.category === item.category;
    })[0];
    if (!DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST[item.category]) {
      errors.push("Unsupported category: " + item.category);
      return;
    }
    if (!validationItem || ["PASS", "WARN"].indexOf(validationItem.status) < 0 || (validationItem.errors || []).length) {
      errors.push("Category is not validated: " + item.category);
      return;
    }
    items.push({payload: item, validation: validationItem});
  });
  if (errors.length || items.length !== payload.items.length) {
    return {ok: false, code: "VALIDATION_FAILED", message: "Есть невалидированные категории.", errors: errors};
  }
  return {ok: true, items: items};
}

function dataWriteAssertValidatedItem_(validatedItem, expectedCategory) {
  if (!validatedItem || !validatedItem.payload || !validatedItem.validation) {
    throw new Error("UNVALIDATED_PAYLOAD:" + expectedCategory);
  }
  if (validatedItem.payload.category !== expectedCategory || validatedItem.validation.category !== expectedCategory) {
    throw new Error("CATEGORY_MISMATCH:" + expectedCategory);
  }
  if (["PASS", "WARN"].indexOf(validatedItem.validation.status) < 0 ||
      (validatedItem.validation.errors || []).length) {
    throw new Error("VALIDATION_FAILED:" + expectedCategory);
  }
}

function dataWriteAdapter_(category) {
  const adapters = {
    BODY_TRACKING: saveBodyTracking_,
    WORKOUT_LOG: saveWorkoutLog_,
    NUTRITION_LOG: saveNutritionLog_,
    RECOVERY_LOG: saveRecoveryLog_
  };
  if (!DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST[category] || !adapters[category]) {
    throw new Error("UNSUPPORTED_CATEGORY:" + category);
  }
  return adapters[category];
}

function dataWriteOperation_(category, rowValues, event, warnings) {
  const targetSheet = DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST[category];
  if (!targetSheet) throw new Error("TARGET_NOT_ALLOWLISTED:" + category);
  return {
    ok: true,
    category: category,
    target_sheet: targetSheet,
    operation: "WOULD_APPEND_ROW",
    row_values: rowValues,
    event: event,
    warnings: warnings || [],
    mode: "SIMULATION",
    written: false
  };
}

function dataWriteUserEvent_(context, category, eventName, value) {
  return {
    date: Utilities.formatDate(context.now, "Europe/Moscow", "yyyy-MM-dd'T'HH:mm:ssXXX"),
    user_id: String(context.user_id),
    event: eventName,
    value: value,
    source: DATA_WRITE_CONFIG.EVENT_SOURCE,
    category: category,
    capture_id: String(context.capture_id),
    written: false
  };
}

function dataWriteTransaction_(selected, now, mode) {
  const transactionMode = mode || "SIMULATION";
  return {
    schema_version: "save-transaction-v3",
    transaction_id: "tx-" + String(selected.capture_id),
    capture_id: String(selected.capture_id),
    user_id: String(selected.user_id),
    source_update_id: String(selected.source_update_id || ""),
    mode: transactionMode,
    status: SMART_CONFIRMATION_CONFIG.STATUSES.SAVING,
    started_at: now.toISOString(),
    simulated: transactionMode === "SIMULATION",
    canary_write: transactionMode === "CANARY",
    real_write: transactionMode === "CANARY",
    production_writes: false,
    real_rows_changed: 0,
    step_status: {
      validation: "PENDING",
      transaction: "PENDING",
      domain_adapters: {},
      user_events: "NOT_STARTED"
    },
    completed_operations: [],
    failed_operations: [],
    retryable: false,
    operations: [],
    events: [],
    recovery: {required: false}
  };
}

function dataWriteOperationSummary_(operation) {
  return {
    category: operation.category,
    target_sheet: operation.target_sheet,
    operation: operation.operation,
    status: "COMPLETED",
    written: operation.written === true,
    row_number: operation.row_number || "",
    event_row_number: operation.event_row_number || ""
  };
}

function dataWriteField_(fields, name) {
  return fields && fields[name] && Object.prototype.hasOwnProperty.call(fields[name], "value") ? fields[name].value : "";
}

function dataWriteExerciseSlug_(value) {
  const normalized = String(value || "").toLowerCase();
  if (/жим/.test(normalized)) return "bench_press";
  if (/присед/.test(normalized)) return "squat";
  if (/станов/.test(normalized)) return "deadlift";
  if (/подтяг/.test(normalized)) return "pull_up";
  if (/тяга/.test(normalized)) return "row";
  return dataWriteGenericSlug_(normalized) || "exercise";
}

function dataWriteFoodSlug_(value) {
  const normalized = String(value || "").toLowerCase();
  if (/куриц/.test(normalized)) return "chicken";
  if (/рис/.test(normalized)) return "rice";
  return dataWriteGenericSlug_(normalized) || "food";
}

function dataWriteGenericSlug_(value) {
  return String(value || "").toLowerCase()
    .replace(/[^a-zа-яё0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
}

function dataWriteCompactNumber_(value) {
  return value === "" || value == null ? "" : String(value).replace(",", ".");
}

function dataWriteParseJson_(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (error) { return fallback; }
}

function dataWriteFailedCategory_(errorText) {
  const match = String(errorText || "").match(/(?:SIMULATED_ADAPTER_ERROR|SIMULATED_CANARY_ERROR_BEFORE_WRITE|INVALID_ADAPTER_RESULT|CANARY_COMMIT_FAILED|UNSUPPORTED_CATEGORY):([A-Z_]+)/);
  return match ? match[1] : "UNKNOWN";
}

function dataWritePendingCategories_(selected, completedOperations) {
  const payload = dataWriteParseJson_(selected && selected.payload_json, {items: []});
  const completed = (completedOperations || []).map(function(operation) { return operation.category; });
  return (payload.items || []).map(function(item) { return item.category; }).filter(function(category) {
    return completed.indexOf(category) < 0;
  });
}

function dataWriteResult_(ok, code, message, extra) {
  const result = {ok: ok, code: code, message: message};
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}
