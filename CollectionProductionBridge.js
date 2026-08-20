/**
 * C-06 — Recovery-only production bridge.
 *
 * The bridge is disabled by default and permits only SIMULATION. It coordinates
 * existing C-01/C-02/C-05 contracts; it does not create domain writes, decisions,
 * recommendations, Telegram transport or Groq calls.
 */
const COLLECTION_PRODUCTION_BRIDGE_CONFIG = Object.freeze({
  ENABLED_PROPERTY: "COLLECTION_PIPELINE_ENABLED",
  ENABLED_VALUE: "true",
  SPREADSHEET_ID_PROPERTY: "COLLECTION_SPREADSHEET_ID",
  COLLECTION_TYPE: "RECOVERY_CHECKIN",
  ALLOWED_SAVE_MODE: "SIMULATION",
  PROMPT_MARKER: "Ответьте на это сообщение одним сообщением.",
  CALLBACK_PREFIX: "c06",
  CAPTURE_TTL_MINUTES: 30,
  PRODUCTION_WRITES_ENABLED: false,
  ACTIVE_ENABLED: false,
  CANARY_ENABLED: false,
  GROQ_ENABLED: false
});

function routeCollectionProductionBridge_(update, options) {
  const startedAt = new Date().getTime();
  const config = options || {};
  let dependencies;
  try {
    dependencies = collectionProductionDependencies_(config.dependencies);
  } catch (error) {
    return collectionProductionResult_(false, false, "BRIDGE_DEPENDENCIES_INVALID", {
      retryable: false
    });
  }

  if (!collectionProductionEnabled_(dependencies)) {
    return collectionProductionResult_(false, true, "COLLECTION_PIPELINE_DISABLED");
  }

  const route = collectionProductionClassifyUpdate_(update);
  if (!route.handled) return collectionProductionResult_(false, true, route.code);

  if (["COLLECTION_TYPE_NOT_ENABLED", "INVALID_COLLECTION_CALLBACK"].indexOf(route.code) >= 0) {
    return collectionProductionFinish_(collectionProductionResult_(true, false, route.code, {
      collection_type: route.collection_type,
      phase: route.phase,
      retryable: false
    }), route, update, startedAt);
  }
  if (!route.user_id || !route.chat_id) {
    return collectionProductionFinish_(collectionProductionResult_(true, false, "INVALID_UPDATE_IDENTITY", {
      collection_type: route.collection_type,
      phase: route.phase,
      retryable: false
    }), route, update, startedAt);
  }

  if (route.phase === "CONFIRMATION") {
    collectionProductionAcknowledgeCallback_(route, dependencies);
  }

  let actualMode = "";
  try {
    actualMode = String(dependencies.resolve_save_mode() || "").trim().toUpperCase();
  } catch (error) {
    actualMode = "OFF";
  }
  if (actualMode !== COLLECTION_PRODUCTION_BRIDGE_CONFIG.ALLOWED_SAVE_MODE) {
    return collectionProductionFinish_(collectionProductionResult_(true, false, "SAVE_MODE_FORBIDDEN", {
      collection_type: route.collection_type,
      phase: route.phase,
      save_mode: actualMode,
      retryable: false
    }), route, update, startedAt);
  }

  let repository;
  let spreadsheetId = "";
  try {
    spreadsheetId = String(dependencies.get_property(
      COLLECTION_PRODUCTION_BRIDGE_CONFIG.SPREADSHEET_ID_PROPERTY
    ) || "").trim();
    if (!spreadsheetId) throw new Error("SPREADSHEET_CONTEXT_MISSING");
    const technicalSpreadsheetId = String(dependencies.resolve_technical_spreadsheet_id() || "").trim();
    if (!technicalSpreadsheetId) throw new Error("SPREADSHEET_CONTEXT_MISSING");
    if (spreadsheetId !== technicalSpreadsheetId) throw new Error("SPREADSHEET_CONTEXT_MISMATCH");
    repository = dependencies.resolve_repository(spreadsheetId);
    if (!spreadsheetRepositoryIsReadableTest_(repository)) throw new Error("REPOSITORY_NOT_READABLE");
  } catch (error) {
    const contextCode = String(error && error.message || "");
    const code = ["SPREADSHEET_CONTEXT_MISSING", "SPREADSHEET_CONTEXT_MISMATCH"].indexOf(contextCode) >= 0
      ? contextCode
      : "REPOSITORY_NOT_INITIALIZED";
    return collectionProductionFinish_(collectionProductionResult_(true, false, code, {
      collection_type: route.collection_type,
      phase: route.phase,
      retryable: code === "REPOSITORY_NOT_INITIALIZED"
    }), route, update, startedAt);
  }

  let result;
  try {
    if (route.phase === "REQUEST") {
      result = collectionProductionHandleRequest_(route, repository, dependencies, config);
    } else if (route.phase === "RESPONSE") {
      result = collectionProductionHandleResponse_(route, repository, dependencies, config);
    } else if (route.phase === "CONFIRMATION") {
      result = collectionProductionHandleConfirmation_(route, repository, dependencies, config);
    } else {
      result = collectionProductionResult_(true, false, "COLLECTION_ROUTE_INVALID", {
        collection_type: route.collection_type,
        phase: route.phase,
        retryable: false
      });
    }
  } catch (error) {
    result = collectionProductionResult_(true, false, "COLLECTION_BRIDGE_ERROR", {
      collection_type: route.collection_type,
      phase: route.phase,
      retryable: false
    });
  }
  return collectionProductionFinish_(result, route, update, startedAt);
}

