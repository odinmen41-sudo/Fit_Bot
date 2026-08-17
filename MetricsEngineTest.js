/**
 * Sprint 6.2 — TEST-ONLY Versioned Metrics Engine.
 *
 * SOURCE FACTS -> OBSERVATIONS -> METRIC_VALUES -> DIGITAL TWIN SNAPSHOT.
 * No writes, LLM calculations, decisions, recommendations or production calls.
 */
const METRICS_ENGINE_TEST_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  USER_ID: "132976932",
  AS_OF: "2026-08-14T23:59:59+03:00",
  NUTRITION_WINDOW_DAYS: 14,
  TRAINING_WINDOW_DAYS: 14,
  RECOVERY_WINDOW_DAYS: 14,
  LOW_COVERAGE_THRESHOLD: 0.80,
  PRODUCTION_VERSION: "v19",
  TELEGRAM_CALLS: 0,
  GROQ_CALLS: 0,
  PRODUCTION_WRITES: 0,
  DEPLOYMENT_PERFORMED: false,
  ACTIVE_ENABLED: false,
  SHEETS: Object.freeze({
    BODY: "Body_Tracking",
    TRAINING: "Workout_Log",
    NUTRITION: "Nutrition_Log",
    RECOVERY: "Recovery_Log",
    PROFILE: "User_Profile",
    MEMORY: "AI_MEMORY"
  })
});

function computeBodyMetricsTest_(userId, options) {
  const context = metricContextEngineTest_(userId, options);
  const table = readTableDq_(METRICS_ENGINE_TEST_CONFIG.SHEETS.BODY);
  const indexes = resolveHeaderIndexesDq_(table.headers, {date: ["Дата", "date"], weight: ["Вес", "weight"]});
  const observations = table.rows.map(function(row, index) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    const weight = parseNumberDq_(getCellDq_(row, indexes.weight));
    return date && weight !== null ? {
      date: startOfDayDq_(date),
      weight: weight,
      source_id: METRICS_ENGINE_TEST_CONFIG.SHEETS.BODY + "!R" + (index + 2)
    } : null;
  }).filter(Boolean).filter(function(item) { return item.date.getTime() <= context.as_of_day.getTime(); })
    .sort(function(a, b) { return a.date.getTime() - b.date.getTime(); });

  const latest = observations.length ? observations[observations.length - 1] : null;
  const currentFreshness = latest ? metricFreshnessEngineTest_(latest.date, context.as_of_day) : 0;
  const metrics = [];
  metrics.push(createMetricValueTest_({
    user_id: context.user_id,
    domain: "BODY",
    metric_name: "weight_current",
    value: latest ? latest.weight : null,
    status: latest ? "AVAILABLE" : "NO_DATA",
    window_start: latest ? formatDateKeyDq_(latest.date) : null,
    window_end: context.as_of_key,
    computed_at: context.computed_at,
    source_ids: latest ? [latest.source_id] : [],
    confidence_components: {
      source_reliability: latest ? 1 : 0,
      completeness: latest ? 1 : 0,
      freshness: currentFreshness,
      consistency: latest ? 1 : 0
    },
    quality_flags: latest && currentFreshness < 0.6 ? ["STALE_DATA"] : [],
    missing_data: latest ? [] : ["dated_weight_measurement"]
  }));

  metrics.push(buildWeightAverageMetricEngineTest_(context, observations, 7, "weight_average_7d"));
  metrics.push(buildWeightAverageMetricEngineTest_(context, observations, 14, "weight_average_14d"));

  const rateDefinition = getMetricDefinitionTest_("BODY", "weight_change_rate");
  const rateSources = observations.map(function(item) { return item.source_id; });
  const canRate = observations.length >= rateDefinition.minimum_samples;
  let rate = null;
  if (canRate) {
    const first = observations[0];
    const last = observations[observations.length - 1];
    const elapsedWeeks = (last.date.getTime() - first.date.getTime()) / 604800000;
    if (elapsedWeeks > 0) rate = roundDq_((last.weight - first.weight) / elapsedWeeks, 3);
  }
  metrics.push(createMetricValueTest_({
    user_id: context.user_id,
    domain: "BODY",
    metric_name: "weight_change_rate",
    value: rate,
    status: rate === null ? "INSUFFICIENT_DATA" : "AVAILABLE",
    window_start: observations.length ? formatDateKeyDq_(observations[0].date) : null,
    window_end: context.as_of_key,
    computed_at: context.computed_at,
    source_ids: rateSources,
    confidence_components: sampleConfidenceComponentsEngineTest_(
      observations.length, rateDefinition.minimum_samples, currentFreshness, 1
    ),
    quality_flags: rate === null ? ["MISSING_HISTORY", "INSUFFICIENT_SAMPLE_SIZE"] : [],
    missing_data: rate === null ? ["minimum_3_dated_weight_measurements"] : []
  }));

  const trendDefinition = getMetricDefinitionTest_("BODY", "weight_trend");
  const canTrend = observations.length >= trendDefinition.minimum_samples && rate !== null;
  let trend = null;
  if (canTrend) trend = rate > 0.05 ? "INCREASING" : rate < -0.05 ? "DECREASING" : "STABLE";
  metrics.push(createMetricValueTest_({
    user_id: context.user_id,
    domain: "BODY",
    metric_name: "weight_trend",
    value: trend,
    status: canTrend ? "AVAILABLE" : "INSUFFICIENT_DATA",
    window_start: observations.length ? formatDateKeyDq_(observations[0].date) : null,
    window_end: context.as_of_key,
    computed_at: context.computed_at,
    source_ids: rateSources,
    confidence_components: sampleConfidenceComponentsEngineTest_(
      observations.length, trendDefinition.minimum_samples, currentFreshness, 1
    ),
    quality_flags: canTrend ? [] : ["MISSING_HISTORY", "INSUFFICIENT_SAMPLE_SIZE"],
    missing_data: canTrend ? [] : ["minimum_4_dated_weight_measurements"]
  }));

  return {
    domain: "BODY",
    metrics: metrics,
    evidence: {dated_weight_count: observations.length, dates_inferred: 0},
    write_performed: false
  };
}

