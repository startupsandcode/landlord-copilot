'use client';

import { useEffect, useState } from 'react';

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>('');
  const [data, setData] = useState<any>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [vendorId, setVendorId] = useState('');
  const [estimate, setEstimate] = useState('150');
  const [unitLabel, setUnitLabel] = useState('');

  useEffect(() => { params.then((p) => setId(p.id)); }, [params]);

  const load = async () => {
    if (!id) return;
    const d = await (await fetch(`/api/tickets/${id}`)).json();
    setData(d);
    const v = await (await fetch('/api/vendors')).json();
    setVendors(v.vendors ?? []);
  };
  useEffect(() => { load(); }, [id]);

  const act = async (action: string, extra: any = {}) => {
    await fetch(`/api/tickets/${id}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    });
    load();
  };

  if (!data?.ticket) return <div className="wrap"><p className="muted">Loading…</p></div>;
  const t = data.ticket;

  return (
    <div>
      <a href="/dashboard">&larr; Dashboard</a>
      <h1>Ticket {t.id}</h1>
      <div className="row">
        <span className={`badge b-${t.urgency}`}>{t.urgency}</span>
        <span className="badge b-state">{t.state}</span>
        {t.sideState && <span className={`badge b-${t.sideState}`}>{t.sideState}</span>}
        {t.standDown && <span className="badge b-state">STAND-DOWN</span>}
        <span className="muted">{t.trade} &middot; confidence {Number(t.confidence).toFixed(2)}</span>
      </div>

      {t.emergencyLocked && (
        <div className="alert"><strong>Emergency locked.</strong> Conversation is on the safety script only. No clarifying questions or photo requests.</div>
      )}
      {t.provisionalLower && (
        <div className="alert">
          <strong>Provisional downgrade:</strong> {t.provisionalLower.from} to {t.provisionalLower.to}: {t.provisionalLower.reason}. Not applied. Confirm or reject below.
        </div>
      )}
      {t.needsLandlordConfirmation && !t.provisionalLower && (
        <div className="alert"><strong>Needs your call.</strong> Low-confidence classification.</div>
      )}
      {!t.unitConfirmed && (
        <div className="alert">
          <strong>Unit identity not confirmed.</strong> Dispatch is blocked until the tenant confirms the unit.
          <div className="row" style={{ marginTop: 8 }}>
            <input placeholder="Unit label (e.g. 2B)" value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} />
            <button onClick={() => act('confirmUnit', { label: unitLabel })}>Confirm unit</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Actions</h2>
        <div className="row">
          <select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
            <option value="">Pick vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.trade})</option>)}
          </select>
          <input type="number" value={estimate} onChange={(e) => setEstimate(e.target.value)} style={{ width: 100 }} />
          <button onClick={() => act('propose', { vendorId, estimate: Number(estimate) })}>Propose vendor</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => act('approve')}>Approve</button>
          <button onClick={() => act('dispatch', { vendorId: vendorId || undefined, estimate: Number(estimate), landlordApproved: true })}>Dispatch (approved)</button>
          <button className="secondary" onClick={() => act('nudge')}>Nudge vendor</button>
          <button className="secondary" onClick={() => act('vendorResponded')}>Vendor responded</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => act('fixed', { fixed: true })}>Tenant: fixed</button>
          <button className="secondary" onClick={() => act('fixed', { fixed: false })}>Tenant: still broken</button>
          <button className="secondary" onClick={() => act('close')}>Close out</button>
          <button className="danger" onClick={() => act('takeover')}>I will handle it (takeover)</button>
        </div>
      </div>

      <div className="card">
        <h2>Thread</h2>
        <div className="thread">
          {t.thread.map((m: any, i: number) => (
            <div key={i} className={`msg ${m.from}`}>
              <span className="who">{m.from} &middot; {m.at}</span>
              {m.text}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>State transitions (timestamped)</h2>
        <table>
          <thead><tr><th>At</th><th>From</th><th>To</th><th>Note</th></tr></thead>
          <tbody>
            {t.transitions.map((tr: any, i: number) => (
              <tr key={i}><td>{tr.at}</td><td>{tr.from}</td><td>{tr.to}</td><td>{tr.note}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      {t.safetyLog.length > 0 && (
        <div className="card">
          <h2>Safety log (append-only)</h2>
          {t.safetyLog.map((s: string, i: number) => <p key={i} className="muted">{s}</p>)}
        </div>
      )}
    </div>
  );
}
