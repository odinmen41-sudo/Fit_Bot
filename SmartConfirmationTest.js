/**
 * Smart Data Capture — Confirmation & Event Layer (test-only).
 *
 * The module writes technical state only to PENDING_CAPTURES.
 * It never writes to Body_Tracking, Workout_Log, Nutrition_Log,
 * Recovery_Log, USER_EVENTS or AI_MEMORY.
 */
const SMART_CONFIRMATION_CONFIG = Object.freeze({
  SHEET_NAME: "PENDING_CAPTURES",
  DEFAULT_TTL_MINUTES: 30,
  TECHNICAL_WRITE_MODES: Object.freeze(["TEST", "SHADOW", "SIMULATION"]),
  STATUSES: Object.freeze({
    PENDING: "PENDING_CONFIRMATION",
    SAVING: "SAVING",
    SAVED: "SAVED",
    CANCELLED: "CANCELLED",
    EXPIRED: "EXPIRED",
    FAILED: "FAILED",
    SUPERSEDED: "SUPERSEDED"
  }),
  HEADERS: Object.freeze([
    "capture_id",
    "created_at",
    "expires_at",
    "user_id",
    "chat_id",
    "source_update_id",
    "raw_message",
    "payload_json",
    "validation_json",
    "status",
    "saved_targets_json",
    "confirmed_at",
    "error"
  ])
});

function createPendingCapture_(capture, metadata) {
  const meta = metadata || {};
  const now = meta.now instanceof Date ? meta.now : new Date();
  const ttlMinutes = Number(meta.ttl_minutes == null ? SMART_CONFIRMATION_CONFIG.DEFAULT_TTL_MINUTES : meta.ttl_minutes);
  const userId = String(meta.user_id == null ? "" : meta.user_id);
  const chatId = String(meta.chat_id == null ? "" : meta.chat_id);
  const captureId = String(meta.capture_id || (capture && capture.capture_id) || Utilities.getUuid());
  const validation = meta.validation || validateExtractedData_(capture);

  if (!smartConfirmationTechnicalWritesAllowed_()) {
    return smartConfirmationResult_(false, "TECHNICAL_WRITES_DISABLED", "Техническая запись разрешена только в TEST/SHADOW.");
  }
  if (!capture || !Array.isArray(capture.items) || !capture.items.length) {
    return smartConfirmationResult_(false, "INVALID_CAPTURE", "Capture не содержит извлечённых элементов.");
  }
  if (!validation.ready_for_confirmation) {
    return smartConfirmationResult_(false, "VALIDATION_FAILED", "Capture не прошёл валидацию.", {validation: validation});
  }
  if (!captureId || !userId || !chatId || !isFinite(ttlMinutes) || ttlMinutes <= 0) {
    return smartConfirmationResult_(false, "INVALID_METADATA", "Нужны capture_id, user_id, chat_id и положительный TTL.");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return smartConfirmationResult_(false, "LOCK_TIMEOUT", "Не удалось получить блокировку pending capture.");
  }
  try {
    const sheet = smartConfirmationSheet_();
    const existing = smartConfirmationFindByCaptureId_(sheet, captureId);
    if (existing) {
      return smartConfirmationResult_(true, "CAPTURE_ALREADY_EXISTS", "Capture уже существует.", {
        capture_id: captureId,
        status: existing.status,
        row_number: existing.row_number,
        created: false
      });
    }

    smartConfirmationSupersedeActive_(sheet, userId, chatId, "Superseded by a newer capture");
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
    const row = [
      smartConfirmationSafeCellText_(captureId),
      now,
      expiresAt,
      smartConfirmationSafeCellText_(userId),
      smartConfirmationSafeCellText_(chatId),
      smartConfirmationSafeCellText_(meta.source_update_id == null ? "" : meta.source_update_id),
      smartConfirmationSafeCellText_(capture.raw_message || ""),
      JSON.stringify(capture),
      JSON.stringify(validation),
      SMART_CONFIRMATION_CONFIG.STATUSES.PENDING,
      "[]",
      "",
      ""
    ];
    sheet.appendRow(row);
    SpreadsheetApp.flush();
    return smartConfirmationResult_(true, "CREATED", "Capture ожидает подтверждения.", {
      capture_id: captureId,
      status: SMART_CONFIRMATION_CONFIG.STATUSES.PENDING,
      row_number: sheet.getLastRow(),
      created: true,
      expires_at: expiresAt.toISOString(),
      production_writes: false
    });
  } finally {
    lock.releaseLock();
  }
}