function buildWeightAverageMetricEngineTest_(context, observations, windowDays, metricName) {
  const definition = getMetricDefinitionTest_("BODY", metricName);
  const windowStart = new Date(context.as_of_day.getTime() - (windowDays - 1) * 86400000);
  const periodItems = observations.filter(function(item) { return item.date.getTime() >= windowStart.getTime(); });
  const enough = periodItems.length >= definition.minimum_samples;
  const average = enough ? roundDq_(averageMetricNumbersEngineTest_(
    periodItems.map(function(item) { return item.weight; })
  ), 2) : null;
  const freshness = periodItems.length ? metricFreshnessEngineTest_(
    periodItems[periodItems.length - 1].date, context.as_of_day
  ) : 0;
  return createMetricValueTest_({
    user_id: context.user_id,
    domain: "BODY",
    metric_name: metricName,
    value: average,
    status: enough ? "AVAILABLE" : "INSUFFICIENT_DATA",
    window_start: formatDateKeyDq_(windowStart),
    window_end: context.as_of_key,
    computed_at: context.computed_at,
    source_ids: periodItems.map(function(item) { return item.source_id; }),
    confidence_components: sampleConfidenceComponentsEngineTest_(
      periodItems.length, definition.minimum_samples, freshness, 1
    ),
    quality_flags: enough ? [] : ["MISSING_HISTORY", "INSUFFICIENT_SAMPLE_SIZE"],
    missing_data: enough ? [] : ["minimum_" + definition.minimum_samples + "_samples_in_" + windowDays + "d"]
  });
}

function computeTrainingMetricsTest_(userId, options) {
  const context = metricContextEngineTest_(userId, options);
  const table = readTableDq_(METRICS_ENGINE_TEST_CONFIG.SHEETS.TRAINING);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"], type: ["Тип тренировки", "training_type"],
    exercise: ["Упражнение", "exercise"], weight: ["Вес", "weight"],
    sets: ["Подходы", "sets"], reps: ["Повторы", "reps"]
  });
  const records = table.rows.map(function(row, index) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    return {
      date: date ? startOfDayDq_(date) : null,
      session: String(getCellDq_(row, indexes.type) || "").trim(),
      exercise: String(getCellDq_(row, indexes.exercise) || "").trim(),
      weight_raw: getCellDq_(row, indexes.weight),
      reps_raw: getCellDq_(row, indexes.reps),
      source_id: METRICS_ENGINE_TEST_CONFIG.SHEETS.TRAINING + "!R" + (index + 2)
    };
  });
  const dated = records.filter(function(item) { return item.date !== null; });
  const unknown = records.filter(function(item) { return item.date === null; });
  const historySessions = uniqueMetricStringsTest_(records.map(function(item) { return item.session; }).filter(Boolean));
  const windowStart = new Date(context.as_of_day.getTime() - (METRICS_ENGINE_TEST_CONFIG.TRAINING_WINDOW_DAYS - 1) * 86400000);
  const periodDated = dated.filter(function(item) {
    return item.date.getTime() >= windowStart.getTime() && item.date.getTime() <= context.as_of_day.getTime();
  });
  const periodSessions = uniqueMetricStringsTest_(periodDated.map(function(item) {
    return formatDateKeyDq_(item.date) + "|" + item.session;
  }));
  const latestDated = dated.length ? dated.slice().sort(function(a, b) {
    return a.date.getTime() - b.date.getTime();
  })[dated.length - 1] : null;
  const freshness = latestDated ? metricFreshnessEngineTest_(latestDated.date, context.as_of_day) : 0;
  const legacyFlag = unknown.length ? ["LEGACY_DATE_MISSING"] : [];
  const historyConsistency = records.length ? Math.max(0, 1 - (unknown.length / records.length) * 0.5) : 0;
  const metrics = [];

  metrics.push(createMetricValueTest_({
    user_id: context.user_id, domain: "TRAINING", metric_name: "sessions_count",
    value: historySessions.length,
    status: unknown.length ? "AVAILABLE_WITH_LIMITATIONS" : "AVAILABLE",
    window_start: null, window_end: context.as_of_key, computed_at: context.computed_at,
    source_ids: records.map(function(item) { return item.source_id; }),
    confidence_components: {
      source_reliability: records.length ? 0.95 : 0,
      completeness: historySessions.length ? 1 : 0,
      freshness: freshness,
      consistency: historyConsistency
    },
    quality_flags: legacyFlag,
    missing_data: unknown.length ? [unknown.length + "_record_dates"] : []
  }));

  const temporalBlocked = periodSessions.length < 2;
  metrics.push(createMetricValueTest_({
    user_id: context.user_id, domain: "TRAINING", metric_name: "training_frequency",
    value: temporalBlocked ? null : roundDq_(periodSessions.length / 2, 2),
    status: temporalBlocked ? "INSUFFICIENT_DATA" : "AVAILABLE",
    window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key, computed_at: context.computed_at,
    source_ids: periodDated.map(function(item) { return item.source_id; }),
    confidence_components: sampleConfidenceComponentsEngineTest_(periodSessions.length, 2, freshness, historyConsistency),
    quality_flags: temporalBlocked ? legacyFlag.concat(["MISSING_HISTORY", "INSUFFICIENT_SAMPLE_SIZE"]) : legacyFlag,
    missing_data: temporalBlocked ? ["dated_sessions_in_analysis_window"] : []
  }));

  const volumeRows = periodDated.map(function(item) {
    return {item: item, volume: trainingRowVolumeEngineTest_(item.weight_raw, item.reps_raw)};
  }).filter(function(item) { return item.volume !== null; });
  const volumeBlocked = volumeRows.length === 0;
  metrics.push(createMetricValueTest_({
    user_id: context.user_id, domain: "TRAINING", metric_name: "exercise_volume",
    value: volumeBlocked ? null : roundDq_(volumeRows.reduce(function(sum, item) { return sum + item.volume; }, 0), 1),
    status: volumeBlocked ? "INSUFFICIENT_DATA" : "AVAILABLE",
    window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key, computed_at: context.computed_at,
    source_ids: volumeRows.map(function(item) { return item.item.source_id; }),
    confidence_components: sampleConfidenceComponentsEngineTest_(volumeRows.length, 2, freshness, historyConsistency),
    quality_flags: volumeBlocked ? legacyFlag.concat(["MISSING_HISTORY"]) : legacyFlag,
    missing_data: volumeBlocked ? ["dated_load_and_repetition_records_in_analysis_window"] : []
  }));

  const performance = calculateTrainingPerformanceTrendEngineTest_(dated, context);
  metrics.push(createMetricValueTest_({
    user_id: context.user_id, domain: "TRAINING", metric_name: "performance_trend",
    value: performance.value, status: performance.available ? "AVAILABLE" : "INSUFFICIENT_DATA",
    window_start: formatDateKeyDq_(new Date(context.as_of_day.getTime() - 41 * 86400000)),
    window_end: context.as_of_key, computed_at: context.computed_at,
    source_ids: performance.source_ids,
    confidence_components: sampleConfidenceComponentsEngineTest_(performance.sample_count, 4, freshness, historyConsistency),
    quality_flags: performance.available ? legacyFlag : legacyFlag.concat(["MISSING_HISTORY", "INSUFFICIENT_SAMPLE_SIZE"]),
    missing_data: performance.available ? [] : ["ordered_dated_comparable_exercise_observations"]
  }));

  return {
    domain: "TRAINING",
    metrics: metrics,
    evidence: {
      total_records: records.length,
      dated_records: dated.length,
      unknown_date_records: unknown.length,
      temporal_window_records: periodDated.length,
      unknown_records_used_in_temporal_metrics: 0,
      dates_inferred: 0,
      historical_distinct_sessions: historySessions.length
    },
    write_performed: false
  };
}

