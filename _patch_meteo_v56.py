#!/usr/bin/env python3
"""Patch navlog.html for v56 - Add meteo embeds (radar, TEMSI, WINTEM, fronts, satellite, NOTAMs)"""
import re, sys

FILE = r'd:\Quizz PPL\navlog.html'

with open(FILE, 'r', encoding='utf-8') as f:
    c = f.read()

original_len = len(c)

# ============================================================
# 1. CSS: Insert meteo sub-tab styles before Tab 3 CSS
# ============================================================
CSS_INSERT = """\n/* Meteo sub-tabs */
.meteo-subtabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px;padding:4px;background:var(--bg-question);border-radius:12px}
.meteo-subtab{padding:7px 12px;font-size:.76em;font-weight:600;border-radius:10px;cursor:pointer;border:none;background:transparent;color:var(--text-secondary);transition:all .2s;white-space:nowrap}
.meteo-subtab:hover{color:#667eea;background:rgba(102,126,234,.08)}
.meteo-subtab.active{background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}
.meteo-sub-content{display:none}.meteo-sub-content.active{display:block}
.iframe-card{position:relative;width:100%;background:var(--bg-question);border-radius:8px;overflow:hidden;min-height:200px}
.iframe-card iframe{width:100%;border:none;display:block}
.iframe-blocked-msg{padding:16px;text-align:center;font-size:.82em;color:var(--text-secondary);background:rgba(102,126,234,.04);border-radius:8px;margin:8px 16px}
.iframe-blocked-msg a{color:#667eea;font-weight:600}
"""

old_css = ".ext-link:hover{border-color:#667eea;background:rgba(102,126,234,.05)}\n\n/* ===== Tab 3: Dossiers ===== */"
new_css = ".ext-link:hover{border-color:#667eea;background:rgba(102,126,234,.05)}" + CSS_INSERT + "\n/* ===== Tab 3: Dossiers ===== */"
assert old_css in c, "CSS anchor not found"
c = c.replace(old_css, new_css, 1)
print("[OK] CSS inserted")

# ============================================================
# 2. HTML: Replace entire TAB 2 content
# ============================================================
TAB2_START = '  <!-- ==================== TAB 2: METEO & CARTES ==================== -->\n  <div id="tab-meteo" class="navlog-tab-content">'
TAB3_START = '  <!-- ==================== TAB 3: DOSSIERS PREVOL ==================== -->'

idx_start = c.index(TAB2_START)
idx_end = c.index(TAB3_START)
# Find the closing </div> of tab-meteo just before TAB3
old_tab2 = c[idx_start:idx_end]

