// @ts-nocheck: ported as-is from the single-file build; typed step by step later
// The dashboard: 3D scene, scenes/tiles, state machine. Started from main.ts.
import * as THREE from 'three';
import {CONFIG} from './config';
import {AREAS} from './areas';
import {PI,hash2,buildWorld,buildHouses,demFromGrid,osmFromStore,housesFromStore} from './terrain';
import {loadTerrain,loadOsm,lineRaster,WX,fetchWeather,fetchSnow,fetchWebcams,fetchMap} from './data';
import {STORE,esc,tripPickerHTML,wirePicker,readPicker,startWizard} from './settings';
import {startLiveUI} from './live-ui';
import {renderSettings} from './account';
import {createControls} from './controls';

// ME: the signed-in account (server with live), or null when hosted statically (trips chosen in this browser)
export function startApp(RT,ME){
const SETTINGS=ME?null:STORE.get();
const byDate=(a,b)=>a.van<b.van?-1:a.van>b.van?1:0;
// a trip = an area plus its own id, name (pill label) and my arrival date
const TRIPS=ME
  ?ME.trips.map(t=>{const a=AREAS.find(x=>x.id===t.area);return a?Object.assign({},a,{id:t.id,area:a.id,kort:t.naam,van:t.aankomst||t.aankomstReis}):null}).filter(Boolean).sort(byDate)
  :((SETTINGS&&SETTINGS.reizen)||[]).map(r=>{const c=AREAS.find(t=>t.id===r.id);return c&&/^\d{4}-\d{2}-\d{2}$/.test(r.aankomst)?Object.assign({},c,{area:c.id,van:r.aankomst}):null}).filter(Boolean).sort(byDate);
if(!TRIPS.length){if(!ME)startWizard();return}
const NAAM=String(ME?ME.user.naam:SETTINGS.naam||'').trim();
const SCENES=['Aftellen','Sneeuw & weer',RT.webcams?'Webcams':'Uitzicht','Pistekaart','Sfeer nu'];
const SCENE_DUR=CONFIG.sceneSeconds, FLIGHT_DUR=6.5;
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const $=id=>document.getElementById(id);


// ---------- live data per trip ----------
async function loadWeather(T){
  try{T.wx=await fetchWeather(T.world)}catch(e){T.wx=null;console.warn(e)}
  if(T===shown)fillWeather(T);
}
async function loadSnow(T){
  try{T.snow=await fetchSnow(T)}catch(e){console.warn('sneeuw',e);T.snow=null}
  if(T===shown)fillWeather(T);
}
async function loadWebcams(T){
  if(!RT.webcams||!T.world)return;
  try{T.cams=await fetchWebcams(T.world,RT.apiBase);T.camErr=T.cams.length?'':'Geen webcams gevonden in dit gebied'}
  catch(e){console.warn('webcams',e);T.cams=null;T.camErr='Webcams niet bereikbaar ('+(e&&e.message||e)+')'}
  if(T===shown)fillCams(T);
}
function fillCams(T){
  const grid=$('camgrid'),col=$('camcol');
  if(!T.cams||!T.cams.length){grid.hidden=true;col.hidden=false;if(T.camErr)$('cam1').textContent=T.camErr;return}
  const fmt=d=>d?d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}):'';
  grid.innerHTML=T.cams.map((c,i)=>`<div class="wcwrap tile" style="--d:${(i*.08).toFixed(2)}s;border:0;background:none"><a class="wc" href="${c.url}" target="_blank" rel="noopener"><img src="${c.img}" alt="Webcam ${c.title.replace(/"/g,'')}" width="400" height="225"><div class="cap"><b>${c.title.replace(/</g,'')}</b><span>${c.alt?Math.round(c.alt).toLocaleString('nl-NL')+' m · ':''}${fmt(c.t)}</span></div></a><div class="live"><i></i>LIVE</div></div>`).join('')
    +`<div class="camcredit tile">Webcams via <a href="https://www.windy.com/" target="_blank" rel="noopener" style="color:inherit">windy.com</a></div>`;
  grid.hidden=false;col.hidden=true;
}

// ---------- three setup ----------
const canvas=$('gl');
const controls=createControls(canvas,{idleMs:CONFIG.idleSeconds*1000,world:()=>shown&&shown.world});
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
renderer.setClearColor(0x000000,0);
const scene=new THREE.Scene();scene.fog=new THREE.Fog(0xC3D6E6,10000,60000);
const camera=new THREE.PerspectiveCamera(38,16/9,10,200000);
const hemi=new THREE.HemisphereLight(0xeef4fa,0x3d4854,.62);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfff4e0,1.3);scene.add(sun,sun.target);
function glowTex(r,g,b){const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');const gr=x.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,`rgba(${r},${g},${b},1)`);gr.addColorStop(.25,`rgba(${r},${g},${b},.6)`);gr.addColorStop(1,`rgba(${r},${g},${b},0)`);x.fillStyle=gr;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c)}
const LIGHT_TEX=glowTex(255,190,110),SNOW_TEX=glowTex(255,255,255);
const PCOL={b:'#2F7FE0',r:'#E0533D',z:'#16181C',s:'#F0B45A'};
const pisteMats=Object.fromEntries(Object.entries(PCOL).map(([k,c])=>{const m=new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});m.userData.base=new THREE.Color(c);return [k,m]}));
function geom(P,C){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));if(C)g.setAttribute('color',new THREE.Float32BufferAttribute(C,3));g.computeVertexNormals();return g}

