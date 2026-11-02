// @ts-nocheck: ported as-is from the single-file build; typed step by step later
// Terrain core: no DOM or three.js here, so it also runs in Node (tools/add-area.ts).
const PI=Math.PI;
function lon2tx(lon,z){return (lon+180)/360*Math.pow(2,z)}
function lat2ty(lat,z){const r=lat*PI/180;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/PI)/2*Math.pow(2,z)}
function tileRange(bbox,z){const [w,s,e,n]=bbox;return {x0:Math.floor(lon2tx(w,z)),x1:Math.floor(lon2tx(e,z)),y0:Math.floor(lat2ty(n,z)),y1:Math.floor(lat2ty(s,z)),z}}
function hash2(a,b){let h=Math.imul(a|0,374761393)^Math.imul(b|0,668265263)^0x5bd1e995;h=Math.imul(h^(h>>>13),1274126177);h^=h>>>16;return (h>>>0)/4294967296}
function vnoise(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;const a=hash2(ix,iy),b=hash2(ix+1,iy),c=hash2(ix,iy+1),d=hash2(ix+1,iy+1);const ux=fx*fx*(3-2*fx),uy=fy*fy*(3-2*fy);return a+(b-a)*ux+(c-a)*uy+(a-b-c+d)*ux*uy}
function fbm(x,y){let s=0,a=.5,f=1;for(let i=0;i<4;i++){s+=a*vnoise(x*f,y*f);a*=.5;f*=2.03}return s/.9375}

// Elevation sampler from decoded terrarium tiles: tiles = [{x,y,data(RGBA 256x256)}]
function makeDem(tiles,range){
  const nx=range.x1-range.x0+1, ny=range.y1-range.y0+1, W=nx*256, H=ny*256, arr=new Float32Array(W*H);
  for(const t of tiles){const ox=(t.x-range.x0)*256, oy=(t.y-range.y0)*256, d=t.data;
    for(let j=0;j<256;j++)for(let i=0;i<256;i++){const k=(j*256+i)*4;arr[(oy+j)*W+ox+i]=d[k]*256+d[k+1]+d[k+2]/256-32768}}
  return function(lon,lat){
    let px=(lon2tx(lon,range.z)-range.x0)*256-.5, py=(lat2ty(lat,range.z)-range.y0)*256-.5;
    px=Math.max(0,Math.min(W-1.001,px));py=Math.max(0,Math.min(H-1.001,py));
    const i=Math.floor(px),j=Math.floor(py),fx=px-i,fy=py-j,a=arr[j*W+i],b=arr[j*W+i+1],c=arr[(j+1)*W+i],d=arr[(j+1)*W+i+1];
    return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
  };
}

// Overpass "out geom" JSON → compact lists (lon/lat arrays)
const LIFTS=new Set(['cable_car','gondola','mixed_lift','chair_lift','drag_lift','t-bar','j-bar','platter','rope_tow','magic_carpet','funicular']);
function parseOsm(json){
  const out={pistes:[],lifts:[],buildings:[]};
  for(const el of (json.elements||[])){
    const t=el.tags||{};
    if(el.type!=='way'||!el.geometry)continue;
    const g=el.geometry.map(p=>[+p.lon.toFixed(6),+p.lat.toFixed(6)]);
    const closed=g.length>3&&g[0][0]===g[g.length-1][0]&&g[0][1]===g[g.length-1][1];
    if(t['piste:type']==='downhill'){ if(t.area==='yes'||(closed&&t.area!=='no'))continue; out.pistes.push({g,diff:t['piste:difficulty']||''}); }
    else if(t.aerialway&&LIFTS.has(t.aerialway)) out.lifts.push({g,type:t.aerialway,name:t.name||''});
    else if(t.building&&closed) out.buildings.push({g,levels:parseFloat(t['building:levels'])||0});
  }
  return out;
}
function pisteClass(d){if(d==='novice'||d==='easy')return 'b';if(d==='intermediate')return 'r';if(d==='advanced'||d==='expert')return 'z';if(d==='freeride'||d==='extreme')return 's';return 'b'}

