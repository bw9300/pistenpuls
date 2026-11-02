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

## Accounts en reizen

Alleen uitgenodigde mensen komen erin. Iemand is een e-mailadres + naam; een reis is een gebied + voorgestelde datum + een groep mensen.
Iedereen kiest zelf zijn aankomstdatum per reis (bij de eerste keer inloggen, later in menu › Instellingen).

- **Inloggen** gaat met een persoonlijke link (`…/#invite=…`, 14 dagen geldig, werkt één keer). Daarna blijf je een jaar ingelogd (cookie).
  Op een ander apparaat: menu › Instellingen › *Ander apparaat* geeft een link van 15 minuten.
- **Of met e-mail + wachtwoord**: stel in menu › Instellingen een wachtwoord in, daarna log je overal in zonder link.
  Wachtwoorden staan gehasht (PBKDF2); na 10 foute pogingen op een e-mailadres volgt een pauze van een kwartier.
- **Wachtwoord vergeten**: op het inlogscherm vraag je een nieuwe link aan. Er gaat geen mail uit: de admin ziet een rode stip op het logo
  en het verzoek bij de persoon in Beheer, maakt een link en stuurt die (bijv. via WhatsApp). Wie die link opent, kiest meteen een nieuw wachtwoord.
- **Profielfoto**: menu › Instellingen › *Foto maken*. Alleen met de camera (geen upload), met een hoofdsilhouet als richtlijn; 320×320 JPEG in de tabel `avatars`.
  Alleen zichtbaar voor wie een reis met je deelt (`/api/avatar/<id>`). Een admin kan een foto uploaden of verwijderen (Beheer › Personen › ⋯).
- **Beheer**: 5× snel op het logo klikken (alleen voor admins). Personen toevoegen, ze aan reizen koppelen, links maken, reizen aanmaken, wie er online is.
- **De allereerste admin-link** maak je op de command line:
  ```sh
  npm run admin:invite -- --email jij@example.com --naam Jij --admin --target prod   # of preview / local
  ```
- Database: `users`, `trips`, `trip_members` (met ieders eigen aankomst), `invites`, `sessions`, `passwords`, `login_fails`, `reset_requests` (`server/directory.ts`). Tokens staan alleen gehasht opgeslagen.
  Op Cloudflare is dat D1 (`pistenpuls`, en `pistenpuls-preview` voor preview), te bekijken in het Cloudflare-dashboard. Op Node: `data/pistenpuls.db`.

## Live: per reis

Elke reis heeft een eigen kamer: wie er nu meekijkt (topbalk), wie het laatste uur online was, en de chat (rechtsonder).
Je bent verbonden met al je reizen tegelijk: van de reis op het scherm krijg je meldingen, bij je andere reizen staat het aantal nieuwe berichten op de reispil.
Wie je bent bepaalt de server (sessie + lidmaatschap worden gecontroleerd voordat de verbinding de kamer bereikt).

- `shared/live.ts`: de berichten tussen browser en server
- `server/room.ts`: de logica van een kamer (platformloos)
- Cloudflare: één Durable Object per reis, met eigen SQLite (`server/cloudflare.ts`)
- Node: `ws` + hetzelfde SQLite-bestand in `data/` (`server/node.ts`, Node 22.13 of nieuwer)

### Spelletjes

In de chat staat een knopje achter de naam van wie online is: kies een spel en daag diegene uit. Die krijgt een melding (ja/nee, 30 seconden).
Na 'ja' laden beide browsers het spel (kaart, foto's); het aftellen begint pas als beide klaar zijn (of na 15 s).
Uitdaging, antwoord en uitslag komen als regel in de chat. De kamer van de reis is de scheidsrechter: die beslist wat raak is en wie er eerst beneden is.

- **Sneeuwbalgevecht**: twee knoppen, **Gooien** en **Bukken** (of spatie / pijl omlaag). Wie het eerst 3 keer raakt wint.
- **Skiwedstrijd**: op de 3D-kaart, over een willekeurige piste van 0,5–3 km. Eén knop: zo snel mogelijk tikken (of spatie). Wie het eerst beneden is wint.

- `shared/games.ts`: berichten en toestand van een spel; `shared/snowball.ts`, `shared/ski.ts`: regels en timing
- `server/games.ts`: de scheidsrechter, draait in de kamer van de reis
- `src/games.ts`: spel kiezen, uitnodiging, wachten; `src/snowball.ts` en `src/ski.ts`: de spelschermen

Een nieuw spel: een `GameKind` erbij in `shared/games.ts`, de regels in `server/games.ts`, een scherm in `src/`.

## Een skigebied toevoegen

```sh
npm run area:add -- --id ischgl --naam "Ischgl/Samnaun" --bbox 10.2,46.95,10.35,47.03 --van 2027-01-16
```

`--bbox` is west,zuid,oost,noord in graden (bijv. via https://boundingbox.klokantech.com, formaat CSV).
Het script maakt `areas/ischgl/area.json` (vul regio en groet daarna aan) en `map.json` (hoogtedata en OpenStreetMap; Overpass kan een paar minuten duren).
Kaartdata van een bestaand gebied vernieuwen: `npm run area:add -- --id zillertal`.
Alleen de après-ski (bars, kroegen, clubs, biergartens en hutten uit OpenStreetMap, te zien bij de scène *Sfeer nu*) vernieuwen: `npm run area:add -- --id zillertal --apres`.

Sneeuwhoogtes komen van avalanche.report: dat dekt Tirol, Zuid-Tirol, Trentino en omgeving. Daarbuiten blijft die tegel voorlopig leeg.

## Hosten

| Waar | Hoe | API (webcams, live) |
|---|---|---|
| Cloudflare | `npx wrangler login` (eenmalig), `npx wrangler secret put WINDY_KEY`, dan `npm run deploy` | ja |
| Elke Node-host (VPS, Fly, Railway, Pi) | `npm run build`, dan `WINDY_KEY=... npm start` (poort via `PORT`) | ja |
| Alleen statisch (GitHub Pages, Netlify) | `npm run build`, upload `dist/`, zet `"webcams": false` en `"live": false` in `dist/config.json`: dan geen accounts, reizen kies je in de browser | nee |

### Preview

`npm run deploy:preview` zet de huidige code op een aparte Worker (`pistenpuls-preview`) met eigen live-data en een PREVIEW-label.
Eerst daar testen, dan `npm run deploy` voor de echte versie. Webcams op preview: `npx wrangler secret put WINDY_KEY --env preview`.

De API moet op hetzelfde adres draaien als de frontend (de inlogcookie is gebonden aan het adres).
