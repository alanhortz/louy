import type { SVGProps } from 'react';

/**
 * Icône des vols de drone : le drone vu du dessus — un corps, quatre rotors au bout de ses bras.
 * Le même dessin que le marqueur de la carte, au gabarit des icônes du rail (24 × 24, teinte courante).
 */
export function DroneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6.7 6.700 17.300 17.300M17.300 6.700 6.700 17.300" />
      <circle cx="6" cy="6" r="3.300" /><circle cx="18" cy="6" r="3.300" /><circle cx="6" cy="18" r="3.300" /><circle cx="18" cy="18" r="3.300" />
      <rect x="9" y="8" width="6" height="8" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