NEW_TAB2 = '''  <!-- ==================== TAB 2: METEO & CARTES ==================== -->
  <div id="tab-meteo" class="navlog-tab-content">

    <!-- Sub-tabs -->
    <div class="meteo-subtabs">
      <button class="meteo-subtab active" data-sub="radar" onclick="window.switchMeteoSub('radar')">&#x1F4E1; Radar</button>
      <button class="meteo-subtab" data-sub="charts" onclick="window.switchMeteoSub('charts')">&#x1F5FA;&#xFE0F; TEMSI / WINTEM</button>
      <button class="meteo-subtab" data-sub="fronts" onclick="window.switchMeteoSub('fronts')">&#x1F300; Fronts</button>
      <button class="meteo-subtab" data-sub="satellite" onclick="window.switchMeteoSub('satellite')">&#x1F6F0;&#xFE0F; Satellite</button>
      <button class="meteo-subtab" data-sub="notam" onclick="window.switchMeteoSub('notam')">&#x26A0;&#xFE0F; NOTAMs</button>
      <button class="meteo-subtab" data-sub="windy" onclick="window.switchMeteoSub('windy')">&#x1F32C;&#xFE0F; Windy</button>
      <button class="meteo-subtab" data-sub="aeroweb" onclick="window.switchMeteoSub('aeroweb')">&#x1F510; A&#xe9;roWeb</button>
    </div>

    <!-- ===== SUB: Radar ===== -->
    <div id="msub-radar" class="meteo-sub-content active">
      <div class="map-card">
        <div class="map-card-title">&#x1F4E1; Radar de Pr&#xe9;cipitations HD &#x2014; Europe</div>
        <div class="iframe-card">
          <iframe id="radarFrame" src="about:blank" data-src="https://www.rainviewer.com/map.html?loc=49.5,3.0,6&oFa=1&oC=1&oU=0&oCS=1&oF=0&oAP=1&c=1&o=83&lm=1&layer=radar&sm=1&sn=1" style="height:520px" loading="lazy" allow="geolocation"></iframe>
        </div>
        <div class="map-card-actions">
          <a href="https://www.rainviewer.com/map.html?loc=49.5,3.0,6&layer=radar" target="_blank" rel="noopener">&#x1F517; RainViewer</a>
          <a href="https://meteologix.com/be/radar-hd/europe" target="_blank" rel="noopener">&#x1F4E1; Meteologix Radar HD</a>
          <button onclick="var f=document.getElementById('radarFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir</button>
        </div>
      </div>
    </div>

    <!-- ===== SUB: TEMSI / WINTEM ===== -->
    <div id="msub-charts" class="meteo-sub-content">
      <!-- TEMSI -->
      <div class="map-card">
        <div class="map-card-title">&#x1F30D; TEMSI &#x2014; Temps Significatif</div>
        <div class="iframe-card">
          <iframe id="temsiFrame" src="about:blank" data-src="https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteotemsi.html" style="height:620px" loading="lazy"></iframe>
        </div>
        <div class="iframe-blocked-msg">Si la carte ne s&#x2019;affiche pas, connectez-vous d&#x2019;abord &#xe0; <a href="https://sofia-briefing.aviation-civile.gouv.fr" target="_blank">SOFIA Briefing</a> dans un autre onglet, puis rafra&#xee;chissez. Vous pouvez aussi utiliser le collage manuel ci-dessous.</div>
        <div id="mapTemsi" class="map-paste-zone" data-key="temsi" style="min-height:60px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.82em">&#x1F4CB; Capture manuelle : collez (Ctrl+V) ou importez</div>
        <div class="map-card-actions">
          <button onclick="window.openAeroWebPopup('https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteotemsi.html')">&#x1F30D; SOFIA TEMSI</button>
          <button onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/temsi/euroc')">&#x1F30D; A&#xe9;roWeb TEMSI</button>
          <button onclick="window.uploadMap('temsi')">&#x1F4F7; Importer</button>
          <button onclick="window.pasteMapImage('temsi')">&#x1F4CB; Coller</button>
          <button class="map-del-btn" id="delTemsi" onclick="window.deleteMapImage('temsi')" style="display:none">&#x1F5D1;&#xFE0F; Supprimer</button>
          <input type="file" id="fileTemsi" accept="image/*" style="display:none" onchange="window.handleMapUpload('temsi',this)">
          <button onclick="var f=document.getElementById('temsiFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir iframe</button>
        </div>
      </div>
      <!-- WINTEM -->
      <div class="map-card">
        <div class="map-card-title">&#x1F4A8; WINTEM &#x2014; Vent &amp; Temp&#xe9;rature en altitude</div>
        <div class="iframe-card">
          <iframe id="wintemFrame" src="about:blank" data-src="https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteowintem.html" style="height:620px" loading="lazy"></iframe>
        </div>
        <div class="iframe-blocked-msg">Si la carte ne s&#x2019;affiche pas, connectez-vous d&#x2019;abord &#xe0; <a href="https://sofia-briefing.aviation-civile.gouv.fr" target="_blank">SOFIA Briefing</a> dans un autre onglet, puis rafra&#xee;chissez.</div>
        <div id="mapWintem" class="map-paste-zone" data-key="wintem" style="min-height:60px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.82em">&#x1F4CB; Capture manuelle : collez (Ctrl+V) ou importez</div>
        <div class="map-card-actions">
          <button onclick="window.openAeroWebPopup('https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteowintem.html')">&#x1F4A8; SOFIA WINTEM</button>
          <button onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/wintem/euroc')">&#x1F4A8; A&#xe9;roWeb WINTEM</button>
          <button onclick="window.uploadMap('wintem')">&#x1F4F7; Importer</button>
          <button onclick="window.pasteMapImage('wintem')">&#x1F4CB; Coller</button>
          <button class="map-del-btn" id="delWintem" onclick="window.deleteMapImage('wintem')" style="display:none">&#x1F5D1;&#xFE0F; Supprimer</button>
          <input type="file" id="fileWintem" accept="image/*" style="display:none" onchange="window.handleMapUpload('wintem',this)">
          <button onclick="var f=document.getElementById('wintemFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir iframe</button>
        </div>
      </div>
    </div>

    <!-- ===== SUB: Fronts ===== -->
    <div id="msub-fronts" class="meteo-sub-content">
      <div class="map-card">
        <div class="map-card-title">&#x1F300; Carte de Fronts &#x2014; Europe</div>
        <div class="iframe-card">
          <iframe id="frontsFrame" src="about:blank" data-src="https://www.meteo.be/fr/meteo/previsions/cartes-de-fronts" style="height:650px" loading="lazy"></iframe>
        </div>
        <div class="iframe-blocked-msg">Si la carte ne s&#x2019;affiche pas : <a href="https://www.meteo.be/fr/meteo/previsions/cartes-de-fronts" target="_blank">Ouvrir meteo.be Fronts &#x2197;&#xFE0F;</a></div>
        <div id="mapFronts" class="map-paste-zone" data-key="fronts" style="min-height:60px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.82em">&#x1F4CB; Capture manuelle : collez (Ctrl+V) ou importez</div>
        <div class="map-card-actions">
          <a href="https://www.meteo.be/fr/meteo/previsions/cartes-de-fronts" target="_blank" rel="noopener">&#x1F517; meteo.be Fronts</a>
          <button onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/fronts/euroc')">&#x1F300; A&#xe9;roWeb Fronts</button>
          <button onclick="window.uploadMap('fronts')">&#x1F4F7; Importer</button>
          <button onclick="window.pasteMapImage('fronts')">&#x1F4CB; Coller</button>
          <button class="map-del-btn" id="delFronts" onclick="window.deleteMapImage('fronts')" style="display:none">&#x1F5D1;&#xFE0F; Supprimer</button>
          <input type="file" id="fileFronts" accept="image/*" style="display:none" onchange="window.handleMapUpload('fronts',this)">
          <button onclick="var f=document.getElementById('frontsFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir iframe</button>
        </div>
      </div>
    </div>

    <!-- ===== SUB: Satellite ===== -->
    <div id="msub-satellite" class="meteo-sub-content">
      <div class="map-card">
        <div class="map-card-title">&#x1F6F0;&#xFE0F; Images Satellite &#x2014; Europe</div>
        <div class="iframe-card">
          <iframe id="satFrame" src="about:blank" data-src="https://embed.windy.com/embed2.html?lat=48.5&lon=3.0&detailLat=48.5&detailLon=3.0&width=800&height=500&zoom=5&level=surface&overlay=satellite&product=satellite&menu=&message=true&marker=&calendar=now&pressure=&type=map&location=coordinates&metricWind=kt&metricTemp=%C2%B0C" style="height:520px" loading="lazy"></iframe>
        </div>
        <div class="map-card-actions">
          <a href="https://meteofrance.com/images-satellites" target="_blank" rel="noopener">&#x1F6F0;&#xFE0F; M&#xe9;t&#xe9;o-France Satellite</a>
          <a href="https://www.meteociel.fr/observations-meteo/satellite.php" target="_blank" rel="noopener">&#x1F6F0;&#xFE0F; M&#xe9;t&#xe9;ociel Visible</a>
          <a href="https://www.meteociel.fr/observations-meteo/satellite-ir.php" target="_blank" rel="noopener">&#x1F6F0;&#xFE0F; M&#xe9;t&#xe9;ociel IR</a>
          <a href="https://www.eumetsat.int/imagery/latest-imagery" target="_blank" rel="noopener">&#x1F30D; Eumetsat</a>
          <button onclick="var f=document.getElementById('satFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir</button>
        </div>
      </div>
    </div>

    <!-- ===== SUB: NOTAMs ===== -->
    <div id="msub-notam" class="meteo-sub-content">
      <div class="map-card">
        <div class="map-card-title">&#x26A0;&#xFE0F; NOTAMs &#x2014; Carte Benelux</div>
        <div class="iframe-card">
          <iframe id="notamFrame" src="about:blank" data-src="https://notaminfo.com/netherlandsmap" style="height:600px" loading="lazy"></iframe>
        </div>
        <div class="iframe-blocked-msg">Si la carte ne s&#x2019;affiche pas : <a href="https://notaminfo.com/netherlandsmap" target="_blank">Ouvrir NotamInfo &#x2197;&#xFE0F;</a></div>
        <div class="map-card-actions">
          <a href="https://notaminfo.com/netherlandsmap" target="_blank" rel="noopener">&#x1F517; NotamInfo Benelux</a>
          <a href="https://notaminfo.com/nationalmap" target="_blank" rel="noopener">&#x1F1EB;&#x1F1F7; NotamInfo France</a>
          <a href="https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/homepage.html" target="_blank" rel="noopener">&#x1F4CB; SOFIA Briefing</a>
          <a href="https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/index-en-GB.html" target="_blank" rel="noopener">&#x1F1E7;&#x1F1EA; BEL AIP / NOTAMs</a>
          <button onclick="var f=document.getElementById('notamFrame');f.src='about:blank';setTimeout(function(){f.src=f.dataset.src},100)">&#x1F504; Rafra&#xee;chir</button>
        </div>
      </div>
    </div>

    <!-- ===== SUB: Windy ===== -->
    <div id="msub-windy" class="meteo-sub-content">
      <div class="nl-card">
        <div class="nl-card-title"><span class="icon">&#x1F32C;&#xFE0F;</span> Windy &#x2014; Cartes m&#xe9;t&#xe9;o interactives</div>
        <div class="windy-grid" id="windyGrid"></div>
      </div>
    </div>

    <!-- ===== SUB: AeroWeb ===== -->
    <div id="msub-aeroweb" class="meteo-sub-content">
      <div class="aeroweb-card">
        <div class="nl-card-title"><span class="icon">&#x1F510;</span> A&#xe9;roWeb &#x2014; Cartes A&#xe9;ronautiques</div>
        <p style="font-size:.82em;color:var(--text-secondary);margin:0 0 10px">Connectez-vous ci-dessous puis naviguez vers TEMSI / WINTEM / Fronts. Faites une capture d'&#xe9;cran (&#x1F4F8; bouton ci-dessous ou Ctrl+V pour coller).</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">
          <button class="aeroweb-nav-btn" onclick="window.openAeroWebPopup('https://aviation.meteo.fr')">&#x1F3E0; Accueil</button>
          <button class="aeroweb-nav-btn" onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/temsi/euroc')">&#x1F30D; TEMSI</button>
          <button class="aeroweb-nav-btn" onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/wintem/euroc')">&#x1F4A8; WINTEM</button>
          <button class="aeroweb-nav-btn" onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/fronts/euroc')">&#x1F300; Fronts</button>
        </div>
        <button class="aeroweb-toggle-btn" id="aerowebToggle" onclick="window.openAeroWebPopup()">&#x1F310; Ouvrir A&#xe9;roWeb (nouvel onglet)</button>
        <p style="font-size:.75em;color:var(--text-secondary);margin:6px 0 0">Le login fonctionne uniquement dans un onglet s&#xe9;par&#xe9; (cookies tiers bloqu&#xe9;s dans les iframes). Connectez-vous, puis faites une capture et collez-la ici (Ctrl+V).</p>
        <div class="aeroweb-status" id="aerowebStatus"></div>
      </div>

      <!-- Extra images for dossier -->
      <div class="extra-images-area">
        <div class="nl-card-title"><span class="icon">&#x1F4F8;</span> Images suppl&#xe9;mentaires</div>
        <p style="font-size:.78em;color:var(--text-secondary);margin:0 0 8px">Ajoutez des captures d'&#xe9;cran, cartes ou documents pour le dossier de vol.</p>
        <button class="aeroweb-btn" onclick="window.addExtraImage()" style="font-size:.82em;padding:8px 18px">&#x1F4F7; Ajouter image(s)</button>
        <input type="file" id="fileExtraImages" accept="image/*" multiple style="display:none" onchange="window.handleExtraImages(this)">
        <div class="extra-images-grid" id="extraImagesGrid"></div>
      </div>
    </div>

    <!-- External links (always visible) -->
    <div class="nl-card" style="margin-top:14px">
      <div class="nl-card-title"><span class="icon">&#x1F517;</span> Liens utiles</div>
      <div class="ext-links-grid">
        <a class="ext-link" href="https://aviation.meteo.fr" target="_blank" rel="noopener">&#x1F30D; A&#xe9;roWeb (TEMSI/WINTEM)</a>
        <a class="ext-link" href="https://sofia-briefing.aviation-civile.gouv.fr" target="_blank" rel="noopener">&#x1F4CB; SOFIA Briefing</a>
        <a class="ext-link" href="https://www.meteociel.fr/modeles/gfs/france/pluie.php" target="_blank" rel="noopener">&#x1F327;&#xFE0F; M&#xe9;t&#xe9;ociel</a>
        <a class="ext-link" href="https://aviationweather.gov/gfa" target="_blank" rel="noopener">&#x1F300; AviationWeather GFA</a>
        <a class="ext-link" href="https://www.sia.aviation-civile.gouv.fr/" target="_blank" rel="noopener">&#x1F4CB; SIA France</a>
        <a class="ext-link" href="https://ops.skeyes.be/html/belgocontrol_static/eaip/eAIP_Main/html/index-en-GB.html" target="_blank" rel="noopener">&#x1F1E7;&#x1F1EA; BEL AIP / NOTAMs</a>
        <a class="ext-link" href="https://www.wetterzentrale.de/reanalysis.php?var=1&amp;map=1&amp;model=gfs" target="_blank" rel="noopener">&#x1F30D; Wetterzentrale</a>
        <a class="ext-link" href="https://www.ogimet.com/" target="_blank" rel="noopener">&#x1F4E1; OGIMET</a>
        <a class="ext-link" href="https://www.meteobelgique.be/" target="_blank" rel="noopener">&#x1F1E7;&#x1F1EA; M&#xe9;t&#xe9;o Belgique</a>
        <a class="ext-link" href="https://www.dwd.de/EN/ourservices/aviation_weather/aviation_weather.html" target="_blank" rel="noopener">&#x1F1E9;&#x1F1EA; DWD Aviation</a>
        <a class="ext-link" href="https://www.rainviewer.com/map.html" target="_blank" rel="noopener">&#x1F4E1; RainViewer</a>
        <a class="ext-link" href="https://notaminfo.com/netherlandsmap" target="_blank" rel="noopener">&#x26A0;&#xFE0F; NotamInfo</a>
      </div>
    </div>
  </div>

'''

