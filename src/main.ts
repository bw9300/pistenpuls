import './style.css';
import { loadRuntimeConfig } from './config';
import { startApp } from './app';
import { askDates, hideCards, loadMe, needsDates, redeemFromLink, showGate, showNoTrips } from './account';
import { initAdmin, openAdmin } from './admin';

declare global { function ppRetry(): void }

// preview deployments (pistenpuls-preview.…) get a visible label, so they're never mistaken for the real one
if (/(^|[.-])preview[.-]/.test(location.hostname)) {
  document.body.classList.add('preview');
  document.title = 'Pistenpuls (preview)';
}

// the stylesheet didn't arrive (see ppRetry in index.html): try once more
if (getComputedStyle(document.getElementById('stage')!).position !== 'fixed') ppRetry();
else setTimeout(() => { try { sessionStorage.removeItem('pp-retry'); } catch {} }, 10_000);

async function boot() {
  const RT = await loadRuntimeConfig();
  // hosted without a server: trips are chosen in this browser (wizard), no accounts or live
  if (!RT.live) return startApp(RT, null);

  const linkError = await redeemFromLink();
  let me;
  try { me = await loadMe(); }
  catch { document.getElementById('loadStep')!.textContent = 'Server niet bereikbaar. Nieuwe poging over een halve minuut.'; setTimeout(boot, 30_000); return; }
  if (!me) return showGate(linkError);
  if (!me.trips.length) return showNoTrips(me, me.user.isAdmin ? openAdmin : null);
  if (needsDates(me)) { me = await askDates(me); hideCards(); }
  startApp(RT, me);
  initAdmin(me);
}

// a personal link pasted into a tab that already shows Pistenpuls: start over with it
addEventListener('hashchange', () => { if (/invite=/.test(location.hash)) location.reload(); });

boot();
