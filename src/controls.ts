// Explore the map yourself: drag to orbit/tilt, right-drag / shift-drag / two fingers to pan, wheel / pinch to zoom.
// After a while without input the camera glides back to the scripted tour (double-click: right away).
import * as THREE from 'three';

/** the orbit camera as app.ts describes it: around `target`, at horizontal distance r and height h, azimuth ang */
export interface CamState {
  target: THREE.Vector3;
  ang: number;
  r: number;
  h: number;
}

interface World {
  R: number;
  Wm: number;
  Dm: number;
  hAt(x: number, z: number): number;
}

const RETURN_S = 2.8;
const smooth = (t: number) => t * t * (3 - 2 * t);
const angDiff = (a: number, b: number) => ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

export function createControls(el: HTMLElement, opts: { idleMs: number; world: () => World | null }) {
  /** set while the user is (or was recently) in control */
  let manual: CamState | null = null;
  /** gliding back: from this state to the live scripted one */
  let back: { from: CamState; t: number } | null = null;
  let scripted: CamState | null = null, out: CamState | null = null, lastInput = 0;
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; cy: number } | null = null;

  const copy = (s: CamState): CamState => ({ target: s.target.clone(), ang: s.ang, r: s.r, h: s.h });

  /** take control (from the tour, or halfway the glide back) */
  function take(): CamState | null {
    lastInput = performance.now();
    if (!manual || back) {
      const from = out || scripted;
      if (!from) return null;
      manual = copy(from);
      back = null;
    }
    return manual;
  }

  function orbitBy(dx: number, dy: number) {
    const m = take();
    if (!m) return;
    m.ang -= dx * 0.006;
    const d = Math.hypot(m.r, m.h);
    const phi = Math.min(1.45, Math.max(0.06, Math.atan2(m.h, m.r) + dy * 0.004));
    m.r = d * Math.cos(phi);
    m.h = d * Math.sin(phi);
  }

  function zoomBy(f: number) {
    const m = take(), w = opts.world();
    if (!m || !w) return;
    const d = Math.hypot(m.r, m.h), nd = Math.min(w.R * 3, Math.max(w.R * 0.05, d * f));
    m.r *= nd / d;
    m.h *= nd / d;
  }

  function panBy(dx: number, dy: number) {
    const m = take(), w = opts.world();
    if (!m || !w) return;
    const k = (Math.hypot(m.r, m.h) / Math.max(200, el.clientHeight)) * 1.1;
    const s = Math.sin(m.ang), c = Math.cos(m.ang);
    // screen right = (cos, 0, -sin); away from the camera over the ground = (-sin, 0, -cos)
    let x = m.target.x - c * dx * k - s * dy * k, z = m.target.z + s * dx * k - c * dy * k;
    x = Math.max(-w.Wm / 2, Math.min(w.Wm / 2, x));
    z = Math.max(-w.Dm / 2, Math.min(w.Dm / 2, z));
    m.target.set(x, w.hAt(x, z), z);
  }

  // ---------- input ----------
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    try { el.setPointerCapture(e.pointerId); } catch {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.classList.add('grabbing');
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    }
  });
  el.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pointers.size === 1) {
      if (e.buttons & 2 || e.shiftKey || e.ctrlKey || e.metaKey) panBy(dx, dy);
      else orbitBy(dx, dy);
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (d > 10) zoomBy(pinch.d / d);
      panBy(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy };
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!pointers.size) el.classList.remove('grabbing');
    lastInput = performance.now();
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
  el.addEventListener('dblclick', () => returnNow());
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  function returnNow() {
    if (manual && !back) back = { from: copy(manual), t: 0 };
  }

  return {
    /** the user is in control: hold the tour (scene timer) */
    holding: () => !!manual && !back,
    /** start gliding back now (e.g. the scene was changed by hand) */
    returnNow,
    /** drop control at once (e.g. flying to another trip) */
    release() { manual = null; back = null; out = null; },
    /** per frame: the scripted camera in, the camera to use out */
    update(dt: number, s: CamState): CamState {
      scripted = s;
      if (!manual) return (out = s);
      if (!back && !pointers.size && performance.now() - lastInput > opts.idleMs) returnNow();
      if (!back) return (out = manual);
      back.t += dt / RETURN_S;
      if (back.t >= 1) { manual = null; back = null; return (out = s); }
      const e = smooth(back.t), f = back.from;
      return (out = {
        target: f.target.clone().lerp(s.target, e),
        ang: f.ang + angDiff(f.ang, s.ang) * e,
        r: f.r + (s.r - f.r) * e,
        h: f.h + (s.h - f.h) * e,
      });
    },
  };
}