function getPendingCapture_(userId, chatId, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const sheet = smartConfirmationSheet_();
  const rows = smartConfirmationReadRows_(sheet).filter(function(row) {
    return String(row.user_id) === String(userId) && String(row.chat_id) === String(chatId);
  });
  const active = rows.filter(function(row) {
    return row.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING && smartConfirmationDate_(row.expires_at).getTime() > now.getTime();
  });
  const expiredPending = rows.filter(function(row) {
    return row.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING && smartConfirmationDate_(row.expires_at).getTime() <= now.getTime();
  });

  if (active.length > 1) {
    return smartConfirmationResult_(false, "MULTIPLE_ACTIVE_CAPTURES", "Найдено более одного активного capture.", {
      active_count: active.length,
      captures: active
    });
  }
  if (active.length === 1) {
    return smartConfirmationResult_(true, "ACTIVE_CAPTURE_FOUND", "Активный capture найден.", {
      active_count: 1,
      capture: active[0]
    });
  }
  if (expiredPending.length) {
    return smartConfirmationResult_(false, "EXPIRED_CAPTURE", "Capture просрочен.", {
      active_count: 0,
      capture: expiredPending.sort(smartConfirmationNewestFirst_)[0]
    });
  }
  return smartConfirmationResult_(false, "NO_ACTIVE_CAPTURE", "Нет активных данных для подтверждения.", {
    active_count: 0
  });
}

