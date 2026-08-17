/**
 * Smart Data Capture Engine — test-only implementation.
 *
 * Safety guarantees for Sprint 5 phase 1:
 * - not connected to doPost(), generateCoachReply_(), Telegram or Memory Layer;
 * - does not write to Google Sheets or AI_MEMORY;
 * - effective mode defaults to TEST;
 * - production writes stay blocked even if SMART_CAPTURE_MODE is set to ACTIVE.
 */
const SMART_CAPTURE_CONFIG = Object.freeze({
  MODE_PROPERTY: "SMART_CAPTURE_MODE",
  DEFAULT_MODE: "TEST",
  ALLOWED_MODES: Object.freeze(["OFF", "TEST", "SHADOW", "SIMULATION", "ACTIVE"]),
  TEST_MODES: Object.freeze(["TEST", "SHADOW", "SIMULATION"]),
  SOURCE_PRIORITY: Object.freeze({
    EXPLICIT_USER_INPUT: 3,
    AI_EXTRACTION: 2,
    MEMORY: 1
  }),
  SOURCE_ORDER: Object.freeze([
    "EXPLICIT_USER_INPUT",
    "AI_EXTRACTION",
    "MEMORY"
  ]),
  TIME_ZONE: "Europe/Moscow",
  MIN_FIELD_CONFIDENCE: 0.60,
  PRODUCTION_WRITES_ENABLED: false
});

function detectUserIntent_(message) {
  const text = smartCaptureNormalizeText_(message);
  const intents = [];

  const bodyHasWeight = /(?:вес(?:\s+сегодня)?|вешу)\s*[:=\-]?\s*\d{2,3}(?:[.,]\d{1,2})?/i.test(text);
  if (bodyHasWeight || /взвесил(?:ся|ась)?/i.test(text)) {
    intents.push(smartCaptureIntent_(
      "BODY_TRACKING",
      bodyHasWeight ? 0.99 : 0.78,
      bodyHasWeight ? ["weight_value"] : ["weight_keyword"]
    ));
  }

  const hasWorkoutType = /грудь|спина|ноги|плечи|руки|кардио|тренировк/i.test(text);
  const hasExercise = /жим|присед|станов|тяга|подтягив|разгибан|сгибан|махи/i.test(text);
  const hasWorkoutNumbers = /\d+(?:[.,]\d+)?\s*кг|\d+\s*[xх×]\s*\d+/i.test(text);
  if (hasWorkoutType || hasExercise) {
    intents.push(smartCaptureIntent_(
      "WORKOUT_LOG",
      hasExercise && hasWorkoutNumbers ? 0.99 : (hasWorkoutType ? 0.86 : 0.76),
      [hasWorkoutType ? "training_type" : "", hasExercise ? "exercise" : "", hasWorkoutNumbers ? "workout_numbers" : ""].filter(String)
    ));
  }

  const hasFood = /ел(?:а|и)?|съел(?:а|и)?|куриц|рис|творог|яйц|овсян|греч|мяс|рыб/i.test(text);
  const hasFoodQuantity = /\d+(?:[.,]\d+)?\s*(?:грамм(?:а|ов)?|гр\.?|г)(?:\s|[.,]|$)/i.test(text);
  if (hasFood) {
    intents.push(smartCaptureIntent_(
      "NUTRITION_LOG",
      hasFoodQuantity ? 0.98 : 0.76,
      ["food", hasFoodQuantity ? "quantity" : ""].filter(String)
    ));
  }

  const hasSleep = /спал(?:а)?|сон\s*[:=\-]?\s*\d/i.test(text);
  const hasEnergy = /энерги[яи]\s*[:=\-]?\s*\d/i.test(text);
  const hasRecovery = hasSleep || hasEnergy || /стресс|усталост|боль|болит/i.test(text);
  if (hasRecovery) {
    intents.push(smartCaptureIntent_(
      "RECOVERY_LOG",
      hasSleep && hasEnergy ? 0.99 : 0.84,
      [hasSleep ? "sleep" : "", hasEnergy ? "energy" : "", /боль|болит/i.test(text) ? "pain" : ""].filter(String)
    ));
  }

  return intents;
}