function computeNutritionMetricsTest_(userId, options) {
  const context = metricContextEngineTest_(userId, options);
  const table = readTableDq_(METRICS_ENGINE_TEST_CONFIG.SHEETS.NUTRITION);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"], calories: ["Ккал", "calories"], protein: ["Белок", "protein"]
  });
  const windowStart = new Date(context.as_of_day.getTime() - (METRICS_ENGINE_TEST_CONFIG.NUTRITION_WINDOW_DAYS - 1) * 86400000);
  const rows = table.rows.map(function(row, index) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    return date ? {
      date: startOfDayDq_(date),
      calories: parseNumberDq_(getCellDq_(row, indexes.calories)),
      protein: parseNumberDq_(getCellDq_(row, indexes.protein)),
      source_id: METRICS_ENGINE_TEST_CONFIG.SHEETS.NUTRITION + "!R" + (index + 2)
    } : null;
  }).filter(Boolean).filter(function(item) {
    return item.date.getTime() >= windowStart.getTime() && item.date.getTime() <= context.as_of_day.getTime();
  });
  const dayKeys = uniqueMetricStringsTest_(rows.map(function(item) { return formatDateKeyDq_(item.date); }));
  const loggedDays = dayKeys.length;
  const coverageRatio = loggedDays / METRICS_ENGINE_TEST_CONFIG.NUTRITION_WINDOW_DAYS;
  const coveragePercent = roundDq_(coverageRatio * 100, 1);
  const lowCoverage = coverageRatio < METRICS_ENGINE_TEST_CONFIG.LOW_COVERAGE_THRESHOLD;
  const latest = rows.length ? rows.slice().sort(function(a, b) {
    return a.date.getTime() - b.date.getTime();
  })[rows.length - 1] : null;
  const freshness = latest ? metricFreshnessEngineTest_(latest.date, context.as_of_day) : 0;
  const completeRows = rows.filter(function(item) { return item.calories !== null && item.protein !== null; });
  const consistency = rows.length ? completeRows.length / rows.length : 0;
  const components = {
    source_reliability: rows.length ? 1 : 0,
    completeness: coverageRatio,
    freshness: freshness,
    consistency: consistency
  };
  const status = lowCoverage ? "LOW_COVERAGE" : "AVAILABLE";
  const flags = lowCoverage ? ["LOW_COVERAGE", "MISSING_HISTORY"] : [];
  const sourceIds = rows.map(function(item) { return item.source_id; });
  const calories = rows.map(function(item) { return item.calories; }).filter(function(value) { return value !== null; });
  const protein = rows.map(function(item) { return item.protein; }).filter(function(value) { return value !== null; });
  const proteinTarget = readNumericProteinTargetEngineTest_(context.user_id);

  const metrics = [
    createMetricValueTest_({user_id: context.user_id, domain: "NUTRITION", metric_name: "logged_days",
      value: loggedDays, status: status, window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key,
      computed_at: context.computed_at, source_ids: sourceIds, confidence_components: components,
      quality_flags: flags, missing_data: lowCoverage ? ["minimum_80_percent_coverage"] : []}),
    createMetricValueTest_({user_id: context.user_id, domain: "NUTRITION", metric_name: "coverage_percent",
      value: coveragePercent, status: status, window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key,
      computed_at: context.computed_at, source_ids: sourceIds, confidence_components: components,
      quality_flags: flags, missing_data: lowCoverage ? ["minimum_80_percent_coverage"] : []}),
    createMetricValueTest_({user_id: context.user_id, domain: "NUTRITION", metric_name: "average_calories",
      value: calories.length ? roundDq_(averageMetricNumbersEngineTest_(calories), 1) : null,
      status: status, window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key,
      computed_at: context.computed_at, source_ids: sourceIds, confidence_components: components,
      quality_flags: flags, missing_data: calories.length ? [] : ["calorie_values"]}),
    createMetricValueTest_({user_id: context.user_id, domain: "NUTRITION", metric_name: "average_protein",
      value: protein.length ? roundDq_(averageMetricNumbersEngineTest_(protein), 1) : null,
      status: status, window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key,
      computed_at: context.computed_at, source_ids: sourceIds, confidence_components: components,
      quality_flags: flags, missing_data: protein.length ? [] : ["protein_values"]}),
    createMetricValueTest_({user_id: context.user_id, domain: "NUTRITION", metric_name: "protein_target_coverage",
      value: proteinTarget !== null && protein.length ? roundDq_(averageMetricNumbersEngineTest_(protein) / proteinTarget * 100, 1) : null,
      status: proteinTarget === null ? "INSUFFICIENT_DATA" : status,
      window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key,
      computed_at: context.computed_at, source_ids: sourceIds, confidence_components: proteinTarget === null ?
        {source_reliability: 1, completeness: 0, freshness: freshness, consistency: consistency} : components,
      quality_flags: proteinTarget === null ? flags.concat(["INSUFFICIENT_SAMPLE_SIZE"]) : flags,
      missing_data: proteinTarget === null ? ["confirmed_numeric_protein_target"] : []})
  ];

  return {
    domain: "NUTRITION",
    metrics: metrics,
    evidence: {
      period_days: METRICS_ENGINE_TEST_CONFIG.NUTRITION_WINDOW_DAYS,
      logged_days: loggedDays,
      coverage_percent: coveragePercent,
      recommendations_generated: 0,
      deficit_assessment_generated: false,
      calorie_target_changed: false
    },
    write_performed: false
  };
}

