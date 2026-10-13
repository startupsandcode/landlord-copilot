// Safety-critical test suite for the Landlord Maintenance Triage Copilot MVP.
// Amendments under test: [A1] escalation-only, [A2] emergency script lock,
// [A3] gas/fire/CO never auto-dispatch, [A4] no-heat winter fail-safe,
// [A5] unit-identity confirmation, [A6] takeover stand-down, [A7] STALE bounds.
import { describe, it, expect } from 'vitest';import type { Db, Ticket } from '../src/lib/types';
import { classifyDeterministic, applyRefinement } from '../src/lib/classifier';
import { SAFETY_SCRIPTS, canAutoDispatch, canDispatch, canReDispatch } from '../src/lib/safety';
import { isWinterMonth } from '../src/lib/weather';
import { handleInbound, confirmUnit, takeover, evaluateCron, withinAutoApproveCeiling } from '../src/lib/engine';
import seedJson from '../data/seed.json';

const CONF_THRESHOLD = 0.6;

function freshDb(): Db {
  return JSON.parse(JSON.stringify(seedJson)) as Db;
}


function makeTicket(db: Db, overrides: Partial<Ticket> = {}): Ticket {
  const now = new Date().toISOString();
  const t: Ticket = {
    id: 'tkt-test',
    createdAt: now, updatedAt: now,
    state: 'TRIAGED', sideState: null,
    tenantPhone: '+15550101', tenantName: 'Sam Reyes',
    propertyId: 'prop-1', unitId: 'unit-1a', unitConfirmed: true,
    urgency: 'URGENT', emergencyType: null, trade: 'plumbing',
    confidence: 0.9, matchedKeywords: [],
    provisionalLower: null, needsLandlordConfirmation: false,
    emergencyLocked: false, standDown: false, standDownAckAt: null,
    thread: [], transitions: [], safetyLog: [],
    vendorId: null, estimate: null,
    reDispatchCount: 0, cumulativeProposedSpend: 0,
    assignedAt: null, vendorRespondedAt: null,
    fixedConfirmed: false, closedAt: null,
    ...overrides,
  };
  db.tickets.push(t);
  return t;
}

const JAN = new Date('2026-01-15T23:30:00-05:00'); // winter, after hours
const JUL = new Date('2026-07-15T23:30:00-05:00'); // summer

describe('deterministic keyword floor ([A1] base)', () => {
  it('gas smell variants classify as EMERGENCY/gas at high confidence', () => {
    for (const text of ['I smell gas in the kitchen', 'smells like rotten egg', 'hissing near the gas line']) {
      const c = classifyDeterministic(text, { zip: '10001', now: JAN, outsideTempF: 30, weatherFailed: false });
      expect(c.urgency).toBe('EMERGENCY');
      expect(c.emergencyType).toBe('gas');
      expect(c.confidence).toBeGreaterThanOrEqual(0.9);
    }
  });

  it('fire/smoke/CO classify as EMERGENCY', () => {
    const fire = classifyDeterministic('there is smoke coming from the oven', { zip: '10001', now: JAN, outsideTempF: 30, weatherFailed: false });
    expect(fire.urgency).toBe('EMERGENCY');
    expect(fire.emergencyType).toBe('fire');
    const co = classifyDeterministic('the carbon monoxide alarm is going off', { zip: '10001', now: JAN, outsideTempF: 30, weatherFailed: false });
    expect(co.urgency).toBe('EMERGENCY');
    expect(co.emergencyType).toBe('co');
  });

  it('active water classifies as EMERGENCY/water', () => {
    const c = classifyDeterministic('a pipe burst and water is pouring everywhere', { zip: '10001', now: JAN, outsideTempF: 30, weatherFailed: false });
    expect(c.urgency).toBe('EMERGENCY');
    expect(c.emergencyType).toBe('water');
    expect(c.trade).toBe('plumbing');
  });

  it('unclassifiable text lands below the confidence threshold (landlord decides)', () => {
    const c = classifyDeterministic('hmm not sure how to describe it, come look', { zip: '10001', now: JUL, outsideTempF: 80, weatherFailed: false });
    expect(c.confidence).toBeLessThan(CONF_THRESHOLD);
  });
});

