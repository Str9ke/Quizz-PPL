/* === nav-brief.js === Briefing complémentaire du Navlog (navlog.html, via le pont window.NL)
   - Encart « Points à vérifier pour ce vol » (onglet Navlog) : jour/nuit, météo de la route,
     terrains (carburant, horaires d'ouverture, PPR, douane) d'après les fiches AIP officielles,
     passages de frontière, activité militaire / oiseaux / parachutage / drones du jour (NOTAM,
     avis du jour skeyes), SUP AIP France, validités du pilote.
   - Bouton « 🔒 PPR » : terrains soumis à autorisation préalable (FR, BE, LU, NL, DE, GB),
     ppr_aerodromes.json (tools/fetch_ppr.py).
   - Bouton « ✈️ Trafic » : trafic réel autour de la carte (OpenSky Network), au sol avant le vol.
   - Onglet Pilote : validités (médical, licence, SEP, anglais) + expérience récente (3 atterrissages / 90 j).
   - Check-lists normales F150M / F172M à cocher (textes des manuels de vol Reims/Cessna).
   - Sections ajoutées au dossier PDF consolidé (NLX.dossierExtra). */
(function(){
'use strict';
var NLX=window.NLX=window.NLX||{};
function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function lsGet(k,d){ try{ var v=JSON.parse(localStorage.getItem(k)||'null'); return v==null?d:v; }catch(e){ return d; } }
function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
function hmLoc(d){ return NLX.hmLoc?NLX.hmLoc(d):(d?d.toLocaleTimeString():'—'); }
function getJSON(u){ return fetch(u).then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; }); }
var cache={};
function once(u){ if(!cache[u]) cache[u]=getJSON(u); return cache[u]; }

function cssOnce(){
  if(document.getElementById('nlxBriefCss')) return;
  var s=document.createElement('style'); s.id='nlxBriefCss';
  s.textContent='.bp-sec{margin:8px 0 2px;font-weight:700;font-size:.86em}.bp-it{font-size:.8em;padding:4px 8px;border-radius:8px;margin:3px 0;border-left:3px solid #4caf50;background:rgba(76,175,80,.07)}'
    +'.bp-it.w{border-color:#ffa726;background:rgba(255,167,38,.09)}.bp-it.b{border-color:#ef5350;background:rgba(239,83,80,.09)}.bp-it.i{border-color:#64b5f6;background:rgba(100,181,246,.07)}'
    +'.bp-it small{color:var(--text-secondary)}.bp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 14px}'
    +'.bp-ad{font-size:.8em;border:1px solid var(--border-color);border-radius:10px;padding:7px 9px}.bp-ad h4{margin:0 0 4px;font-size:1em}.bp-links a{color:var(--link-color);margin-right:8px}'
    +'.bp-tag{display:inline-block;border-radius:8px;padding:0 7px;margin:1px 3px 1px 0;font-size:.92em;font-weight:700}.bp-ok{background:rgba(76,175,80,.18);color:#4caf50}'
    +'.bp-wa{background:rgba(255,167,38,.2);color:#ffa726}.bp-ba{background:rgba(239,83,80,.2);color:#ef5350}.bp-in{background:rgba(100,181,246,.18);color:#64b5f6}'
    +'.bp-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10050;display:flex;align-items:center;justify-content:center;padding:12px}'
    +'.bp-box{background:var(--card-bg,#1d1d27);color:var(--text-primary,#eee);border-radius:14px;max-width:820px;width:100%;max-height:88vh;display:flex;flex-direction:column;border:1px solid var(--border-color)}'
    +'.bp-box header{display:flex;gap:8px;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border-color);flex-wrap:wrap}.bp-box header b{flex:1}'
    +'.bp-box .bp-body{overflow:auto;padding:8px 12px}.bp-box input,.bp-box select{padding:6px 8px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit}'
    +'.bp-row{display:flex;gap:8px;align-items:baseline;border-bottom:1px solid var(--border-color);padding:5px 0;font-size:.82em;cursor:pointer}.bp-row:hover{background:rgba(102,126,234,.08)}'
    +'.ck-sec{margin-top:8px}.ck-sec h4{margin:6px 0 3px;font-size:.88em;color:#667eea}.ck-it{display:flex;gap:8px;align-items:flex-start;font-size:.84em;padding:4px 6px;border-radius:7px;cursor:pointer}'
    +'.ck-it:hover{background:rgba(102,126,234,.08)}.ck-it.done{color:var(--text-secondary);text-decoration:line-through}.ck-it input{margin-top:2px}'
    +'.pv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.pv-grid label{font-size:.8em;color:var(--text-secondary);display:block}'
    +'.pv-grid input,.pv-grid select,#pilotRoot textarea{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit}'
    +'.pv-tbl{width:100%;border-collapse:collapse;font-size:.8em}.pv-tbl td,.pv-tbl th{border-bottom:1px solid var(--border-color);padding:4px 6px;text-align:left}';
  document.head.appendChild(s);
}
function modal(title,bodyHtml,tools){
  cssOnce();
  var m=document.createElement('div'); m.className='bp-modal';
  m.innerHTML='<div class="bp-box"><header><b>'+title+'</b>'+(tools||'')+'<button class="navlog-btn" data-x>✕</button></header><div class="bp-body">'+bodyHtml+'</div></div>';
  m.addEventListener('click',function(e){ if(e.target===m||e.target.hasAttribute('data-x')) m.remove(); });
  document.body.appendChild(m); return m;
}
NLX.modal=modal;

