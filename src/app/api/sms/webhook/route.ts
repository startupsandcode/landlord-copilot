import { NextRequest, NextResponse } from 'next/server';
import { readDb, mutateDb } from '@/lib/store';
import { handleInbound } from '@/lib/engine';

/**
 * Twilio-style inbound SMS webhook. Accepts application/x-www-form-urlencoded
 * (Twilio format: From, Body, To, MessageSid) or JSON for flexibility.
 * Responds with TwiML so a real Twilio number can be wired later; today the
 * reply is also stub-logged server-side (see lib/sms).
 */
export async function POST(req: NextRequest) {
  let from = '';
  let body = '';
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await req.formData();
    from = String(form.get('From') ?? '');
    body = String(form.get('Body') ?? '');
  } else {
    const json = await req.json().catch(() => ({}));
    from = String(json.From ?? json.from ?? '');
    body = String(json.Body ?? json.body ?? '');
  }
  if (!from || !body) {
    return NextResponse.json({ error: 'missing From/Body' }, { status: 400 });
  }

  const result = mutateDb((db) => handleInbound(db, body, from));

  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(
    result.replies[0] ?? 'Received.',
  )}</Message></Response>`;

  return new NextResponse(twiml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function GET() {
  return NextResponse.json({ ok: true, usage: 'POST Twilio-style form fields (From, Body)' });
}
