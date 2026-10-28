/* === nav-traffic.js === Trafic réel ADS-B/MLAT sur la carte de route du Navlog (bouton « ✈️ Trafic »)
   Rendu proche de tar1090 / adsb.lol : couleur selon l'altitude (même échelle), traînées, étiquettes,
   fiche détaillée au clic (indicatif, immatriculation, type, exploitant, photo, route du vol, altitude,
   vario, vitesses, squawk, vent calculé, source…).
   Positions : api.adsb.lol (secours opendata.adsb.fi), qui n'autorisent pas l'appel depuis une page web
   (CORS) -> APK : requête native (CapacitorHttp) ; site web : relais Cloudflare Worker de l'appli
   (tools/traffic-relay, adresse publiée dans traffic_relay.json par le workflow deploy-traffic-relay.yml).
   Fiches avion : api.adsbdb.com et api.planespotters.net (appel direct autorisé). */
(function(){
'use strict';
var NLX=window.NLX=window.NLX||{};
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
var T={on:false,layer:null,trails:null,timer:null,until:0,fail:0,ac:{},sel:null,labels:true,info:{},relay:null,busy:false};
try{ T.labels=localStorage.getItem('trfLabels')!=='0'; }catch(e){}

/* ---------- échelle de couleurs tar1090 (teinte selon l'altitude, gris au sol) ---------- */
var HUE=[[2000,20],[10000,140],[40000,300]];
var LIG=[[0,53],[20,50],[32,54],[40,52],[46,51],[50,46],[60,43],[80,41],[120,41],[160,40],[180,40],[190,44],[198,50],[200,58],[240,58],[255,55],[266,55],[270,58],[280,58],[290,47],[300,43]];
function lerp(tab,x){ if(x<=tab[0][0]) return tab[0][1]; for(var i=1;i<tab.length;i++) if(x<=tab[i][0]) return tab[i-1][1]+(tab[i][1]-tab[i-1][1])*(x-tab[i-1][0])/(tab[i][0]-tab[i-1][0]); return tab[tab.length-1][1]; }
function altColor(a){
  if(a.gnd) return 'hsl(0,0%,62%)';
  if(a.ft==null) return 'hsl(0,0%,80%)';
  var h=lerp(HUE,a.ft); return 'hsl('+Math.round(h)+',88%,'+Math.round(lerp(LIG,h))+'%)';
}
function legendHtml(){
  var st=[0,1000,2000,4000,6000,8000,10000,20000,30000,40000];
  return '<div class="trf-legend">'+st.map(function(f){ return '<span style="background:'+altColor({ft:f})+'">'+(f>=10000?'FL'+f/100:f)+'</span>'; }).join('')+'<span style="background:hsl(0,0%,62%)">sol</span></div>';
}

/* ---------- icônes ---------- */
var SHAPES={
  plane:'M0,-11 L1.6,-4 L10,1.5 L10,3.5 L1.6,1.5 L1,7.5 L4,9.5 L4,11 L0,10 L-4,11 L-4,9.5 L-1,7.5 L-1.6,1.5 L-10,3.5 L-10,1.5 L-1.6,-4 Z',
  light:'M0,-9 L1.2,-3 L9,-2 L9,0.5 L1.2,1 L0.8,6 L3.5,7.5 L3.5,9 L0,8.3 L-3.5,9 L-3.5,7.5 L-0.8,6 L-1.2,1 L-9,0.5 L-9,-2 L-1.2,-3 Z',
  heavy:'M0,-13 L2,-5 L13,2.5 L13,4.5 L2,2 L1.3,9 L5,11.5 L5,13 L0,12 L-5,13 L-5,11.5 L-1.3,9 L-2,2 L-13,4.5 L-13,2.5 L-2,-5 Z',
  heli:'M0,-8 C3,-8 4,-4 4,0 C4,4 2,6 0,6 L0.6,12 L3,12.5 L3,13.5 L-3,13.5 L-3,12.5 L-0.6,12 L0,6 C-2,6 -4,4 -4,0 C-4,-4 -3,-8 0,-8 Z M-11,-1 L11,1 M-1,-11 L1,11',
  glider:'M0,-6 L0.8,-1 L13,0 L13,1.3 L0.8,1.5 L0.5,7 L3,8.5 L3,9.5 L0,9 L-3,9.5 L-3,8.5 L-0.5,7 L-0.8,1.5 L-13,1.3 L-13,0 L-0.8,-1 Z'
};
function shapeFor(a){ var c=a.cat||''; if(c==='A7') return 'heli'; if(c==='B1') return 'glider'; if(c==='A1'||c==='B4') return 'light'; if(c==='A5'||c==='A4') return 'heavy'; return a.t&&/^(C1|C17|C82|PA|P28|DR|DA|SR2|TB|RF|MS|ULAC|ZLIN|CP|J3|DV)/.test(a.t)?'light':'plane'; }
function icon(a,sel){
  var col=altColor(a), sh=SHAPES[shapeFor(a)], sz=sel?34:26, lab='';
  if(T.labels||sel) lab='<div class="trf-lab">'+esc((a.cs||a.r||a.hex).trim())+'<br>'+(a.gnd?'sol':a.ft!=null?(a.ft>=10000?'FL'+('00'+Math.round(a.ft/100)).slice(-3):Math.round(a.ft/100)*100):'?')+(a.vr>300?' ↑':a.vr<-300?' ↓':'')+'</div>';
  return L.divIcon({className:'trf-ic',iconSize:[sz,sz],iconAnchor:[sz/2,sz/2],
    html:'<svg width="'+sz+'" height="'+sz+'" viewBox="-14 -14 28 28" style="transform:rotate('+(a.trk||0)+'deg)"><path d="'+sh+'" fill="'+col+'" stroke="'+(sel?'#fff':'#000')+'" stroke-width="'+(sel?1.6:1)+'"'+(/heli/.test(shapeFor(a))?' stroke-linejoin="round"':'')+'/></svg>'+lab+(a.sq==='7700'||a.sq==='7600'||a.sq==='7500'?'<div class="trf-sq">'+a.sq+'</div>':'')});
}

/* ---------- récupération ---------- */
function isNative(){ return !!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform()&&window.Capacitor.Plugins&&window.Capacitor.Plugins.CapacitorHttp); }
function nativeGet(url){ return window.Capacitor.Plugins.CapacitorHttp.get({url:url,headers:{Accept:'application/json'}}).then(function(r){ if(r.status&&r.status>=400) throw new Error('HTTP '+r.status); return typeof r.data==='string'?JSON.parse(r.data):r.data; }); }
function relayUrl(){
  if(T.relay!=null) return Promise.resolve(T.relay);
  var manual=''; try{ manual=localStorage.getItem('trafficRelay')||''; }catch(e){}
  if(window.TRAFFIC_RELAY||manual){ T.relay=(window.TRAFFIC_RELAY||manual).replace(/\/+$/,''); return Promise.resolve(T.relay); }
  return fetch('traffic_relay.json',{cache:'no-cache'}).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; })
    .then(function(d){ T.relay=(d&&d.url||'').replace(/\/+$/,''); return T.relay; });
}
function norm(a){
  var gnd=a.alt_baro==='ground', ft=gnd?0:(typeof a.alt_baro==='number'?a.alt_baro:(typeof a.alt_geom==='number'?a.alt_geom:null));
  return {hex:a.hex,cs:(a.flight||'').trim(),r:a.r||'',t:a.t||'',desc:a.desc||'',lat:a.lat,lon:a.lon,ft:ft,geo:a.alt_geom,gnd:gnd,gs:a.gs,ias:a.ias,tas:a.tas,mach:a.mach,
    trk:a.track!=null?a.track:(a.true_heading!=null?a.true_heading:a.mag_heading),hdg:a.true_heading!=null?a.true_heading:a.mag_heading,vr:a.baro_rate!=null?a.baro_rate:a.geom_rate,
    sq:a.squawk||'',em:a.emergency&&a.emergency!=='none'?a.emergency:'',cat:a.category||'',qnh:a.nav_qnh,sel:a.nav_altitude_mcp||a.nav_altitude_fms,ws:a.ws,wd:a.wd,oat:a.oat,
    src:(a.mlat&&a.mlat.length)?'MLAT':(a.tisb&&a.tisb.length)?'TIS-B':/^adsr/.test(a.type||'')?'ADS-R':/^mode_s/.test(a.type||'')?'Mode S':'ADS-B',
    seen:a.seen_pos!=null?a.seen_pos:a.seen,mil:!!(a.dbFlags&1),own:a.ownOp||'',year:a.year||''};
}
function fetchTraffic(){
  var map=NL.routeMap, c=map.getCenter(), b=map.getBounds().pad(0.1);
  var dist=Math.min(150,Math.max(10,Math.round(NL.haversine(c.lat,c.lng,b.getNorth(),b.getEast()))));
  var la=c.lat.toFixed(3), lo=c.lng.toFixed(3);
  if(isNative()){
    return nativeGet('https://api.adsb.lol/v2/lat/'+la+'/lon/'+lo+'/dist/'+dist).then(function(d){ return {src:'adsb.lol',ac:d.ac||[]}; })
      .catch(function(){ return nativeGet('https://opendata.adsb.fi/api/v2/lat/'+la+'/lon/'+lo+'/dist/'+dist).then(function(d){ return {src:'adsb.fi',ac:d.aircraft||d.ac||[]}; }); });
  }
  return relayUrl().then(function(u){
    if(!u) throw {noRelay:true};
    return fetch(u+'/traffic/'+la+'/'+lo+'/'+dist).then(function(r){ if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); }).then(function(d){ return {src:d.src||'relais',ac:d.ac||[]}; });
  });
}