function extractStructuredData_(message, intents, options) {
  const text = smartCaptureNormalizeText_(message);
  const extractionOptions = options || {};
  const now = extractionOptions.now instanceof Date ? extractionOptions.now : new Date();
  const detectedIntents = Array.isArray(intents) ? intents : detectUserIntent_(text);
  const capture = {
    schema_version: "smart-capture-test-v1",
    mode: smartCaptureMode_(),
    writes_allowed: smartCaptureWritesAllowed_(),
    source_priority: SMART_CAPTURE_CONFIG.SOURCE_ORDER.slice(),
    capture_id: extractionOptions.capture_id || smartCaptureTestCaptureId_(text, now),
    created_at: now.toISOString(),
    raw_message: String(message || ""),
    intents: detectedIntents,
    items: []
  };

  detectedIntents.forEach(function(intent) {
    if (intent.category === "BODY_TRACKING") {
      const bodyItem = smartCaptureExtractBody_(text, now);
      if (bodyItem) capture.items.push(bodyItem);
    }
    if (intent.category === "WORKOUT_LOG") {
      const workoutItem = smartCaptureExtractWorkout_(text, now);
      if (workoutItem) capture.items.push(workoutItem);
    }
    if (intent.category === "NUTRITION_LOG") {
      const nutritionItem = smartCaptureExtractNutrition_(text, now);
      if (nutritionItem) capture.items.push(nutritionItem);
    }
    if (intent.category === "RECOVERY_LOG") {
      const recoveryItem = smartCaptureExtractRecovery_(text, now);
      if (recoveryItem) capture.items.push(recoveryItem);
    }
  });

  return capture;
}

function validateExtractedData_(capture) {
  const result = {
    schema_version: "smart-capture-validation-v1",
    capture_id: capture && capture.capture_id ? capture.capture_id : "",
    mode: capture && capture.mode ? capture.mode : smartCaptureMode_(),
    ready_for_confirmation: true,
    errors: [],
    warnings: [],
    items: []
  };

  if (!capture || !Array.isArray(capture.items) || capture.items.length === 0) {
    result.ready_for_confirmation = false;
    result.errors.push("No structured items were extracted.");
    return result;
  }

  capture.items.forEach(function(item) {
    const itemResult = {
      category: item.category,
      status: "PASS",
      errors: [],
      warnings: [],
      field_checks: {}
    };

    Object.keys(item.fields || {}).forEach(function(fieldName) {
      const field = item.fields[fieldName];
      const fieldErrors = [];
      if (!field || typeof field !== "object" || !("value" in field)) {
        fieldErrors.push("missing field envelope");
      } else {
        if (typeof field.confidence !== "number" || field.confidence < 0 || field.confidence > 1) {
          fieldErrors.push("confidence must be between 0 and 1");
        }
        if (!SMART_CAPTURE_CONFIG.SOURCE_PRIORITY[field.source]) {
          fieldErrors.push("unknown source");
        }
        if (field.confidence < SMART_CAPTURE_CONFIG.MIN_FIELD_CONFIDENCE) {
          itemResult.warnings.push(fieldName + " has low confidence " + field.confidence);
        }
      }
      itemResult.field_checks[fieldName] = {
        passed: fieldErrors.length === 0,
        errors: fieldErrors
      };
      itemResult.errors.push.apply(itemResult.errors, fieldErrors.map(function(error) {
        return fieldName + ": " + error;
      }));
    });

    smartCaptureValidateCategory_(item, itemResult);

    if (itemResult.errors.length) itemResult.status = "FAIL";
    else if (itemResult.warnings.length) itemResult.status = "WARN";

    if (itemResult.status === "FAIL") result.ready_for_confirmation = false;
    result.errors.push.apply(result.errors, itemResult.errors.map(function(error) {
      return item.category + ": " + error;
    }));
    result.warnings.push.apply(result.warnings, itemResult.warnings.map(function(warning) {
      return item.category + ": " + warning;
    }));
    result.items.push(itemResult);
  });

  if (capture.writes_allowed !== false || smartCaptureWritesAllowed_() !== false) {
    result.ready_for_confirmation = false;
    result.errors.push("Production writes must remain disabled in test-only phase.");
  }

  return result;
}

