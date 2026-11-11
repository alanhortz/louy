/**
 * Diagnostic du navigateur : sait-il faire tourner le viewer, et sinon, quelle
 * version faut-il installer ?
 *
 * On teste les capacités réellement utilisées, pas le nom du navigateur — le
 * nom ne sert qu'à formuler le conseil de mise à jour.
 */

import support from '../config/browser-support.json';
import type { QualityProfileId } from '../domain/quality.ts';

export type FeatureId = keyof typeof support.features;
export type BrowserId = 'ios' | 'samsung' | 'edge' | 'firefox' | 'chrome' | 'safari' | 'unknown';

export interface BrowserIdentity {
  id: BrowserId;
  name: string;
  version: string | null;
}

export interface MinimumVersion {
  name: string;
  version: string;
  hint: string;
}

export interface SupportReport {
  supported: boolean;
  missing: { id: FeatureId; label: string }[];
  browser: BrowserIdentity;
  /** Version à installer pour ce navigateur ; `null` s'il n'est pas reconnu. */
  minimum: MinimumVersion | null;
  profile: QualityProfileId;
  /** Mise en page étroite : les panneaux s'empilent et s'ouvrent un à la fois. */
  compact: boolean;
  /** Le pointeur principal est un doigt : les gestes expliqués sont tactiles. */
  touch: boolean;
  /** Le visiteur a demandé à son système de limiter les animations. */
  reducedMotion: boolean;
}

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

function hasOffscreenCanvas2d(): boolean {
  try {
    return typeof OffscreenCanvas !== 'undefined' && new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
}

/** Un Worker de type module démarre-t-il ? Le seul test fiable est d'en lancer un. */
function hasModuleWorkers(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob(['postMessage(1)'], { type: 'text/javascript' }));
    const finish = (ok: boolean, worker?: Worker) => {
      worker?.terminate();
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    try {
      const worker = new Worker(url, { type: 'module' });
      worker.onmessage = () => finish(true, worker);
      worker.onerror = () => finish(false, worker);
      setTimeout(() => finish(false, worker), 2000);
    } catch {
      finish(false);
    }
  });
}

const PROBES: Record<FeatureId, () => boolean | Promise<boolean>> = {
  modules: () => true, // ce code s'exécute : les modules sont donc pris en charge
  webgl2: hasWebGL2,
  workers: hasModuleWorkers,
  offscreenCanvas: hasOffscreenCanvas2d,
  imageBitmap: () => typeof createImageBitmap === 'function',
  compression: () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function',
  indexedDb: () => typeof indexedDB !== 'undefined',
  pointerEvents: () => typeof PointerEvent !== 'undefined',
};

/** Signatures lues dans la table de compatibilité, dans son ordre (significatif). */
const SIGNATURES = support.minimum.map((entry) => ({
  id: entry.id as BrowserId,
  pattern: new RegExp(entry.pattern),
}));

const identity = (id: BrowserId, version: string | null): BrowserIdentity => ({
  id,
  name: support.minimum.find((entry) => entry.id === id)?.name ?? 'Navigateur non reconnu',
  version,
});

export function identifyBrowser(userAgent: string, touchPoints = 0): BrowserIdentity {
  // un iPad récent se présente comme un Mac : seul l'écran tactile le trahit
  if (/Macintosh/.test(userAgent) && touchPoints > 1) {
    return identity('ios', /Version\/(\d+(?:\.\d+)?)/.exec(userAgent)?.[1] ?? null);
  }
  for (const { id, pattern } of SIGNATURES) {
    const match = pattern.exec(userAgent);
    if (match) return identity(id, match[1]?.replace('_', '.') ?? null);
  }
  return identity('unknown', null);
}

/** Même seuil que la feuille de style (`max-width: 720px`). */
const COMPACT_LAYOUT = '(max-width: 720px)';

const isHandheld = (): boolean =>
  matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;

export async function probeCapabilities(): Promise<SupportReport> {
  const ids = Object.keys(PROBES) as FeatureId[];
  const results = await Promise.all(ids.map((id) => PROBES[id]()));
  const missing = ids
    .filter((_, k) => !results[k])
    .map((id) => ({ id, label: support.features[id] }));

  const browser = identifyBrowser(navigator.userAgent, navigator.maxTouchPoints);
  const minimum = support.minimum.find((entry) => entry.id === browser.id) ?? null;

  return {
    supported: missing.length === 0,
    missing,
    browser,
    minimum: minimum && { name: minimum.name, version: minimum.version, hint: minimum.hint },
    profile: isHandheld() ? 'mobile' : 'desktop',
    compact: matchMedia(COMPACT_LAYOUT).matches,
    touch: matchMedia('(pointer: coarse)').matches,
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