/* ---------- Fiches AIP : horaires, carburant, PPR, douane ---------- */
function isDST(d){
  var y=d.getUTCFullYear();
  function lastSun(m){ var t=new Date(Date.UTC(y,m+1,0,1)); t.setUTCDate(t.getUTCDate()-t.getUTCDay()); return t; }
  return d>=lastSun(2)&&d<lastSun(9);
}
function sec(ad,n){ var s=(ad&&ad.s||[]).filter(function(x){ return x.n===n; })[0]; return s?s.x:''; }
/* valeur d'une rubrique AIP (« Libellé | valeur FR | valeur EN ») : la partie française, '' si la rubrique est vide */
function line(txt,re){ var L=(txt||'').split('\n'); for(var i=0;i<L.length;i++) if(re.test(L[i])){ var v=L[i].split('|').slice(1); return (v[0]||'').trim(); } return ''; }
function parseFuel(ad){
  var t=sec(ad,'2.4'), l=line(t,/^(Fuel types|Types de carburants|Carburants)/i)||t;
  var f=[]; if(/100\s?LL/i.test(l)) f.push('AVGAS 100LL'); if(/UL\s?91/i.test(l)) f.push('UL91'); if(/JET\s?A-?1/i.test(l)) f.push('JET A1'); if(/MOGAS|SP\s?9[58]/i.test(l)) f.push('MOGAS');
  var nil=!f.length&&/\bNIL\b|none|aucun/i.test(l);
  var h=line(sec(ad,'2.3'),/^(Avitaillement|Fuelling)/i);
  return {list:f,nil:nil,hours:h,raw:l.slice(0,160)};
}
function parseHours(ad,when){
  var t=sec(ad,'2.3'); if(!t) return null;
  var txt=line(t,/^(AD Operator|Gestionnaire de l'AD|AD Administration)/i);
  if(!txt||/^H\s?24/i.test(txt)){ var ats=line(t,/^(ATS)\b/i); if(ats&&!/^H\s?24/i.test(ats)) txt=ats; else if(!txt) txt=ats; }
  /* AIP belges des petits terrains : horaires sur la première ligne, sans libellé */
  if(!txt&&!/\|/.test(t.split('\n')[0])) txt=t.split('\n')[0];
  if(!txt) return null;
  var res={raw:txt.slice(0,240),h24:/^\s*H\s?24/i.test(txt),ppr:/\bPPR\b|prior permission/i.test(t),onReq:/\bO\/R\b|on request|sur demande/i.test(txt),
    ss:/not later than SS|SS\b|coucher/i.test(txt)&&!/SR-SS/.test(txt),hj:/\bHJ\b|SR-SS/i.test(txt),customs:line(t,/^(Customs|Douanes)/i)};
  var summer=isDST(when), rng=[], m, re=/(\d{4})\s*(?:-|à|to)\s*(\d{4})(?:\s*\((\d{4})\s*(?:-|to)\s*(\d{4})\))?/g;
  while((m=re.exec(txt))) rng.push(summer&&m[3]?[m[3],m[4]]:[m[1],m[2]]);
  var m2=/from\s+(\d{4})\s*\((\d{4})\)\s*to\s+(\d{4})\s*\((\d{4})\)/i.exec(txt);
  if(m2) rng.push(summer?[m2[2],m2[4]]:[m2[1],m2[3]]);
  res.ranges=rng.map(function(r){ function mn(s){ return +s.slice(0,2)*60+ +s.slice(2); } return [mn(r[0]),mn(r[1])]; });
  var wd=when.getUTCDay();
  res.weekdaysOnly=/(MON|LUN)\s*(-|à|TO)\s*(FRI|VEN)/i.test(txt)&&!/(SAT|SAM|SUN|DIM|WE\b|week-?end)/i.test(txt);
  res.weekend=wd===0||wd===6;
  return res;
}
/* Ouvert à l'heure prévue ? -> {lvl:0 ok,1 à vérifier,2 fermé probable, txt} */
function openCheck(h,when,sunset){
  if(!h) return {lvl:1,txt:'horaires : voir la carte VAC'};
  if(h.h24) return {lvl:0,txt:'ouvert H24'};
  if(h.weekdaysOnly&&h.weekend) return {lvl:2,txt:'ouvert en semaine seulement'+(h.onReq?' (sur demande le week-end)':'')};
  var m=when.getUTCHours()*60+when.getUTCMinutes();
  if(h.ranges.length){
    var inside=h.ranges.some(function(r){ return r[0]<=r[1]?(m>=r[0]&&m<=r[1]):(m>=r[0]||m<=r[1]); });
    if(inside&&h.ss&&sunset&&when>sunset) return {lvl:2,txt:'fermé après le coucher du soleil'};
    if(!inside) return {lvl:h.onReq||h.ppr?1:2,txt:'hors horaires publiés'+(h.onReq?' : ouverture sur demande (O/R)':h.ppr?' : PPR':'')};
    return {lvl:0,txt:'ouvert à l\'heure prévue'};
  }
  if(h.hj&&sunset&&when>sunset) return {lvl:2,txt:'ouvert de jour seulement (HJ)'};
  return {lvl:1,txt:'horaires à vérifier'};
}
function aipFor(icao){
  return once('aip_ad/index.json').then(function(ix){
    if(!ix||!ix.ad||!ix.ad[icao]||!ix.ad[icao].aip) return null;
    return once('aip_ad/'+icao+'.json');
  });
}
function oaAirport(oa,icao){ return ((oa&&oa.airports)||[]).filter(function(a){ return a.icaoCode===icao; })[0]; }

/* Terrains du vol : départ, escales, arrivée, dégagements choisis */
function stageOf(i){ var sg=NL.stageSegs(); for(var k=0;k<sg.length;k++) if(sg[k].indexOf(i)>=0) return k; return 0; }
function fieldsOfFlight(){
  var pts=NL.flightPoints(), out=[], seen={}, nStages=NL.stageSegs().length;
  pts.forEach(function(p,k){
    if(!p.ad) return; var c=(p.name||'').trim().toUpperCase(); if(!/^[A-Z]{4}$/.test(c)) return;
    var role=k===0?'Départ':(k===pts.length-1?'Arrivée':'Escale');
    var key=c+role; if(seen[key]) return; seen[key]=1;
    out.push({icao:c,role:role,time:p.time,lat:p.lat,lon:p.lon});
    var w=NL.waypoints[p.i]; (w&&w._altn||[]).forEach(function(a,j){ if(a&&!seen['A'+a]){ seen['A'+a]=1; out.push({icao:a,role:'Dégagement D'+(j+1)+(nStages>1?' (étape '+(stageOf(p.i)+1)+')':''),time:p.time,altn:true}); } });
  });
  return out;
}

function adCards(){
  var F=fieldsOfFlight(); if(!F.length) return Promise.resolve({html:'',alerts:[]});
  return Promise.all([NL.loadOpenaip(),once('ppr_aerodromes.json')].concat(F.map(function(f){ return aipFor(f.icao); }))).then(function(r){
    var oa=r[0], ppr=(r[1]&&r[1].items)||[], alerts=[], html='';
    F.forEach(function(f,k){
      var ad=r[k+2], o=oaAirport(oa,f.icao), pp=ppr.filter(function(x){ return x.icao===f.icao; })[0];
      var nm=(o&&o.name)||(window.AERODROMES_DATA&&AERODROMES_DATA[f.icao]&&AERODROMES_DATA[f.icao].name)||'';
      var lat=f.lat||(o&&o.geometry.coordinates[1]), lon=f.lon||(o&&o.geometry.coordinates[0]);
      var sunset=lat&&NLX.nightLimits?NLX.nightLimits(f.icao,lat,lon,f.time).sun.set:null;
      var tags='', lines=[];
      var isPpr=(pp&&pp.ppr)||(o&&o.ppr), isPriv=(pp&&pp.priv)||(o&&o.private);
      if(isPpr) tags+='<span class="bp-tag bp-wa">🔒 PPR</span>';
      else if(pp&&pp.cond) tags+='<span class="bp-tag bp-in" title="'+esc(pp.aip||'')+'">🔒 PPR pour certains vols</span>';
      if(isPriv) tags+='<span class="bp-tag bp-wa">privé</span>';
      if(ad){
        var fu=parseFuel(ad), h=parseHours(ad,f.time), oc=openCheck(h,f.time,sunset);
        tags+=fu.list.length?'<span class="bp-tag bp-ok">⛽ '+esc(fu.list.join(' · '))+'</span>':fu.nil?'<span class="bp-tag bp-ba">⛽ pas de carburant</span>':'<span class="bp-tag bp-in">⛽ non précisé</span>';
        tags+='<span class="bp-tag '+(oc.lvl===2?'bp-ba':oc.lvl?'bp-wa':'bp-ok')+'">🕑 '+esc(oc.txt)+'</span>';
        lines.push('<b>Horaires (UTC, AIP 2.3)</b> : '+esc(h?h.raw:'—'));
        if(fu.hours) lines.push('<b>Avitaillement</b> : '+esc(fu.hours.slice(0,140)));
        if(fu.raw&&!fu.list.length) lines.push('<b>Carburant</b> : '+esc(fu.raw));
        if(h&&h.customs) lines.push('<b>Douane</b> : '+esc(h.customs.slice(0,140)));
        if(pp&&pp.aip) lines.push('<b>PPR (AIP)</b> : …'+esc(pp.aip)+'…');
        if(oc.lvl&&!f.altn) alerts.push({lvl:oc.lvl,txt:f.icao+' ('+f.role.toLowerCase()+' '+hmLoc(f.time)+') : '+oc.txt});
        if(f.role==='Arrivée'||/Escale/.test(f.role)){ if(!fu.list.length) alerts.push({lvl:1,txt:f.icao+' : pas d\'AVGAS annoncé dans l\'AIP — prévois le carburant du retour'}); }
      } else {
        tags+='<span class="bp-tag bp-in">pas de fiche AIP : voir la carte VAC</span>';
      }
      if(isPpr&&!f.altn) alerts.push({lvl:1,txt:f.icao+' : terrain PPR — demande l\'autorisation avant le vol'});
      var vac=NL.vacLinks?NL.vacLinks(f.icao):'';   /* liens HTML (SIA / skeyes) */
      html+='<div class="bp-ad"><h4>'+esc(f.role)+' · '+esc(f.icao)+' <small>'+esc(nm)+'</small>'+(f.altn?'':' <small>· '+hmLoc(f.time)+'</small>')+'</h4>'+tags
        +(lines.length?'<div style="margin-top:4px;color:var(--text-secondary)">'+lines.join('<br>')+'</div>':'')
        +'<div class="bp-links" style="margin-top:3px">'+(ad&&ad.url?'<a href="'+esc(ad.url)+'" target="_blank" rel="noopener" style="color:var(--link-color)">Fiche AIP officielle</a> ':'')+(vac||'')+'</div></div>';
    });
    return {html:'<div class="bp-grid">'+html+'</div>',alerts:alerts};
  });
}

/* ---------- Frontières ---------- */
var CC_NAMES={FR:'France',BE:'Belgique',NL:'Pays-Bas',DE:'Allemagne',LU:'Luxembourg',GB:'Royaume-Uni',CH:'Suisse'};
var SCHENGEN={FR:1,BE:1,NL:1,DE:1,LU:1,CH:1};
function firCountry(name){ var n=(name||'').toUpperCase(); if(/LFFF|LFEE|LFRR|LFBB|LFMM|PARIS|REIMS|BREST/.test(n)) return 'FR'; if(/\bED[A-Z]{2}\b|LANGEN|BREMEN|MUNCHEN/.test(n)) return 'DE'; if(/EHAA|AMSTERDAM/.test(n)) return 'NL'; if(/SWISS|LSAS/.test(n)) return 'CH'; return null; }
function borders(){
  return NL.loadOpenaip().then(function(oa){
    if(!oa) return [];
    var firs=oa.airspaces.filter(function(a){ return a.type===10; }), aps=oa.airports.filter(function(a){ return a.country&&a.geometry; });
    var S=NL.routeSamples().filter(function(p,i){ return i%3===0; }), seq=[];
    S.forEach(function(p){
      var cc=null;
      for(var i=0;i<firs.length&&!cc;i++) if(NL.inAirspace(firs[i],p.lat,p.lon)) cc=firCountry(firs[i].name);
      if(!cc){ var best=1e9; aps.forEach(function(a){ var c=a.geometry.coordinates, d=(c[1]-p.lat)*(c[1]-p.lat)+((c[0]-p.lon)*0.64)*((c[0]-p.lon)*0.64); if(d<best){ best=d; cc=a.country; } }); }
      seq.push({cc:cc,d:p.d});
    });
    /* lissage : un pays doit durer au moins 2 échantillons (pas d'aller-retour dû à l'aérodrome le plus proche) */
    var out=[], cur=seq.length?seq[0].cc:null;
    for(var k=1;k<seq.length;k++){
      if(seq[k].cc&&seq[k].cc!==cur&&(k+1>=seq.length||seq[k+1].cc===seq[k].cc)){
        var d=(seq[k-1].d+seq[k].d)/2, ll=NL.latLonAtDist(d), st=sinceTakeoff(d);
        out.push({from:cur,to:seq[k].cc,d:d,lat:ll&&ll.lat,lon:ll&&ll.lon,st:st}); cur=seq[k].cc;
      }
    }
    return out;
  });
}
/* depuis le dernier décollage (départ ou escale) jusqu'à la distance d le long de la route :
   terrain, NM, minutes (temps de vol du Navlog) et heure prévue */
function sinceTakeoff(d){
  var w=NL.waypoints, cum=0, st={name:(w[0]&&w[0].name)||'départ',d:0,eta:0,i:0,stop:false};
  for(var i=1;i<w.length;i++){
    var leg=+w[i].dist||0, nd=cum+leg;
    if(nd>=d&&leg>0){
      var e0=+(w[i-1]._eta||0), e1=+(w[i]._eta||0), f=(d-cum)/leg, eta=e0+(e1-e0)*f;
      var dep=new Date((NL.getConfig().flightDate||NL.today())+'T'+(NL.getConfig().depTime||'09:00')+':00').getTime()+(NL.getConfig().fuelTaxiD||0)*60000;
      var t=NLX.routeSamplesTimed?(function(){ var S=NLX.routeSamplesTimed(2), best=null; S.forEach(function(p){ if(!best||Math.abs(p.d-d)<Math.abs(best.d-d)) best=p; }); return best&&best.time; })():new Date(dep+eta*60000);
      return {from:(st.name||'').trim(),stop:st.stop,nm:d-st.d,min:eta-st.eta,time:t};
    }
    cum=nd;
    if(i<w.length-1&&(w[i].isEtape||NL.isStageEnd(i))) st={name:w[i].name,d:cum,eta:+(w[i]._eta||0),i:i,stop:true};
  }
  return {from:st.name,stop:st.stop,nm:d-st.d,min:0,time:null};
}
var FIS={BE:'Brussels Information 126.900',FR:'Lille / Paris Information (SIV)',NL:'Dutch Mil Info / Amsterdam Information',DE:'Langen Information',LU:'Luxembourg Approach'};
NLX.borderFis=FIS; NLX.countryName=function(c){ return CC_NAMES[c]||c; };
function borderAdvice(list){
  if(!list.length) return '';
  var uk=list.some(function(b){ return b.from==='GB'||b.to==='GB'; });
  var h=list.map(function(b){ var st=b.st||{};
    return '<div class="bp-it '+(uk?'b':'w')+'">🛂 <b>'+esc(CC_NAMES[b.from]||b.from)+' → '+esc(CC_NAMES[b.to]||b.to)+'</b> : '
      +(st.nm!=null?'<b>'+st.nm.toFixed(1).replace('.',',')+' NM</b> et <b>'+Math.round(st.min)+' min</b> après le '+(st.stop?'redécollage de <b>'+esc(st.from)+'</b> (après l’escale)':'décollage de <b>'+esc(st.from)+'</b>')+(st.time?' — vers '+hmLoc(st.time):''):Math.round(b.d)+' NM du départ')
      +(FIS[b.to]?'<br><small>Ensuite : '+esc(FIS[b.to])+'</small>':'')+'</div>'; }).join('');
  h+='<div class="bp-it i"><b>Plan de vol obligatoire</b> pour franchir une frontière (SERA.4001) — dépose-le et fais-le activer ; contacte le FIS de chaque côté (Brussels Info, Lille/Paris Info, Dutch Mil/Amsterdam Info…). '
    +'Pièce d\'identité à bord ; dans l\'espace Schengen pas de contrôle des personnes, mais des marchandises soumises à déclaration.</div>';
  if(uk) h+='<div class="bp-it b"><b>Royaume-Uni (hors Schengen)</b> : GAR (General Aviation Report) à envoyer à l\'UK Border Force avant le départ, atterrissage sur un aérodrome douanier ou désigné, passeport. '
    +'Au retour, entrée dans Schengen par un aérodrome douanier (point de passage frontalier) avec déclaration douane/police selon le pays.</div>';
  return h;
}

/* ---------- Activité militaire, oiseaux, parachutage, drones ; SUP AIP ---------- */
var CAT=[
  {k:'mil',t:'🎯 Activité militaire / zones',re:/\bTSA|\bTRA\b|\bCBA|RTBA|\bZRT\b|\bZDT\b|\bR\s?\d{1,3}[A-Z]?\b|\bD\s?\d{1,3}[A-Z]?\b|MIL(ITARY)?\b|EXER|\bLFA\b|HTA\d|AIR DEFEN|\bACT\b/i},
  {k:'bird',t:'🐦 Oiseaux (BIRDTAM)',re:/BIRD/i},
  {k:'para',t:'🪂 Parachutage / voltige',re:/PJE|PARACHUT|SKYDIV|AEROBATIC|VOLTIGE/i},
  {k:'uas',t:'🚁 Drones',re:/\bUAS\b|DRONE|UNMANNED|RPAS/i}];
function dayBounds(){ var c=NL.getConfig(), d=new Date((c.flightDate||NL.today())+'T00:00:00Z'); return [d.getTime(),d.getTime()+864e5]; }
function activity(){
  return Promise.all([NL.loadFrNotams(),once('daily_warnings.json'),once('sup_aip.json')]).then(function(r){
    var fr=r[0], dw=r[1], sup=r[2], b=dayBounds(), S=NL.routeSamples(), out={mil:[],bird:[],para:[],uas:[]};
    var maxAlt=0; (NL.waypoints||[]).forEach(function(w){ if(w&&+w.altitude>maxAlt) maxAlt=+w.altitude; }); maxAlt=maxAlt||2500;
    function near(lat,lon,r){ if(lat==null) return Infinity; var best=1e9; for(var i=0;i<S.length;i+=4){ var d=NL.haversine(S[i].lat,S[i].lon,lat,lon)-(r||0); if(d<best) best=d; } return best; }
    function put(txt,item){ for(var i=0;i<CAT.length;i++){ if(CAT[i].re.test(txt)){ out[CAT[i].k].push(item); return; } } }
    ((fr&&fr.notams)||[]).forEach(function(n){
      var t=(n.e||'')+' '+(n.q||'');
      var bb=Date.parse(n.b), cc=n.c?Date.parse(n.c):Infinity; if(bb>b[1]||cc<b[0]) return;
      if((n.lo||0)*100>maxAlt+1500) return;
      var d=near(n.lat,n.lon,Math.min(n.r||0,60)); if(d>20&&!((n.r||0)>60&&/BIRD/i.test(t))) return;
      if(!/^R|^W|^FA/.test(n.q||'')&&!/BIRD|UAS|DRONE|PJE|TSA|TRA|CBA|RTBA|ZRT/i.test(t)) return;
      put(t,{src:(n.cc||'FR')+' '+n.id+(n.a?' '+n.a:''),txt:n.e_fr||n.e,when:NL.fmtDate(n.b)+' → '+(n.c?NL.fmtDate(n.c):'PERM'),lim:(n.lo!=null?'FL'+('00'+n.lo).slice(-3)+'–FL'+('00'+n.hi).slice(-3):''),d:d});
    });
    ((dw&&dw.warnings)||[]).forEach(function(w){
      put(w.text,{src:'Avis du jour skeyes '+(w.ref||''),txt:w.text,when:(w.from||'')+' → '+(w.till||''),lim:(w.lower||'')+' – '+(w.upper||''),d:null,crossed:crossedName(w.text)});
    });
    Object.keys(out).forEach(function(k){ out[k].sort(function(a,b){ return (b.crossed?1:0)-(a.crossed?1:0)||(a.d==null?99:a.d)-(b.d==null?99:b.d); }); });
    var day=(NL.getConfig().flightDate||NL.today()), codes=fieldsOfFlight().map(function(f){ return f.icao; });
    out.sup=((sup&&sup.items)||[]).filter(function(s){ return s.from<=day&&s.to>=day; }).map(function(s){
      s.hit=codes.some(function(c){ return s.title.indexOf(c)>=0; })||/ZRT|ZDT|ZIT|Hauts[- ]de[- ]France|Nord|Pas-de-Calais|Somme|Aisne|Ardennes|Marne|Picardie|Lille|Valenciennes|Cambrai|Reims/i.test(s.title);
      return s;
    }).sort(function(a,b){ return (b.hit?1:0)-(a.hit?1:0); });
    return out;
  });
}
function crossedName(txt){
  var m=/(TSA|TRA|CBA|EBR|EBD|HTA|LFA)\s?-?\d+[A-Z]?/i.exec(txt||''); if(!m) return false;
  var key=m[0].replace(/[\s-]/g,'').toUpperCase();
  return (NL.airspacesCrossed||[]).some(function(a){ return (a.name||'').replace(/[\s-]/g,'').toUpperCase().indexOf(key)>=0; });
}
function activityHtml(a){
  var h='';
  CAT.forEach(function(c){
    var L=a[c.k]; if(!L.length) return;
    h+='<div class="bp-sec">'+c.t+' ('+L.length+')</div>';
    L.slice(0,25).forEach(function(x){
      h+='<div class="bp-it '+(x.crossed||(x.d!=null&&x.d<=0.5)?'b':x.d!=null&&x.d<5?'w':'i')+'"><b>'+esc(x.src)+'</b>'+(x.crossed?' <span class="bp-tag bp-ba">sur ta route</span>':x.d!=null?' <small>'+(x.d<=0.5?'sur la route':Math.round(x.d)+' NM de la route')+'</small>':'')
        +'<div class="aero-tr" style="white-space:pre-wrap">'+esc((x.txt||'').slice(0,400))+'</div><small>'+esc(x.when)+(x.lim?' · '+esc(x.lim):'')+'</small></div>';
    });
    if(L.length>25) h+='<small>… et '+(L.length-25)+' autres (onglet NOTAMs)</small>';
  });
  if(!h) h='<div class="bp-it">Aucune activation militaire, BIRDTAM, parachutage ou drone trouvé près de la route ce jour-là (NOTAM et avis du jour de la dernière récupération).</div>';
  if(a.sup&&a.sup.length){
    h+='<div class="bp-sec">📑 SUP AIP France en vigueur ce jour ('+a.sup.length+')</div>';
    a.sup.slice(0,30).forEach(function(s){ h+='<div class="bp-it '+(s.hit?'w':'i')+'"><a href="'+esc(s.url)+'" target="_blank" rel="noopener" style="color:var(--link-color)"><b>SUP '+esc(s.num)+'</b></a> '+esc(s.title)+' <small>('+esc(s.from)+' → '+esc(s.to)+')</small></div>'; });
  }
  h+='<div class="bp-it i" style="margin-top:6px">Sources officielles à consulter aussi : <a href="https://www.sia.aviation-civile.gouv.fr/schedules" target="_blank" rel="noopener" style="color:var(--link-color)">activité RTBA / AZBA (SIA)</a> · '
    +'<a href="https://www.public.nm.eurocontrol.int/PUBPORTAL/gateway/spec/index.html" target="_blank" rel="noopener" style="color:var(--link-color)">AUP/UUP Eurocontrol</a> · '
    +'<a href="https://ops.skeyes.be" target="_blank" rel="noopener" style="color:var(--link-color)">skeyes (avis du jour, BIRDTAM)</a>. Ces deux premiers services ne se laissent pas lire automatiquement.</div>';
  return h;
}

/* ---------- Encart « Points à vérifier » ---------- */
var _bpTimer=null, _bpSeq=0;
function renderBrief(){
  var card=document.getElementById('briefPlusCard'); if(!card||!NL.waypoints||NL.waypoints.filter(function(w){ return w&&w.lat!=null; }).length<2){ if(card) card.style.display='none'; return; }
  cssOnce(); card.style.display='';
  var open=lsGet('bpOpen',true), seq=++_bpSeq;
  var top=[], sun=NLX.sunAlerts?NLX.sunAlerts():[], fdate=NL.getConfig().flightDate||NL.today(), td=NL.today();
  var dd=Math.round((Date.parse(fdate)-Date.parse(td))/864e5), dfr=fdate.split('-').reverse().join('/');
  top.push({lvl:dd<0||dd>2?2:dd?1:0,txt:'📅 Vol du <b>'+dfr+'</b>'+(dd===0?' (aujourd’hui)':dd===1?' (demain)':dd<0?' — <b>date passée</b> : soleil, horaires, NOTAM et météo sont calculés pour ce jour-là. Change la date au-dessus du tableau Navlog.':dd>2?' — <b>dans '+dd+' jours</b> : pas encore de prévision AROME pour ce jour-là.':'')});
  sun.forEach(function(s){ top.push({lvl:s.lvl,txt:'☀️ '+s.txt}); });
  var wx=NLX.routeWxAlerts?NLX.routeWxAlerts():null;
  if(wx){ if(wx.bad) top.push({lvl:2,txt:'🌥️ Météo de la route : '+wx.bad+' point(s) hors minima VFR (prévision AROME)'}); else if(wx.warn) top.push({lvl:1,txt:'🌥️ Météo de la route : '+wx.warn+' point(s) limites'});
    else top.push({lvl:0,txt:'🌥️ Minima VFR tenus sur la route (prévision AROME du '+new Date(wx.at).toLocaleString('fr-BE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+')'});
    if(wx.fzMin!=null) top.push({lvl:wx.fzMin<4000?1:0,txt:'🧊 Isotherme 0 °C le plus bas : '+Math.round(wx.fzMin/100)*100+' ft'}); }
  else top.push({lvl:1,txt:'🌥️ Météo de la route pas encore calculée — <a href="#" onclick="window.switchTab(\'meteo\');window.switchMeteoSub(\'routewx\');return false" style="color:var(--link-color)">ouvrir « Météo de la route »</a>'});
  (NLX.pilotAlerts?NLX.pilotAlerts():[]).forEach(function(p){ top.push(p); });
  function it(a){ return '<div class="bp-it '+(a.lvl===2?'b':a.lvl?'w':'')+'">'+a.txt+'</div>'; }
  card.innerHTML='<div class="nl-card-title" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" data-tg><span><span class="icon">📋</span> Points à vérifier pour ce vol <small id="bpCount" style="font-weight:400;color:var(--text-secondary)"></small></span>'
    +'<span style="font-size:.7em;font-weight:600;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:10px;padding:3px 10px">'+(open?'▾ Replier':'▸ Afficher')+'</span></div>'
    +'<div id="bpBody" style="'+(open?'':'display:none')+'"><div id="bpTop">'+top.map(it).join('')+'</div>'
    +'<div class="bp-sec">🛬 Terrains du vol</div><div id="bpAd"><small>⏳ fiches AIP…</small></div>'
    +'<div id="bpBorder"></div><div class="bp-sec">🎯 Activité du jour autour de la route</div><div id="bpAct"><small>⏳ NOTAM et avis du jour…</small></div></div>';
  card.querySelector('[data-tg]').onclick=function(){ lsSet('bpOpen',!open); renderBrief(); };
  var nAlert=top.filter(function(a){ return a.lvl; }).length;
  function count(extra){ var el=document.getElementById('bpCount'); nAlert+=extra; if(el) el.textContent=nAlert?'· '+nAlert+' point(s) d\'attention':'· rien à signaler'; }
  count(0);
  adCards().then(function(r){ if(seq!==_bpSeq) return; var seen={}; r.alerts=r.alerts.filter(function(a){ if(seen[a.txt.replace(/ \(.*?\)/,'')]) return false; seen[a.txt.replace(/ \(.*?\)/,'')]=1; return true; });
    var el=document.getElementById('bpAd'); if(el) el.innerHTML=(r.alerts.length?r.alerts.map(it).join(''):'')+r.html; count(r.alerts.filter(function(a){ return a.lvl; }).length); });
  borders().then(function(b){ if(seq!==_bpSeq) return; var el=document.getElementById('bpBorder'); if(el&&b.length){ el.innerHTML='<div class="bp-sec">🛂 Passage de frontière</div>'+borderAdvice(b); count(1); } NLX._borders=b; });
  milZones().then(function(Z){ if(seq!==_bpSeq) return; var hit=Z.filter(function(z){ return z.hits.length; }), el=document.getElementById('bpTop'); if(!el) return;
    var h=hit.map(function(z){ return it({lvl:2,txt:'🎯 <b>'+esc(z.label)+'</b> active '+utc(z.from)+'–'+utc(z.to)+' UTC : ta route la traverse vers '+hmLoc(z.hits[0].time)+' à '+Math.round(z.hits[0].alt)+' ft'}); }).join('');
    h+=it({lvl:0,txt:'🎯 '+Z.length+' zone(s) militaire(s) activée(s) ce jour (NOTAM, avis du jour) — <a href="#" onclick="document.getElementById(\'nlxMilBtn\').click();return false" style="color:var(--link-color)">voir sur la carte</a>'});
    el.insertAdjacentHTML('beforeend',h); count(hit.length); }).catch(function(){});
  activity().then(function(a){ if(seq!==_bpSeq) return; NLX._activity=a; var el=document.getElementById('bpAct'); if(el){ el.innerHTML=activityHtml(a); if(window.metarFrToggle) window.metarFrToggle(document,window._metarFrOn?true:null); } });
}
function scheduleBrief(){ clearTimeout(_bpTimer); _bpTimer=setTimeout(renderBrief,900); }
window.addEventListener('nl:recalc',scheduleBrief);
window.addEventListener('nlx:routewx',scheduleBrief);
window.addEventListener('nlx:pilot',scheduleBrief);

/* ---------- Bouton PPR ---------- */
function showPpr(){
  once('ppr_aerodromes.json').then(function(d){
    var items=(d&&d.items)||[], S=NL.routeSamples().filter(function(p,i){ return i%4===0; });
    items.forEach(function(a){ a._d=Infinity; if(a.lat==null) return; S.forEach(function(p){ var x=NL.haversine(p.lat,p.lon,a.lat,a.lon); if(x<a._d) a._d=x; }); });
    var m=modal('🔒 Aérodromes PPR / privés — '+items.length+' (FR, BE, LU, NL, DE, GB)','<div id="pprList"></div><small style="color:var(--text-secondary)">Source : OpenAIP (champ PPR / privé) complété par les fiches AIP officielles (Belgique, France). '
      +'Liste indicative : la carte VAC / l\'AIP du terrain fait foi. Touche un terrain pour le voir sur la carte.</small>',
      '<input id="pprQ" placeholder="Chercher (nom, OACI)" style="flex:1 1 140px"><select id="pprC"><option value="">Tous pays</option>'+Object.keys(CC_NAMES).filter(function(k){ return k!=='CH'; }).map(function(k){ return '<option value="'+k+'">'+CC_NAMES[k]+'</option>'; }).join('')+'</select>'
      +'<label style="font-size:.8em"><input type="checkbox" id="pprR"> près de la route</label><button class="navlog-btn" id="pprMap">🗺️ Tous sur la carte</button>');
    function draw(){
      var q=(m.querySelector('#pprQ').value||'').toUpperCase(), c=m.querySelector('#pprC').value, r=m.querySelector('#pprR').checked;
      var L=items.filter(function(a){ return (!c||a.cc===c)&&(!r||a._d<=15)&&(!q||(a.name+' '+a.icao).toUpperCase().indexOf(q)>=0); })
        .sort(function(x,y){ return r?x._d-y._d:(x.cc+x.name).localeCompare(y.cc+y.name); });
      m.querySelector('#pprList').innerHTML=L.slice(0,400).map(function(a,i){
        return '<div class="bp-row" data-i="'+items.indexOf(a)+'"><b style="min-width:52px">'+esc(a.icao||'—')+'</b><span style="flex:1">'+esc(a.name)+' <small>'+esc(CC_NAMES[a.cc]||a.cc)+(a.type?' · '+esc(a.type):'')+(a.rwy?' · '+a.rwy+' m':'')+(a.freq?' · 📻 '+esc(a.freq):'')+'</small>'
          +(a.aip?'<br><small>AIP : …'+esc(a.aip.slice(0,160))+'…</small>':'')+'</span>'+(a.ppr?'<span class="bp-tag bp-wa">PPR</span>':a.cond?'<span class="bp-tag bp-in">PPR sous conditions</span>':'')+(a.priv?'<span class="bp-tag bp-in">privé</span>':'')+(isFinite(a._d)&&a._d<60?'<small>'+Math.round(a._d)+' NM</small>':'')+'</div>';
      }).join('')+(L.length>400?'<small>… '+(L.length-400)+' de plus, affine la recherche</small>':'')+(!L.length?'<p>Aucun terrain.</p>':'');
    }
    ['#pprQ','#pprC','#pprR'].forEach(function(s){ m.querySelector(s).addEventListener('input',draw); m.querySelector(s).addEventListener('change',draw); });
    m.querySelector('#pprList').addEventListener('click',function(e){
      var row=e.target.closest('.bp-row'); if(!row) return; var a=items[+row.dataset.i]; if(!a||a.lat==null) return;
      m.remove(); pprLayer(items,true); var map=NL.routeMap; if(map){ map.setView([a.lat,a.lon],11); var c=document.getElementById('routeMapCard'); if(c) c.scrollIntoView({behavior:'smooth'}); }
    });
    m.querySelector('#pprMap').onclick=function(){ m.remove(); pprLayer(items,true); };
    if(S.length>1) m.querySelector('#pprR').checked=true;
    draw();
  });
}
var _pprLayer=null, _pprChip=null;
/* PPR rouge vif / privé jaune : lisibles sur le fond OSM, satellite, carte VFR et OACI */
function pprLayer(items,on){
  var map=NL.routeMap; if(!map) return;
  if(_pprLayer){ map.removeLayer(_pprLayer); _pprLayer=null; }
  if(_pprChip){ _pprChip.remove(); _pprChip=null; }
  var bt=document.getElementById('nlxPprBtn'); if(bt) bt.classList.toggle('active',!!on);
  if(!on) return;
  _pprLayer=L.layerGroup(items.filter(function(a){ return a.lat!=null; }).map(function(a){
    var ppr=a.ppr, bg=ppr?'#ff1744':a.cond?'#ff9100':'#ffd600', fg=ppr?'#fff':'#000';
    return L.marker([a.lat,a.lon],{zIndexOffset:800,icon:L.divIcon({className:'',iconSize:[34,16],iconAnchor:[17,8],
      html:'<div style="background:'+bg+';color:'+fg+';border:2px solid #000;border-radius:8px;font:800 10px/12px sans-serif;text-align:center;box-shadow:0 0 0 2px #fff">'+(ppr?'PPR':a.cond?'PPR?':'PRIV')+'</div>'})})
      .bindPopup('<b>'+esc(a.icao)+' '+esc(a.name)+'</b><br>'+(ppr?'PPR':a.cond?'PPR pour certains vols':'')+(a.priv?' · privé':'')+(a.rwy?'<br>Piste '+a.rwy+' m':'')+(a.freq?'<br>📻 '+esc(a.freq):'')+(a.aip?'<br><small>AIP : …'+esc(a.aip.slice(0,220))+'…</small>':''));
  })).addTo(map);
  var mc=document.getElementById('routeMapContainer');
  _pprChip=document.createElement('div');
  _pprChip.style.cssText='position:absolute;right:56px;bottom:10px;z-index:1000;background:#ff1744;color:#fff;border:2px solid #000;border-radius:14px;padding:4px 10px;font:700 12px sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  _pprChip.textContent='PPR affichés ✕ Masquer';
  ['mousedown','touchstart','dblclick','click'].forEach(function(ev){ _pprChip.addEventListener(ev,function(e){ e.stopPropagation(); }); });
  _pprChip.onclick=function(){ pprLayer(null,false); };
  mc.appendChild(_pprChip);
}

/* ---------- Zones militaires activées (RTBA, R, D, TSA/TRA, CBA, HTA) ----------
   Sources officielles déjà récupérées par l'appli : NOTAM SIA (France, Belgique, Pays-Bas ; les
   activations RTBA sont publiées la veille par NOTAM « ZONES AIRFORCE RTBA ACT ») et avis du jour
   skeyes (activations TSA/TRA/HTA belges). Chaque désignation est retrouvée dans les contours OpenAIP. */
function normTok(s){ return String(s||'').toUpperCase().replace(/[\s\-–]/g,''); }
function zoneKeyIndex(oa){
  if(oa._zk) return oa._zk;
  var ix={};
  oa.airspaces.forEach(function(a){
    String(a.name||'').toUpperCase().split(/[\s\/(),]+/).forEach(function(t,i){
      t=normTok(t); if(!t||i>2) return; (ix[t]=ix[t]||[]).push(a);
      var m=/^(LF|EB|EH|ED|EL)(R|D|P)(\d.*)$/.exec(t); if(m) (ix[m[2]+m[3]]=ix[m[2]+m[3]]||[]).push(a);
    });
  });
  try{ Object.defineProperty(oa,'_zk',{value:ix,enumerable:false}); }catch(e){}
  return ix;
}
function parseDw(s){ var m=/(\d{1,2}) ([A-Z]{3}) (\d{4}) (\d{2}):(\d{2})/.exec(s||''); if(!m) return null;
  var mo='JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2])/3; return mo<0?null:new Date(Date.UTC(+m[3],mo,+m[1],+m[4],+m[5])); }
function hhmm(day,s){ return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),+s.slice(0,2),+s.slice(2))); }
function milZones(){
  return Promise.all([NL.loadFrNotams(),once('daily_warnings.json'),NL.loadOpenaip()]).then(function(r){
    var fr=r[0], dw=r[1], oa=r[2], b=dayBounds(), out=[], ix=oa?zoneKeyIndex(oa):{};
    function add(key,label,from,to,src,txt,lo,hi){
      if(!from||!to||from.getTime()>b[1]||to.getTime()<b[0]) return;
      var k=normTok(key), list=(ix[k]||[]).filter(function(a){ return NL.classLabel(a)!=='FIR'; });
      out.push({key:k,label:label||key,from:from,to:to,src:src,txt:txt,lo:lo,hi:hi,as:list});
    }
    ((fr&&fr.notams)||[]).forEach(function(n){
      var e=n.e||'', q=n.q||''; if(!/^R/.test(q)&&!/RTBA|TSA|TRA|CBA/.test(e)) return;
      if(!/\bACT(IVE|IVATED)?\b/.test(e)) return;
      var nb=new Date(n.b), nc=n.c?new Date(n.c):new Date(nb.getTime()+864e5), src=(n.cc||'LF')+' NOTAM '+n.id;
      if(/RTBA/.test(e)){
        var re=/ZONE\s+(R\s?\d+[A-Z0-9]*)\s+([^\n]*)\n\s*(\d{4})-(\d{4})\s*:\s*ACTIVE/g, m, any=false;
        while((m=re.exec(e))){ any=true; var f=hhmm(nb,m[3]), t=hhmm(nb,m[4]); if(t<f) t=new Date(t.getTime()+864e5);
          add(m[1],'RTBA '+m[1].replace(/\s/g,'')+' '+m[2].trim(),f,t,src,e,null,null); }
        if(any) return;
      }
      var seen={}, mm, re2=/\b(?:(LF|EB|EH|ED|EL)-?)?(R|D|P)\s?(\d{1,3}[A-Z]?\d?[A-Z]?)\b|\b(TSA|TRA|CBA|HTA)\s?-?(\d{1,3}[A-Z]?)\b/g;
      while((mm=re2.exec(e))){
        var key=mm[4]?mm[4]+mm[5]:(mm[1]||(n.cc==='EB'?'EB':n.cc==='EH'?'EH':'LF'))+mm[2]+mm[3];
        if(seen[key]) continue; seen[key]=1;
        add(key,(mm[4]?mm[4]+' '+mm[5]:(mm[1]||n.cc||'LF')+'-'+mm[2]+mm[3]),nb,nc,src,e,n.lo!=null?n.lo*100:null,n.hi!=null&&n.hi<999?n.hi*100:null);
      }
    });
    ((dw&&dw.warnings)||[]).forEach(function(w){
      var m=/^(TSA|TRA|CBA|HTA|LFA|EBR|EBD|EBP)\s?-?(\d+[A-Z]?)/i.exec((w.text||'').trim()); if(!m||!/\bACT/.test(w.text)) return;
      var key=m[1].toUpperCase()+m[2].toUpperCase();
      add(key,w.text.split(' ACT')[0],parseDw(w.from),parseDw(w.till),'Avis du jour skeyes '+(w.ref||''),w.text+' · '+(w.lower||'')+' – '+(w.upper||''),null,null);
    });
    /* conflits avec la route : dans la zone, à l'heure de passage, entre plancher et plafond */
    var S=NLX.routeSamplesTimed?NLX.routeSamplesTimed(2):[];
    out.forEach(function(z){
      z.hits=[];
      z.as.forEach(function(a){
        var lo=z.lo!=null?z.lo:NL.limitFt(a.lowerLimit)||0, hi=z.hi!=null?z.hi:NL.limitFt(a.upperLimit)||99999;
        S.forEach(function(p){ if(p.time>=z.from&&p.time<=z.to&&p.alt>=lo-200&&p.alt<=hi+200&&NL.inAirspace(a,p.lat,p.lon)) z.hits.push(p); });
      });
    });
    out.sort(function(x,y){ return (y.hits.length?1:0)-(x.hits.length?1:0)||x.from-y.from; });
    NLX.milActive=out;
    return out;
  });
}
NLX.milZones=milZones;
function utc(d){ return ('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2); }
var _milLayer=null;
function showMil(){
  var map=NL.routeMap; if(!map) return;
  var bt=document.getElementById('nlxMilBtn');
  if(_milLayer){ map.removeLayer(_milLayer); _milLayer=null; if(bt) bt.classList.remove('active'); return; }
  milZones().then(function(Z){
    _milLayer=L.layerGroup().addTo(map); if(bt) bt.classList.add('active');
    var bounds=[];
    Z.forEach(function(z){
      z.as.forEach(function(a){
        NL.airspacePolys(a).forEach(function(pl){
          var ll=pl[0].map(function(q){ return [q[1],q[0]]; }); bounds=bounds.concat(ll);
          _milLayer.addLayer(L.polygon(ll,{color:z.hits.length?'#d50000':'#ff1744',weight:z.hits.length?4:2,fillColor:'#ff1744',fillOpacity:.22,dashArray:z.hits.length?null:'6 4'})
            .bindTooltip('<b>'+esc(z.label)+'</b><br>ACTIVE '+utc(z.from)+' → '+utc(z.to)+' UTC'+(z.hits.length?'<br>⚠️ sur ta route à '+hmLoc(z.hits[0].time):'')+'<br><small>'+esc(z.src)+'</small>',{sticky:true}));
        });
      });
    });
    var items=Z.map(function(z){
      return {sec:z.hits.length?'⚠️ Actives sur ta route':'Zones militaires activées ce jour ('+Z.length+')',col:z.hits.length?'#d50000':'#ff1744',
        head:'<b>'+esc(z.label)+'</b>',sub:'ACTIVE '+utc(z.from)+' → '+utc(z.to)+' UTC'+(z.hits.length?' · traversée prévue vers '+hmLoc(z.hits[0].time)+' à '+Math.round(z.hits[0].alt)+' ft':'')+(z.as.length?'':' · contour inconnu'),
        det:'<div class="aero-tr" style="white-space:pre-wrap">'+esc(z.txt.slice(0,600))+'</div><small>'+esc(z.src)+'</small>',
        geo:z.as.length?function(){ return L.featureGroup([].concat.apply([],z.as.map(function(a){ return NL.airspacePolys(a).map(function(pl){ return L.polygon(pl[0].map(function(q){ return [q[1],q[0]]; }),{color:'#d50000',weight:3,fillOpacity:.25,interactive:false}); }); }))); }:null,
        bounds:z.as.length?(function(){ var bb=NL.geomBBox(z.as[0]); return [[bb[1],bb[0]],[bb[3],bb[2]]]; })():null};
    });
    if(!items.length) items=[{sec:'Zones militaires',col:'#7f8c8d',head:'Aucune activation trouvée pour ce jour',sub:'NOTAM et avis du jour de la dernière récupération',det:'',geo:null}];
    NL.openList('🎯 Zones militaires activées (NOTAM, avis du jour)',items);
  });
}

/* ---------- Validités du pilote ---------- */
var PV_KEY='pilotValidity_v1';
function pv(){ return lsGet(PV_KEY,{medical:'',medClass:'2',lapl:false,licence:'',licIssue:'',sep:'',lang:'',langLevel:'4',night:false,flights:[]}); }
function savePv(d){ d.updated=Date.now(); lsSet(PV_KEY,d); pvCloudPush(d); window.dispatchEvent(new Event('nlx:pilot')); }
function pvCloudPush(d){
  try{ var u=firebase.auth().currentUser; if(!u) return; firebase.firestore().doc('quizProgress/'+u.uid+'/session/pilotValidity').set({json:JSON.stringify(d),updated:d.updated}); }catch(e){}
}
function pvCloudPull(){
  try{
    firebase.auth().onAuthStateChanged(function(u){ if(!u) return;
      firebase.firestore().doc('quizProgress/'+u.uid+'/session/pilotValidity').get().then(function(s){
        if(!s.exists) return; var c=JSON.parse(s.data().json||'{}'), l=pv();
        if((c.updated||0)>(l.updated||0)){ lsSet(PV_KEY,c); renderPilot(); window.dispatchEvent(new Event('nlx:pilot')); } else if((l.updated||0)>(c.updated||0)) pvCloudPush(l);
      }).catch(function(){});
    });
  }catch(e){}
}
function daysTo(iso){ if(!iso) return null; return Math.floor((Date.parse(iso+'T23:59:59')-Date.now())/864e5); }
function recent(d,nightOnly){
  var lim=Date.now()-90*864e5, n=0, last=null;
  (d.flights||[]).forEach(function(f){ var t=Date.parse(f.date); if(t>=lim){ n+=nightOnly?(+f.nightLdg||0):(+f.ldg||0); } });
  return n;
}
/* date à laquelle l'expérience récente tombe sous 3 atterrissages */
function recentUntil(d){
  var L=(d.flights||[]).filter(function(f){ return +f.ldg; }).map(function(f){ return {t:Date.parse(f.date),n:+f.ldg}; }).sort(function(a,b){ return b.t-a.t; });
  var c=0; for(var i=0;i<L.length;i++){ c+=L[i].n; if(c>=3) return new Date(L[i].t+90*864e5); } return null;
}
NLX.pilotAlerts=function(){
  var d=pv(), out=[], fd=Date.parse((NL.getConfig().flightDate||NL.today())+'T12:00:00');
  if(!d.medical&&!d.sep&&!(d.flights||[]).length){ out.push({lvl:0,txt:'👤 Validités du pilote non renseignées — <a href="#" onclick="window.switchTab(\'pilote\');return false" style="color:var(--link-color)">onglet Pilote</a>'}); return out; }
  function chk(iso,lab){ if(!iso) return; var t=Date.parse(iso+'T23:59:59'), j=Math.floor((t-fd)/864e5);
    if(j<0) out.push({lvl:2,txt:'👤 '+lab+' expiré le jour du vol ('+iso+')'}); else if(j<45) out.push({lvl:1,txt:'👤 '+lab+' expire dans '+j+' j ('+iso+')'}); }
  chk(d.medical,'Certificat médical'); chk(d.sep,'Qualification SEP'); if(d.langLevel!=='6') chk(d.lang,'Compétence linguistique');
  var n=recent(d,false);
  if(n<3) out.push({lvl:1,txt:'👤 '+n+' atterrissage(s) en 90 jours : pas de passager avant 3 décollages/atterrissages (FCL.060)'});
  var ru=recentUntil(d); if(ru&&ru-fd<14*864e5&&ru>fd) out.push({lvl:1,txt:'👤 Expérience récente valable jusqu\'au '+ru.toLocaleDateString('fr-BE')});
  return out;
};
function renderPilot(){
  var root=document.getElementById('pilotRoot'); if(!root) return; cssOnce();
  var d=pv();
  function badge(iso,warnDays){ var j=daysTo(iso); if(j==null) return '<span class="bp-tag bp-in">non renseigné</span>'; return j<0?'<span class="bp-tag bp-ba">expiré</span>':j<(warnDays||45)?'<span class="bp-tag bp-wa">'+j+' j</span>':'<span class="bp-tag bp-ok">valide ('+j+' j)</span>'; }
  var n=recent(d,false), nn=recent(d,true), ru=recentUntil(d);
  var sepJ=daysTo(d.sep);
  var flights=(d.flights||[]).slice().sort(function(a,b){ return b.date.localeCompare(a.date); });
  var h90=0, lim=Date.now()-365*864e5, h12=0, ldg12=0;
  flights.forEach(function(f){ var t=Date.parse(f.date); if(t>=lim){ h12+=+f.time||0; ldg12+=+f.ldg||0; } });
  root.innerHTML='<div class="nl-card"><div class="nl-card-title"><span class="icon">👤</span> Validités du pilote</div>'
    +'<p style="font-size:.8em;color:var(--text-secondary);margin:0 0 10px">Gardées sur cet appareil et synchronisées avec ton compte. Le Briefing te prévient 45 jours avant chaque échéance.</p>'
    +'<div class="pv-grid">'
    +'<div><label>Certificat médical — fin de validité '+badge(d.medical)+'</label><input type="date" data-k="medical" value="'+esc(d.medical)+'"><select data-k="medClass" style="margin-top:4px"><option value="2">Classe 2</option><option value="1">Classe 1</option><option value="LAPL">LAPL</option></select></div>'
    +'<div><label>Licence (n°) / date de délivrance</label><input data-k="licence" placeholder="BE.FCL.PPL(A)…" value="'+esc(d.licence)+'"><input type="date" data-k="licIssue" style="margin-top:4px" value="'+esc(d.licIssue)+'"></div>'
    +'<div><label>Qualification SEP — fin de validité '+badge(d.sep,90)+'</label><input type="date" data-k="sep" value="'+esc(d.sep)+'">'
      +(sepJ!=null&&sepJ<365?'<small style="color:var(--text-secondary)">Prorogation par expérience dans les 12 mois avant l\'échéance : 12 h de vol dont 6 h CDB, 12 décollages et 12 atterrissages, vol d\'entraînement d\'1 h avec un instructeur. Sur 12 mois : <b>'+h12.toFixed(1)+' h</b>, <b>'+ldg12+'</b> atterrissages.</small>':'')+'</div>'
    +'<div><label>Compétence linguistique '+(d.langLevel==='6'?'<span class="bp-tag bp-ok">niveau 6 : à vie</span>':badge(d.lang))+'</label><select data-k="langLevel"><option value="4">Niveau 4 (4 ans)</option><option value="5">Niveau 5 (6 ans)</option><option value="6">Niveau 6</option></select><input type="date" data-k="lang" style="margin-top:4px" value="'+esc(d.lang)+'"></div>'
    +'</div>'
    +'<div class="bp-sec" style="margin-top:12px">🛬 Expérience récente</div>'
    +'<div class="bp-it '+(n>=3?'':'w')+'"><b>'+n+'</b> décollage(s)/atterrissage(s) dans les 90 derniers jours '+(n>=3?'→ passagers autorisés'+(ru?' jusqu\'au <b>'+ru.toLocaleDateString('fr-BE')+'</b>':''):'→ <b>pas de passager</b> avant 3 décollages et atterrissages (FCL.060)')
    +(nn?'<br><b>'+nn+'</b> de nuit en 90 jours'+(nn<1?'':''):'')+'</div>'
    +'<div class="bp-sec">✈️ Carnet des vols (pour les calculs)</div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:end;font-size:.82em"><label>Date<br><input type="date" id="pvFd" value="'+new Date().toISOString().slice(0,10)+'"></label><label>Temps (h)<br><input type="number" id="pvFt" step="0.1" min="0" style="width:80px"></label>'
    +'<label>Atterrissages<br><input type="number" id="pvFl" min="0" value="1" style="width:70px"></label><label>dont de nuit<br><input type="number" id="pvFn" min="0" value="0" style="width:70px"></label>'
    +'<label>Avion / remarque<br><input id="pvFr" style="width:160px"></label><button class="navlog-btn" id="pvAdd">+ Ajouter</button></div>'
    +'<table class="pv-tbl" style="margin-top:8px"><tr><th>Date</th><th>Temps</th><th>Atterr.</th><th>Nuit</th><th>Remarque</th><th></th></tr>'
    +flights.slice(0,60).map(function(f){ return '<tr><td>'+esc(f.date)+'</td><td>'+(f.time||'')+'</td><td>'+(f.ldg||0)+'</td><td>'+(f.nightLdg||0)+'</td><td>'+esc(f.rmk||'')+'</td><td><button class="navlog-btn" data-del="'+esc(f.id)+'" style="padding:2px 8px">✕</button></td></tr>'; }).join('')
    +'</table><small style="color:var(--text-secondary)">Les vols enregistrés avec la trace GPS (onglet En vol) sont proposés ici automatiquement à la fin du vol.</small></div>';
  root.querySelectorAll('[data-k]').forEach(function(el){
    if(el.tagName==='SELECT') el.value=d[el.dataset.k]||el.value;
    el.addEventListener('change',function(){ var x=pv(); x[el.dataset.k]=el.value; savePv(x); renderPilot(); });
  });
  root.querySelector('#pvAdd').onclick=function(){
    var x=pv(); x.flights=x.flights||[];
    x.flights.push({id:Date.now().toString(36),date:root.querySelector('#pvFd').value,time:+root.querySelector('#pvFt').value||0,ldg:+root.querySelector('#pvFl').value||0,nightLdg:+root.querySelector('#pvFn').value||0,rmk:root.querySelector('#pvFr').value});
    savePv(x); renderPilot();
  };
  root.querySelectorAll('[data-del]').forEach(function(b){ b.onclick=function(){ var x=pv(); x.flights=(x.flights||[]).filter(function(f){ return f.id!==b.dataset.del; }); savePv(x); renderPilot(); }; });
}
NLX.addLoggedFlight=function(f){ var x=pv(); x.flights=x.flights||[]; f.id=f.id||Date.now().toString(36); x.flights.push(f); savePv(x); renderPilot(); };

/* ---------- Check-lists normales (manuels de vol Reims/Cessna F150M et F172M) ---------- */
var CK={
  '172':{name:'Reims/Cessna F172M',src:'Manuel de vol F172M, section 4 (révision 2, août 1975)',secs:[
    ['Visite extérieure (figure 7)',['1a. Interrupteur général ON : vérifier la quantité d\'essence, puis couper','1b. Contacts magnétos OFF','1c. Robinet d\'essence BOTH','1d. Enlever le blocage des commandes de vol','1e. Porte de la soute à bagages fermée et verrouillée',
      '2a. Ôter le bloqueur de gouverne de direction s\'il est posé','2b. Enlever la corde d\'amarrage arrière','2c. Liberté de mouvement et fixation des gouvernes','3a. Ôter le bloqueur d\'aileron s\'il est posé',
      '4a. Gonflage des roues principales','4b. Enlever la corde d\'amarrage voilure','4c. Purger les réservoirs (bol de purge), vérifier l\'absence d\'eau','4d. Quantité de carburant visuelle, bouchon de remplissage fermé',
      '5a. Niveau d\'huile : pas de mise en route sous 5,7 L (6 qt), plein 7,6 L (8 qt) pour les vols prolongés','5b. Premier vol du jour / après plein : purge du filtre à essence (4 s), vérifier l\'absence d\'eau, purge fermée','5c. Hélice et cône','5d. État et propreté du phare d\'atterrissage',
      '5e. Filtre d\'air d\'admission propre','5f. Amortisseur et pneu de la roulette de nez','5g. Détacher la saisine de nez','5h. Prise statique (côté gauche) non obstruée',
      '6. Aile gauche : comme le point 4','7a. Ôter le cache pitot et vérifier l\'antenne','7b. Mise à l\'air libre du réservoir','7c. Avertisseur de décrochage','7d. Enlever la corde d\'amarrage voilure','8. Aileron gauche : comme le point 3']],
    ['Avant la mise en route',['Sièges et ceintures de sécurité : ajustés et verrouillés','Freins : vérifiés, frein de parking serré','Sélecteur carburant : BOTH','Radio et équipements électriques : OFF']],
    ['Mise en route',['Réchauffage carburateur : FROID','Mélange : RICHE','Injections : selon nécessité','Commande des gaz : ouverte de 1 cm','Interrupteur général : ON','Champ de l\'hélice dégagé','Engager le démarreur','Pression d\'huile : vérifiée']],
    ['Avant décollage',['Frein de parking serré','Commandes de vol libres','Réservoirs : BOTH','Tab : réglé pour le décollage','Commande des gaz : 1700 tr/min','Instruments moteur et ampèremètre vérifiés','Dépression : 4,6 à 5,4 inHg','Magnétos : chute maxi 125 tr/min par magnéto, écart maxi 50 tr/min','Réchauffage carburateur : fonctionnement vérifié','Instruments de vol et radio en marche','Pilote automatique (option) sur arrêt','Commande des gaz : bouton de serrage réglé']],
    ['Décollage normal',['Volets relevés','Réchauffage carburateur : FROID','Manette des gaz à fond','Profondeur : soulager la roulette à 55 kt (102 km/h)','Vitesse de montée : 70 à 80 kt (130 à 148 km/h)']],
    ['Décollage performance maximum',['Volets relevés','Réchauffage carburateur : FROID','Freins serrés','Pleine puissance','Lâcher les freins','Profondeur : relativement cabrée','59 kt (109 km/h) jusqu\'à ce que les obstacles soient franchis']],
    ['Montée',['Vitesse : 70 à 78 kt (129 à 145 km/h) — performance maxi 78 kt au sol, 68 kt à 10 000 ft','Régime : maximum','Mélange : PLEIN RICHE (appauvrir au-dessus de 3000 ft)']],
    ['Croisière',['Régime : 2200 à 2700 tr/min','Tab de profondeur réglé','Mélange : appauvrir selon le maximum de tours','Chute de régime constatée : réchauffage carburateur']],
    ['Descente',['Mélange RICHE','Régime à la demande','Réchauffage carburateur : réglé pour éviter le givrage']],
    ['Avant l\'atterrissage',['Mélange RICHE','Réservoirs : BOTH','Réchauffage carburateur : plein chaud AVANT de réduire les gaz','Vitesse : 60 à 70 kt (111 à 130 km/h) volets relevés','Volets : selon nécessité','Vitesse : 55 à 65 kt (102 à 121 km/h) volets baissés']],
    ['Remise des gaz',['Régime maximum','Réchauffage carburateur : FROID','Volets ramenés à 20°','Vers 55 kt (102 km/h) : rentrer les volets lentement']],
    ['Atterrissage normal',['Toucher sur les roues principales','Pendant le roulage, ramener doucement la roulette de nez','Freinage minimum selon nécessité']],
    ['Après l\'atterrissage',['Volets relevés','Réchauffage carburateur : FROID']],
    ['Avant de quitter l\'avion',['Frein de parking','Radio et équipements électriques : OFF','Mélange : ÉTOUFFOIR','Contacts et interrupteur général : OFF','Blocage des gouvernes']]]},
  '150':{name:'Reims/Cessna F150M',src:'Manuel de vol F150M, section 4 (édition 1 août 1974, révision 2 août 1975)',secs:[
    ['Visite extérieure (figure 8)',['1a. Enlever le blocage de la commande de vol','1b. Contacts magnétos OFF','1c. Interrupteur général ON : vérifier la quantité de carburant, puis OFF','1d. Robinet carburant ON',
      '2a. Ôter le bloqueur de gouverne de direction s\'il est posé','2b. Enlever la corde d\'amarrage arrière','2c. Liberté de mouvement et fixation des gouvernes','3a. Liberté de débattement et fixation de l\'aileron',
      '4a. Enlever la corde d\'amarrage voilure','4b. Gonflage des roues principales','4c. Premier vol du jour / après plein : purge du réservoir (bol), éliminer l\'eau','4d. Quantité de carburant visuelle, bouchon fermé',
      '5a. Niveau d\'huile : pas de mise en route sous 3,8 L (4 qt), plein 5,7 L (6 qt) pour les vols prolongés','5b. Premier vol du jour / après plein : purge du filtre (4 s), vérifier l\'absence d\'eau, purge fermée','5c. Hélice et cône','5d. Filtre à air d\'admission non obstrué','5e. Phares d\'atterrissage propres',
      '5f. Amortisseur et pneu de la roulette de nez','5g. Enlever la corde d\'amarrage','5h. Prise de pression statique (côté gauche) non obstruée','6. Aile gauche : comme le point 4','7a. Ôter le cache pitot et vérifier l\'antenne','7b. Avertisseur de décrochage','7c. Mise à l\'air libre','8. Aileron gauche : comme le point 3']],
    ['Avant la mise en route',['Sièges et ceintures de sécurité : ajustés et verrouillés','Freins : vérifiés, frein de parking serré','Robinet réservoirs : ON','Radio et équipements électriques : OFF']],
    ['Mise en route',['Réchauffage carburateur : FROID','Mélange : RICHE','Injections : selon nécessité','Interrupteur général : ON','Commande des gaz : ouverte de 1 cm','Champ de l\'hélice dégagé','Démarrage','Pression d\'huile : vérifiée']],
    ['Avant décollage',['Commande des gaz : 1700 tr/min','Instruments moteur dans la plage verte','Magnétos : chute maxi 150 tr/min par magnéto, écart maxi 75 tr/min','Réchauffage carburateur : fonctionnement vérifié','Dépression : 4,6 à 5,4 inHg','Commandes de vol libres','Tab : réglé pour le décollage','Portes cabine verrouillées','Instruments de vol et radio en marche']],
    ['Décollage normal',['Volets relevés','Réchauffage carburateur : FROID','Manette des gaz à fond','Profondeur : soulager la roulette à 50 kt (93 km/h)','Montée : 60 à 70 kt (111 à 129 km/h) pour un obstacle éventuel, puis vitesse de montée normale']],
    ['Décollage performance maximum',['Volets relevés','Réchauffage carburateur : FROID','Freins serrés','Pleine puissance','Lâcher les freins','Profondeur : relativement cabrée','Montée : 60 kt (111 km/h)']],
    ['Montée',['Montée normale : 65 à 75 kt (121 à 139 km/h) — performance maxi 68 kt (126 km/h)','Régime : maximum','Mélange : RICHE']],
    ['Croisière',['Régime : 2000 à 2750 tr/min','Tab de profondeur réglé','Mélange : appauvrir selon le maximum de tours','Chute de régime constatée : réchauffage carburateur']],
    ['Avant l\'atterrissage',['Mélange RICHE','Réchauffage carburateur : plein chaud AVANT de réduire les gaz','Vitesse : 60 à 70 kt (111 à 129 km/h)','Volets : à volonté sous 85 kt (158 km/h)','Vitesse : 50 à 60 kt (93 à 111 km/h) volets baissés']],
    ['Atterrissage manqué',['Commande des gaz : pleine ouverture','Réchauffage carburateur : FROID','Volets ramenés à 20°','Vitesse : 55 kt (102 km/h)','Volets rentrés lentement']],
    ['Atterrissage normal',['Toucher sur les roues principales','Pendant le roulage, ramener doucement la roulette de nez','Freinage minimum selon nécessité']],
    ['Après l\'atterrissage',['Volets relevés','Réchauffage carburateur : FROID']],
    ['Avant de quitter l\'avion',['Frein de parking','Équipement radio et électrique : COUPÉ','Mélange : ÉTOUFFOIR','Tous contacts : OFF','Blocage des gouvernes']]]}
};
function ckType(){ var ac=NL.aircraft&&NL.aircraft(), k=window._perfAircraft||''; var t=ac&&ac.type||''; return /150/.test(t+' '+k)?'150':/172/.test(t+' '+k)?'172':lsGet('ckType','172'); }
function renderCk(){
  var card=document.getElementById('acChecklistCard'); if(!card) return; cssOnce();
  var t=lsGet('ckSel',null)||ckType(), C=CK[t], st=lsGet('ckState_'+t,{}), total=0, done=0;
  var html='<div class="nl-card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span><span class="icon">🛩️</span> Check-list avion — '+esc(C.name)+'</span>'
    +'<span><select id="ckSel" style="padding:5px 8px;border-radius:8px;border:1px solid var(--border-color);background:transparent;color:inherit"><option value="150">F150M</option><option value="172">F172M</option></select> '
    +'<button class="navlog-btn" id="ckReset">🔄 Tout décocher</button></span></div><p style="font-size:.78em;color:var(--text-secondary);margin:0 0 6px">'+esc(C.src)+'. Le manuel de vol de l\'avion fait foi. <span id="ckProg"></span></p>';
  C.secs.forEach(function(s,i){
    html+='<div class="ck-sec"><h4>'+esc(s[0])+'</h4>';
    s[1].forEach(function(x,j){ var id=i+'_'+j, on=!!st[id]; total++; if(on) done++;
      html+='<label class="ck-it'+(on?' done':'')+'"><input type="checkbox" data-ck="'+id+'"'+(on?' checked':'')+'> <span>'+esc(x)+'</span></label>'; });
    html+='</div>';
  });
  card.innerHTML=html;
  card.querySelector('#ckSel').value=t;
  card.querySelector('#ckProg').textContent=done+' / '+total+' cochés';
  card.querySelector('#ckSel').onchange=function(){ lsSet('ckSel',this.value); renderCk(); };
  card.querySelector('#ckReset').onclick=function(){ lsSet('ckState_'+t,{}); renderCk(); };
  card.querySelectorAll('[data-ck]').forEach(function(cb){ cb.onchange=function(){ var s=lsGet('ckState_'+t,{}); s[cb.dataset.ck]=cb.checked; lsSet('ckState_'+t,s); cb.parentNode.classList.toggle('done',cb.checked);
    var n=Object.keys(s).filter(function(k){ return s[k]; }).length; card.querySelector('#ckProg').textContent=n+' / '+total+' cochés'; }; });
}

/* ---------- Dossier PDF consolidé : sections ajoutées ---------- */
NLX.dossierExtra=function(){
  var h='';
  try{ h+=NLX.routeWxHtmlForPrint?NLX.routeWxHtmlForPrint():''; }catch(e){}
  var bp=document.getElementById('bpAd'); if(bp&&bp.textContent.trim()) h+='<h2>🛬 Terrains du vol</h2>'+bp.innerHTML;
  var bb=document.getElementById('bpBorder'); if(bb&&bb.textContent.trim()) h+=bb.innerHTML.replace('<div class="bp-sec">','<h2>').replace('</div>','</h2>');
  var ba=document.getElementById('bpAct'); if(ba&&ba.textContent.trim()) h+='<h2>🎯 Activité du jour autour de la route</h2>'+ba.innerHTML;
  try{ var L=NL.routeNotams(); if(L.length) h+='<h2>⚠️ NOTAM localisés sur la route ('+L.length+')</h2>'+L.map(function(n){ return '<div class="bp-it"><b>'+esc(n.title)+'</b> <span class="small">'+Math.round(n.along[0])+' NM</span><div style="white-space:pre-wrap">'+esc(n.txt)+'</div><span class="small">'+NL.fmtDate(n.b)+' → '+NL.fmtDate(n.c)+'</span></div>'; }).join(''); }catch(e){}
  var perf=document.getElementById('tab-perf'); if(perf&&perf.querySelector('.perf-move-card,#perfAllMoves')){ var pm=perf.querySelector('#perfAllMoves')||perf.querySelector('.perf-move-card').parentNode; h+='<h2>📊 Performances décollage / atterrissage</h2>'+pm.innerHTML; }
  var pa=NLX.pilotAlerts?NLX.pilotAlerts():[]; if(pa.length) h+='<h2>👤 Pilote</h2>'+pa.map(function(a){ return '<div class="bp-it">'+a.txt.replace(/<a[^>]*>|<\/a>/g,'')+'</div>'; }).join('');
  return '<style>.bp-it{border-left:3px solid #999;padding:3px 7px;margin:3px 0;font-size:10pt}.bp-it.b{border-color:#b91c1c}.bp-it.w{border-color:#b45309}.bp-tag{border:1px solid #999;border-radius:6px;padding:0 5px;margin-right:3px;font-size:9pt}'
    +'.bp-ad{border:1px solid #999;border-radius:6px;padding:5px 7px;margin:4px 0;font-size:10pt;page-break-inside:avoid}.bp-ad h4{margin:0 0 3px}.rwx-tbl{border-collapse:collapse;width:100%;font-size:9pt}.rwx-tbl td,.rwx-tbl th{border:1px solid #bbb;padding:2px 4px}'
    +'.rwx-sum{display:flex;gap:8px;flex-wrap:wrap}.rwx-sum>div{border:1px solid #bbb;border-radius:6px;padding:4px 7px}.rwx-sum b{display:block}.rwx-msg{font-size:10pt;margin:4px 0}svg{max-width:100%;height:auto}</style>'+h;
};

/* ---------- Boutons de la carte ---------- */
function addButtons(){
  var rows=document.querySelectorAll('#routeMapCard .rm-tb-row'); if(rows.length<2||document.getElementById('nlxPprBtn')) return;
  var r=rows[1];
  var b1=document.createElement('button'); b1.className='navlog-btn'; b1.id='nlxPprBtn'; b1.textContent='🔒 PPR'; b1.title='Aérodromes soumis à autorisation préalable (PPR) ou privés : France, Belgique, Luxembourg, Pays-Bas, Allemagne, Royaume-Uni'; b1.onclick=function(){ if(_pprLayer){ pprLayer(null,false); return; } showPpr(); }; r.appendChild(b1);
  var b2=document.createElement('button'); b2.className='navlog-btn'; b2.id='nlxTrfBtn'; b2.textContent='✈️ Trafic'; b2.title='Trafic réel ADS-B / MLAT autour de la carte (adsb.lol) : couleur selon l’altitude, fiche détaillée au clic'; b2.onclick=function(){ if(NLX.toggleTraffic) NLX.toggleTraffic(); }; r.appendChild(b2);
  var b3=document.createElement('button'); b3.className='navlog-btn'; b3.id='nlxMilBtn'; b3.textContent='🎯 Militaire'; b3.title='Zones militaires ACTIVÉES le jour du vol (RTBA, zones R/D, TSA/TRA, HTA) d’après les NOTAM officiels et les avis du jour skeyes, dessinées sur la carte ; en rouge épais si la route les traverse à l’heure prévue'; b3.onclick=showMil; r.appendChild(b3);
}

/* Téléphone : bouton « 🧰 Outils » qui replie / déplie les deux lignes de boutons sous la carte */
function addToolbarToggle(){
  var tb=document.querySelector('#routeMapCard .route-map-toolbar'); if(!tb||tb.querySelector('.rm-tb-toggle')) return;
  var n=tb.querySelectorAll('.rm-tb-row button,.rm-tb-row label,.rm-tb-row select').length;
  var b=document.createElement('button'); b.type='button'; b.className='rm-tb-toggle';
  function upd(){ var c=tb.classList.contains('rm-tb-collapsed'); b.innerHTML='<span>🧰 Outils de la carte et de la route <small style="opacity:.7">('+n+')</small></span><span>'+(c?'▸ Afficher':'▾ Replier')+'</span>'; }
  b.onclick=function(){ tb.classList.toggle('rm-tb-collapsed'); lsSet('rmTbCollapsed',tb.classList.contains('rm-tb-collapsed')); upd(); };
  if(lsGet('rmTbCollapsed',false)) tb.classList.add('rm-tb-collapsed');
  tb.insertBefore(b,tb.firstChild); upd();
}
function init(){
  cssOnce(); addButtons(); setTimeout(addToolbarToggle,0); renderPilot(); renderCk(); pvCloudPull(); scheduleBrief();
  var tabBtns=document.querySelectorAll('.navlog-tab'); tabBtns.forEach(function(b){ if(/'checklist'/.test(b.getAttribute('onclick')||'')) b.addEventListener('click',renderCk); });
  var pa=document.getElementById('perfAircraft'); if(pa) pa.addEventListener('change',function(){ lsSet('ckSel',null); renderCk(); });
}
if(window.NL) (document.readyState==='loading'?document.addEventListener('DOMContentLoaded',init):init());
else window.addEventListener('nl:ready',init);
})();
