/**
 * C-07 — Staging Preflight Check.
 *
 * Read-only validation that verifies all staging requirements before the first
 * live smoke test. Returns a detailed report with PASS/FAIL status for each check.
 *
 * Safety: Zero writes, zero Telegram, zero Groq.
 * Repository reads are allowed and counted (logical reads).
 */
const STAGING_PREFLIGHT_C07_CONFIG = Object.freeze({
  REQUIRED_SHEETS: Object.freeze(["PENDING_CAPTURES", "User_Profile", "Body_Tracking", "Recovery_Log"]),
  REQUIRED_ENVIRONMENT: "STAGING",
  REQUIRED_SAVE_MODE: "SIMULATION",
  DEFAULT_ENVIRONMENT: "PRODUCTION"
});

function runStagingPreflightC07_(options) {
  const deps = resolveStagingPreflightDependenciesC07_(options);
  const now = deps.now instanceof Date ? deps.now : new Date();
  const results = [];
  let sheetReadsCount = 0;

  // ============================================================
  // 1. Environment Check
  // ============================================================
  let env = "";
  try {
    env = deps.getProperty("DEPLOYMENT_ENV") || "";
  } catch (error) {
    env = "";
  }
  const envNormalized = String(env).trim().toUpperCase();
  const envOk = envNormalized === STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_ENVIRONMENT;
  results.push({
    id: "ENVIRONMENT",
    status: envOk ? "PASS" : "FAIL",
    expected: STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_ENVIRONMENT,
    actual: envNormalized || "(missing)",
    message: envOk ? "Environment is STAGING" : "Environment must be STAGING, default is PRODUCTION"
  });

  // ============================================================
  // 2. Collection Pipeline Enabled
  // ============================================================
  let pipelineEnabled = false;
  try {
    const value = deps.getProperty("COLLECTION_PIPELINE_ENABLED") || "";
    pipelineEnabled = String(value).trim().toLowerCase() === "true";
  } catch (error) {
    pipelineEnabled = false;
  }
  results.push({
    id: "PIPELINE_ENABLED",
    status: pipelineEnabled ? "PASS" : "FAIL",
    expected: "true",
    actual: String(pipelineEnabled),
    message: pipelineEnabled ? "Collection pipeline enabled" : "Pipeline must be explicitly enabled"
  });

  // ============================================================
  // 3. Save Mode Check
  // ============================================================
  let saveMode = "";
  try {
    saveMode = deps.resolveSaveMode() || "";
  } catch (error) {
    saveMode = "OFF";
  }
  const saveModeNormalized = String(saveMode).trim().toUpperCase();
  const saveModeOk = saveModeNormalized === STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_SAVE_MODE;
  results.push({
    id: "SAVE_MODE",
    status: saveModeOk ? "PASS" : "FAIL",
    expected: STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_SAVE_MODE,
    actual: saveModeNormalized || "(missing)",
    message: saveModeOk ? "Save mode is SIMULATION" : "Save mode must be SIMULATION"
  });

  // ============================================================
  // 4. Write-Block Diagnostics (explicit, no inversion)
  // ============================================================
  let activeWritesAllowed = false;
  let canaryWritesAllowed = false;
  try {
    activeWritesAllowed = deps.resolveActiveWritesAllowed() === true;
  } catch (error) {
    activeWritesAllowed = false;
  }
  try {
    canaryWritesAllowed = deps.resolveCanaryWritesAllowed() === true;
  } catch (error) {
    canaryWritesAllowed = false;
  }
  const activeBlocked = activeWritesAllowed === false;
  const canaryBlocked = canaryWritesAllowed === false;
  results.push({
    id: "ACTIVE_WRITES",
    status: activeBlocked ? "PASS" : "FAIL",
    expected: "BLOCKED",
    actual: activeWritesAllowed ? "ALLOWED" : "BLOCKED",
    message: activeBlocked ? "ACTIVE writes blocked" : "ACTIVE writes must be blocked"
  });
  results.push({
    id: "CANARY_WRITES",
    status: canaryBlocked ? "PASS" : "FAIL",
    expected: "BLOCKED",
    actual: canaryWritesAllowed ? "ALLOWED" : "BLOCKED",
    message: canaryBlocked ? "CANARY writes blocked" : "CANARY writes must be blocked"
  });

  // ============================================================
  // 5. Spreadsheet ID Present
  // ============================================================
  let stagingSpreadsheetId = "";
  try {
    stagingSpreadsheetId = deps.getProperty("COLLECTION_SPREADSHEET_ID") || "";
  } catch (error) {
    stagingSpreadsheetId = "";
  }
  const idPresent = String(stagingSpreadsheetId).trim().length > 0;
  results.push({
    id: "SPREADSHEET_ID_PRESENT",
    status: idPresent ? "PASS" : "FAIL",
    expected: "Valid spreadsheet ID",
    actual: idPresent ? stagingSpreadsheetId.slice(0, 10) + "..." : "(missing)",
    message: idPresent ? "Spreadsheet ID configured" : "COLLECTION_SPREADSHEET_ID required"
  });

  // ============================================================
  // 6. Production Isolation Check
  // ============================================================
  let legacyProductionId = "";
  try {
    legacyProductionId = deps.getProperty("SPREADSHEET_ID") || "";
  } catch (error) {
    legacyProductionId = "";
  }
  const legacyPresent = String(legacyProductionId).trim().length > 0;
  const sameAsProduction = legacyPresent && String(legacyProductionId).trim() === String(stagingSpreadsheetId).trim();
  let isolationOk = false;
  let isolationStatus = "";
  let isolationMessage = "";

  if (!idPresent) {
    isolationOk = false;
    isolationStatus = "NO_STAGING_ID";
    isolationMessage = "Staging spreadsheet ID not configured";
  } else if (!legacyPresent) {
    // Ambiguous: we can't prove it's NOT production
    isolationOk = false;
    isolationStatus = "AMBIUGOUS_ISOLATION";
    isolationMessage = "Legacy SPREADSHEET_ID not found; cannot prove staging is not production";
  } else if (sameAsProduction) {
    isolationOk = false;
    isolationStatus = "STAGING_PRODUCTION_CONFLICT";
    isolationMessage = "Staging spreadsheet ID matches production SPREADSHEET_ID";
  } else {
    isolationOk = true;
    isolationStatus = "ISOLATED";
    isolationMessage = "Staging spreadsheet differs from production";
  }

  results.push({
    id: "PRODUCTION_ISOLATION",
    status: isolationOk ? "PASS" : "FAIL",
    expected: "Staging != Production",
    actual: isolationStatus,
    message: isolationMessage
  });

  // ============================================================
  // 7. Spreadsheet Accessible
  // ============================================================
  let spreadsheetAccessible = false;
  let spreadsheetName = "";
  let requiredSheetsPresent = false;
  let headersValid = false;

  if (idPresent && isolationOk) {
    try {
      const repository = deps.createRepository({
        spreadsheet_id: stagingSpreadsheetId,
        provider: deps.createProvider()
      });

      // Read PENDING_CAPTURES
      const pendingSnapshot = repository.readSheet("PENDING_CAPTURES", { metadata_only: true });
      sheetReadsCount += 1;
      if (pendingSnapshot && pendingSnapshot.exists) {
        spreadsheetAccessible = true;
        spreadsheetName = pendingSnapshot.name || "PENDING_CAPTURES";
      }

      // Check required sheets
      const requiredSheets = STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_SHEETS;
      const sheetChecks = requiredSheets.map(function(name) {
        const snapshot = repository.readSheet(name, { metadata_only: true });
        sheetReadsCount += 1;
        return { name: name, exists: snapshot && snapshot.exists };
      });
      requiredSheetsPresent = sheetChecks.every(function(check) { return check.exists; });

      // Check headers for each required sheet
      if (requiredSheetsPresent) {
        // PENDING_CAPTURES headers
        const fullSnapshot = repository.readSheet("PENDING_CAPTURES", {
          column_count: deps.getPendingCapturesHeaders().length,
          minimum_rows: 1
        });
        sheetReadsCount += 1;
        if (fullSnapshot && fullSnapshot.values && fullSnapshot.values.length > 0) {
          const actualHeaders = fullSnapshot.values[0];
          const expectedHeaders = deps.getPendingCapturesHeaders();
          headersValid = expectedHeaders.every(function(header, index) {
            return actualHeaders && actualHeaders[index] === header;
          });
        }

        // User_Profile headers
        if (headersValid) {
          const profileSnapshot = repository.readSheet("User_Profile", {
            column_count: deps.getUserProfileHeaders().length,
            minimum_rows: 1
          });
          sheetReadsCount += 1;
          if (profileSnapshot && profileSnapshot.values && profileSnapshot.values.length > 0) {
            const actual = profileSnapshot.values[0];
            const expected = deps.getUserProfileHeaders();
            const profileHeadersValid = expected.every(function(header, index) {
              return actual && actual[index] === header;
            });
            if (!profileHeadersValid) headersValid = false;
          }
        }

        // Body_Tracking headers
        if (headersValid) {
          const bodySnapshot = repository.readSheet("Body_Tracking", {
            column_count: deps.getBodyTrackingHeaders().length,
            minimum_rows: 1
          });
          sheetReadsCount += 1;
          if (bodySnapshot && bodySnapshot.values && bodySnapshot.values.length > 0) {
            const actual = bodySnapshot.values[0];
            const expected = deps.getBodyTrackingHeaders();
            const bodyHeadersValid = expected.every(function(header, index) {
              return actual && actual[index] === header;
            });
            if (!bodyHeadersValid) headersValid = false;
          }
        }

        // Recovery_Log headers
        if (headersValid) {
          const recoverySnapshot = repository.readSheet("Recovery_Log", {
            column_count: deps.getRecoveryLogHeaders().length,
            minimum_rows: 1
          });
          sheetReadsCount += 1;
          if (recoverySnapshot && recoverySnapshot.values && recoverySnapshot.values.length > 0) {
            const actual = recoverySnapshot.values[0];
            const expected = deps.getRecoveryLogHeaders();
            const recoveryHeadersValid = expected.every(function(header, index) {
              return actual && actual[index] === header;
            });
            if (!recoveryHeadersValid) headersValid = false;
          }
        }
      }
    } catch (error) {
      spreadsheetAccessible = false;
    }
  }

  results.push({
    id: "SPREADSHEET_ACCESSIBLE",
    status: spreadsheetAccessible ? "PASS" : "FAIL",
    expected: "Spreadsheet accessible",
    actual: spreadsheetAccessible ? spreadsheetName : "Not accessible",
    message: spreadsheetAccessible ? "Spreadsheet accessible" : "Cannot open spreadsheet"
  });

  results.push({
    id: "REQUIRED_SHEETS",
    status: requiredSheetsPresent ? "PASS" : "FAIL",
    expected: STAGING_PREFLIGHT_C07_CONFIG.REQUIRED_SHEETS.join(", "),
    actual: requiredSheetsPresent ? "All present" : "Missing required sheets",
    message: requiredSheetsPresent ? "Required sheets present" : "Required sheets missing"
  });

  results.push({
    id: "HEADERS_VALID",
    status: headersValid ? "PASS" : "FAIL",
    expected: "Correct headers for required sheets",
    actual: headersValid ? "Valid" : "Invalid",
    message: headersValid ? "All headers valid" : "Header mismatch detected"
  });

  // ============================================================
  // 8. Telegram Token Present (not logged)
  // ============================================================
  let telegramTokenPresent = false;
  try {
    const token = deps.getProperty("TELEGRAM_TOKEN") || "";
    telegramTokenPresent = String(token).trim().length > 0;
  } catch (error) {
    telegramTokenPresent = false;
  }
  results.push({
    id: "TELEGRAM_TOKEN",
    status: telegramTokenPresent ? "PASS" : "FAIL",
    expected: "Configured",
    actual: telegramTokenPresent ? "Present" : "Missing",
    message: telegramTokenPresent ? "Telegram token configured" : "TELEGRAM_TOKEN required",
    sensitive: true
  });

  // ============================================================
  // 9. Callback Acknowledgement Available
  // ============================================================
  const callbackAck = deps.resolveCallbackAck();
  const callbackAvailable = callbackAck !== null && typeof callbackAck === "function";
  results.push({
    id: "CALLBACK_AVAILABLE",
    status: callbackAvailable ? "PASS" : "FAIL",
    expected: "answerTelegramCallbackQuery_ function",
    actual: callbackAvailable ? "Available" : "Not found",
    message: callbackAvailable ? "Callback ack available" : "answerTelegramCallbackQuery_ missing"
  });

  // ============================================================
  // 10. Recovery Dependencies Present — FIXED: call resolvers
  // ============================================================
  const buildReadiness = deps.resolveBuildReadiness();
  const present = deps.resolvePresent();
  const processResponse = deps.resolveProcessResponse();
  const createPending = deps.resolveCreatePending();
  const processConfirmation = deps.resolveProcessConfirmation();
  const saveConfirmed = deps.resolveSaveConfirmed();
  const validateCapture = deps.resolveValidateCapture();

  const depsAvailable = (
    buildReadiness !== null && typeof buildReadiness === "function" &&
    present !== null && typeof present === "function" &&
    processResponse !== null && typeof processResponse === "function" &&
    createPending !== null && typeof createPending === "function" &&
    processConfirmation !== null && typeof processConfirmation === "function" &&
    saveConfirmed !== null && typeof saveConfirmed === "function" &&
    validateCapture !== null && typeof validateCapture === "function"
  );
  results.push({
    id: "RECOVERY_DEPENDENCIES",
    status: depsAvailable ? "PASS" : "FAIL",
    expected: "All required functions",
    actual: depsAvailable ? "All present" : "Missing dependencies",
    message: depsAvailable ? "Recovery dependencies available" : "Required functions missing"
  });

  // ============================================================
  // Determine overall status
  // ============================================================
  const passed = results.filter(function(r) { return r.status === "PASS"; }).length;
  const total = results.length;
  const allPass = passed === total;

  const report = {
    ok: allPass,
    status: allPass ? "READY_FOR_STAGING" : "PREFLIGHT_FAILED",
    environment: envNormalized || "(missing)",
    pipeline_enabled: pipelineEnabled,
    save_mode: saveModeNormalized || "(missing)",
    active_writes_allowed: activeWritesAllowed,
    canary_writes_allowed: canaryWritesAllowed,
    staging_spreadsheet_id: idPresent ? stagingSpreadsheetId.slice(0, 10) + "..." : "(missing)",
    production_spreadsheet_id: legacyPresent ? legacyProductionId.slice(0, 10) + "..." : "(missing)",
    isolation_status: isolationStatus,
    spreadsheet_accessible: spreadsheetAccessible,
    required_sheets_present: requiredSheetsPresent,
    headers_valid: headersValid,
    repository_reads_count: sheetReadsCount,
    sheet_writes: 0,
    telegram_calls: 0,
    groq_calls: 0,
    total_checks: total,
    passed: passed,
    failed: total - passed,
    results: results,
    checked_at: now.toISOString()
  };

  console.log("[Staging Preflight] " + JSON.stringify({
    ok: report.ok,
    status: report.status,
    total_checks: report.total_checks,
    passed: report.passed,
    failed: report.failed,
    environment: report.environment,
    repository_reads: report.repository_reads_count,
    sheet_writes: report.sheet_writes,
    isolation: report.isolation_status
  }));

  return report;
}

