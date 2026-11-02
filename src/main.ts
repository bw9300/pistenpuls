import './style.css';
import { loadRuntimeConfig } from './config';
import { startApp } from './app';

// preview deployments (pistenpuls-preview.…) get a visible label, so they're never mistaken for the real one
if (/(^|[.-])preview[.-]/.test(location.hostname)) {
  document.body.classList.add('preview');
  document.title = 'Pistenpuls (preview)';
}

loadRuntimeConfig().then(startApp);