function makeGroup(T){
  const w=T.world,grp=new THREE.Group();
  grp.add(new THREE.Mesh(geom(w.P,w.C),new THREE.MeshLambertMaterial({vertexColors:true})));
  for(const k in w.ribbons)if(w.ribbons[k].length)grp.add(new THREE.Mesh(geom(w.ribbons[k]),pisteMats[k]));
  if(w.cable.length)grp.add(new THREE.Mesh(geom(w.cable),new THREE.MeshLambertMaterial({color:0x3A3F46})));
  if(w.pylon.length)grp.add(new THREE.Mesh(geom(w.pylon),new THREE.MeshLambertMaterial({color:0x6E757D})));
  if(w.station.length)grp.add(new THREE.Mesh(geom(w.station),new THREE.MeshLambertMaterial({color:0x5A3E2B})));
  // trees
  if(w.trees.length){const N=w.trees.length/4,cone=new THREE.ConeGeometry(1,1,6);cone.translate(0,.5,0);
    const im=new THREE.InstancedMesh(cone,new THREE.MeshLambertMaterial({color:0xffffff}),N),o=new THREE.Object3D(),c1=new THREE.Color('#173329'),c2=new THREE.Color('#27443A'),tc=new THREE.Color();
    for(let i=0;i<N;i++){const x=w.trees[i*4],y=w.trees[i*4+1],z=w.trees[i*4+2],k=w.trees[i*4+3],h=16*Math.sqrt(w.treeStep/24)*(.75+k*.5);
      o.position.set(x,y-2,z);o.scale.set(h*.32,h*CONFIG.exaggeration,h*.32);o.rotation.y=k*6;o.updateMatrix();im.setMatrixAt(i,o.matrix);tc.copy(c1).lerp(c2,k);im.setColorAt(i,tc)}
    grp.add(im)}
  // nulgradengrens
  T.fzMat=new THREE.MeshBasicMaterial({color:0xE6EEF6,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide});
  T.fz=new THREE.Mesh(new THREE.PlaneGeometry(w.Wm,w.Dm),T.fzMat);T.fz.rotation.x=-PI/2;T.fz.visible=false;grp.add(T.fz);
  grp.visible=false;scene.add(grp);T.group=grp;
}
function addHouses(T,H){
  if(!H.length)return;const w=T.world,grp=T.group;
  const box=new THREE.BoxGeometry(1,1,1);box.translate(0,.5,0);
  const roof=new THREE.ConeGeometry(.7071,1,4);roof.rotateY(PI/4);roof.translate(0,.5,0);
  const walls=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:0xffffff}),H.length);
  const roofs=new THREE.InstancedMesh(roof,new THREE.MeshLambertMaterial({color:0xF2F5F8}),H.length);
  const o=new THREE.Object3D(),cWood=new THREE.Color('#6B4A35'),cPlaster=new THREE.Color('#E8E0D2'),lp=[];
  H.forEach((h,i)=>{o.position.set(h.x,h.y-1,h.z);o.rotation.set(0,-h.ang,0);o.scale.set(h.len,h.hgt+1,h.wid);o.updateMatrix();walls.setMatrixAt(i,o.matrix);walls.setColorAt(i,h.k<.55?cWood:cPlaster);
    o.position.y=h.y+h.hgt;o.scale.set(h.len*1.12,Math.min(h.len,h.wid)*.45,h.wid*1.12);o.updateMatrix();roofs.setMatrixAt(i,o.matrix);
    lp.push(h.x,h.y+h.hgt*.45,h.z)});
  grp.add(walls,roofs);
  const lg=new THREE.BufferGeometry();lg.setAttribute('position',new THREE.Float32BufferAttribute(lp,3));
  T.lightMat=new THREE.PointsMaterial({size:Math.max(28,w.R*.006),map:LIGHT_TEX,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:lights});
  grp.add(new THREE.Points(lg,T.lightMat));
}
// stars & snow (shared)
const sp=[];for(let i=0;i<900;i++){const t=hash2(i,1)*PI*2,u=.06+hash2(2,i)*.9;sp.push(Math.cos(t)*Math.cos(u),Math.sin(u),Math.sin(t)*Math.cos(u))}
const stGeo=new THREE.BufferGeometry();stGeo.setAttribute('position',new THREE.Float32BufferAttribute(sp,3));
const stMat=new THREE.PointsMaterial({size:2.2,sizeAttenuation:false,color:0xF4EDE1,transparent:true,opacity:0,fog:false,depthWrite:false});
const stars=new THREE.Points(stGeo,stMat);scene.add(stars);
const SN=reduce?0:3500,snArr=new Float32Array(SN*3),snSpd=new Float32Array(SN);
for(let i=0;i<SN;i++){snArr[i*3]=(Math.random()-.5);snArr[i*3+1]=Math.random();snArr[i*3+2]=(Math.random()-.5);snSpd[i]=.6+Math.random()*.5}
const snGeo=new THREE.BufferGeometry();snGeo.setAttribute('position',new THREE.BufferAttribute(snArr,3));
const snMat=new THREE.PointsMaterial({size:3,map:SNOW_TEX,transparent:true,depthWrite:false,opacity:0,fog:false});
const snow=new THREE.Points(snGeo,snMat);snow.frustumCulled=false;scene.add(snow);
const camCams=[new THREE.PerspectiveCamera(46,16/9,5,200000),new THREE.PerspectiveCamera(40,16/9,5,200000)];

// ---------- live weather in the 3D world ----------
// kind → how it looks: cloud amount, fog, rain, snow, lightning
const WXLOOK={
  helder:{label:'Stralend',clouds:.08,fog:0,rain:0,snow:0,bolt:0},
  zonwolk:{label:'Zon en wolken',clouds:.45,fog:0,rain:0,snow:0,bolt:0},
  bewolkt:{label:'Droog en bewolkt',clouds:.9,fog:.12,rain:0,snow:0,bolt:0},
  mist:{label:'Mistig',clouds:.7,fog:.9,rain:0,snow:0,bolt:0},
  motregen:{label:'Motregen',clouds:.95,fog:.3,rain:.35,snow:0,bolt:0},
  regen:{label:'Regen',clouds:1,fog:.35,rain:.85,snow:0,bolt:0},
  sneeuw:{label:'Het sneeuwt',clouds:1,fog:.35,rain:0,snow:.9,bolt:0},
  onweer:{label:'Onweer',clouds:1,fog:.3,rain:1,snow:0,bolt:1}};
let wxMode='echt';
function weatherNow(T){
  if(wxMode!=='echt')return Object.assign({kind:wxMode},WXLOOK[wxMode==='helder'?'helder':wxMode]);
  const x=T&&T.wx&&T.wx.top;if(!x)return Object.assign({kind:'zonwolk'},WXLOOK.zonwolk,{label:''});
  const c=x.code;let kind='bewolkt';
  if(c<=1)kind='helder';else if(c===2)kind='zonwolk';else if(c===3)kind='bewolkt';else if(c===45||c===48)kind='mist';
  else if(c>=51&&c<=57)kind='motregen';else if((c>=61&&c<=67)||(c>=80&&c<=82))kind='regen';else if((c>=71&&c<=77)||c===85||c===86)kind='sneeuw';else if(c>=95)kind='onweer';
  const o=Object.assign({kind},WXLOOK[kind]);
  if(typeof x.cloud==='number'&&kind!=='mist')o.clouds=Math.max(o.clouds*.5,x.cloud/100);
  if(typeof x.vis==='number'&&x.vis<1500){o.fog=Math.max(o.fog,1-x.vis/1500*.6);if(kind==='bewolkt'||kind==='zonwolk'){o.kind='mist';o.label='Mistig'}}
  if(kind==='sneeuw')o.snow=c===71||c===85?.55:c===75||c===86?1:.85;
  if(o.kind==='helder'&&isNight())o.label='Heldere nacht';
  return o;
}
function isNight(){const h=hourNow();return h<7.5||h>18.2}
const wxCur={clouds:.3,fog:0,rain:0,snow:0,bolt:0};
// low-poly 3D clouds: broad, flat-bottomed cumulus well above the peaks. Only the half of the sky beyond the
// mountains (seen from the camera) holds clouds; near the camera they dissolve, so the view on the area stays open.
const PUFFS=10,CLUST=26,puffGeo=new THREE.IcosahedronGeometry(1,1);
{const p=puffGeo.attributes.position;for(let i=0;i<p.count;i++)if(p.getY(i)<-.2)p.setY(i,-.2);p.needsUpdate=true;puffGeo.computeVertexNormals()}
const cloudMat=new THREE.MeshLambertMaterial({color:0xF3F5F8,emissive:0x2a3036,flatShading:true});
const clouds=new THREE.InstancedMesh(puffGeo,cloudMat,PUFFS*CLUST);clouds.frustumCulled=false;scene.add(clouds);
const cloudSeed=[];for(let i=0;i<CLUST;i++)cloudSeed.push({x:hash2(i,11)-.5,z:hash2(13,i)-.5,h:hash2(i,17),s:.7+hash2(19,i)*.7,rot:hash2(i,23)*PI,
  puffs:Array.from({length:PUFFS},(_,p)=>{const dx=(p/(PUFFS-1)-.5)*2+(hash2(i*7+p,3)-.5)*.3;return {dx,dy:hash2(p,i*5+1)*.25*(1-Math.abs(dx)*.7),dz:(hash2(i+p*3,9)-.5)*.9,r:(.7+hash2(p*11,i)*.4)*(1-Math.abs(dx)*.45)}})});
