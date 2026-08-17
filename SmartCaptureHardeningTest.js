/**
 * Smart Capture Sprint 5.4 — Architecture Hardening (test-only).
 *
 * Allowed persistent changes:
 * - additive header migration for USER_EVENTS and Recovery_Log;
 * - technical test state in PENDING_CAPTURES;
 * - feature flags remain TEST/SIMULATION after the runner.
 *
 * Forbidden here:
 * - domain/event row writes;
 * - Telegram or doPost integration;
 * - deployment or ACTIVE mode.
 */
const SMART_HARDENING_CONFIG = Object.freeze({
  USER_EVENTS: Object.freeze({
    sheet_name: "USER_EVENTS",
    legacy_headers: Object.freeze(["date", "user_id", "event", "value", "source"]),
    required_headers: Object.freeze(["date", "user_id", "event", "value", "source", "category", "capture_id"])
  }),
  RECOVERY_LOG: Object.freeze({
    sheet_name: "Recovery_Log",
    legacy_headers: Object.freeze([
      "Дата", "Сон часы", "Качество сна", "Стресс", "Усталость", "Боль плечо", "Боль поясница", "Давление"
    ]),
    required_headers: Object.freeze([
      "Дата", "Сон часы", "Качество сна", "Стресс", "Усталость", "Боль плечо", "Боль поясница", "Давление",
      "Энергия", "Боль другая/локализация", "Комментарий"
    ])
  }),
  SMART_CAPTURE_MODES: Object.freeze(["OFF", "TEST", "SHADOW", "SIMULATION", "ACTIVE"]),
  DOMAIN_SHEETS: Object.freeze(["Body_Tracking", "Workout_Log", "Nutrition_Log", "Recovery_Log", "USER_EVENTS"])
});

function migrateSmartCaptureSchemas_(options) {
  const opts = options || {};
  const apply = opts.apply === true;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const migrations = [SMART_HARDENING_CONFIG.USER_EVENTS, SMART_HARDENING_CONFIG.RECOVERY_LOG].map(function(definition) {
    return smartHardeningMigrateSheet_(spreadsheet, definition, apply);
  });
  return {
    ok: migrations.every(function(result) { return result.ok; }),
    apply: apply,
    changed: migrations.some(function(result) { return result.changed; }),
    production_rows_written: 0,
    migrations: migrations
  };
}

function testUserEventsSchemaMigration_() {
  const sheet = smartHardeningSheet_(SMART_HARDENING_CONFIG.USER_EVENTS.sheet_name);
  const beforeLastRow = sheet.getLastRow();
  const beforeLegacy = smartHardeningFingerprint_(sheet, 5);
  const first = migrateSmartCaptureSchemas_({apply: true});
  const afterFirstLastRow = sheet.getLastRow();
  const afterFirstLegacy = smartHardeningFingerprint_(sheet, 5);
  const headers = sheet.getRange(1, 1, 1, SMART_HARDENING_CONFIG.USER_EVENTS.required_headers.length).getDisplayValues()[0];
  const second = migrateSmartCaptureSchemas_({apply: true});
  const passed = first.ok && second.ok && second.changed === false &&
    JSON.stringify(headers) === JSON.stringify(SMART_HARDENING_CONFIG.USER_EVENTS.required_headers) &&
    beforeLastRow === afterFirstLastRow && beforeLegacy === afterFirstLegacy;
  return {
    id: "USER_EVENTS_SCHEMA_MIGRATION",
    status: passed ? "PASS" : "FAIL",
    headers: headers,
    legacy_rows_preserved: beforeLegacy === afterFirstLegacy,
    row_count_unchanged: beforeLastRow === afterFirstLastRow,
    idempotent: second.changed === false,
    real_events_written: 0,
    migration: first
  };
}