function buildConfirmationMessage_(capture, validation) {
  const check = validation || validateExtractedData_(capture);
  if (!check.ready_for_confirmation) {
    return "Не удалось безопасно подготовить запись. Нужно уточнить данные:\n- " + check.errors.join("\n- ");
  }

  const lines = ["Я понял:", ""];
  (capture.items || []).forEach(function(item, index) {
    if (index > 0) lines.push("");
    if (item.category === "BODY_TRACKING") smartCaptureAddBodyConfirmation_(lines, item);
    if (item.category === "WORKOUT_LOG") smartCaptureAddWorkoutConfirmation_(lines, item);
    if (item.category === "NUTRITION_LOG") smartCaptureAddNutritionConfirmation_(lines, item);
    if (item.category === "RECOVERY_LOG") smartCaptureAddRecoveryConfirmation_(lines, item);
  });

  if (check.warnings.length) {
    lines.push("");
    lines.push("Важно: КБЖУ и другие неявные значения являются оценочными.");
  }
  lines.push("");
  lines.push("Записать?");
  return lines.join("\n");
}

function testDataExtraction_() {
  const referenceDate = new Date("2026-08-14T09:00:00+03:00");
  const scenarios = [
    {
      id: "BODY_TRACKING",
      message: "Вес сегодня 118.5",
      expected_intents: ["BODY_TRACKING"],
      expected_fields: {BODY_TRACKING: {weight: 118.5}}
    },
    {
      id: "WORKOUT_LOG",
      message: "Сегодня грудь, жим 100 кг 8х3",
      expected_intents: ["WORKOUT_LOG"],
      expected_fields: {WORKOUT_LOG: {training_type: "Грудь", exercise: "Жим", weight: 100, sets: 3, reps: 8}}
    },
    {
      id: "NUTRITION_LOG",
      message: "Курица 250 грамм рис 200",
      expected_intents: ["NUTRITION_LOG"],
      expected_fields: {NUTRITION_LOG: {food_count: 2, chicken_g: 250, rice_g: 200}}
    },
    {
      id: "RECOVERY_LOG",
      message: "Спал 7 часов, энергия 8",
      expected_intents: ["RECOVERY_LOG"],
      expected_fields: {RECOVERY_LOG: {sleep_hours: 7, energy: 8}}
    },
    {
      id: "MULTI_INTENT_INTEGRATION",
      message: "Вес сегодня 118.7.\nСегодня грудь.\nЖим 100 кг 8х3.\nЕл курицу 250 грамм и рис 200 грамм.",
      expected_intents: ["BODY_TRACKING", "WORKOUT_LOG", "NUTRITION_LOG"],
      expected_fields: {
        BODY_TRACKING: {weight: 118.7},
        WORKOUT_LOG: {training_type: "Грудь", exercise: "Жим", weight: 100, sets: 3, reps: 8},
        NUTRITION_LOG: {food_count: 2, chicken_g: 250, rice_g: 200}
      }
    }
  ];
  const mode = smartCaptureMode_();
  const results = [];

  scenarios.forEach(function(scenario, index) {
    const intents = detectUserIntent_(scenario.message);
    const capture = extractStructuredData_(scenario.message, intents, {
      now: referenceDate,
      capture_id: "test-" + (index + 1)
    });
    const validation = validateExtractedData_(capture);
    const confirmation = buildConfirmationMessage_(capture, validation);
    const errors = [];
    const actualIntents = intents.map(function(intent) { return intent.category; });

    scenario.expected_intents.forEach(function(expectedIntent) {
      if (actualIntents.indexOf(expectedIntent) < 0) errors.push("Missing intent " + expectedIntent);
    });
    if (actualIntents.length !== scenario.expected_intents.length) {
      errors.push("Unexpected intents: " + actualIntents.join(", "));
    }
    smartCaptureAssertExpectedFields_(capture, scenario.expected_fields, errors);
    smartCaptureAssertFieldMetadata_(capture, errors);
    if (!validation.ready_for_confirmation) errors.push("Validation did not allow confirmation");
    if (confirmation.indexOf("Записать?") < 0) errors.push("Confirmation question is missing");
    if (capture.writes_allowed !== false) errors.push("writes_allowed must be false");

    const testResult = {
      id: scenario.id,
      status: errors.length ? "FAIL" : "PASS",
      message: scenario.message,
      expected_intents: scenario.expected_intents,
      detected_intents: actualIntents,
      item_statuses: validation.items.map(function(item) {
        return {category: item.category, status: item.status};
      }),
      every_field_has_confidence_and_source: !errors.some(function(error) {
        return error.indexOf("metadata") >= 0;
      }),
      confirmation_message: confirmation,
      errors: errors,
      capture: capture
    };
    results.push(testResult);
    console.log("[Smart Capture " + (index + 1) + "/" + scenarios.length + "] " + JSON.stringify({
      id: testResult.id,
      status: testResult.status,
      detected_intents: testResult.detected_intents,
      item_statuses: testResult.item_statuses,
      errors: testResult.errors
    }));
  });

  const passed = results.filter(function(result) { return result.status === "PASS"; }).length;
  const report = {
    ok: passed === results.length && SMART_CAPTURE_CONFIG.TEST_MODES.indexOf(mode) >= 0,
    smart_capture_mode: mode,
    production_writes_enabled: smartCaptureWritesAllowed_(),
    source_priority: SMART_CAPTURE_CONFIG.SOURCE_ORDER.slice(),
    total_tests: results.length,
    passed: passed,
    failed: results.length - passed,
    integration_scenario_passed: results.some(function(result) {
      return result.id === "MULTI_INTENT_INTEGRATION" && result.status === "PASS";
    }),
    results: results,
    sample_capture: results[results.length - 1].capture
  };

  console.log("[Smart Capture Summary] " + JSON.stringify({
    ok: report.ok,
    smart_capture_mode: report.smart_capture_mode,
    production_writes_enabled: report.production_writes_enabled,
    source_priority: report.source_priority,
    total_tests: report.total_tests,
    passed: report.passed,
    failed: report.failed,
    integration_scenario_passed: report.integration_scenario_passed
  }));
  return report;
}