let cloudDrift=0;const cO=new THREE.Object3D(),toT=new THREE.Vector3();
function updateClouds(w,dt){
  cloudDrift+=dt*w.R*.0035;const n=Math.round(CLUST*wxCur.clouds);
  const R=w.R,S=R*.09,spanX=w.Wm*1.6,spanZ=w.Dm*1.6;
  toT.set(target.x-camera.position.x,0,target.z-camera.position.z).normalize();
  const camD=R*.55;let k=0;
  for(let i=0;i<n;i++){const c=cloudSeed[i];
    let x=c.x*spanX+cloudDrift;x=((x+spanX/2)%spanX+spanX)%spanX-spanX/2;const z=c.z*spanZ,y=w.summit[1]+R*(.09+c.h*.07);
    // only beyond the model as seen from the camera; a short shrink when crossing over
    const ahead=((x-target.x)*toT.x+(z-target.z)*toT.z)/R,dist=Math.hypot(x-camera.position.x,z-camera.position.z);
    let f=Math.min(1,Math.max(0,(ahead+.05)/.12));if(dist<camD)f=0;if(f<.4)continue;
    const sc=f*f*(3-2*f)*c.s,cr=Math.cos(c.rot),sr=Math.sin(c.rot);
    for(const p of c.puffs){const lx=p.dx*S*1.5,lz=p.dz*S;cO.position.set(x+(lx*cr-lz*sr)*c.s,y+p.dy*S*c.s,z+(lx*sr+lz*cr)*c.s);
      cO.scale.set(S*p.r*1.5*sc,S*p.r*.38*sc,S*p.r*1.2*sc);cO.rotation.set(0,c.rot,0);cO.updateMatrix();clouds.setMatrixAt(k++,cO.matrix)}}
  clouds.count=k;clouds.instanceMatrix.needsUpdate=true;
}
// rain as short streaks around the camera
const RN=reduce?0:2600,rnArr=new Float32Array(RN*6),rnSpd=new Float32Array(RN);
for(let i=0;i<RN;i++){const x=Math.random()-.5,y=Math.random(),z=Math.random()-.5;rnArr.set([x,y,z,x,y-.025,z],i*6);rnSpd[i]=1.4+Math.random()*.6}
const rnGeo=new THREE.BufferGeometry();rnGeo.setAttribute('position',new THREE.BufferAttribute(rnArr,3));
const rnMat=new THREE.LineBasicMaterial({color:0xA9BCCD,transparent:true,opacity:0,fog:false,depthWrite:false});
const rain=new THREE.LineSegments(rnGeo,rnMat);rain.frustumCulled=false;scene.add(rain);
let flash=0,hemiBase=.62;

// ---------- trips ----------
TRIPS.forEach(t=>{t.state='idle'});
let lights=0;
function setStep(T,show,title,step){if(!show)return;if(title)$('loadTitle').textContent=title;$('loadStep').textContent=step}
async function prepare(T,show){
  if(T.state!=='idle')return T.ready;
  T.state='loading';
  T.ready=(async()=>{
    let store=null;
    if(T.mapUrl){setStep(T,show,'Bergen laden','Kaartdata laden');try{store=await fetchMap(T.mapUrl)}catch(e){console.warn(e)}}
    if(store){ // everything from the stored map data: no waiting on the map servers
      try{setStep(T,show,'Bergen laden','Berg bouwen');await new Promise(r=>setTimeout(r,30));T.mapCreated=store.created;
        T.elev=demFromGrid(T.bbox,store.dem,atob);T.osmFailed=false;
        T.world=buildWorld(T,T.elev,osmFromStore(store),{cell:({laag:140,midden:95,hoog:55})[CONFIG.detail]||95,exaggeration:CONFIG.exaggeration,lineRaster,treeline:T.treeline||CONFIG.treeline});
        makeGroup(T);addHouses(T,housesFromStore(T.world,store.houses,CONFIG.maxBuildings));T.state='ready';loadWeather(T);loadSnow(T);loadWebcams(T);
      }catch(e){console.error(e);T.state='error';setStep(T,show,'Kan '+T.kort+' niet bouwen',String(e&&e.message||e))}
      return;
    }
    let elev;
    try{setStep(T,show,'Bergen laden','Hoogtedata ophalen');elev=await loadTerrain(T)}
    catch(e){console.error(e);T.state='error';setStep(T,show,'Kan '+T.kort+' niet laden','De hoogtedata (AWS Terrain Tiles) is niet bereikbaar. Nieuwe poging over een minuut.');setTimeout(()=>{T.state='idle'},60000);return}
    T.elev=elev;let osm;
    try{setStep(T,show,null,'Pistes en liften uit OpenStreetMap (kan de eerste keer een minuut duren)');osm=await loadOsm(T,'ski');T.osmFailed=false}
    catch(e){console.warn(e);osm={pistes:[],lifts:[],buildings:[]};T.osmFailed=true}
    try{setStep(T,show,null,'Berg bouwen');await new Promise(r=>setTimeout(r,30));
      T.world=buildWorld(T,elev,osm,{cell:({laag:140,midden:95,hoog:55})[CONFIG.detail]||95,exaggeration:CONFIG.exaggeration,lineRaster,treeline:T.treeline||CONFIG.treeline});
      makeGroup(T);T.state='ready';loadWeather(T);loadSnow(T);loadWebcams(T);
    }catch(e){console.error(e);T.state='error';setStep(T,show,'Kan '+T.kort+' niet bouwen',String(e&&e.message||e));return}
    if(T.osmFailed)setTimeout(()=>retrySki(T),5*60000);
    else loadOsm(T,'dorp').then(d=>{if(T.world)addHouses(T,buildHouses(T.world,d.buildings,CONFIG.maxBuildings))}).catch(e=>console.warn('gebouwen',e));
  })();
  return T.ready;
}
async function retrySki(T){
  try{const osm=await loadOsm(T,'ski');const old=T.group;
    T.world=buildWorld(T,T.elev,osm,{cell:({laag:140,midden:95,hoog:55})[CONFIG.detail]||95,exaggeration:CONFIG.exaggeration,lineRaster,treeline:T.treeline||CONFIG.treeline});
    T.osmFailed=false;makeGroup(T);scene.remove(old);if(shown===T){shown=null;swapTo(T)}loadWeather(T);
    loadOsm(T,'dorp').then(d=>addHouses(T,buildHouses(T.world,d.buildings,CONFIG.maxBuildings))).catch(()=>{});
  }catch(e){setTimeout(()=>retrySki(T),10*60000)}
}

