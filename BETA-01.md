# BETA-01 — closed beta operating contract

Status: local release candidate. No external participant is authorized until the owner approves the onboarding copy, privacy notice, target resources, and launch.

## Environment model

- `STAGING`: engineering checks with synthetic identities and data.
- `BETA`: one stable Telegram service, one Apps Script project/deployment and one shared data store for all invited participants. Every domain row remains user-scoped.
- `PRODUCTION`: unchanged.

Required BETA properties:

- `DEPLOYMENT_ENV=BETA`
- `BETA_SPREADSHEET_ID=<dedicated beta spreadsheet>`
- `BETA_ACCESS_ENABLED=true`
- `BETA_ADMIN_TELEGRAM_IDS=<owner Telegram id>`
- `BETA_PARTICIPANT_LIMIT=1` for wave one
- `BETA_NEW_CONNECTIONS_PAUSED=false`
- `BETA_ANALYTICS_SALT=<random secret>`
- `BETA_WEBHOOK_SECRET=<random secret included only in the registered webhook URL>`
- `TELEGRAM_BOT_USERNAME=<approved beta bot username>`
- existing `TELEGRAM_TOKEN`, `GROQ_API_KEY`, Groq model properties

Do not reuse the STAGING spreadsheet for real participants. Do not point the BETA deployment at Production resources. Create neither a bot nor a deployment without explicit authorization.

The BETA webhook URL must be registered with `?webhook_secret=<secret>`. Requests without the exact secret are rejected before update claiming, logging or routing. Because a Telegram bot supports one active webhook, a genuinely independent BETA contour requires its own approved bot identity; reusing the STAGING bot would disconnect STAGING.

## Owner controls

- `/beta_invite` creates one hashed, single-use invitation valid for 14 days.
- `/beta_status` shows active participants, completed onboarding and unused invitations.
- `/beta_pause` and `/beta_resume` control new activations without interrupting existing participants.
- `/beta_revoke <telegram_id>` revokes access without silently deleting data.

Invitation plaintext is returned only in the owner reply and is not stored. Admin command replies are excluded from dialogue logs.

## Proposed onboarding

1. The participant opens a personal invite link.
2. Fit_Bot explains the closed-beta status, the categories of data processed, support access and the deletion-request route.
3. The participant explicitly accepts or declines.
4. The participant provides goal and any willing profile fields in one natural message, or skips optional fields.
5. Fit_Bot displays exactly what it understood. No profile row exists before confirmation.
6. On confirmation, Fit_Bot writes one user-scoped `User_Profile` row and verifies readback.
7. The first useful action is suggested: food, weight, or today's workout.

The wording is a proposal, not final product approval. No nutrition targets or workout plan are invented for empty fields.

## Voice

Telegram voice is downloaded transiently and sent to the existing Groq transcription endpoint using `whisper-large-v3-turbo` with Russian language hint. Audio bytes are not written to Sheets or Properties. Messages longer than two minutes fail closed. The transcript is shown to the participant before the existing domain flow continues; all material writes still use their established confirmation/readback policy.

No new paid provider is introduced. Before launch, validate current Groq transcription quota, latency and data-processing terms for the participant jurisdiction.

## Data and privacy

Required beta sheets are created by `beta01BootstrapSheets_()` with exact schemas:

- `BETA_INVITES`
- `BETA_USERS`
- `BETA_FEEDBACK`
- `BETA_EVENTS`
- `BETA_DATA_REQUESTS`

In BETA, general Telegram/AI audit logs contain pseudonymous user keys and message lengths, not raw dialogue text. Domain stores keep only the data required for the requested product function. Analytics events avoid message bodies. A deletion command creates a confirmation-required request; it never performs irreversible deletion automatically.

Legal readiness remains an owner/legal decision. Technical tests do not establish the applicable consent, retention or cross-border-transfer basis.

## Feedback and minimum analytics

Participants can write `Отзыв: ...`, `Сообщить о проблеме: ...`, or `Предложение: ...`. Feedback remains user-scoped and visible to the beta owner.

Minimal analytics covers invitation activation, onboarding completion, feedback, redacted interaction success/failure, and repeat use from timestamps. It intentionally avoids a separate analytics platform and raw-dialogue capture.

## Acceptance gate before the first real invite

1. Exact BETA project, spreadsheet, deployment and bot identity are recorded and approved.
2. BETA schemas and properties pass `beta01ReadinessAudit_()`.
3. Two synthetic Telegram identities complete invite, consent, onboarding, nutrition, weight, workout, history, AI advice, correction, cancellation and context-continuation scenarios with cross-user negative assertions.
4. Text and voice run through the same authoritative save/readback paths.
5. An uninvited identity and an uninvited callback are rejected before domain routing or raw logging.
6. Previous protected regression remains green.
7. Data audit shows no cross-user reads/writes, no unexpected captures, and no Production changes.
8. The owner approves onboarding copy, privacy/retention policy, support access, beta bot identity, participant limit and the first real invitation.
