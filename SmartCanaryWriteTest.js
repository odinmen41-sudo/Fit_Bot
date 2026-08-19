/**
 * Sprint 5.5 — Controlled Write Canary.
 *
 * Real writes are permitted only when all gates pass:
 * - CANARY_WRITE_ENVIRONMENT=TEST;
 * - the Apps Script project has no Web App deployment;
 * - DATA_WRITE_MODE=CANARY;
 * - explicit options.canary_write=true;
 * - test-only capture/user/chat/update prefixes;
 * - exactly one validated BODY_TRACKING item;
 * - exact canary weight 118.7 kg;
 * - only Body_Tracking and body_weight_recorded USER_EVENTS targets.
 */

const DATA_WRITE_CANARY_ENVIRONMENT = Object.freeze({
  ENVIRONMENT_PROPERTY: "CANARY_WRITE_ENVIRONMENT",
  TEST: "TEST",
  PRODUCTION: "PRODUCTION",
  PRODUCTION_ERROR: "CANARY_WRITE_FORBIDDEN_IN_PRODUCTION"
});

function dataWriteCanaryEnvironmentDecision_(configuredEnvironment, deployedWebApp) {
  const normalized = String(configuredEnvironment || "").trim().toUpperCase();
  const isTest = normalized === DATA_WRITE_CANARY_ENVIRONMENT.TEST;
  const isDeployed = deployedWebApp === true;
  return {
    environment: isTest ? DATA_WRITE_CANARY_ENVIRONMENT.TEST : DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION,
    deployed_web_app: isDeployed,
    production: !isTest || isDeployed
  };
}

function dataWriteCanaryRuntimeContext_() {
  let configuredEnvironment = "";
  let deployedWebApp = true;
  try {
    configuredEnvironment = PropertiesService.getScriptProperties()
      .getProperty(DATA_WRITE_CANARY_ENVIRONMENT.ENVIRONMENT_PROPERTY) || "";
  } catch (error) {
    configuredEnvironment = "";
  }
  try {
    const service = ScriptApp.getService();
    deployedWebApp = !service || Boolean(service.getUrl());
  } catch (error) {
    deployedWebApp = true;
  }
  return dataWriteCanaryEnvironmentDecision_(configuredEnvironment, deployedWebApp);
}

function dataWriteLogCanaryProductionBlock_(runtimeContext) {
  const runtime = runtimeContext || {};
  console.error("[Canary Write Guard] " + JSON.stringify({
    code: DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION_ERROR,
    environment: runtime.environment === DATA_WRITE_CANARY_ENVIRONMENT.TEST
      ? DATA_WRITE_CANARY_ENVIRONMENT.TEST
      : DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION,
    deployed_web_app: runtime.deployed_web_app === true,
    data_write_mode: dataWriteMode_()
  }));
}

function dataWriteAssertCanaryWriteContext_(runtimeContext) {
  const runtime = runtimeContext || dataWriteCanaryRuntimeContext_();
  if (runtime.production !== false) {
    dataWriteLogCanaryProductionBlock_(runtime);
    throw new Error(DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION_ERROR);
  }
  return runtime;
}

function dataWriteCanaryWritesAllowed_(runtimeContext, modeOverride) {
  const runtime = runtimeContext || dataWriteCanaryRuntimeContext_();
  const mode = modeOverride == null ? dataWriteMode_() : String(modeOverride).trim().toUpperCase();
  return runtime.production === false &&
    DATA_WRITE_CONFIG.CANARY_WRITES_ENABLED === true &&
    DATA_WRITE_CONFIG.PRODUCTION_WRITES_ENABLED === false &&
    mode === "CANARY";
}