c = c[:idx_start] + NEW_TAB2 + c[idx_end:]
print("[OK] TAB 2 HTML replaced")

# ============================================================
# 3. JS: Add switchMeteoSub function after switchTab
# ============================================================
JS_SWITCH_METEO = '''
/* ===== METEO SUB-TABS ===== */
var _meteoSubLoaded={};
function switchMeteoSub(id){
  var btns=document.querySelectorAll('.meteo-subtab');
  btns.forEach(function(b){b.classList.toggle('active',b.getAttribute('data-sub')===id);});
  var subs=document.querySelectorAll('.meteo-sub-content');
  subs.forEach(function(s){s.classList.remove('active');});
  var target=document.getElementById('msub-'+id);
  if(target) target.classList.add('active');
  /* Lazy-load iframes on first visit */
  if(!_meteoSubLoaded[id]){
    _meteoSubLoaded[id]=true;
    if(target){
      var iframes=target.querySelectorAll('iframe[data-src]');
      for(var i=0;i<iframes.length;i++){
        if(!iframes[i].src||iframes[i].src==='about:blank'){
          iframes[i].src=iframes[i].dataset.src;
        }
      }
    }
    if(id==='windy') initWindy();
  }
}
window.switchMeteoSub=switchMeteoSub;
'''

old_switch = "window.switchTab=switchTab;\n\n/* ===== FLIGHT TYPE ===== */"
new_switch = "window.switchTab=switchTab;\n" + JS_SWITCH_METEO + "\n/* ===== FLIGHT TYPE ===== */"
assert old_switch in c, "switchTab anchor not found"
c = c.replace(old_switch, new_switch, 1)
print("[OK] switchMeteoSub JS added")

