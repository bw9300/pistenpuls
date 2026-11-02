// @ts-nocheck: ported as-is from the single-file build; typed step by step later
import {AREAS} from './areas';

// ---------- personal settings (this browser; window.name as fallback when storage is blocked) ----------
const STORE={
  get(){try{const v=localStorage.getItem('pp-settings');if(v)return JSON.parse(v)}catch(e){}try{const m=(window.name||'').match(/^pp:(.*)$/);if(m)return JSON.parse(m[1])}catch(e){}return null},
  set(o){const j=JSON.stringify(o);try{localStorage.setItem('pp-settings',j)}catch(e){}window.name='pp:'+j},
  clear(){try{localStorage.removeItem('pp-settings');localStorage.removeItem('pp-pin')}catch(e){}window.name=''}
};
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// trip pickers shared by the wizard and the settings tab
function tripPickerHTML(prefix,chosen){
  return AREAS.map(t=>{const on=chosen.find(r=>r.id===t.id);return `<div class="pick">
    <label class="pickrow" for="${prefix}-${t.id}"><input type="checkbox" id="${prefix}-${t.id}" data-pick="${t.id}"${on?' checked':''}><span class="box" aria-hidden="true"></span><span><b>${esc(t.naam)}</b><small>${esc(t.regio)}</small></span></label>
    <label class="pickdate" for="${prefix}-${t.id}-d"${on?'':' hidden'}><span>Aankomst</span><input type="date" id="${prefix}-${t.id}-d" data-date="${t.id}" value="${on?on.aankomst:t.van}"></label></div>`}).join('');
}
function wirePicker(root){root.querySelectorAll('[data-pick]').forEach(cb=>cb.addEventListener('change',()=>{root.querySelector(`[data-date="${cb.dataset.pick}"]`).closest('.pickdate').hidden=!cb.checked}))}
function readPicker(root){return [...root.querySelectorAll('[data-pick]:checked')].map(cb=>({id:cb.dataset.pick,aankomst:root.querySelector(`[data-date="${cb.dataset.pick}"]`).value}))}
function startWizard(){
  document.body.classList.add('wizard');
  const W=document.getElementById('wizard'),f=document.getElementById('wizForm'),err=document.getElementById('wErr'),steps=[...f.querySelectorAll('[data-step]')];
  let step=1;W.hidden=false;
  document.getElementById('wTrips').innerHTML=tripPickerHTML('w',[]);
  document.getElementById('wTrips').querySelectorAll('.pickdate').forEach(d=>d.remove()); // dates come in step 3
  const show=()=>{steps.forEach(x=>x.hidden=+x.dataset.step!==step);document.getElementById('wStep').textContent=`Stap ${step} van 3`;
    document.getElementById('wBack').hidden=step===1;document.getElementById('wNext').textContent=step===3?'Start het aftellen':'Volgende';err.textContent='';
    const first=steps[step-1].querySelector('input');if(first)setTimeout(()=>first.focus(),50)};
  const name=()=>document.getElementById('wName').value.trim();
  document.getElementById('wBack').onclick=()=>{step=Math.max(1,step-1);show()};
  f.onsubmit=e=>{e.preventDefault();
    if(step===1){if(!name()){err.textContent='Vul je naam in om verder te gaan.';return}
      document.getElementById('w2t').textContent=`Leuk, ${name()}. Aan welke reizen doe je mee?`;step=2;show();return}
    if(step===2){const ids=[...f.querySelectorAll('#wTrips [data-pick]:checked')].map(c=>c.dataset.pick);if(!ids.length){err.textContent='Kies minstens één reis.';return}
      document.getElementById('wDates').innerHTML=ids.map(id=>{const t=AREAS.find(x=>x.id===id);return `<label class="wdate" for="wd-${id}"><span><b>${esc(t.naam)}</b><small>${esc(t.regio)}</small></span><input type="date" id="wd-${id}" data-wd="${id}" value="${t.van}" required></label>`}).join('');
      step=3;show();return}
    const reizen=[...f.querySelectorAll('[data-wd]')].map(i=>({id:i.dataset.wd,aankomst:i.value}));
    if(reizen.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.aankomst))){err.textContent='Vul bij elke reis een aankomstdatum in.';return}
    STORE.set({naam:name(),reizen});location.reload();
  };
  show();
}

export {STORE,esc,tripPickerHTML,wirePicker,readPicker,startWizard};
