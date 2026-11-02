import './style.css';
import { loadRuntimeConfig } from './config';
import { startApp } from './app';

declare global { function ppRetry(): void }

// preview deployments (pistenpuls-preview.…) get a visible label, so they're never mistaken for the real one
if (/(^|[.-])preview[.-]/.test(location.hostname)) {
  document.body.classList.add('preview');
  document.title = 'Pistenpuls (preview)';
}

// the stylesheet didn't arrive (see ppRetry in index.html): try once more
if (getComputedStyle(document.getElementById('stage')!).position !== 'fixed') ppRetry();
else setTimeout(() => { try { sessionStorage.removeItem('pp-retry'); } catch {} }, 10_000);

loadRuntimeConfig().then(startApp);
