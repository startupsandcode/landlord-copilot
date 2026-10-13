// Weather lookup for the no-heat winter path, with [A4] fail-safe.
// MVP: the weather source is injected/simulated in config (no paid API).
// Production intent: OpenWeather-style lookup by property ZIP; any failure
// in winter months (Oct-Mar) fails SAFE to emergency.

export interface WeatherResult {
  tempF: number | null;
  failed: boolean;
}

/** Winter months for the no-heat rule: October (9) through March (2). [A4] */
export function isWinterMonth(monthIndex: number): boolean {
  return monthIndex >= 9 || monthIndex <= 2;
}

export interface WeatherDeps {
  simulatedOutsideTempF: number | null;
  simulateWeatherFailure: boolean;
}

/**
 * Resolve the outside temperature. Returns failed=true when the lookup
 * fails; callers must treat failed as EMERGENCY for no-heat in winter.
 */
export function getOutsideTempF(deps: WeatherDeps): WeatherResult {
  if (deps.simulateWeatherFailure) return { tempF: null, failed: true };
  return { tempF: deps.simulatedOutsideTempF, failed: false };
}
