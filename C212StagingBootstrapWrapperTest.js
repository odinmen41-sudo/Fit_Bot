/** C-21.2 public staging bootstrap wrapper regression suite. */
function runC212StagingBootstrapWrapperTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, status: passed ? "PASS" : "FAIL", details: details || null});
  }
  function lock() {
    return {tryLock: function() { return true; }, releaseLock: function() {}};
  }
  function emptySheet() {
    return {
      values: null,
      getLastRow: function() { return 0; },
      getLastColumn: function() { return 0; },
      getRange: function() {
        const self = this;
        return {setValues: function(values) { self.values = values; }};
      }
    };
  }

  const stagingSheet = emptySheet();
  const staging = runStagingMemoryBootstrap({
    deployment_env: "STAGING",
    lock: lock(),
    spreadsheet: {},
    get_sheet: function() { return stagingSheet; },
    flush: function() {}
  });
  record("C21.2-WRAPPER-01_STAGING_ALLOWED",
    staging.ok === true && staging.code === "AI_MEMORY_SCHEMA_BOOTSTRAPPED" &&
      JSON.stringify(stagingSheet.values[0]) === JSON.stringify(aiMemoryRequiredHeaders_()), staging);

  let productionAccesses = 0;
  const production = runStagingMemoryBootstrap({
    deployment_env: "PRODUCTION",
    get_sheet: function() { productionAccesses += 1; },
    create_sheet: function() { productionAccesses += 1; }
  });
  record("C21.2-WRAPPER-02_PRODUCTION_BLOCKED",
    production.ok === false && production.code === "STAGING_ONLY" && productionAccesses === 0, production);

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {suite: "C-21.2 staging bootstrap wrapper", passed: passed, failed: tests.length - passed, tests: tests};
}