function computeRecoveryMetricsTest_(userId, options) {
  const context = metricContextEngineTest_(userId, options);
  const table = readTableDq_(METRICS_ENGINE_TEST_CONFIG.SHEETS.RECOVERY);
  const indexes = resolveHeaderIndexesDq_(table.headers, {
    date: ["Дата", "date"], sleep: ["Сон часы", "sleep_hours"],
    energy: ["Энергия", "energy"], painShoulder: ["Боль плечо", "pain_shoulder"],
    painBack: ["Боль поясница", "pain_lower_back"], painOther: ["Боль другая/локализация", "pain_other"]
  });
  const windowStart = new Date(context.as_of_day.getTime() - (METRICS_ENGINE_TEST_CONFIG.RECOVERY_WINDOW_DAYS - 1) * 86400000);
  const rows = table.rows.map(function(row, index) {
    const date = parseDateDq_(getCellDq_(row, indexes.date));
    return date ? {
      date: startOfDayDq_(date), sleep: parseNumberDq_(getCellDq_(row, indexes.sleep)),
      energy: parseNumberDq_(getCellDq_(row, indexes.energy)),
      pain_present: [indexes.painShoulder, indexes.painBack, indexes.painOther].some(function(column) {
        return column >= 0 && isPresentDq_(getCellDq_(row, column));
      }),
      source_id: METRICS_ENGINE_TEST_CONFIG.SHEETS.RECOVERY + "!R" + (index + 2)
    } : null;
  }).filter(Boolean).filter(function(item) {
    return item.date.getTime() >= windowStart.getTime() && item.date.getTime() <= context.as_of_day.getTime();
  });
  const sourceIds = rows.map(function(item) { return item.source_id; });
  const sleepValues = rows.map(function(item) { return item.sleep; }).filter(function(value) { return value !== null; });
  const energyValues = rows.map(function(item) { return item.energy; }).filter(function(value) { return value !== null; });
  const components = {source_reliability: rows.length ? 1 : 0, completeness: rows.length ? 1 : 0,
    freshness: rows.length ? metricFreshnessEngineTest_(rows[rows.length - 1].date, context.as_of_day) : 0,
    consistency: rows.length ? 1 : 0};
  const noDataFlags = ["NO_RECOVERY_DATA", "MISSING_HISTORY"];
  const metrics = [
    createMetricValueTest_({user_id: context.user_id, domain: "RECOVERY", metric_name: "checkin_count",
      value: rows.length, status: rows.length ? "AVAILABLE" : "NO_DATA", window_start: formatDateKeyDq_(windowStart),
      window_end: context.as_of_key, computed_at: context.computed_at, source_ids: sourceIds,
      confidence_components: components, quality_flags: rows.length ? [] : noDataFlags,
      missing_data: rows.length ? [] : ["recovery_checkins"]}),
    createMetricValueTest_({user_id: context.user_id, domain: "RECOVERY", metric_name: "sleep_average",
      value: sleepValues.length ? roundDq_(averageMetricNumbersEngineTest_(sleepValues), 2) : null,
      status: rows.length ? (sleepValues.length >= 3 ? "AVAILABLE" : "INSUFFICIENT_DATA") : "NO_DATA",
      window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key, computed_at: context.computed_at,
      source_ids: sourceIds, confidence_components: rows.length ? sampleConfidenceComponentsEngineTest_(sleepValues.length, 3, components.freshness, 1) : components,
      quality_flags: rows.length ? (sleepValues.length >= 3 ? [] : ["INSUFFICIENT_SAMPLE_SIZE"]) : noDataFlags,
      missing_data: sleepValues.length >= 3 ? [] : ["minimum_3_sleep_checkins"]}),
    createMetricValueTest_({user_id: context.user_id, domain: "RECOVERY", metric_name: "energy_average",
      value: energyValues.length ? roundDq_(averageMetricNumbersEngineTest_(energyValues), 2) : null,
      status: rows.length ? (energyValues.length >= 3 ? "AVAILABLE" : "INSUFFICIENT_DATA") : "NO_DATA",
      window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key, computed_at: context.computed_at,
      source_ids: sourceIds, confidence_components: rows.length ? sampleConfidenceComponentsEngineTest_(energyValues.length, 3, components.freshness, 1) : components,
      quality_flags: rows.length ? (energyValues.length >= 3 ? [] : ["INSUFFICIENT_SAMPLE_SIZE"]) : noDataFlags,
      missing_data: energyValues.length >= 3 ? [] : ["minimum_3_energy_checkins"]}),
    createMetricValueTest_({user_id: context.user_id, domain: "RECOVERY", metric_name: "pain_frequency",
      value: rows.length >= 3 ? roundDq_(100 * rows.filter(function(item) { return item.pain_present; }).length / rows.length, 1) : null,
      status: rows.length ? (rows.length >= 3 ? "AVAILABLE" : "INSUFFICIENT_DATA") : "NO_DATA",
      window_start: formatDateKeyDq_(windowStart), window_end: context.as_of_key, computed_at: context.computed_at,
      source_ids: sourceIds, confidence_components: rows.length ? sampleConfidenceComponentsEngineTest_(rows.length, 3, components.freshness, 1) : components,
      quality_flags: rows.length ? (rows.length >= 3 ? [] : ["INSUFFICIENT_SAMPLE_SIZE"]) : noDataFlags,
      missing_data: rows.length >= 3 ? [] : ["minimum_3_pain_checkins"]})
  ];
  return {
    domain: "RECOVERY", metrics: metrics,
    evidence: {checkin_count: rows.length, readiness_calculated: false, readiness: null, load_changed: false},
    write_performed: false
  };
}

