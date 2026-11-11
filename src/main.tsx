import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createActor } from 'xstate';
import { createTelemetryInspector } from './app/inspector.ts';
import { decodeView } from './domain/view.ts';
import { appMachine } from './machines/app.machine.ts';
import { TelemetryBuffer } from './services/telemetry.ts';
import './styles/index.css';
import { App } from './ui/App.tsx';
import { AppActorContext } from './ui/actors.ts';

const buffer = new TelemetryBuffer();
buffer.push({
  k: 'event',
  a: 'page',
  n: 'page.loaded',
  d: {
    viewport: [innerWidth, innerHeight],
    pixelRatio: devicePixelRatio,
    language: navigator.language,
    userAgent: navigator.userAgent,
  },
});

const app = createActor(appMachine, {
  id: 'app',
  input: { view: decodeView(location.hash), buffer },
  inspect: createTelemetryInspector(buffer),
});
app.start();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppActorContext value={app}>
      <App />
    </AppActorContext>
  </StrictMode>,
);
