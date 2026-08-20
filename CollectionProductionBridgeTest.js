/** C-06 safe in-memory acceptance suite. */
function testCollectionProductionBridgeC06_() {
  const tests = [];
  const now = new Date("2026-08-20T09:00:00+03:00");

  function record(id, passed, details) {
    tests.push({
      id: id,
      status: passed ? "PASS" : "FAIL",
      details: details == null ? null : deepCloneDq_(details)
    });
  }
  function messageUpdate(id, text, replyText, userId) {
    const message = {
      message_id: Number(id) + 100,
      text: text,
      from: {id: userId || "c06-user", is_bot: false},
      chat: {id: "c06-chat"}
    };
    if (replyText) {
      message.reply_to_message = {
        message_id: 700,
        text: replyText,
        from: {id: "c06-bot", is_bot: true}
      };
    }
    return {update_id: String(id), message: message};
  }
  function callbackUpdate(id, action, captureId, userId) {
    return {
      update_id: String(id),
      callback_query: {
        id: "callback-" + id,
        data: "c06:" + action + ":" + captureId,
        from: {id: userId || "c06-user", is_bot: false},
        message: {message_id: 800, chat: {id: "c06-chat"}}
      }
    };
  }
  function execute(env, update) {
    return routeCollectionProductionBridge_(update, {
      now: now,
      dependencies: env.dependencies
    });
  }
  function prepare(env, suffix) {
    const prompt = execute(env, messageUpdate("10" + suffix, "/recovery"));
    const reply = execute(env, messageUpdate(
      "20" + suffix,
      "Спал 7 часов, энергия 8, боли нет",
      "Recovery\n" + COLLECTION_PRODUCTION_BRIDGE_CONFIG.PROMPT_MARKER
    ));
    return {prompt: prompt, response: reply, capture_id: reply.capture_id};
  }

  const disabled = collectionProductionBridgeHarnessC06_({enabled_property: ""});
  const disabledResult = execute(disabled, messageUpdate(1, "/recovery"));
  record("C06-01_DISABLED_BY_DEFAULT", !disabledResult.handled &&
    disabledResult.code === "COLLECTION_PIPELINE_DISABLED" && disabled.counters.telegram_calls === 0, disabledResult);

  const invalidFlag = collectionProductionBridgeHarnessC06_({enabled_property: "yes"});
  const invalidFlagResult = execute(invalidFlag, messageUpdate(2, "/recovery"));
  record("C06-02_INVALID_PROPERTY_DISABLED", !invalidFlagResult.handled &&
    invalidFlagResult.code === "COLLECTION_PIPELINE_DISABLED", invalidFlagResult);

  const passthrough = collectionProductionBridgeHarnessC06_({});
  const normal = execute(passthrough, messageUpdate(3, "Что мне делать сегодня?"));
  record("C06-03_NORMAL_MESSAGE_UNTOUCHED", !normal.handled && normal.code === "NOT_COLLECTION_UPDATE" &&
    passthrough.counters.telegram_calls === 0 && passthrough.counters.save_calls === 0, normal);

  const start = execute(passthrough, messageUpdate(4, "/start"));
  const help = execute(passthrough, messageUpdate(5, "/help"));
  record("C06-04_EXISTING_COMMANDS_UNTOUCHED", !start.handled && !help.handled &&
    start.code === "EXISTING_COMMAND" && help.code === "EXISTING_COMMAND", {start: start.code, help: help.code});

  const requestEnv = collectionProductionBridgeHarnessC06_({});
  const request = execute(requestEnv, messageUpdate(6, "/recovery"));
  const requestMessage = requestEnv.sent_messages[0] || {};
  record("C06-05_RECOVERY_REQUEST_ROUTED", request.ok && request.code === "RECOVERY_REQUEST_PRESENTED" &&
    requestMessage.options && requestMessage.options.reply_markup && requestMessage.options.reply_markup.force_reply === true,
    {result: request, message: requestMessage});

  const unsupported = execute(collectionProductionBridgeHarnessC06_({}), messageUpdate(7, "/nutrition"));
  record("C06-06_UNSUPPORTED_TYPE", unsupported.handled && !unsupported.ok &&
    unsupported.code === "COLLECTION_TYPE_NOT_ENABLED" && unsupported.collection_type === "NUTRITION", unsupported);

  const noRepository = execute(collectionProductionBridgeHarnessC06_({repository_error: true}), messageUpdate(8, "/recovery"));
  record("C06-07_REPOSITORY_FAIL_CLOSED", noRepository.handled && !noRepository.ok &&
    noRepository.code === "REPOSITORY_NOT_INITIALIZED" && noRepository.retryable === true, noRepository);

  const responseEnv = collectionProductionBridgeHarnessC06_({});
  const prepared = prepare(responseEnv, "1");
  const storedCapture = responseEnv.captures[prepared.capture_id];
  const recoveryItem = storedCapture && storedCapture.capture.items[0];
  record("C06-08_RECOVERY_RESPONSE_PARSED", prepared.response.ok && prepared.response.code === "PENDING_CONFIRMATION" &&
    recoveryItem.category === "RECOVERY_LOG" && recoveryItem.fields.sleep_hours.value === 7 &&
    recoveryItem.fields.energy.value === 8, recoveryItem);
  record("C06-09_PENDING_CAPTURE_FAKE_WRITE", responseEnv.counters.fake_technical_writes === 1 &&
    responseEnv.counters.real_sheet_reads === 0 && responseEnv.counters.real_sheet_writes === 0,
    responseEnv.counters);

  const yes = execute(responseEnv, callbackUpdate(31, "confirm", prepared.capture_id));
  record("C06-10_CONFIRM_YES", yes.ok && yes.code === "SAVED" && yes.save_completed === true &&
    yes.domain_persisted === false && yes.fingerprint_unchanged === true, yes);

  const cancelEnv = collectionProductionBridgeHarnessC06_({});
  const cancelPrepared = prepare(cancelEnv, "2");
  const cancelled = execute(cancelEnv, callbackUpdate(32, "cancel", cancelPrepared.capture_id));
  record("C06-11_CONFIRM_NO", cancelled.ok && cancelled.code === "CANCELLED" &&
    cancelEnv.captures[cancelPrepared.capture_id].status === "CANCELLED" && cancelEnv.counters.save_calls === 0, cancelled);

  const expiredEnv = collectionProductionBridgeHarnessC06_({});
  const expiredPrepared = prepare(expiredEnv, "3");
  expiredEnv.captures[expiredPrepared.capture_id].expires_at = new Date(now.getTime() - 1000);
  const expired = execute(expiredEnv, callbackUpdate(33, "confirm", expiredPrepared.capture_id));
  record("C06-12_EXPIRED", !expired.ok && expired.code === "EXPIRED" && expired.save_completed === false, expired);

  const ownerEnv = collectionProductionBridgeHarnessC06_({});
  const ownerPrepared = prepare(ownerEnv, "4");
  const owner = execute(ownerEnv, callbackUpdate(34, "confirm", ownerPrepared.capture_id, "other-user"));
  record("C06-13_OWNERSHIP_MISMATCH", !owner.ok && owner.code === "OWNER_MISMATCH" &&
    ownerEnv.captures[ownerPrepared.capture_id].status === "PENDING_CONFIRMATION" &&
    ownerEnv.counters.callback_acknowledgements === 1, owner);

  const duplicateEnv = collectionProductionBridgeHarnessC06_({});
  const duplicatePrepared = prepare(duplicateEnv, "5");
  const firstConfirmation = execute(duplicateEnv, callbackUpdate(35, "confirm", duplicatePrepared.capture_id));
  const repeatedConfirmation = execute(duplicateEnv, callbackUpdate(36, "confirm", duplicatePrepared.capture_id));
  record("C06-14_DUPLICATE_CALLBACK_IDEMPOTENT", firstConfirmation.code === "SAVED" &&
    repeatedConfirmation.code === "ALREADY_SAVED" && duplicateEnv.counters.successful_saves === 1, {
      first: firstConfirmation.code, repeated: repeatedConfirmation.code,
      successful_saves: duplicateEnv.counters.successful_saves
    });
  record("C06-15_SIMULATION_SAVE", firstConfirmation.save.mode === "SIMULATION" &&
    firstConfirmation.save.production_writes === false && duplicateEnv.counters.domain_writes === 0,
    firstConfirmation.save);

  const retryEnv = collectionProductionBridgeHarnessC06_({save_sequence: ["FAILED", "SAVED"]});
  const retryPrepared = prepare(retryEnv, "6");
  const failed = execute(retryEnv, callbackUpdate(37, "confirm", retryPrepared.capture_id));
  const retried = execute(retryEnv, callbackUpdate(38, "retry", retryPrepared.capture_id));
  record("C06-16_EXPLICIT_RETRY", failed.code === "FAILED" && failed.retry_save === true &&
    retried.ok && retried.code === "SAVED" && retryEnv.counters.save_calls === 2, {
      failed: failed.code, retried: retried.code, save_calls: retryEnv.counters.save_calls
    });

  record("C06-17_ALREADY_SAVED", repeatedConfirmation.ok && repeatedConfirmation.code === "ALREADY_SAVED" &&
    repeatedConfirmation.retry_save === false, repeatedConfirmation);

  const sendFailureEnv = collectionProductionBridgeHarnessC06_({send_failure_after_save: true});
  const sendFailurePrepared = prepare(sendFailureEnv, "7");
  const sendFailure = execute(sendFailureEnv, callbackUpdate(39, "confirm", sendFailurePrepared.capture_id));
  record("C06-18_SAVE_SUCCESS_NOTIFICATION_FAILURE", !sendFailure.ok && sendFailure.code === "NOTIFICATION_FAILED" &&
    sendFailure.operation_code === "SAVED" && sendFailure.save_completed === true &&
    sendFailure.notification_failed === true && sendFailure.retry_save === false && sendFailureEnv.counters.save_calls === 1,
    sendFailure);

  const sheetErrorEnv = collectionProductionBridgeHarnessC06_({pending_sheet_error: true});
  const sheetError = prepare(sheetErrorEnv, "8").response;
  record("C06-19_TEMPORARY_SHEET_ERROR", !sheetError.ok && sheetError.code === "TEMPORARY_SHEET_ERROR" &&
    sheetError.retryable === true && sheetError.save_completed === false, sheetError);

  record("C06-20_FAKE_TELEGRAM_ONLY", responseEnv.counters.telegram_calls > 0 &&
    responseEnv.counters.real_telegram_calls === 0, responseEnv.counters);
  record("C06-21_REAL_SHEETS_IO_ZERO", responseEnv.counters.real_sheet_reads === 0 &&
    responseEnv.counters.real_sheet_writes === 0 && responseEnv.counters.domain_writes === 0, responseEnv.counters);
  record("C06-22_GROQ_ZERO", responseEnv.counters.groq_calls === 0, responseEnv.counters);

  const activeEnv = collectionProductionBridgeHarnessC06_({save_mode: "ACTIVE"});
  const canaryEnv = collectionProductionBridgeHarnessC06_({save_mode: "CANARY"});
  const active = execute(activeEnv, messageUpdate(40, "/recovery"));
  const canary = execute(canaryEnv, messageUpdate(41, "/recovery"));
  record("C06-23_ACTIVE_CANARY_BLOCKED", active.code === "SAVE_MODE_FORBIDDEN" &&
    canary.code === "SAVE_MODE_FORBIDDEN" && activeEnv.counters.telegram_calls === 0 &&
    canaryEnv.counters.telegram_calls === 0, {active: active.code, canary: canary.code});

  const invalidCallbackEnv = collectionProductionBridgeHarnessC06_({});
  const invalidCallback = execute(invalidCallbackEnv, {
    update_id: "42",
    callback_query: {data: "c06:confirm:bad/capture", from: {id: "c06-user"}, message: {chat: {id: "c06-chat"}}}
  });
  record("C06-24_INVALID_CALLBACK", !invalidCallback.ok && invalidCallback.code === "INVALID_COLLECTION_CALLBACK" &&
    invalidCallbackEnv.counters.callback_ack_attempts === 0, invalidCallback);

  const neutralText = (responseEnv.sent_messages[responseEnv.sent_messages.length - 1] || {}).text || "";
  record("C06-25_NO_FALSE_PERSISTENCE_CLAIM", neutralText.indexOf("Recovery_Log не изменён") >= 0 &&
    neutralText.indexOf("данные сохранены") < 0, neutralText);

  record("C06-26_CALLBACK_ACK_CONFIRM_CANCEL_RETRY", responseEnv.counters.callback_acknowledgements === 1 &&
    cancelEnv.counters.callback_acknowledgements === 1 && retryEnv.counters.callback_acknowledgements === 2, {
      confirm: responseEnv.counters.callback_acknowledgements,
      cancel: cancelEnv.counters.callback_acknowledgements,
      confirm_and_retry: retryEnv.counters.callback_acknowledgements
    });
  record("C06-27_DUPLICATE_CALLBACK_ACKNOWLEDGED_WITHOUT_DUPLICATE_SAVE",
    duplicateEnv.counters.callback_acknowledgements === 2 && duplicateEnv.counters.successful_saves === 1,
    duplicateEnv.counters);

  const acknowledgementFailureEnv = collectionProductionBridgeHarnessC06_({callback_ack_failure: true});
  const acknowledgementFailurePrepared = prepare(acknowledgementFailureEnv, "9");
  const acknowledgementFailure = execute(
    acknowledgementFailureEnv,
    callbackUpdate(43, "confirm", acknowledgementFailurePrepared.capture_id)
  );
  record("C06-28_CALLBACK_ACK_FAILURE_DOES_NOT_BREAK_SAVE", acknowledgementFailure.ok &&
    acknowledgementFailure.code === "SAVED" && acknowledgementFailureEnv.counters.callback_ack_failures === 1 &&
    acknowledgementFailureEnv.counters.save_calls === 1 && acknowledgementFailureEnv.counters.successful_saves === 1,
    {result: acknowledgementFailure, counters: acknowledgementFailureEnv.counters});

  const missingSpreadsheetEnv = collectionProductionBridgeHarnessC06_({spreadsheet_property: ""});
  const missingSpreadsheet = execute(missingSpreadsheetEnv, messageUpdate(44, "/recovery"));
  record("C06-29_SPREADSHEET_CONTEXT_MISSING_FAIL_CLOSED", !missingSpreadsheet.ok &&
    missingSpreadsheet.code === "SPREADSHEET_CONTEXT_MISSING" &&
    missingSpreadsheetEnv.counters.repository_resolutions === 0 &&
    missingSpreadsheetEnv.counters.fake_technical_writes === 0, missingSpreadsheet);

  const mismatchSpreadsheetEnv = collectionProductionBridgeHarnessC06_({
    spreadsheet_property: "configured-sheet",
    technical_spreadsheet_id: "bound-sheet"
  });
  const mismatchSpreadsheet = execute(mismatchSpreadsheetEnv, messageUpdate(45, "/recovery"));
  record("C06-30_SPREADSHEET_CONTEXT_MISMATCH_FAIL_CLOSED", !mismatchSpreadsheet.ok &&
    mismatchSpreadsheet.code === "SPREADSHEET_CONTEXT_MISMATCH" &&
    mismatchSpreadsheetEnv.counters.repository_resolutions === 0 &&
    mismatchSpreadsheetEnv.counters.fake_technical_writes === 0, mismatchSpreadsheet);

  record("C06-31_AUTHORITATIVE_REPOSITORY_RESOLUTION", request.ok &&
    requestEnv.counters.last_repository_id === "c06-sheet" &&
    requestEnv.counters.last_technical_spreadsheet_id === "c06-sheet", requestEnv.counters);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "C-06_RECOVERY_PRODUCTION_BRIDGE",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {
      production_writes: 0,
      real_sheet_reads: 0,
      real_sheet_writes: 0,
      real_telegram_calls: 0,
      groq_calls: 0,
      deployment: 0,
      workflow_dispatch: 0
    }
  };
}