function pushTri(P,C,a,b,c,col){P.push(a[0],a[1],a[2],b[0],b[1],b[2],c[0],c[1],c[2]);if(C)for(let i=0;i<3;i++)C.push(col[0],col[1],col[2])}
function boxBetween(P,p0,p1,t){ // square beam from p0 to p1, thickness t
  const d=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]],L=Math.hypot(d[0],d[1],d[2])||1;d[0]/=L;d[1]/=L;d[2]/=L;
  let u=Math.abs(d[1])<.9?[0,1,0]:[1,0,0];
  let v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]];let lv=Math.hypot(...v);v=v.map(x=>x/lv*t/2);
  u=[d[1]*v[2]-d[2]*v[1],d[2]*v[0]-d[0]*v[2],d[0]*v[1]-d[1]*v[0]];let lu=Math.hypot(...u);u=u.map(x=>x/lu*t/2);
  const c=(p,su,sv)=>[p[0]+u[0]*su+v[0]*sv,p[1]+u[1]*su+v[1]*sv,p[2]+u[2]*su+v[2]*sv];
  const A=[c(p0,-1,-1),c(p0,1,-1),c(p0,1,1),c(p0,-1,1)],B=[c(p1,-1,-1),c(p1,1,-1),c(p1,1,1),c(p1,-1,1)];
  for(let i=0;i<4;i++){const j=(i+1)%4;pushTri(P,null,A[i],B[i],B[j]);pushTri(P,null,A[i],B[j],A[j])}
  pushTri(P,null,A[0],A[2],A[1]);pushTri(P,null,A[0],A[3],A[2]);pushTri(P,null,B[0],B[1],B[2]);pushTri(P,null,B[0],B[2],B[3]);
}