/**
 * Resolve dependencies for staging preflight with injection support.
 */
function resolveStagingPreflightDependenciesC07_(options) {
  const config = options || {};
  const injected = config.dependencies || config.harness || {};

  return {
    // Properties
    getProperty: function(name) {
      if (injected.getProperty) return injected.getProperty(name);
      try {
        return PropertiesService.getScriptProperties().getProperty(name) || "";
      } catch (error) {
        return "";
      }
    },

    // Save mode
    resolveSaveMode: function() {
      if (injected.resolveSaveMode) return injected.resolveSaveMode();
      try {
        return dataWriteMode_();
      } catch (error) {
        return "OFF";
      }
    },

    // Active writes
    resolveActiveWritesAllowed: function() {
      if (injected.resolveActiveWritesAllowed) return injected.resolveActiveWritesAllowed();
      try {
        return dataWriteDomainWritesAllowed_() === true;
      } catch (error) {
        return false;
      }
    },

    // Canary writes
    resolveCanaryWritesAllowed: function() {
      if (injected.resolveCanaryWritesAllowed) return injected.resolveCanaryWritesAllowed();
      try {
        return dataWriteCanaryWritesAllowed_() === true;
      } catch (error) {
        return false;
      }
    },

    // Repository
    createRepository: function(context) {
      if (injected.createRepository) return injected.createRepository(context);
      return createSpreadsheetRepositoryTest_(context);
    },

    // Provider
    createProvider: function() {
      if (injected.createProvider) return injected.createProvider();
      return createAppsScriptSpreadsheetProviderTest_();
    },

    // Header contracts
    getPendingCapturesHeaders: function() {
      return SMART_CONFIRMATION_CONFIG.HEADERS;
    },
    getUserProfileHeaders: function() {
      return DIGITAL_TWIN_TEST_CONFIG.HEADERS.User_Profile;
    },
    getBodyTrackingHeaders: function() {
      return DIGITAL_TWIN_TEST_CONFIG.HEADERS.Body_Tracking;
    },
    getRecoveryLogHeaders: function() {
      return DIGITAL_TWIN_TEST_CONFIG.HEADERS.Recovery_Log;
    },

    // Callback ack — FIXED: call resolver and return function or null
    resolveCallbackAck: function() {
      if (injected.resolveCallbackAck) {
        const result = injected.resolveCallbackAck();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof answerTelegramCallbackQuery_ === "function") {
        return answerTelegramCallbackQuery_;
      }
      return null;
    },

    // Recovery dependencies — FIXED: call resolvers and return functions or null
    resolveBuildReadiness: function() {
      if (injected.resolveBuildReadiness) {
        const result = injected.resolveBuildReadiness();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof buildDataReadinessReportS63Test_ === "function") {
        return buildDataReadinessReportS63Test_;
      }
      return null;
    },
    resolvePresent: function() {
      if (injected.resolvePresent) {
        const result = injected.resolvePresent();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof presentDataCollectionEventS65Test_ === "function") {
        return presentDataCollectionEventS65Test_;
      }
      return null;
    },
    resolveProcessResponse: function() {
      if (injected.resolveProcessResponse) {
        const result = injected.resolveProcessResponse();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof processDataCollectionResponseS65Test_ === "function") {
        return processDataCollectionResponseS65Test_;
      }
      return null;
    },
    resolveCreatePending: function() {
      if (injected.resolveCreatePending) {
        const result = injected.resolveCreatePending();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof createPendingCapture_ === "function") {
        return createPendingCapture_;
      }
      return null;
    },
    resolveProcessConfirmation: function() {
      if (injected.resolveProcessConfirmation) {
        const result = injected.resolveProcessConfirmation();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof processConfirmationTest_ === "function") {
        return processConfirmationTest_;
      }
      return null;
    },
    resolveSaveConfirmed: function() {
      if (injected.resolveSaveConfirmed) {
        const result = injected.resolveSaveConfirmed();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof saveConfirmedData_ === "function") {
        return saveConfirmedData_;
      }
      return null;
    },
    resolveValidateCapture: function() {
      if (injected.resolveValidateCapture) {
        const result = injected.resolveValidateCapture();
        return result !== null && typeof result === "function" ? result : null;
      }
      if (typeof validateExtractedData_ === "function") {
        return validateExtractedData_;
      }
      return null;
    },

    // Time
    now: config.now instanceof Date ? config.now : new Date()
  };
}

/**
 * Public runner for C-07 staging preflight.
 */
function runStagingPreflightC07() {
  return runStagingPreflightC07_({});
}
