/**
 * Conversion entre WGS84 et EPSG:3812 (ETRS89 / Belgian Lambert 2008).
 *
 * Le viewer travaille en Lambert 2008, OpenStreetMap en latitude/longitude :
 * cette projection est la charnière entre les deux. Conique conforme de
 * Lambert à deux parallèles sur l'ellipsoïde GRS80 (méthode EPSG 9802).
 */

const A = 6378137.0;
const F = 1 / 298.257222101;
const E = Math.sqrt(2 * F - F * F);

const RAD = Math.PI / 180;
const LAT1 = (49 + 50 / 60) * RAD;
const LAT2 = (51 + 10 / 60) * RAD;
const LAT0 = 50.797815 * RAD;
const LON0 = 4.359215833 * RAD;
const FALSE_EASTING = 649328.0;
const FALSE_NORTHING = 665262.0;

const m = (p: number) => Math.cos(p) / Math.sqrt(1 - E * E * Math.sin(p) ** 2);
const t = (p: number) => Math.tan(Math.PI / 4 - p / 2)
  / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);

const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)));
const BIG_F = m(LAT1) / (N * t(LAT1) ** N);
const R0 = A * BIG_F * t(LAT0) ** N;

export interface LambertPoint { x: number; y: number }
export interface GeoPoint { lat: number; lon: number }

/** WGS84 (degrés) → Lambert 2008 (mètres). */
export function toLambert(lat: number, lon: number): LambertPoint {
  const r = A * BIG_F * t(lat * RAD) ** N;
  const theta = N * (lon * RAD - LON0);
  return {
    x: FALSE_EASTING + r * Math.sin(theta),
    y: FALSE_NORTHING + R0 - r * Math.cos(theta),
  };
}

/** Lambert 2008 (mètres) → WGS84 (degrés). */
export function toWgs84(x: number, y: number): GeoPoint {
  const dx = x - FALSE_EASTING;
  const dy = R0 - (y - FALSE_NORTHING);
  const r = Math.sign(N) * Math.hypot(dx, dy);
  const theta = Math.atan2(dx, dy);
  const tp = (r / (A * BIG_F)) ** (1 / N);

  // latitude par itération : converge en quelques tours
  let p = Math.PI / 2 - 2 * Math.atan(tp);
  for (let k = 0; k < 8; k++) {
    const s = Math.sin(p);
    const next = Math.PI / 2 - 2 * Math.atan(tp * ((1 - E * s) / (1 + E * s)) ** (E / 2));
    const done = Math.abs(next - p) < 1e-12;
    p = next;
    if (done) break;
  }
  return { lat: p / RAD, lon: (theta / N + LON0) / RAD };
}