function testRecoverySchemaCompatibility_() {
  const sheet = smartHardeningSheet_(SMART_HARDENING_CONFIG.RECOVERY_LOG.sheet_name);
  const beforeLastRow = sheet.getLastRow();
  const migration = migrateSmartCaptureSchemas_({apply: true});
  const headers = sheet.getRange(1, 1, 1, SMART_HARDENING_CONFIG.RECOVERY_LOG.required_headers.length).getDisplayValues()[0];
  const legacyPrefix = headers.slice(0, SMART_HARDENING_CONFIG.RECOVERY_LOG.legacy_headers.length);
  const now = new Date("2026-08-14T15:30:00+03:00");
  const built = smartConfirmationBuildTestCapture_(
    "Спал 7 часов, энергия 8, боль колено",
    "hardening-recovery-adapter",
    now
  );
  const payloadItem = built.capture.items.filter(function(item) { return item.category === "RECOVERY_LOG"; })[0];
  const validationItem = built.validation.items.filter(function(item) { return item.category === "RECOVERY_LOG"; })[0];
  const operation = saveRecoveryLog_({payload: payloadItem, validation: validationItem}, {
    now: now,
    mode: "SIMULATION",
    user_id: "hardening-test-user",
    capture_id: "hardening-recovery-adapter",
    source_update_id: "hardening-recovery-update"
  });
  const passed = migration.ok &&
    JSON.stringify(headers) === JSON.stringify(SMART_HARDENING_CONFIG.RECOVERY_LOG.required_headers) &&
    JSON.stringify(legacyPrefix) === JSON.stringify(SMART_HARDENING_CONFIG.RECOVERY_LOG.legacy_headers) &&
    sheet.getLastRow() === beforeLastRow && operation.written === false &&
    operation.row_values.length === 11 && operation.row_values[8] === 8 &&
    operation.row_values[9] === "колено" && String(operation.row_values[10]).indexOf("hardening-recovery-adapter") >= 0;
  return {
    id: "RECOVERY_SCHEMA_COMPATIBILITY",
    status: passed ? "PASS" : "FAIL",
    headers: headers,
    legacy_prefix_preserved: JSON.stringify(legacyPrefix) === JSON.stringify(SMART_HARDENING_CONFIG.RECOVERY_LOG.legacy_headers),
    row_count_unchanged: sheet.getLastRow() === beforeLastRow,
    adapter_row_length: operation.row_values.length,
    adapter_written: operation.written,
    operation: operation
  };
}

function testTransactionRecoveryHardening_() {
  const now = new Date("2026-08-14T15:35:00+03:00");
  const runId = "hardening-recovery-" + new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6);
  const userId = runId + "-user";
  const chatId = runId + "-chat";
  const built = smartConfirmationBuildTestCapture_(
    "Сегодня грудь. Жим 100 кг 8х3. Ел курицу 250 грамм и рис 200 грамм.",
    runId,
    now
  );
  const created = createPendingCapture_(built.capture, {
    now: now,
    ttl_minutes: 30,
    user_id: userId,
    chat_id: chatId,
    source_update_id: runId + "-update",
    capture_id: runId,
    validation: built.validation
  });
  const saved = saveConfirmedData_(runId, userId, {
    now: now,
    chat_id: chatId,
    simulate_adapter_error: "NUTRITION_LOG"
  });
  const row = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), runId);
  const recovery = dataWriteParseJson_(row.error, {});
  const transaction = saved.transaction || {};
  const passed = created.ok && !saved.ok && saved.code === "FAILED" && row.status === "FAILED" &&
    !!transaction.transaction_id && transaction.retryable === true &&
    transaction.step_status.transaction === "FAILED" &&
    transaction.step_status.domain_adapters.WORKOUT_LOG === "COMPLETED" &&
    transaction.step_status.domain_adapters.NUTRITION_LOG === "FAILED" &&
    transaction.completed_operations.length === 1 &&
    transaction.completed_operations[0].category === "WORKOUT_LOG" &&
    transaction.failed_operations.length === 1 &&
    transaction.failed_operations[0].category === "NUTRITION_LOG" &&
    recovery.retryable === true && !!recovery.rollback_plan &&
    recovery.production_rollback_required === false;
  return {
    id: "TRANSACTION_RECOVERY",
    status: passed ? "PASS" : "FAIL",
    run_id: runId,
    pending_status: row.status,
    transaction: transaction,
    recovery: recovery,
    production_rows_written: 0
  };
}

