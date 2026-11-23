import { useSelector } from '@xstate/react';
import { useTranslation } from 'react-i18next';
import { PROJECT } from '../../config/project.ts';
import { AERIAL_LABEL, OBJECTS_LABEL, type Scan } from '../../domain/scans.ts';
import { AERIAL_LAYER, ART_LAYER, BACKED_LAYER, FUN_LAYER, OBJECTS_LAYER, SURVIVAL_LAYER } from '../../machines/scans.layer.ts';
import sponsorMark from '../assets/sorcery-systems.svg';
import { RETENTION_MS } from '../../services/telemetry.ts';
import { useChild, useLayer } from '../actors.ts';
import { bytes, date } from '../format.ts';
import { Panel } from './Panel.tsx';
import { useLocalized } from '../localized.ts';

const RETENTION_DAYS = RETENTION_MS / 86_400_000;

/** Sources des données, crédits, et la télémétrie locale que le visiteur peut lire ou effacer. */
export function AboutPanel() {
  const { t } = useTranslation();
  const l = useLocalized();
  const scans = useSelector(useLayer<Scan>(AERIAL_LAYER), (snapshot) => snapshot.context.items);
  const scanned = useSelector(useLayer<Scan>(OBJECTS_LAYER), (snapshot) => snapshot.context.items);
  const survival = useSelector(useLayer<Scan>(SURVIVAL_LAYER), (snapshot) => snapshot.context.items);
  const fun = useSelector(useLayer<Scan>(FUN_LAYER), (snapshot) => snapshot.context.items);
  const art = useSelector(useLayer<Scan>(ART_LAYER), (snapshot) => snapshot.context.items);
  const backed = useSelector(useLayer<Scan>(BACKED_LAYER), (snapshot) => snapshot.context.items);
  const objects = [...scanned, ...backed, ...art, ...survival, ...fun];
  const telemetry = useChild('telemetry');
  const summary = useSelector(telemetry, (snapshot) => snapshot.context.summary);
  const busy = useSelector(telemetry, (snapshot) => !snapshot.matches({ recording: { ledger: 'idle' } }));

  return (
    <Panel
      id="about"
      title={t('about.title')}
      className="about"
      onExpand={() => telemetry.send({ type: 'telemetry.summaryRequested' })}
    >
      <p>
        <strong>{PROJECT.name}</strong> ({t('brand.meaning')}) : {t('about.intro')}
      </p>

      <div className="about-heading">{t('about.data')}</div>
      <ul>
        <li>{t('about.relief')} <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">{t('about.reliefSource')}</a> {t('about.reliefLicence')}</li>
        <li>{t('about.vessels')} <a href="https://www.eurisportal.eu" target="_blank" rel="noreferrer">EuRIS</a> {t('about.vesselsAfter')}</li>
        <li>{t('about.streets')} <a href="https://geoportail.wallonie.be" target="_blank" rel="noreferrer">{t('about.streetsSource')}</a>.</li>
        <li>{t('about.places')} <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>{t('about.placesAfter')}</li>
        <li>
          {t('about.aircraft')}{' '}
          <a href="https://adsb.fi" target="_blank" rel="noreferrer">adsb.fi</a>{t('about.aircraftAfter')}
        </li>
        <li>{t('about.cameras')}</li>
        {scans.map((scan) => (
          <li key={scan.id}>
            {t('about.scan', { kind: t(AERIAL_LABEL), name: l(scan, 'name') })}{' '}
            <a href={scan.credit.url} target="_blank" rel="noreferrer">{l(scan.credit, 'title')}</a> {t('about.scanBy', { author: scan.credit.author })}
            {scan.credit.licence.startsWith('CC') ? ` ${t('about.creativeCommons', { licence: scan.credit.licence })}` : ` ${l(scan.credit, 'licence')}.`}
          </li>
        ))}
        {objects.length > 0 && (
          <li>
            {t('about.objects', {
              kind: t(OBJECTS_LABEL),
              names: objects.map((object) => l(object, 'name')).join(' ; '),
              authors: [...new Set(objects.map((object) => object.credit.author))].join(', '),
            })}
          </li>
        )}
      </ul>
      <p>{t('about.precision')}</p>

      <div className="about-heading">{t('about.journal')}</div>
      <p>{t('about.journalNote', { days: RETENTION_DAYS })}</p>
      <p className="about-figures">
        {summary
          ? `${t('about.figures', { events: summary.events, batches: summary.batches, size: bytes(summary.bytes) })}${summary.since ? t('about.since', { date: date(summary.since) }) : ''}`
          : t('about.reading')}
      </p>
      <div className="cctv-controls">
        <button
          type="button"
          className="scene-btn"
          disabled={busy}
          onClick={() => telemetry.send({ type: 'telemetry.exportRequested' })}
        >
          {t('about.export')}
        </button>
        <button
          type="button"
          className="scene-btn"
          disabled={busy}
          onClick={() => telemetry.send({ type: 'telemetry.clearRequested' })}
        >
          {t('about.clear')}
        </button>
      </div>

      <div className="about-heading">{t('about.credits')}</div>
      <p>
        <img className="about-sponsor-mark" src={sponsorMark} alt="" width="11" height="12" />
        {t('about.sponsored')} <a href={PROJECT.sponsor.url} target="_blank" rel="noopener">{PROJECT.sponsor.name}</a>.{' '}
        {t('about.inspired')} <a href="https://github.com/bilawalsidhu/gods-eye-view" target="_blank" rel="noreferrer">God’s Eye View</a>{' '}
        {t('about.inspiredBy')} {t('about.licence', { author: PROJECT.author })}{' '}
        <a href={PROJECT.repository} target="_blank" rel="noreferrer">GitHub</a>.
      </p>
    </Panel>
  );
}