function dataWriteValidateCanaryScope_(selected, payload, validatedItems, options) {
  const opts = options || {};
  const items = validatedItems && validatedItems.items ? validatedItems.items : [];
  const payloadItems = payload && Array.isArray(payload.items) ? payload.items : [];
  const captureId = String(selected && selected.capture_id || "");
  const userId = String(selected && selected.user_id || "");
  const chatId = String(selected && selected.chat_id || "");
  const sourceUpdateId = String(selected && selected.source_update_id || "");
  const weightField = payloadItems[0] && payloadItems[0].fields && payloadItems[0].fields.weight;
  const weight = weightField && weightField.value;
  const checks = [
    {ok: dataWriteCanaryWritesAllowed_(), code: "CANARY_MODE_NOT_ALLOWED"},
    {ok: opts.canary_write === true, code: "CANARY_AUTH_REQUIRED"},
    {ok: /^canary-weight-/.test(captureId) || /^canary-error-/.test(captureId), code: "CANARY_CAPTURE_ID_REJECTED"},
    {ok: /^canary-test-user-/.test(userId), code: "CANARY_USER_REJECTED"},
    {ok: /^canary-test-chat-/.test(chatId), code: "CANARY_CHAT_REJECTED"},
    {ok: /^canary-update-/.test(sourceUpdateId), code: "CANARY_UPDATE_REJECTED"},
    {ok: items.length === 1 && payloadItems.length === 1, code: "CANARY_SINGLE_ITEM_REQUIRED"},
    {ok: items[0] && items[0].payload.category === DATA_WRITE_CONFIG.CANARY_CATEGORY, code: "CANARY_CATEGORY_REJECTED"},
    {ok: Number(weight) === 118.7, code: "CANARY_WEIGHT_REJECTED"},
    {ok: /^\s*вес\s+сегодня\s+118[.,]7\s*[.!]?\s*$/i.test(String(payload.raw_message || "")), code: "CANARY_MESSAGE_REJECTED"}
  ];
  const failed = checks.filter(function(check) { return !check.ok; })[0];
  if (failed) {
    return {ok: false, code: failed.code, message: "CANARY scope validation failed: " + failed.code};
  }
  return {
    ok: true,
    category: DATA_WRITE_CONFIG.CANARY_CATEGORY,
    event: DATA_WRITE_CONFIG.CANARY_EVENT,
    weight: Number(weight)
  };
}

