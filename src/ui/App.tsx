import { useSelector } from '@xstate/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from './actors.ts';
import { AboutPanel } from './components/AboutPanel.tsx';
import { AircraftPanel } from './components/AircraftPanel.tsx';
import { VesselPanel } from './components/VesselPanel.tsx';
import { SHELVED_LAYERS } from '../machines/scans.layer.ts';
import { VideoPanel } from './components/VideoPanel.tsx';
import { CloudPanel, ImageryPanel, OrthophotoPanel } from './components/ImageryPanel.tsx';
import { DronePanel } from './components/DronePanel.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { CockpitExit } from './components/CockpitExit.tsx';
import { TourBar } from './components/TourBar.tsx';
import { TourFeed } from './components/TourFeed.tsx';
import { WalkBar } from './components/WalkBar.tsx';
import { Cinema } from './components/Cinema.tsx';
import { Brand } from './components/Brand.tsx';
import { CameraPanel } from './components/CameraPanel.tsx';
import { ControlsPanel } from './components/ControlsPanel.tsx';
import { Indicator } from './components/Indicator.tsx';
import { LayersPanel } from './components/LayersPanel.tsx';
import { ManualShare } from './components/ManualShare.tsx';
import { ObjectViewer } from './components/ObjectViewer.tsx';
import { Rail } from './components/Rail.tsx';
import { RenderDock } from './components/RenderDock.tsx';
import { SiteSearch } from './components/SiteSearch.tsx';
import { TimeFilm } from './components/TimeFilm.tsx';
import { Stage } from './components/Stage.tsx';
import { StatusChips } from './components/StatusChips.tsx';
import { StatusLine } from './components/StatusLine.tsx';
import { TopActions } from './components/TopActions.tsx';
import { UnsupportedNotice } from './components/UnsupportedNotice.tsx';

/** L'écran suit l'état de la machine applicative : vérification, refus, ou viewer. */
export function App() {
  const { t } = useTranslation();
  const app = useApp();
  const phase = useSelector(app, (snapshot) => snapshot.value);
  const support = useSelector(app, (snapshot) => snapshot.context.support);
  // les machines filles sont créées à l'entrée dans `running` : on attend qu'elles existent
  const started = useSelector(app, (snapshot) => snapshot.children.viewer !== undefined);

  // Échap désélectionne le marqueur choisi — sauf dans un champ de saisie, ou quand une
  // visionneuse plein écran est ouverte : la touche lui revient, pour la refermer.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest('input, textarea, select, [role="dialog"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      // à pied, ou l'outil de balade armé, la touche ramène d'abord à la carte
      const walk = app.getSnapshot().children.walk;
      if (walk && !walk.getSnapshot().matches('idle')) return walk.send({ type: 'walk.left' });
      app.send({ type: 'app.selectionDismissed' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  if (phase === 'unsupported' && support) return <UnsupportedNotice report={support} />;
  if (phase !== 'running' || !started) {
    return <div className="splash"><p className="splash-text">{t('app.checking')}</p></div>;
  }

  return (
    <>
      <Stage />
      <Brand />
      <TopActions />
      <Indicator />
      <StatusChips />
      <Rail />
      <CockpitExit />
      <WalkBar />
      <TourBar />
      <TourFeed />
      <div className="stacks">
        <aside className="stack stack-left">
          <LayersPanel />
          <ControlsPanel />
        </aside>
        <aside className="stack stack-right">
          <CameraPanel />
          <ImageryPanel />
          {/* les calques mis de côté n'ont pas de panneau non plus */}
          {!SHELVED_LAYERS.includes('orthophoto') && <OrthophotoPanel />}
          {!SHELVED_LAYERS.includes('clouds') && <CloudPanel />}
          <DronePanel />
          <VideoPanel />
          <SettingsPanel />
          <AircraftPanel />
          <VesselPanel />
          <AboutPanel />
        </aside>
      </div>
      <RenderDock />
      <StatusLine />
      <SiteSearch />
      <ManualShare />
      <ObjectViewer />
      <TimeFilm />
      <Cinema />
    </>
  );
}
