// Deterministic urgency classifier: keyword heuristics FIRST, refinement layer
// implements [A1] escalation-only. No LLM in the MVP: the "refinement" rule is
// coded explicitly so the safety property is provable in tests.

import type { EmergencyType, Trade, Urgency } from './types';
import { isWinterMonth } from './weather';

export const URGENCY_RANK: Record<Urgency, number> = { ROUTINE: 0, URGENT: 1, EMERGENCY: 2 };

export interface Classification {
  urgency: Urgency;
  emergencyType: EmergencyType | null;
  trade: Trade;
  confidence: number;
  matchedKeywords: string[];
}

interface EmergencyPattern {
  type: EmergencyType;
  trade: Trade;
  keywords: string[];
}

const EMERGENCY_PATTERNS: EmergencyPattern[] = [
  // [A3] gas/fire/CO are 911-first and never auto-dispatched; classification must never miss them.
  { type: 'gas', trade: 'hvac', keywords: ['gas smell', 'smells like gas', 'smell gas', 'smell of gas', 'rotten egg', 'hissing', 'gas leak'] },
  { type: 'fire', trade: 'general', keywords: ['fire', 'smoke', 'burning smell', 'flames'] },
  { type: 'co', trade: 'hvac', keywords: ['carbon monoxide', 'co alarm', 'co detector', 'co poisoning'] },
  { type: 'water', trade: 'plumbing', keywords: ['burst pipe', 'pipe burst', 'water pouring', 'pouring water', 'pouring from', 'flooding', 'water coming through', 'ceiling leaking', 'gushing', 'water everywhere'] },
  { type: 'electrical', trade: 'electrical', keywords: ['sparking', 'sparks', 'outlet smoking', 'smoking outlet', 'wires burning'] },
  { type: 'security', trade: 'lock', keywords: ['break in', 'broke in', 'break-in', "can't lock", 'cannot lock', 'door won\'t lock', 'lock is broken', 'broken lock'] },
];

interface UrgentPattern {
  trade: Trade;
  keywords: string[];
}

const URGENT_PATTERNS: UrgentPattern[] = [
  { trade: 'plumbing', keywords: ['no hot water', 'water heater', 'toilet overflowing', 'sewage', 'no water'] },
  { trade: 'electrical', keywords: ['power out', 'no power', 'half the power', 'breaker keeps tripping'] },
  { trade: 'lock', keywords: ['locked out', 'lockout', 'lost keys', 'key broke'] },
  { trade: 'appliance', keywords: ['fridge not working', 'refrigerator not working', 'oven not working', 'gas stove not working'] },
  { trade: 'hvac', keywords: ['ac not working', 'air conditioning not working'] },
];

const TRADE_PATTERNS: { trade: Trade; keywords: string[] }[] = [
  { trade: 'plumbing', keywords: ['sink', 'toilet', 'faucet', 'pipe', 'leak', 'drip', 'drain', 'shower', 'water heater', 'bath'] },
  { trade: 'electrical', keywords: ['outlet', 'light', 'switch', 'breaker', 'power', 'electric'] },
  { trade: 'hvac', keywords: ['heat', 'furnace', 'ac ', 'air condition', 'thermostat', 'radiator', 'boiler'] },
  { trade: 'appliance', keywords: ['fridge', 'refrigerator', 'oven', 'stove', 'dishwasher', 'washer', 'dryer', 'microwave'] },
  { trade: 'lock', keywords: ['lock', 'door', 'key', 'deadbolt', 'knob'] },
];

export interface ClassifyContext {
  /** property zip, used with the weather check for no-heat */
  zip: string;
  now: Date;
  outsideTempF: number | null;
  weatherFailed: boolean;
}

function containsAny(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => lower.includes(k.toLowerCase()));
}

function classifyTrade(text: string): { trade: Trade; matched: string[] } {
  for (const { trade, keywords } of TRADE_PATTERNS) {
    const matched = containsAny(text, keywords);
    if (matched.length > 0) return { trade, matched };
  }
  return { trade: 'general', matched: [] };
}

