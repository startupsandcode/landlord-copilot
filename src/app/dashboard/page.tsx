'use client';

import { useEffect, useState } from 'react';

type Tab = 'tickets' | 'digest' | 'vendors' | 'config' | 'units';

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('tickets');
  const [data, setData] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    (async () => {
      if (tab === 'tickets') setData(await (await fetch('/api/tickets')).json());
      if (tab === 'digest') setData(await (await fetch('/api/digest')).json());
      if (tab === 'vendors') setData(await (await fetch('/api/vendors')).json());
      if (tab === 'config') setData(await (await fetch('/api/config')).json());
      if (tab === 'units') setData(await (await fetch('/api/tickets')).json());
    })();
  }, [tab, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <h1>Dashboard</h1>
      <div className="tabs">
        {(['tickets', 'digest', 'vendors', 'config', 'units'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : 'secondary'} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button className="secondary" onClick={refresh}>Refresh</button>
      </div>

      {tab === 'tickets' && data && <TicketList tickets={data.tickets} />}
      {tab === 'digest' && data && <DigestView digest={data} />}
      {tab === 'vendors' && data && <VendorManager vendors={data.vendors} onChange={refresh} />}
      {tab === 'config' && data && <ConfigEditor config={data.config} onChange={refresh} />}
      {tab === 'units' && data && <UnitHistory tickets={data.tickets} />}
    </div>
  );
}

function TicketList({ tickets }: { tickets: any[] }) {
  if (!tickets?.length) return <p className="muted">No tickets yet. Send a simulated SMS to create one.</p>;
  return (
    <div>
      {tickets.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <span className={`badge b-${t.urgency}`}>{t.urgency}</span>
            <span className="badge b-state">{t.state}</span>
            {t.sideState && <span className={`badge b-${t.sideState}`}>{t.sideState}</span>}
            {t.standDown && <span className="badge b-state">STAND-DOWN</span>}
            <a href={`/tickets/${t.id}`}><strong>{t.id}</strong></a>
          </div>
          <p className="muted">
            {t.tenantName} &middot; unit {t.unitId} &middot; {t.trade} &middot; confidence {Number(t.confidence).toFixed(2)}
            {t.provisionalLower && ` — provisional downgrade ${t.provisionalLower.from}→${t.provisionalLower.to} needs your call`}
          </p>
          <p>{t.thread?.[0]?.text}</p>
        </div>
      ))}
    </div>
  );
}