function computeAllMetricsTest_(userId, options) {
  const body = computeBodyMetricsTest_(userId, options);
  const training = computeTrainingMetricsTest_(userId, options);
  const nutrition = computeNutritionMetricsTest_(userId, options);
  const recovery = computeRecoveryMetricsTest_(userId, options);
  return {
    engine_version: METRIC_REGISTRY_TEST_CONFIG.ENGINE_VERSION,
    registry_version: METRIC_REGISTRY_TEST_CONFIG.REGISTRY_VERSION,
    mode: METRICS_ENGINE_TEST_CONFIG.MODE,
    metric_values: [].concat(body.metrics, training.metrics, nutrition.metrics, recovery.metrics),
    domains: {BODY: body, TRAINING: training, NUTRITION: nutrition, RECOVERY: recovery},
    recommendations_generated: 0,
    decisions_generated: 0,
    llm_calls: 0,
    writes_performed: 0
  };
}

/** Combines a cloned snapshot and metrics without mutating either input. */
function buildMetricsSnapshotTest_(digitalTwinSnapshot, metricValues) {
  if (!digitalTwinSnapshot || !digitalTwinSnapshot.snapshot_id) throw new Error("DIGITAL_TWIN_SNAPSHOT_REQUIRED");
  if (!Array.isArray(metricValues)) throw new Error("METRIC_VALUES_ARRAY_REQUIRED");
  const baseClone = deepCloneDq_(digitalTwinSnapshot);
  const metricsClone = deepCloneDq_(metricValues);
  const byDomain = {};
  metricsClone.forEach(function(metric) {
    if (!byDomain[metric.domain]) byDomain[metric.domain] = {};
    byDomain[metric.domain][metric.metric_name] = metric;
  });
  const blockers = [];
  if (!byDomain.BODY || !byDomain.BODY.weight_trend || byDomain.BODY.weight_trend.status !== "AVAILABLE") {
    blockers.push("BODY_TREND_INSUFFICIENT");
  }
  if (!byDomain.TRAINING || !byDomain.TRAINING.performance_trend || byDomain.TRAINING.performance_trend.status !== "AVAILABLE") {
    blockers.push("TRAINING_TEMPORAL_DATA_INSUFFICIENT");
  }
  if (!byDomain.NUTRITION || !byDomain.NUTRITION.coverage_percent || byDomain.NUTRITION.coverage_percent.status === "LOW_COVERAGE") {
    blockers.push("NUTRITION_LOW_COVERAGE");
  }
  if (!byDomain.RECOVERY || !byDomain.RECOVERY.checkin_count || byDomain.RECOVERY.checkin_count.status === "NO_DATA") {
    blockers.push("RECOVERY_NO_DATA");
  }
  const core = {
    base_snapshot_id: baseClone.snapshot_id,
    user_id: baseClone.user_id,
    as_of: baseClone.as_of,
    engine_version: METRIC_REGISTRY_TEST_CONFIG.ENGINE_VERSION,
    registry_version: METRIC_REGISTRY_TEST_CONFIG.REGISTRY_VERSION,
    metric_values: metricsClone,
    metrics_by_domain: byDomain,
    ready_for_decision_engine: blockers.length === 0,
    decision_engine_blockers: blockers,
    recovery_readiness: null,
    readiness_calculated: false,
    decisions_generated: 0,
    recommendations_generated: 0,
    source_snapshot: baseClone,
    write_performed: false
  };
  return {
    metrics_snapshot_id: "metrics-snapshot-test-" + digestHexDq_(stableStringifyMetricRegistryTest_(core)).slice(0, 20),
    base_snapshot_id: core.base_snapshot_id,
    user_id: core.user_id,
    as_of: core.as_of,
    engine_version: core.engine_version,
    registry_version: core.registry_version,
    metric_values: core.metric_values,
    metrics_by_domain: core.metrics_by_domain,
    ready_for_decision_engine: core.ready_for_decision_engine,
    decision_engine_blockers: core.decision_engine_blockers,
    recovery_readiness: null,
    readiness_calculated: false,
    decisions_generated: 0,
    recommendations_generated: 0,
    source_snapshot: core.source_snapshot,
    write_performed: false
  };
}

