import { NextResponse } from 'next/server';
import { readDb } from '@/lib/store';

/**
 * GET /api/digest — the morning digest: overnight tickets, pending approvals,
 * emergencies, STALE/ESCALATED items, and anything needing the landlord's call.
 */
export async function GET() {
  const db = readDb();
  const open = db.tickets.filter((t) => t.state !== 'CLOSED');
  const byState: Record<string, number> = {};
  for (const t of open) byState[t.state] = (byState[t.state] ?? 0) + 1;
  const emergencies = open.filter((t) => t.urgency === 'EMERGENCY');
  const awaitingApproval = open.filter((t) => t.state === 'AWAITING_APPROVAL');
  const stale = open.filter((t) => t.sideState === 'STALE');
  const escalated = open.filter((t) => t.sideState === 'ESCALATED');
  const needsCall = open.filter((t) => t.needsLandlordConfirmation);
  const recent = [...db.tickets]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 10)
    .map((t) => ({ id: t.id, urgency: t.urgency, state: t.state, sideState: t.sideState, trade: t.trade, tenantName: t.tenantName, createdAt: t.createdAt }));
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    openCount: open.length,
    byState,
    emergencies: emergencies.map((t) => t.id),
    awaitingApproval: awaitingApproval.map((t) => t.id),
    stale: stale.map((t) => t.id),
    escalated: escalated.map((t) => t.id),
    needsCall: needsCall.map((t) => t.id),
    recent,
  });
}