// The diorama for one trip: terrain, forest, pistes, lifts.
// opts.lineRaster(lines,cw,ch,widths) -> Uint8Array (1 = cleared for piste/lift); optional
function buildWorld(trip,elev,osm,opts){
  const EX=opts.exaggeration, [w,s,e,n]=trip.bbox, lat0=(s+n)/2, lon0=(w+e)/2;
  const kx=111320*Math.cos(lat0*PI/180), kz=110574;
  const Wm=(e-w)*kx, Dm=(n-s)*kz, cols=opts.cols||Math.max(40,Math.round(Wm/(opts.cell||95))), rows=Math.max(8,Math.round(cols*Dm/Wm));
  const proj=(lon,lat)=>[(lon-lon0)*kx,-(lat-lat0)*kz];
  const unproj=(x,z)=>[lon0+x/kx,lat0-z/kz];
  const G=new Float32Array((cols+1)*(rows+1));let mn=1e9;
  for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const h=elev(w+(e-w)*c/cols,n-(n-s)*r/rows);G[r*(cols+1)+c]=h;if(h<mn)mn=h}
  const base=mn-40, Y=h=>(h-base)*EX, alt=y=>y/EX+base;
  const gy=(c,r)=>Y(G[r*(cols+1)+c]);
  const cx=c=>-Wm/2+Wm*c/cols, cz=r=>-Dm/2+Dm*r/rows;
  function hAt(x,z){ // exact on the triangulated surface
    let fc=(x+Wm/2)/Wm*cols, fr=(z+Dm/2)/Dm*rows;fc=Math.max(0,Math.min(cols-1e-6,fc));fr=Math.max(0,Math.min(rows-1e-6,fr));
    const c=Math.floor(fc),r=Math.floor(fr),fx=fc-c,fy=fr-r,a=gy(c,r),b=gy(c+1,r),cc=gy(c,r+1),d=gy(c+1,r+1);
    return fx+fy<=1?a+(b-a)*fx+(cc-a)*fy:d+(cc-d)*(1-fx)+(b-d)*(1-fy);
  }
  const slopeAt=(x,z)=>{const d=12,gx=(hAt(x+d,z)-hAt(x-d,z))/(2*d)/EX,gz=(hAt(x,z+d)-hAt(x,z-d))/(2*d)/EX;return Math.atan(Math.hypot(gx,gz))*180/PI};
  const inside=(x,z)=>x>-Wm/2&&x<Wm/2&&z>-Dm/2&&z<Dm/2;

  // where pistes and lifts cut through the forest (10 m cells)
  const cw=Math.ceil(Wm/10),ch=Math.ceil(Dm/10);let clearMask=null;
  if(opts.lineRaster){const toC=([lo,la])=>{const [x,z]=proj(lo,la);return [(x+Wm/2)/10,(z+Dm/2)/10]};
    clearMask=opts.lineRaster([...osm.pistes.map(p=>({pts:p.g.map(toC),w:4})),...osm.lifts.map(l=>({pts:l.g.map(toC),w:3}))],cw,ch)}
  const cleared=(x,z)=>{if(!clearMask)return false;const a=Math.floor((x+Wm/2)/10),b=Math.floor((z+Dm/2)/10);return a>=0&&b>=0&&a<cw&&b<ch&&clearMask[b*cw+a]===1};
  const treeline=opts.treeline||1700;
  const forestAt=(x,z)=>{const a=alt(hAt(x,z)),sl=slopeAt(x,z),nz=fbm(x/700+3.1,z/700+7.7);
    return a<treeline+(nz-.5)*300&&sl>7&&sl<44&&nz>.47};
  // forest decided once per terrain cell (fast), piste/lift clearings checked per spot
  const F=new Uint8Array(cols*rows);for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)F[r*cols+c]=forestAt(-Wm/2+Wm*(c+.5)/cols,-Dm/2+Dm*(r+.5)/rows)?1:0;
  const forestCell=(x,z)=>{const c=Math.min(cols-1,Math.max(0,Math.floor((x+Wm/2)/Wm*cols))),r=Math.min(rows-1,Math.max(0,Math.floor((z+Dm/2)/Dm*rows)));return F[r*cols+c]===1};

  // terrain
  const P=[],C=[];
  const snow=[.93,.95,.98],rock=[.47,.45,.43],fground=[.84,.87,.89];
  function faceColor(A,B,Cc){
    const ux=B[0]-A[0],uy=B[1]-A[1],uz=B[2]-A[2],vx=Cc[0]-A[0],vy=Cc[1]-A[1],vz=Cc[2]-A[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const ang=Math.atan(Math.hypot(nx,nz)/((Math.abs(ny)||1e-6)*EX))*180/PI;
    const mx=(A[0]+B[0]+Cc[0])/3,mz=(A[2]+B[2]+Cc[2])/3;let col=forestCell(mx,mz)&&!cleared(mx,mz)?fground:snow;
    if(ang>37){const k=Math.min(1,(ang-37)/8);col=col.map((v,i)=>v*(1-k)+rock[i]*k)}
    const j=.975+.04*hash2(Math.round(A[0]+B[0]),Math.round(A[2]+Cc[2]));
    return col.map(v=>Math.min(1,v*j));
  }
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    const a=[cx(c),gy(c,r),cz(r)],b=[cx(c+1),gy(c+1,r),cz(r)],cc=[cx(c),gy(c,r+1),cz(r+1)],d=[cx(c+1),gy(c+1,r+1),cz(r+1)];
    pushTri(P,C,a,cc,b,faceColor(a,cc,b));pushTri(P,C,b,cc,d,faceColor(b,cc,d));
  }
  // diorama sides
  const bottom=-Math.max(Wm,Dm)*.03, side1=[.29,.23,.2],side2=[.22,.17,.15];
  function wall(p,q,k){const pb=[p[0],bottom,p[2]],qb=[q[0],bottom,q[2]];const col=k%2?side1:side2;pushTri(P,C,p,pb,q,col);pushTri(P,C,q,pb,qb,col)}
  for(let c=0;c<cols;c++){wall([cx(c+1),gy(c+1,0),cz(0)],[cx(c),gy(c,0),cz(0)],c);wall([cx(c),gy(c,rows),cz(rows)],[cx(c+1),gy(c+1,rows),cz(rows)],c)}
  for(let r=0;r<rows;r++){wall([cx(0),gy(0,r),cz(r)],[cx(0),gy(0,r+1),cz(r+1)],r);wall([cx(cols),gy(cols,r+1),cz(r+1)],[cx(cols),gy(cols,r),cz(r)],r)}

  // trees on a jittered grid
  const trees=[],step=Math.max(opts.treeStep||24,Math.sqrt(Wm*Dm/170000));
  for(let z=-Dm/2+step/2;z<Dm/2;z+=step)for(let x=-Wm/2+step/2;x<Wm/2;x+=step){
    const jx=x+(hash2(x|0,z|0)-.5)*step*.9,jz=z+(hash2(z|0,x|0)-.5)*step*.9;
    if(forestCell(jx,jz)&&!cleared(jx,jz))trees.push(jx,hAt(jx,jz),jz,hash2(jx|0,7));
  }

  // pistes as draped ribbons
  const ribbons={b:[],r:[],z:[],s:[]},km={b:0,r:0,z:0,s:0};
  const runs=[]; // whole pistes inside the map, as paths over the snow (for the ski race)
  const lift=Math.max(2.5,Wm/3000);
  for(const p of osm.pistes){
    const k=pisteClass(p.diff);const pts=p.g.map(([lo,la])=>proj(lo,la));
    const dense=[];for(let i=0;i<pts.length-1;i++){const [x0,z0]=pts[i],[x1,z1]=pts[i+1],L=Math.hypot(x1-x0,z1-z0),m=Math.max(1,Math.ceil(L/12));if(inside(x0,z0))km[k]+=L/1000;
      for(let j=0;j<m;j++)dense.push([x0+(x1-x0)*j/m,z0+(z1-z0)*j/m])}
    if(pts.length)dense.push(pts[pts.length-1]);
    if(dense.length>1&&dense.every(([x,z])=>inside(x,z)))runs.push({k,pts:dense.map(([x,z])=>[x,hAt(x,z)+lift,z])});
    const half=k==='s'?7:11, R=ribbons[k];let prevL=null,prevR=null;
    for(let i=0;i<dense.length;i++){
      const [x,z]=dense[i];if(!inside(x,z)){prevL=prevR=null;continue}
      const a=dense[Math.max(0,i-1)],b=dense[Math.min(dense.length-1,i+1)];let dx=b[0]-a[0],dz=b[1]-a[1];const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
      const L=[x-dz*half,0,z+dx*half],Rr=[x+dz*half,0,z-dx*half];L[1]=hAt(L[0],L[2])+lift;Rr[1]=hAt(Rr[0],Rr[2])+lift;
      if(prevL){pushTri(R,null,prevL,L,prevR);pushTri(R,null,prevR,L,Rr)}prevL=L;prevR=Rr;
    }
  }
  // lifts: cables, pylons, stations
  const cable=[],pylon=[],station=[],bottoms=[];let liftCount=0,summit=null,summitName='';
  for(const L of osm.lifts){
    const pts=L.g.map(([lo,la])=>proj(lo,la)).filter(([x,z])=>inside(x,z));if(pts.length<2)continue;liftCount++;
    const drag=/bar|platter|rope|carpet|drag/.test(L.type), up=drag?5:16;
    const nodes=[];
    for(let i=0;i<pts.length;i++){nodes.push([pts[i][0],pts[i][1],(i===0||i===pts.length-1)?'st':'py']);
      if(i<pts.length-1&&!drag){const [x0,z0]=pts[i],[x1,z1]=pts[i+1],Ls=Math.hypot(x1-x0,z1-z0),m=Math.floor(Ls/200);for(let j=1;j<=m;j++)nodes.push([x0+(x1-x0)*j/(m+1),z0+(z1-z0)*j/(m+1),'py'])}}
    const P3=nodes.map(([x,z,t])=>[x,hAt(x,z)+(t==='st'?(drag?3:8):up),z,t]);
    for(let i=0;i<P3.length-1;i++)boxBetween(cable,P3[i],P3[i+1],drag?1.4:2.2);
    for(const q of P3){const g=hAt(q[0],q[2]);
      if(q[3]==='py')boxBetween(pylon,[q[0],g-2,q[2]],[q[0],q[1]+1,q[2]],drag?1.8:3);
      else boxBetween(station,[q[0],g-2,q[2]],[q[0],g+(drag?5:12),q[2]],drag?7:18);}
    const ends=[P3[0],P3[P3.length-1]].map(q=>[q[0],hAt(q[0],q[2]),q[2]]).sort((a,b)=>a[1]-b[1]);
    if(!drag)bottoms.push(ends[0]);
    if(!summit||ends[1][1]>summit[1]){summit=ends[1];summitName=L.name}
  }
  if(!summit){let hi=-1e9;for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const y=gy(c,r);if(y>hi){hi=y;summit=[cx(c),y,cz(r)]}}}
  // village: around the lowest valley stations
  let village;
  if(bottoms.length){ // the main valley hub: the low station with the most other valley stations within 1.5 km
    bottoms.sort((a,b)=>a[1]-b[1]);const low=bottoms.slice(0,Math.max(1,Math.ceil(bottoms.length*.5)));
    const near=(p,q)=>Math.hypot(p[0]-q[0],p[2]-q[2])<1500;let best=low[0],bc=-1;
    for(const p of low){const c=bottoms.filter(q=>near(p,q)).length;if(c>bc){bc=c;best=p}}
    const grp=bottoms.filter(q=>near(best,q));village=[grp.reduce((s,p)=>s+p[0],0)/grp.length,0,grp.reduce((s,p)=>s+p[2],0)/grp.length];}
  else{let lo=1e9;village=[0,0,0];for(let r=0;r<=rows;r+=4)for(let c=0;c<=cols;c+=4){const y=gy(c,r);if(y<lo){lo=y;village=[cx(c),y,cz(r)]}}}
  village[1]=hAt(village[0],village[2]);
  return {P,C,trees,treeStep:step,ribbons,runs,cable,pylon,station,km,liftCount,summit,summitName,village,hAt,Y,alt,proj,unproj,inside,Wm,Dm,R:Math.max(Wm,Dm)/2,bottom,
          topAlt:Math.round(alt(summit[1])),dalAlt:Math.round(alt(village[1]))};
}