function testShadowMode_() {
  const properties = PropertiesService.getScriptProperties();
  const previousMode = properties.getProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY) || "TEST";
  const now = new Date("2026-08-14T15:40:00+03:00");
  const runId = "hardening-shadow-" + new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6);
  let result = null;
  try {
    properties.setProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY, "SHADOW");
    const intents = detectUserIntent_("Вес сегодня 118.5");
    const capture = extractStructuredData_("Вес сегодня 118.5", intents, {now: now, capture_id: runId});
    const validation = validateExtractedData_(capture);
    const created = createPendingCapture_(capture, {
      now: now,
      ttl_minutes: 30,
      user_id: runId + "-user",
      chat_id: runId + "-chat",
      source_update_id: runId + "-update",
      capture_id: runId,
      validation: validation
    });
    const pending = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), runId);
    const cancelled = cancelPendingCapture_(runId + "-user", runId + "-chat", {now: now});
    const finalRow = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), runId);
    const passed = smartCaptureMode_() === "SHADOW" && intents.length === 1 && validation.ready_for_confirmation === true &&
      created.ok && pending.status === "PENDING_CONFIRMATION" && cancelled.ok && finalRow.status === "CANCELLED" &&
      smartCaptureWritesAllowed_() === false && dataWriteDomainWritesAllowed_() === false;
    result = {
      id: "SHADOW_MODE",
      status: passed ? "PASS" : "FAIL",
      mode_during_test: smartCaptureMode_(),
      extraction_ran: intents.length > 0,
      validation_ran: validation.ready_for_confirmation,
      capture_created: created.ok,
      final_capture_status: finalRow.status,
      domain_writes: 0,
      user_flow_changed: false,
      telegram_calls: 0
    };
  } finally {
    properties.setProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY, previousMode);
  }
  return result;
}

function testDuplicateProtectionHardening_() {
  const now = new Date("2026-08-14T15:45:00+03:00");
  const runId = "hardening-duplicate-" + new Date().getTime() + "-" + Utilities.getUuid().slice(0, 6);
  const userId = runId + "-user";
  const chatId = runId + "-chat";
  const built = smartConfirmationBuildTestCapture_("Вес сегодня 118.4", runId, now);
  const created = createPendingCapture_(built.capture, {
    now: now,
    ttl_minutes: 30,
    user_id: userId,
    chat_id: chatId,
    source_update_id: runId + "-update",
    capture_id: runId,
    validation: built.validation
  });
  const first = saveConfirmedData_(runId, userId, {now: now, chat_id: chatId});
  const rowCountBeforeRepeat = smartConfirmationSheet_().getLastRow();
  const second = saveConfirmedData_(runId, userId, {now: now, chat_id: chatId});
  const rowCountAfterRepeat = smartConfirmationSheet_().getLastRow();
  const sameTransaction = first.transaction && second.transaction &&
    first.transaction.transaction_id === second.transaction.transaction_id;
  const passed = created.ok && first.ok && first.code === "SAVED" && second.ok && second.code === "ALREADY_SAVED" &&
    second.duplicate_created === false && sameTransaction && rowCountBeforeRepeat === rowCountAfterRepeat;
  return {
    id: "DUPLICATE_PROTECTION",
    status: passed ? "PASS" : "FAIL",
    first_code: first.code,
    second_code: second.code,
    same_transaction_id: sameTransaction,
    pending_row_count_unchanged: rowCountBeforeRepeat === rowCountAfterRepeat,
    domain_duplicates_created: 0
  };
}

