#!/usr/bin/env python3
"""Patch navlog.html v57 - Fix runways, elevations, NCD bug, TEMSI/WINTEM UX"""
import re, sys

FILE = r'd:\Quizz PPL\navlog.html'

with open(FILE, 'r', encoding='utf-8') as f:
    c = f.read()

orig_len = len(c)

# ============================================================
# 1. FIX AIRPORT ELEVATIONS
# ============================================================
# Verified from OurAirports, Wikipedia, Belgian AIP:
# EBSG: 75 ft (was 39)
# EBCV: 194 ft (correct)
# EBCI: 614 ft (correct)
# EBNM: 594 ft (was 592)
# EBBR: 184 ft (correct)
# LFQJ: 447 ft (was 364)
# LFQQ: 157 ft (correct)
# EBCF: 955 ft (was 1165)
# EBSP: 1542 ft (was 1581)
# EBFS: 928 ft (was 935)
# EBLG: 659 ft (was 660)

old_elev = "var AIRPORT_ELEV = {\n  'EBSG':39,'EBCV':194,'EBCI':614,'EBNM':592,'EBBR':184,\n  'LFQJ':364,'LFQQ':157,'EBCF':1165,'EBSP':1581,'EBFS':935,'EBLG':660\n};"
new_elev = "var AIRPORT_ELEV = {\n  'EBSG':75,'EBCV':194,'EBCI':614,'EBNM':594,'EBBR':184,\n  'LFQJ':447,'LFQQ':157,'EBCF':955,'EBSP':1542,'EBFS':928,'EBLG':659\n};"
assert old_elev in c, "AIRPORT_ELEV not found"
c = c.replace(old_elev, new_elev, 1)
print("[OK] Airport elevations fixed")

# ============================================================
# 2. FIX RUNWAY DATABASE
# ============================================================
# Verified from Belgian AIP, OurAirports, Wikipedia:
# EBSG: 09/27 (NOT 08/26!), hdg 086, 700m, asphalt (not grass!)
# EBCV: 08/26 (not 07/25), hdg 078, 2498m, asphalt
# EBCI: 06/24 (renamed from 07/25 in Sept 2018), hdg 064, 3200m, asphalt
# EBNM: 06R/24L (motorized) hdg 062, 690m, asphalt + 06L/24R (gliders) 629m grass
# EBBR: 01/19 hdg 013, 07R/25L hdg 069, 07L/25R hdg 064
# LFQJ: 05R/23L hdg 047 1300m asphalt + 05L/23R 800m grass
# LFQQ: 08/26 hdg 077, 01/19 hdg 015
# EBCF: 12L/30R hdg 120 800m grass + 12R/30L 675m grass
# EBSP: 05/23 hdg 047, 799m asphalt
# EBFS: 08L/26R hdg 078 3385m asph + 08R/26L 2249m asph
# EBLG: 04R/22L hdg 043 3690m asph + 04L/22R 2340m asph

old_rwy = """var RUNWAY_DB = {
  'EBSG':[{rwy:'08/26',hdg:80,len:800,sfc:'grass'}],
  'EBCV':[{rwy:'07/25',hdg:70,len:2700,sfc:'asphalt'}],
  'EBCI':[{rwy:'07/25',hdg:69,len:2550,sfc:'asphalt'}],
  'EBNM':[{rwy:'06/24',hdg:59,len:700,sfc:'grass'}],
  'EBBR':[{rwy:'01/19',hdg:7,len:3211,sfc:'asphalt'},{rwy:'07R/25L',hdg:69,len:2984,sfc:'asphalt'},{rwy:'07L/25R',hdg:69,len:3638,sfc:'asphalt'}],
  'LFQJ':[{rwy:'05/23',hdg:51,len:1110,sfc:'asphalt'}],
  'LFQQ':[{rwy:'01/19',hdg:7,len:2430,sfc:'asphalt'},{rwy:'08/26',hdg:83,len:3150,sfc:'asphalt'}],
  'EBCF':[{rwy:'09/27',hdg:90,len:500,sfc:'grass'}],
  'EBSP':[{rwy:'05/23',hdg:50,len:900,sfc:'asphalt'}],
  'EBFS':[{rwy:'08/26',hdg:79,len:2400,sfc:'asphalt'}],
  'EBLG':[{rwy:'04L/22R',hdg:42,len:2344,sfc:'asphalt'},{rwy:'04R/22L',hdg:42,len:3290,sfc:'asphalt'}]
};"""