// ---------- UI ----------
const stage=$('stage'),TZ='Europe/Vienna';
const fmtDay=new Intl.DateTimeFormat('nl-NL',{weekday:'short',day:'numeric',month:'short'});
const fmtDate=new Intl.DateTimeFormat('nl-NL',{weekday:'long',day:'numeric',month:'long'});
const D=iso=>new Date(iso+'T00:00:00');
const nl=n=>Math.round(n).toLocaleString('nl-NL');
$('tabs').innerHTML=TRIPS.map((t,i)=>`<button type="button" data-trip="${i}" aria-pressed="false"><span class="tnum">${i+1} ·</span>${esc(t.kort)}<b class="tbadge" hidden></b><svg class="pinic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1.5h6l-1 4 3 3H3l3-3z" fill="currentColor"/><path d="M8 8.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>`).join('');
$('segs').innerHTML=SCENES.map((s,i)=>`<button type="button" class="seg" data-seg="${i}" aria-label="Ga naar ${s}"><div><svg class="pinic" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1.5h6l-1 4 3 3H3l3-3z" fill="currentColor"/><path d="M8 8.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>${s}</div><div class="tr"><i></i></div></button>`).join('');
const segEls=[...document.querySelectorAll('.seg')],sceneEls=[...document.querySelectorAll('.scene')],tabEls=[...$('tabs').children];
const greetWord=()=>{const h=new Date().getHours();return h<6?'Goedenacht':h<12?'Goedemorgen':h<18?'Goedemiddag':'Goedenavond'};
const daysTo=t=>Math.max(0,Math.ceil((D(t.van)-Date.now())/864e5));
function fillTrip(T){
  const dt=daysTo(T),w=T.world;
  $('days').textContent=dt;$('toDest').textContent='tot '+T.naam;
  $('dates').textContent='aankomst op '+fmtDate.format(D(T.van))+' '+D(T.van).getFullYear();
  $('eyebrowTxt').textContent=dt>0?(NAAM?`Nog even volhouden, ${NAAM}`:'Nog even volhouden'):(NAAM?`Veel plezier, ${NAAM}!`:'Veel plezier!');
  $('firstDay').textContent=fmtDay.format(D(T.van));
  {const wk=Math.floor(dt/7),dd=dt%7;$('nights').textContent=dt>0?`over ${wk} ${wk===1?'week':'weken'}${dd?` en ${dd} ${dd===1?'dag':'dagen'}`:''}`:'vandaag'}
  const kmT=w.km.b+w.km.r+w.km.z+w.km.s;
  $('area').textContent=T.regio;$('areaSub').textContent=T.osmFailed?'Pistedata volgt zodra OpenStreetMap bereikbaar is':`${nl(kmT)} km pistelijn · ${w.liftCount} liften · ${nl(w.dalAlt)}–${nl(w.topAlt)} m`;
  $('cam0').textContent='Vanaf het hoogste bergstation';$('cam1').textContent='Vanuit het dorp';
  $('pkSub').textContent=`${T.regio}`;$('kmB').textContent=nl(w.km.b)+' km';$('kmR').textContent=nl(w.km.r)+' km';$('kmZ').textContent=nl(w.km.z)+' km';$('kmS').textContent=nl(w.km.s)+' km';$('lifts').textContent=w.liftCount;
  $('groet').textContent=NAAM?`${T.hallo||'Servus'}, ${NAAM}.`:T.groet;$('groetSub').textContent=T.groetSub;
  const wk=Math.floor(dt/7);$('weeks').textContent=dt<=0?'Nu!':wk>1?wk+' weken':dt+(dt===1?' dag':' dagen');
  $('mkName').textContent=`${w.summitName||'Bergstation'} · ${nl(w.topAlt)} m`;
  $('topCount').innerHTML=(NAAM?`${greetWord()}, ${esc(NAAM)} · `:'')+(dt>0?`nog <strong>${dt} ${dt===1?'dag':'dagen'}</strong>`:'<strong>vandaag!</strong>');
  tabEls.forEach((e,i)=>e.classList.toggle('on',TRIPS[i]===T));tabTitles();
  document.querySelectorAll('[data-trip]').forEach(b=>b.setAttribute('aria-pressed',TRIPS[+b.dataset.trip]===T));
  const s=w.summit,v=w.village;
  camCams[0].position.set(s[0],s[1]+25,s[2]);camCams[0].lookAt(v[0],v[1],v[2]);
  const dx=s[0]-v[0],dz=s[2]-v[2],l=Math.hypot(dx,dz)||1;camCams[1].position.set(v[0]-dx/l*250,0,v[2]-dz/l*250);camCams[1].position.y=w.hAt(camCams[1].position.x,camCams[1].position.z)+35;camCams[1].lookAt(s[0],s[1]*.92,s[2]);
  fillWeather(T);fillCams(T);fillMapInfo(T);
}
function fillWeather(T){
  const x=T.wx,sn=T.snow,dash=id=>$(id).textContent='–';
  const tm=d=>d.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});
  // measured snow and conditions on the mountain
  const st=(v,el,bar,lbl,o)=>{if(o&&typeof o.hs==='number'){$(el).textContent=Math.round(o.hs);$(bar).style.width=Math.min(100,o.hs/3)+'%';$(lbl).textContent=`${o.name} · ${nl(o.alt)} m`}else{dash(el);$(bar).style.width='0';$(lbl).textContent='geen meting'}};
  st(0,'sb','sbBar','sbAlt',sn&&sn.berg);st(0,'sd','sdBar','sdAlt',sn&&sn.dal);
  const b=sn&&sn.berg;
  $('fresh').textContent=b&&typeof b.hsd24==='number'?(b.hsd24>=.5?'+':'')+Math.round(b.hsd24)+' cm':'–';
  $('wxSrc').textContent=b?'gemeten · '+tm(b.date):'meetstations niet bereikbaar';
  if(b&&typeof b.lt==='number')$('temp').textContent=(b.lt<0?'−':'')+Math.abs(Math.round(b.lt))+'°';else if(x)$('temp').textContent=(x.top.temp<0?'−':'')+Math.abs(Math.round(x.top.temp))+'°';else dash('temp');
  if(b&&typeof b.wg==='number'){$('wind').textContent=Math.round(b.wg);$('windSub').textContent='gemeten op '+b.name}else if(x){$('wind').textContent=Math.round(x.top.wind);$('windSub').textContent='Open-Meteo'}else dash('wind');
  // forecast-based: conditions, freezing level, sunset
  if(!x){dash('grens');dash('zon');$('weer').textContent='Weerdata niet bereikbaar';return}
  $('weer').textContent=(WX[x.top.code]||'')+(b?' · '+b.name:'');
  $('grens').textContent=nl(x.top.grens)+' m';
  $('zon').textContent=x.top.sunset?new Date(x.top.sunset+'Z').toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit',timeZone:TZ}):'–';
  if(T.fz)T.fz.position.y=T.world.Y(x.top.grens);
}
function tickClock(){const n=new Date();$('clock').textContent=n.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'});$('date').textContent=fmtDate.format(n);
  document.querySelectorAll('.camtime').forEach(e=>e.textContent=n.toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'}));
  const T=TRIPS[trip],ms=D(T.van)-n;if(ms>0){const hh=Math.floor(ms/36e5)%24,mm=Math.floor(ms/6e4)%60,ss=Math.floor(ms/1e3)%60;$('hms').textContent=`en ${hh} uur, ${mm} min, ${String(ss).padStart(2,'0')} sec`}else $('hms').textContent=NAAM?`Vandaag is het zover, ${NAAM}!`:'Vandaag is het zover!'}

// ---------- time of day ----------
const PAL={night:{top:'#060D17',hor:'#1A2B3F',sun:.2,sunC:'#9DB4D6',hemi:.32,lights:1,stars:1},dawn:{top:'#22385C',hor:'#E3A27A',sun:.95,sunC:'#FFC08A',hemi:.45,lights:.5,stars:.2},day:{top:'#3B6C9E',hor:'#C3D6E6',sun:1.35,sunC:'#FFF4E0',hemi:.62,lights:0,stars:0},dusk:{top:'#253A60',hor:'#ECA36C',sun:1.0,sunC:'#FFB27A',hemi:.45,lights:.6,stars:.15},blue:{top:'#111E36',hor:'#4B6189',sun:.32,sunC:'#B8C8E8',hemi:.42,lights:.95,stars:.6}};
const KEYS=[[0,'night'],[6.8,'night'],[7.9,'dawn'],[9.3,'day'],[15.6,'day'],[17.0,'dusk'],[18.0,'blue'],[19.3,'night'],[24,'night']];
let todMode='nu';
function hourNow(){if(todMode==='dag')return 12.5;if(todMode==='avond')return 17.3;if(todMode==='nacht')return 22;const d=new Date();return d.getHours()+d.getMinutes()/60}
const cA=new THREE.Color(),cB=new THREE.Color();
function palette(h){let i=0;while(i<KEYS.length-2&&h>=KEYS[i+1][0])i++;const [h0,k0]=KEYS[i],[h1,k1]=KEYS[i+1],t=h1>h0?(h-h0)/(h1-h0):0,a=PAL[k0],b=PAL[k1];
  const mix=(x,y)=>'#'+cA.set(x).lerp(cB.set(y),t).getHexString();return {top:mix(a.top,b.top),hor:mix(a.hor,b.hor),sun:a.sun+(b.sun-a.sun)*t,sunC:mix(a.sunC,b.sunC),hemi:a.hemi+(b.hemi-a.hemi)*t,lights:a.lights+(b.lights-a.lights)*t,stars:a.stars+(b.stars-a.stars)*t}}
let lastSky='';const themeMeta=document.querySelector('meta[name="theme-color"]');
function greyed(hex,amt,lift){const c=new THREE.Color(hex),hsl={};c.getHSL(hsl);c.setHSL(hsl.h,hsl.s*(1-.85*amt),Math.min(.92,hsl.l+lift));return '#'+c.getHexString()}
function applyTod(){const h=hourNow(),p=palette(h),gr=Math.max(wxCur.clouds*.8,wxCur.fog),night=isNight();
  p.top=greyed(p.top,gr,night?0:.12*gr+.25*wxCur.fog);p.hor=greyed(p.hor,Math.max(gr,wxCur.fog),night?0:.06*gr+.12*wxCur.fog);
  const g=`linear-gradient(180deg, ${p.top} 0%, ${p.hor} 62%, ${p.hor} 100%)`;if(g!==lastSky){$('sky').style.background=g;lastSky=g;themeMeta.content=p.top}
  scene.fog.color.set(p.hor);sun.intensity=p.sun*(1-.72*gr);sun.color.set(p.sunC);hemiBase=p.hemi*(1+.25*gr);hemi.intensity=hemiBase;p.stars*=1-gr;
  if(shown&&shown.world){const R=shown.world.R;scene.fog.near=R*(1.6-1.5*wxCur.fog);scene.fog.far=R*(7-5.9*wxCur.fog)}
  const cc=new THREE.Color(p.hor).lerp(new THREE.Color('#F7F8FA'),night?.1:.75);cloudMat.color.copy(cc);cloudMat.emissive.set(night?0x05080c:0x2a3036);lights=p.lights;stMat.opacity=p.stars;
  const day=h>7.5&&h<18.2,az=day?((h-12)/12)*PI*1.1:PI*.3,el=day?.1+.35*Math.sin(PI*Math.min(1,Math.max(0,(h-7.5)/10.7))):.7;
  sun.position.set(target.x+Math.sin(az+PI*1.2)*Math.cos(el)*1e5,Math.sin(el)*1e5,target.z+Math.cos(az+PI*1.2)*Math.cos(el)*1e5);sun.target.position.copy(target);
  const T=TRIPS[trip];if(T.lightMat)T.lightMat.opacity=lights;
  const wn=weatherNow(shown||T),wxEl=$('wxNow');if(wn.label){wxEl.hidden=false;const tt=shown&&shown.snow&&shown.snow.berg&&typeof shown.snow.berg.lt==='number'?shown.snow.berg.lt:(shown&&shown.wx?shown.wx.top.temp:null);wxEl.textContent=wn.label+(tt!==null?` · ${tt<0?'−':''}${Math.abs(Math.round(tt))}°`:'')}else wxEl.hidden=true;}

// ---------- camera choreography ----------
const target=new THREE.Vector3(),orbit={r:5000,h:2500},orbitGoal={r:5000,h:2500};
// per scene: focus (summit|center|village|mix), radius & height as fraction of area half-size
const SCENE_CAM=[{f:'mix',r:.78,h:.42},{f:'summit',r:.48,h:.2},{f:'center',r:.95,h:.5},{f:'center',r:.7,h:1.25},{f:'village',r:.85,h:.26}];
let focusGoal=new THREE.Vector3();
function sceneFocus(w,i){const s=w.summit,v=w.village,c=i<0?SCENE_CAM[0]:SCENE_CAM[i];
  if(c.f==='summit')return new THREE.Vector3(s[0],s[1]*.75,s[2]);
  if(c.f==='village')return new THREE.Vector3(v[0],v[1]+w.R*.05,v[2]);
  if(c.f==='center')return new THREE.Vector3(0,w.hAt(0,0)*.6,0);
  return new THREE.Vector3(s[0]*.6,s[1]*.55,s[2]*.6);}

// ---------- state machine ----------
let trip=0,sc=-2,scT=0,paused=false,flight=null,shown=null;
// "Huidige reis vasthouden": remembered in this browser
let pinned=false;try{const v=localStorage.getItem('pp-pin'),i=TRIPS.findIndex(t=>t.id===v);if(i>=0&&TRIPS.length>1){pinned=true;trip=i}}catch(e){}
function savePin(i=trip){try{pinned?localStorage.setItem('pp-pin',TRIPS[i].id):localStorage.removeItem('pp-pin')}catch(e){}$('tabs').classList.toggle('pinned',pinned);tabTitles()}
// trip pills: click another trip to fly there, click the current one to hold it (or let go)
function tabTitles(){tabEls.forEach((e,i)=>e.title=i!==trip?`Naar ${TRIPS[i].naam}`:pinned?'Vastgehouden. Klik om weer langs alle reizen te gaan.':'Klik om deze reis vast te houden')}
function showScene(i){controls.returnNow();sceneEls.forEach(e=>e.classList.toggle('on',+e.dataset.s===i));
  segEls.forEach((e,k)=>{e.classList.toggle('on',k===i);e.classList.toggle('done',i>=0&&k<i);if(k>=i)e.querySelector('i').style.width='0'});
  const T=TRIPS[trip];if(i>=0&&T.world){const c=SCENE_CAM[i];orbitGoal.r=c.r*T.world.R*camZoom();orbitGoal.h=c.h*T.world.R*camZoom();focusGoal=sceneFocus(T.world,i)}}
function swapTo(T){if(shown&&shown.group)shown.group.visible=false;shown=T;T.group.visible=true;fillTrip(T);applyTod();if(liveUI)liveUI.setTrip(T.id);
  const w=T.world;scene.fog.near=w.R*1.6;scene.fog.far=w.R*7;stars.scale.setScalar(w.R*10);camera.near=w.R*.002;camera.far=w.R*30;camera.updateProjectionMatrix();
  camCams.forEach(c=>{c.near=w.R*.002;c.far=w.R*30;c.updateProjectionMatrix()});snMat.size=Math.max(4,w.R*.002);}
async function goTrip(n){
  if(flight)return;const idx=(n+TRIPS.length)%TRIPS.length,T=TRIPS[idx];
  $('flyTo').textContent=T.naam;flight={t:0,swapped:false,T,idx};sc=-1;scT=0;showScene(-1);if(pinned)savePin(idx);
  prepare(T,false);
}
// scene pin: click the current scene once more to stay on it (and again to let go); remembered in this browser
let scenePin=null;try{const v=localStorage.getItem('pp-scene-pin');if(v!==null&&+v>=0&&+v<SCENES.length)scenePin=+v}catch(e){}
const firstScene=()=>scenePin===null?0:scenePin;
function saveScenePin(){try{scenePin===null?localStorage.removeItem('pp-scene-pin'):localStorage.setItem('pp-scene-pin',String(scenePin))}catch(e){}
  $('segs').classList.toggle('pinned',scenePin!==null);
  segEls.forEach((e,k)=>e.title=k!==sc?'':scenePin!==null?'Vastgezet. Klik om de rondvlucht te hervatten.':'Klik om deze scène vast te zetten')}
function next(){if(sc<0)return;if(sc<SCENES.length-1){sc++;scT=0;showScene(sc)}else if(pinned||TRIPS.length<2){sc=0;scT=0;showScene(0)}else goTrip(trip+1)}
function prev(){if(sc<=0)return;sc--;scT=0;showScene(sc)}
$('bNext').onclick=next;$('bPrev').onclick=prev;
document.querySelectorAll('[data-seg]').forEach(b=>b.onclick=()=>{if(sc<0||flight)return;const i=+b.dataset.seg;
  if(i===sc)scenePin=scenePin===null?i:null;else{sc=i;scT=0;showScene(sc);if(scenePin!==null)scenePin=i}
  saveScenePin()});
document.querySelectorAll('[data-trip]').forEach(b=>b.onclick=()=>{const i=+b.dataset.trip;if(flight||sc<0)return;if(i===trip){pinned=!pinned;savePin()}else goTrip(i)});
savePin();
const multi=TRIPS.length>1;$('tabs').hidden=!multi;
$('bPause').onclick=e=>{paused=!paused;e.currentTarget.setAttribute('aria-pressed',paused);e.currentTarget.textContent=paused?'Hervat':'Pauzeer'};
document.querySelectorAll('[data-wx]').forEach(b=>b.onclick=()=>{wxMode=b.dataset.wx;document.querySelectorAll('[data-wx]').forEach(x=>x.setAttribute('aria-pressed',x===b));applyTod()});
document.querySelectorAll('[data-tod]').forEach(b=>b.onclick=()=>{todMode=b.dataset.tod;document.querySelectorAll('[data-tod]').forEach(x=>x.setAttribute('aria-pressed',x===b));applyTod()});
let wakeT,menuT;function wake(){document.body.classList.add('awake');clearTimeout(wakeT);wakeT=setTimeout(()=>document.body.classList.remove('awake'),3000)}
addEventListener('pointermove',wake);addEventListener('pointerdown',wake);
const menu=$('menu'),menuBtn=$('menuBtn');
function setMenu(open){menu.hidden=!open;menuBtn.setAttribute('aria-expanded',open);menuBtn.setAttribute('aria-label',open?'Menu sluiten':'Menu openen');document.body.classList.toggle('menuopen',open);clearTimeout(menuT);if(open&&!$('panCtl').hidden)menuT=setTimeout(()=>setMenu(false),30000)}
menuBtn.onclick=()=>setMenu(menu.hidden);
menu.addEventListener('pointerdown',()=>{clearTimeout(menuT);if(!$('panCtl').hidden)menuT=setTimeout(()=>setMenu(false),30000)});
addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&!menuBtn.contains(e.target))setMenu(false)});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!menu.hidden){setMenu(false);menuBtn.focus()}});
// menu tabs
const tabs=[[$('tabCtl'),$('panCtl')],[$('tabSet'),$('panSet')]];
function selTab(i){tabs.forEach(([t,p],k)=>{t.setAttribute('aria-selected',k===i);t.tabIndex=k===i?0:-1;p.hidden=k!==i});clearTimeout(menuT);if(i===0)menuT=setTimeout(()=>setMenu(false),30000)}
tabs.forEach(([t],i)=>{t.onclick=()=>selTab(i);t.onkeydown=e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const j=(i+1)%2;selTab(j);tabs[j][0].focus()}}});
// settings tab
if(ME)renderSettings(ME);
else{
$('sName').value=NAAM;$('sTrips').innerHTML=tripPickerHTML('s',SETTINGS.reizen||[]);wirePicker($('sTrips'));
$('panSet').onsubmit=e=>{e.preventDefault();const reizen=readPicker($('sTrips'));
  if(!reizen.length){$('sErr').textContent='Kies minstens één reis.';return}
  if(reizen.some(r=>!/^\d{4}-\d{2}-\d{2}$/.test(r.aankomst))){$('sErr').textContent='Vul bij elke gekozen reis een aankomstdatum in.';return}
  STORE.set({naam:$('sName').value.trim(),reizen});location.reload()};
$('sReset').onclick=()=>{STORE.clear();location.reload()};
}
menu.addEventListener('input',()=>clearTimeout(menuT));
function fillMapInfo(T){$('mapInfo').textContent=T.mapCreated?`Kaartdata ${T.kort} opgeslagen op ${new Date(T.mapCreated).toLocaleDateString('nl-NL',{day:'numeric',month:'long',year:'numeric'})} · © OpenStreetMap-bijdragers`:'Kaartdata wordt live opgehaald · © OpenStreetMap-bijdragers'}
function lock(){try{navigator.wakeLock&&navigator.wakeLock.request('screen').catch(()=>{})}catch(e){}}lock();document.addEventListener('visibilitychange',()=>{if(!document.hidden)lock()});

