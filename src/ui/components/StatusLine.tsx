import { useSelector } from '@xstate/react';
import { acquisitionLabel } from '../../machines/acquisition.machine.ts';
import { useChild } from '../actors.ts';

/** Ligne discrète du bas : date des mesures LiDAR sous le point visé, et attributions. */
export function StatusLine() {
  const label = useSelector(useChild('acquisition'), acquisitionLabel);
  return (
    <footer className="status-line">
      <span>{label}</span>
      <span className="status-attribution">
        © <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">SPW</a> CC-BY 4.0
        {' · '}© contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
      </span>
    </footer>
  );
}