function collectionProductionBridgeHarnessC06_(scenario) {
  const config = scenario || {};
  const captures = {};
  const sentMessages = [];
  const counters = {
    fake_repository_reads: 0,
    fake_technical_writes: 0,
    domain_writes: 0,
    real_sheet_reads: 0,
    real_sheet_writes: 0,
    telegram_calls: 0,
    real_telegram_calls: 0,
    groq_calls: 0,
    save_calls: 0,
    successful_saves: 0,
    callback_ack_attempts: 0,
    callback_acknowledgements: 0,
    callback_ack_failures: 0,
    repository_resolutions: 0,
    last_repository_id: "",
    last_technical_spreadsheet_id: ""
  };
  const repository = {
    readSheet: function(name) {
      counters.fake_repository_reads += 1;
      return {exists: true, sheet_id: 1, name: name, last_row: 0, last_column: 0, values: []};
    },
    readAllSheets: function() {
      counters.fake_repository_reads += 1;
      return ["Body_Tracking", "Workout_Log", "Nutrition_Log", "Recovery_Log", "USER_EVENTS"].map(function(name, index) {
        return {exists: true, sheet_id: index + 1, name: name, last_row: 0, last_column: 0, values: []};
      });
    }
  };
  const saveSequence = (config.save_sequence || []).slice();
  let lastSaveCompleted = false;
  const dependencies = {
    get_property: function(name) {
      if (name === COLLECTION_PRODUCTION_BRIDGE_CONFIG.ENABLED_PROPERTY) {
        return config.enabled_property === undefined ? "true" : config.enabled_property;
      }
      if (name === COLLECTION_PRODUCTION_BRIDGE_CONFIG.SPREADSHEET_ID_PROPERTY) {
        return config.spreadsheet_property === undefined ? "c06-sheet" : config.spreadsheet_property;
      }
      return "";
    },
    resolve_save_mode: function() { return config.save_mode || "SIMULATION"; },
    resolve_technical_spreadsheet_id: function() {
      const id = config.technical_spreadsheet_id === undefined
        ? "c06-sheet"
        : config.technical_spreadsheet_id;
      counters.last_technical_spreadsheet_id = String(id || "");
      return id;
    },
    resolve_repository: function(spreadsheetId) {
      if (config.repository_error) throw new Error("INJECTED_REPOSITORY_ERROR");
      counters.repository_resolutions += 1;
      counters.last_repository_id = String(spreadsheetId || "");
      return repository;
    },
    send_message: function(chatId, text, options) {
      counters.telegram_calls += 1;
      if (config.send_failure_after_save && lastSaveCompleted) throw new Error("INJECTED_SEND_FAILURE");
      sentMessages.push({chat_id: String(chatId), text: String(text), options: deepCloneDq_(options || {})});
    },
    acknowledge_callback: function(callbackQueryId) {
      counters.callback_ack_attempts += 1;
      if (config.callback_ack_failure) {
        counters.callback_ack_failures += 1;
        throw new Error("INJECTED_CALLBACK_ACK_FAILURE");
      }
      if (!String(callbackQueryId || "")) throw new Error("CALLBACK_QUERY_ID_REQUIRED");
      counters.callback_acknowledgements += 1;
    },
    build_prompt: buildDataCollectionPromptS65Test_,
    present: presentDataCollectionEventS65Test_,
    process_response: processDataCollectionResponseS65Test_,
    build_capture: collectionOrchestratorBuildCaptureC05Test_,
    validate_capture: validateExtractedData_,
    build_confirmation: buildConfirmationMessage_,
    create_pending: function(capture, metadata) {
      if (config.pending_sheet_error) throw new Error("INJECTED_SHEET_ERROR");
      if (captures[metadata.capture_id]) {
        return {ok: true, code: "CAPTURE_ALREADY_EXISTS", capture_id: metadata.capture_id};
      }
      captures[metadata.capture_id] = {
        capture_id: metadata.capture_id,
        user_id: String(metadata.user_id),
        chat_id: String(metadata.chat_id),
        status: "PENDING_CONFIRMATION",
        expires_at: new Date(metadata.now.getTime() + metadata.ttl_minutes * 60000),
        capture: deepCloneDq_(capture)
      };
      counters.fake_technical_writes += 1;
      return {ok: true, code: "CREATED", capture_id: metadata.capture_id};
    },
    get_pending: function(userId, chatId, options) {
      const rows = Object.keys(captures).map(function(id) { return captures[id]; }).filter(function(item) {
        return item.user_id === String(userId) && item.chat_id === String(chatId) && item.status === "PENDING_CONFIRMATION";
      });
      if (!rows.length) return {ok: false, code: "NO_ACTIVE_CAPTURE", message: "No active capture."};
      const active = rows[0];
      if (active.expires_at.getTime() <= options.now.getTime()) {
        active.status = "EXPIRED";
        counters.fake_technical_writes += 1;
        return {ok: false, code: "EXPIRED", message: "Expired."};
      }
      return {ok: true, code: "ACTIVE_CAPTURE_FOUND", capture: active};
    },
    confirm: function(userId, chatId, captureId, text) {
      const intent = detectConfirmationIntent_(text);
      if (intent.intent === "CONFIRM") {
        return {ok: true, code: "CONFIRMED_FOR_SAVE", message: "Confirmed."};
      }
      const active = Object.keys(captures).map(function(id) { return captures[id]; }).filter(function(item) {
        return item.user_id === String(userId) && item.chat_id === String(chatId) &&
          item.capture_id === String(captureId) && item.status === "PENDING_CONFIRMATION";
      })[0];
      if (!active) return {ok: false, code: "NO_ACTIVE_CAPTURE", message: "No active capture."};
      active.status = "CANCELLED";
      counters.fake_technical_writes += 1;
      return {ok: true, code: "CANCELLED", message: "Cancelled."};
    },
    save: function(captureId, userId, options) {
      counters.save_calls += 1;
      const selected = captures[captureId];
      if (!selected) return {ok: false, code: "CAPTURE_NOT_FOUND", message: "Not found."};
      if (selected.user_id !== String(userId) || selected.chat_id !== String(options.chat_id)) {
        return {ok: false, code: "OWNER_MISMATCH", message: "Owner mismatch."};
      }
      if (selected.status === "SAVED") {
        lastSaveCompleted = true;
        return {ok: true, code: "ALREADY_SAVED", message: "Already saved.", mode: "SIMULATION",
          transaction: {transaction_id: "tx-" + captureId}, production_writes: false};
      }
      if (selected.expires_at.getTime() <= options.now.getTime()) {
        selected.status = "EXPIRED";
        counters.fake_technical_writes += 1;
        return {ok: false, code: "EXPIRED", message: "Expired.", production_writes: false};
      }
      if (selected.status === "FAILED" && options.retry_failed !== true) {
        return {ok: false, code: "RECOVERY_RETRY_REQUIRED", message: "Retry required.", production_writes: false};
      }
      const code = saveSequence.length ? saveSequence.shift() : "SAVED";
      if (code === "FAILED") {
        selected.status = "FAILED";
        counters.fake_technical_writes += 1;
        return {ok: false, code: "FAILED", message: "Injected failure.", mode: "SIMULATION",
          transaction: {transaction_id: "tx-" + captureId, retryable: true}, production_writes: false};
      }
      selected.status = "SAVED";
      counters.fake_technical_writes += 1;
      counters.successful_saves += 1;
      lastSaveCompleted = true;
      return {ok: true, code: "SAVED", message: "Simulation complete.", mode: "SIMULATION",
        transaction: {transaction_id: "tx-" + captureId, retryable: false}, production_writes: false};
    },
    fingerprint: function(repo) {
      return {domain_hash: digestHexDq_(stableStringifyS63Test_(repo.readAllSheets()))};
    }
  };
  return {
    dependencies: dependencies,
    repository: repository,
    captures: captures,
    sent_messages: sentMessages,
    counters: counters
  };
}

function runCollectionProductionBridgeC06Tests() {
  return testCollectionProductionBridgeC06_();
}
