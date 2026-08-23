/** C-18H context-quality diagnostic acceptance suite. */
function testC18HContextQualityAudit_() {
  const tests = [];
  function record(id, passed, details) {
    tests.push({id: id, passed: passed === true, details: details || {}});
  }

  const context = "Профиль: Имя=Staging Test, Возраст=35, Рост=180, Текущий вес=118,7, " +
    "Целевой вес=108, Цель=Снижение веса, Уровень подготовки=Средний, Тренировки в неделю=3";

  const full = auditAiContextQuality_(
    context,
    "Напомни мои текущие параметры, основную цель, целевой вес и режим тренировок",
    "Возраст 35 лет, рост 180 см, текущий вес 118,7 кг, целевой — 108 кг. " +
      "Цель — снижение веса, уровень подготовки средний, тренировки 3 раза в неделю."
  );
  record("C18H-01_DELIVERED_FIELDS_REPORTED", full.delivered_profile_fields.length === 8 &&
    full.delivered_profile_fields.indexOf("age") >= 0 &&
    full.delivered_profile_fields.indexOf("training_frequency") >= 0, full);
  record("C18H-02_REQUIRED_FIELDS_REFLECTED", full.status === "PASS" &&
    full.missing_response_fields.length === 0 && full.coverage.required_count === 7, full);

  const weightOnly = auditAiContextQuality_(context, "Какой у меня текущий вес?", "Текущий вес — 118,7 кг.");
  record("C18H-03_UNASKED_FIELDS_NOT_ERRORS", weightOnly.status === "PASS" &&
    weightOnly.required_response_fields.length === 1 &&
    weightOnly.required_response_fields[0] === "current_weight" &&
    weightOnly.not_requested_fields.indexOf("age") >= 0 &&
    weightOnly.missing_response_fields.length === 0, weightOnly);

  const missingGoal = auditAiContextQuality_(context, "Какая у меня цель?", "Текущий вес — 118,7 кг.");
  record("C18H-04_ASKED_MISSING_FIELD_REVIEW", missingGoal.status === "REVIEW" &&
    missingGoal.missing_response_fields.length === 1 &&
    missingGoal.missing_response_fields[0] === "goal", missingGoal);

  const noNutritionContext = auditAiContextQuality_(context, "Сколько у меня калорий и белка по питанию?", "Данных по питанию нет.");
  record("C18H-05_UNDELIVERED_NOT_RESPONSE_ERROR", noNutritionContext.status === "PASS" &&
    noNutritionContext.missing_response_fields.length === 0 &&
    noNutritionContext.requested_but_not_delivered_fields.indexOf("calories_target") >= 0 &&
    noNutritionContext.requested_but_not_delivered_fields.indexOf("protein_target") >= 0, noNutritionContext);

  record("C18H-06_PRIVACY_BOUNDED_OUTPUT", full.privacy.stores_user_text === false &&
    full.privacy.stores_profile_values === false && full.privacy.stores_model_response === false &&
    JSON.stringify(full).indexOf("Staging Test") < 0 && JSON.stringify(full).indexOf("118,7") < 0, full.privacy);

  const passed = tests.filter(function(test) { return test.passed; }).length;
  return {
    suite: "C-18H_CONTEXT_QUALITY_AUDIT",
    status: passed === tests.length ? "PASS" : "FAIL",
    total: tests.length,
    passed: passed,
    failed: tests.length - passed,
    tests: tests,
    safety: {sheet_writes: 0, telegram_calls: 0, groq_calls: 0, production_writes: 0}
  };
}

function runC18HContextQualityAuditTests() {
  return testC18HContextQualityAudit_();
}