function confirmPendingCapture_(userId, chatId, captureId, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  if (!smartConfirmationTechnicalWritesAllowed_()) {
    return smartConfirmationResult_(false, "TECHNICAL_WRITES_DISABLED", "Подтверждение недоступно вне TEST/SHADOW.");
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return smartConfirmationResult_(false, "LOCK_TIMEOUT", "Не удалось получить блокировку.");
  let selected = null;
  try {
    const sheet = smartConfirmationSheet_();
    if (captureId) {
      selected = smartConfirmationFindByCaptureId_(sheet, captureId);
    } else {
      const pending = getPendingCapture_(userId, chatId, {now: now});
      if (pending.ok) selected = pending.capture;
      else {
        const latestSaved = smartConfirmationReadRows_(sheet).filter(function(row) {
          return String(row.user_id) === String(userId) && String(row.chat_id) === String(chatId) &&
            row.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVED;
        }).sort(smartConfirmationNewestFirst_)[0];
        if (latestSaved) selected = latestSaved;
        else return smartConfirmationResult_(false, pending.code, pending.message);
      }
    }

    if (!selected) return smartConfirmationResult_(false, "NO_ACTIVE_CAPTURE", "Нет активных данных для подтверждения.");
    if (String(selected.user_id) !== String(userId) || String(selected.chat_id) !== String(chatId)) {
      return smartConfirmationResult_(false, "OWNER_MISMATCH", "Capture принадлежит другому пользователю или чату.");
    }
    if (selected.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVED) {
      return smartConfirmationResult_(true, "ALREADY_SAVED", "Этот capture уже был подтверждён; повторная запись не выполнена.", {
        capture_id: selected.capture_id,
        status: selected.status,
        duplicate_created: false,
        production_writes: false
      });
    }
    if (selected.status !== SMART_CONFIRMATION_CONFIG.STATUSES.PENDING) {
      return smartConfirmationResult_(false, "NOT_CONFIRMABLE", "Capture имеет статус " + selected.status + ".", {
        capture_id: selected.capture_id,
        status: selected.status
      });
    }
    if (smartConfirmationDate_(selected.expires_at).getTime() <= now.getTime()) {
      smartConfirmationUpdateState_(sheet, selected.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED, "[]", "", "TTL expired");
      return smartConfirmationResult_(false, "EXPIRED", "Срок подтверждения истёк.", {
        capture_id: selected.capture_id,
        status: SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED
      });
    }

    smartConfirmationUpdateStatus_(sheet, selected.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.SAVING);
    const payload = smartConfirmationParseJson_(selected.payload_json, {});
    const simulatedTargets = (payload.items || []).map(function(item) {
      return {
        category: item.category,
        target_sheet: smartConfirmationTargetSheet_(item.category),
        operation: "SIMULATED",
        written: false
      };
    });
    const savedTargets = {
      simulated: true,
      production_writes: false,
      confirmed_capture_id: selected.capture_id,
      targets: simulatedTargets
    };
    smartConfirmationUpdateState_(
      sheet,
      selected.row_number,
      SMART_CONFIRMATION_CONFIG.STATUSES.SAVED,
      JSON.stringify(savedTargets),
      now,
      ""
    );
    SpreadsheetApp.flush();
    return smartConfirmationResult_(true, "SAVED", "Подтверждение принято. Запись только симулирована.", {
      capture_id: selected.capture_id,
      status: SMART_CONFIRMATION_CONFIG.STATUSES.SAVED,
      saved_targets: savedTargets,
      duplicate_created: false,
      production_writes: false
    });
  } catch (error) {
    if (selected && selected.row_number) {
      try {
        smartConfirmationUpdateState_(
          smartConfirmationSheet_(),
          selected.row_number,
          SMART_CONFIRMATION_CONFIG.STATUSES.FAILED,
          "[]",
          "",
          String(error)
        );
      } catch (ignored) {}
    }
    return smartConfirmationResult_(false, "FAILED", "Ошибка test-only подтверждения.", {error: String(error)});
  } finally {
    lock.releaseLock();
  }
}

function cancelPendingCapture_(userId, chatId, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const pending = getPendingCapture_(userId, chatId, {now: now});
  if (!pending.ok) return smartConfirmationResult_(false, pending.code, pending.message);
  if (!smartConfirmationTechnicalWritesAllowed_()) {
    return smartConfirmationResult_(false, "TECHNICAL_WRITES_DISABLED", "Отмена недоступна вне TEST/SHADOW.");
  }
  const capture = pending.capture;
  smartConfirmationUpdateState_(
    smartConfirmationSheet_(),
    capture.row_number,
    SMART_CONFIRMATION_CONFIG.STATUSES.CANCELLED,
    "[]",
    "",
    ""
  );
  SpreadsheetApp.flush();
  return smartConfirmationResult_(true, "CANCELLED", "Запись отменена.", {
    capture_id: capture.capture_id,
    status: SMART_CONFIRMATION_CONFIG.STATUSES.CANCELLED,
    production_writes: false
  });
}

function expirePendingCaptures_(options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  if (!smartConfirmationTechnicalWritesAllowed_()) {
    return smartConfirmationResult_(false, "TECHNICAL_WRITES_DISABLED", "Expiration недоступен вне TEST/SHADOW.");
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return smartConfirmationResult_(false, "LOCK_TIMEOUT", "Не удалось получить блокировку.");
  try {
    const sheet = smartConfirmationSheet_();
    const expired = [];
    smartConfirmationReadRows_(sheet).forEach(function(row) {
      if (row.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING &&
          smartConfirmationDate_(row.expires_at).getTime() <= now.getTime()) {
        smartConfirmationUpdateState_(sheet, row.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED, "[]", "", "TTL expired");
        expired.push(row.capture_id);
      }
    });
    SpreadsheetApp.flush();
    return smartConfirmationResult_(true, "EXPIRED_PROCESSED", "Просроченные capture обработаны.", {
      expired_count: expired.length,
      expired_capture_ids: expired,
      production_writes: false
    });
  } finally {
    lock.releaseLock();
  }
}

function detectConfirmationIntent_(message) {
  const original = String(message || "").trim();
  const normalized = original.toLowerCase().replace(/ё/g, "е").replace(/[.!?]+$/g, "").trim();
  const hasCorrectionData = /\d+(?:[.,]\d+)?/.test(normalized) && /вес|жим|сон|энерг|куриц|рис|кг|грамм/.test(normalized);
  if (/^(нет|неверно|исправ)/.test(normalized) && hasCorrectionData) {
    return {intent: "CORRECTION", confidence: 0.99, source: "EXPLICIT_USER_INPUT", raw: original};
  }
  if (/^(да|записать|подтверждаю|подтвердить|сохранить)$/.test(normalized)) {
    return {intent: "CONFIRM", confidence: 0.99, source: "EXPLICIT_USER_INPUT", raw: original};
  }
  if (/^(нет|отмена|отменить|не записывать|не сохранять)$/.test(normalized)) {
    return {intent: "CANCEL", confidence: 0.99, source: "EXPLICIT_USER_INPUT", raw: original};
  }
  return {intent: "UNKNOWN", confidence: 0.30, source: "AI_EXTRACTION", raw: original};
}

function processConfirmationTest_(userId, chatId, message, options) {
  const opts = options || {};
  const now = opts.now instanceof Date ? opts.now : new Date();
  const intent = detectConfirmationIntent_(message);

  if (intent.intent === "CONFIRM") {
    const confirmed = confirmPendingCapture_(userId, chatId, opts.capture_id || "", {now: now});
    confirmed.confirmation_intent = intent;
    return confirmed;
  }
  if (intent.intent === "CANCEL") {
    const cancelled = cancelPendingCapture_(userId, chatId, {now: now});
    cancelled.confirmation_intent = intent;
    return cancelled;
  }
  if (intent.intent === "CORRECTION") {
    const pending = getPendingCapture_(userId, chatId, {now: now});
    if (!pending.ok) return smartConfirmationResult_(false, pending.code, pending.message, {confirmation_intent: intent});
    const oldCapture = pending.capture;
    smartConfirmationUpdateState_(
      smartConfirmationSheet_(),
      oldCapture.row_number,
      SMART_CONFIRMATION_CONFIG.STATUSES.SUPERSEDED,
      "[]",
      "",
      "Superseded by user correction"
    );
    const correctedMessage = smartConfirmationCorrectionMessage_(message);
    const intents = detectUserIntent_(correctedMessage);
    const correctedCapture = extractStructuredData_(correctedMessage, intents, {
      now: now,
      capture_id: oldCapture.capture_id + "-corrected"
    });
    const correctedValidation = validateExtractedData_(correctedCapture);
    const created = createPendingCapture_(correctedCapture, {
      now: now,
      ttl_minutes: opts.ttl_minutes || SMART_CONFIRMATION_CONFIG.DEFAULT_TTL_MINUTES,
      user_id: userId,
      chat_id: chatId,
      source_update_id: opts.source_update_id || "correction-test",
      capture_id: correctedCapture.capture_id,
      validation: correctedValidation
    });
    if (!created.ok) return created;
    return smartConfirmationResult_(true, "CORRECTION_PENDING", "Исправление принято и требует нового подтверждения.", {
      confirmation_intent: intent,
      old_capture_id: oldCapture.capture_id,
      old_status: SMART_CONFIRMATION_CONFIG.STATUSES.SUPERSEDED,
      new_capture_id: correctedCapture.capture_id,
      new_status: SMART_CONFIRMATION_CONFIG.STATUSES.PENDING,
      confirmation_message: buildConfirmationMessage_(correctedCapture, correctedValidation),
      production_writes: false
    });
  }
  return smartConfirmationResult_(false, "UNKNOWN_CONFIRMATION", "Ответ не распознан. Используйте «Да» или «Нет».", {
    confirmation_intent: intent,
    production_writes: false
  });
}

function testConfirmationFlow_() {
  const baseNow = new Date();
  const runId = "confirm-test-" + baseNow.getTime() + "-" + Utilities.getUuid().slice(0, 6);
  const results = [];
  const createdCaptureIds = [];

  function testResult(id, passed, details) {
    const result = {id: id, status: passed ? "PASS" : "FAIL", details: details || {}};
    results.push(result);
    console.log("[Confirmation Test " + results.length + "] " + JSON.stringify(result));
  }

  const user1 = runId + "-u1";
  const capture1 = smartConfirmationBuildTestCapture_(
    "Вес сегодня 118.7.\nСегодня грудь.\nЖим 100 кг 8х3.",
    runId + "-capture-1",
    baseNow
  );
  const created1 = createPendingCapture_(capture1.capture, {
    now: baseNow,
    ttl_minutes: 30,
    user_id: user1,
    chat_id: user1,
    source_update_id: runId + "-update-1",
    capture_id: capture1.capture.capture_id,
    validation: capture1.validation
  });
  createdCaptureIds.push(capture1.capture.capture_id);
  const confirmationMessage = buildConfirmationMessage_(capture1.capture, capture1.validation);
  testResult("CREATE_AND_CONFIRMATION_MESSAGE",
    created1.ok && created1.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING && confirmationMessage.indexOf("Записать?") >= 0,
    {create_code: created1.code, status: created1.status, confirmation_message: confirmationMessage}
  );

  const confirmed1 = processConfirmationTest_(user1, user1, "Да", {now: new Date(baseNow.getTime() + 1000)});
  const confirmedRow = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), capture1.capture.capture_id);
  const targets = smartConfirmationParseJson_(confirmedRow.saved_targets_json, {});
  testResult("CONFIRM_YES_SIMULATED_SAVE",
    confirmed1.ok && confirmed1.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVED &&
      confirmed1.production_writes === false && targets.production_writes === false &&
      (targets.targets || []).every(function(target) { return target.written === false; }),
    {code: confirmed1.code, status: confirmed1.status, saved_targets: targets}
  );

  const rowCountBeforeRepeat = smartConfirmationSheet_().getLastRow();
  const repeated = processConfirmationTest_(user1, user1, "Да", {
    now: new Date(baseNow.getTime() + 2000),
    capture_id: capture1.capture.capture_id
  });
  const rowCountAfterRepeat = smartConfirmationSheet_().getLastRow();
  testResult("REPEATED_YES_IDEMPOTENT",
    repeated.ok && repeated.code === "ALREADY_SAVED" && rowCountBeforeRepeat === rowCountAfterRepeat && repeated.duplicate_created === false,
    {code: repeated.code, rows_before: rowCountBeforeRepeat, rows_after: rowCountAfterRepeat, duplicate_created: repeated.duplicate_created}
  );

  const user2 = runId + "-u2";
  const capture2 = smartConfirmationBuildTestCapture_("Вес сегодня 118.6", runId + "-capture-2", baseNow);
  createPendingCapture_(capture2.capture, {
    now: baseNow, ttl_minutes: 30, user_id: user2, chat_id: user2,
    source_update_id: runId + "-update-2", capture_id: capture2.capture.capture_id, validation: capture2.validation
  });
  createdCaptureIds.push(capture2.capture.capture_id);
  const cancelled = processConfirmationTest_(user2, user2, "Нет", {now: new Date(baseNow.getTime() + 1000)});
  testResult("CANCEL_NO", cancelled.ok && cancelled.status === SMART_CONFIRMATION_CONFIG.STATUSES.CANCELLED,
    {code: cancelled.code, status: cancelled.status});

  const user3 = runId + "-u3";
  const capture3 = smartConfirmationBuildTestCapture_("Вес сегодня 118.5", runId + "-capture-3", baseNow);
  createPendingCapture_(capture3.capture, {
    now: baseNow, ttl_minutes: 1, user_id: user3, chat_id: user3,
    source_update_id: runId + "-update-3", capture_id: capture3.capture.capture_id, validation: capture3.validation
  });
  createdCaptureIds.push(capture3.capture.capture_id);
  const expiredResult = expirePendingCaptures_({now: new Date(baseNow.getTime() + 2 * 60 * 1000)});
  const expiredRow = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), capture3.capture.capture_id);
  testResult("EXPIRED_CAPTURE",
    expiredResult.ok && expiredRow.status === SMART_CONFIRMATION_CONFIG.STATUSES.EXPIRED,
    {code: expiredResult.code, status: expiredRow.status});

  const user4 = runId + "-u4";
  const noCapture = processConfirmationTest_(user4, user4, "Да", {now: baseNow});
  testResult("YES_WITHOUT_CAPTURE_SAFE",
    !noCapture.ok && noCapture.code === "NO_ACTIVE_CAPTURE",
    {code: noCapture.code, message: noCapture.message});

  const user5 = runId + "-u5";
  const capture5 = smartConfirmationBuildTestCapture_("Вес сегодня 118.7", runId + "-capture-5", baseNow);
  createPendingCapture_(capture5.capture, {
    now: baseNow, ttl_minutes: 30, user_id: user5, chat_id: user5,
    source_update_id: runId + "-update-5", capture_id: capture5.capture.capture_id, validation: capture5.validation
  });
  createdCaptureIds.push(capture5.capture.capture_id);
  const correction = processConfirmationTest_(user5, user5, "Нет, вес был 118.2", {
    now: new Date(baseNow.getTime() + 1000), source_update_id: runId + "-update-5-correction"
  });
  const oldCorrectedRow = smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), capture5.capture.capture_id);
  const newCorrectedRow = correction.new_capture_id ? smartConfirmationFindByCaptureId_(smartConfirmationSheet_(), correction.new_capture_id) : null;
  const newPayload = newCorrectedRow ? smartConfirmationParseJson_(newCorrectedRow.payload_json, {}) : {};
  const newWeightItem = (newPayload.items || []).filter(function(item) { return item.category === "BODY_TRACKING"; })[0];
  const newWeight = newWeightItem && newWeightItem.fields && newWeightItem.fields.weight ? newWeightItem.fields.weight.value : null;
  if (correction.new_capture_id) createdCaptureIds.push(correction.new_capture_id);
  testResult("CORRECTION_SUPERSEDES_AND_RECREATES",
    correction.ok && correction.code === "CORRECTION_PENDING" &&
      oldCorrectedRow.status === SMART_CONFIRMATION_CONFIG.STATUSES.SUPERSEDED &&
      newCorrectedRow && newCorrectedRow.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING &&
      Math.abs(Number(newWeight) - 118.2) < 0.0001,
    {code: correction.code, old_status: oldCorrectedRow.status, new_status: newCorrectedRow ? newCorrectedRow.status : null, new_weight: newWeight}
  );

  const passed = results.filter(function(result) { return result.status === "PASS"; }).length;
  const report = {
    ok: passed === results.length,
    smart_capture_mode: smartCaptureMode_(),
    production_writes_enabled: smartCaptureWritesAllowed_(),
    technical_pending_writes_enabled: smartConfirmationTechnicalWritesAllowed_(),
    pending_sheet: SMART_CONFIRMATION_CONFIG.SHEET_NAME,
    total_tests: results.length,
    passed: passed,
    failed: results.length - passed,
    created_capture_ids: createdCaptureIds,
    results: results
  };
  console.log("[Confirmation Summary] " + JSON.stringify({
    ok: report.ok,
    smart_capture_mode: report.smart_capture_mode,
    production_writes_enabled: report.production_writes_enabled,
    technical_pending_writes_enabled: report.technical_pending_writes_enabled,
    total_tests: report.total_tests,
    passed: report.passed,
    failed: report.failed
  }));
  return report;
}

