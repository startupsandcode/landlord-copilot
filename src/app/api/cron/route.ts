import { NextResponse } from 'next/server';
import { mutateDb } from '@/lib/store';
import { evaluateCron } from '@/lib/engine';

/**
 * POST /api/cron — evaluates: STALE detection, [A3] water-emergency
 * no-response auto-dispatch, vendor no-show handling within [A7] bounds.
 * Wire to Vercel Cron in production; trigger manually in dev.
 */
export async function POST() {
  const report = mutateDb((db) => evaluateCron(db, new Date()));
  return NextResponse.json({ ranAt: new Date().toISOString(), actions: report });
}

export async function GET() {
  return NextResponse.json({ ok: true, usage: 'POST to evaluate STALE / auto-dispatch / no-show nudges' });
}