// ---------- layout ----------
let S=1,OX=0,OY=0,VW=1,VH=1;
let DW=1920,DH=1080,MOB=false;const camZoom=()=>MOB?.72:1;
function fit(){VW=innerWidth;VH=innerHeight;
  const cs=getComputedStyle($('safeprobe')),it=parseFloat(cs.paddingTop)||0,ir=parseFloat(cs.paddingRight)||0,ib=parseFloat(cs.paddingBottom)||0,il=parseFloat(cs.paddingLeft)||0;
  const AW=Math.max(1,VW-il-ir),AH=Math.max(1,VH-it-ib),asp=AW/AH;
  MOB=asp<1;const compact=!MOB&&AH<560;
  if(MOB){DW=AW<600?480:640;S=AW/DW;DH=AH/S}
  else if(compact){S=AH/720;DH=720;DW=AW/S}
  else if(asp>=16/9){S=AH/1080;DH=1080;DW=AW/S}else{DW=asp>=1.3?1920:1500;S=AW/DW;DH=AH/S}
  document.body.classList.toggle('mob',MOB);document.body.classList.toggle('compact',compact);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,MOB||compact?1.25:1.5));
  OX=il;OY=it;stage.style.width=DW+'px';stage.style.height=DH+'px';stage.style.transform=`translate(${OX}px,${OY}px) scale(${S})`;stage.style.setProperty('--s',S);
  document.body.classList.toggle('narrow',DW<1920);
  renderer.setSize(VW,VH,false);camera.aspect=VW/VH;
  // keep roughly the same sideways view on tall screens
  const hf=2*Math.atan(Math.tan(19*PI/180)*16/9);camera.fov=Math.min(72,Math.max(38,2*Math.atan(Math.tan(hf/2)/camera.aspect)*180/PI));
  if(MOB)camera.setViewOffset(VW,VH,0,VH*.12,VW,VH);else camera.clearViewOffset();camera.updateProjectionMatrix()}
