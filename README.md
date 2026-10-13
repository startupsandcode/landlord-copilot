# Landlord Maintenance Triage Copilot (MVP v1)

SMS-native maintenance triage for self-managing landlords. Tenants text a number; the
copilot classifies urgency, locks emergencies to the safety script, and tracks every
ticket to resolution. Next.js 16 + TypeScript. Dependencies: next, react, react-dom
(runtime); vitest + typescript (dev).

Built 2026-10-13 by the Rocky lane of John's autonomous AI company (Startups and Code),
from `landlord-triage-copilot-spec-v1.md` with all 9 CoS safety amendments [A1]-[A9].

## Safety model (enforced in code, covered by tests)

- **Escalation-only classifier [A1].** Deterministic keyword heuristics are the first
  pass (gas/fire/CO, active water, no-heat+winter, lockout/security, electrical). Any
  refinement layer may escalate further but may NEVER silently de-escalate below the
  deterministic floor. A downward refinement stays provisional, is logged with reasoning,
  and surfaces to the landlord. Confidence below threshold goes to the landlord.
- **Emergency script lock [A2].** Emergency tickets lock the conversation to the safety
  script only: no clarifying questions, no photo requests.
- **911-first [A3].** Gas/fire/CO are never auto-dispatched. The no-response
  auto-dispatch timeout (default 15 min, landlord-configurable) applies ONLY to
  water-type emergencies under a pre-authorized protocol. Everything else dispatches on
  landlord approval.
- **No-heat winter fail-safe [A4].** No heat + winter (<40F) is an emergency. If the
  weather lookup fails during Oct-Mar, it fails SAFE to emergency.
- **Unit-identity confirmation [A5].** Dispatch is blocked until the tenant confirms the
  unit (multi-tenant wrong-unit risk).
- **Takeover handshake [A6].** "I'll handle it" sends an acknowledgment back to the
  landlord, then the copilot fully stands down: no tenant messages, no vendor contact,
  no double-dispatch.
- **STALE bounds [A7].** Vendor no-show re-dispatch is bounded by max re-dispatches AND
  cumulative proposed spend against the per-tier ceiling; exceeding either escalates to
  the landlord instead of spending more.
- **Spend ceilings.** Emergency tier ceiling $0 = always notify first. Any spend above a
  tier ceiling requires explicit landlord approval.
- **SMS is stubbed.** Twilio is NOT provisioned. Every outbound message is logged to the
  DB smsLog and console; nothing is ever sent.

**Launch gate [A9]:** counsel must answer the pilot-liability question before ANY tenant
touches the number, free pilot included. Build may proceed; launch may not.

## Run it

```bash
npm install
npm test        # vitest safety suite (36 tests)
npm run build   # clean production build
npm run dev     # local dev
```

Simulate a tenant SMS (dev-only; disabled in production unless SIMULATE_ENABLED=true):

```bash
curl -X POST localhost:3000/api/sms/simulate -H 'Content-Type: application/json' \
  -d '{"from":"+15550101","body":"I smell gas in the kitchen"}'
```

Twilio webhook (production): point the number's webhook at `POST /api/sms/webhook`
with Twilio's form payload (From, Body). Replies are returned as TwiML.

Cron: `POST /api/cron` evaluates STALE, water-emergency no-response auto-dispatch,
and vendor no-show handling. Wire to Vercel Cron in production.

## Routes

- `/` landing, `/dashboard` (tickets, digest, vendors, config, unit history),
  `/tickets/[id]` (thread, approvals, dispatch, takeover, close-out),
  `/simulate` (dev SMS console)
- API: `/api/sms/webhook`, `/api/sms/simulate`, `/api/tickets`, `/api/tickets/[id]`,
  `/api/tickets/[id]/action`, `/api/vendors`, `/api/vendors/[id]`, `/api/config`,
  `/api/digest`, `/api/cron`

## State machine

NEW -> TRIAGED -> AWAITING_APPROVAL -> VENDOR_ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED,
with side states ESCALATED (emergency / takeover / bound-hit) and STALE (vendor no-show).
Every transition is timestamped and logged; emergency escalations are additionally
appended to an immutable per-ticket safety log.

## Data

JSON-file store seeded from `data/seed.json` (fictional tenants/vendors). NOTE: on
Vercel the filesystem is ephemeral; production needs Postgres (Neon) before launch.
Retention policy intent: 24 months ticket records, 36 months immutable safety log.

## Vercel

Import the repo; `vercel.json` is set for Next.js. No Vercel project created yet
(needs John's connection). Vercel Cron for `/api/cron` is a one-step manual action.
