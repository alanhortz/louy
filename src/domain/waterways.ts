/**
 * Axe des voies navigables de Wallonie (SPW), récolté par
 * `npm run waterways:harvest`. Il sert à coucher un bateau à l'arrêt le long de
 * la voie d'eau où il se trouve : amarré, un bateau n'annonce plus de route.
 */

export const WATERWAYS_PATH = '/data/waterways.json';

/** Un tronçon : son nom, et son tracé en Lambert 2008 (x, y, x, y…). */
export interface Waterway { name: string; points: number[] }

export function parseWaterways(payload: unknown): Waterway[] {
  if (!Array.isArray(payload)) return [];
  return (payload as Partial<Waterway>[]).filter((way): way is Waterway =>
    typeof way?.name === 'string' && Array.isArray(way.points) && way.points.length >= 4
    && way.points.length % 2 === 0 && way.points.every(Number.isFinite));
}

/** Au-delà de cette distance de tout axe, un point n'est sur aucune voie d'eau connue. */
const REACH = 250;

/**
 * La voie d'eau la plus proche d'un point : son nom, et la direction de son axe
 * à cet endroit, en degrés depuis le nord (entre 0 et 180 : un axe n'a pas de
 * sens). `null` si le point est loin de toute voie.
 */
export function waterwayAt(ways: readonly Waterway[], x: number, y: number): { name: string; bearing: number } | null {
  let best: { name: string; bearing: number } | null = null;
  let nearest = REACH * REACH;
  for (const way of ways) {
    const { points } = way;
    for (let at = 2; at < points.length; at += 2) {
      const ax = points[at - 2]!, ay = points[at - 1]!, bx = points[at]!, by = points[at + 1]!;
      const dx = bx - ax, dy = by - ay;
      const length2 = dx * dx + dy * dy;
      if (length2 === 0) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2));
      const distance2 = (x - ax - dx * t) ** 2 + (y - ay - dy * t) ** 2;
      if (distance2 >= nearest) continue;
      nearest = distance2;
      best = { name: way.name, bearing: ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 180 };
    }
  }
  return best;
}
