# DIALOG-E2E-01 — Natural dialog orchestration

## Product outcome

Users can express common nutrition, weight, workout, recovery, and daily-summary reads in several natural forms. The orchestration layer converts a high-confidence phrase to an existing canonical domain action. It does not replace domain readers, writers, confirmation ownership, or authoritative persistence.

## Decision contract

Each deterministic match exposes `domain`, `action`, `canonical`, `confidence`, `source`, and `mutation_policy`.

- Read actions are delegated to existing authoritative readers with `groq_calls=0`.
- Workout start is explicitly marked `SESSION_MUTATION` and remains owned by the existing workout lifecycle service.
- Short confirmation and clarification replies are not classified as new actions.
- Ambiguous `удали последнее` never guesses a domain. A durable pending clarification asks the user to choose `приём пищи` or `подход`; the answer is user/chat scoped and delegates to the existing confirmation flow.
- An existing unrelated active confirmation blocks creation of a competing ambiguity capture.
- Unknown phrases continue to the existing safe deterministic/AI fallback.

## Local acceptance

`DialogE2E01NaturalOrchestrationTest.js` covers:

- 48 natural phrasings across 12 actions;
- canonical-domain detector compatibility;
- canonical route delegation;
- short-reply ownership;
- cross-topic read routing;
- durable ambiguity continuation, cancellation boundary, and user isolation;
- zero Groq and zero Production writes in the orchestration layer.

Current local result: `84/84 PASS`.

Affected-domain protected regression: `668/668 PASS`.

## STAGING gate

Before closure, deploy only after explicit approval and exercise a bounded Telegram dialogue set covering nutrition history, remaining nutrition, current weight, weight trend, workout plan/start/next/overview, recovery, dashboard, cross-topic read while a clarification is pending, and the ambiguous-delete clarification. Verify resulting Sheets mutations and confirmation ownership. Production is out of scope.
