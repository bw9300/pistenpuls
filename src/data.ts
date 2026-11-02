// @ts-nocheck: ported as-is from the single-file build; typed step by step later
// Data sources: terrain tiles, OpenStreetMap, weather, measured snow, webcams. Returns data; the app decides what to show.
import {CONFIG} from './config';
import {tileRange,makeDem,parseOsm} from './terrain';

// ---------- map data (live, for areas without stored map data) ----------
function loadImage(url){return new Promise((res,rej)=>{const im=new Image();im.crossOrigin='anonymous';im.onload=()=>res(im);im.onerror=()=>rej(new Error('tile '+url));im.src=url})}
async function loadTerrain(trip){
  const r=tileRange(trip.bbox,CONFIG.terrainZoom),tiles=[],cv=document.createElement('canvas');cv.width=cv.height=256;const cx=cv.getContext('2d',{willReadFrequently:true});
  const jobs=[];for(let x=r.x0;x<=r.x1;x++)for(let y=r.y0;y<=r.y1;y++)jobs.push({x,y});
  await Promise.all(jobs.map(async j=>{let im=null,err;for(const u of CONFIG.terrainUrls){try{im=await loadImage(u.replace('{z}',r.z).replace('{x}',j.x).replace('{y}',j.y));break}catch(e){err=e}}
    if(!im)throw err;j.im=im}));
  for(const j of jobs){cx.clearRect(0,0,256,256);cx.drawImage(j.im,0,0);tiles.push({x:j.x,y:j.y,data:cx.getImageData(0,0,256,256).data})}
  return makeDem(tiles,r);
}
// small IndexedDB cache so the map data is only fetched once (kept 30 days)
const idb=(()=>{let p=null;const open=()=>p||(p=new Promise((res,rej)=>{try{const r=indexedDB.open('pistenpuls',1);r.onupgradeneeded=()=>r.result.createObjectStore('kv');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}}));
  return {async get(k){try{const db=await open();return await new Promise(r=>{const q=db.transaction('kv').objectStore('kv').get(k);q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)})}catch(e){return null}},
          async set(k,v){try{const db=await open();db.transaction('kv','readwrite').objectStore('kv').put(v,k)}catch(e){}}}})();
// what: 'ski' (pistes + lifts) or 'dorp' (buildings)
async function loadOsm(trip,what){
  const [w,s,e,n]=trip.bbox,bb=`${s},${w},${n},${e}`,key=`osm-${what}-${trip.bbox.join(',')}`;
  const hit=await idb.get(key);if(hit&&Date.now()-hit.t<30*864e5)return hit.d;
  const q=what==='ski'?`[out:json][timeout:120];(way["piste:type"="downhill"](${bb});way["aerialway"](${bb}););out geom;`
                      :`[out:json][timeout:180];way["building"](${bb});out geom;`;
  let last;
  for(let round=0;round<2;round++)for(const u of CONFIG.overpassUrls){
    const ac=new AbortController(),to=setTimeout(()=>ac.abort(),what==='ski'?130000:190000);
    try{const r=await fetch(u,{method:'POST',body:'data='+encodeURIComponent(q),headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:ac.signal});
      if(!r.ok)throw new Error('Overpass '+r.status);const d=parseOsm(await r.json());clearTimeout(to);idb.set(key,{t:Date.now(),d});return d}
    catch(err){clearTimeout(to);last=err;console.warn('Overpass',u,err.message)}
  }
  if(hit)return hit.d;throw last;
}
function lineRaster(lines,cw,ch){
  const cv=document.createElement('canvas');cv.width=cw;cv.height=ch;const g=cv.getContext('2d',{willReadFrequently:true});
  g.strokeStyle='#fff';g.lineCap='round';g.lineJoin='round';
  for(const l of lines){g.lineWidth=l.w;g.beginPath();l.pts.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke()}
  const d=g.getImageData(0,0,cw,ch).data,m=new Uint8Array(cw*ch);for(let i=0;i<m.length;i++)m[i]=d[i*4+3]>40?1:0;return m;
}

// ---------- weather (Open-Meteo) ----------
const WX={0:'Helder',1:'Overwegend helder',2:'Half bewolkt',3:'Bewolkt',45:'Mist',48:'Rijpmist',51:'Lichte motregen',53:'Motregen',55:'Dichte motregen',56:'IJzel',57:'IJzel',61:'Lichte regen',63:'Regen',65:'Zware regen',66:'IJzel',67:'IJzel',71:'Lichte sneeuwval',73:'Sneeuwval',75:'Zware sneeuwval',77:'Sneeuwkorrels',80:'Regenbuien',81:'Regenbuien',82:'Zware buien',85:'Sneeuwbuien',86:'Zware sneeuwbuien',95:'Onweer',96:'Onweer met hagel',99:'Onweer met hagel'};
async function meteo(lon,lat,elevation){
  const u=`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&elevation=${Math.round(elevation)}&hourly=temperature_2m,weather_code,wind_speed_10m,cloud_cover,visibility,freezing_level_height&daily=sunset&past_days=1&forecast_days=2&timezone=GMT`;
  const r=await fetch(u);if(!r.ok)throw new Error('Open-Meteo '+r.status);const j=await r.json();
  const key=new Date().toISOString().slice(0,13)+':00';let i=j.hourly.time.indexOf(key);if(i<0)i=j.hourly.time.length-25;
  return {temp:j.hourly.temperature_2m[i],code:j.hourly.weather_code[i],wind:j.hourly.wind_speed_10m[i],cloud:j.hourly.cloud_cover[i],vis:j.hourly.visibility[i],grens:j.hourly.freezing_level_height[i],sunset:j.daily.sunset[1]||j.daily.sunset[0]};
}

