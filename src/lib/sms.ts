// Outbound SMS: STUBBED. Twilio is not provisioned; every outbound message is
// written to the db smsLog and console, and NEVER sent. When Twilio is
// provisioned, this module is the single place to swap in the real client.

import type { Db } from './types';

export interface SmsSend {
  to: string;
  text: string;
  context: string;
}

/**
 * Log-only SMS send against the current in-memory DB. Returns a receipt;
 * `sent` is always false in the MVP. Nothing here ever leaves the machine.
 */
export function logSms(db: Db, send: SmsSend): { sent: false; loggedAt: string } {
  const at = new Date().toISOString();
  db.smsLog.push({ at, to: send.to, text: send.text, context: send.context });
  console.log(`[SMS STUB -> ${send.to}] (${send.context}) ${send.text}`);
  return { sent: false, loggedAt: at };
}
