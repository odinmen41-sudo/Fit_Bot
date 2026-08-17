/**
 * Sprint 6.2 — TEST-ONLY Versioned Metric Registry.
 *
 * The registry is deterministic and contains no executable LLM, decision,
 * recommendation, write, Telegram or deployment behavior.
 */
const METRIC_REGISTRY_TEST_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  REGISTRY_VERSION: "metric-registry-test-v1.0",
  ENGINE_VERSION: "metrics-engine-test-v1.0",
  DEFAULT_USER_ID: "132976932",
  DEFAULT_AS_OF: "2026-08-14T23:59:59+03:00",
  PRODUCTION_VERSION: "v19",
  PRODUCTION_WRITES_ENABLED: false,
  TELEGRAM_CALLS: 0,
  GROQ_CALLS: 0,
  DEPLOYMENT_PERFORMED: false,
  ACTIVE_ENABLED: false,
  QUALITY_FLAGS: Object.freeze([
    "MISSING_HISTORY",
    "LOW_COVERAGE",
    "STALE_DATA",
    "NO_RECOVERY_DATA",
    "LEGACY_DATE_MISSING",
    "CONFLICTING_SOURCE",
    "INSUFFICIENT_SAMPLE_SIZE"
  ])
});

/** Returns the immutable logical registry as a fresh object. */
function getMetricRegistryTest_() {
  return {
    registry_version: METRIC_REGISTRY_TEST_CONFIG.REGISTRY_VERSION,
    engine_version: METRIC_REGISTRY_TEST_CONFIG.ENGINE_VERSION,
    mode: METRIC_REGISTRY_TEST_CONFIG.MODE,
    metrics: [
      metricDefinitionRegistryTest_("BODY", "weight_current", "kg", null, 1, "body.weight_current.v1"),
      metricDefinitionRegistryTest_("BODY", "weight_average_7d", "kg", 7, 2, "body.weight_average_7d.v1"),
      metricDefinitionRegistryTest_("BODY", "weight_average_14d", "kg", 14, 3, "body.weight_average_14d.v1"),
      metricDefinitionRegistryTest_("BODY", "weight_change_rate", "kg/week", 90, 3, "body.weight_change_rate.v1"),
      metricDefinitionRegistryTest_("BODY", "weight_trend", "direction", 90, 4, "body.weight_trend.v1"),

      metricDefinitionRegistryTest_("TRAINING", "sessions_count", "sessions", null, 1, "training.sessions_count.v1"),
      metricDefinitionRegistryTest_("TRAINING", "training_frequency", "sessions/week", 14, 2, "training.training_frequency.v1"),
      metricDefinitionRegistryTest_("TRAINING", "exercise_volume", "kg_repetitions", 14, 2, "training.exercise_volume.v1"),
      metricDefinitionRegistryTest_("TRAINING", "performance_trend", "direction", 42, 4, "training.performance_trend.v1"),

      metricDefinitionRegistryTest_("NUTRITION", "logged_days", "days", 14, 1, "nutrition.logged_days.v1"),
      metricDefinitionRegistryTest_("NUTRITION", "coverage_percent", "percent", 14, 1, "nutrition.coverage_percent.v1"),
      metricDefinitionRegistryTest_("NUTRITION", "average_calories", "kcal/day", 14, 1, "nutrition.average_calories.v1"),
      metricDefinitionRegistryTest_("NUTRITION", "average_protein", "g/day", 14, 1, "nutrition.average_protein.v1"),
      metricDefinitionRegistryTest_("NUTRITION", "protein_target_coverage", "percent", 14, 1, "nutrition.protein_target_coverage.v1"),

      metricDefinitionRegistryTest_("RECOVERY", "checkin_count", "checkins", 14, 1, "recovery.checkin_count.v1"),
      metricDefinitionRegistryTest_("RECOVERY", "sleep_average", "hours", 14, 3, "recovery.sleep_average.v1"),
      metricDefinitionRegistryTest_("RECOVERY", "energy_average", "score_0_10", 14, 3, "recovery.energy_average.v1"),
      metricDefinitionRegistryTest_("RECOVERY", "pain_frequency", "percent", 14, 3, "recovery.pain_frequency.v1")
    ],
    confidence_model: {
      formula: "source_reliability * completeness * freshness * consistency",
      llm_used: false
    },
    production_writes_enabled: false
  };
}

function metricDefinitionRegistryTest_(domain, name, unit, windowDays, minSamples, algorithmVersion) {
  return {
    domain: domain,
    metric_name: name,
    unit: unit,
    window_days: windowDays,
    minimum_samples: minSamples,
    algorithm_version: algorithmVersion,
    deterministic: true,
    source_link_required: true,
    insufficient_data_is_valid: true
  };
}

function getMetricDefinitionTest_(domain, metricName) {
  const registry = getMetricRegistryTest_();
  const match = registry.metrics.filter(function(metric) {
    return metric.domain === domain && metric.metric_name === metricName;
  })[0];
  if (!match) throw new Error("METRIC_NOT_REGISTERED: " + domain + "." + metricName);
  return match;
}

