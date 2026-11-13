// EAS lifecycle hook and Metro use the same strict literal flag reader.
import state from './live-edit-build-state.cjs';
if (state.readEnabled()) await import('./prepare-live-edit.mjs');
else { state.writeDarkStub(); console.log('Dark mobile build: offline vision models excluded.'); }