describe('[A1] escalation-only refinement', () => {
  it('never silently de-escalates below the deterministic floor', () => {
    const floor = classifyDeterministic('I smell gas in the kitchen', { zip: '10001', now: JAN, outsideTempF: 30, weatherFailed: false });
    expect(floor.urgency).toBe('EMERGENCY');
    const refined = applyRefinement(floor, { proposedUrgency: 'ROUTINE', reason: 'tenant sounded calm' }, CONF_THRESHOLD);
    // Ticket keeps the floor urgency.
    expect(refined.urgency).toBe('EMERGENCY');
    // The attempted downgrade is provisional, logged with reasoning, and surfaced.
    expect(refined.provisionalLower).not.toBeNull();
    expect(refined.provisionalLower!.to).toBe('ROUTINE');
    expect(refined.provisionalLower!.reason).toBe('tenant sounded calm');
    expect(refined.needsLandlord).toBe(true);
  });

  it('escalation is allowed and flags the landlord', () => {
    const floor = classifyDeterministic('the faucet drips', { zip: '10001', now: JUL, outsideTempF: 80, weatherFailed: false });
    const refined = applyRefinement(floor, { proposedUrgency: 'URGENT', reason: 'photo shows mold' }, CONF_THRESHOLD);
    expect(refined.urgency).toBe('URGENT');
    expect(refined.provisionalLower).toBeNull();
  });

  it('no refinement still surfaces low-confidence tickets to the landlord', () => {
    const floor = classifyDeterministic('hmm not sure', { zip: '10001', now: JUL, outsideTempF: 80, weatherFailed: false });
    const refined = applyRefinement(floor, null, CONF_THRESHOLD);
    expect(refined.needsLandlord).toBe(true);
  });
});

describe('[A2] emergency locks the conversation to the safety script', () => {
  it('emergency inbound replies ONLY with the safety script and a landlord wake', () => {
    const db = freshDb();
    const { ticket, replies, landlordWake } = handleInbound(db, 'I smell gas in the kitchen!!', '+15550101', null, JAN);
    expect(ticket.urgency).toBe('EMERGENCY');
    expect(ticket.emergencyType).toBe('gas');
    expect(ticket.emergencyLocked).toBe(true);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toBe(SAFETY_SCRIPTS.gas);
    // No clarifying questions, no photo requests while locked.
    expect(replies[0].toLowerCase()).not.toContain('photo');
    expect(replies[0]).not.toContain('?');
    expect(landlordWake).toHaveLength(1);
    expect(ticket.safetyLog.length).toBeGreaterThan(0);
  });

  it('follow-up texts on a locked ticket stay on the script (still no questions/photos)', () => {
    const db = freshDb();
    const first = handleInbound(db, 'smoke in the hallway', '+15550101', null, JAN);
    const again = handleInbound(db, 'what should I do', '+15550101', null, JAN);
    expect(again.replies).toHaveLength(1);
    expect(again.replies[0]).toBe(SAFETY_SCRIPTS[first.ticket.emergencyType!]);
    expect(again.replies[0]).not.toContain('?');
  });

  it('non-emergency tickets still ask the unit-confirmation question, not the safety script', () => {
    const db = freshDb();
    // Unknown phone -> unit not confirmed.
    const { ticket, replies } = handleInbound(db, 'my faucet is dripping', '+15559999', null, JUL);
    expect(ticket.urgency).toBe('ROUTINE');
    expect(ticket.emergencyLocked).toBe(false);
    expect(replies[0]).not.toBe(SAFETY_SCRIPTS.water);
    expect(replies[0]).toContain('confirm your unit');
  });
});

describe('[A3] gas/fire/CO are 911-first and never auto-dispatched', () => {
  it.each(['gas', 'fire', 'co'] as const)('%s is never auto-dispatchable, even after the timeout', (type) => {
    const db = freshDb();
    db.config.emergencyProtocol.preAuthorized = true;
    db.config.emergencyProtocol.waterAutoDispatchTimeoutMin = 0; // timeout already elapsed
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const t = makeTicket(db, { urgency: 'EMERGENCY', emergencyType: type, unitConfirmed: true, createdAt: old });
    const check = canAutoDispatch(t, db.config, new Date());
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('911-first');
  });

  it('water emergency CAN auto-dispatch after the timeout when the protocol is pre-authorized', () => {
    const db = freshDb();
    db.config.emergencyProtocol.preAuthorized = true;
    db.config.emergencyProtocol.waterAutoDispatchTimeoutMin = 15;
    const old = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const t = makeTicket(db, { urgency: 'EMERGENCY', emergencyType: 'water', unitConfirmed: true, createdAt: old });
    expect(canAutoDispatch(t, db.config, new Date()).allowed).toBe(true);
  });

  it('water emergency does NOT auto-dispatch before the timeout', () => {
    const db = freshDb();
    db.config.emergencyProtocol.preAuthorized = true;
    db.config.emergencyProtocol.waterAutoDispatchTimeoutMin = 15;
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const t = makeTicket(db, { urgency: 'EMERGENCY', emergencyType: 'water', unitConfirmed: true, createdAt: recent });
    expect(canAutoDispatch(t, db.config, new Date()).allowed).toBe(false);
  });

  it('water emergency does NOT auto-dispatch when the protocol is not pre-authorized', () => {
    const db = freshDb();
    db.config.emergencyProtocol.preAuthorized = false;
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const t = makeTicket(db, { urgency: 'EMERGENCY', emergencyType: 'water', unitConfirmed: true, createdAt: old });
    expect(canAutoDispatch(t, db.config, new Date()).allowed).toBe(false);
  });

  it('cron never auto-dispatches gas even with vendor attached and timeout elapsed', () => {
    const db = freshDb();
    db.config.emergencyProtocol.preAuthorized = true;
    db.config.emergencyProtocol.waterAutoDispatchTimeoutMin = 0;
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const t = makeTicket(db, {
      urgency: 'EMERGENCY', emergencyType: 'gas', unitConfirmed: true,
      createdAt: old, sideState: 'ESCALATED', vendorId: 'vendor-1',
    });
    const report = evaluateCron(db, new Date());
    expect(t.state).not.toBe('VENDOR_ASSIGNED');
    expect(report.join(' ')).not.toContain('auto-dispatched');
  });
});

