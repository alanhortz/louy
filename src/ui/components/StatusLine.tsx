import { useSelector } from '@xstate/react';
import { acquisitionLabel } from '../../machines/acquisition.machine.ts';
import { useApp, useChild } from '../actors.ts';
import { drawnScans } from '../../machines/scans.layer.ts';

/** Ligne discrète du bas : date des mesures LiDAR sous le point visé, et attributions. */
export function StatusLine() {
  const label = useSelector(useChild('acquisition'), acquisitionLabel);
  // les lieux dessinés dans la carte sont à l'écran : leurs auteurs sont crédités
  const imagery = useSelector(useApp(), (snapshot) => snapshot.context.imagery);
  const traces = useSelector(useApp(), (snapshot) => snapshot.context.traces);
  const satellite = useSelector(useApp(), (snapshot) => snapshot.context.satellite);
  const drawn = useSelector(useApp(), (snapshot) => snapshot.context.drawn);
  const scans = [...drawnScans(imagery.selected, imagery.kept), ...Object.values(drawn).flatMap((layer) => drawnScans(layer.selected, layer.kept)), ...traces];
  return (
    <footer className="status-line">
      <span>{label}</span>
      <span className="status-attribution">
        © <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">SPW</a> CC-BY 4.0
        {' · '}© contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
        {scans.map((scan) => (
          <span key={scan.id}>
            {' · '}{scan.trace ? 'tracé' : 'images drone'} <a href={scan.credit.url} target="_blank" rel="noreferrer">{scan.credit.author}</a> {scan.credit.licence}
          </span>
        ))}
        {satellite.map((image) => (
          <span key={image.id}>
            {' · '}images drone <a href={image.credit.url} target="_blank" rel="noreferrer">{image.credit.author}</a> {image.credit.licence}
          </span>
        )).slice(0, 1)}
      </span>
    </footer>
  );
}