function dataWriteCommitCanaryOperation_(operation, context) {
  const runtime = dataWriteAssertCanaryWriteContext_();
  if (!dataWriteCanaryWritesAllowed_(runtime)) throw new Error("CANARY_MODE_NOT_ALLOWED");
  if (!operation || operation.category !== DATA_WRITE_CONFIG.CANARY_CATEGORY ||
      operation.target_sheet !== DATA_WRITE_CONFIG.DOMAIN_ALLOWLIST.BODY_TRACKING) {
    throw new Error("CANARY_CATEGORY_REJECTED:" + String(operation && operation.category || "UNKNOWN"));
  }
  if (!Array.isArray(operation.row_values) || operation.row_values.length !== 9) {
    throw new Error("CANARY_BODY_ROW_INVALID:BODY_TRACKING");
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const bodySheet = dataWriteCanarySheet_(spreadsheet, "Body_Tracking", [
    "Дата", "Вес", "Процент жира", "Талия", "Грудь", "Рука", "Бедро", "Шаги", "Комментарий"
  ]);
  const eventSheet = dataWriteCanarySheet_(spreadsheet, "USER_EVENTS", DATA_WRITE_CONFIG.USER_EVENTS_SCHEMA);
  const marker = dataWriteCanaryMarker_(context.capture_id, context.transaction_id);
  let bodyRow = dataWriteCanaryFindBodyRow_(bodySheet, context.capture_id);
  let eventRow = dataWriteCanaryFindEventRow_(eventSheet, context.capture_id);
  let bodyCreated = false;
  let eventCreated = false;

  if (!bodyRow) {
    const bodyValues = operation.row_values.slice();
    bodyValues[0] = dataWriteCanaryDate_(bodyValues[0]);
    bodyValues[8] = marker;
    bodyRow = dataWriteCanaryAppendFormattedRow_(bodySheet, bodyValues);
    bodyCreated = true;
  }

  if (!eventRow) {
    const eventValues = [
      dataWriteCanaryDate_(operation.row_values[0]),
      String(context.user_id),
      DATA_WRITE_CONFIG.CANARY_EVENT,
      dataWriteCompactNumber_(operation.row_values[1]) + " кг",
      DATA_WRITE_CONFIG.CANARY_EVENT_SOURCE,
      DATA_WRITE_CONFIG.CANARY_CATEGORY,
      String(context.capture_id)
    ];
    eventRow = dataWriteCanaryAppendFormattedRow_(eventSheet, eventValues);
    eventCreated = true;
  }
  SpreadsheetApp.flush();

  const committed = {};
  Object.keys(operation).forEach(function(key) { committed[key] = operation[key]; });
  committed.operation = "APPEND_ROW";
  committed.mode = "CANARY";
  committed.written = true;
  committed.created = bodyCreated;
  committed.row_number = bodyRow;
  committed.event_row_number = eventRow;
  committed.rows_changed = (bodyCreated ? 1 : 0) + (eventCreated ? 1 : 0);
  committed.idempotent_reuse = !bodyCreated || !eventCreated;
  committed.event = {
    date: Utilities.formatDate(context.now, "Europe/Moscow", "yyyy-MM-dd'T'HH:mm:ssXXX"),
    user_id: String(context.user_id),
    event: DATA_WRITE_CONFIG.CANARY_EVENT,
    value: dataWriteCompactNumber_(operation.row_values[1]) + " кг",
    source: DATA_WRITE_CONFIG.CANARY_EVENT_SOURCE,
    category: DATA_WRITE_CONFIG.CANARY_CATEGORY,
    capture_id: String(context.capture_id),
    row_number: eventRow,
    created: eventCreated,
    written: true
  };
  return committed;
}

function testCanaryProductionGuard_() {
  const production = dataWriteCanaryEnvironmentDecision_("PRODUCTION", false);
  const deployedTest = dataWriteCanaryEnvironmentDecision_("TEST", true);
  const missingEnvironment = dataWriteCanaryEnvironmentDecision_("", false);
  const test = dataWriteCanaryEnvironmentDecision_("TEST", false);
  let productionError = "";
  let deployedTestError = "";

  try {
    dataWriteAssertCanaryWriteContext_(production);
  } catch (error) {
    productionError = String(error && error.message || error);
  }
  try {
    dataWriteAssertCanaryWriteContext_(deployedTest);
  } catch (error) {
    deployedTestError = String(error && error.message || error);
  }

  const checks = [
    {id: "PRODUCTION_ENV_BLOCKED", passed: production.production === true && productionError === DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION_ERROR},
    {id: "DEPLOYED_TEST_BLOCKED", passed: deployedTest.production === true && deployedTestError === DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION_ERROR},
    {id: "MISSING_ENV_FAILS_CLOSED", passed: missingEnvironment.production === true && missingEnvironment.environment === DATA_WRITE_CANARY_ENVIRONMENT.PRODUCTION},
    {id: "NON_DEPLOYED_TEST_ALLOWED", passed: test.production === false && dataWriteCanaryWritesAllowed_(test, "CANARY") === true},
    {id: "TEST_STILL_REQUIRES_CANARY_MODE", passed: dataWriteCanaryWritesAllowed_(test, "SIMULATION") === false}
  ];
  const passed = checks.filter(function(check) { return check.passed; }).length;
  return {
    ok: passed === checks.length,
    code: "C-03",
    checks: checks,
    passed: passed,
    failed: checks.length - passed,
    sheet_reads: 0,
    sheet_writes: 0,
    production_writes: 0
  };
}

function runCanaryProductionGuardTests() {
  return testCanaryProductionGuard_();
}

function testCanaryWrite_() {
  dataWriteAssertCanaryWriteContext_();
  const properties = PropertiesService.getScriptProperties();
  const previousDataMode = properties.getProperty(DATA_WRITE_CONFIG.MODE_PROPERTY) || "SIMULATION";
  const previousCaptureMode = properties.getProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY) || "TEST";
  const now = new Date();
  const suffix = new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6);
  const captureId = "canary-weight-" + suffix;
  const errorCaptureId = "canary-error-" + suffix;
  const userId = "canary-test-user-" + suffix;
  const chatId = "canary-test-chat-" + suffix;
  const errorUserId = "canary-test-user-error-" + suffix;
  const errorChatId = "canary-test-chat-error-" + suffix;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const bodySheet = spreadsheet.getSheetByName("Body_Tracking");
  const eventSheet = spreadsheet.getSheetByName("USER_EVENTS");
  const pendingSheet = smartConfirmationSheet_();
  const before = {
    Body_Tracking: bodySheet.getLastRow(),
    USER_EVENTS: eventSheet.getLastRow(),
    PENDING_CAPTURES: pendingSheet.getLastRow()
  };
  let report = null;

  try {
    properties.setProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY, "TEST");
    properties.setProperty(DATA_WRITE_CONFIG.MODE_PROPERTY, "CANARY");

    const built = smartConfirmationBuildTestCapture_("Вес сегодня 118.7", captureId, now);
    const confirmationMessage = buildConfirmationMessage_(built.capture, built.validation);
    const confirmationIntent = detectConfirmationIntent_("Да");
    const created = createPendingCapture_(built.capture, {
      now: now,
      ttl_minutes: 30,
      user_id: userId,
      chat_id: chatId,
      source_update_id: "canary-update-" + suffix,
      capture_id: captureId,
      validation: built.validation
    });
    const saved = saveConfirmedData_(captureId, userId, {
      now: now,
      chat_id: chatId,
      canary_write: true
    });
    const savedRow = smartConfirmationFindByCaptureId_(pendingSheet, captureId);
    const afterFirst = {
      Body_Tracking: bodySheet.getLastRow(),
      USER_EVENTS: eventSheet.getLastRow(),
      PENDING_CAPTURES: pendingSheet.getLastRow()
    };

    const repeated = saveConfirmedData_(captureId, userId, {
      now: now,
      chat_id: chatId,
      canary_write: true
    });
    const afterRepeat = {
      Body_Tracking: bodySheet.getLastRow(),
      USER_EVENTS: eventSheet.getLastRow(),
      PENDING_CAPTURES: pendingSheet.getLastRow()
    };

    const errorBuilt = smartConfirmationBuildTestCapture_("Вес сегодня 118.7", errorCaptureId, now);
    const errorCreated = createPendingCapture_(errorBuilt.capture, {
      now: now,
      ttl_minutes: 30,
      user_id: errorUserId,
      chat_id: errorChatId,
      source_update_id: "canary-update-error-" + suffix,
      capture_id: errorCaptureId,
      validation: errorBuilt.validation
    });
    const failed = saveConfirmedData_(errorCaptureId, errorUserId, {
      now: now,
      chat_id: errorChatId,
      canary_write: true,
      simulate_canary_error_before_write: true
    });
    const failedRow = smartConfirmationFindByCaptureId_(pendingSheet, errorCaptureId);
    const afterFailure = {
      Body_Tracking: bodySheet.getLastRow(),
      USER_EVENTS: eventSheet.getLastRow(),
      PENDING_CAPTURES: pendingSheet.getLastRow()
    };

    const bodyMatches = dataWriteCanaryFindBodyRows_(bodySheet, captureId);
    const eventMatches = dataWriteCanaryFindEventRows_(eventSheet, captureId);
    const errorBodyMatches = dataWriteCanaryFindBodyRows_(bodySheet, errorCaptureId);
    const errorEventMatches = dataWriteCanaryFindEventRows_(eventSheet, errorCaptureId);
    const checks = [
      {id: "EXTRACTION_VALIDATION", passed: built.validation.ready_for_confirmation === true && built.capture.items.length === 1},
      {id: "CONFIRMATION", passed: confirmationIntent.intent === "CONFIRM" && confirmationMessage.indexOf("Записать?") >= 0},
      {id: "REAL_BODY_WRITE", passed: created.ok && afterFirst.Body_Tracking === before.Body_Tracking + 1 && bodyMatches.length === 1},
      {id: "CAPTURE_SAVED", passed: saved.ok && saved.code === "SAVED" && savedRow.status === "SAVED"},
      {id: "TRANSACTION_COMPLETED", passed: saved.transaction && saved.transaction.status === "SAVED" && saved.transaction.step_status.transaction === "SAVED" && saved.transaction.real_rows_changed === 2},
      {id: "USER_EVENT_CREATED", passed: afterFirst.USER_EVENTS === before.USER_EVENTS + 1 && eventMatches.length === 1 && eventMatches[0].event === DATA_WRITE_CONFIG.CANARY_EVENT},
      {id: "DUPLICATE_PROTECTION", passed: repeated.ok && repeated.code === "ALREADY_SAVED" && afterRepeat.Body_Tracking === afterFirst.Body_Tracking && afterRepeat.USER_EVENTS === afterFirst.USER_EVENTS},
      {id: "FAILED_WITHOUT_WRITE", passed: errorCreated.ok && !failed.ok && failed.code === "FAILED" && failedRow.status === "FAILED" && errorBodyMatches.length === 0 && errorEventMatches.length === 0 && afterFailure.Body_Tracking === afterRepeat.Body_Tracking && afterFailure.USER_EVENTS === afterRepeat.USER_EVENTS}
    ];
    const passed = checks.filter(function(check) { return check.passed; }).length;
    report = {
      ok: passed === checks.length,
      sprint: "5.5",
      input: "Вес сегодня 118.7",
      data_write_mode_during_test: "CANARY",
      active_enabled: false,
      capture_id: captureId,
      error_capture_id: errorCaptureId,
      checks: checks,
      passed: passed,
      failed: checks.length - passed,
      rows_before: before,
      rows_after: afterFailure,
      real_rows_changed: {
        Body_Tracking: afterFailure.Body_Tracking - before.Body_Tracking,
        USER_EVENTS: afterFailure.USER_EVENTS - before.USER_EVENTS,
        total: (afterFailure.Body_Tracking - before.Body_Tracking) + (afterFailure.USER_EVENTS - before.USER_EVENTS)
      },
      changed_sheets: ["Body_Tracking", "USER_EVENTS"],
      transaction: saved.transaction,
      repeat_result: repeated,
      failed_transaction: failed.transaction,
      rollback: getCanaryRollbackPlan_(captureId)
    };
  } finally {
    properties.setProperty(DATA_WRITE_CONFIG.MODE_PROPERTY, "SIMULATION");
    properties.setProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY, "TEST");
  }

  report.data_write_mode_after_test = dataWriteMode_();
  report.smart_capture_mode_after_test = smartCaptureMode_();
  console.log("[Controlled Write Canary] " + JSON.stringify({
    ok: report.ok,
    sprint: report.sprint,
    capture_id: report.capture_id,
    error_capture_id: report.error_capture_id,
    passed: report.passed,
    failed: report.failed,
    real_rows_changed: report.real_rows_changed,
    changed_sheets: report.changed_sheets,
    data_write_mode_after_test: report.data_write_mode_after_test,
    smart_capture_mode_after_test: report.smart_capture_mode_after_test,
    active_enabled: report.active_enabled
  }));
  return report;
}

