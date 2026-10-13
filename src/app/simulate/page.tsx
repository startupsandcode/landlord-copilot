'use client';

import { useState } from 'react';

/** Dev-only simulated SMS console (no Twilio number provisioned yet). */
export default function Simulate() {
  const [from, setFrom] = useState('+15550101');
  const [body, setBody] = useState('I smell gas in the kitchen');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const send = async () => {
    setError('');
    const res = await fetch('/api/sms/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, body }),
    });
    const json = await res.json();
    if (!res.ok) setError(json.error ?? 'error');
    else setResult(json);
  };

  return (
    <div>
      <h1>Simulate tenant SMS</h1>
      <p className="muted">Runs the exact /api/sms/webhook pipeline. Dev-only; disabled in production unless SIMULATE_ENABLED=true.</p>
      <div className="card">
        <label>From (tenant phone)</label>
        <input value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 220 }} />
        <label>Message</label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ width: '100%' }} />
        <div className="row">
          <button onClick={send}>Send</button>
          <button className="secondary" onClick={() => setBody('water is pouring from under the sink in the bathroom')}>Try: burst water</button>
          <button className="secondary" onClick={() => setBody('we have no heat and it is freezing in here')}>Try: no heat</button>
          <button className="secondary" onClick={() => setBody('my faucet drips constantly')}>Try: routine</button>
        </div>
      </div>
      {error && <div className="alert">{error}</div>}
      {result && (
        <div className="card">
          <h2>Result</h2>
          <div className="row">
            <span className={`badge b-${result.urgency}`}>{result.urgency}</span>
            <span className="badge b-state">{result.state}</span>
            <a href={`/tickets/${result.ticketId}`}><strong>{result.ticketId}</strong></a>
          </div>
          <p className="muted">
            trade {result.trade} &middot; confidence {Number(result.confidence).toFixed(2)}
            {result.emergencyType && ` &middot; emergency type ${result.emergencyType}`}
            {result.emergencyLocked && ' &middot; SAFETY SCRIPT LOCKED'}
            {result.unitConfirmed ? ' &middot; unit confirmed' : ' &middot; unit NOT confirmed'}
          </p>
          {result.provisionalLower && <p className="muted">Provisional downgrade: {JSON.stringify(result.provisionalLower)}</p>}
          <h2>Copilot replies (stubbed, logged only)</h2>
          {result.replies.map((r: string, i: number) => <p key={i}>{r}</p>)}
          {result.landlordWake.length > 0 && (
            <>
              <h2>Landlord wake (stubbed)</h2>
              {result.landlordWake.map((r: string, i: number) => <p key={i}>{r}</p>)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
