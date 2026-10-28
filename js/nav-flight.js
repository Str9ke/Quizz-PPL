/* === nav-flight.js === Navigation EN VOL (onglet « En vol » + carte de route de navlog.html)
   - Position GPS sur la carte (avion orienté, trace, vecteur 5 min), cap/route, vitesse sol, altitude,
     prochaine balise (distance, temps, heure estimée), écart de route + cap pour rejoindre.
   - Alertes d'espaces aériens : horizontales ET verticales (« CTR Charleroi dans 3 min, 1 500 ft
     au-dessus de toi », « tu vas entrer dans… »), avec la fréquence AIP, à voix haute si voulu.
   - « Terrain le plus proche » : 5 aérodromes (cap magnétique, distance, piste, fréquence), Direct.
   - Cercle de plané (altitude, finesse, vitesse de plané, vent) ; terrains atteignables en vert ;
     aussi en promenant la souris / le doigt sur le tracé ou le profil (bouton « 🪂 Plané »).
   - Log de navigation en direct : décollage, heure réelle à chaque point (bouton ou automatique),
     estimées recalculées, carburant restant ; minuteur de changement de réservoir.
   - Enregistrement de la trace (IndexedDB), export GPX/KML, rejeu sur la carte.
   Fonctionne hors ligne (données OpenAIP et aérodromes embarquées). */
