function runConfirmationOwnershipRegressionTests() {
  const tests = [], now = new Date("2026-08-30T12:00:00.000Z");
  function record(id, pass, details) { tests.push({id:id, status:pass ? "PASS" : "FAIL", details:pass ? {} : details || {}}); }
  function row(id, status, source, created, expires, user) {
    return {capture_id:id, user_id:user || "u1", chat_id:"c1", status:status,
      created_at:new Date(created), expires_at:new Date(expires),
      payload_json:JSON.stringify({source:source, capture_id:id})};
  }
  const pending = row("create-new", "PENDING_CONFIRMATION", "C231_DOMAIN_ROUTER",
    "2026-08-30T11:59:00.000Z", "2026-08-30T12:30:00.000Z");
  const savedVoid = row("void-old", "SAVED", C232D31_VOID_CAPTURE_SOURCE,
    "2026-08-30T11:00:00.000Z", "2026-08-30T12:30:00.000Z");
  const savedReplace = row("replace-old", "SAVED", C232D4_REPLACE_CAPTURE_SOURCE,
    "2026-08-30T11:10:00.000Z", "2026-08-30T12:30:00.000Z");
  const cancelled = row("cancelled", "CANCELLED", "C231_DOMAIN_ROUTER",
    "2026-08-30T11:50:00.000Z", "2026-08-30T12:30:00.000Z");
  const expired = row("expired", "PENDING_CONFIRMATION", "C231_DOMAIN_ROUTER",
    "2026-08-30T11:58:00.000Z", "2026-08-30T11:59:00.000Z");
  const foreign = row("foreign", "PENDING_CONFIRMATION", "C231_DOMAIN_ROUTER",
    "2026-08-30T11:59:30.000Z", "2026-08-30T12:30:00.000Z", "u2");
  let selected = selectActiveConfirmationCapture_([savedVoid, pending], "u1", "c1", now, "NONE");
  record("OWN-01_SAVED_VOID_CANNOT_STEAL_CONFIRM", selected.ok && selected.capture.capture_id === "create-new", selected);
  selected = selectActiveConfirmationCapture_([pending, savedVoid], "u1", "c1", now, "NONE");
  record("OWN-02_STORAGE_ORDER_IRRELEVANT", selected.ok && selected.capture.capture_id === "create-new", selected);
  selected = selectActiveConfirmationCapture_([savedVoid], "u1", "c1", now, "NONE");
  record("OWN-03_TERMINAL_ALONE_NOT_OWNER", !selected.ok && selected.code === "NONE", selected);
  selected = selectActiveConfirmationCapture_([savedVoid, savedReplace, cancelled, pending], "u1", "c1", now, "NONE");
  record("OWN-04_ONE_ACTIVE_BEATS_HISTORY", selected.ok && selected.capture.capture_id === "create-new", selected);
  selected = selectActiveConfirmationCapture_([foreign, pending], "u1", "c1", now, "NONE");
  record("OWN-05_USER_SCOPED", selected.ok && selected.capture.capture_id === "create-new", selected);
  selected = selectActiveConfirmationCapture_([expired, cancelled], "u1", "c1", now, "NONE");
  record("OWN-06_EXPIRED_CANCELLED_NOT_OWNER", !selected.ok && selected.code === "CAPTURE_EXPIRED", selected);
  const olderActive = row("older-active", "PENDING_CONFIRMATION", "C231_DOMAIN_ROUTER",
    "2026-08-30T11:55:00.000Z", "2026-08-30T12:30:00.000Z");
  selected = selectActiveConfirmationCapture_([olderActive, pending], "u1", "c1", now, "NONE");
  record("OWN-07_NEWEST_ACTIVE_WINS", selected.ok && selected.capture.capture_id === "create-new", selected);
  record("OWN-08_SAVED_VOID_STATE_TERMINAL", savedVoid.status === SMART_CONFIRMATION_CONFIG.STATUSES.SAVED, savedVoid);
  record("OWN-09_CANCEL_INTENT_UNCHANGED", detectConfirmationIntent_("Нет").intent === "CANCEL", {});
  record("OWN-10_CONFIRM_INTENT_UNCHANGED", detectConfirmationIntent_("Да").intent === "CONFIRM", {});
  const generic = detectConfirmationIntent_("Что мне делать сегодня?");
  record("OWN-11_GENERIC_NON_CONFIRM_UNCHANGED", !generic || ["CONFIRM", "CANCEL"].indexOf(generic.intent) < 0, generic);
  [
    ["OWN-12_WEIGHT_PENDING_IS_ACTIVE", "C20A_WEIGHT_GATE"],
    ["OWN-13_TARGET_PENDING_IS_ACTIVE", "C232C2_NUTRITION_TARGETS"],
    ["OWN-14_VOID_PENDING_IS_ACTIVE", C232D31_VOID_CAPTURE_SOURCE],
    ["OWN-15_REPLACE_PENDING_IS_ACTIVE", C232D4_REPLACE_CAPTURE_SOURCE]
  ].forEach(function(test) {
    const result = selectActiveConfirmationCapture_([row(test[0], "PENDING_CONFIRMATION", test[1],
      "2026-08-30T11:59:10.000Z", "2026-08-30T12:30:00.000Z")], "u1", "c1", now, "NONE");
    record(test[0], result.ok, result);
  });
  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite:"CONFIRMATION_OWNERSHIP_REGRESSION", status:passed === tests.length ? "PASS" : "FAIL",
    total:tests.length, passed:passed, failed:tests.length-passed, tests:tests};
}