// Public test runner only. It is not connected to the production message flow.
function runDataExtractionTests() {
  return testDataExtraction_();
}

function smartCaptureMode_() {
  let configured = "";
  try {
    configured = PropertiesService.getScriptProperties().getProperty(SMART_CAPTURE_CONFIG.MODE_PROPERTY) || "";
  } catch (error) {
    configured = "";
  }
  const mode = String(configured || SMART_CAPTURE_CONFIG.DEFAULT_MODE).trim().toUpperCase();
  return SMART_CAPTURE_CONFIG.ALLOWED_MODES.indexOf(mode) >= 0 ? mode : "OFF";
}

function smartCaptureWritesAllowed_() {
  return SMART_CAPTURE_CONFIG.PRODUCTION_WRITES_ENABLED === true;
}

function smartCaptureIntent_(category, confidence, evidence) {
  return {
    category: category,
    confidence: smartCaptureClampConfidence_(confidence),
    evidence: evidence || []
  };
}

function smartCaptureField_(value, confidence, source, raw, extra) {
  const field = {
    value: value,
    confidence: smartCaptureClampConfidence_(confidence),
    source: source,
    raw: raw == null ? "" : String(raw)
  };
  Object.keys(extra || {}).forEach(function(key) {
    field[key] = extra[key];
  });
  return field;
}