describe('[A4] no-heat winter fail-safe', () => {
  it('no-heat in winter below 40F is an emergency', () => {
    const c = classifyDeterministic('we have no heat and it is freezing', { zip: '10001', now: JAN, outsideTempF: 28, weatherFailed: false });
    expect(c.urgency).toBe('EMERGENCY');
    expect(c.emergencyType).toBe('no_heat');
  });

  it('no-heat in summer is urgent, not an emergency', () => {
    const c = classifyDeterministic('we have no heat', { zip: '10001', now: JUL, outsideTempF: 85, weatherFailed: false });
    expect(c.urgency).toBe('URGENT');
    expect(c.emergencyType).toBeNull();
  });

  it('weather-API failure in winter fails SAFE to emergency', () => {
    const c = classifyDeterministic('no heat in my apartment', { zip: '10001', now: JAN, outsideTempF: null, weatherFailed: true });
    expect(c.urgency).toBe('EMERGENCY');
    expect(c.emergencyType).toBe('no_heat');
  });

  it('weather-API failure in summer does NOT become an emergency', () => {
    const c = classifyDeterministic('no heat in my apartment', { zip: '10001', now: JUL, outsideTempF: null, weatherFailed: true });
    expect(c.urgency).toBe('URGENT');
    expect(c.emergencyType).toBeNull();
  });

  it('winter months are Oct through Mar', () => {
    expect(isWinterMonth(9)).toBe(true); // Oct
    expect(isWinterMonth(0)).toBe(true); // Jan
    expect(isWinterMonth(2)).toBe(true); // Mar
    expect(isWinterMonth(3)).toBe(false); // Apr
    expect(isWinterMonth(6)).toBe(false); // Jul
  });
});

describe('[A5] unit-identity confirmation before dispatch', () => {
  it('dispatch is refused when the unit is not confirmed', () => {
    const db = freshDb();
    const t = makeTicket(db, { unitConfirmed: false, vendorId: 'vendor-1' });
    const check = canDispatch(t, { landlordApproved: true, withinAutoApproveCeiling: true });
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('unit');
  });

  it('confirmUnit marks the unit confirmed and allows dispatch', () => {
    const db = freshDb();
    const t = makeTicket(db, { unitConfirmed: false, vendorId: 'vendor-1', unitId: 'unknown' });
    confirmUnit(db, t.id, '2B');
    expect(t.unitConfirmed).toBe(true);
    expect(t.unitId).toBe('unit-2b');
    const check = canDispatch(t, { landlordApproved: true, withinAutoApproveCeiling: true });
    expect(check.allowed).toBe(true);
  });

  it('confirmUnit rejects an unknown unit label', () => {
    const db = freshDb();
    const t = makeTicket(db, { unitConfirmed: false, vendorId: 'vendor-1' });
    expect(() => confirmUnit(db, t.id, '9Z')).toThrow();
    expect(t.unitConfirmed).toBe(false);
  });
});