// Public runner only; not connected to doPost or Telegram.
function runConfirmationFlowTests() {
  return testConfirmationFlow_();
}

function smartConfirmationTechnicalWritesAllowed_() {
  return SMART_CONFIRMATION_CONFIG.TECHNICAL_WRITE_MODES.indexOf(smartCaptureMode_()) >= 0 &&
    smartCaptureWritesAllowed_() === false;
}

function smartConfirmationSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SMART_CONFIRMATION_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Missing sheet: " + SMART_CONFIRMATION_CONFIG.SHEET_NAME);
  const actualHeaders = sheet.getRange(1, 1, 1, SMART_CONFIRMATION_CONFIG.HEADERS.length).getValues()[0].map(String);
  SMART_CONFIRMATION_CONFIG.HEADERS.forEach(function(header, index) {
    if (actualHeaders[index] !== header) throw new Error("Invalid PENDING_CAPTURES header at column " + (index + 1));
  });
  return sheet;
}

function smartConfirmationReadRows_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, SMART_CONFIRMATION_CONFIG.HEADERS.length).getValues().map(function(values, index) {
    const row = {row_number: index + 2};
    SMART_CONFIRMATION_CONFIG.HEADERS.forEach(function(header, column) { row[header] = values[column]; });
    return row;
  });
}