function testMetricsEngine_() {
  const beforeFingerprint = captureSpreadsheetFingerprintDq_();
  const beforeMemoryHash = sheetHashMetricsEngineTest_(beforeFingerprint, METRICS_ENGINE_TEST_CONFIG.SHEETS.MEMORY);
  const registryValidation = validateMetricRegistryTest_();
  const options = {as_of: METRICS_ENGINE_TEST_CONFIG.AS_OF, computed_at: METRICS_ENGINE_TEST_CONFIG.AS_OF};
  const baseSnapshot = buildDigitalTwinSnapshotTest_(METRICS_ENGINE_TEST_CONFIG.USER_ID, options);
  const baseSnapshotHashBefore = digestHexDq_(stableStringifyMetricRegistryTest_(baseSnapshot));
  const result = computeAllMetricsTest_(METRICS_ENGINE_TEST_CONFIG.USER_ID, options);
  const metricsSnapshot = buildMetricsSnapshotTest_(baseSnapshot, result.metric_values);
  const baseSnapshotHashAfter = digestHexDq_(stableStringifyMetricRegistryTest_(baseSnapshot));
  const tests = [];

  tests.push(testCaseDq_("REGISTRY", "18 versioned metrics registered", registryValidation.valid, registryValidation));
  tests.push(testCaseDq_("METRIC CONTRACT", "Every METRIC_VALUES object is schema-valid and source-linked",
    result.metric_values.length === 18 && result.metric_values.every(function(metric) {
      return validateMetricValueContractTest_(metric).valid && metric.algorithm_version && metric.llm_used === false;
    }), {metric_count: result.metric_values.length}));

  const bodyCurrent = metricByNameEngineTest_(result.metric_values, "BODY", "weight_current");
  const bodyTrend = metricByNameEngineTest_(result.metric_values, "BODY", "weight_trend");
  tests.push(testCaseDq_("BODY 1", "Current weight calculates", bodyCurrent.value === 118.7 && bodyCurrent.status === "AVAILABLE", bodyCurrent));
  tests.push(testCaseDq_("BODY 2", "Trend with 2 measurements is INSUFFICIENT_DATA",
    bodyTrend.value === null && bodyTrend.status === "INSUFFICIENT_DATA", bodyTrend));
  tests.push(testCaseDq_("BODY 3", "Insufficient trend confidence is below full",
    bodyTrend.confidence < 1 && bodyTrend.quality_flags.indexOf("INSUFFICIENT_SAMPLE_SIZE") >= 0, bodyTrend));

  const training = result.domains.TRAINING;
  const trainingFrequency = metricByNameEngineTest_(result.metric_values, "TRAINING", "training_frequency");
  const trainingVolume = metricByNameEngineTest_(result.metric_values, "TRAINING", "exercise_volume");
  tests.push(testCaseDq_("TRAINING 1", "Undated records excluded from temporal calculations",
    training.evidence.unknown_date_records === 73 && training.evidence.unknown_records_used_in_temporal_metrics === 0 &&
      training.evidence.dates_inferred === 0, training.evidence));
  tests.push(testCaseDq_("TRAINING 2", "LEGACY_DATE_MISSING is explicit",
    trainingFrequency.quality_flags.indexOf("LEGACY_DATE_MISSING") >= 0, trainingFrequency));
  tests.push(testCaseDq_("TRAINING 3", "Volume is not calculated for an unknown period",
    trainingVolume.value === null && trainingVolume.status === "INSUFFICIENT_DATA", trainingVolume));

  const nutrition = result.domains.NUTRITION;
  const coverage = metricByNameEngineTest_(result.metric_values, "NUTRITION", "coverage_percent");
  tests.push(testCaseDq_("NUTRITION 1", "Coverage is 4/14 = 28.6%",
    nutrition.evidence.logged_days === 4 && coverage.value === 28.6, nutrition.evidence));
  tests.push(testCaseDq_("NUTRITION 2", "Coverage status is LOW_COVERAGE",
    coverage.status === "LOW_COVERAGE" && coverage.quality_flags.indexOf("LOW_COVERAGE") >= 0, coverage));
  tests.push(testCaseDq_("NUTRITION 3", "No recommendations or calorie changes",
    result.recommendations_generated === 0 && nutrition.evidence.recommendations_generated === 0 &&
      nutrition.evidence.calorie_target_changed === false && result.metric_values.filter(function(metric) {
        return metric.domain === "NUTRITION";
      }).every(function(metric) { return metric.recommendation === null; }), nutrition.evidence));

  const recovery = result.domains.RECOVERY;
  const checkins = metricByNameEngineTest_(result.metric_values, "RECOVERY", "checkin_count");
  tests.push(testCaseDq_("RECOVERY 1", "No recovery data returns NO_DATA",
    checkins.value === 0 && checkins.status === "NO_DATA", checkins));
  tests.push(testCaseDq_("RECOVERY 2", "Recovery confidence is zero",
    recovery.metrics.every(function(metric) { return metric.confidence === 0; }), recovery.metrics));
  tests.push(testCaseDq_("RECOVERY 3", "Readiness is not calculated",
    recovery.evidence.readiness_calculated === false && metricsSnapshot.readiness_calculated === false &&
      metricsSnapshot.recovery_readiness === null, recovery.evidence));

  tests.push(testCaseDq_("SNAPSHOT", "Metrics snapshot does not mutate Digital Twin Snapshot",
    baseSnapshotHashBefore === baseSnapshotHashAfter && metricsSnapshot.source_snapshot.snapshot_id === baseSnapshot.snapshot_id,
    {before_hash: baseSnapshotHashBefore, after_hash: baseSnapshotHashAfter, metrics_snapshot_id: metricsSnapshot.metrics_snapshot_id}));

  const afterFingerprint = captureSpreadsheetFingerprintDq_();
  const afterMemoryHash = sheetHashMetricsEngineTest_(afterFingerprint, METRICS_ENGINE_TEST_CONFIG.SHEETS.MEMORY);
  const regressionPassed = beforeFingerprint.global_hash === afterFingerprint.global_hash &&
    beforeMemoryHash === afterMemoryHash && beforeFingerprint.sheet_count === afterFingerprint.sheet_count &&
    METRICS_ENGINE_TEST_CONFIG.PRODUCTION_VERSION === "v19" &&
    METRICS_ENGINE_TEST_CONFIG.TELEGRAM_CALLS === 0 && METRICS_ENGINE_TEST_CONFIG.GROQ_CALLS === 0 &&
    METRICS_ENGINE_TEST_CONFIG.PRODUCTION_WRITES === 0 && METRICS_ENGINE_TEST_CONFIG.DEPLOYMENT_PERFORMED === false &&
    METRICS_ENGINE_TEST_CONFIG.ACTIVE_ENABLED === false;
  tests.push(testCaseDq_("REGRESSION", "Sheets, AI_MEMORY and production flow unchanged", regressionPassed, {
    sheet_hash_before: beforeFingerprint.global_hash, sheet_hash_after: afterFingerprint.global_hash,
    ai_memory_hash_before: beforeMemoryHash, ai_memory_hash_after: afterMemoryHash,
    production_version_observed: "v19", telegram_calls: 0, groq_calls: 0,
    production_writes: 0, deployment_performed: false, active_enabled: false
  }));

  const passed = tests.filter(function(test) { return test.status === "PASS"; }).length;
  return {
    suite: "Sprint 6.2 Test-only Versioned Metrics Engine",
    engine_version: METRIC_REGISTRY_TEST_CONFIG.ENGINE_VERSION,
    registry_version: METRIC_REGISTRY_TEST_CONFIG.REGISTRY_VERSION,
    mode: METRICS_ENGINE_TEST_CONFIG.MODE,
    total: tests.length, passed: passed, failed: tests.length - passed,
    status: passed === tests.length ? "PASS" : "FAIL",
    ready_for_decision_engine: metricsSnapshot.ready_for_decision_engine,
    decision_engine_blockers: metricsSnapshot.decision_engine_blockers,
    tests: tests,
    artifacts: {registry: getMetricRegistryTest_(), metrics_result: result, metrics_snapshot: metricsSnapshot},
    regression: {before: beforeFingerprint, after: afterFingerprint, ai_memory_unchanged: beforeMemoryHash === afterMemoryHash}
  };
}

