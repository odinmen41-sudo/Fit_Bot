/** C-17J2 non-empty Groq length-termination handling in-memory acceptance suite. */
function runC17J2GroqLengthTerminationTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id:id, passed:passed === true, status:passed === true ? "PASS" : "FAIL", details:details || {}});
  }
  function response(content, finishReason, completionTokens) {
    return {
      getResponseCode:function() { return 200; },
      getContentText:function() { return JSON.stringify({
        choices:[{message:{content:content},finish_reason:finishReason}],
        usage:{prompt_tokens:10,completion_tokens:completionTokens,total_tokens:10 + completionTokens}
      }); }
    };
  }
  function metrics() {
    let value = "";
    return {lock:{tryLock:function(){return true;},releaseLock:function(){}},properties:{
      getProperty:function(){return value;},setProperty:function(name,next){value=String(next);}
    }};
  }
  function properties() {
    return {getProperty:function(name) {
      if (name === CONFIG.GROQ_KEY_PROPERTY) return "test-key";
      if (name === CONFIG.GROQ_PRIMARY_MODEL_PROPERTY) return "openai/gpt-oss-120b";
      if (name === CONFIG.GROQ_FALLBACK_MODEL_PROPERTY) return "openai/gpt-oss-20b";
      return "";
    }};
  }
  function runWith(sequence, diagnostics) {
    const requests = [];
    let index = 0;
    try {
      const result = generateCoachReply_("test-user", "test-chat", "test question", {
        properties:properties(), metrics:metrics(), build_context:function(){return "bounded context";},
        fetch:function(url, options) {
          requests.push(JSON.parse(options.payload));
          const item = sequence[index++];
          if (item instanceof Error) throw item;
          return response(item.content, item.finish_reason, item.completion_tokens);
        },
        record_usage:function(){},
        completion_diagnostic:function(item){diagnostics.push(item);}
      });
      return {result:result,error:null,requests:requests};
    } catch (error) {
      return {result:null,error:error,requests:requests};
    }
  }

  let diagnostics = [];
  let run = runWith([{content:"complete primary",finish_reason:"stop",completion_tokens:20}], diagnostics);
  record("C17J2-A_NORMAL_PRIMARY", run.result && run.result.text === "complete primary" &&
    run.requests.length === 1 && run.requests[0].max_completion_tokens === 300 &&
    run.requests[0].model === "openai/gpt-oss-120b", run);

  diagnostics = [];
  run = runWith([
    {content:"partial output",finish_reason:"length",completion_tokens:300},
    {content:"complete recovery",finish_reason:"stop",completion_tokens:80}
  ], diagnostics);
  record("C17J2-B_PRIMARY_LENGTH_RECOVERY", run.result && run.result.text === "complete recovery" &&
    run.result.text !== "partial output" && run.requests.length === 2 &&
    run.requests[0].max_completion_tokens === 300 && run.requests[1].max_completion_tokens === 600 &&
    run.requests[0].model === run.requests[1].model, run);

  diagnostics = [];
  run = runWith([
    {content:"partial one",finish_reason:"length",completion_tokens:300},
    {content:"partial two",finish_reason:"length",completion_tokens:600}
  ], diagnostics);
  record("C17J2-C_PRIMARY_LENGTH_TWICE", !run.result && run.error &&
    run.error.code === "GROQ_COMPLETION_INCOMPLETE" && run.requests.length === 2,
    {error:run.error && run.error.message,requests:run.requests});

  diagnostics = [];
  run = runWith([
    {content:"",finish_reason:"length",completion_tokens:300},
    {content:"fallback complete",finish_reason:"stop",completion_tokens:30}
  ], diagnostics);
  record("C17J2-D_EMPTY_LENGTH_COMPATIBILITY", run.result && run.result.text === "fallback complete" &&
    run.result.model === "openai/gpt-oss-20b" && run.requests.length === 2 &&
    run.requests[0].max_completion_tokens === 300 && run.requests[1].max_completion_tokens === 300, run);

  diagnostics = [];
  let directError = null;
  try {
    callGroq_("test-key", "test-model", [{role:"user",content:"secret prompt"}], {
      metrics:metrics(), fetch:function(){return response("provider partial", "content_filter", 12);},
      record_usage:function(){},completion_diagnostic:function(item){diagnostics.push(item);}
    });
  } catch (error) { directError = error; }
  record("C17J2-E_UNKNOWN_FINISH_REJECTED", directError &&
    directError.code === "GROQ_COMPLETION_NON_NORMAL", {error:directError && directError.message});

  diagnostics = [];
  run = runWith([
    {content:"",finish_reason:"length",completion_tokens:300},
    {content:"fallback partial",finish_reason:"length",completion_tokens:300}
  ], diagnostics);
  record("C17J2-F_FALLBACK_LENGTH_REJECTED", !run.result && run.error &&
    run.error.code === "GROQ_COMPLETION_INCOMPLETE" && run.requests.length === 2,
    {error:run.error && run.error.message,requests:run.requests});

  const serializedDiagnostics = JSON.stringify(diagnostics);
  record("C17J2-G_SAFE_TOKEN_DIAGNOSTICS", diagnostics.length === 2 &&
    diagnostics[1].finish_reason === "length" && diagnostics[1].completion_tokens === 300 &&
    diagnostics[1].assistant_character_count === "fallback partial".length &&
    serializedDiagnostics.indexOf("fallback partial") < 0 && serializedDiagnostics.indexOf("secret prompt") < 0,
    {diagnostics:diagnostics});

  let telegramCalls = 0;
  diagnostics = [];
  run = runWith([
    {content:"never send one",finish_reason:"length",completion_tokens:300},
    {content:"never send two",finish_reason:"length",completion_tokens:600}
  ], diagnostics);
  if (run.result) telegramCalls += 1;
  record("C17J2-H_INCOMPLETE_NEVER_REACHES_DELIVERY", telegramCalls === 0 && !run.result &&
    run.error && run.error.code === "GROQ_COMPLETION_INCOMPLETE", {telegram_calls:telegramCalls});

  const passed = tests.filter(function(test){return test.passed;}).length;
  return {suite:"C-17J2_GROQ_LENGTH_TERMINATION",status:passed === tests.length ? "PASS" : "FAIL",
    total:tests.length,passed:passed,failed:tests.length-passed,tests:tests,
    safety:{sheet_writes:0,property_writes:0,telegram_calls:0,groq_calls:0,production_writes:0}};
}
