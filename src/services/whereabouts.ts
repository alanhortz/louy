/** Presse-papiers et géolocalisation du navigateur. La position ne quitte jamais l'appareil. */

import { devicePosition, speedKmh, type DevicePosition, type LocationFailure } from '../domain/whereabouts.ts';

/** Délai laissé au navigateur pour trouver l'appareil. */
const LOCATE_TIMEOUT_MS = 15000;

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // presse-papiers moderne refusé (page sans focus, navigateur ancien) : la copie d'un champ sélectionné, elle, passe
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('presse-papiers indisponible');
  }
}

/** Demande sa position à l'appareil ; rejette avec la raison de l'échec (`LocationFailure`). */
export function locateDevice(): Promise<DevicePosition> {
  return new Promise((resolve, reject: (reason: LocationFailure) => void) => {
    if (!('geolocation' in navigator)) return reject('unavailable');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const position = devicePosition(coords.latitude, coords.longitude, coords.accuracy);
        if (position) resolve(position);
        else reject('outside');
      },
      (error) => reject(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: LOCATE_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

/** Sur un appareil que l'on tient en main, la position se suit en continu ; sur un poste fixe, un relevé suffit. */
export const followsDevice = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && 'geolocation' in navigator;

/**
 * Suit l'appareil tant qu'on ne l'arrête pas : chaque nouveau relevé est remis à `onFix`, avec la vitesse
 * quand elle est connue. Le visiteur a déjà donné son accord — c'est le premier relevé qui le lui a demandé.
 * Rend de quoi arrêter le suivi. Comme le reste, rien ne quitte l'appareil.
 */
export function watchDevice(onFix: (position: DevicePosition) => void): () => void {
  if (!followsDevice()) return () => {};
  let previous: DevicePosition | null = null;
  const watch = navigator.geolocation.watchPosition(
    ({ coords, timestamp }) => {
      const place = devicePosition(coords.latitude, coords.longitude, coords.accuracy);
      if (!place) return; // sorti de Wallonie : le repère reste où il était
      const fix: DevicePosition = { ...place, at: timestamp };
      const speed = speedKmh(previous, fix, coords.speed);
      if (speed !== undefined) fix.speed = speed;
      previous = fix;
      onFix(fix);
    },
    () => { /* un relevé manqué : le suivant viendra */ },
    { enableHighAccuracy: true, maximumAge: 0 },
  );
  return () => navigator.geolocation.clearWatch(watch);
}