function smartCaptureChooseField_(candidates) {
  return (candidates || []).filter(Boolean).sort(function(a, b) {
    const sourceDifference = (SMART_CAPTURE_CONFIG.SOURCE_PRIORITY[b.source] || 0) -
      (SMART_CAPTURE_CONFIG.SOURCE_PRIORITY[a.source] || 0);
    return sourceDifference || b.confidence - a.confidence;
  })[0] || null;
}

function smartCaptureExtractBody_(text, now) {
  const match = text.match(/(?:вес(?:\s+сегодня)?|вешу)\s*[:=\-]?\s*(\d{2,3}(?:[.,]\d{1,2})?)\s*(?:кг)?/i);
  if (!match) return null;
  return {
    category: "BODY_TRACKING",
    confidence: 0.99,
    fields: {
      date: smartCaptureDateField_(text, now),
      weight: smartCaptureField_(smartCaptureNumber_(match[1]), 0.99, "EXPLICIT_USER_INPUT", match[0], {unit: "kg"})
    }
  };
}

function smartCaptureExtractWorkout_(text, now) {
  const fields = {date: smartCaptureDateField_(text, now)};
  const typePatterns = [
    ["Грудь", /грудь/i],
    ["Спина", /спина/i],
    ["Ноги", /ноги/i],
    ["Плечи", /плечи/i],
    ["Руки", /руки/i],
    ["Кардио", /кардио/i]
  ];
  typePatterns.some(function(entry) {
    const match = text.match(entry[1]);
    if (!match) return false;
    fields.training_type = smartCaptureField_(entry[0], 0.98, "EXPLICIT_USER_INPUT", match[0]);
    return true;
  });

  const exercisePatterns = [
    ["Жим", /жим/i],
    ["Приседания", /присед(?:ания|ы|ал|ала)?/i],
    ["Становая тяга", /станов(?:ая|ую)?\s+тяга/i],
    ["Подтягивания", /подтягиван/i],
    ["Тяга", /тяга/i]
  ];
  exercisePatterns.some(function(entry) {
    const match = text.match(entry[1]);
    if (!match) return false;
    fields.exercise = smartCaptureField_(entry[0], 0.98, "EXPLICIT_USER_INPUT", match[0]);
    return true;
  });

  const exerciseBlock = text.match(/(?:жим|присед(?:ания|ы|ал|ала)?|станов(?:ая|ую)?\s+тяга|подтягивания|тяга)[^.!?\n]*/i);
  const workoutText = exerciseBlock ? exerciseBlock[0] : text;
  const weightMatch = workoutText.match(/(\d{1,3}(?:[.,]\d+)?)\s*кг/i);
  if (weightMatch) {
    fields.weight = smartCaptureField_(smartCaptureNumber_(weightMatch[1]), 0.99, "EXPLICIT_USER_INPUT", weightMatch[0], {unit: "kg"});
  }
  const setRepMatch = workoutText.match(/(\d{1,3})\s*[xх×]\s*(\d{1,2})/i);
  if (setRepMatch) {
    fields.reps = smartCaptureField_(Number(setRepMatch[1]), 0.99, "EXPLICIT_USER_INPUT", setRepMatch[0]);
    fields.sets = smartCaptureField_(Number(setRepMatch[2]), 0.99, "EXPLICIT_USER_INPUT", setRepMatch[0]);
  } else {
    const repsMatch = workoutText.match(/(\d{1,3})\s*(?:повтор(?:ений|а)?|раз(?:а)?)/i);
    if (repsMatch) fields.reps = smartCaptureField_(Number(repsMatch[1]), 0.96, "EXPLICIT_USER_INPUT", repsMatch[0]);
  }

  return {
    category: "WORKOUT_LOG",
    confidence: fields.exercise && fields.weight ? 0.99 : 0.78,
    fields: fields
  };
}

