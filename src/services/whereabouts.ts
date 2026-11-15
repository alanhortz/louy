/** Presse-papiers et géolocalisation du navigateur. La position ne quitte jamais l'appareil. */

import { devicePosition, type DevicePosition, type LocationFailure } from '../domain/whereabouts.ts';

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
