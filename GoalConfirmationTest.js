/**
 * Sprint 6.1.2 — TEST-ONLY Goal Confirmation Layer.
 *
 * AI_MEMORY is inspected only to expose a conflict. It is never promoted to a
 * canonical fact. Canonical GOALS_V2 objects exist in memory only and require
 * an explicit user confirmation.
 */
const GOAL_CONFIRMATION_TEST_CONFIG = Object.freeze({
  MODE: "TEST_ONLY",
  SCHEMA_VERSION: "GOALS_V2_TEST_1",
  PRODUCTION_WRITES_ENABLED: false,
  MEMORY_AS_SOURCE_FACT: false,
  SOURCE_PRIORITY: Object.freeze({
    EXPLICIT_USER_INPUT_CONFIRMED: 3,
    EXPLICIT_USER_INPUT: 2,
    AI_MEMORY_NON_AUTHORITATIVE: 1
  })
});

/**
 * Finds the target-weight mismatch between authoritative sources and memory.
 *
 * @param {string|number=} userId optional user id.
 * @return {Object} read-only conflict report.
 */
function detectGoalMemoryConflictTest_(userId) {
  const audit = auditGoalDataQuality_();
  const effectiveUserId = isPresentDq_(userId) ? String(userId) : audit.user_id;
  const memoryConflict = audit.conflicts.filter(function(conflict) {
    return conflict.field === "target_weight";
  });

  return {
    flow: "GOAL_CONFIRMATION_FLOW",
    user_id: effectiveUserId,
    conflict_found: memoryConflict.length > 0,
    field: "target_weight",
    authoritative_value: audit.target_weight,
    memory_candidate: memoryConflict.length > 0 ? {
      value: memoryConflict[0].memory_value,
      source: "AI_MEMORY_NON_AUTHORITATIVE",
      canonical: false,
      source_fact: false,
      confidence: 0.25,
      allowed_action: "PROPOSE_USER_CONFIRMATION_ONLY"
    } : null,
    resolution: memoryConflict.length > 0 ? "REQUIRE_EXPLICIT_USER_INPUT" : "NO_CONFLICT",
    write_performed: false
  };
}

/**
 * Creates an in-memory GOALS_V2 proposal from explicit user input.
 *
 * @param {string|number} userId user id.
 * @param {string} userMessage explicit goal statement.
 * @param {Object=} options deterministic test options.
 * @return {Object} pending GOALS_V2 proposal.
 */
function createGoalV2ProposalTest_(userId, userMessage, options) {
  const config = options || {};
  const explicitTarget = parseExplicitTargetWeightGoalTest_(userMessage);
  if (explicitTarget === null) {
    throw new Error("Explicit target weight was not found in user input");
  }

  const profile = readTableDq_(DATA_QUALITY_TEST_CONFIG.SHEETS.PROFILE);
  const indexes = resolveHeaderIndexesDq_(profile.headers, {
    userId: ["User_ID", "user_id"],
    startWeight: ["Вес старт", "start_weight"],
    currentWeight: ["Текущий вес", "current_weight"],
    goal: ["Цель", "goal"]
  });
  const requestedUserId = String(userId);
  const profileRow = profile.rows.filter(function(row) {
    return String(getCellDq_(row, indexes.userId)) === requestedUserId;
  })[0] || profile.rows[0] || [];
  const effectiveDate = normalizeGoalDateTest_(config.effectiveDate || new Date());
  const conflict = detectGoalMemoryConflictTest_(requestedUserId);
  const goalId = "goal-v2-test-" + digestHexDq_(
    [requestedUserId, explicitTarget, effectiveDate, String(userMessage).trim()].join("|")
  ).slice(0, 16);

  return {
    goal_id: goalId,
    user_id: requestedUserId,
    goal_type: normalizeGoalTypeDq_(getCellDq_(profileRow, indexes.goal) || userMessage),
    baseline_weight: parseNumberDq_(getCellDq_(profileRow, indexes.startWeight)),
    current_weight: parseNumberDq_(getCellDq_(profileRow, indexes.currentWeight)),
    target_weight: explicitTarget,
    start_date: effectiveDate,
    target_date: normalizeGoalDateTest_(config.targetDate),
    priority: config.priority || "PRIMARY",
    status: "PENDING_CONFIRMATION",
    source: "EXPLICIT_USER_INPUT",
    confirmation_status: "PENDING_CONFIRMATION",
    confidence: 0.98,
    canonical: false,
    source_fact: false,
    raw_user_input: String(userMessage).trim(),
    memory_conflict: conflict,
    schema_version: GOAL_CONFIRMATION_TEST_CONFIG.SCHEMA_VERSION,
    storage: "IN_MEMORY_ONLY",
    write_performed: false
  };
}

