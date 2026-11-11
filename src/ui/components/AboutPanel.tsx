import { useSelector } from '@xstate/react';
import { PROJECT } from '../../config/project.ts';
import { RETENTION_MS } from '../../services/telemetry.ts';
import { useChild } from '../actors.ts';
import { bytes, date } from '../format.ts';
import { Panel } from './Panel.tsx';

const RETENTION_DAYS = RETENTION_MS / 86_400_000;

/** Sources des données, crédits, et la télémétrie locale que le visiteur peut lire ou effacer. */
export function AboutPanel() {
  const telemetry = useChild('telemetry');
  const summary = useSelector(telemetry, (snapshot) => snapshot.context.summary);
  const busy = useSelector(telemetry, (snapshot) => !snapshot.matches({ recording: { ledger: 'idle' } }));

  return (
    <Panel
      id="about"
      title="À propos"
      glyphs={['◀', '▶']}
      className="about"
      onExpand={() => telemetry.send({ type: 'telemetry.summaryRequested' })}
    >
      <p>
        <strong>{PROJECT.name}</strong> ({PROJECT.meaning}) dessine le relief de la Wallonie en nuage de points,
        à partir des relevés LiDAR aériens du Service public de Wallonie.
      </p>

      <div className="about-heading">Données</div>
      <ul>
        <li>Relief et orthophotos : <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">Géoportail de la Wallonie</a> (SPW), CC-BY 4.0.</li>
        <li>Noms de lieux et sites touristiques : contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>, ODbL.</li>
        <li>Caméras : SPW Trafiroutes, placées au point kilométrique lu sur leur image ; à défaut, sur la localité nommée.</li>
      </ul>
      <p>
        Les altitudes sont reconstruites depuis des images rendues par le SPW : la précision verticale est
        d’environ 3,5 m, la précision horizontale va jusqu’à 50 cm (campagne 2021–2022).
      </p>

      <div className="about-heading">Journal local</div>
      <p>
        L’historique des interactions de cette page est conservé {RETENTION_DAYS} jours, compressé, dans ce
        navigateur uniquement. Rien n’est envoyé à un serveur.
      </p>
      <p className="about-figures">
        {summary
          ? `${summary.events} ÉVÉNEMENTS · ${summary.batches} LOTS · ${bytes(summary.bytes)}${summary.since ? ` · DEPUIS LE ${date(summary.since)}` : ''}`
          : 'LECTURE DU JOURNAL…'}
      </p>
      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={busy}
          onClick={() => telemetry.send({ type: 'telemetry.exportRequested' })}
        >
          EXPORTER
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={busy}
          onClick={() => telemetry.send({ type: 'telemetry.clearRequested' })}
        >
          EFFACER
        </button>
      </div>

      <div className="about-heading">Crédits</div>
      <p>
        Projet sponsorisé par <a href={PROJECT.sponsor.url} target="_blank" rel="noopener">{PROJECT.sponsor.name}</a>.{' '}
        Interface inspirée de <a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noreferrer">God’s Eye View</a> de
        Bilawal Sidhu (MIT). © {PROJECT.author}, logiciel libre sous licence AGPL-3.0 — code source
        sur <a href={PROJECT.repository} target="_blank" rel="noreferrer">GitHub</a>.
      </p>
    </Panel>
  );
}
