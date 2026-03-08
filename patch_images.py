import re

with open('fetch_notams.py', 'r', encoding='utf-8') as f:
    text = f.read()

new_logic = '''
    # Next: Remote Sensing (Sats & Radar) Static Images
    skeyes_static_images = [
        ("skeyes_radar_max.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_max.gif"),
        ("skeyes_radar_ppi.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_ppi.gif"),
        ("skeyes_radar_plip.gif", "https://ops.skeyes.be/opersite/resources/images/services/meteo/radar_plip.gif"),
        ("skeyes_msg_ir_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_ir_benelux.jpg"),
        ("skeyes_msg_rgb_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_rgb_benelux.jpg"),
        ("skeyes_msg_hrv_benelux.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_hrv_benelux.jpg"),
        ("skeyes_msg_hrv.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_hrv.jpg"),
        ("skeyes_msg_ir.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_ir.jpg"),
        ("skeyes_msg_rgb.jpg", "https://ops.skeyes.be/opersite/resources/images/services/meteo/msg_rgb.jpg")
    ]

    for filename, url in skeyes_static_images:
        try:
            print(f"Fetching static image {filename}...")
            resp = session.get(url, headers={"Referer": "https://ops.skeyes.be/opersite/oper-meteo-info"})
            if resp.status_code == 200:
                with open(filename, 'wb') as f:
                    f.write(resp.content)
            else:
                print(f"Failed to fetch {filename} ({resp.status_code})")
        except Exception as e:
            print(f"Error fetching {filename}: {e}")
'''

text = re.sub(
    r'# Next: Remote Sensing \(Sats & Radar\).*?(?=print\("--- Extracting NOTAMs ---"\))',
    new_logic + '\n    ',
    text,
    flags=re.DOTALL
)

with open('fetch_notams.py', 'w', encoding='utf-8') as f:
    f.write(text)
print('Patched fetch_notams.py')