(function(){
'use strict';
var NLX=window.NLX=window.NLX||{};
var NM_FT=6076.12, KT_MS=0.514444;
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function lsGet(k,d){ try{ var v=JSON.parse(localStorage.getItem(k)||'null'); return v==null?d:v; }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function hm(t){ if(t==null||isNaN(t)) return '—'; var d=new Date(t); return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }
function mmss(ms){ if(ms==null||!isFinite(ms)) return '—'; var s=Math.max(0,Math.round(ms/1000)), m=Math.floor(s/60); return m>=60?Math.floor(m/60)+'h'+('0'+m%60).slice(-2):m+' min'; }
function n360(x){ x=Math.round(x)%360; if(x<=0) x+=360; return ('00'+x).slice(-3)+'°'; }
function dev(){ return NL.getConfig().dev||0; }      /* Rm = Rv + dev (convention du Navlog) */
function mag(t){ return (t+dev()+360)%360; }
function opts(){ return lsGet('nlxFlightOpts',{voice:true,look:5,margin:500,vg:null,follow:true}); }
function setOpt(k,v){ var o=opts(); o[k]=v; lsSet('nlxFlightOpts',o); }

/* ---------- CSS ---------- */
function cssOnce(){
  if(document.getElementById('nlxFlCss')) return;
  var s=document.createElement('style'); s.id='nlxFlCss';
  s.textContent='.fl-hud{position:absolute;left:8px;top:8px;z-index:1000;background:rgba(15,15,25,.86);color:#fff;border-radius:12px;padding:8px 10px;font:600 13px/1.3 system-ui,sans-serif;min-width:190px;max-width:260px;pointer-events:auto;box-shadow:0 2px 10px rgba(0,0,0,.4)}'
    +'.fl-hud .r{display:flex;justify-content:space-between;gap:10px}.fl-hud .v{font-size:1.25em;font-weight:800}.fl-hud small{color:#bbb;font-weight:500}.fl-hud .nx{border-top:1px solid #444;margin-top:5px;padding-top:5px}'
    +'.fl-hud button{background:#333;color:#fff;border:1px solid #555;border-radius:8px;padding:3px 8px;font-size:.85em;margin:4px 4px 0 0;cursor:pointer}.fl-hud .xte{color:#ffd54f}'
    +'.fl-alert{position:absolute;right:8px;top:8px;z-index:1001;max-width:300px;background:#c62828;color:#fff;border-radius:12px;padding:8px 12px;font:600 13px/1.35 system-ui,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.5);cursor:pointer}'
    +'.fl-alert.w{background:#ef6c00}.fl-alert.i{background:#1565c0}'
    +'@media(max-width:640px){.fl-alert{top:auto;bottom:8px;left:8px;right:8px;max-width:none;max-height:38%;overflow:auto;font-size:12px}.fl-hud{font-size:12px;min-width:0;max-width:62%;padding:6px 8px}.fl-hud .v{font-size:1.1em}}'
    +'.fl-big{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:8px 0}.fl-big>div{border:1px solid var(--border-color);border-radius:12px;padding:8px 10px;text-align:center}'
    +'.fl-big b{display:block;font-size:1.5em}.fl-big small{color:var(--text-secondary)}.fl-btns{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0}.fl-btns .navlog-btn{font-size:.9em;padding:8px 14px}'
    +'.fl-tbl{width:100%;border-collapse:collapse;font-size:.82em}.fl-tbl td,.fl-tbl th{border-bottom:1px solid var(--border-color);padding:6px;text-align:left}.fl-tbl tr.cur td{background:rgba(233,30,99,.12)}.fl-tbl tr.done td{color:var(--text-secondary)}'
    +'.fl-tank{font-size:1.1em;font-weight:800}.fl-tank.due{color:#ef5350;animation:flBlink 1s infinite}@keyframes flBlink{50%{opacity:.35}}'
    +'.fl-replay{position:absolute;left:8px;right:8px;bottom:8px;z-index:1000;background:rgba(15,15,25,.88);color:#fff;border-radius:12px;padding:8px 10px;font:600 12px system-ui,sans-serif;display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    +'.fl-replay input[type=range]{flex:1;min-width:120px}.fl-replay button{background:#333;color:#fff;border:1px solid #555;border-radius:8px;padding:3px 9px;cursor:pointer}'
    +'.navlog-btn.active{background:rgba(233,30,99,.18)!important;border-color:#e91e63!important;color:#e91e63!important}';
  document.head.appendChild(s);
}

/* ---------- Données : points de l'étape, aérodromes, espaces ---------- */
function stagePts(si){
  var wps=NL.waypoints, segs=NL.stageSegs(), seg=segs[Math.min(si||0,segs.length-1)]||[];
  var out=[];
  seg.forEach(function(i){ var w=wps[i]; if(!w||w.lat==null) return; var q=out[out.length-1];
    if(q&&Math.abs(q.lat-w.lat)<1e-4&&Math.abs(q.lon-w.lon)<1e-4) return;
    out.push({i:i,name:(w.name||('WP'+i)).trim(),lat:w.lat,lon:w.lon,eta:+w._eta||0,fuel:+w._cumFuel||0,alt:+w.altitude||NL.getConfig().alt,leg:w._leg||null}); });
  return out;
}
var _oa=null, _aip=null;
function loadData(){ return Promise.all([NL.loadOpenaip(),NL.loadAipFreqs()]).then(function(r){ _oa=r[0]; _aip=r[1]; return r; }); }
function apFreq(a){
  var ic=(a.icaoCode||'').toUpperCase(), f=_aip&&_aip.aerodromes&&_aip.aerodromes[ic];
  if(f&&f.length) return (f[0].call||'')+' '+f[0].freq;
  var q=(a.frequencies||[]).slice().sort(function(x,y){ return (y.primary?1:0)-(x.primary?1:0); })[0];
  return q?(q.name||'')+' '+q.value:'';
}
var SFC={0:'revêtue',1:'béton',2:'herbe',3:'sable',4:'eau',5:'bitume',6:'pierre',7:'corail',8:'terre',9:'gravier',10:'terre',11:'neige',12:'glace'};
function apRunway(a){
  var best=null; (a.runways||[]).forEach(function(r){ var l=r.dimension&&r.dimension.length&&r.dimension.length.value; if(l&&(!best||l>best.l)) best={l:l,d:r.designator,s:r.surface&&SFC[r.surface.mainComposite]}; });
  return best;
}
function apElev(a){ var e=a.elevation; return e?(e.unit===0?e.value*3.28084:e.value):0; }
function airportsNear(lat,lon,maxNm){
  return ((_oa&&_oa.airports)||[]).filter(function(a){ return a.geometry&&[4,7,8].indexOf(a.type)<0; }).map(function(a){
    var c=a.geometry.coordinates; return {a:a,lat:c[1],lon:c[0],d:NL.haversine(lat,lon,c[1],c[0])};
  }).filter(function(x){ return x.d<=(maxNm||40); }).sort(function(x,y){ return x.d-y.d; });
}
function airspaceFreq(a){ var o=_aip&&_aip.openaip&&_aip.openaip[a.name]; return o&&o.freqs&&o.freqs[0]?o.freqs[0].call+' '+o.freqs[0].freq:''; }

/* ---------- État du vol ---------- */
var S={on:false,watch:null,fix:null,prev:null,track:[],trackId:null,wake:null,map:{},alerts:{},banner:null,direct:null,glideOn:false,lastSave:0};
var live=lsGet('nlxLive',null);
function saveLive(){ lsSet('nlxLive',live); }
function newLive(){
  var c=NL.getConfig(), burn=c.fuelBurn||20, block=window._lastComputedBlockFuelL||0;
  live={stage:0,takeoff:null,landing:null,ata:{},fuel0:null,tank:{side:'G',last:null,every:30},started:Date.now()};
  saveLive();
}
if(!live) newLive();

function geom(p,a,b){
  /* distance le long de la branche, écart latéral (NM, + = à droite) */
  var R=3440.065, d13=NL.haversine(a.lat,a.lon,p.lat,p.lon)/R, t13=NL.bearing(a.lat,a.lon,p.lat,p.lon)*Math.PI/180, t12=NL.bearing(a.lat,a.lon,b.lat,b.lon)*Math.PI/180;
  var xt=Math.asin(Math.sin(d13)*Math.sin(t13-t12)), at=Math.acos(Math.max(-1,Math.min(1,Math.cos(d13)/Math.cos(xt))));
  if(Math.cos(t13-t12)<0) at=-at;
  return {xte:xt*R,along:at*R,len:NL.haversine(a.lat,a.lon,b.lat,b.lon)};
}
function nextIdx(pts){
  for(var k=1;k<pts.length;k++) if(!live.ata[pts[k].i]) return k;
  return -1;
}
function markPassed(k,auto){
  var pts=stagePts(live.stage); if(!pts[k]) return;
  live.ata[pts[k].i]=Date.now(); saveLive();
  if(k===pts.length-1&&live.stage<NL.stageSegs().length-1&&!auto){ /* fin d'étape : l'étape suivante démarre au prochain décollage */ }
  if(opts().voice) speak((pts[k].name||'point')+' passé à '+hm(Date.now()).replace(':',' heures '));
  renderLive();
}
NLX.flightMarkPassed=function(k){ markPassed(k,false); };

/* ---------- GPS ---------- */
function start(){
  if(!navigator.geolocation){ NL.toast('GPS indisponible sur cet appareil','error',4000); return; }
  cssOnce(); loadData();
  S.on=true; S.track=[]; S.trackId='T'+Date.now(); S.alerts={};
  S.watch=navigator.geolocation.watchPosition(onFix,function(e){ NL.toast('📡 GPS : '+(e.code===1?'autorisation refusée (réglages du téléphone)':e.message),'error',5000); },{enableHighAccuracy:true,maximumAge:0,timeout:30000});
  wakeLock(); ensureHud(); renderLive(); updateBtns();
  NL.toast('🛩️ Mode vol : GPS actif, écran gardé allumé. Trace enregistrée.','info',3500);
}
function stop(){
  if(S.watch!=null) navigator.geolocation.clearWatch(S.watch);
  S.watch=null; S.on=false; saveTrack(true);
  if(S.wake){ try{ S.wake.release(); }catch(e){} S.wake=null; }
  var h=document.getElementById('flHud'); if(h) h.remove();
  var b=document.getElementById('flAlert'); if(b) b.remove();
  ['own','vec','trk','dir'].forEach(function(k){ if(S.map[k]&&NL.routeMap) NL.routeMap.removeLayer(S.map[k]); S.map[k]=null; });
  updateBtns(); renderLive();
  if(S.track.length>20&&live.takeoff){
    var dur=((live.landing||Date.now())-live.takeoff)/3600000;
    if(NLX.addLoggedFlight&&confirm('Ajouter ce vol à ton carnet (onglet Pilote) ? '+dur.toFixed(1)+' h, 1 atterrissage')) NLX.addLoggedFlight({date:new Date(live.takeoff).toISOString().slice(0,10),time:Math.round(dur*10)/10,ldg:1,nightLdg:0,rmk:'Trace GPS'});
  }
}
function wakeLock(){
  try{ if(navigator.wakeLock) navigator.wakeLock.request('screen').then(function(w){ S.wake=w; }).catch(function(){}); }catch(e){}
}
document.addEventListener('visibilitychange',function(){ if(S.on&&document.visibilityState==='visible') wakeLock(); });

function onFix(pos){
  var c=pos.coords, t=pos.timestamp||Date.now();
  var f={lat:c.latitude,lon:c.longitude,alt:c.altitude!=null?c.altitude*3.28084:null,acc:c.accuracy,t:t,gs:c.speed!=null?c.speed/KT_MS:null,trk:c.heading!=null&&!isNaN(c.heading)?c.heading:null};
  var p=S.fix;
  if(p&&(f.gs==null||f.trk==null)){
    var dt=(t-p.t)/3600000, d=NL.haversine(p.lat,p.lon,f.lat,f.lon);
    if(dt>0&&d>0.005){ if(f.gs==null) f.gs=d/dt; if(f.trk==null) f.trk=NL.bearing(p.lat,p.lon,f.lat,f.lon); }
    else { if(f.gs==null) f.gs=p.gs; if(f.trk==null) f.trk=p.trk; }
  }
  if(f.alt==null&&p) f.alt=p.alt;
  S.prev=p; S.fix=f;
  if(!S.track.length||t-S.track[S.track.length-1].t>=3000) S.track.push({t:t,lat:f.lat,lon:f.lon,alt:f.alt!=null?Math.round(f.alt):null,gs:f.gs!=null?Math.round(f.gs):null});
  if(t-S.lastSave>20000) saveTrack(false);
  /* décollage / atterrissage automatiques */
  if(!live.takeoff&&f.gs>=40){ live.takeoff=t; live.landing=null; var p0=stagePts(live.stage)[0]; if(p0) live.ata[p0.i]=t; saveLive(); if(opts().voice) speak('Décollage à '+hm(t).replace(':',' heures ')); }
  else if(live.takeoff&&!live.landing&&f.gs!=null&&f.gs<25&&t-live.takeoff>120000){
    live.landing=t; saveLive();
    var pts=stagePts(live.stage), last=pts[pts.length-1];
    if(last&&NL.haversine(f.lat,f.lon,last.lat,last.lon)<3) live.ata[last.i]=t;
    saveLive();
  }
  autoSequence(f);
  drawOwnship(f); updateHud(); checkAirspaces(f); tankCheck();
  if(S.glideOn) drawGlide(f.lat,f.lon,f.alt||0,null,legWind());
  if(document.getElementById('tab-vol')&&document.getElementById('tab-vol').classList.contains('active')) renderLiveSoft();
}
function autoSequence(f){
  if(!live.takeoff||live.landing) return;
  var pts=stagePts(live.stage), k=nextIdx(pts); if(k<1) return;
  var g=geom(f,pts[k-1],pts[k]), d=NL.haversine(f.lat,f.lon,pts[k].lat,pts[k].lon);
  if(d<0.6||(g.along>g.len&&Math.abs(g.xte)<3)) markPassed(k,true);
}

/* ---------- Carte : avion, trace, vecteur, HUD ---------- */
function planeIcon(trk){
  return L.divIcon({className:'',iconSize:[34,34],iconAnchor:[17,17],html:'<svg width="34" height="34" viewBox="-17 -17 34 34" style="transform:rotate('+(trk||0)+'deg);filter:drop-shadow(0 0 3px #000)"><path d="M0,-15 L3,-4 L14,2 L14,5 L3,2 L2,10 L6,13 L6,15 L0,13.5 L-6,15 L-6,13 L-2,10 L-3,2 L-14,5 L-14,2 L-3,-4 Z" fill="#ffeb3b" stroke="#000" stroke-width="1"/></svg>'});
}
function drawOwnship(f){
  var map=NL.routeMap; if(!map) return;
  var ll=[f.lat,f.lon];
  if(!S.map.own) S.map.own=L.marker(ll,{icon:planeIcon(f.trk),interactive:false,zIndexOffset:2000}).addTo(map); else { S.map.own.setLatLng(ll); S.map.own.setIcon(planeIcon(f.trk)); }
  var pts=S.track.slice(-600).map(function(p){ return [p.lat,p.lon]; });
  if(!S.map.trk) S.map.trk=L.polyline(pts,{color:'#ffeb3b',weight:3,opacity:.85,interactive:false}).addTo(map); else S.map.trk.setLatLngs(pts);
  if(f.gs>10&&f.trk!=null){
    var e=NL.destPoint(f.lat,f.lon,f.trk,f.gs*opts().look/60), v=[ll,[e.lat,e.lon]];
    if(!S.map.vec) S.map.vec=L.polyline(v,{color:'#00e5ff',weight:2,dashArray:'6 6',interactive:false}).addTo(map); else S.map.vec.setLatLngs(v);
  }
  var tgt=target(); if(tgt){ var dl=[ll,[tgt.lat,tgt.lon]];
    if(!S.map.dir) S.map.dir=L.polyline(dl,{color:'#e040fb',weight:2,opacity:.7,interactive:false}).addTo(map); else S.map.dir.setLatLngs(dl); }
  if(opts().follow&&Date.now()-(S.userMoved||0)>20000) map.panTo(ll,{animate:true});
}
function target(){
  if(S.direct) return S.direct;
  var pts=stagePts(live.stage), k=nextIdx(pts); return k>0?pts[k]:null;
}
function ensureHud(){
  var mc=document.getElementById('routeMapContainer'); if(!mc||document.getElementById('flHud')) return;
  var h=document.createElement('div'); h.className='fl-hud'; h.id='flHud';
  ['mousedown','touchstart','dblclick','wheel','click'].forEach(function(ev){ h.addEventListener(ev,function(e){ e.stopPropagation(); }); });
  mc.appendChild(h);
  var map=NL.routeMap; if(map&&!S.dragHooked){ S.dragHooked=true; map.on('dragstart',function(){ S.userMoved=Date.now(); }); }
}
function updateHud(){
  var h=document.getElementById('flHud'); if(!h) return;
  var f=S.fix; if(!f){ h.innerHTML='📡 Recherche GPS…'; return; }
  var tg=target(), pts=stagePts(live.stage), k=nextIdx(pts), html='';
  html+='<div class="r"><span><small>Vs</small> <span class="v">'+(f.gs!=null?Math.round(f.gs):'—')+'</span> <small>kt</small></span><span><small>Rm</small> <span class="v">'+(f.trk!=null&&f.gs>3?n360(mag(f.trk)):'—')+'</span></span></div>';
  html+='<div class="r"><span><small>Alt GPS</small> <span class="v">'+(f.alt!=null?Math.round(f.alt/10)*10:'—')+'</span> <small>ft</small></span><span><small>±'+Math.round(f.acc||0)+' m</small></span></div>';
  if(tg){
    var d=NL.haversine(f.lat,f.lon,tg.lat,tg.lon), brg=NL.bearing(f.lat,f.lon,tg.lat,tg.lon), ete=f.gs>15?d/f.gs*3600000:null;
    html+='<div class="nx"><div class="r"><span>➡️ <b>'+esc(tg.name)+'</b>'+(S.direct?' <small>(direct)</small>':'')+'</span><span>'+d.toFixed(1)+' NM</span></div>'
      +'<div class="r"><span><small>Rm direct</small> '+n360(mag(brg))+'</span><span><small>'+mmss(ete)+' · '+(ete?hm(Date.now()+ete):'—')+'</small></span></div>';
    if(!S.direct&&k>0){
      var g=geom(f,pts[k-1],pts[k]), rm=mag(NL.bearing(pts[k-1].lat,pts[k-1].lon,pts[k].lat,pts[k].lon));
      html+='<div class="r xte"><span>Écart '+Math.abs(g.xte).toFixed(1)+' NM '+(g.xte>0?'à droite':'à gauche')+'</span><span><small>Rm route '+n360(rm)+'</small></span></div>';
      if(Math.abs(g.xte)>=0.5){ var back=mag(NL.bearing(f.lat,f.lon,pts[k].lat,pts[k].lon)); html+='<div class="xte"><small>Pour rejoindre : prendre '+n360(back)+' vers '+esc(pts[k].name)+'</small></div>'; }
    }
    html+='</div>';
  }
  var fr=fuelNow(); if(fr!=null) html+='<div class="r"><small>⛽ Restant estimé</small><span>'+fr.toFixed(0)+' L</span></div>';
  var tk=tankState(); if(tk) html+='<div class="r"><small>Réservoir</small><span class="fl-tank'+(tk.due?' due':'')+'">'+tk.txt+'</span></div>';
  html+='<div><button data-a="near">🛬 Proche</button><button data-a="glide">🪂 Plané</button>'+(S.direct?'<button data-a="undirect">↩ Route</button>':'')+(Date.now()-(S.userMoved||0)<20000||!opts().follow?'<button data-a="follow">⌖ Suivre</button>':'')+'<button data-a="pass">✔ Point passé</button></div>';
  h.innerHTML=html;
  h.querySelectorAll('button').forEach(function(b){ b.onclick=function(){ var a=b.dataset.a;
    if(a==='near') showNearest(); else if(a==='glide') toggleGlide(); else if(a==='undirect'){ S.direct=null; updateHud(); }
    else if(a==='follow'){ S.userMoved=0; setOpt('follow',true); if(S.fix) NL.routeMap.panTo([S.fix.lat,S.fix.lon]); updateHud(); }
    else if(a==='pass'){ var k2=nextIdx(stagePts(live.stage)); if(k2>0) markPassed(k2,false); } }; });
}

/* ---------- Alertes d'espaces aériens ---------- */
function checkAirspaces(f){
  if(!_oa||!f.gs||f.gs<30||f.trk==null||f.alt==null) return;
  if(Date.now()-(S.lastAs||0)<4000) return; S.lastAs=Date.now();
  var look=opts().look, steps=[], n=Math.max(2,look*2);
  for(var j=0;j<=n;j++){ var e=NL.destPoint(f.lat,f.lon,f.trk,f.gs*(look*j/n)/60); steps.push({lat:e.lat,lon:e.lon,min:look*j/n}); }
  var reach=f.gs*look/60+2, now=[];
  _oa.airspaces.forEach(function(a){
    var lab=NL.classLabel(a); if(lab==='FIR'||lab==='UIR'||lab==='AWY') return;
    var bb=NL.geomBBox(a), pad=reach/60;
    if(f.lon<bb[0]-pad*1.6||f.lon>bb[2]+pad*1.6||f.lat<bb[1]-pad||f.lat>bb[3]+pad) return;
    var lo=NL.limitFt(a.lowerLimit)||0, hi=NL.limitFt(a.upperLimit)||99999, id=a._id||a.name;
    var hit=null; for(var q=0;q<steps.length;q++){ if(NL.inAirspace(a,steps[q].lat,steps[q].lon)){ hit=steps[q]; break; } }
    if(!hit){ delete S.alerts[id]; return; }
    var alt=f.alt, vert, lvl;
    if(alt>=lo-300&&alt<=hi+300){ vert=hit.min===0?'tu es dedans':'tu vas y entrer'; lvl=/PROHIB|RESTRICT|DANGER|CTR|TMA|ATZ|TSA|TRA|MATZ|CTA|^[ABCD]$/.test(lab)?2:1; }
    else if(alt<lo&&lo-alt<=1500){ vert='plancher '+Math.round((lo-alt)/100)*100+' ft au-dessus de toi'; lvl=1; }
    else if(alt>hi&&alt-hi<=1000){ vert='plafond '+Math.round((alt-hi)/100)*100+' ft sous toi'; lvl=0; }
    else return;
    var prev=S.alerts[id], key=vert.split(' ')[0]+lvl;
    if(prev&&prev.key===key&&Date.now()-prev.t<5*60000) return;
    S.alerts[id]={t:Date.now(),key:key};
    var fq=airspaceFreq(a), when=hit.min===0?'maintenant':'dans '+Math.max(1,Math.round(hit.min))+' min';
    now.push({lvl:lvl,txt:'<b>'+esc(a.name)+'</b> ('+esc(lab)+') '+when+' — '+vert+(fq?'<br>📻 '+esc(fq):''),
      say:a.name.replace(/\bCTR\b/,'C T R').replace(/\bTMA\b/,'T M A')+', '+when+', '+vert.replace('ft','pieds')+(fq?'. Contacter '+fq.replace(/\./,' décimale '):'')});
  });
  if(!now.length) return;
  now.sort(function(x,y){ return y.lvl-x.lvl; });
  banner(now[0].lvl,now.slice(0,3).map(function(x){ return x.txt; }).join('<hr style="border-color:rgba(255,255,255,.3)">')+(now.length>3?'<div style="font-size:.8em">+ '+(now.length-3)+' autre(s) dans l’onglet En vol</div>':''));
  if(opts().voice&&now[0].lvl>=1) speak('Attention, '+now[0].say);
  if(now[0].lvl===2&&navigator.vibrate) try{ navigator.vibrate([300,150,300]); }catch(e){}
  (S.log=S.log||[]).unshift({t:Date.now(),txt:now[0].txt}); S.log=S.log.slice(0,30);
}
function banner(lvl,html){
  var mc=document.getElementById('routeMapContainer'); if(!mc) return;
  var b=document.getElementById('flAlert');
  if(!b){ b=document.createElement('div'); b.id='flAlert'; b.onclick=function(){ b.remove(); }; ['mousedown','touchstart','dblclick'].forEach(function(ev){ b.addEventListener(ev,function(e){ e.stopPropagation(); }); }); mc.appendChild(b); }
  b.className='fl-alert'+(lvl===2?'':lvl===1?' w':' i'); b.innerHTML=html+'<div style="font-size:.8em;opacity:.8;margin-top:3px">Touche pour fermer</div>';
  clearTimeout(S.bannerT); S.bannerT=setTimeout(function(){ if(b.parentNode) b.remove(); },lvl===2?45000:20000);
}

/* ---------- Voix et sons ---------- */
function speak(t){
  try{ if(window.appTts&&appTts.supported()) appTts.speak(t,{lang:'fr-FR'}); else if(window.speechSynthesis){ var u=new SpeechSynthesisUtterance(t); u.lang='fr-FR'; speechSynthesis.speak(u); } }catch(e){}
}
function beep(){
  try{ var C=window.AudioContext||window.webkitAudioContext, c=S.ac||(S.ac=new C()), o=c.createOscillator(), g=c.createGain();
    o.frequency.value=880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(.3,c.currentTime); g.gain.exponentialRampToValueAtTime(.001,c.currentTime+.6); o.start(); o.stop(c.currentTime+.6); }catch(e){}
}

/* ---------- Terrain le plus proche ---------- */
function showNearest(){
  loadData().then(function(){
    var f=S.fix, map=NL.routeMap, from=f?{lat:f.lat,lon:f.lon}:(map?{lat:map.getCenter().lat,lon:map.getCenter().lng}:null); if(!from) return;
    var L5=airportsNear(from.lat,from.lon,80).slice(0,5);
    var html=(f?'':'<p style="font-size:.8em;color:var(--text-secondary)">Pas de position GPS : distances depuis le centre de la carte.</p>')+L5.map(function(x,i){
      var a=x.a, rw=apRunway(a), brg=mag(NL.bearing(from.lat,from.lon,x.lat,x.lon)), ete=f&&f.gs>20?x.d/f.gs*60:null;
      return '<div class="bp-row" data-i="'+i+'" style="cursor:default"><div style="flex:1"><b>'+esc(a.icaoCode||'')+' '+esc(a.name)+'</b><br><small>'+(rw?'Piste '+esc(rw.d||'')+' · '+rw.l+' m '+(rw.s||''):'piste ?')+' · '+Math.round(apElev(a))+' ft'+(apFreq(a)?' · 📻 '+esc(apFreq(a)):'')+(a.ppr?' · PPR':'')+'</small></div>'
        +'<div style="text-align:right"><b style="font-size:1.3em">'+n360(brg)+'</b><br><small>'+x.d.toFixed(1)+' NM'+(ete?' · '+Math.round(ete)+' min':'')+'</small></div><button class="navlog-btn" data-dir="'+i+'">Direct</button></div>';
    }).join('');
    var m=NLX.modal('🛬 Terrains les plus proches',html||'<p>Aucun terrain à moins de 80 NM.</p>');
    m.querySelectorAll('[data-dir]').forEach(function(b){ b.onclick=function(){ var x=L5[+b.dataset.dir]; S.direct={lat:x.lat,lon:x.lon,name:x.a.icaoCode||x.a.name}; m.remove();
      if(S.fix) drawOwnship(S.fix); updateHud(); if(map) map.fitBounds([[from.lat,from.lon],[x.lat,x.lon]],{padding:[60,60]}); if(opts().voice) speak('Direct '+(x.a.name||'')+', cap '+Math.round(mag(NL.bearing(from.lat,from.lon,x.lat,x.lon)))); }; });
  });
}

/* ---------- Plané ---------- */
function acGlide(){
  var ac=NL.aircraft&&NL.aircraft(), t=(ac&&ac.type)||'';
  return {ratio:NL.glideRatio(),vg:opts().vg||(/150/.test(t)?60:65),type:t};
}
function legAt(dist){
  var w=NL.waypoints, cum=0;
  for(var i=1;i<w.length;i++){ var d=+w[i].dist||0; if(dist<=cum+d||i===w.length-1) return w[i]; cum+=d; }
  return w[w.length-1];
}
function legWind(wp){
  var c=NL.getConfig(); wp=wp||(function(){ var t=target(); return t?NL.waypoints[t.i]:null; })();
  var lg=wp&&wp._leg, dir=lg&&lg.wDir!=null?lg.wDir:c.windDir, spd=lg&&lg.wSpd!=null?lg.wSpd:c.windSpd;
  return {fromTrue:((dir||0)-dev()+360)%360,kt:spd||0};
}
/* zone atteignable : cercle de rayon h×finesse, décalé par le vent pendant le temps de plané */
function reach(lat,lon,hFt,ratio,vg,w){
  var R=Math.max(0,hFt)*ratio/NM_FT, t=vg>0?R/vg:0, drift=w.kt*t;
  var c=drift>0.01?NL.destPoint(lat,lon,(w.fromTrue+180)%360,drift):{lat:lat,lon:lon};
  return {R:R,c:c,t:t};
}
function drawGlide(lat,lon,altFt,groundFt,w){
  var map=NL.routeMap; if(!map) return;
  var g=acGlide(), margin=opts().margin;
  if(groundFt==null){ var near=airportsNear(lat,lon,15)[0]; groundFt=near?apElev(near.a):0; }
  var r=reach(lat,lon,altFt-groundFt-margin,g.ratio,g.vg,w);
  if(S.map.glide) map.removeLayer(S.map.glide);
  var grp=L.layerGroup();
  var ring=[]; for(var a=0;a<360;a+=6){ var p=NL.destPoint(r.c.lat,r.c.lon,a,r.R); ring.push([p.lat,p.lon]); }
  if(r.R>0.05) grp.addLayer(L.polygon(ring,{color:'#2e7d32',weight:2,fillColor:'#66bb6a',fillOpacity:.15,interactive:false}));
  grp.addLayer(L.circleMarker([lat,lon],{radius:4,color:'#fff',fillColor:'#2e7d32',fillOpacity:1,weight:1,interactive:false}));
  var ok=0;
  airportsNear(lat,lon,r.R+w.kt*r.t+3).forEach(function(x){
    var rf=reach(lat,lon,altFt-apElev(x.a)-margin,g.ratio,g.vg,w), d=NL.haversine(rf.c.lat,rf.c.lon,x.lat,x.lon), can=d<=rf.R; if(can) ok++;
    grp.addLayer(L.circleMarker([x.lat,x.lon],{radius:can?8:5,color:can?'#1b5e20':'#9e9e9e',weight:2,fillColor:can?'#76ff03':'#bdbdbd',fillOpacity:can?.9:.6})
      .bindTooltip((x.a.icaoCode||'')+' '+x.a.name+(can?' : atteignable':' : trop loin')+' ('+x.d.toFixed(1)+' NM)',{direction:'top'}));
  });
  grp.addLayer(L.marker([r.c.lat,r.c.lon],{interactive:false,icon:L.divIcon({className:'',iconSize:[0,0],html:'<div style="transform:translate(-50%,-140%);white-space:nowrap;background:rgba(27,94,32,.9);color:#fff;font:600 11px sans-serif;padding:2px 6px;border-radius:6px">🪂 '+r.R.toFixed(1)+' NM · '+Math.round(altFt)+' ft · '+ok+' terrain(s)</div>'})}));
  S.map.glide=grp.addTo(map);
}
function clearGlide(){ if(S.map.glide&&NL.routeMap){ NL.routeMap.removeLayer(S.map.glide); S.map.glide=null; } }
function toggleGlide(on){
  S.glideOn=on==null?!S.glideOn:on;
  var b=document.getElementById('nlxGlideBtn'); if(b) b.classList.toggle('active',S.glideOn);
  if(!S.glideOn){ clearGlide(); return; }
  loadData().then(function(){
    var g=acGlide();
    if(S.fix) drawGlide(S.fix.lat,S.fix.lon,S.fix.alt||0,null,legWind());
    else NL.toast('🪂 Plané : promène la souris (ou le doigt) sur le tracé ou sur le profil d\'altitude. Finesse '+g.ratio+', plané à '+g.vg+' kt, arrivée '+opts().margin+' ft au-dessus du terrain, vent du leg.','info',6000);
  });
}
NLX.onCrosshair=function(dist){
  if(!S.glideOn||S.on) return;
  var ll=NL.latLonAtDist(dist); if(!ll) return;
  var wp=legAt(dist), alt=+wp.altitude||NL.getConfig().alt, g=NL.profGeom, ground=null;
  if(g&&g.tArr&&g.tArr.length>1&&g.totalDist){ var n=g.tArr.length-1, k=dist/g.totalDist*n, k0=Math.max(0,Math.floor(k)), k1=Math.min(n,k0+1); ground=g.tArr[k0]+(g.tArr[k1]-g.tArr[k0])*(k-k0); }
  /* près des terrains, l'avion est en montée / descente : altitude limitée à la pente vers le terrain */
  drawGlide(ll.lat,ll.lon,alt,ground,legWind(wp));
};
NLX.onCrosshairOut=function(){};

/* ---------- Carburant et réservoirs ---------- */
function defaultFuel0(){
  var c=NL.getConfig(), burn=c.fuelBurn||20, block=window._lastComputedBlockFuelL||0;
  return block?Math.round((block-(c.fuelTaxiD||0)*burn/60)*10)/10:null;
}
function fuelNow(t){
  if(live.fuel0==null&&!live.fuel0Set) live.fuel0=defaultFuel0();
  if(live.fuel0==null||!live.takeoff) return null;
  var burn=NL.getConfig().fuelBurn||20, end=t||live.landing||Date.now();
  return live.fuel0-burn*(end-live.takeoff)/3600000;
}
function tankState(){
  var tk=live.tank; if(!tk||!tk.last) return null;
  var left=tk.last+tk.every*60000-Date.now();
  return {due:left<=0,txt:(tk.side==='G'?'gauche':'droit')+' · '+(left>0?mmss(left):'CHANGER')};
}
function tankCheck(){
  var s=tankState(); if(!s||!s.due) return;
  if(Date.now()-(S.tankAlarm||0)>60000){ S.tankAlarm=Date.now(); beep(); if(opts().voice) speak('Changer de réservoir'); if(navigator.vibrate) try{ navigator.vibrate([200,100,200]); }catch(e){} }
}
/* onglet « En vol » ouvert pendant le vol : rafraîchi toutes les 5 s */
setInterval(function(){ var t=document.getElementById('tab-vol'); if(S.on&&t&&t.classList.contains('active')&&!(document.activeElement&&/INPUT|SELECT/.test(document.activeElement.tagName))) renderLive(); },5000);
setInterval(function(){ if(live&&live.tank&&live.tank.last){ tankCheck(); var el=document.getElementById('flTank'); if(el){ var s=tankState(); el.textContent=s?s.txt:'—'; el.className='fl-tank'+(s&&s.due?' due':''); } if(S.on) updateHud(); } },15000);

/* ---------- Traces : IndexedDB, GPX, KML, rejeu ---------- */
function db(){
  return new Promise(function(res,rej){ var r=indexedDB.open('nlxTracks',1); r.onupgradeneeded=function(){ r.result.createObjectStore('tracks',{keyPath:'id'}); }; r.onsuccess=function(){ res(r.result); }; r.onerror=function(){ rej(r.error); }; });
}
function dbDo(mode,fn){ return db().then(function(d){ return new Promise(function(res,rej){ var tx=d.transaction('tracks',mode), st=tx.objectStore('tracks'), q=fn(st); tx.oncomplete=function(){ res(q&&q.result); }; tx.onerror=function(){ rej(tx.error); }; }); }); }
function saveTrack(final){
  S.lastSave=Date.now(); if(S.track.length<2) return;
  var pts=stagePts(live.stage), name=(pts[0]?pts[0].name:'?')+' → '+(pts.length?pts[pts.length-1].name:'?');
  dbDo('readwrite',function(st){ return st.put({id:S.trackId,name:name,start:S.track[0].t,end:S.track[S.track.length-1].t,pts:S.track}); }).then(function(){ if(final) renderLive(); }).catch(function(){});
}
function listTracks(){ return dbDo('readonly',function(st){ return st.getAll(); }).catch(function(){ return []; }); }
function gpx(t){
  return '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Briefing VFR" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>'+esc(t.name)+'</name><trkseg>\n'
    +t.pts.map(function(p){ return '<trkpt lat="'+p.lat.toFixed(6)+'" lon="'+p.lon.toFixed(6)+'">'+(p.alt!=null?'<ele>'+(p.alt/3.28084).toFixed(1)+'</ele>':'')+'<time>'+new Date(p.t).toISOString()+'</time></trkpt>'; }).join('\n')+'\n</trkseg></trk></gpx>';
}
function kml(t){
  return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>'+esc(t.name)+'</name><Placemark><name>'+esc(t.name)+'</name><Style><LineStyle><color>ff00ebff</color><width>3</width></LineStyle></Style>'
    +'<LineString><altitudeMode>absolute</altitudeMode><coordinates>'+t.pts.map(function(p){ return p.lon.toFixed(6)+','+p.lat.toFixed(6)+','+(p.alt!=null?(p.alt/3.28084).toFixed(0):0); }).join(' ')+'</coordinates></LineString></Placemark></Document></kml>';
}
function saveFile(name,text,type){
  var P=window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()&&window.Capacitor.Plugins;
  if(P&&P.Filesystem){
    return P.Filesystem.writeFile({path:name,data:text,directory:'CACHE',encoding:'utf8'}).then(function(r){
      return P.FileOpener?P.FileOpener.open({filePath:r.uri,contentType:type}):null; }).catch(function(e){ NL.toast('Enregistrement impossible : '+(e&&e.message||e),'error',4000); });
  }
  var a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type:type})); a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(a.href); },10000);
}
var R={layer:null,t:null,timer:null};
function replay(t){
  var map=NL.routeMap; if(!map||!t||t.pts.length<2) return;
  stopReplay(); window.switchTab('nav');
  var grp=L.layerGroup().addTo(map), alts=t.pts.map(function(p){ return p.alt||0; }), mx=Math.max.apply(null,alts)||1;
  for(var i=1;i<t.pts.length;i++){ var a=t.pts[i-1], b=t.pts[i], k=(b.alt||0)/mx, col='hsl('+Math.round(240-200*k)+',85%,50%)';
    grp.addLayer(L.polyline([[a.lat,a.lon],[b.lat,b.lon]],{color:col,weight:4,opacity:.9,interactive:false})); }
  var mk=L.marker([t.pts[0].lat,t.pts[0].lon],{icon:planeIcon(0),interactive:false,zIndexOffset:2000}).addTo(grp);
  R.layer=grp; map.fitBounds(L.latLngBounds(t.pts.map(function(p){ return [p.lat,p.lon]; })),{padding:[30,30]});
  var mc=document.getElementById('routeMapContainer'), box=document.createElement('div'); box.className='fl-replay'; box.id='flReplay';
  ['mousedown','touchstart','dblclick','wheel'].forEach(function(ev){ box.addEventListener(ev,function(e){ e.stopPropagation(); }); });
  box.innerHTML='<button data-p>▶</button><select data-s><option value="10">×10</option><option value="30" selected>×30</option><option value="60">×60</option></select><input type="range" min="0" max="'+(t.pts.length-1)+'" value="0"><span data-i style="min-width:150px"></span><button data-x>✕</button>';
  mc.appendChild(box);
  var rg=box.querySelector('input'), info=box.querySelector('[data-i]');
  function at(i){ var p=t.pts[i], q=t.pts[Math.max(0,i-1)]; mk.setLatLng([p.lat,p.lon]); mk.setIcon(planeIcon(i?NL.bearing(q.lat,q.lon,p.lat,p.lon):0));
    info.textContent=hm(p.t)+' · '+(p.alt!=null?p.alt+' ft':'—')+' · '+(p.gs!=null?p.gs+' kt':'—'); rg.value=i; }
  rg.oninput=function(){ at(+rg.value); };
  box.querySelector('[data-p]').onclick=function(){
    var b=this; if(R.timer){ clearInterval(R.timer); R.timer=null; b.textContent='▶'; return; }
    b.textContent='⏸'; R.timer=setInterval(function(){ var sp=+box.querySelector('[data-s]').value, i=+rg.value, tt=t.pts[i].t+sp*250, j=i;
      while(j<t.pts.length-1&&t.pts[j].t<tt) j++; if(j>=t.pts.length-1){ clearInterval(R.timer); R.timer=null; b.textContent='▶'; } at(j); },250);
  };
  box.querySelector('[data-x]').onclick=stopReplay;
  at(0);
  var c=document.getElementById('routeMapCard'); if(c) c.scrollIntoView({behavior:'smooth'});
}
function stopReplay(){ if(R.timer) clearInterval(R.timer); R.timer=null; if(R.layer&&NL.routeMap) NL.routeMap.removeLayer(R.layer); R.layer=null; var b=document.getElementById('flReplay'); if(b) b.remove(); }

