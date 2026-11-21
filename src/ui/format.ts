/** Mise en forme de nombres et de durées pour l'interface, dans la langue courante. */

import { locale, t } from '../i18n/index.ts';

/** Un formateur par langue, construit à la demande : la langue peut changer en cours de route. */
function cached<T>(build: (tag: string) => T): () => T {
  const cache = new Map<string, T>();
  return () => {
    const tag = locale();
    let value = cache.get(tag);
    if (!value) { value = build(tag); cache.set(tag, value); }
    return value;
  };
}

const compact = cached((tag) => new Intl.NumberFormat(tag, { notation: 'compact', maximumFractionDigits: 1 }));
const clock = cached((tag) => new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' }));
const day = cached((tag) => new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' }));

/** Nombre entier, ou à une ou deux décimales, dans la langue. */
export const whole = cached((tag) => new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }));
export const tenth = cached((tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const hundredth = cached((tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const signed = cached((tag) => new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: 'exceptZero' }));

/** « — » pour zéro, sinon un nombre compact (« 8,4 k »). */
export const count = (value: number): string => (value > 0 ? compact().format(value) : '—');

export const time = (timestamp: number): string => clock().format(timestamp);
export const date = (timestamp: number): string => day().format(timestamp);

export function ago(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return t('format.justNow');
  if (seconds < 3600) return t('format.minutesAgo', { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t('format.hoursAgo', { n: Math.round(seconds / 3600) });
  return t('format.daysAgo', { n: Math.round(seconds / 86400) });
}

export function bytes(value: number): string {
  if (value < 1024) return t('format.bytes', { n: value });
  if (value < 1024 ** 2) return t('format.kilobytes', { n: (value / 1024).toFixed(1) });
  return t('format.megabytes', { n: (value / 1024 ** 2).toFixed(1) });
}
