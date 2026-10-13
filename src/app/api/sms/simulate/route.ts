import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/store';
import { handleInbound } from '@/lib/engine';
import type { Refinement } from '@/lib/classifier';

/**
 * DEV-ONLY simulated SMS endpoint. No Twilio number exists yet, so this runs
 * the exact same inbound pipeline as /api/sms/webhook with a synthetic
 * sender. Disabled in production unless SIMULATE_ENABLED=true.
 */
function simulateEnabled(): boolean {
  if (process.env.SIMULATE_ENABLED === 'true') return true;
  if (process.env.SIMULATE_ENABLED === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

export async function POST(req: NextRequest) {
  if (!simulateEnabled()) {
    return NextResponse.json({ error: 'simulate endpoint disabled in production' }, { status: 403 });
  }
  const json = await req.json().catch(() => ({}));
  const from = String(json.from ?? json.From ?? '+15550101');
  const body = String(json.body ?? json.Body ?? '');
  if (!body) return NextResponse.json({ error: 'missing body' }, { status: 400 });

  const refinement: Refinement | null = json.refinement
    ? { proposedUrgency: json.refinement.proposedUrgency, reason: String(json.refinement.reason ?? '') }
    : null;

  const result = mutateDb((db) => handleInbound(db, body, from, refinement));

  return NextResponse.json({
    ticketId: result.ticket.id,
    state: result.ticket.state,
    urgency: result.ticket.urgency,
    emergencyType: result.ticket.emergencyType,
    trade: result.ticket.trade,
    confidence: result.ticket.confidence,
    emergencyLocked: result.ticket.emergencyLocked,
    unitConfirmed: result.ticket.unitConfirmed,
    provisionalLower: result.ticket.provisionalLower,
    needsLandlordConfirmation: result.ticket.needsLandlordConfirmation,
    replies: result.replies,
    landlordWake: result.landlordWake,
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    enabled: simulateEnabled(),
    usage: 'POST {from, body, refinement?} — runs the webhook pipeline without a real SMS',
  });
}
