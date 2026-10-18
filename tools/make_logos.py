#!/usr/bin/env python3
"""Logos des trois applications (Quiz PPL, Briefing VFR, Bibliothèque du pilote).

Usage :  python tools/make_logos.py     (poste local : il faut Google Chrome pour le rendu SVG → PNG)

Écrit :
  icons/src/<app>.svg                       sources vectorielles (à modifier ici, puis relancer)
  icons/<app>-192.png, -512.png             icônes « any » (coins arrondis, fond transparent)
  icons/<app>-192-maskable.png, -512-...    icônes « maskable » (plein cadre, dessin dans la zone sûre)
  assets/<app>/icon.png (1024) + splash.png (2732)   sources de @capacitor/assets pour l'APK
Pour l'appli PPL, les anciennes icônes icons/icon-*.png sont aussi remplacées (même nom).
"""
import os, shutil, subprocess, sys, tempfile
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = next((p for p in [
    r"C:/Program Files/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium"] if os.path.exists(p)), None)

PLANE = ("M256 140 C268 140 270 160 270 175 L270 205 L388 240 L388 262 L270 245 L268 300 L310 322 "
         "L310 338 L262 330 L256 342 L250 330 L202 338 L202 322 L244 300 L242 245 L124 262 L124 240 "
         "L242 205 L242 175 C242 160 244 140 256 140 Z")

LOGOS = {
    # Quiz PPL : cible (s'entraîner, viser juste) + avion + « PPL »
    "ppl": dict(bg=("#5b6cf0", "#7b3fb0"), art=f"""
      <circle cx="256" cy="232" r="146" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="20"/>
      <circle cx="256" cy="232" r="92" fill="none" stroke="#fff" stroke-opacity=".26" stroke-width="20"/>
      <g transform="translate(256 232) scale(.78) translate(-256 -240)"><path d="{PLANE}" fill="#fff"/></g>
      <text x="256" y="446" text-anchor="middle" font-family="Arial Black,Arial,Helvetica,sans-serif"
            font-weight="900" font-size="86" letter-spacing="8" fill="#fff">PPL</text>"""),
    # Briefing VFR : rose des vents, route jalonnée, nuage — préparer le vol
    "briefing": dict(bg=("#0b3d91", "#0f9fb0"), art=f"""
      <circle cx="256" cy="256" r="168" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="12"/>
      <g stroke="#fff" stroke-opacity=".55" stroke-width="12" stroke-linecap="round">
        <path d="M256 74 V108"/><path d="M256 404 V438"/><path d="M74 256 H108"/><path d="M404 256 H438"/></g>
      <path d="M256 60 L270 96 H242 Z" fill="#fff"/>
      <path d="M150 362 L226 282 L298 306 L352 214" fill="none" stroke="#ffd54f" stroke-width="16"
            stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="30 20"/>
      <g fill="#fff" stroke="#ffd54f" stroke-width="8">
        <circle cx="150" cy="362" r="17"/><circle cx="226" cy="282" r="17"/><circle cx="298" cy="306" r="17"/></g>
      <g transform="translate(366 192) rotate(38) scale(.42) translate(-256 -240)"><path d="{PLANE}" fill="#fff"/></g>
      <path d="M128 196 a34 34 0 0 1 8 -66 a46 46 0 0 1 86 -6 a34 34 0 0 1 22 72 Z" fill="#fff" fill-opacity=".92"/>"""),
    # Bibliothèque du pilote : livre ouvert d'où décolle un avion — étudier les manuels
    "biblio": dict(bg=("#f59e0b", "#b45309"), art=f"""
      <path d="M92 214 C158 184 218 188 250 214 L250 404 C218 380 158 376 92 404 Z" fill="#fff"/>
      <path d="M262 214 C294 188 354 184 420 214 L420 404 C354 376 294 380 262 404 Z" fill="#fff"/>
      <g fill="none" stroke="#e0a03a" stroke-width="9" stroke-linecap="round">
        <path d="M122 258 C160 244 198 244 226 258"/><path d="M122 298 C160 284 198 284 226 298"/>
        <path d="M122 338 C160 324 198 324 226 338"/>
        <path d="M286 258 C314 244 352 244 390 258"/><path d="M286 298 C314 284 352 284 390 298"/>
        <path d="M286 338 C314 324 352 324 390 338"/></g>
      <path d="M180 170 C214 120 268 96 330 92" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="10"
            stroke-linecap="round" stroke-dasharray="20 16"/>
      <g transform="translate(356 96) rotate(62) scale(.46) translate(-256 -240)"><path d="{PLANE}" fill="#1e3a5f"/></g>"""),
}


def svg(app, maskable=False, size=512):
    c = LOGOS[app]
    rx = 0 if maskable else 112
    scale = .8 if maskable else 1.0      # zone sûre des icônes « maskable » : cercle de 80 %
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="{size}" height="{size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="{c['bg'][0]}"/><stop offset="1" stop-color="{c['bg'][1]}"/></linearGradient></defs>
  <rect width="512" height="512" rx="{rx}" fill="url(#g)"/>
  <g transform="translate(256 256) scale({scale}) translate(-256 -256)">{c['art']}
  </g>
</svg>"""


def render(svg_text, out_png, size):
    tmp = tempfile.mkdtemp()
    html = os.path.join(tmp, "l.html")
    with open(html, "w", encoding="utf-8") as f:
        f.write('<!doctype html><html><body style="margin:0;background:transparent">' + svg_text + "</body></html>")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--user-data-dir={tmp}/u", "--default-background-color=00000000",
                    f"--window-size={size},{size}", f"--screenshot={out_png}", "file:///" + html.replace("\\", "/")],
                   check=True, capture_output=True)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    if not CHROME:
        sys.exit("Google Chrome introuvable : nécessaire pour convertir les SVG en PNG.")
    os.makedirs(os.path.join(ROOT, "icons", "src"), exist_ok=True)
    for app in LOGOS:
        with open(os.path.join(ROOT, "icons", "src", app + ".svg"), "w", encoding="utf-8") as f:
            f.write(svg(app))
        for masked in (False, True):
            big = os.path.join(ROOT, "icons", f"{app}-512{'-maskable' if masked else ''}.png")
            render(svg(app, masked, 512), big, 512)
            Image.open(big).resize((192, 192), Image.LANCZOS).save(big.replace("-512", "-192"))
        adir = os.path.join(ROOT, "assets", app)
        os.makedirs(adir, exist_ok=True)
        render(svg(app, True, 1024), os.path.join(adir, "icon.png"), 1024)
        # Écran de démarrage : logo centré sur le fond sombre de l'appli
        logo = Image.open(os.path.join(ROOT, "icons", f"{app}-512.png")).convert("RGBA").resize((900, 900), Image.LANCZOS)
        splash = Image.new("RGBA", (2732, 2732), (18, 18, 24, 255))
        splash.alpha_composite(logo, ((2732 - 900) // 2, (2732 - 900) // 2))
        splash.convert("RGB").save(os.path.join(adir, "splash.png"))
        print(app, "ok")
    # L'appli PPL garde les noms d'origine (manifest.json, anciens raccourcis)
    for a, b in [("ppl-192", "icon-192"), ("ppl-512", "icon-512"), ("ppl-192-maskable", "icon-192-maskable"),
                 ("ppl-512-maskable", "icon-512-maskable")]:
        shutil.copyfile(os.path.join(ROOT, "icons", a + ".png"), os.path.join(ROOT, "icons", b + ".png"))


if __name__ == "__main__":
    main()