/**
 * Confirms or rejects an in-memory GOALS_V2 proposal.
 *
 * @param {Object} proposal pending proposal.
 * @param {string} confirmation explicit confirmation text.
 * @return {Object} canonical in-memory goal or cancelled proposal.
 */
function confirmGoalV2ProposalTest_(proposal, confirmation) {
  if (!proposal || proposal.confirmation_status !== "PENDING_CONFIRMATION") {
    throw new Error("A PENDING_CONFIRMATION goal proposal is required");
  }
  const intent = detectGoalConfirmationIntentTest_(confirmation);
  const result = deepCloneDq_(proposal);

  if (intent === "REJECT") {
    result.status = "CANCELLED";
    result.confirmation_status = "REJECTED";
    result.canonical = false;
    result.source_fact = false;
    result.confidence = 0;
    result.write_performed = false;
    return result;
  }
  if (intent !== "CONFIRM") {
    result.status = "PENDING_CONFIRMATION";
    result.confirmation_status = "PENDING_CONFIRMATION";
    result.canonical = false;
    result.source_fact = false;
    result.write_performed = false;
    result.error = "EXPLICIT_CONFIRMATION_REQUIRED";
    return result;
  }

  result.status = "ACTIVE";
  result.confirmation_status = "CONFIRMED";
  result.source = "EXPLICIT_USER_INPUT_CONFIRMED";
  result.confidence = 1;
  result.canonical = true;
  result.source_fact = true;
  result.confirmed_at = result.start_date + "T12:00:00+03:00";
  if (result.memory_conflict && result.memory_conflict.memory_candidate) {
    result.memory_conflict.memory_candidate.canonical = false;
    result.memory_conflict.memory_candidate.source_fact = false;
  }
  result.storage = "IN_MEMORY_ONLY";
  result.write_performed = false;
  return result;
}

function parseExplicitTargetWeightGoalTest_(message) {
  if (!isPresentDq_(message)) return null;
  const text = String(message).toLowerCase().replace(/,/g, ".");
  const patterns = [
    /(?:цель|вес|снизить(?:ся)?|похудеть)[^\d]{0,30}(?:до\s*)?(\d{2,3}(?:\.\d+)?)\s*(?:кг|килограмм)/i,
    /до\s*(\d{2,3}(?:\.\d+)?)\s*(?:кг|килограмм)/i
  ];
  for (let i = 0; i < patterns.length; i += 1) {
    const match = text.match(patterns[i]);
    if (match) {
      const value = Number(match[1]);
      if (value >= 35 && value <= 350) return value;
    }
  }
  return null;
}

function detectGoalConfirmationIntentTest_(text) {
  const normalized = normalizeTextDq_(text).replace(/[.!?]+$/g, "");
  if (["да", "подтверждаю", "верно", "согласен", "записать"].indexOf(normalized) >= 0) return "CONFIRM";
  if (["нет", "отмена", "неверно", "не записывать"].indexOf(normalized) >= 0) return "REJECT";
  return "UNKNOWN";
}

function normalizeGoalDateTest_(value) {
  if (!isPresentDq_(value)) return null;
  const parsed = parseDateDq_(value);
  return parsed ? formatDateKeyDq_(parsed) : null;
}