function runCanaryWriteTest() {
  return testCanaryWrite_();
}

function getCanaryRollbackPlan_(captureId) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const bodySheet = spreadsheet.getSheetByName("Body_Tracking");
  const eventSheet = spreadsheet.getSheetByName("USER_EVENTS");
  const bodyRows = dataWriteCanaryFindBodyRows_(bodySheet, captureId);
  const eventRows = dataWriteCanaryFindEventRows_(eventSheet, captureId);
  const actions = [];
  eventRows.forEach(function(row) {
    actions.push({order: 1, sheet: "USER_EVENTS", row_number: row.row_number, action: "DELETE_EXACT_ROW"});
  });
  bodyRows.forEach(function(row) {
    actions.push({order: 2, sheet: "Body_Tracking", row_number: row.row_number, action: "DELETE_EXACT_ROW"});
  });
  return {
    automatic: false,
    capture_id: String(captureId),
    verify_before_delete: true,
    delete_in_this_order: actions,
    procedure: [
      "Set DATA_WRITE_MODE=SIMULATION.",
      "Verify capture_id in USER_EVENTS and the CANARY marker in Body_Tracking.",
      "Delete the exact USER_EVENTS row first.",
      "Delete the exact Body_Tracking row second.",
      "Mark the PENDING_CAPTURES transaction as rolled back only in a separately approved recovery step."
    ]
  };
}

