const RAD = Math.PI / 180;

export type LonLat = [lon: number, lat: number];

/**
 * The shortest path over the globe between two places, as a line of short steps.
 * Drawn on a flat map it bows toward the pole, which is how a long connection
 * reads as a flight path and not as a ruler line.
 */
export function greatCircle(from: LonLat, to: LonLat, steps = 48): LonLat[] {
  const vector = ([lon, lat]: LonLat) =>
    [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)] as const;
  const a = vector(from);
  const b = vector(to);
  const angle = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  // The same place, or near enough: there is no arc to draw.
  if (angle < 1e-6) return [from, to];
  const line: LonLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wa = Math.sin((1 - t) * angle) / Math.sin(angle);
    const wb = Math.sin(t * angle) / Math.sin(angle);
    const x = wa * a[0] + wb * b[0];
    const y = wa * a[1] + wb * b[1];
    const z = wa * a[2] + wb * b[2];
    line.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  return line;
}