// ---------- measured snow (avalanche warning service stations, avalanche.report) ----------
let stationsCache=null;
async function stations(){
  if(stationsCache&&Date.now()-stationsCache.t<9*60000)return stationsCache.f;
  const r=await fetch('https://static.avalanche.report/weather_stations/stations.geojson');if(!r.ok)throw new Error('meetstations '+r.status);
  const j=await r.json();stationsCache={t:Date.now(),f:j.features};return j.features;
}
async function fetchWeather(w){
  const [tl,ta]=w.unproj(w.summit[0],w.summit[2]),[vl,va]=w.unproj(w.village[0],w.village[2]);
  const [top,dal]=await Promise.all([meteo(tl,ta,w.topAlt),meteo(vl,va,w.dalAlt)]);return {top,dal,at:new Date()};
}
async function fetchSnow(T){
  const all=await stations(),[w,s,e,n]=T.bbox,mx=.12,my=.06;
  const near=all.filter(f=>{const [x,y]=f.geometry.coordinates;return x>w-mx&&x<e+mx&&y>s-my&&y<n+my&&typeof f.properties.HS==='number'});
  const pick=(name,fn)=>near.find(f=>f.properties.name===name)||all.find(f=>f.properties.name===name&&typeof f.properties.HS==='number')||fn();
  const byAlt=near.slice().sort((a,b)=>b.geometry.coordinates[2]-a.geometry.coordinates[2]);
  const ms=T.meetstations||{};
  const f2=f=>f&&{name:f.properties.name,alt:f.geometry.coordinates[2],hs:f.properties.HS,hsd24:f.properties.HSD24,lt:f.properties.LT,wg:f.properties.WG,date:new Date(f.properties.date)};
  return {berg:f2(pick(ms.berg,()=>byAlt[0])),dal:f2(pick(ms.dal,()=>byAlt[byAlt.length-1]))};
}

// ---------- webcams (Windy Webcams API, via our own /api/webcams so the key stays on the server) ----------
async function fetchWebcams(w,apiBase){
  const [lon,lat]=w.unproj(w.village[0],w.village[2]),radius=Math.min(30,Math.round(w.R/1000*1.3));
  const r=await fetch(`${apiBase}/api/webcams?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&radius=${radius}`);if(!r.ok)throw new Error('webcams '+r.status);
  const j=await r.json();
  const cams=(j.webcams||[]).filter(c=>c.images&&c.images.current&&c.images.current.preview&&c.status!=='inactive').map(c=>{
    const [x,z]=w.proj(c.location.longitude,c.location.latitude);
    return {id:c.webcamId,title:c.title,img:c.images.current.preview,url:(c.urls&&c.urls.detail)||('https://www.windy.com/webcams/'+c.webcamId),
            t:c.lastUpdatedOn?new Date(c.lastUpdatedOn):null,alt:w.inside(x,z)?w.alt(w.hAt(x,z)):0}});
  // short names, no duplicates, only cams inside the area; then a mix of mountain and village
  const clean=t=>{let x=t.replace(/[‎‏]/g,'');if(x.includes(': '))x=x.slice(x.indexOf(': ')+2);const parts=x.split(' - ');x=parts.pop();if(parts.length&&/^(Bergstation|Talstation|Mittelstation|Berg|Tal|Ort|Panorama)$/i.test(x.trim()))x=parts.pop()+' · '+x;return x.replace(/\s+/g,' ').replace(/,\s*·/,' ·').trim()};
  const seen=new Set(),list=[];
  for(const c of cams){c.title=clean(c.title);if(!c.alt||seen.has(c.title))continue;seen.add(c.title);list.push(c)}
  list.sort((a,b)=>b.alt-a.alt);
  return list.length<=4?list:[list[0],list[1],list[Math.floor(list.length/2)],list[list.length-1]];
}

// stored map data per area (areas/<id>/map.json)
async function fetchMap(url){const r=await fetch(url);if(!r.ok)throw new Error('kaartdata '+r.status);return r.json()}

export {loadTerrain,idb,loadOsm,lineRaster,WX,fetchWeather,fetchSnow,fetchWebcams,fetchMap};