// Buildings → oriented boxes on the terrain (added later, when they arrive)
function buildHouses(world,buildings,max){
  const houses=[],{proj,hAt,inside}=world;
  for(const b of buildings.slice(0,max||6000)){
    const pts=b.g.map(([lo,la])=>proj(lo,la));let mx=0,mz=0;for(const p of pts){mx+=p[0];mz+=p[1]}mx/=pts.length;mz/=pts.length;
    if(!inside(mx,mz))continue;
    let best=0,ang=0;for(let i=0;i<pts.length-1;i++){const dx=pts[i+1][0]-pts[i][0],dz=pts[i+1][1]-pts[i][1],l=dx*dx+dz*dz;if(l>best){best=l;ang=Math.atan2(dz,dx)}}
    const ca=Math.cos(ang),sa=Math.sin(ang);let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;
    for(const p of pts){const u=(p[0]-mx)*ca+(p[1]-mz)*sa,v=-(p[0]-mx)*sa+(p[1]-mz)*ca;a0=Math.min(a0,u);a1=Math.max(a1,u);b0=Math.min(b0,v);b1=Math.max(b1,v)}
    const len=Math.max(4,a1-a0),wid=Math.max(4,b1-b0);if(len>160||wid>160)continue;
    const x=mx+((a0+a1)/2)*ca-((b0+b1)/2)*sa, z=mz+((a0+a1)/2)*sa+((b0+b1)/2)*ca;
    let gmin=1e9;for(const p of pts)gmin=Math.min(gmin,hAt(p[0],p[1]));
    houses.push({x,z,y:gmin,len,wid,hgt:(b.levels?b.levels*3:7)*1.1,ang,k:hash2(Math.round(x),Math.round(z))});
  }
  return houses;
}
// Stored map data (areas/<id>/map.json): decode into the same shapes the live loaders produce
const CLS2DIFF={b:'easy',r:'intermediate',z:'advanced',s:'freeride'};
function decodeLine(a){const out=[];let x=0,y=0;for(let i=0;i<a.length;i+=2){x+=a[i];y+=a[i+1];out.push([x/1e5,y/1e5])}return out}
function demFromGrid(bbox,dem,atob){
  const bin=atob(dem.b64),u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const g=new Int16Array(u8.buffer),nx=dem.nx,ny=dem.ny,[w,s,e,n]=bbox;
  return (lon,lat)=>{let px=(lon-w)/(e-w)*(nx-1),py=(n-lat)/(n-s)*(ny-1);px=Math.max(0,Math.min(nx-1.001,px));py=Math.max(0,Math.min(ny-1.001,py));
    const i=Math.floor(px),j=Math.floor(py),fx=px-i,fy=py-j,a=g[j*nx+i],b=g[j*nx+i+1],c=g[(j+1)*nx+i],d=g[(j+1)*nx+i+1];return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy};
}
function osmFromStore(a){return {pistes:a.pistes.map(([k,e])=>({g:decodeLine(e),diff:CLS2DIFF[k]||''})),lifts:a.lifts.map(([type,name,e])=>({g:decodeLine(e),type,name})),buildings:[]}}
function housesFromStore(world,boxes,max){
  const out=[],{proj,hAt,inside}=world;
  for(const [lo,la,l10,w10,a1000,levels] of boxes.slice(0,max||10000)){
    const [x,z]=proj(lo/1e5,la/1e5);if(!inside(x,z))continue;const len=l10/10,wid=w10/10,ang=a1000/1000,ca=Math.cos(ang),sa=Math.sin(ang);
    let gmin=hAt(x,z);for(const [u,v] of [[1,1],[1,-1],[-1,1],[-1,-1]])gmin=Math.min(gmin,hAt(x+(u*len/2)*ca-(v*wid/2)*sa,z+(u*len/2)*sa+(v*wid/2)*ca));
    out.push({x,z,y:gmin,len,wid,hgt:(levels?levels*3:7)*1.1,ang,k:hash2(Math.round(x),Math.round(z))});
  }
  return out;
}

export {PI,lon2tx,lat2ty,tileRange,hash2,vnoise,fbm,makeDem,LIFTS,parseOsm,pisteClass,buildWorld,buildHouses,CLS2DIFF,decodeLine,demFromGrid,osmFromStore,housesFromStore};
