// Safety scripts and dispatch guards.
// [A2] emergency locks the conversation to the safety script.
// [A3] gas/fire/CO are 911-first and NEVER auto-dispatched.
// [A4] no-heat weather failure fails safe (see weather.ts / classifier.ts).

import type { EmergencyType, Ticket, Config } from './types';

export const SAFETY_SCRIPTS: Record<EmergencyType, string> = {
  gas: 'URGENT SAFETY: Leave your unit NOW. Do not touch light switches or appliances. Call 911 and your gas utility from outside. I have alerted your landlord. Do not re-enter until cleared.',
  fire: 'URGENT SAFETY: Leave the building NOW and call 911. Do not try to fight the fire. I have alerted your landlord. Stay out until firefighters clear the building.',
  co: 'URGENT SAFETY: Leave your unit NOW and call 911. Carbon monoxide is invisible and deadly. Do not re-enter until emergency services clear it. I have alerted your landlord.',
  water: 'URGENT: A plumber is being contacted. If you know your unit water shut-off, turn it clockwise to stop the flow. Move valuables away from water. Your landlord has been alerted.',
  no_heat: 'URGENT: No heat in freezing weather is an emergency. Your landlord has been alerted and help is being arranged. Stay warm with layers and blankets; do not use ovens or grills for heat.',
  security: 'URGENT: Your landlord has been alerted. If there is an intruder or you feel unsafe, call 911 first. Stay somewhere safe until help arrives.',
  electrical: 'URGENT SAFETY: Do not touch the sparking outlet or switch. If safe, turn off the breaker for that area. If you see smoke or smell burning, leave and call 911. Your landlord has been alerted.',
};

/** Exact tenant-facing intro text for the safety boundary (terms, not a 911 replacement). */
export const TENANT_INTRO_TEXT =
  'This maintenance line helps reach your landlord faster. For fire, gas, or immediate danger, call 911 first. This is a coordination service, not emergency services.';

export interface DispatchCheck {
  allowed: boolean;
  reason: string;
}

/**
 * [A3] Auto-dispatch gate. Gas/fire/CO are 911-first: never auto-dispatched,
 * excluded from the no-response timeout. Only WATER-type emergencies qualify,
 * and only under a pre-authorized protocol, with a confirmed unit identity,
 * after the landlord-configured timeout has elapsed with no landlord response.
 * Non-emergency tickets never auto-dispatch; they need explicit approval.
 */
export function canAutoDispatch(ticket: Ticket, config: Config, now: Date): DispatchCheck {
  if (ticket.standDown) return { allowed: false, reason: 'stand-down: landlord took over' };
  if (ticket.urgency !== 'EMERGENCY' || !ticket.emergencyType) {
    return { allowed: false, reason: 'auto-dispatch is emergency-only' };
  }
  if (['gas', 'fire', 'co'].includes(ticket.emergencyType)) {
    return { allowed: false, reason: '911-first: gas/fire/CO never auto-dispatch' };
  }
  if (ticket.emergencyType !== 'water') {
    return { allowed: false, reason: 'auto-dispatch timeout applies to water-type emergencies only' };
  }
  if (!ticket.unitConfirmed) return { allowed: false, reason: '[A5] unit identity not confirmed' };
  if (!config.emergencyProtocol.preAuthorized) {
    return { allowed: false, reason: 'emergency protocol not pre-authorized by landlord' };
  }
  const elapsedMin = (now.getTime() - new Date(ticket.createdAt).getTime()) / 60000;
  if (elapsedMin < config.emergencyProtocol.waterAutoDispatchTimeoutMin) {
    return {
      allowed: false,
      reason: `landlord no-response timeout (${config.emergencyProtocol.waterAutoDispatchTimeoutMin} min) not yet elapsed`,
    };
  }
  return { allowed: true, reason: 'water emergency, timeout elapsed, protocol pre-authorized' };
}

/**
 * Explicit dispatch gate used by the approval flow: landlord approval (or
 * qualifying auto-approve), confirmed unit identity, no stand-down.
 */
export function canDispatch(ticket: Ticket, opts: { landlordApproved: boolean; withinAutoApproveCeiling: boolean }): DispatchCheck {
  if (ticket.standDown) return { allowed: false, reason: 'stand-down: landlord took over' };
  if (!ticket.unitConfirmed) return { allowed: false, reason: '[A5] confirm the unit with the tenant before dispatch' };
  if (!ticket.vendorId) return { allowed: false, reason: 'no vendor selected' };
  if (!opts.landlordApproved && !opts.withinAutoApproveCeiling) {
    return { allowed: false, reason: 'requires explicit landlord approval' };
  }
  return { allowed: true, reason: 'ok' };
}

/**
 * [A7] STALE re-dispatch bound: total re-dispatches AND cumulative proposed
 * spend are bounded by the landlord's per-tier ceilings. Exceeding either
 * escalates to the landlord instead of spending more.
 */
export function canReDispatch(ticket: Ticket, config: Config, nextEstimate: number): DispatchCheck {
  if (ticket.reDispatchCount >= config.maxReDispatches) {
    return { allowed: false, reason: `max re-dispatches reached (${config.maxReDispatches})` };
  }
  const ceiling = config.autoApproveCeilings[ticket.urgency];
  const projected = ticket.cumulativeProposedSpend + nextEstimate;
  if (ceiling > 0 && projected > ceiling) {
    return { allowed: false, reason: `cumulative spend $${projected} would exceed ${ticket.urgency} ceiling $${ceiling}` };
  }
  if (ceiling === 0) {
    // Emergency tier: ceiling 0 means always notify first, but STALE re-dispatch of the
    // same emergency vendor is still bounded by the re-dispatch count, not spend.
    return { allowed: true, reason: 'emergency tier: re-dispatch bounded by count only' };
  }
  return { allowed: true, reason: 'within bounds' };
}
