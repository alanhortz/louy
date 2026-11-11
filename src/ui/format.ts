/** Mise en forme de nombres et de durées pour l'interface. */

const compact = new Intl.NumberFormat('fr-BE', { notation: 'compact', maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** « — » pour zéro, sinon un nombre compact (« 8,4 k »). */
export const count = (value: number): string => (value > 0 ? compact.format(value) : '—');

export const time = (timestamp: number): string => clock.format(timestamp);
export const date = (timestamp: number): string => day.format(timestamp);

export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'à l’instant';
  if (seconds < 3600) return `il y a ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `il y a ${Math.round(seconds / 3600)} h`;
  return `il y a ${Math.round(seconds / 86400)} j`;
}

export function bytes(value: number): string {
  if (value < 1024) return `${value} o`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} Ko`;
  return `${(value / 1024 ** 2).toFixed(1)} Mo`;
}
