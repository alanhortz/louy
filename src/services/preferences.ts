/**
 * Petites préférences d'interface, gardées dans le navigateur : quels panneaux
 * d'aide le visiteur a déjà refermés, pour ne pas les lui rouvrir à chaque visite.
 */

const key = (panel: string) => `louy:vu:${panel}`;

export function acknowledge(panel: string): void {
  try {
    localStorage.setItem(key(panel), '1');
  } catch {
    // navigation privée : l'aide se rouvrira, sans autre conséquence
  }
}

export function isAcknowledged(panel: string): boolean {
  try {
    return localStorage.getItem(key(panel)) !== null;
  } catch {
    return false;
  }
}
