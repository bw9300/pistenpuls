// Taking a profile photo: only with the camera (no uploads), with a head-and-shoulders outline showing where your face goes.
// Browsers that can recognise faces (FaceDetector, so far mostly behind an experimental flag) also refuse a photo without one;
// elsewhere the camera + outline is the check. The admin can remove a photo (Beheer › Personen › ⋯).
import { esc } from './settings';

const OVAL = { cx: 50, cy: 44, rx: 22, ry: 28 }; // in % of the square view
const OUT = 320;

declare global {
  interface Window { FaceDetector?: new (o?: { fastMode?: boolean; maxDetectedFaces?: number }) => { detect(src: CanvasImageSource): Promise<{ boundingBox: DOMRectReadOnly }[]> } }
}

const silhouette = `<svg class="camsil" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
  <defs><mask id="cammask"><rect width="100" height="100" fill="#fff"/><ellipse cx="${OVAL.cx}" cy="${OVAL.cy}" rx="${OVAL.rx}" ry="${OVAL.ry}" fill="#000"/>
    <path d="M10 100C12 84 28 77 41 72L59 72C72 77 88 84 90 100Z" fill="#000"/></mask></defs>
  <rect width="100" height="100" fill="rgba(6,13,23,.6)" mask="url(#cammask)"/>
  <ellipse cx="${OVAL.cx}" cy="${OVAL.cy}" rx="${OVAL.rx}" ry="${OVAL.ry}" fill="none" stroke="#fff" stroke-width=".7" stroke-dasharray="2.5 1.8" vector-effect="non-scaling-stroke"/>
  <path d="M10 100C12 84 28 77 41 72M59 72C72 77 88 84 90 100" fill="none" stroke="#fff" stroke-width=".7" stroke-dasharray="2.5 1.8" vector-effect="non-scaling-stroke"/>
</svg>`;

/** opens the camera; resolves with a small JPEG (data URL), or null when cancelled */
export function takeAvatar(): Promise<string | null> {
  return new Promise((resolve) => {
    const box = document.createElement('div');
    box.className = 'sb cam';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Profielfoto maken');
    box.innerHTML = `<div class="sbcard camcard">
      <h2>Je profielfoto</h2>
      <div class="camview"><video playsinline autoplay muted></video><img alt="Je nieuwe foto" hidden>${silhouette}</div>
      <p class="camhint" data-hint>Camera starten…</p>
      <p class="werr" data-err role="alert"></p>
      <div class="sbrow" data-live><button type="button" data-cancel>Annuleren</button><button type="button" class="primary" data-shoot disabled>Foto maken</button></div>
      <div class="sbrow" data-check hidden><button type="button" data-again>Opnieuw</button><button type="button" class="primary" data-use>Gebruiken</button></div>
    </div>`;
    document.body.append(box);
    const q = <T extends HTMLElement>(s: string) => box.querySelector(s) as T;
    const video = q<HTMLVideoElement>('video'), img = q<HTMLImageElement>('img'), sil = q<HTMLElement>('.camsil');
    const hint = q<HTMLElement>('[data-hint]'), err = q<HTMLElement>('[data-err]'), shoot = q<HTMLButtonElement>('[data-shoot]');
    let stream: MediaStream | null = null, photo = '';

    function done(result: string | null) {
      stream?.getTracks().forEach((t) => t.stop());
      box.remove();
      resolve(result);
    }
    function phase(check: boolean) {
      q<HTMLElement>('[data-live]').hidden = check;
      q<HTMLElement>('[data-check]').hidden = !check;
      video.hidden = check; img.hidden = !check; sil.style.display = check ? 'none' : '';
      box.classList.toggle('checking', check);
    }

    q<HTMLButtonElement>('[data-cancel]').onclick = () => done(null);
    q<HTMLButtonElement>('[data-again]').onclick = () => { err.textContent = ''; hint.textContent = 'Zet je gezicht in het ovaal en kijk in de camera.'; phase(false); };
    q<HTMLButtonElement>('[data-use]').onclick = () => done(photo);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });

    shoot.onclick = async () => {
      err.textContent = '';
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      // the view shows the middle square of the camera image (object-fit: cover), mirrored like a mirror;
      // the photo is the square around the oval
      const S = Math.min(vw, vh), sx0 = (vw - S) / 2, sy0 = (vh - S) / 2;
      const side = S * (OVAL.ry * 2.5) / 100, cx = sx0 + S * OVAL.cx / 100, cy = sy0 + S * OVAL.cy / 100;
      const cv = document.createElement('canvas');
      cv.width = cv.height = OUT;
      const c = cv.getContext('2d')!;
      c.translate(OUT, 0); c.scale(-1, 1);
      c.drawImage(video, cx - side / 2, cy - side / 2, side, side, 0, 0, OUT, OUT);
      if (window.FaceDetector) {
        try {
          const faces = await new window.FaceDetector({ fastMode: true, maxDetectedFaces: 2 }).detect(cv);
          const ok = faces.some(({ boundingBox: b }) => b.width > OUT * 0.25 && Math.abs(b.x + b.width / 2 - OUT / 2) < OUT * 0.25);
          if (!ok) { err.textContent = faces.length ? 'Kom iets dichterbij en zet je gezicht midden in het ovaal.' : 'We zien geen gezicht. Zet je gezicht in het ovaal, met genoeg licht.'; return; }
        } catch {} // can't check here: fine
      }
      photo = cv.toDataURL('image/jpeg', 0.85);
      img.src = photo;
      hint.textContent = 'Zo ziet iedereen je in de chat en in de spelletjes.';
      phase(true);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { hint.textContent = ''; err.textContent = 'Deze browser kan de camera niet gebruiken.'; return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false });
        if (!box.isConnected) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        hint.textContent = 'Zet je gezicht in het ovaal en kijk in de camera.';
        shoot.disabled = false;
        shoot.focus();
      } catch (e) {
        const name = (e as DOMException).name;
        hint.textContent = '';
        err.innerHTML = esc(name === 'NotAllowedError' ? 'Geen toegang tot de camera. Sta de camera toe voor deze site (meestal via het slotje in de adresbalk) en probeer het opnieuw.'
          : name === 'NotFoundError' ? 'Geen camera gevonden op dit apparaat. Probeer het op je telefoon.'
          : 'De camera start niet. Sluit andere apps die de camera gebruiken en probeer het opnieuw.');
      }
    })();
  });
}
