import { useSelector } from '@xstate/react';
import { useApp } from './actors.ts';
import { AboutPanel } from './components/AboutPanel.tsx';
import { AircraftPanel } from './components/AircraftPanel.tsx';
import { CockpitExit } from './components/CockpitExit.tsx';
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
import { Stage } from './components/Stage.tsx';
import { StatusChips } from './components/StatusChips.tsx';
import { StatusLine } from './components/StatusLine.tsx';
import { TopActions } from './components/TopActions.tsx';
import { UnsupportedNotice } from './components/UnsupportedNotice.tsx';

/** L'écran suit l'état de la machine applicative : vérification, refus, ou viewer. */
export function App() {
  const app = useApp();
  const phase = useSelector(app, (snapshot) => snapshot.value);
  const support = useSelector(app, (snapshot) => snapshot.context.support);
  // les machines filles sont créées à l'entrée dans `running` : on attend qu'elles existent
  const started = useSelector(app, (snapshot) => snapshot.children.viewer !== undefined);

  if (phase === 'unsupported' && support) return <UnsupportedNotice report={support} />;
  if (phase !== 'running' || !started) {
    return <div className="splash"><p className="splash-text">Vérification du navigateur…</p></div>;
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
      <div className="stacks">
        <aside className="stack stack-left">
          <LayersPanel />
          <ControlsPanel />
        </aside>
        <aside className="stack stack-right">
          <CameraPanel />
          <AircraftPanel />
          <AboutPanel />
        </aside>
      </div>
      <RenderDock />
      <StatusLine />
      <SiteSearch />
      <ManualShare />
      <ObjectViewer />
    </>
  );
}
