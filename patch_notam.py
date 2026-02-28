import re

with open('navlog.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove the button
content = re.sub(
    r'<button class="meteo-subtab" data-sub="notam" onclick="window\.switchMeteoSub\(''notam''\)">&#x26A0;&#xFE0F; NOTAMs & Daily Warn</button>\s*',
    '',
    content
)

# Find the msub-notam block
start_idx = content.find('<div id="msub-notam" class="meteo-sub-content">')
if start_idx == -1:
    print('Could not find msub-notam')
    exit()

# Find the matching closing tag
depth = 0
end_idx = -1
i = start_idx
while i < len(content):
    if content[i:].startswith('<div'):
        depth += 1
        i += 4
    elif content[i:].startswith('</div'):
        depth -= 1
        if depth == 0:
            end_idx = i + 6
            break
        i += 5
    else:
        i += 1

if end_idx == -1:
    print('Could not find end of msub-notam')
    exit()

notam_block = content[start_idx:end_idx]
content = content[:start_idx] + content[end_idx:]

# Change ID and class
notam_block = notam_block.replace('<div id="msub-notam" class="meteo-sub-content">', '<div id="tab-notam" class="navlog-tab-content">', 1)

# Find end of tab-nav
tab_nav_idx = content.find('<div id="tab-meteo"')
if tab_nav_idx == -1:
    print('Could not find tab-meteo')
    exit()

# Insert before tab-meteo
content = content[:tab_nav_idx] + notam_block + '\n\n  ' + content[tab_nav_idx:]

# Change paste handler tab query
content = content.replace("document.getElementById('msub-notam')", "document.getElementById('tab-notam')")
content = content.replace("var meteoTab=document.getElementById('tab-meteo');\n  if(!meteoTab||!meteoTab.classList.contains('active')) return;", "/* main tab check handled by tab-notam instead */")


with open('navlog.html', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done')