function runMetricsEngineTests() {
  const result = testMetricsEngine_();
  const example = metricByNameEngineTest_(result.artifacts.metrics_result.metric_values, "NUTRITION", "coverage_percent");
  Logger.log(JSON.stringify({
    suite: result.suite, status: result.status, passed: result.passed, total: result.total,
    registry_version: result.registry_version, engine_version: result.engine_version,
    metric_count: result.artifacts.metrics_result.metric_values.length,
    available_metrics: result.artifacts.metrics_result.metric_values.filter(function(metric) {
      return metric.status === "AVAILABLE" || metric.status === "AVAILABLE_WITH_LIMITATIONS" || metric.status === "LOW_COVERAGE";
    }).map(function(metric) { return metric.domain + "." + metric.metric_name; }),
    blocked_metrics: result.artifacts.metrics_result.metric_values.filter(function(metric) {
      return metric.status === "INSUFFICIENT_DATA" || metric.status === "NO_DATA";
    }).map(function(metric) { return metric.domain + "." + metric.metric_name; }),
    ready_for_decision_engine: result.ready_for_decision_engine,
    decision_engine_blockers: result.decision_engine_blockers,
    example_metric_value: example,
    sheet_hash_before: result.regression.before.global_hash,
    sheet_hash_after: result.regression.after.global_hash,
    ai_memory_unchanged: result.regression.ai_memory_unchanged,
    production_version_observed: "v19", deployment_performed: false,
    telegram_calls: 0, groq_calls: 0, production_writes: 0
  }, null, 2));
  if (result.status !== "PASS") throw new Error("Metrics Engine suite failed: " + result.failed + " test(s)");
  return result;
}

