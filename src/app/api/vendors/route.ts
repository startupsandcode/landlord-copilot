import { NextRequest, NextResponse } from 'next/server';
import { readDb, mutateDb, nextId } from '@/lib/store';

/** GET /api/vendors — the landlord's roster. */
export async function GET() {
  const db = readDb();
  return NextResponse.json({ vendors: db.vendors });
}

/** POST /api/vendors — add a vendor to the roster. */
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => ({}));
  if (!json.name || !json.phone) {
    return NextResponse.json({ error: 'name and phone required' }, { status: 400 });
  }
  const vendor = mutateDb((db) => {
    const v = {
      id: nextId(db, 'vendor'),
      name: String(json.name),
      trade: json.trade ?? 'general',
      phone: String(json.phone),
      notes: String(json.notes ?? ''),
      active: json.active !== false,
    };
    db.vendors.push(v);
    return v;
  });
  return NextResponse.json({ vendor }, { status: 201 });
}
