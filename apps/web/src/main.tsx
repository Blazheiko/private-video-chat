import { render } from 'preact';
import { App } from '@web/ui/App.js';
import { registerServiceWorker } from '@web/pwa.js';
import './style.css';

registerServiceWorker();
render(<App />, document.getElementById('app')!);