new_rwy = """var RUNWAY_DB = {
  'EBSG':[{rwy:'09/27',hdg:86,len:700,sfc:'asphalt'}],
  'EBCV':[{rwy:'08/26',hdg:78,len:2498,sfc:'asphalt'}],
  'EBCI':[{rwy:'06/24',hdg:64,len:3200,sfc:'asphalt'}],
  'EBNM':[{rwy:'06R/24L',hdg:62,len:690,sfc:'asphalt'},{rwy:'06L/24R',hdg:62,len:629,sfc:'grass'}],
  'EBBR':[{rwy:'01/19',hdg:13,len:2987,sfc:'asphalt'},{rwy:'07R/25L',hdg:69,len:3211,sfc:'asphalt'},{rwy:'07L/25R',hdg:64,len:3638,sfc:'asphalt'}],
  'LFQJ':[{rwy:'05R/23L',hdg:47,len:1300,sfc:'asphalt'},{rwy:'05L/23R',hdg:47,len:800,sfc:'grass'}],
  'LFQQ':[{rwy:'01/19',hdg:15,len:1580,sfc:'asphalt'},{rwy:'08/26',hdg:77,len:2825,sfc:'asphalt'}],
  'EBCF':[{rwy:'12L/30R',hdg:120,len:800,sfc:'grass'},{rwy:'12R/30L',hdg:120,len:675,sfc:'grass'}],
  'EBSP':[{rwy:'05/23',hdg:47,len:799,sfc:'asphalt'}],
  'EBFS':[{rwy:'08L/26R',hdg:78,len:3385,sfc:'asphalt'},{rwy:'08R/26L',hdg:78,len:2249,sfc:'asphalt'}],
  'EBLG':[{rwy:'04R/22L',hdg:43,len:3690,sfc:'asphalt'},{rwy:'04L/22R',hdg:43,len:2340,sfc:'asphalt'}]
};"""

assert old_rwy in c, "RUNWAY_DB not found"
c = c.replace(old_rwy, new_rwy, 1)
print("[OK] Runway database fixed")

# ============================================================
# 3. FIX AIRPORT COORDINATES (slight adjustments based on verified data)
# ============================================================
old_coords = "var AIRPORT_COORDS = {\n  'EBSG':{lat:50.4589,lon:3.8181},"
new_coords = "var AIRPORT_COORDS = {\n  'EBSG':{lat:50.4580,lon:3.8210},"
assert old_coords in c, "AIRPORT_COORDS EBSG not found"
c = c.replace(old_coords, new_coords, 1)
print("[OK] EBSG coords adjusted")

# ============================================================
# 4. FIX NCD TRANSLATION BUG - Add NCD, NSC, SKC, CLR, NOSIG handling
# ============================================================

# 4a. In decodeMetar: add explicit handling for NCD/NSC/SKC/CLR before weather parsing
old_decode_clouds = """    if(t.match(/^(FEW|SCT|BKN|OVC|VV)\\d{3}/)){
      var cvr={'FEW':'peu','SCT':'\\u00e9pars','BKN':'fragment\\u00e9','OVC':'couvert','VV':'visibilit\\u00e9 verticale'};"""

new_decode_clouds = """    if(t==='NCD'||t==='NSC'){parts.push('Aucun nuage d\\u00e9tect\\u00e9');continue;}
    if(t==='SKC'||t==='CLR'){parts.push('Ciel clair');continue;}
    if(t==='NOSIG'){parts.push('Pas de changement significatif');continue;}
    if(t.match(/^(FEW|SCT|BKN|OVC|VV)\\d{3}/)){
      var cvr={'FEW':'peu','SCT':'\\u00e9pars','BKN':'fragment\\u00e9','OVC':'couvert','VV':'visibilit\\u00e9 verticale'};"""

