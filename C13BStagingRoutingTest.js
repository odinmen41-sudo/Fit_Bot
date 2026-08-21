/** C-13B safe Apps Script/in-memory regression suite. */
function testC13BStagingRouting_() {
  const tests = [];

  function record(id, passed, details) {
    tests.push({
      id: id,
      status: passed ? "PASS" : "FAIL",
      details: details == null ? null : details
    });
  }

  function properties(values) {
    return {
      getProperty: function(key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      setProperty: function(key, value) {
        values[key] = String(value);
        return this;
      }
    };
  }

  const stagingSpreadsheet = {id: "staging-sheet"};
  let openedId = "";
  let activeCalls = 0;
  const stagingResolved = getSpreadsheet_({
    properties: properties({
      DEPLOYMENT_ENV: "STAGING",
      COLLECTION_SPREADSHEET_ID: "staging-sheet"
    }),
    spreadsheet_app: {
      openById: function(id) {
        openedId = id;
        return stagingSpreadsheet;
      },
      getActiveSpreadsheet: function() {
        activeCalls += 1;
        return {id: "active-sheet"};
      }
    }
  });
  record("C13B-01_STAGING_USES_COLLECTION_SPREADSHEET_ID",
    stagingResolved === stagingSpreadsheet && openedId === "staging-sheet" && activeCalls === 0,
    {opened_id: openedId, active_calls: activeCalls});

  const productionSpreadsheet = {id: "production-bound-sheet"};
  let productionOpenCalls = 0;
  const productionResolved = getSpreadsheet_({
    properties: properties({DEPLOYMENT_ENV: "PRODUCTION"}),
    spreadsheet_app: {
      openById: function() {
        productionOpenCalls += 1;
        return null;
      },
      getActiveSpreadsheet: function() {
        return productionSpreadsheet;
      }
    }
  });
  record("C13B-02_PRODUCTION_RESOLVER_UNCHANGED",
    productionResolved === productionSpreadsheet && productionOpenCalls === 0,
    {open_by_id_calls: productionOpenCalls});

  let missingConfigError = "";
  let missingConfigActiveCalls = 0;
  try {
    getSpreadsheet_({
      properties: properties({DEPLOYMENT_ENV: "STAGING"}),
      spreadsheet_app: {
        openById: function() { return null; },
        getActiveSpreadsheet: function() {
          missingConfigActiveCalls += 1;
          return productionSpreadsheet;
        }
      }
    });
  } catch (error) {
    missingConfigError = String(error && error.message || error);
  }
  record("C13B-03_MISSING_STAGING_CONFIG_FAILS_CLOSED",
    missingConfigError === "STAGING: COLLECTION_SPREADSHEET_ID is not configured" &&
      missingConfigActiveCalls === 0,
    {error: missingConfigError, active_calls: missingConfigActiveCalls});

  const diagnosticProperties = {
    DEPLOYMENT_ENV: "STAGING",
    COLLECTION_SPREADSHEET_ID: "staging-sheet"
  };
  const missingBotInputRow = appendBotInput_([
    new Date("2026-08-22T01:01:33+03:00"),
    "c13b-user",
    "Telegram @tester",
    "/recovery",
    "Сообщение",
    "В обработке"
  ], {
    properties: properties(diagnosticProperties),
    spreadsheet_app: {
      openById: function() {
        return {getSheetByName: function() { return null; }};
      }
    }
  });
  const durableDiagnostics = JSON.parse(
    diagnosticProperties[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY] || "[]"
  );
  const durableDiagnostic = durableDiagnostics[0] || {};
  record("C13B-04_MISSING_BOT_INPUT_IS_NON_BLOCKING",
    missingBotInputRow === 0,
    {row_number: missingBotInputRow});
  record("C13B-05_BOT_INPUT_FAILURE_IS_DURABLE",
    durableDiagnostics.length === 1 &&
      durableDiagnostic.error.indexOf('Sheet "Bot_Input" not found') >= 0 &&
      durableDiagnostic.data_type === "Сообщение" &&
      durableDiagnostic.status === "В обработке" &&
      durableDiagnostic.message_length === 9 &&
      durableDiagnostic.user_id === undefined &&
      durableDiagnostic.source === undefined &&
      diagnosticProperties[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY].indexOf("c13b-user") < 0 &&
      diagnosticProperties[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY].indexOf("@tester") < 0 &&
      diagnosticProperties[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY].indexOf("/recovery") < 0,
    durableDiagnostic);

  const boundedValues = {
      DEPLOYMENT_ENV: "STAGING",
      COLLECTION_SPREADSHEET_ID: "staging-sheet"
  };
  for (let diagnosticIndex = 0;
    diagnosticIndex < CONFIG.MAX_BOT_INPUT_DIAGNOSTICS + 3;
    diagnosticIndex += 1) {
    recordBotInputDiagnostic_([null, "user-" + diagnosticIndex], new Error("failure-" + diagnosticIndex), {
      properties: properties(boundedValues)
    });
  }
  const boundedDiagnostics = JSON.parse(
    boundedValues[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY] || "[]"
  );
  record("C13B-06_DURABLE_DIAGNOSTICS_ARE_BOUNDED_AND_NON_RECURSIVE",
    boundedDiagnostics.length === CONFIG.MAX_BOT_INPUT_DIAGNOSTICS &&
      boundedDiagnostics[0].error.indexOf("Error: failure-3") === 0 &&
      boundedDiagnostics[boundedDiagnostics.length - 1].error.indexOf(
        "Error: failure-" + (CONFIG.MAX_BOT_INPUT_DIAGNOSTICS + 2)
      ) === 0,
    {diagnostic_count: boundedDiagnostics.length});

  let waitTimeoutReleaseCalls = 0;
  const waitTimeoutRow = appendBotInput_([null, null, null, "/start", "Сообщение", "В обработке"], {
    properties: properties({
      DEPLOYMENT_ENV: "STAGING",
      COLLECTION_SPREADSHEET_ID: "staging-sheet"
    }),
    spreadsheet_app: {
      openById: function() {
        return {getSheetByName: function() { return null; }};
      }
    },
    lock_service: {
      getScriptLock: function() {
        return {
          waitLock: function() { throw new Error("LOCK_TIMEOUT"); },
          releaseLock: function() { waitTimeoutReleaseCalls += 1; }
        };
      }
    }
  });
  record("C13B-07_WAIT_LOCK_TIMEOUT_IS_BEST_EFFORT",
    waitTimeoutRow === 0 && waitTimeoutReleaseCalls === 0,
    {row_number: waitTimeoutRow, release_calls: waitTimeoutReleaseCalls});

  let releaseFailureCalls = 0;
  const releaseFailureValues = {
    DEPLOYMENT_ENV: "STAGING",
    COLLECTION_SPREADSHEET_ID: "staging-sheet"
  };
  const releaseFailureRow = appendBotInput_([null, null, null, "/recovery", "Сообщение", "В обработке"], {
    properties: properties(releaseFailureValues),
    spreadsheet_app: {
      openById: function() {
        return {getSheetByName: function() { return null; }};
      }
    },
    lock_service: {
      getScriptLock: function() {
        return {
          waitLock: function() {},
          releaseLock: function() {
            releaseFailureCalls += 1;
            throw new Error("RELEASE_FAILED");
          }
        };
      }
    }
  });
  record("C13B-08_RELEASE_LOCK_FAILURE_IS_BEST_EFFORT",
    releaseFailureRow === 0 && releaseFailureCalls === 1 &&
      JSON.parse(releaseFailureValues[CONFIG.BOT_INPUT_DIAGNOSTICS_PROPERTY] || "[]").length === 1,
    {row_number: releaseFailureRow, release_calls: releaseFailureCalls});

  let systemLoggingError = "";
  try {
    logSystem_("C13B_TEST", "Missing Bot_Input must not recurse or throw");
  } catch (error) {
    systemLoggingError = String(error && error.message || error);
  }
  record("C13B-09_SYSTEM_LOGGING_IS_NON_RECURSIVE",
    systemLoggingError === "",
    {error: systemLoggingError});

  const originals = {
    claimUpdate_: claimUpdate_,
    appendBotInput_: appendBotInput_,
    sendTelegramMessage_: sendTelegramMessage_,
    logAiReply_: logAiReply_,
    markBotInputProcessed_: markBotInputProcessed_,
    routeCollectionProductionBridge_: routeCollectionProductionBridge_,
    logSystem_: logSystem_
  };
  const sentMessages = [];
  const routedMessages = [];
  let routingWaitTimeoutReleaseCalls = 0;
  let routingReleaseFailureCalls = 0;

  try {
    claimUpdate_ = function() { return true; };
    appendBotInput_ = function(row) {
      const isStart = row[3] === "/start";
      return originals.appendBotInput_(row, {
        properties: properties({
          DEPLOYMENT_ENV: "STAGING",
          COLLECTION_SPREADSHEET_ID: "staging-sheet"
        }),
        spreadsheet_app: {
          openById: function() {
            return {getSheetByName: function() { return null; }};
          }
        },
        lock_service: {
          getScriptLock: function() {
            return {
              waitLock: function() {
                if (isStart) throw new Error("LOCK_TIMEOUT");
              },
              releaseLock: function() {
                if (isStart) {
                  routingWaitTimeoutReleaseCalls += 1;
                  return;
                }
                routingReleaseFailureCalls += 1;
                throw new Error("RELEASE_FAILED");
              }
            };
          }
        }
      });
    };
    sendTelegramMessage_ = function(chatId, text) {
      sentMessages.push({chat_id: chatId, text: text});
    };
    logAiReply_ = function() {};
    markBotInputProcessed_ = function() {};
    logSystem_ = function() {};
    routeCollectionProductionBridge_ = function(update) {
      routedMessages.push(update);
      return {handled: true, ok: true, code: "RECOVERY_REQUEST_PRESENTED"};
    };

    doPost({postData: {contents: JSON.stringify({
      update_id: "c13b-start",
      message: {
        text: "/start",
        from: {id: "c13b-user", username: "tester", is_bot: false},
        chat: {id: "c13b-chat"}
      }
    })}});
    record("C13B-10_START_ROUTING_SURVIVES_MISSING_BOT_INPUT",
      sentMessages.length === 1 && routedMessages.length === 0 &&
        routingWaitTimeoutReleaseCalls === 0,
      {telegram_calls: sentMessages.length, collection_calls: routedMessages.length,
        release_calls: routingWaitTimeoutReleaseCalls});

    doPost({postData: {contents: JSON.stringify({
      update_id: "c13b-recovery",
      message: {
        text: "/recovery",
        from: {id: "c13b-user", username: "tester", is_bot: false},
        chat: {id: "c13b-chat"}
      }
    })}});
    record("C13B-11_RECOVERY_REACHES_COLLECTION_ROUTE",
      routedMessages.length === 1 && routedMessages[0].message.text === "/recovery" &&
        routingReleaseFailureCalls === 1,
      {collection_calls: routedMessages.length, release_calls: routingReleaseFailureCalls});
  } finally {
    claimUpdate_ = originals.claimUpdate_;
    appendBotInput_ = originals.appendBotInput_;
    sendTelegramMessage_ = originals.sendTelegramMessage_;
    logAiReply_ = originals.logAiReply_;
    markBotInputProcessed_ = originals.markBotInputProcessed_;
    routeCollectionProductionBridge_ = originals.routeCollectionProductionBridge_;
    logSystem_ = originals.logSystem_;
  }

  const c06 = testCollectionProductionBridgeC06_();
  const simulationCheck = c06.tests.filter(function(test) {
    return test.id === "C06-15_SIMULATION_SAVE";
  })[0];
  const noWritesCheck = c06.tests.filter(function(test) {
    return test.id === "C06-21_REAL_SHEETS_IO_ZERO";
  })[0];
  record("C13B-12_SIMULATION_PREVENTS_DOMAIN_WRITES",
    c06.status === "PASS" && simulationCheck && simulationCheck.status === "PASS" &&
      noWritesCheck && noWritesCheck.status === "PASS",
    {c06_status: c06.status});

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    ok: passed === tests.length,
    suite: "C-13B_STAGING_ROUTING",
    tests: tests,
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    safety: {
      real_sheet_reads: 0,
      real_sheet_writes: 0,
      production_writes: 0,
      real_telegram_calls: 0,
      groq_calls: 0,
      deployment_changes: 0
    }
  };
}

function runC13BStagingRoutingTests() {
  return testC13BStagingRouting_();
}