function noHeatEmergency(ctx: ClassifyContext): boolean {
  // [A4] No-heat in winter is an emergency. Weather-API failure in winter
  // months (Oct-Mar) fails SAFE to emergency rather than guessing.
  const winter = isWinterMonth(ctx.now.getMonth());
  if (!winter) return false;
  if (ctx.weatherFailed) return true;
  if (ctx.outsideTempF === null) return true;
  return ctx.outsideTempF < 40;
}

/**
 * Deterministic first pass. EMERGENCY keywords, low confidence, or
 * conflicting signals escalate. This function only ever sets a FLOOR:
 * callers must not lower its result without the provisional rule ([A1]).
 */
export function classifyDeterministic(text: string, ctx: ClassifyContext): Classification {
  const matched: string[] = [];

  for (const pattern of EMERGENCY_PATTERNS) {
    const hits = containsAny(text, pattern.keywords);
    if (hits.length > 0) {
      matched.push(...hits);
      return {
        urgency: 'EMERGENCY',
        emergencyType: pattern.type,
        trade: pattern.trade,
        confidence: 0.95,
        matchedKeywords: matched,
      };
    }
  }

  // No-heat path: winter check happens before generic urgent keywords.
  const noHeatHits = containsAny(text, ['no heat', 'heat not working', "heat isn't working", 'no heating', 'furnace not working', 'furnace won\'t']);
  if (noHeatHits.length > 0) {
    const isEmergency = noHeatEmergency(ctx);
    return {
      urgency: isEmergency ? 'EMERGENCY' : 'URGENT',
      emergencyType: isEmergency ? 'no_heat' : null,
      trade: 'hvac',
      confidence: ctx.weatherFailed ? 0.85 : 0.9,
      matchedKeywords: [...noHeatHits, ...(isEmergency ? ['winter-no-heat'] : [])],
    };
  }

  for (const pattern of URGENT_PATTERNS) {
    const hits = containsAny(text, pattern.keywords);
    if (hits.length > 0) {
      return { urgency: 'URGENT', emergencyType: null, trade: pattern.trade, confidence: 0.85, matchedKeywords: hits };
    }
  }

  const { trade, matched: tradeMatched } = classifyTrade(text);
  if (tradeMatched.length > 0) {
    return { urgency: 'ROUTINE', emergencyType: null, trade, confidence: 0.75, matchedKeywords: tradeMatched };
  }

  // No signal at all: below threshold, the landlord decides.
  return { urgency: 'ROUTINE', emergencyType: null, trade: 'general', confidence: 0.4, matchedKeywords: [] };
}

export interface Refinement {
  /** Proposed by the (human or future LLM) refinement layer; may be higher or lower. */
  proposedUrgency: Urgency;
  reason: string;
}

/**
 * [A1] Refinement layer: escalation-only. A refinement may raise urgency;
 * it may NEVER silently lower it below the deterministic floor. A downward
 * refinement is returned as PROVISIONAL: the ticket keeps its floor urgency,
 * and the landlord must confirm before anything is downgraded.
 */
export function applyRefinement(
  floor: Classification,
  refinement: Refinement | null,
  confidenceThreshold: number,
): Classification & { provisionalLower: { from: Urgency; to: Urgency; reason: string } | null; needsLandlord: boolean } {
  if (!refinement) {
    return { ...floor, provisionalLower: null, needsLandlord: floor.confidence < confidenceThreshold };
  }
  const { proposedUrgency, reason } = refinement;
  if (URGENCY_RANK[proposedUrgency] > URGENCY_RANK[floor.urgency]) {
    return { ...floor, urgency: proposedUrgency, provisionalLower: null, needsLandlord: true };
  }
  if (URGENCY_RANK[proposedUrgency] < URGENCY_RANK[floor.urgency]) {
    // De-escalation attempted: keep the floor, mark provisional, surface to landlord.
    return {
      ...floor,
      provisionalLower: { from: floor.urgency, to: proposedUrgency, reason },
      needsLandlord: true,
    };
  }
  return { ...floor, provisionalLower: null, needsLandlord: floor.confidence < confidenceThreshold };
}