/* ---------- Onglet « En vol » ---------- */
function renderLiveSoft(){ clearTimeout(S.rt); S.rt=setTimeout(renderLive,1500); }
function renderLive(){
  var root=document.getElementById('flightRoot'); if(!root) return; cssOnce();
  var segs=NL.stageSegs(), pts=stagePts(live.stage), k=nextIdx(pts), f=S.fix, c=NL.getConfig(), burn=c.fuelBurn||20, o=opts();
  /* estimées : dernier point passé (heure réelle) + temps prévus ; prochain point d'après la vitesse sol GPS */
  var base=null, baseEta=0;
  for(var j=pts.length-1;j>=0;j--) if(live.ata[pts[j].i]){ base=live.ata[pts[j].i]; baseEta=pts[j].eta; break; }
  if(base==null&&live.takeoff){ base=live.takeoff; baseEta=pts[0]?pts[0].eta:0; }
  var gpsNext=null; if(f&&k>0&&f.gs>20){ gpsNext=Date.now()+NL.haversine(f.lat,f.lon,pts[k].lat,pts[k].lon)/f.gs*3600000; }
  var dep=new Date(c.flightDate+'T'+c.depTime+':00').getTime()+(c.fuelTaxiD||0)*60000;
  var resL=(c.reserveMin||30)*burn/60;
  var rows=pts.map(function(p,i){
    var plan=dep+(p.eta-(pts[0]?pts[0].eta:0))*60000, ata=live.ata[p.i], est=null;
    if(!ata&&base!=null){ est=(gpsNext&&i>=k)?gpsNext+(p.eta-pts[k].eta)*60000:base+(p.eta-baseEta)*60000; }
    var fuel=live.fuel0!=null&&live.takeoff?fuelNow(ata||est||null):null;
    var delta=(ata||est)?Math.round(((ata||est)-plan)/60000):null;
    return '<tr class="'+(ata?'done':i===k?'cur':'')+'"><td><b>'+esc(p.name)+'</b></td><td>'+hm(plan)+'</td><td>'+(ata?'':hm(est))+(delta!=null?' <small style="color:'+(delta>5?'#ef5350':delta<-5?'#4caf50':'var(--text-secondary)')+'">'+(delta>0?'+':'')+delta+' min</small>':'')+'</td>'
      +'<td>'+(ata?'<b>'+hm(ata)+'</b>':'')+'</td><td>'+(fuel!=null?'<span style="color:'+(fuel<resL?'#ef5350':'inherit')+'">'+fuel.toFixed(0)+' L</span>':'')+'</td>'
      +'<td>'+(i>0&&!ata?'<button class="navlog-btn" style="padding:3px 9px" onclick="NLX.flightMarkPassed('+i+')">✔ Passé</button>':'')+'</td></tr>';
  }).join('');
  if(live.fuel0==null&&!live.fuel0Set) live.fuel0=defaultFuel0();
  var tk=tankState(), fr=fuelNow();
  var html='<div class="nl-card"><div class="nl-card-title"><span class="icon">🛩️</span> Navigation en vol</div>'
    +'<div class="fl-btns"><button class="navlog-btn'+(S.on?' active':'')+'" id="flStart">'+(S.on?'⏹️ Arrêter le GPS':'▶️ Démarrer le GPS (mode vol)')+'</button>'
    +'<button class="navlog-btn" id="flTo">'+(live.takeoff?'🛫 Décollé à '+hm(live.takeoff):'🛫 Décollage maintenant')+'</button>'
    +'<button class="navlog-btn" id="flNear">🛬 Terrain le plus proche</button><button class="navlog-btn'+(S.glideOn?' active':'')+'" id="flGlide">🪂 Cercle de plané</button>'
    +'<button class="navlog-btn" id="flReset">🔄 Nouveau vol</button></div>'
    +'<div class="fl-big"><div><small>Vitesse sol</small><b>'+(f&&f.gs!=null?Math.round(f.gs)+' kt':'—')+'</b></div><div><small>Route magnétique</small><b>'+(f&&f.trk!=null&&f.gs>3?n360(mag(f.trk)):'—')+'</b></div>'
    +'<div><small>Altitude GPS</small><b>'+(f&&f.alt!=null?Math.round(f.alt/10)*10+' ft':'—')+'</b></div><div><small>Prochain point</small><b>'+(k>0?esc(pts[k].name):'—')+'</b></div>'
    +'<div><small>Carburant restant</small><b>'+(fr!=null?fr.toFixed(0)+' L':'—')+'</b></div><div><small>Réservoir</small><b id="flTank" class="fl-tank'+(tk&&tk.due?' due':'')+'">'+(tk?tk.txt:'—')+'</b></div></div>'
    +(S.on?'':'<p style="font-size:.8em;color:var(--text-secondary)">Le GPS du téléphone suffit (pas besoin d\'Internet : cartes et données déjà gardées). Garde l\'appli au premier plan pendant le vol. Ces informations aident à la navigation mais ne remplacent ni la carte ni le contrôle visuel.</p>')
    +'</div>';
  html+='<div class="nl-card"><div class="nl-card-title" style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px"><span><span class="icon">🧭</span> Log de navigation en direct</span>'
    +(segs.length>1?'<select id="flStage" style="padding:4px 8px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit">'+segs.map(function(s,i){ return '<option value="'+i+'"'+(i===live.stage?' selected':'')+'>Étape '+(i+1)+'</option>'; }).join('')+'</select>':'')+'</div>'
    +'<div style="overflow-x:auto"><table class="fl-tbl"><tr><th>Point</th><th>Prévu</th><th>Estimé</th><th>Réel</th><th>Carbu</th><th></th></tr>'+rows+'</table></div>'
    +'<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:end;font-size:.82em;margin-top:8px"><label>Carburant au décollage (L)<br><input type="number" id="flFuel0" value="'+(live.fuel0!=null?live.fuel0:'')+'" style="width:90px;padding:5px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"></label>'
    +'<span style="color:var(--text-secondary)">Consommation '+burn+' L/h · réserve '+resL.toFixed(0)+' L (en rouge en dessous). Heures en heure locale de l\'appareil.</span></div></div>';
  html+='<div class="nl-card"><div class="nl-card-title"><span class="icon">⛽</span> Minuteur de réservoir</div><div class="fl-btns">'
    +'<button class="navlog-btn" id="flTankG">Gauche maintenant</button><button class="navlog-btn" id="flTankD">Droit maintenant</button>'
    +'<label style="font-size:.85em">changer toutes les <input type="number" id="flTankEv" value="'+live.tank.every+'" min="5" max="120" style="width:60px;padding:5px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"> min</label>'
    +'<button class="navlog-btn" id="flTankOff">Arrêter</button></div><small style="color:var(--text-secondary)">Sur F150/F172 alimentés par BOTH, sers-t\'en comme rappel de vérification des jauges.</small></div>';
  html+='<div class="nl-card"><div class="nl-card-title"><span class="icon">⚙️</span> Alertes</div><div class="fl-btns" style="font-size:.85em">'
    +'<label><input type="checkbox" id="flVoice"'+(o.voice?' checked':'')+'> 🔊 Annonces vocales</label>'
    +'<label>Prévenir <input type="number" id="flLook" value="'+o.look+'" min="1" max="15" style="width:52px;padding:4px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"> min avant un espace</label>'
    +'<label>Plané : arrivée <input type="number" id="flMargin" value="'+o.margin+'" step="100" min="0" style="width:70px;padding:4px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"> ft sol, à <input type="number" id="flVg" value="'+(o.vg||acGlide().vg)+'" min="40" max="120" style="width:56px;padding:4px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"> kt, finesse '+acGlide().ratio+'</label></div>'
    +((S.log||[]).length?'<div style="font-size:.8em;max-height:160px;overflow:auto">'+S.log.map(function(x){ return '<div style="border-bottom:1px solid var(--border-color);padding:3px 0"><small>'+hm(x.t)+'</small> '+x.txt+'</div>'; }).join('')+'</div>':'')+'</div>';
  html+='<div class="nl-card"><div class="nl-card-title"><span class="icon">📼</span> Traces enregistrées</div><div id="flTracks"><small>…</small></div></div>';
  root.innerHTML=html;
  function $(id){ return root.querySelector('#'+id); }
  $('flStart').onclick=function(){ if(S.on) stop(); else start(); };
  $('flTo').onclick=function(){ if(live.takeoff&&!confirm('Recommencer le chronométrage du décollage ?')) return; live.takeoff=Date.now(); live.landing=null; var p0=stagePts(live.stage)[0]; if(p0) live.ata[p0.i]=live.takeoff; saveLive(); renderLive(); };
  $('flNear').onclick=showNearest; $('flGlide').onclick=function(){ toggleGlide(); renderLive(); };
  $('flReset').onclick=function(){ if(confirm('Effacer les heures réelles et repartir pour un nouveau vol ?')){ newLive(); renderLive(); } };
  if($('flStage')) $('flStage').onchange=function(){ live.stage=+this.value; live.takeoff=null; live.landing=null; saveLive(); renderLive(); };
  $('flFuel0').onchange=function(){ live.fuel0=this.value===''?null:+this.value; live.fuel0Set=true; saveLive(); renderLive(); };
  $('flTankG').onclick=function(){ live.tank.side='G'; live.tank.last=Date.now(); saveLive(); renderLive(); };
  $('flTankD').onclick=function(){ live.tank.side='D'; live.tank.last=Date.now(); saveLive(); renderLive(); };
  $('flTankEv').onchange=function(){ live.tank.every=Math.max(5,+this.value||30); saveLive(); };
  $('flTankOff').onclick=function(){ live.tank.last=null; saveLive(); renderLive(); };
  $('flVoice').onchange=function(){ setOpt('voice',this.checked); };
  $('flLook').onchange=function(){ setOpt('look',Math.max(1,+this.value||5)); };
  $('flMargin').onchange=function(){ setOpt('margin',Math.max(0,+this.value||0)); };
  $('flVg').onchange=function(){ setOpt('vg',+this.value||null); };
  listTracks().then(function(L0){
    var el=$('flTracks'); if(!el) return;
    L0=(L0||[]).sort(function(a,b){ return b.start-a.start; });
    el.innerHTML=L0.length?L0.map(function(t){ return '<div class="bp-row" style="cursor:default"><div style="flex:1"><b>'+esc(t.name)+'</b><br><small>'+new Date(t.start).toLocaleString('fr-BE')+' · '+mmss(t.end-t.start)+' · '+t.pts.length+' points</small></div>'
      +'<button class="navlog-btn" data-r="'+t.id+'">▶ Rejouer</button><button class="navlog-btn" data-g="'+t.id+'">GPX</button><button class="navlog-btn" data-k="'+t.id+'">KML</button><button class="navlog-btn" data-d="'+t.id+'">✕</button></div>'; }).join('')
      :'<p style="font-size:.8em;color:var(--text-secondary)">Aucune trace : démarre le GPS en vol, la trace s\'enregistre toute seule.</p>';
    function byId(id){ return L0.filter(function(t){ return t.id===id; })[0]; }
    el.querySelectorAll('[data-r]').forEach(function(b){ b.onclick=function(){ replay(byId(b.dataset.r)); }; });
    el.querySelectorAll('[data-g]').forEach(function(b){ b.onclick=function(){ var t=byId(b.dataset.g); saveFile('trace_'+new Date(t.start).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.gpx',gpx(t),'application/gpx+xml'); }; });
    el.querySelectorAll('[data-k]').forEach(function(b){ b.onclick=function(){ var t=byId(b.dataset.k); saveFile('trace_'+new Date(t.start).toISOString().slice(0,16).replace(/[:T]/g,'-')+'.kml',kml(t),'application/vnd.google-earth.kml+xml'); }; });
    el.querySelectorAll('[data-d]').forEach(function(b){ b.onclick=function(){ if(confirm('Supprimer cette trace ?')) dbDo('readwrite',function(st){ return st.delete(b.dataset.d); }).then(renderLive); }; });
  });
}

/* ---------- Boutons de la carte ---------- */
function updateBtns(){
  var b=document.getElementById('nlxGpsBtn'); if(b){ b.classList.toggle('active',S.on); b.textContent=S.on?'⏹️ GPS':'🛩️ Vol GPS'; }
  var g=document.getElementById('nlxGlideBtn'); if(g) g.classList.toggle('active',S.glideOn);
}
function addButtons(){
  var rows=document.querySelectorAll('#routeMapCard .rm-tb-row'); if(!rows.length||document.getElementById('nlxGpsBtn')) return;
  var r=rows[0], ref=r.querySelector('.rm-tb-info');
  [['nlxGpsBtn','🛩️ Vol GPS','Mode vol : position GPS, prochaine balise, écart de route, alertes d\'espaces aériens, trace enregistrée',function(){ if(S.on) stop(); else start(); }],
   ['nlxNearBtn','🛬 Plus proche','Les 5 aérodromes les plus proches (cap, distance, piste, fréquence)',showNearest],
   ['nlxGlideBtn','🪂 Plané','Cercle de plané : zone atteignable moteur coupé selon l\'altitude, la finesse et le vent. Sans GPS : promène la souris sur le tracé ou le profil d\'altitude',function(){ toggleGlide(); }]
  ].forEach(function(x){ var b=document.createElement('button'); b.className='navlog-btn'; b.id=x[0]; b.textContent=x[1]; b.title=x[2]; b.onclick=x[3]; r.insertBefore(b,ref); });
}
function init(){
  cssOnce(); addButtons(); renderLive();
  document.querySelectorAll('.navlog-tab').forEach(function(b){ if(/'vol'/.test(b.getAttribute('onclick')||'')) b.addEventListener('click',renderLive); });
  window.addEventListener('nl:recalc',function(){ var t=document.getElementById('tab-vol'); if(t&&t.classList.contains('active')) renderLiveSoft(); });
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