function dataWriteCanarySheet_(spreadsheet, sheetName, expectedHeaders) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error("CANARY_MISSING_SHEET:" + sheetName);
  const headers = sheet.getRange(1, 1, 1, expectedHeaders.length).getDisplayValues()[0];
  if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) {
    throw new Error("CANARY_HEADER_MISMATCH:" + sheetName);
  }
  return sheet;
}

function dataWriteCanaryAppendFormattedRow_(sheet, values) {
  dataWriteAssertCanaryWriteContext_();
  const lastRow = sheet.getLastRow();
  const targetRow = lastRow + 1;
  const target = sheet.getRange(targetRow, 1, 1, values.length);
  if (lastRow >= 2) {
    sheet.getRange(lastRow, 1, 1, values.length).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  }
  target.setValues([values]);
  if (values[0] instanceof Date) target.getCell(1, 1).setNumberFormat("dd.mm.yyyy");
  SpreadsheetApp.flush();
  return targetRow;
}

function dataWriteCanaryFindBodyRow_(sheet, captureId) {
  const rows = dataWriteCanaryFindBodyRows_(sheet, captureId);
  if (rows.length > 1) throw new Error("CANARY_DUPLICATE_BODY_ROWS:BODY_TRACKING");
  return rows.length ? rows[0].row_number : 0;
}

