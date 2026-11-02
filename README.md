# Pistenpuls

Aftel-dashboard voor de skivakantie: een 3D-diorama van het echte skigebied met weer, sneeuwhoogte en webcams.

## Starten

```sh
npm install
npm run dev        # http://localhost:5173 (frontend) + API op :8787
```

Webcams hebben een Windy-sleutel nodig: zet `WINDY_KEY=...` in `.env` (Node) en `.dev.vars` (Cloudflare lokaal).
Een gratis sleutel maak je aan op https://api.windy.com/keys (kies 'Webcams API').

## Structuur

```
src/            frontend (Vite + TypeScript + three.js)
  main.ts       opstart: leest /config.json en start de app
  app.ts        3D-scène, scènes/tegels, state machine
  terrain.ts    terrein, bos, pistes, liften, gebouwen (geen DOM: draait ook in Node)
  data.ts       weer, sneeuw, webcams, kaartdata
  settings.ts   wizard en instellingen (opgeslagen in de browser)
  config.ts     vaste instellingen + /config.json per deployment
  areas.ts      leest alle gebieden uit areas/
server/
  app.ts        de API (Hono), los van het platform
  cloudflare.ts koppeling met Cloudflare Workers
  node.ts       koppeling met Node (elke host)
areas/<id>/     één map per skigebied: area.json (+ map.json, gegenereerd)
tools/          add-area.ts
public/         config.json (per deployment aan te passen)
```

## Een skigebied toevoegen

```sh
npm run area:add -- --id ischgl --naam "Ischgl/Samnaun" --bbox 10.2,46.95,10.35,47.03 --van 2027-01-16
```

`--bbox` is west,zuid,oost,noord in graden (bijv. via https://boundingbox.klokantech.com, formaat CSV).
Het script maakt `areas/ischgl/area.json` (vul regio en groet daarna aan) en `map.json` (hoogtedata en OpenStreetMap; Overpass kan een paar minuten duren).
Kaartdata van een bestaand gebied vernieuwen: `npm run area:add -- --id zillertal`.

Sneeuwhoogtes komen van avalanche.report: dat dekt Tirol, Zuid-Tirol, Trentino en omgeving. Daarbuiten blijft die tegel voorlopig leeg.

## Hosten

| Waar | Hoe | API (webcams, straks live) |
|---|---|---|
| Cloudflare | `npx wrangler login` (eenmalig), `npx wrangler secret put WINDY_KEY`, dan `npm run deploy` | ja |
| Elke Node-host (VPS, Fly, Railway, Pi) | `npm run build`, dan `WINDY_KEY=... npm start` (poort via `PORT`) | ja |
| Alleen statisch (GitHub Pages, Netlify) | `npm run build`, upload `dist/`, zet `"webcams": false` in `dist/config.json` | nee |

Draait de API op een ander adres dan de frontend, zet dat adres dan in `config.json` › `apiBase`.
