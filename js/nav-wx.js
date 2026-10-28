/* === nav-wx.js === Météo de la route (onglet Météo > « Météo de la route » de navlog.html)
   - Soleil : lever, coucher, crépuscule civil et nuit aéronautique à chaque terrain, alerte si
     un décollage ou une arrivée tombe de nuit (France : coucher + 30 min ; EASA/Belgique/Pays-Bas :
     fin du crépuscule civil) — calcul local (algorithme NOAA), marche hors ligne.
   - Prévision AROME (Météo-France, via Open-Meteo) le long du tracé, à l'heure de passage prévue :
     base et couverture des nuages, visibilité, isotherme 0 °C, pluie/averses/orages, brouillard,
     rafales -> contrôle des minima VFR à l'altitude du leg.
   - Coupe verticale (nuages, 0 °C, pluie, turbulence, relief, altitude prévue).
   - Meilleure altitude : temps, carburant et vent de face pour chaque niveau possible.
   Lit la route par window.NL (pont défini à la fin du script principal de navlog.html). */
(function(){
'use strict';
var NLX=window.NLX=window.NLX||{};
var LEVELS=[1000,975,950,925,900,850,800,750,700,650,600];
var FT=3.28084;

function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function hm(d){ if(!d||isNaN(d)) return '—'; return ('0'+d.getUTCHours()).slice(-2)+':'+('0'+d.getUTCMinutes()).slice(-2); }
function hmLoc(d){ if(!d||isNaN(d)) return '—'; return d.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'}); }
NLX.hm=hm; NLX.hmLoc=hmLoc; NLX.esc=esc;

/* ---------- Soleil (NOAA, précision ~1 min) ---------- */
function sunEvent(date,lat,lon,zenith,rise){
  var d0=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate());
  var N=Math.floor((d0-Date.UTC(date.getUTCFullYear(),0,0))/864e5);
  var lngHour=lon/15, t=N+((rise?6:18)-lngHour)/24;
  var M=0.9856*t-3.289;
  var L=(M+1.916*Math.sin(M*Math.PI/180)+0.020*Math.sin(2*M*Math.PI/180)+282.634)%360; if(L<0) L+=360;
  var RA=Math.atan(0.91764*Math.tan(L*Math.PI/180))*180/Math.PI; RA=(RA+360)%360;
  RA=(RA+(Math.floor(L/90)*90-Math.floor(RA/90)*90))/15;
  var sinDec=0.39782*Math.sin(L*Math.PI/180), cosDec=Math.cos(Math.asin(sinDec));
  var cosH=(Math.cos(zenith*Math.PI/180)-sinDec*Math.sin(lat*Math.PI/180))/(cosDec*Math.cos(lat*Math.PI/180));
  if(cosH>1||cosH<-1) return null;
  var H=rise?360-Math.acos(cosH)*180/Math.PI:Math.acos(cosH)*180/Math.PI; H/=15;
  var T=H+RA-0.06571*t-6.622, UT=((T-lngHour)%24+24)%24;
  return new Date(d0+UT*3600000);
}
function sunDay(date,lat,lon){
  return {rise:sunEvent(date,lat,lon,90.833,true),set:sunEvent(date,lat,lon,90.833,false),
    civR:sunEvent(date,lat,lon,96,true),civS:sunEvent(date,lat,lon,96,false)};
}
/* nuit selon le pays du terrain : France = coucher+30 min / lever-30 min ; ailleurs (EASA) = crépuscule civil */
function nightLimits(name,lat,lon,date){
  var s=sunDay(date,lat,lon), fr=/^LF/.test(name||'')||(lon<2.6&&lat<50.95);
  return {sun:s,fr:fr,
    dayStart:fr?(s.rise&&new Date(s.rise-30*60000)):s.civR,
    dayEnd:fr?(s.set&&new Date(+s.set+30*60000)):s.civS};
}
NLX.sunDay=sunDay; NLX.nightLimits=nightLimits;

/* ---------- Points du vol avec heure de passage ---------- */
function flightDate(){ var c=NL.getConfig(); return c.flightDate||NL.today(); }
function depDate(){
  var c=NL.getConfig(), t=new Date(flightDate()+'T'+(c.depTime||'09:00')+':00');
  return isNaN(t)?new Date():t;
}
/* Terrains (départ, escales, arrivée) avec heures de décollage / atterrissage prévues */
function fieldTimes(){
  var pts=NL.flightPoints(), out=[];
  pts.forEach(function(p,k){
    if(!p.ad) return;
    var w=NL.waypoints[p.i]||{};
    out.push({name:p.name,lat:p.lat,lon:p.lon,time:p.time,first:k===0,last:k===pts.length-1,i:p.i,w:w});
  });
  return out;
}
/* Échantillons le long de la route tous les ~8 NM, avec heure et altitude du leg */
function routeSamples(step){
  step=step||8;
  var wps=NL.waypoints, c=NL.getConfig(), t=depDate().getTime()+(c.fuelTaxiD||0)*60000, d=0, out=[], prev=null;
  for(var i=0;i<wps.length;i++){
    var w=wps[i]; if(!w||w.lat==null||w.lon==null) continue;
    var ad=i===0||i===wps.length-1||w.isEtape||NL.isStageEnd(i);
    if(!prev){ out.push({lat:w.lat,lon:w.lon,d:0,time:new Date(t),alt:NL.adElev(w)||0,name:w.name||'',ad:true,i:i}); prev=w; continue; }
    var ete=(w._leg&&isFinite(w._leg.ete))?w._leg.ete*3600000:0, dist=+w.dist||0;
    var alt=+w.altitude||c.alt||2500, n=Math.max(1,Math.ceil(dist/step));
    if(dist>0) for(var j=1;j<n;j++){
      out.push({lat:prev.lat+(w.lat-prev.lat)*j/n,lon:prev.lon+(w.lon-prev.lon)*j/n,d:d+dist*j/n,time:new Date(t+ete*j/n),alt:alt,name:'',i:i});
    }
    t+=ete; d+=dist;
    var el=ad?NL.adElev(w):null;
    out.push({lat:w.lat,lon:w.lon,d:d,time:new Date(t),alt:ad?(el||0):alt,legAlt:alt,name:w.name||'',ad:ad,i:i});
    prev=w;
  }
  /* même point répété (fin d'étape + départ suivant) : un seul échantillon */
  return out.filter(function(p,k){ var q=out[k-1]; return !q||Math.abs(q.lat-p.lat)>1e-4||Math.abs(q.lon-p.lon)>1e-4; });
}
NLX.routeSamplesTimed=routeSamples;

/* ---------- Prévision AROME aux échantillons ---------- */
function fetchFc(pts){
  var lat=pts.map(function(p){ return p.lat.toFixed(3); }).join(','), lon=pts.map(function(p){ return p.lon.toFixed(3); }).join(',');
  var v=['temperature_2m','dew_point_2m','cloud_cover_low','cloud_cover_mid','cloud_cover','precipitation','showers','rain','cape','wind_gusts_10m','wind_speed_10m','wind_direction_10m','weather_code'];
  LEVELS.forEach(function(p){ ['temperature_','relative_humidity_','cloud_cover_','wind_speed_','wind_direction_','geopotential_height_'].forEach(function(k){ v.push(k+p+'hPa'); }); });
  var base='https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&timezone=GMT&past_days=1&forecast_days=3&wind_speed_unit=kn';
  var a=fetch(base+'&hourly='+v.join(',')+'&models=meteofrance_seamless').then(function(r){ if(!r.ok) throw new Error('AROME HTTP '+r.status); return r.json(); });
  /* visibilité et isotherme 0 °C : AROME ne les publie pas sur Open-Meteo -> meilleur modèle disponible */
  var b=fetch(base+'&hourly=visibility,freezing_level_height').then(function(r){ return r.ok?r.json():null; }).catch(function(){ return null; });
  return Promise.all([a,b]).then(function(r){
    var A=Array.isArray(r[0])?r[0]:[r[0]], B=r[1]?(Array.isArray(r[1])?r[1]:[r[1]]):[];
    return pts.map(function(p,k){ return analyse(p,A[k],B[k]); });
  });
}
function interpAt(h,tm){
  var ts=h.time.map(function(s){ return Date.parse(s+'Z'); }), j=0;
  while(j<ts.length-2&&ts[j+1]<=tm) j++;
  var f=Math.max(0,Math.min(1,(tm-ts[j])/(ts[j+1]-ts[j])));
  return function(n,angle){
    var a=h[n]; if(!a||a[j]==null) return null; if(a[j+1]==null) return a[j];
    if(angle){ var dd=((a[j+1]-a[j]+540)%360)-180; return (a[j]+dd*f+360)%360; }
    return a[j]+(a[j+1]-a[j])*f;
  };
}
function analyse(p,a,b){
  if(!a||!a.hourly) return {p:p,err:true};
  var t0=Date.parse(a.hourly.time[0]+'Z'), t1=Date.parse(a.hourly.time[a.hourly.time.length-1]+'Z'), tm=p.time.getTime();
  if(tm<t0-36e5||tm>t1+36e5) return {p:p,err:true,out:true};
  var at=interpAt(a.hourly,p.time.getTime()), bt=b&&b.hourly?interpAt(b.hourly,p.time.getTime()):function(){ return null; };
  var gElev=(a.elevation||0), lv=[];
  LEVELS.forEach(function(pl){
    var z=at('geopotential_height_'+pl+'hPa'); if(z==null||z<=gElev+20) return;
    lv.push({p:pl,z:z*FT,T:at('temperature_'+pl+'hPa'),rh:at('relative_humidity_'+pl+'hPa'),cc:at('cloud_cover_'+pl+'hPa'),
      ws:at('wind_speed_'+pl+'hPa'),wd:at('wind_direction_'+pl+'hPa',true)});
  });
  lv.sort(function(x,y){ return x.z-y.z; });
  var T2=at('temperature_2m'), Td2=at('dew_point_2m'), groundFt=gElev*FT;
  /* base des nuages : premier niveau couvert à 50 % (milieu de la couche sous-jacente), sinon
     humidité >= 95 % ; nuages bas annoncés sans niveau couvert -> base convective (écart T/Td x 400 ft) */
  var base=null, cover=0;
  for(var q=0;q<lv.length;q++){
    var L=lv[q]; cover=Math.max(cover,L.cc||0);
    if(base==null&&((L.cc!=null&&L.cc>=50)||(L.rh!=null&&L.rh>=95))){
      var lo=q>0?lv[q-1].z:groundFt; base=Math.round((lo+(L.z-lo)*0.5)/100)*100;
    }
  }
  var low=at('cloud_cover_low')||0;
  if(base==null&&low>=50&&T2!=null&&Td2!=null) base=Math.round((groundFt+Math.max(0,T2-Td2)*400)/100)*100;
  var baseCover=base==null?0:Math.max(low,cover);
  /* isotherme 0 °C : interpolation des niveaux AROME, sinon modèle global */
  var fz=null, prevT=T2, prevZ=groundFt;
  if(prevT!=null&&prevT<=0) fz=groundFt;
  for(var r=0;r<lv.length&&fz==null;r++){
    var Lr=lv[r]; if(Lr.T==null) continue;
    if(prevT>0&&Lr.T<=0) fz=prevZ+(Lr.z-prevZ)*(prevT/(prevT-Lr.T));
    prevT=Lr.T; prevZ=Lr.z;
  }
  if(fz==null){ var fb=bt('freezing_level_height'); if(fb!=null) fz=fb*FT; }
  var vis=bt('visibility'), wc=at('weather_code'), cape=at('cape')||0, sh=at('showers')||0, pr=at('precipitation')||0;
  var gust=at('wind_gusts_10m'), w10=at('wind_speed_10m');
  var spread=(T2!=null&&Td2!=null)?T2-Td2:null;
  var fog=(vis!=null&&vis<1000)||wc===45||wc===48||(spread!=null&&spread<1&&(w10||0)<6&&low>=80);
  var storm=(wc>=95)||(cape>800&&(sh>0.2||pr>0.5));
  /* vent et température à l'altitude du point */
  function atAlt(ft){
    if(!lv.length) return null;
    var lo=lv[0], hi=lv[lv.length-1];
    for(var u=1;u<lv.length;u++) if(lv[u].z>=ft){ lo=lv[u-1]; hi=lv[u]; break; }
    if(ft<=lv[0].z) lo=hi=lv[0];
    var g=hi.z>lo.z?Math.max(0,Math.min(1,(ft-lo.z)/(hi.z-lo.z))):0;
    function mix(x,y){ return x==null?y:y==null?x:x+(y-x)*g; }
    var ux=mix(-(lo.ws||0)*Math.sin(lo.wd*Math.PI/180),-(hi.ws||0)*Math.sin(hi.wd*Math.PI/180)),
        uy=mix(-(lo.ws||0)*Math.cos(lo.wd*Math.PI/180),-(hi.ws||0)*Math.cos(hi.wd*Math.PI/180));
    return {T:mix(lo.T,hi.T),cc:mix(lo.cc,hi.cc),rh:mix(lo.rh,hi.rh),ws:Math.hypot(ux,uy),wd:(Math.atan2(-ux,-uy)*180/Math.PI+360)%360};
  }
  /* cisaillement entre niveaux (turbulence mécanique) : kt par 1000 ft */
  var shear=[];
  for(var s=1;s<lv.length;s++){
    var A1=lv[s-1],A2=lv[s]; if(A1.ws==null||A2.ws==null) continue;
    var du=A2.ws*Math.sin(A2.wd*Math.PI/180)-A1.ws*Math.sin(A1.wd*Math.PI/180), dv=A2.ws*Math.cos(A2.wd*Math.PI/180)-A1.ws*Math.cos(A1.wd*Math.PI/180);
    shear.push({z0:A1.z,z1:A2.z,v:Math.hypot(du,dv)/Math.max(0.3,(A2.z-A1.z)/1000)});
  }
  return {p:p,ground:groundFt,levels:lv,base:base,baseCover:baseCover,low:low,mid:at('cloud_cover_mid')||0,fz:fz,vis:vis,wc:wc,cape:cape,
    showers:sh,precip:pr,gust:gust,w10:w10,T2:T2,Td2:Td2,spread:spread,fog:fog,storm:storm,atAlt:atAlt,shear:shear};
}

/* ---------- Minima VFR (SERA.5001, simplifiés) ---------- */
function vfrCheck(f){
  var p=f.p, alt=p.ad?(f.ground+1000):p.alt, msgs=[], lvl=0;
  function add(l,m){ lvl=Math.max(lvl,l); msgs.push(m); }
  if(f.vis!=null){
    if(f.vis<1500) add(2,'visibilité '+(f.vis/1000).toFixed(1)+' km < 1,5 km');
    else if(f.vis<5000) add(1,'visibilité '+(f.vis/1000).toFixed(1)+' km < 5 km (classe G sous 3000 ft seulement)');
  }
  if(f.base!=null&&f.baseCover>=50){
    var ceilAgl=f.base-f.ground;
    if(!p.ad&&f.base<alt+(alt>3000?1000:200)) add(2,'plafond '+f.base+' ft : pas de séparation nuage à '+Math.round(alt)+' ft');
    else if(!p.ad&&f.base<alt+1000) add(1,'plafond '+f.base+' ft, moins de 1000 ft au-dessus du vol');
    if(ceilAgl<1000) add(2,'plafond '+Math.round(ceilAgl)+' ft sol');
    else if(ceilAgl<1500) add(1,'plafond bas ('+Math.round(ceilAgl)+' ft sol)');
  }
  if(f.fog) add(2,'brouillard probable');
  if(f.storm) add(2,'orages / fortes averses possibles (CAPE '+Math.round(f.cape)+')');
  else if(f.showers>0.2) add(1,'averses');
  if(f.gust!=null&&f.gust>=25) add(1,'rafales '+Math.round(f.gust)+' kt au sol');
  if(!p.ad&&f.fz!=null&&f.base!=null&&f.baseCover>=50&&alt>=f.fz-500&&alt>=f.base) add(2,'vol dans les nuages sous 0 °C : givrage');
  else if(!p.ad&&f.fz!=null&&alt>=f.fz) add(1,'vol au-dessus de l\'isotherme 0 °C');
  return {lvl:lvl,msgs:msgs,alt:alt};
}
NLX.vfrCheck=vfrCheck;

/* ---------- État et rendu ---------- */
var st=NLX.rwx={fc:null,at:null,err:'',busy:false};
try{ var c0=JSON.parse(localStorage.getItem('rwxLast')||'null'); if(c0&&c0.at){ st.cached=c0; } }catch(e){}

function cssOnce(){
  if(document.getElementById('nlxWxCss')) return;
  var s=document.createElement('style'); s.id='nlxWxCss';
  s.textContent='.rwx-tbl{border-collapse:collapse;width:100%;font-size:.78em}.rwx-tbl th,.rwx-tbl td{border-bottom:1px solid var(--border-color);padding:4px 6px;text-align:left;white-space:nowrap}'
    +'.rwx-tbl th{color:var(--text-secondary);font-weight:600;position:sticky;top:0;background:var(--card-bg,#1b1b24)}.rwx-scroll{overflow:auto;max-height:460px}'
    +'.rwx-b{display:inline-block;border-radius:9px;padding:1px 8px;font-weight:700;font-size:.92em}.rwx-ok{background:rgba(76,175,80,.18);color:#4caf50}'
    +'.rwx-warn{background:rgba(255,167,38,.2);color:#ffa726}.rwx-bad{background:rgba(239,83,80,.2);color:#ef5350}'
    +'.rwx-sum{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}.rwx-sum>div{flex:1 1 150px;border:1px solid var(--border-color);border-radius:10px;padding:8px 10px}'
    +'.rwx-sum b{display:block;font-size:1.05em}.rwx-sum small{color:var(--text-secondary)}.rwx-x{overflow-x:auto}.rwx-x svg{display:block}'
    +'.rwx-msg{font-size:.82em;margin:4px 0;padding:6px 10px;border-radius:8px}.rwx-best td{background:rgba(76,175,80,.12)}';
  document.head.appendChild(s);
}

function sunHtml(){
  var fl=fieldTimes(); if(!fl.length) return '<p class="rwx-msg">Ajoute un départ et une arrivée pour les heures de soleil.</p>';
  var rows='', alerts=[];
  fl.forEach(function(f){
    var nl=nightLimits(f.name,f.lat,f.lon,f.time), s=nl.sun, role=f.first?'Décollage':(f.last?'Atterrissage':'Escale');
    var night=f.time<nl.dayStart||f.time>nl.dayEnd, close=!night&&nl.dayEnd&&(nl.dayEnd-f.time)<45*60000;
    if(night) alerts.push('<b>'+esc(f.name)+'</b> : '+role.toLowerCase()+' prévu à '+hmLoc(f.time)+' — <b>de nuit</b> (jour aéronautique '+hmLoc(nl.dayStart)+' → '+hmLoc(nl.dayEnd)+')');
    else if(close) alerts.push('<b>'+esc(f.name)+'</b> : '+role.toLowerCase()+' à '+hmLoc(f.time)+', moins de 45 min avant la nuit aéronautique ('+hmLoc(nl.dayEnd)+')');
    rows+='<tr><td><b>'+esc(f.name)+'</b> <small>'+role+'</small></td><td>'+hmLoc(f.time)+'</td><td>'+hmLoc(s.rise)+'</td><td>'+hmLoc(s.set)+'</td><td>'+hmLoc(s.civS)+'</td>'
      +'<td><span class="rwx-b '+(night?'rwx-bad':close?'rwx-warn':'rwx-ok')+'">'+hmLoc(nl.dayEnd)+'</span> <small>'+(nl.fr?'coucher + 30 min (France)':'fin crépuscule civil (EASA)')+'</small></td></tr>';
  });
  return (alerts.length?'<div class="rwx-msg rwx-bad">🌙 '+alerts.join('<br>🌙 ')+'</div>':'<div class="rwx-msg rwx-ok">☀️ Tout le vol se déroule de jour (heures locales de cet appareil).</div>')
    +'<div class="rwx-scroll"><table class="rwx-tbl"><tr><th>Terrain</th><th>Heure prévue</th><th>Lever</th><th>Coucher</th><th>Crépuscule civil</th><th>Nuit aéronautique dès</th></tr>'+rows+'</table></div>';
}
NLX.sunAlerts=function(){
  var out=[];
  fieldTimes().forEach(function(f){
    var nl=nightLimits(f.name,f.lat,f.lon,f.time);
    if(f.time<nl.dayStart||f.time>nl.dayEnd) out.push({lvl:2,txt:esc(f.name)+' : '+(f.first?'décollage':f.last?'arrivée':'escale')+' à '+hmLoc(f.time)+', de nuit (jour aéronautique '+hmLoc(nl.dayStart)+' → '+hmLoc(nl.dayEnd)+')'});
    else if(nl.dayEnd&&(nl.dayEnd-f.time)<45*60000) out.push({lvl:1,txt:esc(f.name)+' : '+hmLoc(f.time)+', moins de 45 min avant la nuit ('+hmLoc(nl.dayEnd)+')'});
  });
  var fl=fieldTimes(), last=fl[fl.length-1];
  if(last&&!out.length){ var n=nightLimits(last.name,last.lat,last.lon,last.time); out.push({lvl:0,txt:'Coucher du soleil à '+esc(last.name)+' : '+hmLoc(n.sun.set)+' · nuit aéronautique dès '+hmLoc(n.dayEnd)}); }
  return out;
};

function fmtFt(v){ return v==null?'—':Math.round(v/100)*100+' ft'; }
function coverTxt(c){ return c>=95?'OVC':c>=70?'BKN':c>=40?'SCT':c>=12?'FEW':'—'; }
function wxIcons(f){
  var s=''; if(f.storm) s+='⛈️'; else if(f.showers>0.2) s+='🌦️'; else if(f.precip>0.2) s+='🌧️';
  if(f.fog) s+='🌫️'; if(f.gust>=25) s+='💨'; return s||'—';
}

function tableHtml(fc){
  var rows='', bad=0, warn=0, msgs=[];
  fc.forEach(function(f){
    if(f.err) return;
    var v=vfrCheck(f), p=f.p; if(v.lvl===2) bad++; else if(v.lvl===1) warn++;
    if(v.lvl&&(p.name||v.lvl===2)) msgs.push((v.lvl===2?'🔴 ':'🟠 ')+'<b>'+(p.name?esc(p.name):Math.round(p.d)+' NM')+'</b> ('+hmLoc(p.time)+') : '+v.msgs.join(', '));
    rows+='<tr><td>'+(p.name?'<b>'+esc(p.name)+'</b>':'<small>'+Math.round(p.d)+' NM</small>')+'</td><td>'+hmLoc(p.time)+'</td><td>'+(p.ad?'sol':Math.round(p.alt)+' ft')+'</td>'
      +'<td>'+(f.base!=null&&f.baseCover>=12?coverTxt(f.baseCover)+' '+fmtFt(f.base):'pas de plafond')+'</td><td>'+(f.vis!=null?(f.vis>=10000?'≥ 10 km':(f.vis/1000).toFixed(1)+' km'):'—')+'</td>'
      +'<td>'+fmtFt(f.fz)+'</td><td>'+wxIcons(f)+(f.precip>0.05?' <small>'+f.precip.toFixed(1)+' mm/h</small>':'')+'</td>'
      +'<td>'+(f.gust!=null?Math.round(f.gust)+' kt':'—')+'</td><td><span class="rwx-b '+(v.lvl===2?'rwx-bad':v.lvl?'rwx-warn':'rwx-ok')+'">'+(v.lvl===2?'NON':v.lvl?'limite':'OK')+'</span></td></tr>';
  });
  var head='<div class="rwx-sum"><div><small>Minima VFR</small><b>'+(bad?'🔴 '+bad+' point(s) hors minima':warn?'🟠 '+warn+' point(s) limites':'🟢 tenus sur toute la route')+'</b></div>';
  var fzs=fc.filter(function(f){ return f.fz!=null; }).map(function(f){ return f.fz; });
  if(fzs.length) head+='<div><small>Isotherme 0 °C</small><b>'+fmtFt(Math.min.apply(null,fzs))+' → '+fmtFt(Math.max.apply(null,fzs))+'</b></div>';
  var bases=fc.filter(function(f){ return f.base!=null&&f.baseCover>=50; }).map(function(f){ return f.base; });
  head+='<div><small>Plafond le plus bas</small><b>'+(bases.length?fmtFt(Math.min.apply(null,bases)):'aucun (BKN/OVC)')+'</b></div>';
  var vis=fc.filter(function(f){ return f.vis!=null; }).map(function(f){ return f.vis; });
  if(vis.length) head+='<div><small>Visibilité la plus faible</small><b>'+(Math.min.apply(null,vis)>=10000?'≥ 10 km':(Math.min.apply(null,vis)/1000).toFixed(1)+' km')+'</b></div>';
  head+='</div>';
  return head+(msgs.length?'<div class="rwx-msg" style="background:rgba(239,83,80,.08)">'+msgs.slice(0,12).join('<br>')+(msgs.length>12?'<br>…':'')+'</div>':'')
    +'<div class="rwx-scroll"><table class="rwx-tbl"><tr><th>Point</th><th>Heure</th><th>Altitude</th><th>Nuages (base AMSL)</th><th>Visibilité</th><th>0 °C</th><th>Temps</th><th>Rafales</th><th>VFR</th></tr>'+rows+'</table></div>'
    +'<small style="color:var(--text-secondary)">Base des nuages estimée d\'après l\'humidité et la nébulosité AROME par niveau (pas une observation) ; minima SERA simplifiés : 5 km et 1000 ft sous le nuage au-dessus de 3000 ft, hors des nuages et en vue du sol en dessous. Toujours confirmer avec METAR/TAF, TEMSI et GAMET.</small>';
}
NLX.routeWxAlerts=function(){
  var fc=st.fc||(st.cached&&st.cached.fc); if(!fc) return null;
  var p0=routeSamples(8)[0]; if(p0&&fc[0]&&fc[0].p&&Math.abs(new Date(fc[0].p.time)-p0.time)>3*36e5) return null;   /* prévision d'un autre jour / horaire */
  if(fc.every(function(f){ return f.err; })) return null;
  var out={bad:0,warn:0,list:[]};
  fc.forEach(function(f){ if(f.err||!f.p) return; var v=vfrCheck(f); if(v.lvl===2) out.bad++; else if(v.lvl) out.warn++; if(v.lvl&&f.p.name) out.list.push({lvl:v.lvl,txt:esc(f.p.name)+' : '+v.msgs.join(', ')}); });
  var fz=fc.filter(function(f){ return f.fz!=null; }).map(function(f){ return f.fz; });
  out.fzMin=fz.length?Math.min.apply(null,fz):null; out.at=st.at||(st.cached&&st.cached.at);
  return out;
};

/* ---------- Coupe verticale ---------- */
function sectionSvg(fc){
  var ok=fc.filter(function(f){ return !f.err; }); if(ok.length<2) return '';
  var total=ok[ok.length-1].p.d||1, maxAlt=Math.max(6000,Math.max.apply(null,ok.map(function(f){ return f.p.alt||0; }))+3000);
  maxAlt=Math.min(14000,Math.ceil(maxAlt/1000)*1000);
  var W=Math.max(720,Math.min(1600,(document.getElementById('rwxRoot')||{}).clientWidth||900)), H=300, ml=46, mr=10, mt=18, mb=40, cw=W-ml-mr, ch=H-mt-mb;
  function X(d){ return ml+d/total*cw; } function Y(ft){ return mt+ch-Math.max(0,Math.min(maxAlt,ft))/maxAlt*ch; }
  var s='<svg width="'+W+'" height="'+H+'" style="width:100%;min-width:'+W+'px;font:10px sans-serif;background:linear-gradient(#5aa0e6,#bfe0ff);border-radius:8px"><defs><pattern id="rwxRain" width="6" height="8" patternUnits="userSpaceOnUse"><line x1="4" y1="0" x2="2" y2="8" stroke="#1565c0" stroke-width="1.3"/></pattern></defs>';
  for(var a=0;a<=maxAlt;a+=2000){ s+='<line x1="'+ml+'" x2="'+(W-mr)+'" y1="'+Y(a)+'" y2="'+Y(a)+'" stroke="#fff" stroke-opacity=".35"/><text x="'+(ml-4)+'" y="'+(Y(a)+3)+'" text-anchor="end" fill="#123">'+a+'</text>'; }
  /* nuages : une colonne par point, une case par couche entre niveaux */
  ok.forEach(function(f,k){
    var x0=k?X((ok[k-1].p.d+f.p.d)/2):ml, x1=k<ok.length-1?X((f.p.d+ok[k+1].p.d)/2):W-mr, lv=f.levels;
    for(var q=0;q<lv.length;q++){
      var c=lv[q].cc||0; if(c<10) continue;
      var zlo=q?(lv[q-1].z+lv[q].z)/2:f.ground, zhi=q<lv.length-1?(lv[q].z+lv[q+1].z)/2:lv[q].z+500;
      s+='<rect x="'+x0.toFixed(1)+'" y="'+Y(zhi).toFixed(1)+'" width="'+(x1-x0+0.5).toFixed(1)+'" height="'+Math.max(0,Y(zlo)-Y(zhi)).toFixed(1)+'" fill="#f5f5f5" fill-opacity="'+(c/100*0.92).toFixed(2)+'"/>';
    }
    /* turbulence : cisaillement fort */
    f.shear.forEach(function(sh){ if(sh.v>=6&&sh.z0<maxAlt) s+='<text x="'+((x0+x1)/2)+'" y="'+Y((sh.z0+sh.z1)/2)+'" text-anchor="middle" fill="#ff6d00" font-size="13" font-weight="700">〰</text>'; });
    /* pluie */
    if(f.precip>0.05){ var hgt=Math.min(ch*0.5,8+f.precip*12); s+='<rect x="'+x0.toFixed(1)+'" y="'+(Y(f.ground)-hgt).toFixed(1)+'" width="'+(x1-x0).toFixed(1)+'" height="'+hgt.toFixed(1)+'" fill="url(#rwxRain)"/>'; }
    if(f.storm) s+='<text x="'+((x0+x1)/2)+'" y="'+(mt+12)+'" text-anchor="middle" font-size="13">⛈️</text>';
    else if(f.showers>0.2) s+='<text x="'+((x0+x1)/2)+'" y="'+(mt+12)+'" text-anchor="middle" font-size="12">🌦️</text>';
    if(f.fog) s+='<rect x="'+x0.toFixed(1)+'" y="'+(Y(f.ground)-8)+'" width="'+(x1-x0).toFixed(1)+'" height="8" fill="#ddd" fill-opacity=".9"/>';
  });
  /* relief (profil d'altitude du Navlog) */
  var g=NL.profGeom;
  if(g&&g.tArr&&g.tArr.length>1){
    var pts=[], n=g.tArr.length-1;
    g.tArr.forEach(function(e,k){ pts.push(X(k/n*total).toFixed(1)+','+Y(e).toFixed(1)); });
    s+='<polygon points="'+ml+','+Y(0)+' '+pts.join(' ')+' '+(W-mr)+','+Y(0)+'" fill="#8d6e63" stroke="#5d4037"/>';
  } else {
    s+='<polygon points="'+ml+','+Y(0)+' '+ok.map(function(f){ return X(f.p.d).toFixed(1)+','+Y(f.ground).toFixed(1); }).join(' ')+' '+(W-mr)+','+Y(0)+'" fill="#8d6e63"/>';
  }
  /* isotherme 0 °C */
  var fzp=ok.filter(function(f){ return f.fz!=null; }).map(function(f){ return X(f.p.d).toFixed(1)+','+Y(f.fz).toFixed(1); });
  if(fzp.length>1) s+='<polyline points="'+fzp.join(' ')+'" fill="none" stroke="#0d47a1" stroke-width="2" stroke-dasharray="6 4"/><text x="'+(W-mr-4)+'" y="'+(Y(ok[ok.length-1].fz||0)-4)+'" text-anchor="end" fill="#0d47a1" font-weight="700">0 °C</text>';
  /* altitude prévue */
  s+='<polyline points="'+ok.map(function(f){ return X(f.p.d).toFixed(1)+','+Y(f.p.alt).toFixed(1); }).join(' ')+'" fill="none" stroke="#e91e63" stroke-width="2.5"/>';
  ok.forEach(function(f){ if(!f.p.name) return; var x=X(f.p.d);
    s+='<line x1="'+x+'" x2="'+x+'" y1="'+mt+'" y2="'+(mt+ch)+'" stroke="#123" stroke-opacity=".25"/><text x="'+x+'" y="'+(H-mb+13)+'" text-anchor="middle" fill="var(--text-primary,#123)" font-weight="700">'+esc(f.p.name.slice(0,10))+'</text><text x="'+x+'" y="'+(H-mb+25)+'" text-anchor="middle" fill="var(--text-secondary,#456)">'+hmLoc(f.p.time)+'</text>'; });
  s+='<text x="'+(ml+4)+'" y="'+(mt-5)+'" fill="#123">ft</text></svg>';
  return '<div class="rwx-x">'+s+'</div><small style="color:var(--text-secondary)">Blanc : nuages AROME (opacité = couverture) · tirets bleus : isotherme 0 °C · rose : altitude prévue · hachures bleues : pluie · 〰 : cisaillement de vent ≥ 6 kt/1000 ft (turbulence possible) · gris au sol : brouillard.</small>';
}

/* ---------- Meilleure altitude ---------- */
function bestAltHtml(fc){
  var ok=fc.filter(function(f){ return !f.err&&f.levels.length; }); if(ok.length<2) return '';
  var c=NL.getConfig(), tas=c.tas||90, burn=c.fuelBurn||20, wps=NL.waypoints;
  var mef=0; ok.forEach(function(f){ mef=Math.max(mef,f.ground); });
  var cands=[]; for(var a=1500;a<=9500;a+=500) cands.push(a);
  var res=cands.map(function(A){
    var time=0, hw=0, dsum=0, cloud=false, ice=false;
    for(var k=1;k<ok.length;k++){
      var f0=ok[k-1], f1=ok[k], d=f1.p.d-f0.p.d; if(d<=0) continue;
      var trk=NL.bearing(f0.p.lat,f0.p.lon,f1.p.lat,f1.p.lon), w=f1.atAlt(A)||{ws:0,wd:0};
      var ang=(w.wd-trk)*Math.PI/180, xw=w.ws*Math.sin(ang), head=w.ws*Math.cos(ang);
      var gs=Math.sqrt(Math.max(1,tas*tas-xw*xw))-head; gs=Math.max(20,gs);
      time+=d/gs; hw+=head*d; dsum+=d;
      if(w.cc!=null&&w.cc>=50) cloud=true;
      if(f1.base!=null&&f1.baseCover>=50&&A>=f1.base) cloud=true;
      if(cloud&&f1.fz!=null&&A>=f1.fz-500) ice=true;
    }
    return {A:A,time:time,fuel:time*burn,hw:dsum?hw/dsum:0,cloud:cloud,ice:ice,low:A<mef+1000};
  });
  var valid=res.filter(function(r){ return !r.cloud&&!r.low; });
  var best=(valid.length?valid:res).slice().sort(function(x,y){ return x.time-y.time; })[0];
  var planned=wps.filter(function(w){ return w&&+w.altitude; }).map(function(w){ return +w.altitude; });
  var rows=res.map(function(r){
    var mm=Math.round(r.time*60);
    return '<tr class="'+(r===best?'rwx-best':'')+'"><td><b>'+r.A+' ft</b>'+(planned.indexOf(r.A)>=0?' <small>(prévue)</small>':'')+'</td><td>'+Math.floor(mm/60)+'h'+('0'+mm%60).slice(-2)+'</td><td>'+r.fuel.toFixed(1)+' L</td>'
      +'<td>'+(r.hw>=0?'↓ '+Math.round(r.hw)+' kt de face':'↑ '+Math.round(-r.hw)+' kt arrière')+'</td><td>'
      +(r.low?'<span class="rwx-b rwx-bad">relief &lt; 1000 ft</span> ':'')+(r.ice?'<span class="rwx-b rwx-bad">nuages sous 0 °C</span>':r.cloud?'<span class="rwx-b rwx-warn">dans/au-dessus des nuages</span>':(r.low?'':'<span class="rwx-b rwx-ok">dégagé</span>'))+(r===best?' ⭐':'')+'</td></tr>';
  }).join('');
  return '<div class="rwx-scroll"><table class="rwx-tbl"><tr><th>Altitude</th><th>Temps de vol</th><th>Carburant</th><th>Vent moyen</th><th>Remarques</th></tr>'+rows+'</table></div>'
    +'<small style="color:var(--text-secondary)">Vents AROME à l\'heure de passage, TAS '+tas+' kt, consommation '+burn+' L/h (montée non comptée). ⭐ = la plus rapide hors nuages et à plus de 1000 ft du relief le plus haut sous la route ('+Math.round(mef)+' ft). Vérifie aussi les espaces aériens (onglet Altitudes) et la MEF.</small>';
}

function render(){
  cssOnce();
  var root=document.getElementById('rwxRoot'); if(!root) return;
  var fc=st.fc||(st.cached&&st.cached.fc), at=st.at||(st.cached&&st.cached.at);
  var html='<div class="map-card"><div class="map-card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>☀️ Jour et nuit aéronautique</span></div>'+sunHtml()+'</div>';
  html+='<div class="map-card"><div class="map-card-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span>🛣️ Prévision le long de la route (AROME Météo-France), à l\'heure de passage</span>'
    +'<button class="navlog-btn" style="font-size:.78em;padding:5px 12px" onclick="NLX.routeWxRefresh()">🔄 Actualiser</button></div>'
    +'<div style="font-size:.78em;color:var(--text-secondary);margin:2px 0 6px">'+(st.busy?'⏳ Récupération de la prévision…':st.err?'⚠️ '+esc(st.err)+(fc?' — dernière prévision gardée':'') :at?'Prévision du '+new Date(at).toLocaleString('fr-BE')+(st.fc?'':' (copie gardée hors ligne)'):'')+'</div>';
  if(fc&&fc.length){
    html+=tableHtml(fc)+'</div><div class="map-card"><div class="map-card-title">📐 Coupe verticale de la route</div>'+sectionSvg(fc)+'</div>'
      +'<div class="map-card"><div class="map-card-title">🎚️ Meilleure altitude</div>'+bestAltHtml(fc)+'</div>';
  } else html+='<p class="rwx-msg">'+(st.busy?'':'Appuie sur Actualiser (connexion Internet nécessaire).')+'</p></div>';
  root.innerHTML=html;
}
/* restaure les fonctions (atAlt) d'une copie hors ligne */
function revive(fc){
  return fc.map(function(f){
    if(f.err) return f;
    f.p.time=new Date(f.p.time);
    var lv=f.levels;
    f.atAlt=function(ft){
      if(!lv.length) return null; var lo=lv[0],hi=lv[lv.length-1];
      for(var u=1;u<lv.length;u++) if(lv[u].z>=ft){ lo=lv[u-1]; hi=lv[u]; break; }
      if(ft<=lv[0].z) lo=hi=lv[0];
      var g=hi.z>lo.z?Math.max(0,Math.min(1,(ft-lo.z)/(hi.z-lo.z))):0;
      var ux=-(lo.ws||0)*Math.sin(lo.wd*Math.PI/180)*(1-g)-(hi.ws||0)*Math.sin(hi.wd*Math.PI/180)*g,
          uy=-(lo.ws||0)*Math.cos(lo.wd*Math.PI/180)*(1-g)-(hi.ws||0)*Math.cos(hi.wd*Math.PI/180)*g;
      return {T:lo.T+(hi.T-lo.T)*g,cc:(lo.cc||0)+((hi.cc||0)-(lo.cc||0))*g,ws:Math.hypot(ux,uy),wd:(Math.atan2(-ux,-uy)*180/Math.PI+360)%360};
    };
    return f;
  });
}
if(st.cached&&st.cached.fc) try{ st.cached.fc=revive(st.cached.fc); }catch(e){ st.cached=null; }

NLX.routeWxRefresh=function(){
  var pts=routeSamples(8);
  if(pts.length<2){ st.err='route vide'; render(); return Promise.resolve(); }
  /* AROME : de la veille à J+2. Hors de cette période, pas de prévision (avant : l'heure la plus proche
     était prise sans le dire -> faux « hors minima » pour un vol daté d'il y a des mois) */
  var now=Date.now(), tf=pts[0].time.getTime();
  if(tf<now-30*36e5||tf>now+60*36e5){
    st.fc=null; st.cached=null; st.at=null; st.err='la date du vol ('+pts[0].time.toLocaleDateString('fr-BE')+') est hors de la période de prévision AROME (hier → après-demain). Change la date du vol au-dessus du tableau Navlog.';
    try{ localStorage.removeItem('rwxLast'); }catch(e){}
    render(); window.dispatchEvent(new Event('nlx:routewx')); return Promise.resolve();
  }
  if(pts.length>45){ var k=Math.ceil(pts.length/45); pts=pts.filter(function(p,i){ return p.name||i%k===0; }); }
  st.busy=true; st.err=''; render();
  return fetchFc(pts).then(function(fc){
    st.fc=fc; st.at=Date.now(); st.busy=false;
    try{ localStorage.setItem('rwxLast',JSON.stringify({at:st.at,fc:fc.map(function(f){ var o={}; for(var k in f) if(k!=='atAlt') o[k]=f[k]; return o; })})); }catch(e){}
    render(); window.dispatchEvent(new Event('nlx:routewx'));
  }).catch(function(e){ st.busy=false; st.err=String(e&&e.message||e); render(); });
};
NLX.routeWxShow=function(){
  render();
  if(!st.busy&&(!st.at||Date.now()-st.at>15*60000)&&navigator.onLine!==false) NLX.routeWxRefresh();
};
NLX.routeWxHtmlForPrint=function(){
  var fc=st.fc||(st.cached&&st.cached.fc);
  return '<h2>☀️ Jour / nuit</h2>'+sunHtml()+(fc?'<h2>🛣️ Météo de la route (AROME)</h2>'+tableHtml(fc)+sectionSvg(fc)+'<h2>🎚️ Meilleure altitude</h2>'+bestAltHtml(fc):'');
};
window.addEventListener('nl:recalc',function(){
  var sub=document.getElementById('msub-routewx');
  if(sub&&sub.classList.contains('active')) render();
});
})();
