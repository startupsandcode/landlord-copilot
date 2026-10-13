import { NextResponse } from 'next/server';
import { readDb } from '@/lib/store';

/** GET /api/tickets/[id] — full ticket with thread and transitions. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = readDb();
  const ticket = db.tickets.find((t) => t.id === id);
  if (!ticket) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const vendor = db.vendors.find((v) => v.id === ticket.vendorId) ?? null;
  const property = db.properties.find((p) => p.id === ticket.propertyId) ?? null;
  return NextResponse.json({ ticket, vendor, property });
}
