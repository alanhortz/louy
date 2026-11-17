import type { SVGProps } from 'react';

/**
 * Icône des nuages de points, dessinée pour L'Oûy : sept points, sans une arête — les
 * sommets visibles d'un cube vu de biais. Peu de points, et gros : elle se lit à la
 * taille du rail. Celui du devant est le plus gros, ceux du fond les plus fins.
 * Même gabarit que les icônes du rail (24 × 24, teinte courante).
 */
export function PointCloudIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <circle cx="12" cy="4" r="1.7" />
      <circle cx="5" cy="8" r="1.7" />
      <circle cx="19" cy="8" r="1.7" />
      <circle cx="12" cy="12" r="2.6" />
      <circle cx="5" cy="16" r="2.1" />
      <circle cx="19" cy="16" r="2.1" />
      <circle cx="12" cy="20" r="2.4" />
    </svg>
  );
}