function smartCaptureExtractNutrition_(text, now) {
  const foods = [];
  const definitions = [
    {name: "Курица", pattern: /куриц[а-яё]*\s*(\d+(?:[.,]\d+)?)\s*(?:грамм(?:а|ов)?|гр\.?|г)?/i, per100: {kcal: 165, protein: 31, fat: 3.6, carbs: 0}},
    {name: "Рис", pattern: /рис[а-яё]*\s*(\d+(?:[.,]\d+)?)\s*(?:грамм(?:а|ов)?|гр\.?|г)?/i, per100: {kcal: 130, protein: 2.7, fat: 0.3, carbs: 28}}
  ];
  const totals = {kcal: 0, protein: 0, fat: 0, carbs: 0};
  const rawParts = [];

  definitions.forEach(function(definition) {
    const match = text.match(definition.pattern);
    if (!match) return;
    const quantity = smartCaptureNumber_(match[1]);
    if (!quantity) return;
    foods.push({name: definition.name, quantity_g: quantity});
    rawParts.push(match[0]);
    const factor = quantity / 100;
    totals.kcal += definition.per100.kcal * factor;
    totals.protein += definition.per100.protein * factor;
    totals.fat += definition.per100.fat * factor;
    totals.carbs += definition.per100.carbs * factor;
  });

  const fields = {
    date: smartCaptureDateField_(text, now),
    foods: smartCaptureField_(foods, foods.length ? 0.98 : 0.40, "EXPLICIT_USER_INPUT", rawParts.join("; "))
  };
  if (foods.length) {
    fields.estimated_calories = smartCaptureField_(Math.round(totals.kcal), 0.55, "AI_EXTRACTION", rawParts.join("; "), {unit: "kcal", estimated: true});
    fields.estimated_protein = smartCaptureField_(smartCaptureRound_(totals.protein, 1), 0.55, "AI_EXTRACTION", rawParts.join("; "), {unit: "g", estimated: true});
    fields.estimated_fat = smartCaptureField_(smartCaptureRound_(totals.fat, 1), 0.55, "AI_EXTRACTION", rawParts.join("; "), {unit: "g", estimated: true});
    fields.estimated_carbs = smartCaptureField_(smartCaptureRound_(totals.carbs, 1), 0.55, "AI_EXTRACTION", rawParts.join("; "), {unit: "g", estimated: true});
    fields.nutrition_assumption = smartCaptureField_(
      "Курица и рис в готовом виде, без добавленного масла и соуса",
      0.45,
      "AI_EXTRACTION",
      rawParts.join("; "),
      {estimated: true}
    );
  }

  return {
    category: "NUTRITION_LOG",
    confidence: foods.length ? 0.98 : 0.45,
    fields: fields
  };
}

function smartCaptureExtractRecovery_(text, now) {
  const fields = {date: smartCaptureDateField_(text, now)};
  const sleepMatch = text.match(/спал(?:а)?\s*(\d{1,2}(?:[.,]\d+)?)\s*час/i);
  if (sleepMatch) {
    fields.sleep_hours = smartCaptureField_(smartCaptureNumber_(sleepMatch[1]), 0.99, "EXPLICIT_USER_INPUT", sleepMatch[0], {unit: "hours"});
  }
  const energyMatch = text.match(/энерги[яи]\s*[:=\-]?\s*(\d{1,2})(?:\s*(?:из|\/)[ ]?10)?/i);
  if (energyMatch) {
    fields.energy = smartCaptureField_(Number(energyMatch[1]), 0.98, "EXPLICIT_USER_INPUT", energyMatch[0], {scale: "1-10"});
  }
  const painMatch = text.match(/(?:боль|болит)\s*([^.,;!?]+)/i);
  if (painMatch) {
    fields.pain = smartCaptureField_(painMatch[1].trim(), 0.82, "EXPLICIT_USER_INPUT", painMatch[0]);
  }
  return {
    category: "RECOVERY_LOG",
    confidence: fields.sleep_hours || fields.energy ? 0.98 : 0.70,
    fields: fields
  };
}