function collectionProductionHandleRequest_(route, repository, dependencies, options) {
  const now = options.now instanceof Date ? options.now : new Date();
  const event = collectionProductionRecoveryEvent_(route, "", now);
  let prompt;
  try {
    prompt = dependencies.build_prompt(event);
  } catch (error) {
    return collectionProductionResult_(true, false, "RECOVERY_PROMPT_FAILED", {
      collection_type: route.collection_type, phase: route.phase, retryable: false
    });
  }
  const text = prompt.prompt + "\n\n" + COLLECTION_PRODUCTION_BRIDGE_CONFIG.PROMPT_MARKER;
  const result = collectionProductionResult_(true, true, "RECOVERY_REQUEST_PRESENTED", {
    collection_type: route.collection_type,
    phase: route.phase,
    save_completed: false,
    domain_persisted: false
  });
  return collectionProductionNotify_(result, dependencies, route.chat_id, text, {
    force_reply: true,
    selective: true
  });
}

function collectionProductionHandleResponse_(route, repository, dependencies, options) {
  const now = options.now instanceof Date ? options.now : new Date();
  const raw = String(route.response_text || "").trim();
  if (!raw) {
    return collectionProductionResult_(true, false, "INVALID_RECOVERY_RESPONSE", {
      collection_type: route.collection_type, phase: route.phase, retryable: false
    });
  }

  let capture;
  let validation;
  try {
    const event = collectionProductionRecoveryEvent_(route, raw, now);
    const presented = dependencies.present(event, null, {
      now: now, mode: "PRESENTATION_TEST", observations: []
    });
    if (!presented || presented.action !== "PRESENT") throw new Error("RECOVERY_PRESENTATION_FAILED");
    const response = dependencies.process_response(
      presented.event,
      presented.state,
      raw,
      {now: now, observed_date: normalizeDateS63Test_(now), user_id: route.user_id, mode: "PRESENTATION_TEST"}
    );
    if (response && response.action === "SKIPPED") {
      const skipped = collectionProductionResult_(true, true, "RECOVERY_REQUEST_SKIPPED", {
        collection_type: route.collection_type, phase: route.phase, save_completed: false, domain_persisted: false
      });
      return collectionProductionNotify_(skipped, dependencies, route.chat_id, "Хорошо, запрос пропущен.");
    }
    const bridge = dependencies.build_capture(response && response.candidate_observation, {
      user_id: route.user_id, now: now
    });
    if (!bridge || bridge.ok !== true) {
      return collectionProductionResult_(true, false,
        String(bridge && bridge.code || "RECOVERY_CAPTURE_FAILED"), {
          collection_type: route.collection_type, phase: route.phase, retryable: false
        });
    }
    capture = bridge.capture;
    validation = dependencies.validate_capture(capture);
    if (!validation || validation.ready_for_confirmation !== true) {
      return collectionProductionResult_(true, false, "RECOVERY_VALIDATION_FAILED", {
        collection_type: route.collection_type, phase: route.phase, retryable: false
      });
    }
  } catch (error) {
    return collectionProductionResult_(true, false, "RECOVERY_RESPONSE_PROCESSING_FAILED", {
      collection_type: route.collection_type, phase: route.phase, retryable: false
    });
  }

  let created;
  try {
    created = dependencies.create_pending(capture, {
      now: now,
      ttl_minutes: COLLECTION_PRODUCTION_BRIDGE_CONFIG.CAPTURE_TTL_MINUTES,
      user_id: route.user_id,
      chat_id: route.chat_id,
      source_update_id: route.update_id,
      capture_id: capture.capture_id,
      validation: validation
    });
  } catch (error) {
    return collectionProductionResult_(true, false, "TEMPORARY_SHEET_ERROR", {
      collection_type: route.collection_type, phase: route.phase,
      capture_id: capture.capture_id, retryable: true, save_completed: false
    });
  }
  if (!created || created.ok !== true) {
    return collectionProductionResult_(true, false,
      String(created && created.code || "PENDING_CAPTURE_CREATION_FAILED"), {
        collection_type: route.collection_type, phase: route.phase,
        capture_id: capture.capture_id, retryable: true, save_completed: false
      });
  }

  const confirmationText = dependencies.build_confirmation(capture, validation) +
    "\n\nПосле подтверждения будет выполнена проверка в режиме SIMULATION. Recovery_Log не изменится.";
  const result = collectionProductionResult_(true, true, "PENDING_CONFIRMATION", {
    collection_type: route.collection_type,
    phase: route.phase,
    capture_id: capture.capture_id,
    pending_code: created.code,
    save_completed: false,
    domain_persisted: false
  });
  return collectionProductionNotify_(result, dependencies, route.chat_id, confirmationText,
    collectionProductionConfirmationKeyboard_(capture.capture_id));
}

