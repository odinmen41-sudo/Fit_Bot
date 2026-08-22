/** C-16C bounded, best-effort AI usage metrics in-memory acceptance suite. */
function testC16CAiUsageMetrics_() {
  const tests = [];

  function record(id, passed, details) {
    tests.push({id: id, passed: passed === true, details: details || {}});
  }

  function environment(initialValue, scenario) {
    const state = {value: initialValue || "", writes: 0, releases: 0};
    const config = scenario || {};
    return {
      state: state,
      dependencies: {
        lock: {
          tryLock: function() {
            if (config.lock_error) throw new Error("LOCK_ERROR");
            return config.lock_unavailable !== true;
          },
          releaseLock: function() {
            state.releases += 1;
            if (config.release_error) throw new Error("RELEASE_ERROR");
          }
        },
        properties: {
          getProperty: function() {
            if (config.read_error) throw new Error("READ_ERROR");
            return state.value;
          },
          setProperty: function(name, value) {
            if (config.write_error) throw new Error("WRITE_ERROR");
            state.value = String(value);
            state.writes += 1;
          }
        }
      }
    };
  }

  const deterministicEnv = environment();
  const deterministic = generateCoachReply_("test-user", "test-chat", "привет", {
    metrics: deterministicEnv.dependencies
  });
  const deterministicMetrics = JSON.parse(deterministicEnv.state.value);
  record("C16C-01_DETERMINISTIC_INCREMENTS", deterministic.model === "deterministic_intent" &&
    deterministicMetrics.deterministic_intent_calls === 1 &&
    deterministicMetrics.estimated_tokens_saved === 300, deterministicMetrics);

  const groqEnv = environment();
  const groq = callGroq_("test-key", "test-model", [{role: "user", content: "test"}], {
    metrics: groqEnv.dependencies,
    fetch: function() {
      return {
        getResponseCode: function() { return 200; },
        getContentText: function() {
          return JSON.stringify({choices: [{message: {content: "test reply"}}], usage: {total_tokens: 2}});
        }
      };
    },
    record_usage: function() {}
  });
  const groqMetrics = JSON.parse(groqEnv.state.value);
  record("C16C-02_GROQ_PATH_INCREMENTS", groq.text === "test reply" &&
    groqMetrics.groq_calls === 1, groqMetrics);

  const failureEnv = environment("", {write_error: true});
  const responseDespiteFailure = generateCoachReply_("test-user", "test-chat", "спасибо", {
    metrics: failureEnv.dependencies
  });
  record("C16C-03_COUNTER_FAILURE_NON_BLOCKING", responseDespiteFailure.model === "deterministic_intent" &&
    responseDespiteFailure.text.length > 0, {response: responseDespiteFailure, writes: failureEnv.state.writes});

  const boundedEnv = environment(JSON.stringify({
    deterministic_intent_calls: 999999998,
    groq_calls: 999999998,
    groq_fallback_calls: 999999998,
    estimated_tokens_saved: 999999998,
    unexpected_dynamic_key: "must be removed"
  }));
  recordAiUsageMetrics_({
    deterministic_intent_calls: 5000,
    groq_calls: 5000,
    groq_fallback_calls: 5000,
    estimated_tokens_saved: 5000,
    another_dynamic_key: 5000
  }, boundedEnv.dependencies);
  const boundedMetrics = JSON.parse(boundedEnv.state.value);
  const boundedKeys = Object.keys(boundedMetrics).sort();
  const expectedKeys = [
    "deterministic_intent_calls",
    "estimated_tokens_saved",
    "groq_calls",
    "groq_fallback_calls"
  ].sort();
  record("C16C-04_JSON_REMAINS_BOUNDED", boundedEnv.state.value.length <= 300 &&
    JSON.stringify(boundedKeys) === JSON.stringify(expectedKeys) &&
    expectedKeys.every(function(key) { return boundedMetrics[key] === 999999999; }), {
      json_length: boundedEnv.state.value.length,
      keys: boundedKeys,
      metrics: boundedMetrics
    });

  const lockFailureEnv = environment("", {lock_error: true});
  const lockResult = recordAiUsageMetrics_({groq_calls: 1}, lockFailureEnv.dependencies);
  const releaseFailureEnv = environment("", {release_error: true});
  const releaseResult = recordAiUsageMetrics_({groq_calls: 1}, releaseFailureEnv.dependencies);
  record("C16C-05_LOCK_FAILURES_NON_BLOCKING", lockResult === false && releaseResult === true &&
    lockFailureEnv.state.writes === 0 && releaseFailureEnv.state.writes === 1, {
      lock_result: lockResult, release_result: releaseResult
    });

  const fallbackEnv = environment();
  recordAiUsageMetrics_({groq_fallback_calls: 1}, fallbackEnv.dependencies);
  const fallbackMetrics = JSON.parse(fallbackEnv.state.value);
  record("C16C-06_FALLBACK_COUNTER", fallbackMetrics.groq_fallback_calls === 1, fallbackMetrics);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-16C_AI_USAGE_METRICS",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC16CAiUsageMetricsTests() {
  return testC16CAiUsageMetrics_();
}