# ============================================================
# 4. JS: Modify switchTab to lazy-load meteo radar on first visit
# ============================================================
old_switchTab = """function switchTab(id){
  var tabs=document.querySelectorAll('.navlog-tab');
  var contents=document.querySelectorAll('.navlog-tab-content');
  tabs.forEach(function(t,i){
    t.classList.remove('active');
    contents[i].classList.remove('active');
  });
  var map={nav:0,meteo:1,dossiers:2};
  var idx=map[id]||0;
  tabs[idx].classList.add('active');
  contents[idx].classList.add('active');
  var calBtn=document.getElementById('calToggleBtn');
  if(id==='dossiers'){calBtn.classList.add('visible');}else{calBtn.classList.remove('visible');document.getElementById('calOverlay').classList.remove('open');}
}"""

new_switchTab = """function switchTab(id){
  var tabs=document.querySelectorAll('.navlog-tab');
  var contents=document.querySelectorAll('.navlog-tab-content');
  tabs.forEach(function(t,i){
    t.classList.remove('active');
    contents[i].classList.remove('active');
  });
  var map={nav:0,meteo:1,dossiers:2};
  var idx=map[id]||0;
  tabs[idx].classList.add('active');
  contents[idx].classList.add('active');
  var calBtn=document.getElementById('calToggleBtn');
  if(id==='dossiers'){calBtn.classList.add('visible');}else{calBtn.classList.remove('visible');document.getElementById('calOverlay').classList.remove('open');}
  /* Lazy-load active meteo sub-tab on first switch */
  if(id==='meteo'){
    var activeSub=document.querySelector('.meteo-sub-content.active');
    if(activeSub){
      var subId=activeSub.id.replace('msub-','');
      if(!_meteoSubLoaded[subId]) switchMeteoSub(subId);
    }
  }
}"""

