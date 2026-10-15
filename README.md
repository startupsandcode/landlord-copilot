# Landlord Copilot

Landlord Copilot is a prototype for organizing maintenance requests from tenants. It models an SMS intake flow, classifies urgency, tracks work orders, and gives a landlord a chance to review dispatch decisions.

## Current status

This is a local demo, not an emergency-response service or a production tenant-support system. It uses fictional seed data and writes state to a local JSON file. Twilio is not connected; outbound messages are recorded as logs and are not sent. Do not use it with real tenant information or rely on it to respond to an emergency.

## How it works

1. An incoming maintenance message enters through the SMS webhook or the local simulation page.
2. Deterministic rules set a minimum urgency level. Any optional refinement may raise urgency; a lower suggestion is kept provisional and sent to the landlord for review.
3. Emergency messages are restricted to a safety response. Gas, fire, and carbon-monoxide reports direct the tenant to call emergency services and are never automatically dispatched.
4. A landlord reviews the ticket, confirms the unit, and approves vendor dispatch.
5. The ticket records status changes through resolution. A scheduled route checks for stale tickets and vendor no-shows.

The application is built with Next.js, React, and TypeScript. The core classifier, safety rules, workflow, SMS formatting, and JSON store live in `src/lib/`; pages and API handlers live in `src/app/`.

## Run locally

Requirements: Node.js and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000. The local simulation page is at `/simulate`. In development the simulate endpoint is enabled by default; in production it is disabled unless `SIMULATE_ENABLED=true`. Do not enable it on a public deployment.

To run the safety checks and production build:

```bash
npm test
npm run build
```

## Main pages and endpoints

- `/`: overview
- `/dashboard`: tickets, vendors, settings, and digest
- `/tickets/[id]`: ticket details, approvals, and resolution actions
- `/simulate`: local simulated SMS flow
- `POST /api/sms/webhook`: Twilio-style inbound form webhook
- `POST /api/sms/simulate`: simulated inbound message
- `/api/tickets`, `/api/tickets/[id]`, `/api/tickets/[id]/action`: ticket operations
- `/api/vendors`, `/api/vendors/[id]`: vendor records
- `/api/config`: landlord settings
- `/api/digest`: digest data
- `/api/cron`: stale-ticket and vendor follow-up checks

## Safety boundaries

The prototype includes an escalation-only urgency refinement, emergency script lock, unit confirmation before dispatch, a landlord takeover flow, and bounded vendor re-dispatch. These are prototype behaviors, not a substitute for operational review or legal advice. The weather lookup and notification integrations are not production services.

A production system would need authenticated roles, per-property access controls, secure durable storage, verified and monitored messaging, vendor and tenant consent processes, and a reviewed emergency and liability plan. Do not connect real tenant traffic until those controls are implemented and reviewed.

## License

No license file is currently included. If the repository is made public without a license, visitors can read it but do not have explicit permission to reuse, modify, or redistribute it. Add a license before presenting the project as open source.
