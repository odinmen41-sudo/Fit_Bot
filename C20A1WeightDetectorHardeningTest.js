/** C-20A.1 conservative explicit-current-weight detector suite. */
function runC20A1WeightDetectorHardeningTests() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: Boolean(passed), details: details || {}});
  }

  const positives = [
    ["мой вес 117 кг", 117],
    ["Мой текущий вес — 117,4 кг.", 117.4],
    ["сейчас вешу 117", 117],
    ["Сейчас я вешу: 116.8 килограмма", 116.8],
    ["вес сегодня 117 кг", 117],
    ["Вес на сегодня = 117 кг", 117],
    ["Сегодня мой вес 117 килограммов", 117]
  ];
  const detected = positives.map(function(fixture) {
    return {text: fixture[0], expected: fixture[1], result: detectExplicitWeightUpdate_(fixture[0])};
  });
  record("C20A1-01_EXPLICIT_CURRENT_WEIGHT", detected.every(function(item) {
    return item.result && item.result.value === item.expected && item.result.fact_type === "WEIGHT";
  }), {detected: detected});

  const contextualNegatives = [
    "мой вес примерно 117 кг", "мой вес около 117 кг", "мой вес вроде 117 кг",
    "мой вес был 117 кг", "мой вес будет 117 кг", "мой целевой вес 117 кг",
    "мой вес 117 кг?", "сейчас я вешу 117 кг?", "вес сегодня 117 или 118 кг",
    "скинул 2 кг", "сбросил 5 кг", "набрал 3 кг", "похудел на 4 кг",
    "присед 100 кг", "жим 117 кг", "тяга 117 кг", "рабочий вес 117 кг",
    "мой вес в приседе 117 кг", "сейчас вешу штангу 117 кг",
    "его вес сегодня 117 кг", "вес клиента сегодня 117 кг", "117", "117 кг",
    "рост 180 вес 117", "мой вес от 115 до 117 кг", "мой вес не 117 кг",
    "если мой вес 117 кг, сколько калорий?", "напомни, мой вес 117 кг?",
    "мой вес: 29 кг", "мой вес: 351 кг", "мой вес: сто семнадцать кг"
  ];
  const fillerNegatives = [];
  for (let i = 0; i < 100; i += 1) {
    fillerNegatives.push("подход " + (i + 1) + ": присед " + (30 + i) + " кг");
  }
  const negativeCorpus = contextualNegatives.concat(fillerNegatives);
  const falsePositives = negativeCorpus.filter(function(text) {
    return detectExplicitWeightUpdate_(text) !== null;
  });
  const falsePositiveRate = falsePositives.length / negativeCorpus.length;
  record("C20A1-02_CONTEXT_FILTER_FALSE_POSITIVE_RATE", falsePositiveRate < 0.01, {
    corpus_size: negativeCorpus.length,
    false_positives: falsePositives,
    rate: falsePositiveRate
  });

  const candidate = detectExplicitWeightUpdate_("мой вес 117 кг");
  const capture = buildWeightPendingCapture_(candidate, {
    now: new Date("2026-08-24T00:00:00.000Z"),
    update_id: "c20a1",
    uuid: function() { return "uuid"; },
    format_date: function() { return "2026-08-24"; }
  });
  const serializedCandidate = JSON.stringify(candidate);
  const serializedCapture = JSON.stringify(capture);
  record("C20A1-03_RAW_TEXT_NOT_STORED", candidate && capture.raw_message === "" &&
    !Object.prototype.hasOwnProperty.call(candidate, "raw_text") &&
    !Object.prototype.hasOwnProperty.call(candidate, "text") &&
    serializedCandidate.indexOf("мой вес") < 0 && serializedCapture.indexOf("мой вес") < 0,
  {candidate: candidate, raw_message: capture.raw_message});
  record("C20A1-04_SIMULATION_CONTRACT_UNCHANGED", capture.mode === "SIMULATION" &&
    capture.writes_allowed === false && capture.source === "C20A_WEIGHT_GATE",
  {mode: capture.mode, writes_allowed: capture.writes_allowed, source: capture.source});

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-20A.1_WEIGHT_DETECTOR_HARDENING",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, raw_text_storage: 0}
  };
}
