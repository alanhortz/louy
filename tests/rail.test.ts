import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PANELS } from '../src/machines/chrome.machine.ts';
import { RAIL_ITEMS } from '../src/ui/rail.ts';

const css = (name: string) => readFileSync(new URL(`../src/styles/${name}.css`, import.meta.url), 'utf8');

/** Valeur d'une propriété personnalisée, telle qu'écrite dans la feuille. */
function token(sheet: string, name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(sheet);
  if (!match) throw new Error(`jeton ${name} introuvable`);
  return match[1]!.trim();
}

type Rgba = [number, number, number, number];

function colour(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) return [0, 2, 4].map((at) => parseInt(hex[1]!.slice(at, at + 2), 16)).concat(1) as Rgba;
  const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
  if (!rgba) throw new Error(`couleur illisible : ${value}`);
  const [r, g, b, a = 1] = rgba[1]!.split(',').map(Number);
  return [r!, g!, b!, a];
}

/** Couleur translucide posée sur un fond opaque. */
const over = ([r, g, b, a]: Rgba, [br, bg, bb]: Rgba): Rgba =>
  [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];

/** Luminance relative et rapport de contraste, selon WCAG 2.x. */
function luminance([r, g, b]: Rgba): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
const contrast = (a: Rgba, b: Rgba) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
};

const tokens = css('tokens');
const rail = css('rail');
const px = (name: string) => parseFloat(token(rail, name));

/** Ce que la carte peut montrer derrière le verre, du plus défavorable au plus favorable. */
const BACKDROPS: Record<string, Rgba> = { 'orthophoto blanche': [255, 255, 255, 1], 'relief sombre': [10, 10, 15, 1] };

describe('rail du petit écran : lisibilité', () => {
  it('offre une cible tactile d’au moins 44 px, et un pictogramme d’au moins 20 px', () => {
    expect(px('--rail-target')).toBeGreaterThanOrEqual(44);
    expect(px('--rail-glyph')).toBeGreaterThanOrEqual(20);
    // les cibles ne se touchent pas : un doigt ne presse pas deux icônes
    expect(px('--rail-gap')).toBeGreaterThanOrEqual(4);
  });

  it.each(Object.entries(BACKDROPS))('garde un contraste d’au moins 4,5:1 sur %s', (_, backdrop) => {
    const glass = over(colour(token(tokens, '--glass-bg')), backdrop);
    // au repos : le pictogramme sur le verre
    expect(contrast(colour(token(rail, '--rail-idle')), glass)).toBeGreaterThanOrEqual(4.5);
    // actif : le pictogramme sur le verre teinté d'accent
    const tinted = over(colour(token(tokens, '--accent-dim')), glass);
    expect(contrast(colour(token(rail, '--rail-active')), tinted)).toBeGreaterThanOrEqual(4.5);
  });

  it('reprend les couleurs de L’Oûy, sans en inventer', () => {
    expect(token(rail, '--rail-idle')).toBe(token(tokens, '--text-primary'));
    expect(token(rail, '--rail-active')).toBe(token(tokens, '--accent'));
  });

  it('réserve aux panneaux exactement la largeur du rail', () => {
    const width = px('--rail-target') + 2 * px('--rail-pad');
    expect(css('panels')).toContain(`+ ${width}px + 8px)`);
  });
});

describe('rail du petit écran : contenu', () => {
  it('ouvre chaque panneau une fois, et aucun autre', () => {
    expect(RAIL_ITEMS.map((item) => item.panel).sort()).toEqual([...PANELS].sort());
  });

  it('nomme chaque icône : aucune ne se comprend seule', () => {
    const labels = RAIL_ITEMS.map((item) => item.label);
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
    expect(RAIL_ITEMS.every((item) => item.Icon !== undefined)).toBe(true);
  });
});