function DigestView({ digest }: { digest: any }) {
  const item = (id: string) => (
    <span key={id} style={{ marginRight: 8 }}>
      <a href={`/tickets/${id}`}>{id}</a>
    </span>
  );
  return (
    <div>
      <p className="muted">Generated {digest.generatedAt}. Open tickets: {digest.openCount}.</p>
      <div className="card">
        <h2>Emergencies ({digest.emergencies.length})</h2>
        <div>{digest.emergencies.map(item)}</div>
      </div>
      <div className="card">
        <h2>Awaiting approval ({digest.awaitingApproval.length})</h2>
        <div>{digest.awaitingApproval.map(item)}</div>
      </div>
      <div className="card">
        <h2>Needs your call ({digest.needsCall.length})</h2>
        <p className="muted">Low-confidence or provisional-downgrade tickets. Nothing here was downgraded silently.</p>
        <div>{digest.needsCall.map(item)}</div>
      </div>
      <div className="card">
        <h2>Stale ({digest.stale.length}) / Escalated ({digest.escalated.length})</h2>
        <div>{digest.stale.map(item)} {digest.escalated.map(item)}</div>
      </div>
      <div className="card">
        <h2>Recent</h2>
        <table>
          <thead><tr><th>Ticket</th><th>Urgency</th><th>State</th><th>Trade</th><th>Tenant</th></tr></thead>
          <tbody>
            {digest.recent.map((r: any) => (
              <tr key={r.id}><td><a href={`/tickets/${r.id}`}>{r.id}</a></td><td>{r.urgency}</td><td>{r.state}</td><td>{r.trade}</td><td>{r.tenantName}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorManager({ vendors, onChange }: { vendors: any[]; onChange: () => void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [trade, setTrade] = useState('general');
  const add = async () => {
    await fetch('/api/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, phone, trade }) });
    setName(''); setPhone(''); onChange();
  };
  const remove = async (id: string) => {
    await fetch(`/api/vendors/${id}`, { method: 'DELETE' });
    onChange();
  };
  return (
    <div>
      <div className="card">
        <h2>Add vendor</h2>
        <div className="row">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <select value={trade} onChange={(e) => setTrade(e.target.value)}>
            {['plumbing', 'electrical', 'hvac', 'appliance', 'lock', 'general'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={add}>Add</button>
        </div>
      </div>
      {vendors?.map((v) => (
        <div className="card" key={v.id}>
          <strong>{v.name}</strong> <span className="muted">({v.trade}) {v.phone}</span>
          <p className="muted">{v.notes}</p>
          <button className="danger secondary" onClick={() => remove(v.id)}>Remove</button>
        </div>
      ))}
    </div>
  );
}

function ConfigEditor({ config, onChange }: { config: any; onChange: () => void }) {
  const [form, setForm] = useState<any>(null);
  useEffect(() => { if (config) setForm(JSON.parse(JSON.stringify(config))); }, [config]);
  if (!form) return null;
  const set = (path: string[], value: any) => {
    const f = { ...form };
    let cur: any = f;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]];
    cur[path[path.length - 1]] = value;
    setForm(f);
  };
  const save = async () => {
    await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    onChange();
  };
  return (
    <div>
      <div className="card">
        <h2>Auto-approve ceilings per tier</h2>
        <p className="muted">Emergency = $0 means always notify first. STALE re-dispatch spend is bounded by these ceilings.</p>
        {(['ROUTINE', 'URGENT', 'EMERGENCY'] as const).map((k) => (
          <label key={k}>{k}: $
            <input type="number" value={form.autoApproveCeilings[k]} onChange={(e) => set(['autoApproveCeilings', k], Number(e.target.value))} style={{ width: 90 }} />
          </label>
        ))}
      </div>
      <div className="card">
        <h2>Emergency protocol</h2>
        <label>Pre-authorized
          <input type="checkbox" checked={form.emergencyProtocol.preAuthorized} onChange={(e) => set(['emergencyProtocol', 'preAuthorized'], e.target.checked)} />
        </label>
        <label>Landlord call list (comma-separated)
          <input value={form.emergencyProtocol.landlordCallList.join(', ')} onChange={(e) => set(['emergencyProtocol', 'landlordCallList'], e.target.value.split(','))} style={{ width: 300 }} />
        </label>
        <label>Water-emergency no-response auto-dispatch timeout (minutes)
          <input type="number" value={form.emergencyProtocol.waterAutoDispatchTimeoutMin} onChange={(e) => set(['emergencyProtocol', 'waterAutoDispatchTimeoutMin'], Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <p className="muted">Gas, fire and CO are 911-first and are NEVER auto-dispatched. The timeout above applies to water-type emergencies only.</p>
      </div>
      <div className="card">
        <h2>STALE bounds</h2>
        <label>Vendor no-response hours before STALE
          <input type="number" value={form.staleHours} onChange={(e) => set(['staleHours'], Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <label>Max re-dispatches
          <input type="number" value={form.maxReDispatches} onChange={(e) => set(['maxReDispatches'], Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <label>Classifier confidence threshold
          <input type="number" step="0.05" value={form.confidenceThreshold} onChange={(e) => set(['confidenceThreshold'], Number(e.target.value))} style={{ width: 90 }} />
        </label>
      </div>
      <div className="card">
        <h2>Weather simulation (no-heat winter path)</h2>
        <label>Simulated outside temp (F, blank = lookup returns null)
          <input type="number" value={form.weather.simulatedOutsideTempF ?? ''} placeholder="(null)" onChange={(e) => set(['weather', 'simulatedOutsideTempF'], e.target.value === '' ? null : Number(e.target.value))} style={{ width: 90 }} />
        </label>
        <label>Simulate weather-API failure (must fail safe to emergency in winter)
          <input type="checkbox" checked={form.weather.simulateWeatherFailure} onChange={(e) => set(['weather', 'simulateWeatherFailure'], e.target.checked)} />
        </label>
      </div>
      <button onClick={save}>Save config</button>
    </div>
  );
}

function UnitHistory({ tickets }: { tickets: any[] }) {
  const byUnit: Record<string, any[]> = {};
  for (const t of tickets ?? []) {
    (byUnit[t.unitId] = byUnit[t.unitId] ?? []).push(t);
  }
  return (
    <div>
      {Object.entries(byUnit).map(([unit, ts]) => (
        <div className="card" key={unit}>
          <h2>Unit {unit}</h2>
          <table>
            <thead><tr><th>Ticket</th><th>Urgency</th><th>Trade</th><th>State</th><th>Created</th></tr></thead>
            <tbody>
              {ts.map((t) => (
                <tr key={t.id}><td><a href={`/tickets/${t.id}`}>{t.id}</a></td><td>{t.urgency}</td><td>{t.trade}</td><td>{t.state}</td><td>{t.createdAt}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {!Object.keys(byUnit).length && <p className="muted">No tickets yet.</p>}
    </div>
  );
}