function collectionProductionHandleConfirmation_(route, repository, dependencies, options) {
  const now = options.now instanceof Date ? options.now : new Date();
  if (route.action === "cancel") {
    let pending;
    try {
      pending = dependencies.get_pending(route.user_id, route.chat_id, {now: now});
    } catch (error) {
      return collectionProductionResult_(true, false, "TEMPORARY_SHEET_ERROR", {
        collection_type: route.collection_type, phase: route.phase, capture_id: route.capture_id, retryable: true
      });
    }
    if (!pending || pending.ok !== true) {
      return collectionProductionResult_(true, false,
        String(pending && pending.code || "NO_ACTIVE_CAPTURE"), {
          collection_type: route.collection_type, phase: route.phase, capture_id: route.capture_id, retryable: false
        });
    }
    if (!pending.capture || String(pending.capture.capture_id) !== route.capture_id) {
      return collectionProductionResult_(true, false, "CAPTURE_MISMATCH", {
        collection_type: route.collection_type, phase: route.phase, capture_id: route.capture_id, retryable: false
      });
    }
    const cancelled = dependencies.confirm(
      route.user_id, route.chat_id, route.capture_id, "Нет", {now: now}
    );
    const result = collectionProductionResult_(true, !!(cancelled && cancelled.ok),
      String(cancelled && cancelled.code || "CONFIRMATION_FAILED"), {
        collection_type: route.collection_type, phase: route.phase,
        capture_id: route.capture_id, save_completed: false, domain_persisted: false, retryable: false
      });
    if (!result.ok) return result;
    return collectionProductionNotify_(result, dependencies, route.chat_id, "Запись отменена.");
  }

  const confirmation = dependencies.confirm(
    route.user_id, route.chat_id, route.capture_id, "Да", {now: now}
  );
  if (!confirmation || confirmation.code !== "CONFIRMED_FOR_SAVE") {
    return collectionProductionResult_(true, false,
      String(confirmation && confirmation.code || "CONFIRMATION_FAILED"), {
        collection_type: route.collection_type, phase: route.phase,
        capture_id: route.capture_id, save_completed: false, retryable: false
      });
  }

  let fingerprintBefore;
  let saved;
  try {
    fingerprintBefore = dependencies.fingerprint(repository);
    saved = dependencies.save(route.capture_id, route.user_id, {
      now: now,
      chat_id: route.chat_id,
      retry_failed: route.action === "retry"
    });
  } catch (error) {
    return collectionProductionResult_(true, false, "TEMPORARY_SHEET_ERROR", {
      collection_type: route.collection_type, phase: route.phase,
      capture_id: route.capture_id, save_completed: false,
      save_state_unknown: true, retryable: true, retry_save: true
    });
  }

  const terminal = saved && ["SAVED", "ALREADY_SAVED"].indexOf(saved.code) >= 0;
  if (!terminal) {
    const failed = collectionProductionResult_(true, false,
      String(saved && saved.code || "SAVE_RESULT_INVALID"), {
        collection_type: route.collection_type, phase: route.phase,
        capture_id: route.capture_id, save: saved || null,
        save_completed: false, domain_persisted: false,
        retryable: !!(saved && saved.transaction && saved.transaction.retryable),
        retry_save: !!(saved && saved.code === "FAILED")
      });
    if (saved && saved.code === "FAILED") {
      return collectionProductionNotify_(failed, dependencies, route.chat_id,
        "Проверку сохранения завершить не удалось. Можно выполнить явный повтор.",
        collectionProductionRetryKeyboard_(route.capture_id));
    }
    return failed;
  }

  let fingerprintAfter;
  try {
    fingerprintAfter = dependencies.fingerprint(repository);
  } catch (error) {
    return collectionProductionResult_(true, false, "POST_SAVE_VERIFICATION_FAILED", {
      collection_type: route.collection_type, phase: route.phase,
      capture_id: route.capture_id, save_code: saved.code,
      save_completed: true, domain_persisted: false,
      notification_failed: false, retryable: false, retry_save: false
    });
  }
  if (stableStringifyS63Test_(fingerprintBefore) !== stableStringifyS63Test_(fingerprintAfter)) {
    return collectionProductionResult_(true, false, "DOMAIN_FINGERPRINT_CHANGED", {
      collection_type: route.collection_type, phase: route.phase,
      capture_id: route.capture_id, save_code: saved.code,
      save_completed: true, domain_persisted: false,
      retryable: false, retry_save: false
    });
  }

  const text = saved.code === "ALREADY_SAVED"
    ? "Подтверждение уже обработано. Повторная запись не выполнялась."
    : "Данные подтверждены. Проверка сохранения выполнена в режиме SIMULATION; Recovery_Log не изменён.";
  const result = collectionProductionResult_(true, true, saved.code, {
    collection_type: route.collection_type,
    phase: route.phase,
    capture_id: route.capture_id,
    transaction_id: saved.transaction && saved.transaction.transaction_id || null,
    save: saved,
    save_completed: true,
    domain_persisted: false,
    retryable: false,
    retry_save: false,
    fingerprint_unchanged: true
  });
  return collectionProductionNotify_(result, dependencies, route.chat_id, text);
}