/* ---------- affichage ---------- */
function cssOnce(){
  if(document.getElementById('trfCss')) return;
  var s=document.createElement('style'); s.id='trfCss';
  s.textContent='.trf-ic{background:none;border:none}.trf-ic svg{display:block;overflow:visible;filter:drop-shadow(0 0 1px rgba(0,0,0,.6))}'
    +'.trf-lab{position:absolute;left:100%;top:-2px;margin-left:2px;white-space:nowrap;font:700 10px/11px system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.55);padding:1px 3px;border-radius:4px;pointer-events:none}'
    +'.trf-sq{position:absolute;left:0;top:100%;font:800 10px sans-serif;color:#fff;background:#d50000;padding:0 3px;border-radius:3px}'
    +'.trf-legend{display:flex;border-radius:6px;overflow:hidden;margin:4px 0}.trf-legend span{flex:1;font:700 9px sans-serif;color:#000;text-align:center;padding:2px 0}'
    +'.trf-bar{position:absolute;left:8px;top:8px;z-index:1000;background:rgba(15,15,25,.88);color:#fff;border-radius:10px;padding:6px 8px;font:600 11px system-ui,sans-serif;width:300px;max-width:calc(100% - 70px)}'
    +'.trf-bar button,.trf-panel button{background:#333;color:#fff;border:1px solid #555;border-radius:7px;padding:2px 8px;cursor:pointer;font-size:11px}'
    +'.trf-panel{position:absolute;right:8px;top:8px;z-index:1002;width:320px;max-width:calc(100% - 16px);max-height:calc(100% - 16px);overflow:auto;background:rgba(15,15,25,.95);color:#fff;border-radius:12px;padding:10px 12px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.5)}'
    +'.trf-panel h3{margin:0;font-size:1.25em}.trf-panel table{width:100%;border-collapse:collapse;margin-top:6px}.trf-panel td{padding:2px 4px;border-bottom:1px solid #333;vertical-align:top}.trf-panel td:first-child{color:#aaa;width:42%}'
    +'.trf-panel img{width:100%;border-radius:8px;margin-top:6px;display:block}.trf-panel a{color:#82b1ff}'
    +'@media(max-width:640px){.trf-panel{top:auto;bottom:8px;left:8px;right:8px;width:auto;max-height:60%}.trf-bar{width:auto;right:60px}}';
  document.head.appendChild(s);
}
function ensureBar(src,n){
  var mc=document.getElementById('routeMapContainer'), b=document.getElementById('trfBar');
  if(!b){ b=document.createElement('div'); b.id='trfBar'; b.className='trf-bar'; ['mousedown','touchstart','dblclick','wheel','click'].forEach(function(ev){ b.addEventListener(ev,function(e){ e.stopPropagation(); }); }); mc.appendChild(b); }
  b.innerHTML='<div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><span>✈️ '+n+' aéronef(s) · '+esc(src)+'</span><span><button data-l>'+(T.labels?'Étiquettes ✓':'Étiquettes')+'</button> <button data-x>✕</button></span></div>'+legendHtml()
    +'<div style="color:#bbb;font-weight:500">Altitude en ft (FL au-dessus de 10 000) · touche un avion pour sa fiche</div>';
  b.querySelector('[data-x]').onclick=function(){ toggle(false); };
  b.querySelector('[data-l]').onclick=function(){ T.labels=!T.labels; try{ localStorage.setItem('trfLabels',T.labels?'1':'0'); }catch(e){} draw(); ensureBar(src,n); };
}
function draw(){
  if(!T.layer) return;
  T.layer.clearLayers(); T.trails.clearLayers();
  Object.keys(T.ac).forEach(function(h){
    var a=T.ac[h].a, tr=T.ac[h].tr, sel=T.sel===h;
    for(var i=1;i<tr.length;i++) T.trails.addLayer(L.polyline([[tr[i-1].lat,tr[i-1].lon],[tr[i].lat,tr[i].lon]],{color:altColor(tr[i]),weight:sel?4:2,opacity:sel?1:.7,interactive:false}));
    var m=L.marker([a.lat,a.lon],{icon:icon(a,sel),zIndexOffset:sel?1500:900});
    m.on('click',function(e){ if(e.originalEvent) L.DomEvent.stop(e.originalEvent); select(h); });
    T.layer.addLayer(m);
  });
}
function tick(){
  var map=NL.routeMap; if(!map||!T.on||T.busy) return;
  if(Date.now()>T.until){ toggle(false); NL.toast('✈️ Trafic arrêté après 20 min — touche « Trafic » pour relancer','info',3500); return; }
  T.busy=true;
  fetchTraffic().then(function(d){
    T.busy=false; if(!T.on) return; T.fail=0;
    var now=Date.now(), seen={};
    d.ac.forEach(function(x){
      var a=norm(x); if(a.lat==null||a.lon==null||(a.seen!=null&&a.seen>60)) return; seen[a.hex]=1;
      var e=T.ac[a.hex]||(T.ac[a.hex]={tr:[]}); e.a=a; e.t=now;
      var last=e.tr[e.tr.length-1]; if(!last||last.lat!==a.lat||last.lon!==a.lon) e.tr.push({lat:a.lat,lon:a.lon,ft:a.ft,gnd:a.gnd});
      if(e.tr.length>60) e.tr.shift();
    });
    Object.keys(T.ac).forEach(function(h){ if(!seen[h]&&now-T.ac[h].t>90000) delete T.ac[h]; });
    draw(); ensureBar(d.src,Object.keys(seen).length);
    if(T.sel) panel();
    var bt=document.getElementById('nlxTrfBtn'); if(bt) bt.textContent='✈️ Trafic ('+Object.keys(seen).length+')';
  }).catch(function(e){
    T.busy=false;
    if(e&&e.noRelay){ toggle(false); setupHelp(); return; }
    if(++T.fail>=3){ toggle(false); NL.toast('✈️ Trafic indisponible (hors ligne ou service saturé) — arrêté','error',4000); }
  });
}

