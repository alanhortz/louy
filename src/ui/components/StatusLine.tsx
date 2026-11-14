import { useSelector } from '@xstate/react';
import { acquisitionLabel } from '../../machines/acquisition.machine.ts';
import type { Scan } from '../../domain/scans.ts';
import { SCANS_LAYER, drawnScans } from '../../machines/scans.layer.ts';
import { layerSelection } from '../../machines/selectionLayer.machine.ts';
import { useChild, useLayer } from '../actors.ts';

/** Ligne discrète du bas : date des mesures LiDAR sous le point visé, et attributions. */
export function StatusLine() {
  const label = useSelector(useChild('acquisition'), acquisitionLabel);
  // le lieu dessiné dans la carte est à l'écran : son auteur est crédité
  const scans = drawnScans(useSelector(useLayer<Scan>(SCANS_LAYER), layerSelection));
  return (
    <footer className="status-line">
      <span>{label}</span>
      <span className="status-attribution">
        © <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">SPW</a> CC-BY 4.0
        {' · '}© contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        {scans.map((scan) => (
          <span key={scan.id}>
            {' · '}images drone <a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.author}</a> {scan.credit.licence}
          </span>
        ))}
      </span>
    </footer>
  );
}