// top bar: never wrap; when it doesn't fit, drop the least important bits one by one (tb1…tb5, see style.css)
const topbar=document.querySelector('.topbar'),TB=5;let tbQueued=false;
function fitTopbar(){tbQueued=false;for(let i=1;i<=TB;i++)topbar.classList.remove('tb'+i);if(MOB)return;
  const over=()=>{const kids=[...topbar.children].flatMap(e=>getComputedStyle(e).display==='contents'?[...e.children]:[e]).filter(e=>!e.hidden&&e.offsetWidth);
    return kids.reduce((w,e)=>w+e.offsetWidth,0)+(kids.length-1)*16>topbar.clientWidth};
  for(let i=1;i<=TB&&over();i++)topbar.classList.add('tb'+i)}
const queueTopbar=()=>{if(!tbQueued){tbQueued=true;requestAnimationFrame(fitTopbar)}};
// names, the weather label and who's online change over time: re-check when the bar's content changes
new MutationObserver(queueTopbar).observe(topbar,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['hidden']});
addEventListener('resize',fit);document.addEventListener('visibilitychange',fit);fit();
addEventListener('resize',queueTopbar);document.fonts&&document.fonts.ready.then(queueTopbar);queueTopbar();

// ---------- start ----------
const liveUI=ME?startLiveUI({apiBase:RT.apiBase,trips:TRIPS.map(t=>({id:t.id,naam:t.kort})),active:null,
  onUnread:(id,n)=>{const i=TRIPS.findIndex(t=>t.id===id),b=i>=0&&tabEls[i].querySelector('.tbadge');if(b){b.hidden=!n;b.textContent=n>9?'9+':String(n);tabEls[i].setAttribute('aria-label',TRIPS[i].kort+(n?`, ${n} ${n===1?'nieuw bericht':'nieuwe berichten'}`:''))}}}):null;