/* ---------- fiche d'un avion ---------- */
var CAT={A1:'léger (< 7 t)',A2:'petit (7–34 t)',A3:'gros (34–136 t)',A4:'B757 (turbulence)',A5:'lourd (> 136 t)',A6:'haute performance',A7:'hélicoptère',B1:'planeur',B2:'ballon / dirigeable',B3:'parachutiste',B4:'ULM',B6:'drone',C1:'véhicule d’urgence',C2:'véhicule de service'};
function getInfo(a){
  var k=a.hex; if(T.info[k]) return T.info[k];
  var p={ac:null,route:null,photo:null};
  T.info[k]=Promise.all([
    fetch('https://api.adsbdb.com/v0/aircraft/'+k).then(function(r){ return r.ok?r.json():null; }).then(function(d){ p.ac=d&&d.response&&d.response.aircraft||null; }).catch(function(){}),
    a.cs?fetch('https://api.adsbdb.com/v0/callsign/'+encodeURIComponent(a.cs)).then(function(r){ return r.ok?r.json():null; }).then(function(d){ p.route=d&&d.response&&d.response.flightroute||null; }).catch(function(){}):null,
    fetch('https://api.planespotters.net/pub/photos/hex/'+k).then(function(r){ return r.ok?r.json():null; }).then(function(d){ var ph=d&&d.photos&&d.photos[0]; if(ph) p.photo={src:ph.thumbnail_large&&ph.thumbnail_large.src||ph.thumbnail&&ph.thumbnail.src,link:ph.link,by:ph.photographer}; }).catch(function(){})
  ]).then(function(){ return p; });
  return T.info[k];
}
function relTo(a){
  var out=[], c=NL.getConfig();
  try{ var d=NL.distAtLatLon(a.lat,a.lon), ll=d!=null?NL.latLonAtDist(d):null;
    if(ll){ var off=NL.haversine(a.lat,a.lon,ll.lat,ll.lon); if(off<10) out.push(off.toFixed(1)+' NM de ta route (à '+Math.round(d)+' NM du départ)'+(a.ft!=null&&!a.gnd?', '+(a.ft-(c.alt||0)>=0?'+':'')+Math.round((a.ft-(c.alt||0))/100)*100+' ft par rapport à ton altitude':'')); } }catch(e){}
  return out.join('');
}
function select(h){ T.sel=h; draw(); panel(); }
function panel(){
  var e=T.ac[T.sel], mc=document.getElementById('routeMapContainer'); if(!e||!mc) return;
  var a=e.a, p=document.getElementById('trfPanel');
  if(!p){ p=document.createElement('div'); p.id='trfPanel'; p.className='trf-panel'; ['mousedown','touchstart','dblclick','wheel','click'].forEach(function(ev){ p.addEventListener(ev,function(x){ x.stopPropagation(); }); }); mc.appendChild(p); }
  function row(k,v){ return v===''||v==null?'':'<tr><td>'+k+'</td><td>'+v+'</td></tr>'; }
  var sqTxt={'7700':' — DÉTRESSE','7600':' — PANNE RADIO','7500':' — INTERVENTION ILLICITE','7000':' (VFR)','2000':''}[a.sq]||'';
  p.innerHTML='<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3 style="color:'+altColor(a)+'">'+esc(a.cs||a.r||a.hex.toUpperCase())+'</h3><div>'+esc(a.r)+(a.t?' · '+esc(a.t):'')+(a.mil?' · <b style="color:#ff5252">militaire</b>':'')+'</div></div><button data-x>✕</button></div>'
    +'<div data-info style="color:#bbb">⏳ fiche de l’appareil…</div>'
    +'<table>'
    +row('Altitude',a.gnd?'au sol':(a.ft!=null?Math.round(a.ft).toLocaleString('fr-BE')+' ft baro':'—')+(a.geo!=null?' · '+Math.round(a.geo).toLocaleString('fr-BE')+' ft GNSS':''))
    +row('Vario',a.vr!=null?(a.vr>0?'↑ +':a.vr<0?'↓ ':'')+Math.round(a.vr)+' ft/min':'')
    +row('Vitesse sol',a.gs!=null?Math.round(a.gs)+' kt':'')
    +row('Vitesses air',[a.ias!=null?'IAS '+Math.round(a.ias)+' kt':'',a.tas!=null?'TAS '+Math.round(a.tas)+' kt':'',a.mach?'Mach '+a.mach.toFixed(2):''].filter(Boolean).join(' · '))
    +row('Route / cap',(a.trk!=null?Math.round(a.trk)+'° vrai':'')+(a.hdg!=null&&a.hdg!==a.trk?' · cap '+Math.round(a.hdg)+'°':''))
    +row('Squawk',a.sq?'<b'+(sqTxt.indexOf('—')>0?' style="color:#ff5252"':'')+'>'+esc(a.sq)+'</b>'+sqTxt:'')
    +row('Urgence',a.em?'<b style="color:#ff5252">'+esc(a.em)+'</b>':'')
    +row('Altitude affichée (AP)',a.sel?Math.round(a.sel).toLocaleString('fr-BE')+' ft':'')
    +row('QNH réglé',a.qnh?Math.round(a.qnh)+' hPa':'')
    +row('Vent calculé',a.ws!=null&&a.wd!=null?Math.round(a.wd)+'° / '+Math.round(a.ws)+' kt'+(a.oat!=null?' · OAT '+Math.round(a.oat)+' °C':''):'')
    +row('Catégorie',CAT[a.cat]||esc(a.cat))
    +row('Source',esc(a.src)+(a.seen!=null?' · position il y a '+Math.round(a.seen)+' s':''))
    +row('Par rapport à toi',relTo(a))
    +row('Mode S',esc(a.hex.toUpperCase()))
    +'</table><div style="margin-top:6px"><a href="https://adsb.lol/?icao='+esc(a.hex)+'" target="_blank" rel="noopener">Voir sur adsb.lol</a></div>';
  p.querySelector('[data-x]').onclick=function(){ T.sel=null; p.remove(); draw(); };
  var k=a.hex;
  getInfo(a).then(function(i){
    var box=p.querySelector('[data-info]'); if(!box||T.sel!==k) return;
    var h='';
    if(i.ac) h+='<div style="color:#fff">'+esc([i.ac.manufacturer,i.ac.type].filter(Boolean).join(' '))+'</div><div>'+esc(i.ac.registered_owner||'')+(i.ac.registered_owner_country_name?' · '+esc(i.ac.registered_owner_country_name):'')+'</div>';
    if(i.route){ var o=i.route.origin||{}, d=i.route.destination||{}; h+='<div style="color:#fff;margin-top:3px">🛫 '+esc((o.iata_code||o.icao_code||'')+' '+(o.municipality||o.name||''))+' → 🛬 '+esc((d.iata_code||d.icao_code||'')+' '+(d.municipality||d.name||''))+'</div>'+(i.route.airline?'<div>'+esc(i.route.airline.name||'')+'</div>':''); }
    var src=i.photo&&i.photo.src||(i.ac&&i.ac.url_photo_thumbnail);
    if(src) h+='<img src="'+esc(src)+'" alt="" loading="lazy">'+(i.photo?'<small>© '+esc(i.photo.by||'')+' — <a href="'+esc(i.photo.link||'#')+'" target="_blank" rel="noopener">planespotters.net</a></small>':'');
    box.innerHTML=h||'<small>Pas de fiche publique pour cet appareil.</small>';
  });
}