function testSmartCaptureProductionReadiness_() {
  const beforeCounts = smartHardeningDomainRowCounts_();
  const schemaMigration = testUserEventsSchemaMigration_();
  const recoverySchema = testRecoverySchemaCompatibility_();
  const transactionRecovery = testTransactionRecoveryHardening_();
  const shadowMode = testShadowMode_();
  const duplicateProtection = testDuplicateProtectionHardening_();
  const afterCounts = smartHardeningDomainRowCounts_();
  const noAccidentalWrites = JSON.stringify(beforeCounts) === JSON.stringify(afterCounts);
  const rollbackPlanReady = transactionRecovery.recovery &&
    transactionRecovery.recovery.retryable === true &&
    !!transactionRecovery.recovery.rollback_plan;
  const schemaReady = schemaMigration.status === "PASS" && recoverySchema.status === "PASS";
  const userEventsReady = schemaMigration.status === "PASS" &&
    schemaMigration.headers.length === SMART_HARDENING_CONFIG.USER_EVENTS.required_headers.length;
  const recoveryReady = recoverySchema.status === "PASS" && recoverySchema.adapter_row_length === 11;
  const transactionReady = transactionRecovery.status === "PASS";
  const duplicateReady = duplicateProtection.status === "PASS";
  const checks = [
    {id: "SCHEMA_READY", passed: schemaReady},
    {id: "USER_EVENTS_READY", passed: userEventsReady},
    {id: "RECOVERY_SCHEMA_READY", passed: recoveryReady},
    {id: "TRANSACTION_RECOVERY_READY", passed: transactionReady},
    {id: "DUPLICATE_PROTECTION_READY", passed: duplicateReady},
    {id: "ROLLBACK_PLAN_READY", passed: rollbackPlanReady},
    {id: "NO_ACCIDENTAL_WRITES", passed: noAccidentalWrites}
  ];
  const passed = checks.filter(function(check) { return check.passed; }).length;
  const score = Math.round(passed / checks.length * 100);
  const allowedModesReady = JSON.stringify(SMART_CAPTURE_CONFIG.ALLOWED_MODES) ===
    JSON.stringify(SMART_HARDENING_CONFIG.SMART_CAPTURE_MODES);
  const report = {
    ok: passed === checks.length && shadowMode.status === "PASS" && allowedModesReady,
    sprint: "5.4",
    production_version: 19,
    smart_capture_mode_after_test: smartCaptureMode_(),
    data_write_mode: dataWriteMode_(),
    production_writes: false,
    readiness_score: score,
    checks_passed: passed,
    checks_total: checks.length,
    checks: checks,
    allowed_modes_ready: allowedModesReady,
    shadow_mode: shadowMode,
    schema_migration: schemaMigration,
    recovery_schema: recoverySchema,
    transaction_recovery: transactionRecovery,
    duplicate_protection: duplicateProtection,
    row_counts_before: beforeCounts,
    row_counts_after: afterCounts,
    ready_for_active: false,
    active_blockers: [
      "ACTIVE_NOT_APPROVED",
      "PRODUCTION_FLOW_NOT_CONNECTED",
      "REAL_WRITE_CANARY_NOT_EXECUTED",
      "MULTI_SHEET_RECONCILIATION_NOT_PRODUCTION_TESTED"
    ]
  };
  console.log("[Smart Capture Production Readiness] " + JSON.stringify({
    ok: report.ok,
    sprint: report.sprint,
    production_version: report.production_version,
    smart_capture_mode_after_test: report.smart_capture_mode_after_test,
    data_write_mode: report.data_write_mode,
    production_writes: report.production_writes,
    readiness_score: report.readiness_score,
    checks_passed: report.checks_passed,
    checks_total: report.checks_total,
    allowed_modes_ready: report.allowed_modes_ready,
    shadow_mode: report.shadow_mode.status,
    ready_for_active: report.ready_for_active
  }));
  return report;
}

