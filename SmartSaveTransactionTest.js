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
  TRANSACTION_SCHEMA_VERSION: "save-transaction-v4",
  RECOVERY_STRATEGY: "FORWARD_RECONCILIATION_NO_DELETE",
  MAX_FAILURE_HISTORY: 20,
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
  let testIo = null;

  try {
    testIo = dataWriteResolveTestIo_(opts, mode);
  } catch (error) {
    return dataWriteResult_(false, "TEST_IO_FORBIDDEN", String(error && error.message || error), {
      mode: mode,
      production_writes: false
    });
  }

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
  let currentOperation = null;
  let previousTransaction = null;
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
    const recoveryStatus = selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.FAILED ||
      selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVING;
    if (recoveryStatus && opts.retry_failed !== true) {
      return dataWriteResult_(false, "RECOVERY_RETRY_REQUIRED",
        "FAILED/SAVING capture требует явного retry_failed=true.", {
          capture_id: selected.capture_id,
          status: selected.status,
          production_writes: false
        });
    }
    if (recoveryStatus) {
      const recoveryValidation = dataWriteValidateRecoveryTransaction_(
        selected,
        dataWriteParseJson_(selected.saved_targets_json, null),
        mode
      );
      if (!recoveryValidation.ok) {
        return dataWriteResult_(false, recoveryValidation.code, recoveryValidation.message, {
          capture_id: selected.capture_id,
          status: selected.status,
          production_writes: false
        });
      }
      previousTransaction = recoveryValidation.transaction;
    }
    if (selected.status !== SMART_CONFIRMATION_CONFIG.STATUSES.PENDING && !recoveryStatus) {
      return dataWriteResult_(false, "NOT_SAVEABLE", "Capture имеет статус " + selected.status + ".", {
        capture_id: selected.capture_id,
        status: selected.status,
        production_writes: false
      });
    }
    if (!recoveryStatus && smartConfirmationDate_(selected.expires_at).getTime() <= now.getTime()) {
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

    transaction = dataWriteTransaction_(selected, now, mode, previousTransaction);
    transaction.step_status.validation = "COMPLETED";
    transaction.step_status.transaction = "SAVING";
    smartConfirmationUpdateStatus_(sheet, selected.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.SAVING);
    SpreadsheetApp.flush();

    validatedItems.items.forEach(function(validatedItem) {
      const category = validatedItem.payload.category;
      currentCategory = category;
      currentOperation = null;
      transaction.step_status.domain_adapters[category] = "PLANNING";
      if (isCanary && opts.simulate_canary_error_before_write === true) {
        throw new Error("SIMULATED_CANARY_ERROR_BEFORE_WRITE:" + category);
      }
      if (String(opts.simulate_adapter_error || "") === category) {
        throw new Error("SIMULATED_ADAPTER_ERROR:" + category);
      }
      const adapter = dataWriteAdapter_(category);
      currentOperation = adapter(validatedItem, {
        now: now,
        mode: mode,
        user_id: String(selected.user_id),
        capture_id: String(selected.capture_id),
        source_update_id: String(selected.source_update_id || "")
      });
      if (!currentOperation || currentOperation.ok !== true || currentOperation.written !== false) {
        throw new Error("INVALID_ADAPTER_RESULT:" + category);
      }
      currentOperation = dataWriteAttachOperationIdentity_(currentOperation, transaction);
      const operationContext = {
        now: now,
        mode: mode,
        user_id: String(selected.user_id),
        capture_id: String(selected.capture_id),
        transaction_id: transaction.transaction_id,
        test_io: testIo,
        prior_state: dataWriteFindOperationState_(transaction, category)
      };
      const existingState = dataWriteObserveOperationState_(currentOperation, operationContext);
      if (dataWriteOperationStateComplete_(existingState, mode, testIo !== null)) {
        currentOperation = dataWriteApplyOperationState_(
          dataWriteFindOperation_(transaction, category) || currentOperation,
          existingState,
          mode
        );
        dataWriteRecordOperation_(transaction, currentOperation, existingState);
        transaction.step_status.domain_adapters[category] = "RECONCILED_COMPLETED";
        dataWriteCheckpointTransaction_(sheet, selected, transaction);
        return;
      }
      dataWriteMaybeFailTest_(opts, "BEFORE_DOMAIN:" + category, testIo);
      if (isCanary) {
        currentOperation = dataWriteCommitCanaryOperation_(currentOperation, {
          now: now,
          user_id: String(selected.user_id),
          capture_id: String(selected.capture_id),
          transaction_id: transaction.transaction_id
        });
        if (!currentOperation || currentOperation.ok !== true || currentOperation.written !== true) {
          throw new Error("CANARY_COMMIT_FAILED:" + category);
        }
      } else if (testIo) {
        currentOperation = dataWriteCommitTestOperation_(currentOperation, operationContext, opts);
      } else {
        currentOperation = dataWriteCompleteSimulationOperation_(currentOperation);
      }
      const completedState = (isCanary || testIo) ?
        dataWriteObserveOperationState_(currentOperation, operationContext) :
        dataWriteOperationStateFromOperation_(currentOperation, mode, false);
      if (!dataWriteOperationStateComplete_(completedState, mode, testIo !== null)) {
        throw new Error("RECONCILIATION_INCOMPLETE:" + category);
      }
      dataWriteRecordOperation_(transaction, currentOperation, completedState);
      transaction.step_status.domain_adapters[category] = "COMPLETED";
      dataWriteCheckpointTransaction_(sheet, selected, transaction);
      dataWriteMaybeFailTest_(opts, "AFTER_OPERATION:" + category, testIo);
    });

    currentCategory = "";
    currentOperation = null;
    const incompleteCategories = dataWriteIncompleteCategories_(validatedItems.items, transaction, mode, testIo !== null);
    if (incompleteCategories.length) {
      throw new Error("RECONCILIATION_INCOMPLETE:" + incompleteCategories.join(","));
    }
    dataWriteMaybeFailTest_(opts, "BEFORE_FINAL_STATUS", testIo);

    transaction.status = SMART_CONFIRMATION_CONFIG.STATUSES.SAVED;
    transaction.step_status.transaction = "SAVED";
    transaction.step_status.user_events = isCanary ? "WRITTEN" :
      (testIo ? "TEST_ONLY_WRITTEN" : "PLANNED_NOT_WRITTEN");
    transaction.retryable = false;
    transaction.completed_at = now.toISOString();
    transaction.recovery = {
      required: false,
      retryable: false,
      strategy: DATA_WRITE_CONFIG.RECOVERY_STRATEGY,
      physical_rollback_performed: false,
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
      if (currentOperation) {
        try {
          const observedState = dataWriteObserveOperationState_(currentOperation, {
            now: now,
            mode: mode,
            user_id: String(selected.user_id),
            capture_id: String(selected.capture_id),
            transaction_id: transaction.transaction_id,
            test_io: testIo
          });
          dataWriteRecordOperation_(transaction, currentOperation, observedState);
        } catch (reconciliationError) {
          transaction.reconciliation_error = String(reconciliationError && reconciliationError.message || reconciliationError);
        }
      }
      transaction.status = SMART_CONFIRMATION_CONFIG.STATUSES.FAILED;
      transaction.step_status.transaction = "FAILED";
      const pendingCategories = dataWritePendingCategories_(
        selected,
        transaction.operation_states,
        mode,
        testIo !== null
      );
      transaction.step_status.user_events = dataWriteAggregateEventStatus_(
        transaction.operation_states,
        pendingCategories.length
      );
      if (failedCategory && failedCategory !== "UNKNOWN") {
        transaction.step_status.domain_adapters[failedCategory] = "FAILED";
        transaction.failed_operations.push({
          category: failedCategory,
          status: "FAILED",
          error: errorText,
          written: false,
          capture_id: transaction.capture_id,
          operation_id: dataWriteOperationId_(transaction.transaction_id, failedCategory),
          recovery_state: dataWriteFindOperationState_(transaction, failedCategory)
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
        partial_operations: transaction.partial_operations,
        failed_operations: transaction.failed_operations,
        operation_states: transaction.operation_states,
        completed_categories: transaction.completed_operations.map(function(operation) { return operation.category; }),
        pending_categories: pendingCategories,
        event_states: dataWriteEventStates_(transaction.operation_states),
        physical_rows_present: transaction.operation_states.some(function(state) {
          return state.domain_status === "WRITTEN" || state.event_status === "WRITTEN";
        }),
        production_rollback_required: false,
        physical_rollback_allowed: false,
        physical_rollback_performed: false,
        strategy: DATA_WRITE_CONFIG.RECOVERY_STRATEGY,
        rollback_plan: "No deleteRow compensation. Reconcile capture_id + category + operation identity, then continue only missing domain/event steps.",
        note: "Retry requires retry_failed=true and deterministic forward reconciliation."
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
  const seenCategories = {};
  payload.items.forEach(function(item) {
    if (seenCategories[item.category]) {
      errors.push("Duplicate category is not allowed: " + item.category);
      return;
    }
    seenCategories[item.category] = true;
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

function dataWriteTransaction_(selected, now, mode, previousTransaction) {
  const transactionMode = mode || "SIMULATION";
  const transaction = {
    schema_version: DATA_WRITE_CONFIG.TRANSACTION_SCHEMA_VERSION,
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
    test_rows_changed: 0,
    attempt: 1,
    step_status: {
      validation: "PENDING",
      transaction: "PENDING",
      domain_adapters: {},
      user_events: "NOT_STARTED"
    },
    completed_operations: [],
    partial_operations: [],
    failed_operations: [],
    retryable: false,
    operations: [],
    events: [],
    operation_states: [],
    failure_history: [],
    recovery: {required: false}
  };
  if (!previousTransaction) return transaction;

  transaction.started_at = previousTransaction.started_at || transaction.started_at;
  transaction.attempt = Math.max(1, Number(previousTransaction.attempt) || 1) + 1;
  transaction.recovered_from_status = String(previousTransaction.status || "UNKNOWN");
  transaction.operations = dataWriteClone_(previousTransaction.operations || []);
  transaction.events = dataWriteClone_(previousTransaction.events || []);
  transaction.operation_states = dataWriteClone_(previousTransaction.operation_states || []);
  transaction.completed_operations = dataWriteClone_(previousTransaction.completed_operations || []);
  transaction.partial_operations = dataWriteClone_(previousTransaction.partial_operations || []);
  transaction.failure_history = dataWriteClone_(previousTransaction.failure_history || []).concat(
    dataWriteClone_(previousTransaction.failed_operations || [])
  ).slice(-DATA_WRITE_CONFIG.MAX_FAILURE_HISTORY);
  transaction.step_status.domain_adapters = dataWriteClone_(
    previousTransaction.step_status && previousTransaction.step_status.domain_adapters || {}
  );
  transaction.real_rows_changed = Number(previousTransaction.real_rows_changed || 0);
  transaction.test_rows_changed = Number(previousTransaction.test_rows_changed || 0);
  transaction.recovery = {
    required: true,
    retryable: true,
    strategy: DATA_WRITE_CONFIG.RECOVERY_STRATEGY,
    resumed: true
  };
  return transaction;
}

function dataWriteOperationSummary_(operation, state) {
  return {
    category: operation.category,
    target_sheet: operation.target_sheet,
    operation: operation.operation,
    status: "COMPLETED",
    capture_id: operation.capture_id,
    operation_id: operation.operation_id,
    event_id: operation.event_id,
    written: operation.written === true,
    test_only_written: operation.test_only_written === true,
    domain_status: state.domain_status,
    event_status: state.event_status,
    row_number: state.row_number || operation.row_number || "",
    event_row_number: state.event_row_number || operation.event_row_number || "",
    recovery_state: dataWriteClone_(state)
  };
}

function dataWriteResolveTestIo_(options, mode) {
  const opts = options || {};
  if (!opts.test_io) return null;
  if (mode !== "SIMULATION" || opts.test_only_io !== true ||
      DATA_WRITE_CONFIG.PRODUCTION_WRITES_ENABLED !== false) {
    throw new Error("IN_MEMORY_TEST_IO_REQUIRES_EXPLICIT_SIMULATION");
  }
  const io = opts.test_io;
  if (io.kind !== "IN_MEMORY_TEST_DOUBLE" || typeof io.inspect !== "function" ||
      typeof io.writeDomain !== "function" || typeof io.writeEvent !== "function") {
    throw new Error("IN_MEMORY_TEST_IO_INVALID");
  }
  return io;
}

function dataWriteValidateRecoveryTransaction_(selected, previousTransaction, mode) {
  const expectedTransactionId = "tx-" + String(selected.capture_id);
  if (!previousTransaction || typeof previousTransaction !== "object") {
    if (selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVING) {
      return {ok: true, transaction: null};
    }
    return {
      ok: false,
      code: "RECOVERY_STATE_INVALID",
      message: "FAILED capture не содержит transaction state."
    };
  }
  if (String(previousTransaction.capture_id || "") !== String(selected.capture_id) ||
      String(previousTransaction.transaction_id || "") !== expectedTransactionId ||
      String(previousTransaction.user_id || "") !== String(selected.user_id)) {
    return {
      ok: false,
      code: "RECOVERY_IDENTITY_MISMATCH",
      message: "Recovery transaction identity не совпадает с capture."
    };
  }
  if (String(previousTransaction.mode || "") !== String(mode)) {
    return {
      ok: false,
      code: "RECOVERY_MODE_MISMATCH",
      message: "Retry запрещён после изменения DATA_WRITE_MODE."
    };
  }
  if (selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.FAILED && previousTransaction.retryable !== true) {
    return {
      ok: false,
      code: "RECOVERY_NOT_RETRYABLE",
      message: "FAILED transaction не помечена retryable."
    };
  }
  const arrayFields = ["operations", "events", "operation_states", "completed_operations", "partial_operations", "failed_operations", "failure_history"];
  const invalidStructure = arrayFields.some(function(field) {
    return previousTransaction[field] != null && !Array.isArray(previousTransaction[field]);
  });
  if (invalidStructure) {
    return {
      ok: false,
      code: "RECOVERY_STATE_INVALID",
      message: "Recovery transaction имеет недопустимую структуру."
    };
  }
  const invalidState = (previousTransaction.operation_states || []).some(function(state) {
    return String(state.capture_id || "") !== String(selected.capture_id) ||
      String(state.operation_id || "") !== dataWriteOperationId_(expectedTransactionId, state.category);
  });
  if (invalidState) {
    return {
      ok: false,
      code: "RECOVERY_OPERATION_IDENTITY_INVALID",
      message: "Operation recovery identity повреждена."
    };
  }
  return {ok: true, transaction: previousTransaction};
}

function dataWriteAttachOperationIdentity_(operation, transaction) {
  const result = dataWriteClone_(operation);
  result.capture_id = String(transaction.capture_id);
  result.transaction_id = String(transaction.transaction_id);
  result.operation_id = dataWriteOperationId_(transaction.transaction_id, result.category);
  result.event_id = result.operation_id + ":USER_EVENT";
  if (result.event) {
    result.event.operation_id = result.operation_id;
    result.event.event_id = result.event_id;
  }
  return result;
}

function dataWriteOperationId_(transactionId, category) {
  return String(transactionId || "") + ":" + String(category || "UNKNOWN");
}

function dataWriteObserveOperationState_(operation, context) {
  const testIo = context && context.test_io;
  if (testIo) return dataWriteNormalizeObservedState_(testIo.inspect({
    capture_id: operation.capture_id,
    transaction_id: operation.transaction_id,
    operation_id: operation.operation_id,
    event_id: operation.event_id,
    category: operation.category,
    target_sheet: operation.target_sheet
  }), operation);
  if (context && context.mode === "CANARY") {
    return dataWriteObserveCanaryOperationState_(operation, context);
  }
  return dataWriteNormalizeObservedState_(
    context && context.prior_state || operation.recovery_state || null,
    operation
  );
}

function dataWriteObserveCanaryOperationState_(operation, context) {
  dataWriteAssertCanaryWriteContext_();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const bodySheet = dataWriteCanarySheet_(spreadsheet, "Body_Tracking", [
    "Дата", "Вес", "Процент жира", "Талия", "Грудь", "Рука", "Бедро", "Шаги", "Комментарий"
  ]);
  const eventSheet = dataWriteCanarySheet_(spreadsheet, "USER_EVENTS", DATA_WRITE_CONFIG.USER_EVENTS_SCHEMA);
  const expectedMarker = dataWriteCanaryMarker_(context.capture_id, context.transaction_id);
  const bodyMatches = dataWriteCanaryFindBodyRows_(bodySheet, context.capture_id).filter(function(row) {
    return String(row.values[8] || "") === expectedMarker;
  });
  const eventMatches = dataWriteCanaryFindEventRows_(eventSheet, context.capture_id).filter(function(row) {
    return row.category === operation.category && row.event === DATA_WRITE_CONFIG.CANARY_EVENT &&
      String(row.user_id) === String(context.user_id);
  });
  if (bodyMatches.length > 1 || eventMatches.length > 1) {
    throw new Error("CANARY_RECONCILIATION_AMBIGUOUS:" + operation.category);
  }
  return dataWriteNormalizeObservedState_({
    domain_status: bodyMatches.length === 1 ? "WRITTEN" : "NOT_WRITTEN",
    event_status: eventMatches.length === 1 ? "WRITTEN" : "NOT_WRITTEN",
    row_number: bodyMatches.length ? bodyMatches[0].row_number : "",
    event_row_number: eventMatches.length ? eventMatches[0].row_number : ""
  }, operation);
}

function dataWriteCommitTestOperation_(operation, context, options) {
  const io = context.test_io;
  let state = dataWriteObserveOperationState_(operation, context);
  if (state.domain_status !== "TEST_ONLY_WRITTEN") {
    io.writeDomain({
      capture_id: operation.capture_id,
      transaction_id: operation.transaction_id,
      operation_id: operation.operation_id,
      category: operation.category,
      target_sheet: operation.target_sheet,
      row_values: dataWriteClone_(operation.row_values)
    });
    state = dataWriteObserveOperationState_(operation, context);
    if (state.domain_status !== "TEST_ONLY_WRITTEN") {
      throw new Error("TEST_DOMAIN_RECONCILIATION_FAILED:" + operation.category);
    }
  }
  dataWriteMaybeFailTest_(options, "AFTER_DOMAIN:" + operation.category, io);
  dataWriteMaybeFailTest_(options, "BEFORE_EVENT:" + operation.category, io);
  if (state.event_status !== "TEST_ONLY_WRITTEN") {
    io.writeEvent({
      capture_id: operation.capture_id,
      transaction_id: operation.transaction_id,
      operation_id: operation.operation_id,
      event_id: operation.event_id,
      category: operation.category,
      event: dataWriteClone_(operation.event)
    });
    state = dataWriteObserveOperationState_(operation, context);
    if (state.event_status !== "TEST_ONLY_WRITTEN") {
      throw new Error("TEST_EVENT_RECONCILIATION_FAILED:" + operation.category);
    }
  }
  dataWriteMaybeFailTest_(options, "AFTER_EVENT:" + operation.category, io);
  const result = dataWriteApplyOperationState_(operation, state, context.mode);
  result.test_only_written = true;
  result.written = false;
  result.mode = "SIMULATION_TEST_IO";
  return result;
}

function dataWriteMaybeFailTest_(options, point, testIo) {
  if (!testIo) return;
  if (String(options && options.test_failure_point || "") === String(point)) {
    throw new Error("SIMULATED_RECOVERY_FAILURE:" + point);
  }
}

function dataWriteCompleteSimulationOperation_(operation) {
  const result = dataWriteClone_(operation);
  result.domain_status = "SIMULATED";
  result.event_status = "PLANNED_NOT_WRITTEN";
  result.completion_status = "COMPLETED";
  result.recovery_state = {
    capture_id: result.capture_id,
    operation_id: result.operation_id,
    event_id: result.event_id,
    category: result.category,
    target_sheet: result.target_sheet,
    domain_status: result.domain_status,
    event_status: result.event_status,
    row_number: "",
    event_row_number: ""
  };
  if (result.event) {
    result.event.status = "PLANNED_NOT_WRITTEN";
    result.event.written = false;
  }
  return result;
}

function dataWriteOperationStateFromOperation_(operation, mode, testIoEnabled) {
  if (testIoEnabled || mode === "CANARY") {
    return dataWriteNormalizeObservedState_({
      domain_status: operation.domain_status || (operation.written === true ? "WRITTEN" : "NOT_WRITTEN"),
      event_status: operation.event_status ||
        (operation.event && operation.event.written === true ? "WRITTEN" : "NOT_WRITTEN"),
      row_number: operation.row_number || "",
      event_row_number: operation.event_row_number || ""
    }, operation);
  }
  return dataWriteNormalizeObservedState_(operation.recovery_state, operation);
}

function dataWriteNormalizeObservedState_(state, operation) {
  const input = state || {};
  return {
    capture_id: String(operation.capture_id || ""),
    transaction_id: String(operation.transaction_id || ""),
    operation_id: String(operation.operation_id || ""),
    event_id: String(operation.event_id || ""),
    category: String(operation.category || ""),
    target_sheet: String(operation.target_sheet || ""),
    domain_status: String(input.domain_status || "NOT_WRITTEN"),
    event_status: String(input.event_status || "NOT_WRITTEN"),
    row_number: input.row_number || "",
    event_row_number: input.event_row_number || ""
  };
}

function dataWriteOperationStateComplete_(state, mode, testIoEnabled) {
  if (!state) return false;
  if (mode === "CANARY") {
    return state.domain_status === "WRITTEN" && state.event_status === "WRITTEN";
  }
  if (testIoEnabled) {
    return state.domain_status === "TEST_ONLY_WRITTEN" && state.event_status === "TEST_ONLY_WRITTEN";
  }
  return state.domain_status === "SIMULATED" && state.event_status === "PLANNED_NOT_WRITTEN";
}

function dataWriteApplyOperationState_(operation, state, mode) {
  const result = dataWriteClone_(operation);
  result.domain_status = state.domain_status;
  result.event_status = state.event_status;
  result.row_number = state.row_number || result.row_number || "";
  result.event_row_number = state.event_row_number || result.event_row_number || "";
  result.completion_status = "COMPLETED";
  result.recovery_state = dataWriteClone_(state);
  result.written = mode === "CANARY" && state.domain_status === "WRITTEN";
  result.test_only_written = state.domain_status === "TEST_ONLY_WRITTEN";
  if (result.event) {
    result.event.capture_id = result.capture_id;
    result.event.category = result.category;
    result.event.operation_id = result.operation_id;
    result.event.event_id = result.event_id;
    result.event.status = state.event_status;
    result.event.row_number = state.event_row_number || result.event.row_number || "";
    result.event.written = mode === "CANARY" && state.event_status === "WRITTEN";
    result.event.test_only_written = state.event_status === "TEST_ONLY_WRITTEN";
  }
  return result;
}

function dataWriteRecordOperation_(transaction, operation, state) {
  const normalizedState = dataWriteNormalizeObservedState_(state, operation);
  dataWriteUpsertByCategory_(transaction.operation_states, normalizedState);
  const storedOperation = dataWriteApplyOperationState_(operation, normalizedState, transaction.mode);
  dataWriteUpsertByCategory_(transaction.operations, storedOperation);
  if (storedOperation.event) dataWriteUpsertByCategory_(transaction.events, storedOperation.event);

  const complete = dataWriteOperationStateComplete_(
    normalizedState,
    transaction.mode,
    normalizedState.domain_status === "TEST_ONLY_WRITTEN" || normalizedState.event_status === "TEST_ONLY_WRITTEN"
  );
  if (complete) {
    dataWriteUpsertByCategory_(transaction.completed_operations,
      dataWriteOperationSummary_(storedOperation, normalizedState));
    dataWriteRemoveByCategory_(transaction.partial_operations, operation.category);
  } else if (normalizedState.domain_status !== "NOT_WRITTEN" || normalizedState.event_status !== "NOT_WRITTEN") {
    dataWriteUpsertByCategory_(transaction.partial_operations, {
      category: operation.category,
      target_sheet: operation.target_sheet,
      capture_id: operation.capture_id,
      operation_id: operation.operation_id,
      event_id: operation.event_id,
      domain_status: normalizedState.domain_status,
      event_status: normalizedState.event_status,
      row_number: normalizedState.row_number,
      event_row_number: normalizedState.event_row_number,
      recovery_state: dataWriteClone_(normalizedState)
    });
    dataWriteRemoveByCategory_(transaction.completed_operations, operation.category);
  } else {
    dataWriteRemoveByCategory_(transaction.completed_operations, operation.category);
    dataWriteRemoveByCategory_(transaction.partial_operations, operation.category);
  }
  transaction.real_rows_changed = transaction.operation_states.filter(function(item) {
    return item.domain_status === "WRITTEN";
  }).length + transaction.operation_states.filter(function(item) {
    return item.event_status === "WRITTEN";
  }).length;
  transaction.test_rows_changed = transaction.operation_states.filter(function(item) {
    return item.domain_status === "TEST_ONLY_WRITTEN";
  }).length + transaction.operation_states.filter(function(item) {
    return item.event_status === "TEST_ONLY_WRITTEN";
  }).length;
}

function dataWriteUpsertByCategory_(items, value) {
  dataWriteRemoveByCategory_(items, value.category);
  items.push(dataWriteClone_(value));
}

function dataWriteRemoveByCategory_(items, category) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (String(items[index].category) === String(category)) items.splice(index, 1);
  }
}

function dataWriteFindOperationState_(transaction, category) {
  return (transaction && transaction.operation_states || []).filter(function(state) {
    return String(state.category) === String(category);
  })[0] || null;
}

function dataWriteFindOperation_(transaction, category) {
  return (transaction && transaction.operations || []).filter(function(operation) {
    return String(operation.category) === String(category);
  })[0] || null;
}

function dataWriteIncompleteCategories_(validatedItems, transaction, mode, testIoEnabled) {
  return (validatedItems || []).map(function(item) { return item.payload.category; }).filter(function(category) {
    return !dataWriteOperationStateComplete_(dataWriteFindOperationState_(transaction, category), mode, testIoEnabled);
  });
}

function dataWriteEventStates_(operationStates) {
  return (operationStates || []).map(function(state) {
    return {
      category: state.category,
      event_id: state.event_id,
      status: state.event_status,
      event_row_number: state.event_row_number || ""
    };
  });
}

function dataWriteAggregateEventStatus_(operationStates, pendingCategoryCount) {
  const states = (operationStates || []).map(function(state) { return state.event_status; });
  if (!states.length || states.every(function(status) { return status === "NOT_WRITTEN"; })) return "NOT_STARTED";
  if (Number(pendingCategoryCount || 0) === 0 && states.every(function(status) {
    return status === "WRITTEN" || status === "TEST_ONLY_WRITTEN" || status === "PLANNED_NOT_WRITTEN";
  })) return "COMPLETED";
  return "PARTIAL";
}

function dataWriteCheckpointTransaction_(sheet, selected, transaction) {
  smartConfirmationUpdateState_(
    sheet,
    selected.row_number,
    SMART_CONFIRMATION_CONFIG.STATUSES.SAVING,
    JSON.stringify(transaction),
    "",
    ""
  );
  SpreadsheetApp.flush();
}

function dataWriteClone_(value) {
  return JSON.parse(JSON.stringify(value == null ? null : value));
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
  const match = String(errorText || "").match(/(?:SIMULATED_ADAPTER_ERROR|SIMULATED_CANARY_ERROR_BEFORE_WRITE|SIMULATED_RECOVERY_FAILURE(?::(?:BEFORE_DOMAIN|AFTER_DOMAIN|BEFORE_EVENT|AFTER_EVENT|AFTER_OPERATION))?|INVALID_ADAPTER_RESULT|CANARY_COMMIT_FAILED|UNSUPPORTED_CATEGORY|RECONCILIATION_INCOMPLETE):([A-Z_]+)/);
  return match ? match[1] : "UNKNOWN";
}

function dataWritePendingCategories_(selected, operationStates, mode, testIoEnabled) {
  const payload = dataWriteParseJson_(selected && selected.payload_json, {items: []});
  const completed = (operationStates || []).filter(function(state) {
    return dataWriteOperationStateComplete_(state, mode, testIoEnabled);
  }).map(function(state) { return state.category; });
  return (payload.items || []).map(function(item) { return item.category; }).filter(function(category) {
    return completed.indexOf(category) < 0;
  });
}

function dataWriteResult_(ok, code, message, extra) {
  const result = {ok: ok, code: code, message: message};
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}
