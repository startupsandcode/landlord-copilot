// Landlord Maintenance Triage Copilot - domain types.
// Spec v1, amendments [A1]-[A9] enforced in lib code, not just docs.

export type Urgency = 'EMERGENCY' | 'URGENT' | 'ROUTINE';
export type EmergencyType = 'gas' | 'fire' | 'co' | 'water' | 'no_heat' | 'security' | 'electrical';
export type Trade = 'plumbing' | 'electrical' | 'hvac' | 'appliance' | 'lock' | 'general';

export type TicketState =
  | 'NEW'
  | 'TRIAGED'
  | 'AWAITING_APPROVAL'
  | 'VENDOR_ASSIGNED'
  | 'IN_PROGRESS'
  | 'RESOLVED'
  | 'CLOSED';

export type SideState = 'ESCALATED' | 'STALE';

export interface Transition {
  at: string;
  from: string;
  to: string;
  note?: string;
}

export interface ThreadMessage {
  at: string;
  from: 'tenant' | 'copilot' | 'landlord' | 'vendor';
  text: string;
  /** true when this outbound message was a real send; MVP stubs are always logged-only */
  sent?: boolean;
}

export interface ProvisionalLower {
  from: Urgency;
  to: Urgency;
  reason: string;
  at: string;
}

export interface Ticket {
  id: string;
  createdAt: string;
  updatedAt: string;
  state: TicketState;
  sideState: SideState | null;
  tenantPhone: string;
  tenantName: string;
  propertyId: string;
  unitId: string;
  /** [A5] unit identity confirmed by the tenant before any dispatch */
  unitConfirmed: boolean;
  urgency: Urgency;
  emergencyType: EmergencyType | null;
  trade: Trade;
  confidence: number;
  matchedKeywords: string[];
  /** [A1] refinement layer may only escalate; a would-be downgrade stays provisional and surfaces to the landlord */
  provisionalLower: ProvisionalLower | null;
  needsLandlordConfirmation: boolean;
  /** [A2] emergency conversation locked to the safety script */
  emergencyLocked: boolean;
  /** [A6] landlord takeover: copilot acknowledged and fully stood down */
  standDown: boolean;
  standDownAckAt: string | null;
  thread: ThreadMessage[];
  transitions: Transition[];
  /** append-only, immutable log of emergency escalations (36-month retention policy) */
  safetyLog: string[];
  vendorId: string | null;
  estimate: number | null;
  reDispatchCount: number;
  cumulativeProposedSpend: number;
  assignedAt: string | null;
  vendorRespondedAt: string | null;
  fixedConfirmed: boolean;
  closedAt: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  trade: Trade;
  phone: string;
  notes: string;
  active: boolean;
}

export interface Unit {
  id: string;
  label: string;
  tenantName: string;
  tenantPhone: string;
}

export interface Property {
  id: string;
  address: string;
  zip: string;
  shutoffNotes: string;
  units: Unit[];
}

export interface EmergencyProtocol {
  /** [A3] auto-dispatch timeout applies ONLY to water-type emergencies under a pre-authorized protocol */
  preAuthorized: boolean;
  landlordCallList: string[];
  waterAutoDispatchTimeoutMin: number;
  /** tenant-facing emergency text shown at onboarding ("call 911 first ...") */
  introText: string;
}

export interface Config {
  autoApproveCeilings: Record<Exclude<Urgency, 'EMERGENCY'>, number> & { EMERGENCY: number };
  /** emergency ceiling 0 means: always notify first, never auto-approve */
  afterHoursStart: string;
  afterHoursEnd: string;
  /** [A7] STALE re-dispatch bounds */
  staleHours: number;
  maxReDispatches: number;
  /** [A4] weather simulation for the no-heat path */
  weather: {
    simulatedOutsideTempF: number | null;
    simulateWeatherFailure: boolean;
  };
  emergencyProtocol: EmergencyProtocol;
  confidenceThreshold: number;
  digestEnabled: boolean;
}

export interface Db {
  properties: Property[];
  tickets: Ticket[];
  vendors: Vendor[];
  config: Config;
  /** outbound SMS stub log: nothing here was ever sent anywhere */
  smsLog: { at: string; to: string; text: string; context: string }[];
  seq: number;
}
