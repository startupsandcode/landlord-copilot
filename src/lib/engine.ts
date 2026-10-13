// Ticket engine: state machine, inbound tenant conversation handling,
// safety locks, takeover handshake, STALE evaluation, and re-dispatch.
// All safety-critical transitions are unit-tested in test/safety.test.ts.

import type { Config, Db, Ticket, TicketState, Urgency } from './types';
import { classifyDeterministic, applyRefinement, type Refinement, type ClassifyContext } from './classifier';
import { getOutsideTempF } from './weather';
import { SAFETY_SCRIPTS, canAutoDispatch, canReDispatch } from './safety';
import { logSms } from './sms';
import { nextId } from './store';

const STATES: TicketState[] = ['NEW', 'TRIAGED', 'AWAITING_APPROVAL', 'VENDOR_ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

const ALLOWED: Record<TicketState, TicketState[]> = {
  NEW: ['TRIAGED', 'CLOSED'],
  TRIAGED: ['AWAITING_APPROVAL', 'CLOSED'],
  AWAITING_APPROVAL: ['VENDOR_ASSIGNED', 'CLOSED'],
  VENDOR_ASSIGNED: ['IN_PROGRESS', 'AWAITING_APPROVAL', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'VENDOR_ASSIGNED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'IN_PROGRESS'],
  CLOSED: [],
};

export function transition(ticket: Ticket, to: TicketState, note?: string): void {
  const now = new Date().toISOString();
  if (ticket.state === to) return; // idempotent: re-entering the same state is a no-op
  if (!ALLOWED[ticket.state].includes(to)) {
    throw new Error(`illegal transition ${ticket.state} -> ${to} (ticket ${ticket.id})`);
  }
  const from = ticket.state;
  ticket.state = to;
  ticket.updatedAt = now;
  ticket.transitions.push({ at: now, from, to, note });
}

export function setSideState(ticket: Ticket, side: 'ESCALATED' | 'STALE' | null, note?: string): void {
  const now = new Date().toISOString();
  ticket.sideState = side;
  ticket.updatedAt = now;
  if (side) ticket.transitions.push({ at: now, from: ticket.state, to: side, note });
}

export function appendThread(ticket: Ticket, from: 'tenant' | 'copilot' | 'landlord' | 'vendor', text: string): void {
  ticket.thread.push({ at: new Date().toISOString(), from, text });
  ticket.updatedAt = ticket.thread[ticket.thread.length - 1].at;
}

export interface InboundResult {
  ticket: Ticket;
  /** Outbound tenant replies produced by this inbound (all stubs, logged only). */
  replies: string[];
  landlordWake: string[];
}

/**
 * Core inbound pipeline. Enforces [A2] emergency lock: when the ticket is an
 * emergency, the only outbound tenant content is the safety script plus the
 * landlord wake. No clarifying questions, no photo requests, while locked.
 *
 * `refinement` is the escalation-only refinement layer input ([A1]): it may
 * raise urgency; a downward refinement is kept provisional and surfaced to
 * the landlord, never silently applied.
 */
export function handleInbound(
  db: Db,
  text: string,
  fromPhone: string,
  refinement: Refinement | null = null,
  asOf: Date = new Date(),
): InboundResult {
  const now = new Date().toISOString();
  const replies: string[] = [];
  const landlordWake: string[] = [];

  // Find tenant by phone, or create an ad-hoc record.
  let property = db.properties[0];
  let unit = property.units.find((u) => u.tenantPhone === fromPhone) ?? null;

  // Reuse an open ticket from the same phone if one exists.
  // NOTE: stood-down tickets are deliberately found here ([A6]): the inbound
  // is held and logged, and nothing is sent to the tenant or vendors.
  let ticket = db.tickets.find(
    (t) => t.tenantPhone === fromPhone && !['CLOSED'].includes(t.state),
  ) ?? null;

  const weather = getOutsideTempF(db.config.weather);
  const classifyCtx: ClassifyContext = {
    zip: property.zip,
    now: asOf,
    outsideTempF: weather.tempF,
    weatherFailed: weather.failed,
  };

  if (!ticket) {
    ticket = {
      id: nextId(db, 'tkt'),
      createdAt: now,
      updatedAt: now,
      state: 'NEW',
      sideState: null,
      tenantPhone: fromPhone,
      tenantName: unit?.tenantName ?? 'Unknown tenant',
      propertyId: property.id,
      unitId: unit?.id ?? 'unknown',
      unitConfirmed: unit !== null,
      urgency: 'ROUTINE',
      emergencyType: null,
      trade: 'general',
      confidence: 0,
      matchedKeywords: [],
      provisionalLower: null,
      needsLandlordConfirmation: false,
      emergencyLocked: false,
      standDown: false,
      standDownAckAt: null,
      thread: [],
      transitions: [{ at: now, from: '-', to: 'NEW', note: 'ticket created from tenant SMS' }],
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
    db.tickets.push(ticket);
  }

  // [A6] Stand-down: nothing further goes to the tenant or vendors.
  if (ticket.standDown) {
    appendThread(ticket, 'tenant', text);
    appendThread(ticket, 'copilot', '[STAND-DOWN] inbound held; landlord took over. No tenant or vendor contact.');
    return { ticket, replies: [], landlordWake: [] };
  }

  appendThread(ticket, 'tenant', text);

  // [A2] If already locked to the safety script, stay locked: repeat the
  // script, never ask clarifying questions or request photos.
  if (ticket.emergencyLocked && ticket.emergencyType) {
    const reply = SAFETY_SCRIPTS[ticket.emergencyType];
    replies.push(reply);
    appendThread(ticket, 'copilot', reply);
    logSms(db, { to: fromPhone, text: reply, context: `emergency-locked:${ticket.id}` });
    return { ticket, replies, landlordWake };
  }

  // Classify.
  const floor = classifyDeterministic(text, classifyCtx);
  const refined = applyRefinement(floor, refinement, db.config.confidenceThreshold);
  ticket.urgency = refined.urgency;
  ticket.emergencyType = refined.emergencyType;
  ticket.trade = refined.trade;
  ticket.confidence = refined.confidence;
  ticket.matchedKeywords = refined.matchedKeywords;
  ticket.needsLandlordConfirmation = refined.needsLandlord;
  ticket.provisionalLower = refined.provisionalLower
    ? { ...refined.provisionalLower, at: now }
    : null;
  if (ticket.state === 'NEW') {
    transition(ticket, 'TRIAGED', `classified ${refined.urgency} (confidence ${refined.confidence.toFixed(2)})`);
  } else {
    // Existing open ticket: record the re-classification, never move backward.
    ticket.transitions.push({
      at: now,
      from: ticket.state,
      to: ticket.state,
      note: `re-classified ${refined.urgency} (confidence ${refined.confidence.toFixed(2)})`,
    });
    ticket.updatedAt = now;
  }

  if (ticket.urgency === 'EMERGENCY' && ticket.emergencyType) {
    // [A2] Lock to the safety script immediately.
    ticket.emergencyLocked = true;
    ticket.safetyLog.push(`${now} EMERGENCY ${ticket.emergencyType}: keywords [${ticket.matchedKeywords.join(', ')}]. Tenant given safety script; landlord wake sent.`);
    setSideState(ticket, 'ESCALATED', 'emergency: landlord wake');

    const reply = SAFETY_SCRIPTS[ticket.emergencyType];
    replies.push(reply);
    appendThread(ticket, 'copilot', reply);
    logSms(db, { to: fromPhone, text: reply, context: `emergency-script:${ticket.id}` });

    const wake = `EMERGENCY (${ticket.emergencyType}) at ${property.address}, unit ${unitLabel(ticket, db)}. ${text.slice(0, 160)}`;
    landlordWake.push(wake);
    for (const contact of db.config.emergencyProtocol.landlordCallList) {
      logSms(db, { to: contact, text: wake, context: `landlord-wake:${ticket.id}` });
    }
    appendThread(ticket, 'copilot', `[landlord wake sent] ${wake}`);
    return { ticket, replies, landlordWake };
  }

  // Non-emergency conversation.
  const reply = nonEmergencyReply(ticket, text, db);
  replies.push(reply);
  appendThread(ticket, 'copilot', reply);
  logSms(db, { to: fromPhone, text: reply, context: `triage:${ticket.id}` });
  transition(ticket, 'AWAITING_APPROVAL', 'triage complete; awaiting landlord approval of vendor proposal');
  if (refined.needsLandlord) {
    const note =
      refined.provisionalLower
        ? `Provisional downgrade proposed (${refined.provisionalLower.from} -> ${refined.provisionalLower.to}): ${refined.provisionalLower.reason}. NOT applied; needs your confirmation.`
        : `Low confidence (${refined.confidence.toFixed(2)}): flagged for your call.`;
    appendThread(ticket, 'copilot', `[landlord note] ${note}`);
    logSms(db, { to: db.config.emergencyProtocol.landlordCallList[0] ?? '', text: `Ticket ${ticket.id} needs your call: ${note}`, context: `landlord-flag:${ticket.id}` });
  }
  return { ticket, replies, landlordWake };
}

function unitLabel(ticket: Ticket, db: Db): string {
  const prop = db.properties.find((p) => p.id === ticket.propertyId);
  return prop?.units.find((u) => u.id === ticket.unitId)?.label ?? ticket.unitId;
}

/** [A5] unit-identity confirmation step in the conversation. */
export function confirmUnit(db: Db, ticketId: string, label: string): Ticket {
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);
  const prop = db.properties.find((p) => p.id === ticket.propertyId);
  const unit = prop?.units.find((u) => u.label.toLowerCase() === label.toLowerCase());
  if (!unit) throw new Error(`unit "${label}" not found at this property`);
  ticket.unitId = unit.id;
  ticket.tenantName = unit.tenantName;
  ticket.unitConfirmed = true;
  appendThread(ticket, 'tenant', `Confirmed: I am in unit ${unit.label}.`);
  appendThread(ticket, 'copilot', `Thanks. Unit ${unit.label} confirmed.`);
  ticket.updatedAt = new Date().toISOString();
  return ticket;
}

function nonEmergencyReply(ticket: Ticket, text: string, db: Db): string {
  if (!ticket.unitConfirmed) {
    const prop = db.properties.find((p) => p.id === ticket.propertyId);
    const labels = prop?.units.map((u) => u.label).join(', ') ?? '';
    return `Got it, I will get this sorted. Before I arrange anything, can you confirm your unit? Options here: ${labels}.`;
  }
  const photoAsk = ticket.urgency === 'ROUTINE' ? ' If you can, a photo helps the vendor come prepared.' : '';
  return `Got it, thanks. I have logged this as ${ticket.urgency.toLowerCase()} (${ticket.trade}). I am lining up a ${ticket.trade} vendor and your landlord will approve the visit. What times work for access?${photoAsk}`;
}

/**
 * [A6] Landlord takeover ("I'll handle it"): the copilot completes an
 * acknowledgment handshake back to the landlord, then FULLY stands down:
 * no further tenant messages, no vendor contact, no double-dispatch.
 */
export function takeover(db: Db, ticketId: string, landlordPhone: string): Ticket {
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);
  ticket.standDown = true;
  ticket.standDownAckAt = new Date().toISOString();
  setSideState(ticket, 'ESCALATED', 'landlord takeover: copilot stood down');
  appendThread(ticket, 'landlord', "I'll handle it.");
  const ack = `Acknowledged: you have ticket ${ticket.id} (${unitLabel(ticket, db)}). I am standing down completely: no further tenant messages, no vendor contact. Reply RESUME only if you want me back in.`;
  appendThread(ticket, 'copilot', ack);
  logSms(db, { to: landlordPhone, text: ack, context: `takeover-handshake:${ticket.id}` });
  return ticket;
}

/**
 * Cron evaluation: STALE detection, no-response auto-dispatch for water
 * emergencies [A3], vendor no-show nudges. Returns a report of actions taken.
 */
export function evaluateCron(db: Db, now: Date): string[] {
  const report: string[] = [];
  const config = db.config;

  for (const ticket of db.tickets) {
    if (['CLOSED', 'RESOLVED'].includes(ticket.state) || ticket.standDown) continue;

    // [A3] no-response auto-dispatch: water emergencies only, pre-authorized protocol.
    if (ticket.urgency === 'EMERGENCY' && ticket.state === 'TRIAGED' && ticket.sideState === 'ESCALATED') {
      const check = canAutoDispatch(ticket, config, now);
      if (check.allowed && ticket.vendorId) {
        transition(ticket, 'VENDOR_ASSIGNED', `[auto-dispatch] ${check.reason}`);
        ticket.assignedAt = now.toISOString();
        const prop = db.properties.find((p) => p.id === ticket.propertyId);
        const vendor = db.vendors.find((v) => v.id === ticket.vendorId);
        const msg = `AUTO-DISPATCH (water emergency, landlord timeout elapsed): ${vendor?.name} -> ${prop?.address}, unit ${unitLabel(ticket, db)}. Tenant: ${ticket.tenantPhone}.`;
        appendThread(ticket, 'copilot', msg);
        logSms(db, { to: vendor?.phone ?? '', text: msg, context: `auto-dispatch:${ticket.id}` });
        report.push(`${ticket.id}: auto-dispatched water emergency to ${vendor?.name}`);
      }
    }

    // STALE: vendor assigned, no response within staleHours -> re-dispatch within [A7] bounds.
    if (
      (ticket.state === 'VENDOR_ASSIGNED' || ticket.state === 'IN_PROGRESS') &&
      ticket.sideState !== 'STALE' &&
      ticket.assignedAt &&
      !ticket.vendorRespondedAt
    ) {
      const hoursIdle = (now.getTime() - new Date(ticket.assignedAt).getTime()) / 3600000;
      if (hoursIdle >= config.staleHours) {
        setSideState(ticket, 'STALE', `no vendor response in ${config.staleHours}h`);
        const nextEstimate = ticket.estimate ?? 0;
        const reCheck = canReDispatch(ticket, config, nextEstimate);
        if (reCheck.allowed) {
          ticket.reDispatchCount += 1;
          ticket.cumulativeProposedSpend += nextEstimate;
          setSideState(ticket, null, undefined);
          ticket.sideState = null;
          ticket.assignedAt = now.toISOString();
          ticket.vendorRespondedAt = null;
          appendThread(ticket, 'copilot', `[re-dispatch #${ticket.reDispatchCount}] vendor no-show; ${reCheck.reason}`);
          report.push(`${ticket.id}: STALE -> re-dispatched (#${ticket.reDispatchCount})`);
        } else {
          setSideState(ticket, 'ESCALATED', `[A7] re-dispatch blocked: ${reCheck.reason}`);
          const wake = `Ticket ${ticket.id} (${unitLabel(ticket, db)}): vendor no-show and re-dispatch blocked (${reCheck.reason}). Needs your call.`;
          logSms(db, { to: config.emergencyProtocol.landlordCallList[0] ?? '', text: wake, context: `stale-escalation:${ticket.id}` });
          appendThread(ticket, 'copilot', `[landlord escalation] ${wake}`);
          report.push(`${ticket.id}: STALE -> ESCALATED (re-dispatch bound hit)`);
        }
      }
    }
  }
  return report;
}

/** Vendor recommendation by trade + active status (MVP: landlord's own roster). */
export function recommendVendor(db: Db, trade: Ticket['trade']): Db['vendors'][number] | null {
  const exact = db.vendors.find((v) => v.active && v.trade === trade);
  if (exact) return exact;
  return db.vendors.find((v) => v.active && v.trade === 'general') ?? db.vendors.find((v) => v.active) ?? null;
}

/** Auto-approve ceiling check: emergency tier ceiling 0 = always notify first. */
export function withinAutoApproveCeiling(urgency: Urgency, estimate: number, config: Config): boolean {
  const ceiling = config.autoApproveCeilings[urgency];
  if (ceiling <= 0) return false;
  return estimate <= ceiling;
}

/** Landlord close-out. */
export function closeTicket(db: Db, ticketId: string): Ticket {
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);
  if (ticket.state !== 'CLOSED') {
    const from = ticket.state;
    ticket.state = 'CLOSED';
    ticket.closedAt = new Date().toISOString();
    ticket.updatedAt = ticket.closedAt;
    ticket.transitions.push({ at: ticket.closedAt, from, to: 'CLOSED', note: 'landlord close-out' });
  }
  return ticket;
}

/** Tenant "is it fixed?" confirmation. */
export function confirmFixed(db: Db, ticketId: string, fixed: boolean): Ticket {
  const ticket = db.tickets.find((t) => t.id === ticketId);
  if (!ticket) throw new Error(`ticket ${ticketId} not found`);
  if (fixed) {
    if (ticket.state === 'IN_PROGRESS') transition(ticket, 'RESOLVED', 'tenant confirmed fixed');
    ticket.fixedConfirmed = true;
    appendThread(ticket, 'tenant', 'Yes, it is fixed.');
  } else {
    if (ticket.state === 'RESOLVED') transition(ticket, 'IN_PROGRESS', 'tenant says not fixed; re-opened');
    ticket.fixedConfirmed = false;
    appendThread(ticket, 'tenant', 'No, still broken.');
  }
  return ticket;
}