function smartCaptureDateField_(text, now) {
  if (/сегодня/i.test(text)) {
    return smartCaptureField_(smartCaptureFormatDate_(now), 0.99, "EXPLICIT_USER_INPUT", "сегодня");
  }
  return smartCaptureField_(smartCaptureFormatDate_(now), 0.70, "AI_EXTRACTION", "message timestamp", {inferred: true});
}

function smartCaptureValidateCategory_(item, result) {
  const fields = item.fields || {};
  if (item.category === "BODY_TRACKING") {
    smartCaptureRequireField_(fields, "date", result);
    smartCaptureRequireField_(fields, "weight", result);
    const weight = smartCaptureValue_(fields.weight);
    if (weight != null && (weight < 30 || weight > 350)) result.errors.push("weight is outside 30-350 kg");
  }
  if (item.category === "WORKOUT_LOG") {
    ["date", "training_type", "exercise", "weight", "sets", "reps"].forEach(function(name) {
      smartCaptureRequireField_(fields, name, result);
    });
    const weight = smartCaptureValue_(fields.weight);
    const sets = smartCaptureValue_(fields.sets);
    const reps = smartCaptureValue_(fields.reps);
    if (weight != null && (weight <= 0 || weight > 500)) result.errors.push("workout weight is outside 0-500 kg");
    if (sets != null && (sets < 1 || sets > 20)) result.errors.push("sets are outside 1-20");
    if (reps != null && (reps < 1 || reps > 100)) result.errors.push("reps are outside 1-100");
  }
  if (item.category === "NUTRITION_LOG") {
    ["date", "foods"].forEach(function(name) { smartCaptureRequireField_(fields, name, result); });
    const foods = smartCaptureValue_(fields.foods) || [];
    if (!Array.isArray(foods) || !foods.length) result.errors.push("at least one food item is required");
    (foods || []).forEach(function(food) {
      if (!food.name || !(Number(food.quantity_g) > 0)) result.errors.push("food item requires name and positive quantity_g");
    });
    if (fields.estimated_calories) result.warnings.push("nutrition macros are estimated");
  }
  if (item.category === "RECOVERY_LOG") {
    smartCaptureRequireField_(fields, "date", result);
    if (!fields.sleep_hours && !fields.energy && !fields.pain) result.errors.push("at least one recovery metric is required");
    const sleep = smartCaptureValue_(fields.sleep_hours);
    const energy = smartCaptureValue_(fields.energy);
    if (sleep != null && (sleep < 0 || sleep > 24)) result.errors.push("sleep_hours are outside 0-24");
    if (energy != null && (energy < 1 || energy > 10)) result.errors.push("energy is outside 1-10");
  }
}

function smartCaptureRequireField_(fields, name, result) {
  if (!fields[name] || fields[name].value == null || fields[name].value === "") {
    result.errors.push("required field is missing: " + name);
  }
}

function smartCaptureAddBodyConfirmation_(lines, item) {
  lines.push("Вес:");
  lines.push(smartCaptureDisplayNumber_(smartCaptureValue_(item.fields.weight)) + " кг");
}

function smartCaptureAddWorkoutConfirmation_(lines, item) {
  const fields = item.fields || {};
  lines.push("Тренировка:");
  if (fields.training_type) lines.push(String(smartCaptureValue_(fields.training_type)));
  let exercise = fields.exercise ? String(smartCaptureValue_(fields.exercise)) : "Упражнение не определено";
  if (fields.weight) exercise += ": " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.weight)) + " кг";
  if (fields.reps) exercise += " × " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.reps)) + " повторений";
  if (fields.sets) exercise += " × " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.sets)) + " подхода";
  lines.push(exercise);
}

function smartCaptureAddNutritionConfirmation_(lines, item) {
  const fields = item.fields || {};
  lines.push("Питание:");
  (smartCaptureValue_(fields.foods) || []).forEach(function(food) {
    lines.push(food.name + ": " + smartCaptureDisplayNumber_(food.quantity_g) + " г");
  });
  if (fields.estimated_calories) {
    lines.push(
      "Оценка: ≈" + smartCaptureDisplayNumber_(smartCaptureValue_(fields.estimated_calories)) + " ккал; " +
      "Б " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.estimated_protein)) + " г; " +
      "Ж " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.estimated_fat)) + " г; " +
      "У " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.estimated_carbs)) + " г"
    );
  }
}