function smartConfirmationFindByCaptureId_(sheet, captureId) {
  return smartConfirmationReadRows_(sheet).filter(function(row) {
    return String(row.capture_id) === String(captureId);
  })[0] || null;
}

function smartConfirmationSupersedeActive_(sheet, userId, chatId, reason) {
  smartConfirmationReadRows_(sheet).forEach(function(row) {
    if (String(row.user_id) === String(userId) && String(row.chat_id) === String(chatId) &&
        row.status === SMART_CONFIRMATION_CONFIG.STATUSES.PENDING) {
      smartConfirmationUpdateState_(sheet, row.row_number, SMART_CONFIRMATION_CONFIG.STATUSES.SUPERSEDED, "[]", "", reason || "Superseded");
    }
  });
}

function smartConfirmationUpdateStatus_(sheet, rowNumber, status) {
  sheet.getRange(rowNumber, 10).setValue(status);
}

function smartConfirmationUpdateState_(sheet, rowNumber, status, savedTargetsJson, confirmedAt, error) {
  sheet.getRange(rowNumber, 10, 1, 4).setValues([[
    status,
    savedTargetsJson || "[]",
    confirmedAt || "",
    smartConfirmationSafeCellText_(error || "")
  ]]);
}

function smartConfirmationTargetSheet_(category) {
  const allowed = {
    BODY_TRACKING: "Body_Tracking",
    WORKOUT_LOG: "Workout_Log",
    NUTRITION_LOG: "Nutrition_Log",
    RECOVERY_LOG: "Recovery_Log"
  };
  return allowed[category] || "UNSUPPORTED";
}