/* ---------- mise en route ---------- */
function setupHelp(){
  var m=NLX.modal('✈️ Trafic en direct sur ordinateur',
    '<p style="font-size:.88em">Les services de trafic gratuits (adsb.lol, adsb.fi, OpenSky) interdisent aux pages web de lire leurs données directement (règle CORS des navigateurs). '
    +'L’appli Android n’est pas concernée. Sur ordinateur, l’appli passe par son propre petit <b>relais</b> (Cloudflare, gratuit), qui n’est pas encore en service.</p>'
    +'<p style="font-size:.88em">En attendant : <button class="navlog-btn" data-o>Ouvrir adsb.lol centré sur la carte</button></p>'
    +'<p style="font-size:.82em;color:var(--text-secondary)">Adresse d’un relais déjà en service (sinon laisse vide) :</p>'
    +'<div style="display:flex;gap:6px"><input data-u placeholder="https://….workers.dev" style="flex:1;padding:6px 8px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"><button class="navlog-btn" data-s>Enregistrer</button></div>');
  m.querySelector('[data-o]').onclick=function(){ var c=NL.routeMap.getCenter(); window.open('https://adsb.lol/?lat='+c.lat.toFixed(4)+'&lon='+c.lng.toFixed(4)+'&zoom='+Math.max(7,Math.min(12,NL.routeMap.getZoom())),'_blank','noopener'); };
  m.querySelector('[data-s]').onclick=function(){ var u=m.querySelector('[data-u]').value.trim(); if(!/^https:\/\//.test(u)) return; try{ localStorage.setItem('trafficRelay',u); }catch(e){} T.relay=null; m.remove(); toggle(true); };
}
function toggle(on){
  var map=NL.routeMap; if(!map) return; cssOnce();
  if(on==null) on=!T.on;
  T.on=on; clearInterval(T.timer);
  var bt=document.getElementById('nlxTrfBtn'); if(bt){ bt.classList.toggle('active',on); if(!on) bt.textContent='✈️ Trafic'; }
  if(!on){
    if(T.layer){ map.removeLayer(T.layer); map.removeLayer(T.trails); } T.layer=T.trails=null; T.ac={}; T.sel=null;
    ['trfBar','trfPanel'].forEach(function(id){ var x=document.getElementById(id); if(x) x.remove(); });
    if(T.moveH){ map.off('moveend',T.moveH); T.moveH=null; }
    return;
  }
  T.trails=L.layerGroup().addTo(map); T.layer=L.layerGroup().addTo(map);
  T.until=Date.now()+20*60000; T.fail=0;
  tick(); T.timer=setInterval(tick,10000);
  T.moveH=function(){ clearTimeout(T.mt); T.mt=setTimeout(tick,600); }; map.on('moveend',T.moveH);
}
NLX.toggleTraffic=toggle;
})();