function smartCaptureAddRecoveryConfirmation_(lines, item) {
  const fields = item.fields || {};
  lines.push("Восстановление:");
  if (fields.sleep_hours) lines.push("Сон: " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.sleep_hours)) + " часов");
  if (fields.energy) lines.push("Энергия: " + smartCaptureDisplayNumber_(smartCaptureValue_(fields.energy)) + " из 10");
  if (fields.pain) lines.push("Боль: " + smartCaptureValue_(fields.pain));
}

function smartCaptureAssertExpectedFields_(capture, expected, errors) {
  Object.keys(expected || {}).forEach(function(category) {
    const item = smartCaptureItem_(capture, category);
    if (!item) {
      errors.push("Missing item " + category);
      return;
    }
    const values = expected[category];
    Object.keys(values).forEach(function(fieldName) {
      let actual;
      if (fieldName === "food_count") actual = (smartCaptureValue_(item.fields.foods) || []).length;
      else if (fieldName === "chicken_g") actual = smartCaptureFoodQuantity_(item, "Курица");
      else if (fieldName === "rice_g") actual = smartCaptureFoodQuantity_(item, "Рис");
      else actual = smartCaptureValue_(item.fields[fieldName]);
      if (!smartCaptureSameValue_(actual, values[fieldName])) {
        errors.push(category + "." + fieldName + " expected " + values[fieldName] + ", got " + actual);
      }
    });
  });
}

function smartCaptureAssertFieldMetadata_(capture, errors) {
  (capture.items || []).forEach(function(item) {
    Object.keys(item.fields || {}).forEach(function(fieldName) {
      const field = item.fields[fieldName];
      if (!field || typeof field.confidence !== "number" || !SMART_CAPTURE_CONFIG.SOURCE_PRIORITY[field.source]) {
        errors.push("Field metadata missing: " + item.category + "." + fieldName);
      }
    });
  });
}

function smartCaptureItem_(capture, category) {
  return (capture.items || []).filter(function(item) { return item.category === category; })[0] || null;
}

function smartCaptureFoodQuantity_(item, name) {
  const foods = smartCaptureValue_(item.fields.foods) || [];
  const match = foods.filter(function(food) { return food.name === name; })[0];
  return match ? match.quantity_g : null;
}

function smartCaptureValue_(field) {
  return field && typeof field === "object" && "value" in field ? field.value : null;
}

function smartCaptureNormalizeText_(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/[\t ]+/g, " ").trim();
}

function smartCaptureNumber_(value) {
  const number = Number(String(value || "").replace(",", "."));
  return isFinite(number) ? number : null;
}

function smartCaptureClampConfidence_(value) {
  const number = Number(value);
  if (!isFinite(number)) return 0;
  return Math.max(0, Math.min(1, smartCaptureRound_(number, 2)));
}

function smartCaptureRound_(value, digits) {
  const factor = Math.pow(10, Number(digits) || 0);
  return Math.round(Number(value) * factor) / factor;
}

function smartCaptureDisplayNumber_(value) {
  return String(value == null ? "" : value).replace(".", ",");
}

function smartCaptureSameValue_(actual, expected) {
  if (typeof expected === "number") return Math.abs(Number(actual) - expected) < 0.0001;
  return String(actual) === String(expected);
}

function smartCaptureFormatDate_(date) {
  return Utilities.formatDate(date, SMART_CAPTURE_CONFIG.TIME_ZONE, "yyyy-MM-dd");
}

function smartCaptureTestCaptureId_(text, date) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(date.getTime()) + "|" + String(text),
    Utilities.Charset.UTF_8
  );
  return "test-" + digest.slice(0, 8).map(function(byte) {
    return (byte + 256).toString(16).slice(-2);
  }).join("");
}
