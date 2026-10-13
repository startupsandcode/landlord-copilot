import { NextRequest, NextResponse } from 'next/server';
import { readDb, mutateDb, nextId } from '@/lib/store';
import type { TicketState } from '@/lib/types';

/** GET /api/tickets?state= — list tickets, newest first. */
export async function GET(req: NextRequest) {
  const db = readDb();
  const state = req.nextUrl.searchParams.get('state');
  const tickets = [...db.tickets]
    .filter((t) => !state || t.state === state)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({ tickets });
}

/** POST /api/tickets — manual ticket creation (landlord-entered). */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => ({}));
  const ticket = mutateDb((db) => {
    const now = new Date().toISOString();
    const prop = db.properties[0];
    const unit = prop.units.find((u) => u.id === json.unitId) ?? prop.units[0];
    const t = {
      id: nextId(db, 'tkt'),
      createdAt: now,
      updatedAt: now,
      state: 'TRIAGED' as TicketState,
      sideState: null,
      tenantPhone: unit.tenantPhone,
      tenantName: unit.tenantName,
      propertyId: prop.id,
      unitId: unit.id,
      unitConfirmed: true,
      urgency: (json.urgency ?? 'ROUTINE') as 'ROUTINE',
      emergencyType: null,
      trade: (json.trade ?? 'general') as 'general',
      confidence: 1,
      matchedKeywords: ['manual-entry'],
      provisionalLower: null,
      needsLandlordConfirmation: false,
      emergencyLocked: false,
      standDown: false,
      standDownAckAt: null,
      thread: [
        { at: now, from: 'tenant' as const, text: String(json.description ?? 'Landlord-entered ticket') },
      ],
      transitions: [{ at: now, from: '-', to: 'TRIAGED', note: 'manual entry' }],
      safetyLog: [],
      vendorId: null,
      estimate: null,
      reDispatchCount: 0,
      cumulativeProposedSpend: 0,
      assignedAt: null,
      vendorRespondedAt: null,
      fixedConfirmed: false,
      closedAt: null,
    };
    db.tickets.push(t);
    return t;
  });
  return NextResponse.json({ ticket }, { status: 201 });
}
