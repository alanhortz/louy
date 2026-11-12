/**
 * Teinte multiplicative d'une icône SVG, comme le fait un billboard : chaque
 * couleur est multipliée, canal par canal, par la teinte demandée. Les
 * marqueurs partagent ainsi les deux teintes de God's Eye View — repos
 * `#6be8ff`, active `#ffd97a`.
 */

export const TINT_IDLE = '#6be8ff';
export const TINT_ACTIVE = '#ffd97a';

export function tinted(svg: string, tint: string): string {
  const channels = [1, 3, 5].map((at) => parseInt(tint.slice(at, at + 2), 16) / 255);
  const multiplied = svg.replace(/#([0-9a-f]{6})\b/gi, (_, hex: string) =>
    `#${channels
      .map((channel, k) => Math.round(parseInt(hex.slice(k * 2, k * 2 + 2), 16) * channel))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('')}`);
  return `data:image/svg+xml;base64,${btoa(multiplied)}`;
}
