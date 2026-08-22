/** C-17J Groq empty-completion fallback hardening in-memory acceptance suite. */
function testC17JGroqEmptyCompletion_() {
  const tests = [];

  function record(id, passed, details) {
    tests.push({id: id, passed: passed === true, details: details || {}});
  }

  function response(status, body) {
    return {
      getResponseCode: function() { return status; },
      getContentText: function() { return JSON.stringify(body); }
    };
  }

  function metricsDependencies() {
    let value = "";
    return {
      lock: {
        tryLock: function() { return true; },
        releaseLock: function() {}
      },
      properties: {
        getProperty: function() { return value; },
        setProperty: function(name, nextValue) { value = String(nextValue); }
      }
    };
  }

  function invoke(status, body) {
    try {
      const result = callGroq_("test-key", "test-model", [{role: "user", content: "test"}], {
        metrics: metricsDependencies(),
        fetch: function() { return response(status, body); },
        record_usage: function() {}
      });
      return {result: result, error: null};
    } catch (error) {
      return {result: null, error: error};
    }
  }

  const calls = [];
  const fallbackResult = generateCoachReply_("test-user", "test-chat", "сложный вопрос", {
    properties: {
      getProperty: function(name) {
        if (name === CONFIG.GROQ_KEY_PROPERTY) return "test-key";
        if (name === CONFIG.GROQ_PRIMARY_MODEL_PROPERTY) return "openai/gpt-oss-120b";
        if (name === CONFIG.GROQ_FALLBACK_MODEL_PROPERTY) return "openai/gpt-oss-20b";
        return "";
      }
    },
    build_context: function() { return "bounded test context"; },
    metrics: metricsDependencies(),
    fetch: function(url, options) {
      const request = JSON.parse(options.payload);
      calls.push(request.model);
      if (request.model === "openai/gpt-oss-120b") {
        return response(200, {
          choices: [{message: {content: ""}, finish_reason: "length"}],
          usage: {total_tokens: 412, completion_tokens: 300}
        });
      }
      return response(200, {
        choices: [{message: {content: "Fallback answer"}, finish_reason: "stop"}],
        usage: {total_tokens: 40, completion_tokens: 12}
      });
    },
    record_usage: function() {}
  });
  record("C17J-01_EMPTY_COMPLETION_FALLBACK", calls.join(",") ===
    "openai/gpt-oss-120b,openai/gpt-oss-20b" &&
    fallbackResult && fallbackResult.text === "Fallback answer" &&
    fallbackResult.model === "openai/gpt-oss-20b", {
      calls: calls,
      result: fallbackResult
    });

  const empty = invoke(200, {
    choices: [{message: {content: ""}, finish_reason: "length"}],
    usage: {total_tokens: 412, completion_tokens: 300}
  }).error;
  record("C17J-02_EMPTY_DIAGNOSTICS_SAFE", empty &&
    empty.retryable === false && empty.fallbackEligible === true &&
    empty.message.indexOf("finish_reason=length") >= 0 &&
    empty.message.indexOf("usage.total_tokens=412") >= 0 &&
    empty.message.indexOf("usage.completion_tokens=300") >= 0 &&
    empty.message.indexOf("test") < 0, {error: empty ? empty.message : ""});

  let normalFetches = 0;
  const normal = generateCoachReply_("test-user", "test-chat", "ещё один сложный вопрос", {
    properties: {
      getProperty: function(name) {
        if (name === CONFIG.GROQ_KEY_PROPERTY) return "test-key";
        if (name === CONFIG.GROQ_PRIMARY_MODEL_PROPERTY) return "openai/gpt-oss-120b";
        if (name === CONFIG.GROQ_FALLBACK_MODEL_PROPERTY) return "openai/gpt-oss-20b";
        return "";
      }
    },
    build_context: function() { return "bounded test context"; },
    metrics: metricsDependencies(),
    fetch: function() {
      normalFetches += 1;
      return response(200, {choices: [{message: {content: "Primary answer"}, finish_reason: "stop"}]});
    },
    record_usage: function() {}
  });
  record("C17J-03_NORMAL_NO_FALLBACK", normal.text === "Primary answer" && normalFetches === 1, {
    fetches: normalFetches,
    result: normal
  });

  const badRequest = invoke(400, {error: {message: "Malformed request"}}).error;
  const unauthorized = invoke(401, {error: {message: "Invalid API key"}}).error;
  record("C17J-04_400_401_NO_FALLBACK", badRequest && unauthorized &&
    badRequest.retryable === false && badRequest.fallbackEligible !== true &&
    unauthorized.retryable === false && unauthorized.fallbackEligible !== true, {
      bad_request: badRequest ? badRequest.message : "",
      unauthorized: unauthorized ? unauthorized.message : ""
    });

  const unavailableModel = invoke(404, {
    error: {message: "The model `missing-model` does not exist or you do not have access to it."}
  }).error;
  record("C17J-05_MODEL_404_FALLBACK", unavailableModel &&
    unavailableModel.retryable === false && unavailableModel.fallbackEligible === true,
    {error: unavailableModel ? unavailableModel.message : ""});

  const rateLimit = invoke(429, {error: {message: "Rate limit exceeded"}}).error;
  const providerError = invoke(503, {error: {message: "Service unavailable"}}).error;
  record("C17J-06_429_5XX_RETRYABLE", rateLimit && providerError &&
    rateLimit.retryable === true && providerError.retryable === true, {
      rate_limit: rateLimit ? rateLimit.message : "",
      provider_error: providerError ? providerError.message : ""
    });

  let requestPayload = null;
  callGroq_("test-key", "openai/gpt-oss-120b", [{role: "user", content: "test"}], {
    metrics: metricsDependencies(),
    fetch: function(url, options) {
      requestPayload = JSON.parse(options.payload);
      return response(200, {choices: [{message: {content: "ok"}}]});
    },
    record_usage: function() {}
  });
  record("C17J-07_COMPLETION_BUDGET_300", requestPayload &&
    requestPayload.max_completion_tokens === 300, requestPayload || {});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-17J_GROQ_EMPTY_COMPLETION",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC17JGroqEmptyCompletionTests() {
  return testC17JGroqEmptyCompletion_();
}