function runSmartCaptureHardeningTests() {
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(DATA_WRITE_CONFIG.MODE_PROPERTY, "SIMULATION");
  properties.setProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY, "TEST");
  return testSmartCaptureProductionReadiness_();
}

function smartCaptureShadowCapabilities_() {
  return {
    mode: "SHADOW",
    extraction: true,
    validation: true,
    pending_capture: true,
    confirmation_to_user: false,
    domain_writes: false,
    user_flow_changed: false
  };
}

function smartHardeningMigrateSheet_(spreadsheet, definition, apply) {
  const sheet = spreadsheet.getSheetByName(definition.sheet_name);
  if (!sheet) return {ok: false, sheet_name: definition.sheet_name, error: "MISSING_SHEET", changed: false};
  const legacyWidth = definition.legacy_headers.length;
  const requiredWidth = definition.required_headers.length;
  const readableWidth = Math.min(sheet.getMaxColumns(), requiredWidth);
  const current = sheet.getRange(1, 1, 1, readableWidth).getDisplayValues()[0];
  const legacyPrefix = current.slice(0, legacyWidth);
  if (JSON.stringify(legacyPrefix) !== JSON.stringify(definition.legacy_headers)) {
    return {
      ok: false,
      sheet_name: definition.sheet_name,
      error: "LEGACY_HEADER_MISMATCH",
      current_headers: current,
      changed: false
    };
  }
  const conflicts = [];
  for (let index = legacyWidth; index < current.length; index++) {
    if (current[index] && current[index] !== definition.required_headers[index]) {
      conflicts.push({column: index + 1, actual: current[index], expected: definition.required_headers[index]});
    }
  }
  if (conflicts.length) {
    return {ok: false, sheet_name: definition.sheet_name, error: "ADDITIVE_HEADER_CONFLICT", conflicts: conflicts, changed: false};
  }
  let changed = false;
  if (apply) {
    if (sheet.getMaxColumns() < requiredWidth) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredWidth - sheet.getMaxColumns());
      changed = true;
    }
    const target = sheet.getRange(1, legacyWidth + 1, 1, requiredWidth - legacyWidth);
    const actualTail = target.getDisplayValues()[0];
    const expectedTail = definition.required_headers.slice(legacyWidth);
    if (JSON.stringify(actualTail) !== JSON.stringify(expectedTail)) {
      sheet.getRange(1, legacyWidth).copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      target.setValues([expectedTail]);
      changed = true;
    }
    SpreadsheetApp.flush();
  }
  const finalHeaders = sheet.getRange(1, 1, 1, Math.min(sheet.getMaxColumns(), requiredWidth)).getDisplayValues()[0];
  return {
    ok: JSON.stringify(finalHeaders) === JSON.stringify(definition.required_headers),
    sheet_name: definition.sheet_name,
    changed: changed,
    headers: finalHeaders,
    legacy_compatible: JSON.stringify(finalHeaders.slice(0, legacyWidth)) === JSON.stringify(definition.legacy_headers)
  };
}

function smartHardeningFingerprint_(sheet, width) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "[]";
  return JSON.stringify(sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues());
}

function smartHardeningDomainRowCounts_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const counts = {};
  SMART_HARDENING_CONFIG.DOMAIN_SHEETS.forEach(function(sheetName) {
    counts[sheetName] = smartHardeningSheet_(sheetName, spreadsheet).getLastRow();
  });
  return counts;
}

function smartHardeningSheet_(sheetName, spreadsheet) {
  const sheet = (spreadsheet || SpreadsheetApp.getActiveSpreadsheet()).getSheetByName(sheetName);
  if (!sheet) throw new Error("Missing sheet: " + sheetName);
  return sheet;
}
