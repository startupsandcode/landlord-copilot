export default function Home() {
  return (
    <div>
      <h1>Landlord Maintenance Triage Copilot</h1>
      <p className="muted">
        SMS-native triage for self-managing landlords. Tenants text a number; the copilot
        classifies urgency, locks emergencies to the safety script, and tracks every ticket
        to resolution.
      </p>
      <div className="grid">
        <div className="card">
          <h2>Dashboard</h2>
          <p className="muted">Tickets by state, morning digest, vendor roster, ceilings and emergency protocol, takeover, per-unit history.</p>
          <a href="/dashboard"><button>Open dashboard</button></a>
        </div>
        <div className="card">
          <h2>Simulate SMS</h2>
          <p className="muted">Dev-only endpoint to run a tenant text through the real triage pipeline (no Twilio number provisioned yet).</p>
          <a href="/simulate"><button>Simulate a text</button></a>
        </div>
        <div className="card">
          <h2>Safety first</h2>
          <p className="muted">
            Gas, fire and CO are 911-first and never auto-dispatched. No-heat fails safe in
            winter when the weather lookup fails. Nothing dispatches without a confirmed unit
            and landlord approval. All outbound SMS is stubbed and logged, never sent.
          </p>
        </div>
      </div>
    </div>
  );
}