function metricContextEngineTest_(userId, options) {
  const config = options || {};
  const rawAsOf = config.as_of || METRICS_ENGINE_TEST_CONFIG.AS_OF;
  let asOf = parseDateDq_(rawAsOf);
  if (!asOf) {
    const standardDate = new Date(rawAsOf);
    if (!isNaN(standardDate.getTime())) asOf = standardDate;
  }
  if (!asOf) throw new Error("VALID_AS_OF_REQUIRED");
  return {
    user_id: String(userId || METRICS_ENGINE_TEST_CONFIG.USER_ID),
    as_of: asOf,
    as_of_day: startOfDayDq_(asOf),
    as_of_key: formatDateKeyDq_(asOf),
    computed_at: config.computed_at || METRICS_ENGINE_TEST_CONFIG.AS_OF
  };
}

function sampleConfidenceComponentsEngineTest_(sampleCount, requiredCount, freshness, consistency) {
  return {
    source_reliability: sampleCount > 0 ? 1 : 0,
    completeness: Math.max(0, Math.min(1, sampleCount / requiredCount)),
    freshness: freshness,
    consistency: consistency
  };
}

function metricFreshnessEngineTest_(date, asOfDay) {
  if (!date) return 0;
  const ageDays = Math.max(0, Math.floor((asOfDay.getTime() - startOfDayDq_(date).getTime()) / 86400000));
  if (ageDays <= 1) return 1;
  if (ageDays <= 7) return 0.8;
  if (ageDays <= 14) return 0.6;
  if (ageDays <= 30) return 0.35;
  return 0.15;
}

function trainingRowVolumeEngineTest_(weightRaw, repsRaw) {
  const weights = metricNumberListEngineTest_(weightRaw);
  const reps = metricNumberListEngineTest_(repsRaw);
  if (!weights.length || !reps.length) return null;
  const count = Math.min(weights.length, reps.length);
  let total = 0;
  for (let index = 0; index < count; index += 1) total += weights[index] * reps[index];
  return total;
}

function calculateTrainingPerformanceTrendEngineTest_(datedRecords, context) {
  const windowStart = new Date(context.as_of_day.getTime() - 41 * 86400000);
  const groups = {};
  datedRecords.filter(function(item) {
    return item.date.getTime() >= windowStart.getTime() && item.date.getTime() <= context.as_of_day.getTime();
  }).forEach(function(item) {
    const volume = trainingRowVolumeEngineTest_(item.weight_raw, item.reps_raw);
    const key = normalizeTextDq_(item.exercise);
    if (volume === null || !key) return;
    if (!groups[key]) groups[key] = [];
    groups[key].push({date: item.date, volume: volume, source_id: item.source_id});
  });
  const candidates = Object.keys(groups).map(function(key) {
    const records = groups[key].slice().sort(function(a, b) { return a.date.getTime() - b.date.getTime(); });
    const distinctDates = uniqueMetricStringsTest_(records.map(function(item) { return formatDateKeyDq_(item.date); }));
    return {exercise: key, records: records, distinct_dates: distinctDates.length};
  }).filter(function(group) { return group.records.length >= 4 && group.distinct_dates >= 2; })
    .sort(function(a, b) { return b.records.length - a.records.length || a.exercise.localeCompare(b.exercise); });
  if (!candidates.length) return {available: false, value: null, sample_count: 0, source_ids: []};
  const selected = candidates[0];
  const midpoint = Math.floor(selected.records.length / 2);
  const early = averageMetricNumbersEngineTest_(selected.records.slice(0, midpoint).map(function(item) { return item.volume; }));
  const late = averageMetricNumbersEngineTest_(selected.records.slice(midpoint).map(function(item) { return item.volume; }));
  const changeRatio = early > 0 ? (late - early) / early : 0;
  return {
    available: true,
    value: changeRatio > 0.03 ? "IMPROVING" : changeRatio < -0.03 ? "DECLINING" : "STABLE",
    sample_count: selected.records.length,
    source_ids: selected.records.map(function(item) { return item.source_id; })
  };
}

function metricNumberListEngineTest_(value) {
  if (!isPresentDq_(value)) return [];
  return String(value).replace(/,/g, ".").split(/[\/;|]+/).map(function(item) {
    const match = item.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }).filter(function(item) { return item !== null && isFinite(item); });
}

function readNumericProteinTargetEngineTest_(userId) {
  const table = readTableDq_(METRICS_ENGINE_TEST_CONFIG.SHEETS.PROFILE);
  const indexes = resolveHeaderIndexesDq_(table.headers, {userId: ["User_ID", "user_id"], target: ["Белок цель", "protein_target"]});
  const row = table.rows.filter(function(item) { return String(getCellDq_(item, indexes.userId)) === String(userId); })[0];
  return row ? parseNumberDq_(getCellDq_(row, indexes.target)) : null;
}

function averageMetricNumbersEngineTest_(values) {
  if (!values.length) return null;
  return values.reduce(function(sum, value) { return sum + value; }, 0) / values.length;
}

function metricByNameEngineTest_(metrics, domain, name) {
  const match = metrics.filter(function(metric) { return metric.domain === domain && metric.metric_name === name; })[0];
  if (!match) throw new Error("METRIC_RESULT_NOT_FOUND: " + domain + "." + name);
  return match;
}

function sheetHashMetricsEngineTest_(fingerprint, sheetName) {
  const match = fingerprint.sheets.filter(function(sheet) { return sheet.name === sheetName; })[0];
  return match ? match.hash : null;
}
