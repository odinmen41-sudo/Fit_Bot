/** C-16B deterministic intent router in-memory acceptance suite. */
function testC16BIntentRouter_() {
  const tests = [];

  function record(id, passed, details) {
    tests.push({id: id, passed: passed === true, details: details || {}});
  }

  function matched(text) {
    return matchDeterministicCoachIntent_(text);
  }

  const greeting = generateCoachReply_("test-user", "test-chat", "  Привет!!!  ");
  record("C16B-01_GREETING_POSITIVE", Boolean(greeting) &&
    greeting.model === "deterministic_intent", greeting);

  const greetingQuestion = matched("привет, что делать сегодня?");
  record("C16B-02_GREETING_WITH_QUESTION_FALLS_THROUGH", greetingQuestion === null,
    {result: greetingQuestion});

  const thanks = matched("Благодарю.");
  record("C16B-03_THANKS_POSITIVE", Boolean(thanks) &&
    thanks.model === "deterministic_intent", thanks);

  const thanksContext = matched("спасибо, но вес стоит");
  record("C16B-04_THANKS_WITH_CONTEXT_FALLS_THROUGH", thanksContext === null,
    {result: thanksContext});

  const identity = matched("Кто ты?");
  const capability = matched("Что ты умеешь?");
  record("C16B-05_IDENTITY_CAPABILITY_POSITIVE", Boolean(identity) && Boolean(capability) &&
    identity.model === "deterministic_intent" && capability.model === "deterministic_intent", {
      identity: identity, capability: capability
    });

  const medicalInputs = [
    "привет, болит плечо",
    "болит грудь",
    "спасибо, но боль не проходит"
  ];
  record("C16B-06_MEDICAL_NEVER_INTERCEPTED", medicalInputs.every(function(text) {
    return matched(text) === null;
  }), {inputs: medicalInputs});

  const forbidden = ["да", "нет", "ок", "117.8", "что по питанию?", "как тренироваться?", "7 8 6 5 4 боли нет"];
  record("C16B-07_FORBIDDEN_INPUTS_FALL_THROUGH", forbidden.every(function(text) {
    return matched(text) === null;
  }), {inputs: forbidden});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-16B_SAFE_INTENT_ROUTER",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC16BIntentRouterTests() {
  return testC16BIntentRouter_();
}