function collectionProductionClassifyUpdate_(update) {
  const input = update || {};
  const updateId = String(input.update_id == null ? "" : input.update_id);
  const callback = input.callback_query || null;
  if (callback) {
    const data = String(callback.data || "");
    const match = data.match(/^c06:(confirm|cancel|retry):([A-Za-z0-9._-]{1,52})$/);
    if (match) {
      return {
        handled: true, code: "COLLECTION_CALLBACK", phase: "CONFIRMATION",
        collection_type: COLLECTION_PRODUCTION_BRIDGE_CONFIG.COLLECTION_TYPE,
        action: match[1], capture_id: match[2], update_id: updateId,
        callback_query_id: String(callback.id || ""),
        user_id: String(callback.from && callback.from.id || ""),
        chat_id: String(callback.message && callback.message.chat && callback.message.chat.id || "")
      };
    }
    return data.indexOf("c06:") === 0
      ? {handled: true, code: "INVALID_COLLECTION_CALLBACK", phase: "CONFIRMATION",
          collection_type: COLLECTION_PRODUCTION_BRIDGE_CONFIG.COLLECTION_TYPE,
          user_id: String(callback.from && callback.from.id || ""),
          chat_id: String(callback.message && callback.message.chat && callback.message.chat.id || ""), update_id: updateId}
      : {handled: false, code: "NOT_COLLECTION_UPDATE"};
  }

  const message = input.message || input.edited_message || null;
  if (!message || typeof message.text !== "string") return {handled: false, code: "NOT_COLLECTION_UPDATE"};
  const text = message.text.trim();
  const base = {
    handled: true,
    collection_type: COLLECTION_PRODUCTION_BRIDGE_CONFIG.COLLECTION_TYPE,
    update_id: updateId,
    user_id: String(message.from && message.from.id || ""),
    chat_id: String(message.chat && message.chat.id || ""),
    reply_message_id: String(message.reply_to_message && message.reply_to_message.message_id || "")
  };
  if (/^\/(?:start|help)(?:@\w+)?(?:\s|$)/i.test(text)) return {handled: false, code: "EXISTING_COMMAND"};
  if (/^\/(?:nutrition|workout|goal|body)(?:@\w+)?(?:\s|$)/i.test(text)) {
    base.code = "COLLECTION_TYPE_NOT_ENABLED";
    base.phase = "REQUEST";
    base.collection_type = text.match(/^\/([a-z]+)/i)[1].toUpperCase();
    return base;
  }
  if (/^\/recovery(?:@\w+)?(?:\s|$)/i.test(text)) {
    const response = text.replace(/^\/recovery(?:@\w+)?\s*/i, "").trim();
    base.code = response ? "RECOVERY_RESPONSE" : "RECOVERY_REQUEST";
    base.phase = response ? "RESPONSE" : "REQUEST";
    base.response_text = response;
    return base;
  }
  const reply = message.reply_to_message || null;
  const replyText = String(reply && reply.text || "");
  if (reply && reply.from && reply.from.is_bot === true &&
      replyText.indexOf(COLLECTION_PRODUCTION_BRIDGE_CONFIG.PROMPT_MARKER) >= 0) {
    base.code = "RECOVERY_RESPONSE";
    base.phase = "RESPONSE";
    base.response_text = text;
    return base;
  }
  return {handled: false, code: "NOT_COLLECTION_UPDATE"};
}

