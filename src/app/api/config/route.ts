import { NextRequest, NextResponse } from 'next/server';
import { readDb, mutateDb } from '@/lib/store';
import type { Config } from '@/lib/types';

/** GET /api/config — ceilings, emergency protocol, after-hours, STALE bounds, weather sim. */
export async function GET() {
  const db = readDb();
  return NextResponse.json({ config: db.config });
}

/** PUT /api/config — update config (landlord settings UI). */
export async function PUT(req: NextRequest) {
  const json = await req.json().catch(() => ({}));
  const config = mutateDb((db) => {
    const c: Config = db.config;
    if (json.autoApproveCeilings) {
      for (const k of ['ROUTINE', 'URGENT', 'EMERGENCY'] as const) {
        if (typeof json.autoApproveCeilings[k] === 'number') c.autoApproveCeilings[k] = json.autoApproveCeilings[k];
      }
    }
    if (json.staleHours !== undefined) c.staleHours = Number(json.staleHours);
    if (json.maxReDispatches !== undefined) c.maxReDispatches = Number(json.maxReDispatches);
    if (json.afterHoursStart !== undefined) c.afterHoursStart = String(json.afterHoursStart);
    if (json.afterHoursEnd !== undefined) c.afterHoursEnd = String(json.afterHoursEnd);
    if (json.confidenceThreshold !== undefined) c.confidenceThreshold = Number(json.confidenceThreshold);
    if (json.digestEnabled !== undefined) c.digestEnabled = json.digestEnabled === true;
    if (json.weather) {
      if (json.weather.simulatedOutsideTempF !== undefined)
        c.weather.simulatedOutsideTempF = json.weather.simulatedOutsideTempF === null ? null : Number(json.weather.simulatedOutsideTempF);
      if (json.weather.simulateWeatherFailure !== undefined)
        c.weather.simulateWeatherFailure = json.weather.simulateWeatherFailure === true;
    }
    if (json.emergencyProtocol) {
      const p = c.emergencyProtocol;
      if (json.emergencyProtocol.preAuthorized !== undefined) p.preAuthorized = json.emergencyProtocol.preAuthorized === true;
      if (json.emergencyProtocol.landlordCallList !== undefined)
        p.landlordCallList = String(json.emergencyProtocol.landlordCallList).split(',').map((s: string) => s.trim()).filter(Boolean);
      if (json.emergencyProtocol.waterAutoDispatchTimeoutMin !== undefined)
        p.waterAutoDispatchTimeoutMin = Number(json.emergencyProtocol.waterAutoDispatchTimeoutMin);
    }
    return c;
  });
  return NextResponse.json({ config });
}