assert old_decode_clouds in c, "decodeMetar cloud pattern not found"
c = c.replace(old_decode_clouds, new_decode_clouds, 1)
print("[OK] NCD/NSC/SKC/CLR handling added to decodeMetar")

# 4b. In decodeMetar: add exclusion for special codes that are NOT weather phenomena
# We need to prevent NCD, NSC, SKC, CLR, AUTO, NOSIG, TEMPO, BECMG from matching the weather regex
old_wx_match = """    if(t.match(/^[-+]?[A-Z]{2,6}$/)){
      var int=t.charAt(0)==='-'||t.charAt(0)==='+'?t.charAt(0):'';
      var code=int?t.substring(1):t;
      var found=false;"""

new_wx_match = """    var _skipTokens={'NCD':1,'NSC':1,'SKC':1,'CLR':1,'AUTO':1,'NOSIG':1,'TEMPO':1,'BECMG':1,'CAVOK':1,'VRB':1,'RMK':1};
    if(t.match(/^[-+]?[A-Z]{2,6}$/) && !_skipTokens[t]){
      var int=t.charAt(0)==='-'||t.charAt(0)==='+'?t.charAt(0):'';
      var code=int?t.substring(1):t;
      var found=false;"""

assert old_wx_match in c, "decodeMetar weather match not found"
c = c.replace(old_wx_match, new_wx_match, 1)
print("[OK] Weather code exclusion list added to decodeMetar")

# 4c. In colorizeMetar: add NCD/NSC/SKC/CLR handling with green styling
old_colorize_cavok = """      else if(t==='CAVOK'){html+='<span style="color:#4caf50;font-weight:bold;background:rgba(76,175,80,.12);padding:1px 6px;border-radius:4px">'+t+'</span> ';}"""

new_colorize_cavok = """      else if(t==='CAVOK'||t==='NCD'||t==='NSC'||t==='SKC'||t==='CLR'){html+='<span style="color:#4caf50;font-weight:bold;background:rgba(76,175,80,.12);padding:1px 6px;border-radius:4px">'+t+'</span> ';}"""

assert old_colorize_cavok in c, "colorizeMetar CAVOK not found"
c = c.replace(old_colorize_cavok, new_colorize_cavok, 1)
print("[OK] NCD/NSC/SKC/CLR styling added to colorizeMetar")

# ============================================================
# 5. FIX TEMSI/WINTEM TAB - Remove broken iframes, improve workflow
# ============================================================

old_temsi_section = """    <!-- ===== SUB: TEMSI / WINTEM ===== -->
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
    </div>"""

