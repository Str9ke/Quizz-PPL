import re

with open('navlog.html', 'r', encoding='utf-8') as f:
    text = f.read()

radar_insert = r'''
        <div class="map-card">
          <div class="map-card-title">&#x1F4E1; Radar PLIP (Skeyes)</div>
          <div class="iframe-card" style="overflow:hidden; height:auto; min-height:300px;">
            <iframe id="autoRadarSkeyes" src="skeyes_radarplip.html" style="min-height:500px; height:500px; width:100%; border:none;" scrolling="no" loading="lazy"></iframe>
          </div>
        </div>
'''

sat_insert = r'''
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite HRV (Skeyes)</div>
          <div class="iframe-card" style="overflow:hidden; height:auto; min-height:300px;">
            <iframe id="autoSatHrv" src="skeyes_msghrv.html" style="min-height:500px; height:500px; width:100%; border:none;" scrolling="no" loading="lazy"></iframe>
          </div>
        </div>

        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite RGB (Skeyes)</div>
          <div class="iframe-card" style="overflow:hidden; height:auto; min-height:300px;">
            <iframe id="autoSatRgb" src="skeyes_msgrgb.html" style="min-height:500px; height:500px; width:100%; border:none;" scrolling="no" loading="lazy"></iframe>
          </div>
        </div>

        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite IR (Skeyes)</div>
          <div class="iframe-card" style="overflow:hidden; height:auto; min-height:300px;">
            <iframe id="autoSatIr" src="skeyes_msgir.html" style="min-height:500px; height:500px; width:100%; border:none;" scrolling="no" loading="lazy"></iframe>
          </div>
        </div>
'''

if 'skeyes_radarplip' not in text:
    text = text.replace('<div id="msub-radar" class="meteo-sub-content">', '<div id="msub-radar" class="meteo-sub-content">' + radar_insert)

if 'skeyes_msghrv' not in text:
    text = text.replace('<div id="msub-satellite" class="meteo-sub-content">', '<div id="msub-satellite" class="meteo-sub-content">' + sat_insert)

with open('navlog.html', 'w', encoding='utf-8') as f:
    f.write(text)
print('Patched navlog.html')
