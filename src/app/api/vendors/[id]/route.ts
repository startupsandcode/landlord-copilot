import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/store';

/** PUT /api/vendors/[id] — edit. DELETE — remove from roster. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await req.json().catch(() => ({}));
  try {
    const vendor = mutateDb((db) => {
      const v = db.vendors.find((x) => x.id === id);
      if (!v) throw new Error('not found');
      if (json.name !== undefined) v.name = String(json.name);
      if (json.trade !== undefined) v.trade = json.trade;
      if (json.phone !== undefined) v.phone = String(json.phone);
      if (json.notes !== undefined) v.notes = String(json.notes);
      if (json.active !== undefined) v.active = json.active === true;
      return v;
    });
    return NextResponse.json({ vendor });
  } catch (err) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const removed = mutateDb((db) => {
    const i = db.vendors.findIndex((x) => x.id === id);
    if (i < 0) return false;
    db.vendors.splice(i, 1);
    return true;
  });
  if (!removed) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