function dataWriteCanaryFindBodyRows_(sheet, captureId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const token = String(captureId);
  return sheet.getRange(2, 1, lastRow - 1, 9).getDisplayValues().map(function(values, index) {
    return {row_number: index + 2, values: values};
  }).filter(function(row) {
    return String(row.values[8] || "").indexOf(token) >= 0;
  });
}

function dataWriteCanaryFindEventRow_(sheet, captureId) {
  const rows = dataWriteCanaryFindEventRows_(sheet, captureId);
  if (rows.length > 1) throw new Error("CANARY_DUPLICATE_EVENT_ROWS:BODY_TRACKING");
  return rows.length ? rows[0].row_number : 0;
}

function dataWriteCanaryFindEventRows_(sheet, captureId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 7).getDisplayValues().map(function(values, index) {
    return {
      row_number: index + 2,
      date: values[0],
      user_id: values[1],
      event: values[2],
      value: values[3],
      source: values[4],
      category: values[5],
      capture_id: values[6]
    };
  }).filter(function(row) {
    return String(row.capture_id) === String(captureId) && row.event === DATA_WRITE_CONFIG.CANARY_EVENT;
  });
}

function dataWriteCanaryMarker_(captureId, transactionId) {
  return "CANARY " + String(captureId) + " | " + String(transactionId);
}

function dataWriteCanaryDate_(value) {
  if (value instanceof Date) return value;
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("CANARY_INVALID_DATE:BODY_TRACKING");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
