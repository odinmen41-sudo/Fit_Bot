/**
 * Sprint 6.1.2 — TEST-ONLY Recovery Check-in Layer.
 *
 * This module produces observations only. It never diagnoses injuries, infers
 * causes of pain, writes Recovery_Log or creates recommendations.
 */
const RECOVERY_CHECKIN_TEST_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  OBSERVATION_TYPE: "RECOVERY_CHECKIN",
  SOURCE: "EXPLICIT_USER_INPUT",
  PRODUCTION_WRITES_ENABLED: false,
  MEDICAL_INTERPRETATION_ENABLED: false
});

/**
 * Extracts explicitly stated recovery fields from a test message.
 * Missing fields remain null.
 *
 * @param {string} message user check-in text.
 * @param {Object=} options deterministic date options.
 * @return {Object} RECOVERY_CHECKIN structure.
 */
function parseRecoveryCheckinTest_(message, options) {
  const config = options || {};
  const raw = String(message || "").trim();
  const normalized = raw.toLowerCase().replace(/,/g, ".");
  const sleepHours = matchNumberRecoveryTest_(normalized, /спал(?:а)?\s*(\d+(?:\.\d+)?)\s*(?:час|ч\b)/i, 0, 24);
  const sleepQuality = matchNumberRecoveryTest_(normalized, /качеств[оа]\s+сна\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10);
  const energy = matchNumberRecoveryTest_(normalized, /энерги(?:я|и)\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10);
  const stress = matchNumberRecoveryTest_(normalized, /стресс\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10);
  const fatigue = matchNumberRecoveryTest_(normalized, /усталост[ьи]\s*[:=-]?\s*(\d+(?:\.\d+)?)/i, 0, 10);
  const pain = parsePainRecoveryTest_(normalized);
  const date = normalizeRecoveryDateTest_(config.date || new Date());

  const checkin = {
    date: date,
    sleep_hours: sleepHours,
    sleep_quality: sleepQuality,
    energy: energy,
    stress: stress,
    fatigue: fatigue,
    pain_present: pain.present,
    pain_location: pain.location,
    pain_score: pain.score,
    comment: isPresentDq_(config.comment) ? String(config.comment).trim() : null,
    source: RECOVERY_CHECKIN_TEST_CONFIG.SOURCE,
    confidence: 0,
    field_quality: {},
    missing_fields: [],
    raw_user_input: raw,
    observation_only: true,
    write_performed: false
  };

  const fields = [
    "date", "sleep_hours", "sleep_quality", "energy", "stress", "fatigue",
    "pain_present", "pain_location", "pain_score", "comment", "source"
  ];
  let confidenceSum = 0;
  let populated = 0;
  fields.forEach(function(field) {
    const present = checkin[field] !== null && checkin[field] !== undefined && checkin[field] !== "";
    const confidence = present ? (field === "date" || field === "source" ? 1 : 0.98) : 0;
    checkin.field_quality[field] = {
      status: present ? "EXPLICIT" : "MISSING",
      source: present ? RECOVERY_CHECKIN_TEST_CONFIG.SOURCE : null,
      confidence: confidence
    };
    if (present) {
      confidenceSum += confidence;
      populated += 1;
    } else {
      checkin.missing_fields.push(field);
    }
  });
  checkin.confidence = populated > 0 ? roundDq_(confidenceSum / populated, 2) : 0;
  return checkin;
}

/**
 * Wraps the parsed check-in as a Digital Twin observation in memory only.
 *
 * @param {string|number} userId user id.
 * @param {Object} checkin parsed recovery data.
 * @return {Object} recovery observation.
 */
function buildRecoveryObservationTest_(userId, checkin) {
  if (!checkin || checkin.observation_only !== true) {
    throw new Error("A parsed RECOVERY_CHECKIN is required");
  }
  const observationId = "recovery-test-" + digestHexDq_(
    [String(userId), checkin.date, checkin.raw_user_input].join("|")
  ).slice(0, 16);

  return {
    observation_id: observationId,
    observation_type: RECOVERY_CHECKIN_TEST_CONFIG.OBSERVATION_TYPE,
    user_id: String(userId),
    observed_at: checkin.date,
    data: deepCloneDq_(checkin),
    quality: {
      source_priority: "EXPLICIT_USER_INPUT",
      confidence: checkin.confidence,
      missing_fields: checkin.missing_fields.slice(),
      observation_only: true
    },
    medical_safety: {
      diagnosis: null,
      pain_cause_inference: null,
      injury_classification: null,
      medical_conclusion: null,
      status: "NO_MEDICAL_INTERPRETATION"
    },
    canonical_observation: true,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

function matchNumberRecoveryTest_(text, pattern, min, max) {
  const match = text.match(pattern);
  if (!match) return null;
  const value = Number(match[1]);
  return isFinite(value) && value >= min && value <= max ? value : null;
}

function parsePainRecoveryTest_(text) {
  const locations = [
    {pattern: /(?:плечо|плече|плеча)\s*[:=-]?\s*(\d+(?:\.\d+)?)(?:\s*из\s*10)?/i, location: "SHOULDER"},
    {pattern: /(?:поясниц[аеуы])\s*[:=-]?\s*(\d+(?:\.\d+)?)(?:\s*из\s*10)?/i, location: "LOWER_BACK"},
    {pattern: /(?:локт[ьея])\s*[:=-]?\s*(\d+(?:\.\d+)?)(?:\s*из\s*10)?/i, location: "ELBOW"},
    {pattern: /(?:колен[оея])\s*[:=-]?\s*(\d+(?:\.\d+)?)(?:\s*из\s*10)?/i, location: "KNEE"}
  ];
  for (let i = 0; i < locations.length; i += 1) {
    const match = text.match(locations[i].pattern);
    if (match) {
      const score = Number(match[1]);
      if (isFinite(score) && score >= 0 && score <= 10) {
        return {present: score > 0, location: locations[i].location, score: score};
      }
    }
  }
  if (/боли?\s+нет|без\s+боли/i.test(text)) {
    return {present: false, location: null, score: 0};
  }
  return {present: null, location: null, score: null};
}

function normalizeRecoveryDateTest_(value) {
  const parsed = parseDateDq_(value);
  return parsed ? formatDateKeyDq_(parsed) : null;
}