/** Implements the approved non-LLM multiplicative confidence model. */
function computeMetricConfidenceTest_(components) {
  const keys = ["source_reliability", "completeness", "freshness", "consistency"];
  const normalized = {};
  keys.forEach(function(key) {
    const raw = Number(components && components[key]);
    normalized[key] = isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
  });
  const confidence = normalized.source_reliability * normalized.completeness *
    normalized.freshness * normalized.consistency;
  return {
    confidence: roundDq_(confidence, 4),
    components: normalized,
    formula: "source_reliability * completeness * freshness * consistency",
    llm_used: false
  };
}

/** Creates one schema-valid, versioned, source-linked METRIC_VALUES object. */
function createMetricValueTest_(input) {
  const definition = getMetricDefinitionTest_(input.domain, input.metric_name);
  const confidenceResult = computeMetricConfidenceTest_(input.confidence_components || {});
  const sourceIds = uniqueMetricStringsTest_(input.source_ids || []);
  const qualityFlags = uniqueMetricStringsTest_(input.quality_flags || []);
  const missingData = uniqueMetricStringsTest_(input.missing_data || []);
  const metricCore = {
    user_id: String(input.user_id),
    domain: definition.domain,
    metric_name: definition.metric_name,
    value: input.value === undefined ? null : input.value,
    unit: definition.unit,
    status: input.status || "INSUFFICIENT_DATA",
    window_start: input.window_start || null,
    window_end: input.window_end || null,
    computed_at: input.computed_at || METRIC_REGISTRY_TEST_CONFIG.DEFAULT_AS_OF,
    algorithm_version: definition.algorithm_version,
    source_ids: sourceIds,
    confidence: confidenceResult.confidence,
    quality_score: roundDq_(confidenceResult.confidence * 100, 1),
    quality_flags: qualityFlags,
    missing_data: missingData
  };
  const metricIdSeed = stableStringifyMetricRegistryTest_(metricCore);
  const metric = {
    metric_id: "metric-test-" + digestHexDq_(metricIdSeed).slice(0, 20)
  };
  Object.keys(metricCore).forEach(function(key) { metric[key] = metricCore[key]; });
  metric.quality_components = confidenceResult.components;
  metric.confidence_formula = confidenceResult.formula;
  metric.recommendation = null;
  metric.decision = null;
  metric.llm_used = false;
  metric.write_performed = false;
  return metric;
}

function validateMetricRegistryTest_() {
  const registry = getMetricRegistryTest_();
  const expected = {
    BODY: ["weight_current", "weight_average_7d", "weight_average_14d", "weight_change_rate", "weight_trend"],
    TRAINING: ["sessions_count", "training_frequency", "exercise_volume", "performance_trend"],
    NUTRITION: ["logged_days", "coverage_percent", "average_calories", "average_protein", "protein_target_coverage"],
    RECOVERY: ["checkin_count", "sleep_average", "energy_average", "pain_frequency"]
  };
  const errors = [];
  Object.keys(expected).forEach(function(domain) {
    expected[domain].forEach(function(name) {
      const count = registry.metrics.filter(function(metric) {
        return metric.domain === domain && metric.metric_name === name;
      }).length;
      if (count !== 1) errors.push(domain + "." + name + " count=" + count);
    });
  });
  registry.metrics.forEach(function(metric) {
    ["domain", "metric_name", "unit", "minimum_samples", "algorithm_version"].forEach(function(field) {
      if (metric[field] === null || metric[field] === undefined || metric[field] === "") {
        errors.push(metric.domain + "." + metric.metric_name + " missing " + field);
      }
    });
  });
  return {
    valid: errors.length === 0 && registry.metrics.length === 18,
    metric_count: registry.metrics.length,
    errors: errors,
    registry_version: registry.registry_version
  };
}

function validateMetricValueContractTest_(metric) {
  const required = [
    "metric_id", "user_id", "domain", "metric_name", "value", "unit",
    "window_start", "window_end", "computed_at", "algorithm_version",
    "source_ids", "confidence", "quality_score", "quality_flags", "missing_data"
  ];
  const errors = [];
  required.forEach(function(field) {
    if (!Object.prototype.hasOwnProperty.call(metric, field)) errors.push("missing " + field);
  });
  if (!Array.isArray(metric.source_ids)) errors.push("source_ids must be array");
  if (!Array.isArray(metric.quality_flags)) errors.push("quality_flags must be array");
  if (!Array.isArray(metric.missing_data)) errors.push("missing_data must be array");
  if (metric.confidence < 0 || metric.confidence > 1) errors.push("confidence out of range");
  if (Array.isArray(metric.quality_flags)) {
    metric.quality_flags.forEach(function(flag) {
      if (METRIC_REGISTRY_TEST_CONFIG.QUALITY_FLAGS.indexOf(flag) < 0) errors.push("unknown quality flag " + flag);
    });
  }
  return {valid: errors.length === 0, errors: errors};
}

function uniqueMetricStringsTest_(values) {
  const seen = {};
  return values.filter(function(value) {
    const key = String(value);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  }).map(String).sort();
}

function stableStringifyMetricRegistryTest_(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringifyMetricRegistryTest_).join(",") + "]";
  }
  return "{" + Object.keys(value).sort().map(function(key) {
    return JSON.stringify(key) + ":" + stableStringifyMetricRegistryTest_(value[key]);
  }).join(",") + "}";
}