$('chatBtn').hidden=!ME;
showScene(-2);tickClock();setInterval(tickClock,1000);
setInterval(()=>TRIPS.forEach(T=>{if(T.state==='ready')loadWeather(T)}),30*60*1000);
setInterval(()=>TRIPS.forEach(T=>{if(T.state==='ready')loadSnow(T)}),10*60*1000);
setInterval(()=>TRIPS.forEach(T=>{if(T.state==='ready')loadWebcams(T)}),9*60*1000);
(async function boot(){
  const start=trip,T=TRIPS[start];await prepare(T,true);
  if(T.state!=='ready'){setTimeout(boot,61000);return}
  trip=start;swapTo(T);const w=T.world;focusGoal=sceneFocus(w,0);target.copy(focusGoal);orbit.r=orbitGoal.r=SCENE_CAM[0].r*w.R*camZoom();orbit.h=orbitGoal.h=SCENE_CAM[0].h*w.R*camZoom();
  sc=firstScene();scT=0;showScene(sc);saveScenePin();
  for(const o of TRIPS)if(o!==T)await prepare(o,false);  // preload the others one by one
})();

const marker=$('marker'),camEls=[...document.querySelectorAll('.camwin')],v3=new THREE.Vector3(),wolk=$('wolk');
let last=performance.now(),time=0,todT=0,ang=0;
function frame(now){
  requestAnimationFrame(frame);
  const dt=Math.min(.1,(now-last)/1000);last=now;time+=dt;
  if(flight){
    flight.t+=dt/FLIGHT_DUR;
    const a=flight.t<.35?flight.t/.35:flight.t>.55?Math.max(0,1-(flight.t-.55)/.45):1;wolk.style.opacity=reduce?0:a;
    if(!flight.swapped&&flight.t>=.42){
      if(flight.T.state==='ready'){flight.swapped=true;trip=flight.idx;swapTo(flight.T);const w=flight.T.world;focusGoal=sceneFocus(w,0);target.copy(focusGoal);orbit.r=SCENE_CAM[0].r*w.R*camZoom();orbit.h=SCENE_CAM[0].h*w.R*1.8*camZoom();orbitGoal.r=orbit.r;orbitGoal.h=SCENE_CAM[0].h*w.R*camZoom()}
      else{flight.t=.42;if(flight.T.state==='error'){flight=null;wolk.style.opacity=0;sc=firstScene();scT=0;showScene(sc);saveScenePin()}}
    }
    if(flight&&flight.t>=1){flight=null;wolk.style.opacity=0;sc=firstScene();scT=0;showScene(sc);saveScenePin()}
  } else if(!paused&&sc>=0&&scenePin===null&&!controls.holding()){scT+=dt;if(scT>=SCENE_DUR)next()}
  if(sc>=0)segEls[sc].querySelector('i').style.width=(scenePin!==null?100:Math.min(100,scT/SCENE_DUR*100))+'%';
  const T=shown;if(!T||!T.world){return}
  const w=T.world,k=1-Math.exp(-dt*.6);
  orbit.r+=(orbitGoal.r-orbit.r)*k;orbit.h+=(orbitGoal.h-orbit.h)*k;target.lerp(focusGoal,k);
  if(flight&&!flight.swapped)orbit.h+=w.R*.5*dt;
  ang+=dt*(reduce?.006:.035);
  // the tour's camera, unless the user is exploring (controls.ts)
  const cv=flight?(controls.release(),{target,ang,r:orbit.r,h:orbit.h}):controls.update(dt,{target,ang,r:orbit.r,h:orbit.h});
  camera.position.set(cv.target.x+Math.sin(cv.ang)*cv.r,cv.target.y+cv.h,cv.target.z+Math.cos(cv.ang)*cv.r);
  const g=w.hAt(camera.position.x,camera.position.z)+w.R*.03;if(camera.position.y<g)camera.position.y=g;
  camera.lookAt(cv.target);
  todT-=dt;if(todT<=0){applyTod();todT=2}
  // snow follows the camera
  const wn=weatherNow(T),kw=1-Math.exp(-dt*.4);for(const key in wxCur)wxCur[key]+=(wn[key]-wxCur[key])*kw;
  updateClouds(w,dt);
  const want=flight?0:wxCur.snow;snMat.opacity+=(want-snMat.opacity)*k*2;
  rnMat.opacity=flight?0:wxCur.rain*.55;
  if(RN&&rnMat.opacity>.01){const box=w.R*.3;rain.position.copy(camera.position).add(new THREE.Vector3(0,-box*.5,0));rain.scale.setScalar(box);
    const a=rnGeo.attributes.position.array;for(let i=0;i<RN;i++){const d=rnSpd[i]*dt*1.2;a[i*6+1]-=d;a[i*6+4]-=d;if(a[i*6+4]<0){a[i*6+1]+=1;a[i*6+4]+=1}}rnGeo.attributes.position.needsUpdate=true}
  if(wxCur.bolt>.5&&!reduce&&Math.random()<dt*.12)flash=1;
  if(flash>0){flash=Math.max(0,flash-dt*3.5);hemi.intensity=hemiBase+flash*1.6;wolk.style.opacity=flight?wolk.style.opacity:flash*.35}
  if(SN&&snMat.opacity>.01){const box=w.R*.35;snow.position.copy(camera.position).add(new THREE.Vector3(0,-box*.5,0));snow.scale.setScalar(box);
    const a=snGeo.attributes.position.array;for(let i=0;i<SN;i++){a[i*3+1]-=snSpd[i]*dt*.12;a[i*3]+=Math.sin(time*.5+i)*dt*.01;if(a[i*3+1]<0)a[i*3+1]+=1}snGeo.attributes.position.needsUpdate=true}
  T.fzMat.opacity+=((sc===4&&T.wx?.32:0)-T.fzMat.opacity)*k*1.5;T.fz.visible=T.fzMat.opacity>.005;
  const pulse=sc===3?1.2+.3*Math.sin(time*2.4):1;for(const m of Object.values(pisteMats))m.color.copy(m.userData.base).multiplyScalar(pulse);
  if(T.lightMat)T.lightMat.opacity=lights;
  stars.position.copy(camera.position);
  renderer.setScissorTest(false);renderer.setViewport(0,0,VW,VH);renderer.render(scene,camera);
  if(sc===2&&!$('camcol').hidden&&sceneEls.find(e=>+e.dataset.s===2).classList.contains('on')){renderer.setScissorTest(true);
    camEls.forEach((el,i)=>{const r=el.getBoundingClientRect();if(r.width<4)return;const y=VH-r.bottom;renderer.setViewport(r.left,y,r.width,r.height);renderer.setScissor(r.left,y,r.width,r.height);
      camCams[i].aspect=r.width/r.height;camCams[i].updateProjectionMatrix();renderer.render(scene,camCams[i])});renderer.setScissorTest(false)}
  const s=w.summit;v3.set(s[0],s[1]+w.R*.01,s[2]).project(camera);
  const mx=((v3.x+1)/2*VW-OX)/S,my=((1-v3.y)/2*VH-OY)/S,vis=v3.z<1&&!flight&&sc!==2&&sc!==3&&(MOB?mx>150&&mx<DW-150&&my>(TRIPS.length>1?190:130)&&my<DH*.42:mx>200&&mx<DW-220&&my>180&&my<DH-200);
  marker.style.left=mx+'px';marker.style.top=my+'px';marker.style.opacity=vis?1:0;
}
requestAnimationFrame(frame);
}
