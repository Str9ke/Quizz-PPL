// Relais du trafic réel pour la version web du Briefing VFR (Cloudflare Worker, offre gratuite).
//
// Pourquoi : api.adsb.lol et opendata.adsb.fi ne renvoient pas d'en-tête CORS, donc une page web
// (GitHub Pages) ne peut pas lire leurs réponses ; l'appli Android, elle, les appelle en natif.
// Ce relais ne fait QUE : GET /traffic/<lat>/<lon>/<rayon NM> -> même requête chez adsb.lol (secours
// adsb.fi), réponse réduite { src, now, ac } avec l'en-tête CORS pour les pages de l'appli.
// Aucune clé, aucune donnée stockée. Déployé par .github/workflows/deploy-traffic-relay.yml.

const ALLOWED = /^(https:\/\/str9ke\.github\.io|https?:\/\/localhost(:\d+)?|https?:\/\/127\.0\.0\.1(:\d+)?|capacitor:\/\/localhost)$/;
const UA = 'QuizPPL-BriefingVFR/1.0 (+https://str9ke.github.io/Quizz-PPL/)';

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED.test(origin) ? origin : 'https://str9ke.github.io',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    };
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (origin && !ALLOWED.test(origin)) return new Response('forbidden', { status: 403, headers: cors });
    const m = new URL(req.url).pathname.match(/^\/traffic\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)\/(\d{1,3})$/);
    if (!m) return new Response('Relais trafic Briefing VFR : /traffic/<lat>/<lon>/<rayon NM>', { status: 404, headers: cors });
    const [, lat, lon] = m, dist = Math.min(150, Math.max(1, +m[3]));
    const sources = [
      `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
    ];
    for (const s of sources) {
      try {
        const r = await fetch(s, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: 4 } });
        if (!r.ok) continue;
        const j = await r.json();
        return new Response(JSON.stringify({ src: new URL(s).hostname, now: j.now, ac: j.ac || j.aircraft || [] }),
          { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) { /* source suivante */ }
    }
    return new Response(JSON.stringify({ error: 'sources de trafic indisponibles' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  },
};