new_temsi_section = """    <!-- ===== SUB: TEMSI / WINTEM ===== -->
    <div id="msub-charts" class="meteo-sub-content">
      <div style="padding:10px 0 6px;font-size:.82em;color:var(--text-secondary);text-align:center">
        &#x1F4A1; Ouvrez SOFIA Briefing &#x2192; <b>Autres M&#xe9;t&#xe9;o</b> &#x2192; TEMSI ou WINTEM &#x2192; cliquez sur la carte la plus r&#xe9;cente &#x2192; faites une capture (clic droit &#x2192; Copier l&#x2019;image) et collez-la ici (Ctrl+V)
      </div>
      <!-- TEMSI -->
      <div class="map-card">
        <div class="map-card-title">&#x1F30D; TEMSI &#x2014; Temps Significatif</div>
        <div id="mapTemsi" class="map-paste-zone" data-key="temsi" style="min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.88em;border:2px dashed var(--border-color);margin:8px 16px;border-radius:10px;flex-direction:column;gap:8px;cursor:pointer" onclick="window.uploadMap('temsi')">
          <span style="font-size:2em">&#x1F4CB;</span>
          <span>Collez (Ctrl+V) ou cliquez pour importer la carte TEMSI</span>
        </div>
        <div class="map-card-actions">
          <button onclick="window.openAeroWebPopup('https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteoautre.html')" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;font-weight:700">&#x1F30D; Ouvrir SOFIA &#x2192; TEMSI</button>
          <button onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/temsi/euroc')">&#x1F30D; A&#xe9;roWeb TEMSI</button>
          <button onclick="window.uploadMap('temsi')">&#x1F4F7; Importer</button>
          <button onclick="window.pasteMapImage('temsi')">&#x1F4CB; Coller</button>
          <button class="map-del-btn" id="delTemsi" onclick="window.deleteMapImage('temsi')" style="display:none">&#x1F5D1;&#xFE0F; Supprimer</button>
          <input type="file" id="fileTemsi" accept="image/*" style="display:none" onchange="window.handleMapUpload('temsi',this)">
        </div>
      </div>
      <!-- WINTEM -->
      <div class="map-card">
        <div class="map-card-title">&#x1F4A8; WINTEM &#x2014; Vent &amp; Temp&#xe9;rature en altitude</div>
        <div id="mapWintem" class="map-paste-zone" data-key="wintem" style="min-height:180px;display:flex;align-items:center;justify-content:center;color:var(--text-secondary);font-size:.88em;border:2px dashed var(--border-color);margin:8px 16px;border-radius:10px;flex-direction:column;gap:8px;cursor:pointer" onclick="window.uploadMap('wintem')">
          <span style="font-size:2em">&#x1F4A8;</span>
          <span>Collez (Ctrl+V) ou cliquez pour importer la carte WINTEM</span>
        </div>
        <div class="map-card-actions">
          <button onclick="window.openAeroWebPopup('https://sofia-briefing.aviation-civile.gouv.fr/sofia/pages/meteoautre.html')" style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;font-weight:700">&#x1F4A8; Ouvrir SOFIA &#x2192; WINTEM</button>
          <button onclick="window.openAeroWebPopup('https://aviation.meteo.fr/FR/aviation/OPMET/wintem/euroc')">&#x1F4A8; A&#xe9;roWeb WINTEM</button>
          <button onclick="window.uploadMap('wintem')">&#x1F4F7; Importer</button>
          <button onclick="window.pasteMapImage('wintem')">&#x1F4CB; Coller</button>
          <button class="map-del-btn" id="delWintem" onclick="window.deleteMapImage('wintem')" style="display:none">&#x1F5D1;&#xFE0F; Supprimer</button>
          <input type="file" id="fileWintem" accept="image/*" style="display:none" onchange="window.handleMapUpload('wintem',this)">
        </div>
      </div>
    </div>"""

assert old_temsi_section in c, "TEMSI/WINTEM section not found"
c = c.replace(old_temsi_section, new_temsi_section, 1)
print("[OK] TEMSI/WINTEM section redesigned (removed broken iframes, improved paste UX)")

# ============================================================
# 6. Verify and write
# ============================================================
assert "'EBSG':[{rwy:'09/27'" in c, "EBSG runway not fixed"
assert "'EBCI':[{rwy:'06/24'" in c, "EBCI runway not fixed"
assert "'EBCV':[{rwy:'08/26'" in c, "EBCV runway not fixed"
assert "'EBCF':[{rwy:'12L/30R'" in c, "EBCF runway not fixed"
assert "'EBSG':75" in c, "EBSG elevation not fixed"
assert "'EBCF':955" in c, "EBCF elevation not fixed"
assert "NCD" in c and "Aucun nuage" in c, "NCD fix missing"
assert "_skipTokens" in c, "skipTokens not added"
assert "sofia/pages/meteoautre.html" in c, "SOFIA link not updated"

with open(FILE, 'w', encoding='utf-8') as f:
    f.write(c)

print(f"\n[DONE] File patched: {orig_len} -> {len(c)} chars ({len(c)-orig_len:+d})")