function collectionProductionRecoveryEvent_(route, raw, now) {
  const fields = DATA_COLLECTION_TEMPLATES_S64_TEST.RECOVERY_CHECKIN.fields.map(function(field) {
    return field.name;
  });
  const seed = stableStringifyS63Test_({
    user_id: route.user_id,
    chat_id: route.chat_id,
    observed_date: normalizeDateS63Test_(now),
    reply_message_id: route.reply_message_id || "",
    raw: String(raw || "")
  });
  return {
    event_id: "c06-recovery-" + digestHexDq_(seed).slice(0, 16),
    user_id: route.user_id,
    collection_type: COLLECTION_PRODUCTION_BRIDGE_CONFIG.COLLECTION_TYPE,
    requested_fields: fields,
    reason: "EXPLICIT_RECOVERY_COMMAND_OR_REPLY",
    priority: COLLECTION_PRODUCTION_BRIDGE_CONFIG.COLLECTION_TYPE,
    created_at: normalizeTimestampS64Test_(now),
    updated_at: normalizeTimestampS64Test_(now),
    status: "CREATED",
    write_performed: false
  };
}

function collectionProductionConfirmationKeyboard_(captureId) {
  return {inline_keyboard: [[
    {text: "Подтвердить", callback_data: "c06:confirm:" + captureId},
    {text: "Отмена", callback_data: "c06:cancel:" + captureId}
  ]]};
}

function collectionProductionRetryKeyboard_(captureId) {
  return {inline_keyboard: [[
    {text: "Повторить проверку", callback_data: "c06:retry:" + captureId}
  ]]};
}

function collectionProductionNotify_(result, dependencies, chatId, text, replyMarkup) {
  result.telegram_calls_attempted = 1;
  try {
    dependencies.send_message(chatId, text, replyMarkup ? {reply_markup: replyMarkup} : {});
    result.notification_sent = true;
    result.notification_failed = false;
    return result;
  } catch (error) {
    const operationCode = result.code;
    result.ok = false;
    result.code = "NOTIFICATION_FAILED";
    result.operation_code = operationCode;
    result.notification_sent = false;
    result.notification_failed = true;
    result.retry_save = false;
    return result;
  }
}