describe('[A6] takeover requires acknowledgment handshake plus full stand-down', () => {
  it('takeover sends an acknowledgment and fully stands down', () => {
    const db = freshDb();
    const t = makeTicket(db, { urgency: 'EMERGENCY', emergencyType: 'water', unitConfirmed: true, vendorId: 'vendor-1' });
    takeover(db, t.id, '+15550999');
    expect(t.standDown).toBe(true);
    expect(t.standDownAckAt).not.toBeNull();
    // Handshake: the acknowledgment went back to the landlord.
    const ack = t.thread.find((m) => m.from === 'copilot' && m.text.includes('standing down'));
    expect(ack).toBeDefined();
    expect(t.sideState).toBe('ESCALATED');
  });

  it('after takeover, tenant inbounds produce NO tenant replies and NO vendor contact', () => {
    const db = freshDb();
    const t = makeTicket(db, { urgency: 'URGENT', unitConfirmed: true, vendorId: 'vendor-1' });
    takeover(db, t.id, '+15550999');
    const smsBefore = db.smsLog.length;
    const { replies, landlordWake } = handleInbound(db, 'any update?', '+15550101', null, JUL);
    expect(replies).toHaveLength(0);
    expect(landlordWake).toHaveLength(0);
    expect(db.smsLog.length).toBe(smsBefore); // zero new outbound messages
  });

  it('dispatch is refused after stand-down (no double-dispatch)', () => {
    const db = freshDb();
    const t = makeTicket(db, { unitConfirmed: true, vendorId: 'vendor-1' });
    takeover(db, t.id, '+15550999');
    expect(canDispatch(t, { landlordApproved: true, withinAutoApproveCeiling: true }).allowed).toBe(false);
    expect(canAutoDispatch(t, db.config, new Date()).allowed).toBe(false);
  });
});

describe('[A7] STALE re-dispatch is bound by tier spend ceilings', () => {
  function staleTicket(db: Db, overrides: Partial<Ticket> = {}): Ticket {
    return makeTicket(db, {
      state: 'VENDOR_ASSIGNED',
      urgency: 'URGENT',
      unitConfirmed: true,
      vendorId: 'vendor-1',
      estimate: 100,
      assignedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(), // idle 6h > 4h staleHours
      ...overrides,
    });
  }

  it('vendor no-show within bounds re-dispatches and counts toward the bounds', () => {
    const db = freshDb();
    const t = staleTicket(db);
    const report = evaluateCron(db, new Date());
    expect(t.reDispatchCount).toBe(1);
    expect(t.cumulativeProposedSpend).toBe(100);
    expect(t.sideState).not.toBe('ESCALATED');
    expect(report.join(' ')).toContain('re-dispatched');
  });

  it('hitting the max re-dispatch count escalates to the landlord instead', () => {
    const db = freshDb();
    db.config.maxReDispatches = 2;
    const t = staleTicket(db, { reDispatchCount: 2 });
    const report = evaluateCron(db, new Date());
    expect(t.reDispatchCount).toBe(2); // not incremented
    expect(t.sideState).toBe('ESCALATED');
    expect(report.join(' ')).toContain('ESCALATED');
  });

  it('cumulative spend hitting the tier ceiling escalates instead of re-dispatching', () => {
    const db = freshDb();
    db.config.autoApproveCeilings.URGENT = 300;
    const t = staleTicket(db, { cumulativeProposedSpend: 250, estimate: 100 }); // 250+100 > 300
    const report = evaluateCron(db, new Date());
    expect(t.reDispatchCount).toBe(0);
    expect(t.sideState).toBe('ESCALATED');
    expect(report.join(' ')).toContain('ESCALATED');
  });

  it('emergency tier re-dispatch is count-bounded (ceiling 0 means notify-first, not no-retry)', () => {
    const db = freshDb();
    const t = staleTicket(db, { urgency: 'EMERGENCY', estimate: 0 });
    const check = canReDispatch(t, db.config, 0);
    expect(check.allowed).toBe(true);
  });
});

describe('spend ceilings: emergency always notifies first', () => {
  it('emergency tier ceiling 0 never auto-approves', () => {
    const db = freshDb();
    expect(withinAutoApproveCeiling('EMERGENCY', 1, db.config)).toBe(false);
    expect(withinAutoApproveCeiling('EMERGENCY', 100000, db.config)).toBe(false);
  });

  it('routine under $150 auto-approves; over does not', () => {
    const db = freshDb();
    expect(withinAutoApproveCeiling('ROUTINE', 149, db.config)).toBe(true);
    expect(withinAutoApproveCeiling('ROUTINE', 151, db.config)).toBe(false);
  });
});

describe('outbound SMS is stubbed (never sent)', () => {
  it('emergency inbound logs messages without sending', () => {
    const db = freshDb();
    handleInbound(db, 'I smell gas', '+15550101', null, JAN);
    expect(db.smsLog.length).toBeGreaterThan(0);
    // Every logged message is a stub: no send flag exists anywhere in the store.
  });

  it('follow-up texts on an already-triaged ticket never throw or move backward', () => {
    const db = freshDb();
    const first = handleInbound(db, 'my faucet drips', '+15550101', null, JUL);
    const id = first.ticket.id;
    const second = handleInbound(db, 'still dripping, louder now', '+15550101', null, JUL);
    expect(second.ticket.id).toBe(id);
    expect(second.ticket.state).toBe('AWAITING_APPROVAL');
    expect(second.replies).toHaveLength(1);
  });
});