function smartConfirmationCorrectionMessage_(message) {
  const text = String(message || "");
  const weight = text.match(/вес(?:\s+был[ао]?)?\s*[:=\-]?\s*(\d{2,3}(?:[.,]\d{1,2})?)/i);
  if (weight) return "Вес сегодня " + weight[1];
  return text.replace(/^\s*нет\s*[,;:]?\s*/i, "").trim();
}

function smartConfirmationBuildTestCapture_(message, captureId, now) {
  const intents = detectUserIntent_(message);
  const capture = extractStructuredData_(message, intents, {now: now, capture_id: captureId});
  const validation = validateExtractedData_(capture);
  return {capture: capture, validation: validation};
}

function smartConfirmationParseJson_(value, fallback) {
  try { return JSON.parse(String(value || "")); } catch (error) { return fallback; }
}

function smartConfirmationDate_(value) {
  return value instanceof Date ? value : new Date(value);
}

function smartConfirmationNewestFirst_(a, b) {
  return smartConfirmationDate_(b.created_at).getTime() - smartConfirmationDate_(a.created_at).getTime();
}

function smartConfirmationSafeCellText_(value) {
  const text = String(value == null ? "" : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function smartConfirmationResult_(ok, code, message, extra) {
  const result = {ok: ok, code: code, message: message};
  Object.keys(extra || {}).forEach(function(key) { result[key] = extra[key]; });
  return result;
}
