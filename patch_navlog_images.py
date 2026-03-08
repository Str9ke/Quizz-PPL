import re

with open('navlog.html', 'r', encoding='utf-8') as f:
    text = f.read()

radar_insert = r'''
        <div class="map-card">
          <div class="map-card-title">&#x1F4E1; Radar Max (Précipitations)</div>
          <img src="skeyes_radar_max.gif" style="width:100%; height:auto; border-radius:8px;" alt="Radar Max" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F4E1; Radar PPI</div>
          <img src="skeyes_radar_ppi.gif" style="width:100%; height:auto; border-radius:8px;" alt="Radar PPI" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F4E1; Radar PLIP</div>
          <img src="skeyes_radar_plip.gif" style="width:100%; height:auto; border-radius:8px;" alt="Radar PLIP" />
        </div>
'''

sat_insert = r'''
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG HRV (Europe)</div>
          <img src="skeyes_msg_hrv.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite HRV Europe" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG IR (Europe)</div>
          <img src="skeyes_msg_ir.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite IR Europe" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG RGB (Europe)</div>
          <img src="skeyes_msg_rgb.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite RGB Europe" />
        </div>
        
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG HRV (Benelux)</div>
          <img src="skeyes_msg_hrv_benelux.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite HRV Benelux" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG IR (Benelux)</div>
          <img src="skeyes_msg_ir_benelux.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite IR Benelux" />
        </div>
        <div class="map-card">
          <div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite MSG RGB (Benelux)</div>
          <img src="skeyes_msg_rgb_benelux.jpg" style="width:100%; height:auto; border-radius:8px;" alt="Satellite RGB Benelux" />
        </div>
'''

text = re.sub(r'<div class="map-card">\s*<div class="map-card-title">&#x1F4E1; Radar PLIP \(Skeyes\).*?</div>\s*</div>', '', text, flags=re.DOTALL)
text = re.sub(r'<div class="map-card">\s*<div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite HRV \(Skeyes\).*?</div>\s*</div>', '', text, flags=re.DOTALL)
text = re.sub(r'<div class="map-card">\s*<div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite RGB \(Skeyes\).*?</div>\s*</div>', '', text, flags=re.DOTALL)
text = re.sub(r'<div class="map-card">\s*<div class="map-card-title">&#x1F6F0;&#xFE0F; Satellite IR \(Skeyes\).*?</div>\s*</div>', '', text, flags=re.DOTALL)

text = text.replace('<div id="msub-radar" class="meteo-sub-content">', '<div id="msub-radar" class="meteo-sub-content">' + radar_insert)
text = text.replace('<div id="msub-satellite" class="meteo-sub-content">', '<div id="msub-satellite" class="meteo-sub-content">' + sat_insert)

with open('navlog.html', 'w', encoding='utf-8') as f:
    f.write(text)
print('Patched navlog.html')