function collectionProductionAcknowledgeCallback_(route, dependencies) {
  try {
    dependencies.acknowledge_callback(route.callback_query_id);
  } catch (error) {
    console.warn(JSON.stringify({
      event: "COLLECTION_CALLBACK_ACK_FAILED",
      collection_type: route.collection_type,
      capture_id: route.capture_id || null,
      action: route.action || null
    }));
  }
}

function collectionProductionEnabled_(dependencies) {
  try {
    return String(dependencies.get_property(COLLECTION_PRODUCTION_BRIDGE_CONFIG.ENABLED_PROPERTY) || "")
      .trim().toLowerCase() === COLLECTION_PRODUCTION_BRIDGE_CONFIG.ENABLED_VALUE;
  } catch (error) {
    return false;
  }
}

function collectionProductionDependencies_(injected) {
  const dependencies = injected || {
    get_property: function(name) {
      return PropertiesService.getScriptProperties().getProperty(name) || "";
    },
    resolve_save_mode: dataWriteMode_,
    resolve_technical_spreadsheet_id: function() {
      const spreadsheet = getSpreadsheet_();
      return spreadsheet && typeof spreadsheet.getId === "function" ? spreadsheet.getId() : "";
    },
    resolve_repository: function(spreadsheetId) {
      return createSpreadsheetRepositoryTest_({
        spreadsheet_id: spreadsheetId,
        provider: createAppsScriptSpreadsheetProviderTest_()
      });
    },
    send_message: function(chatId, text, options) { return sendTelegramMessage_(chatId, text, options); },
    acknowledge_callback: function(callbackQueryId) { return answerTelegramCallbackQuery_(callbackQueryId); },
    build_prompt: buildDataCollectionPromptS65Test_,
    present: presentDataCollectionEventS65Test_,
    process_response: processDataCollectionResponseS65Test_,
    build_capture: collectionOrchestratorBuildCaptureC05Test_,
    validate_capture: validateExtractedData_,
    build_confirmation: buildConfirmationMessage_,
    create_pending: createPendingCapture_,
    get_pending: getPendingCapture_,
    confirm: collectionOrchestratorDefaultConfirmationC05Test_,
    save: saveConfirmedData_,
    fingerprint: collectionOrchestratorDomainFingerprintC05Test_
  };
  const required = [
    "get_property", "resolve_save_mode", "resolve_technical_spreadsheet_id", "resolve_repository",
    "send_message", "acknowledge_callback",
    "build_prompt", "present", "process_response", "build_capture", "validate_capture",
    "build_confirmation", "create_pending", "get_pending", "confirm", "save", "fingerprint"
  ];
  const invalid = required.filter(function(name) { return typeof dependencies[name] !== "function"; });
  if (invalid.length) throw new Error("C06_DEPENDENCIES_MISSING:" + invalid.join(","));
  return dependencies;
}

function collectionProductionResult_(handled, ok, code, extra) {
  const result = {
    handled: handled === true,
    ok: ok === true,
    code: String(code || "UNKNOWN"),
    bridge: "C-06_RECOVERY_ONLY",
    production_writes: false,
    domain_persisted: false,
    groq_calls: 0,
    automatic_retry: false
  };
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}

function collectionProductionFinish_(result, route, update, startedAt) {
  const transactionId = result.transaction_id ||
    result.save && result.save.transaction && result.save.transaction.transaction_id || null;
  const safeLog = {
    event: "COLLECTION_BRIDGE",
    collection_type: result.collection_type || route.collection_type || null,
    phase: result.phase || route.phase || null,
    capture_id: result.capture_id || route.capture_id || null,
    transaction_id: transactionId,
    status: result.ok ? "OK" : "ERROR",
    code: result.code,
    duration_ms: Math.max(0, new Date().getTime() - startedAt),
    update_correlation_id: String(!update || update.update_id == null ? "" : update.update_id)
  };
  console.log(JSON.stringify(safeLog));
  return result;
}
