import { NextRequest, NextResponse } from 'next/server';
import { mutateDb } from '@/lib/store';
import {
  transition,
  appendThread,
  takeover,
  closeTicket,
  confirmFixed,
  confirmUnit,
  recommendVendor,
  withinAutoApproveCeiling,
} from '@/lib/engine';
import { canDispatch } from '@/lib/safety';
import { logSms } from '@/lib/sms';

/**
 * POST /api/tickets/[id]/action — landlord actions:
 *   propose  {vendorId, estimate}   -> AWAITING_APPROVAL with vendor proposal
 *   approve  {}                     -> explicit landlord approval
 *   dispatch {vendorId?, estimate?}  -> [A5] unit-confirmed dispatch (approval required)
 *   takeover {}                     -> [A6] "I'll handle it": handshake + full stand-down
 *   confirmUnit {label}             -> [A5] unit identity confirmation
 *   fixed {fixed: boolean}          -> tenant "is it fixed?" confirmation
 *   nudge {}                        -> vendor no-show nudge (STALE flow helper)
 *   close {}                        -> landlord close-out
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const json = await req.json().catch(() => ({}));
  const action = String(json.action ?? '');

  try {
    const result = mutateDb((db) => {
      const ticket = db.tickets.find((t) => t.id === id);
      if (!ticket) throw new Error('not found');
      const prop = db.properties.find((p) => p.id === ticket.propertyId);
      const unitLabel = prop?.units.find((u) => u.id === ticket.unitId)?.label ?? ticket.unitId;

      switch (action) {
        case 'propose': {
          const vendor = db.vendors.find((v) => v.id === json.vendorId) ?? recommendVendor(db, ticket.trade);
          if (!vendor) throw new Error('no vendor available');
          ticket.vendorId = vendor.id;
          ticket.estimate = Number(json.estimate ?? 0);
          ticket.cumulativeProposedSpend += ticket.estimate;
          const autoOk = withinAutoApproveCeiling(ticket.urgency, ticket.estimate, db.config);
          if (ticket.state === 'TRIAGED') transition(ticket, 'AWAITING_APPROVAL', `vendor proposed: ${vendor.name} ($${ticket.estimate})`);
          appendThread(ticket, 'copilot', `[vendor proposal] ${vendor.name} (${vendor.trade}) est. $${ticket.estimate}. ${autoOk ? 'Within auto-approve ceiling.' : 'Requires your approval.'}`);
          if (autoOk) transition(ticket, 'VENDOR_ASSIGNED', '[auto-approve] within tier ceiling');
          return { ticket, autoApproved: autoOk };
        }
        case 'approve': {
          if (ticket.state !== 'AWAITING_APPROVAL') throw new Error(`cannot approve from ${ticket.state}`);
          appendThread(ticket, 'landlord', 'Approved.');
          transition(ticket, 'VENDOR_ASSIGNED', 'landlord approved');
          ticket.assignedAt = new Date().toISOString();
          const vendor = db.vendors.find((v) => v.id === ticket.vendorId);
          const msg = `New job: ${prop?.address}, unit ${unitLabel} - ${ticket.urgency.toLowerCase()} ${ticket.trade} (est. $${ticket.estimate ?? 0}). Tenant: ${ticket.tenantName} ${ticket.tenantPhone}. Reply CONFIRM.`;
          if (vendor) logSms(db, { to: vendor.phone, text: msg, context: `dispatch:${ticket.id}` });
          appendThread(ticket, 'copilot', `[vendor contacted] ${msg}`);
          return { ticket };
        }
        case 'dispatch': {
          const vendorId = json.vendorId ?? ticket.vendorId;
          if (!vendorId) throw new Error('no vendor selected');
          ticket.vendorId = vendorId;
          ticket.estimate = Number(json.estimate ?? ticket.estimate ?? 0);
          const gate = canDispatch(ticket, {
            landlordApproved: json.landlordApproved === true,
            withinAutoApproveCeiling: withinAutoApproveCeiling(ticket.urgency, ticket.estimate, db.config),
          });
          if (!gate.allowed) throw new Error(gate.reason);
          if (['TRIAGED', 'AWAITING_APPROVAL'].includes(ticket.state)) {
            transition(ticket, 'VENDOR_ASSIGNED', `dispatched: ${gate.reason}`);
          }
          ticket.assignedAt = new Date().toISOString();
          const vendor = db.vendors.find((v) => v.id === vendorId);
          const msg = `Job confirmed: ${prop?.address}, unit ${unitLabel} - ${ticket.urgency.toLowerCase()} ${ticket.trade}. Tenant: ${ticket.tenantName} ${ticket.tenantPhone}.`;
          if (vendor) logSms(db, { to: vendor.phone, text: msg, context: `dispatch:${ticket.id}` });
          appendThread(ticket, 'copilot', `[dispatched] ${vendor?.name}: ${msg}`);
          return { ticket };
        }
        case 'takeover': {
          // [A6] handshake + full stand-down
          takeover(db, ticket.id, db.config.emergencyProtocol.landlordCallList[0] ?? '');
          return { ticket };
        }
        case 'confirmUnit': {
          confirmUnit(db, ticket.id, String(json.label ?? ''));
          return { ticket };
        }
        case 'fixed': {
          confirmFixed(db, ticket.id, json.fixed === true);
          return { ticket };
        }
        case 'nudge': {
          const vendor = db.vendors.find((v) => v.id === ticket.vendorId);
          const msg = `Nudge: awaiting your response on ticket ${ticket.id} (${prop?.address}, unit ${unitLabel}). Please reply.`;
          if (vendor) logSms(db, { to: vendor.phone, text: msg, context: `vendor-nudge:${ticket.id}` });
          appendThread(ticket, 'copilot', `[vendor nudge] ${msg}`);
          return { ticket };
        }
        case 'close': {
          closeTicket(db, ticket.id);
          return { ticket };
        }
        case 'vendorResponded': {
          ticket.vendorRespondedAt = new Date().toISOString();
          if (ticket.state === 'VENDOR_ASSIGNED') transition(ticket, 'IN_PROGRESS', 'vendor responded');
          appendThread(ticket, 'vendor', 'Confirmed, on my way.');
          return { ticket };
        }
        default:
          throw new Error(`unknown action: ${action}`);
      }
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'error';
    const status = message === 'not found' ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