assert old_switchTab in c, "switchTab body not found"
c = c.replace(old_switchTab, new_switchTab, 1)
print("[OK] switchTab modified for lazy loading")

# ============================================================
# 5. JS: Make initWindy lazy (guard against double-init)
# ============================================================
old_initWindy_start = "function initWindy(){\n  var layers=["
new_initWindy_start = "var _windyInited=false;\nfunction initWindy(){\n  if(_windyInited) return;\n  _windyInited=true;\n  var layers=["
assert old_initWindy_start in c, "initWindy start not found"
c = c.replace(old_initWindy_start, new_initWindy_start, 1)
print("[OK] initWindy guarded")

# ============================================================
# 6. JS: Remove immediate initWindy() call from init()
# ============================================================
old_init_windy = "  initWindy();\n  /* Restore saved map captures */"
new_init_windy = "  /* initWindy() is now lazy-loaded when Windy sub-tab is activated */\n  /* Restore saved map captures */"
assert old_init_windy in c, "init() initWindy call not found"
c = c.replace(old_init_windy, new_init_windy, 1)
print("[OK] initWindy removed from init()")

# ============================================================
# 7. Verify and write
# ============================================================
# Sanity checks
assert 'meteo-subtabs' in c
assert 'msub-radar' in c
assert 'msub-charts' in c
assert 'msub-fronts' in c
assert 'msub-satellite' in c
assert 'msub-notam' in c
assert 'msub-windy' in c
assert 'msub-aeroweb' in c
assert 'switchMeteoSub' in c
assert 'radarFrame' in c
assert 'satFrame' in c
assert 'notamFrame' in c
assert '_meteoSubLoaded' in c
assert 'TAB 3' in c

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(c)

print(f"\n[DONE] File patched: {original_len} -> {len(c)} chars (+{len(c)-original_len})")
