# BETA-01 — closed pilot operating contract

Status: release candidate for the existing STAGING contour. Registrations remain paused until the owner approves the participant-facing materials and the live multi-user acceptance gate passes.

## Pilot contour

The pilot reuses the existing STAGING Telegram bot, Apps Script project, deployment and spreadsheet. Production stays unchanged. No separate bot, Apps Script project, deployment or spreadsheet is required for the initial five-person pilot unless live evidence shows that the shared contour cannot meet isolation or operating-safety requirements.

Required STAGING properties:

- `DEPLOYMENT_ENV=STAGING`
- `BETA_ACCESS_ENABLED=true`
- `BETA_ADMIN_TELEGRAM_IDS=<owner Telegram id>`
- `BETA_PARTICIPANT_LIMIT=5` (the code enforces a hard maximum of five)
- `BETA_NEW_CONNECTIONS_PAUSED=true` until each wave is explicitly opened
- `BETA_ANALYTICS_SALT=<random secret>`
- `TELEGRAM_BOT_USERNAME=<existing STAGING bot username>`
- existing `TELEGRAM_TOKEN`, `GROQ_API_KEY` and model properties

The shared contour is an operational compromise, not a relaxation of isolation. Engineering releases during the pilot require a release freeze or an announced maintenance window, a clean regression gate, a rollback target and a post-release data audit.

## Waves and owner controls

- Wave 1: no more than two real participants after owner approval and live acceptance with independent controlled identities.
- Wave 2: three additional participants only after the owner reviews wave-one evidence.
- `/beta_invite` creates one hashed, single-use invitation valid for 14 days.
- `/beta_status` shows active participants, completed onboarding and unused invitations.
- `/beta_pause` and `/beta_resume` control new activations without interrupting active participants.
- `/beta_revoke_invites` revokes every unused active invitation.
- `/beta_revoke <telegram_id>` revokes a participant's access without deleting data.

Invitation plaintext is returned only in the owner reply and is not stored. The owner sends invitations; the bot and release operator never invite participants autonomously.

## Onboarding

1. A participant opens their personal invitation.
2. Fit_Bot explains the pilot, processed data categories, support access and deletion-request route.
3. The participant explicitly accepts or declines.
4. The participant provides willing profile fields or skips optional fields.
5. Fit_Bot displays the parsed profile. No profile row exists before confirmation.
6. Confirmation performs one locked, user-scoped profile write and authoritative readback. Replayed confirmation does not duplicate the profile.
7. The first useful action is suggested: food, weight or today's workout.

The wording remains subject to owner approval. No nutrition targets or workout plans are invented.

## Voice

Telegram voice is downloaded transiently and sent to the existing Groq transcription endpoint using `whisper-large-v3-turbo` with a Russian hint. Audio bytes are not persisted. Messages longer than two minutes fail closed. The transcript is shown before the normal domain flow continues; writes retain their existing confirmation and readback guarantees.

No new paid provider is introduced. Quota, latency and applicable data-processing terms must be accepted before real use.

## Data, isolation and privacy

`beta01BootstrapSheets_()` owns the exact schemas of:

- `BETA_INVITES`
- `BETA_USERS`
- `BETA_FEEDBACK`
- `BETA_EVENTS`
- `BETA_DATA_REQUESTS`

When the beta gate is enabled, Telegram and AI audit logs store pseudonymous keys and message lengths rather than raw dialogue, even though the environment remains STAGING. Domain rows remain scoped to the authenticated Telegram identity. Invitation activation, onboarding completion and profile creation are serialized to prevent concurrency races. Update claiming, domain idempotency and pending/callback ownership remain mandatory.

A deletion request is confirmation-required and never causes automatic irreversible deletion. Legal basis, retention, support access and participant copy remain owner/legal decisions.

## Acceptance gate before wave 1

1. Existing STAGING resource identities and deployment version are recorded; Production is verified unchanged.
2. Registrations start paused, stale test invitations are revoked and the participant limit is exactly five.
3. Protected regression and focused beta tests are green against the exact released source.
4. At least two independent controlled Telegram identities complete invite, consent and onboarding without duplicate profiles.
5. Those identities exercise nutrition, weight, workout, history, AI advice, correction, cancellation and context continuation, with cross-user negative assertions.
6. A third uninvited identity and an uninvited callback are rejected before domain routing or raw logging.
7. Text and real Telegram voice reach the same authoritative save/readback paths.
8. Concurrent/replayed updates, confirmations and callbacks create no duplicate writes and cannot cross users.
9. Post-run Sheets audit finds no cross-user reads/writes, no unexpected captures and no owner-data mutation.
10. The owner approves onboarding, privacy/retention, support process and the first two invitations.

Mocks prove implementation contracts but do not satisfy steps 4–9. Until those live checks are possible, wave 1 remains blocked and `BETA_NEW_CONNECTIONS_PAUSED=true`.
