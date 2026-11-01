# Šumperáky.cz

Komunitní mapa šumperáků v Česku a na Slovensku. Běží na Cloudflare Workers, data jsou v D1, fotky v R2.

## Technologie

- **Cloudflare Workers + Hono**: server-side rendering stránek (JSX) a API
- **D1**: domy, úpravy, fotky (metadata), návrhy úprav, nahlášení, historie, hlasy „je to šumperák?“, komentáře
- **R2**: fotky (v prohlížeči se zmenší na max. 2000 px a odstraní se z nich EXIF/GPS)
- **Turnstile**: ochrana všech formulářů proti spamu
- **Heslo (HTTP Basic)**: přihlášení do moderace `/admin`, volitelně Cloudflare Access
- **MapLibre + OpenFreeMap**: mapa bez API klíče
- **Photon (OpenStreetMap)**: vyhledávání adres bez API klíče
- **Mapy.com Static Panorama**: pohled z ulice natočený na dům (zdarma, jen Česko)

## Lokální vývoj

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local   # ukázková data
npm run dev             # http://localhost:8787
```

Lokálně je `/admin` přístupný bez přihlášení (`ENVIRONMENT=development` v `.dev.vars`).

## Nasazení

```sh
npx wrangler login
npx wrangler d1 create sumperaky          # ID vlož do wrangler.jsonc (database_id)
npx wrangler r2 bucket create sumperaky-photos
npm run db:migrate:remote

npx wrangler secret put TURNSTILE_SECRET  # z Cloudflare dashboardu > Turnstile
npx wrangler secret put IP_SALT           # libovolný dlouhý náhodný řetězec
npx wrangler secret put ADMIN_PASSWORD    # heslo do /admin (uživatel "admin")
npx wrangler secret put MAPY_API_KEY      # klíč z developer.mapy.com
npm run deploy
```

1. **Doména**: `sumperaky.cz` musí být jako zóna v Cloudflare účtu (u registrátora přepni NS na Cloudflare). `routes` ve `wrangler.jsonc` pak při deployi napojí doménu i `www`.
2. **Turnstile**: v dashboardu vytvoř widget pro `sumperaky.cz`, site key dej do `TURNSTILE_SITE_KEY` ve `wrangler.jsonc`, secret přes `wrangler secret put`.
3. **Moderace**: `/admin` chrání heslo `ADMIN_PASSWORD` (uživatel `admin`). Bez něj je zavřená. Místo hesla jde použít Cloudflare Access (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` ve `wrangler.jsonc`).
4. **Zálohy**: D1 má Time Travel (obnova na libovolný okamžik za posledních 30 dní).

## Pohled z ulice

Panoramata jsou z [Mapy.com](https://developer.mapy.com) (`MAPY_API_KEY`). Tarif zdarma má 250 000 kreditů měsíčně, jeden náhled stojí 4 kredity. Po vyčerpání se služba do konce měsíce pozastaví, nic se neúčtuje. Klíč je vidět v prohlížeči, proto musí být v nastavení na developer.mapy.com omezený na HTTP referer `sumperaky.cz`. Podle podmínek se panoramata nesmí ukládat, prohlížeč je načítá přímo.

Panoramata pokrývají jen Česko. U ostatních domů zůstávají odkazy na Mapy.cz a Google Street View. Kód umí volitelně i Google (`GOOGLE_MAPS_KEY`), ten ale vyžaduje billing.

Rohové domy bývají z nejbližšího panoramatu vidět z boční ulice. Proto jde u domu uložit místo pohledu (`cam_lat`, `cam_lng`, nejvýš 150 m od domu): panorama se pak hledá do 25 m od tohoto místa a natočí se na dům (`yaw` v radiánech). Místo pohledu jde zvolit při přidání domu a u existujícího domu ho navrhnout v detailu (schvaluje moderátor, v moderaci je náhled před a po).

Přiblížení (`pano_fov`, zorný úhel v radiánech, výchozí 1) pomáhá u domů daleko od ulice. Volí se při přidání, v návrhu opravy pohledu i v moderaci. Kliknutím na pohled z ulice se otevře zvětšený náhled, ve kterém jde dál přibližovat (každý krok je nový snímek, 4 kredity).

Barva fasády se vybírá kliknutím do panoramatu (Mapy.com posílá CORS hlavičky) a zaokrouhlí se na nejbližší barvu ze vzorníku `FACADE_COLORS` v `src/domain.ts`.

## Mapa a přidávání

Hlavní stránka má vlevo filtry, uprostřed mapu a pod ní detail vybraného domu, vpravo seznam domů ve výřezu mapy (po 10, kvůli kreditům Mapy.com). Klik na shluk mapu přiblíží a vypíše jen jeho domy, další pohyb mapou výběr zruší. Dům se přidává průvodcem přímo v mapě, bez přenačtení stránky (`/pridat` přesměruje na `/?pridat=1`).

## Moderace

`/admin` schvaluje nové domy po jednom, fotky, návrhy úprav, nahlášení a komentáře. `/admin/domy` najde libovolný dům a `/admin/dum/:id` ho upraví včetně místa pohledu, přiblížení, kraje a stavu záznamu (změna se uloží do historie).

## Hlasování a komentáře

U každého domu jde anonymně hlasovat, jestli je to šumperák (jeden hlas na zařízení, jde změnit). Komentáře jsou anonymní, do 1000 znaků, chrání je Turnstile, past na roboty a limit zápisů za hodinu. Text se vždy vypisuje jako prostý text (žádné HTML). Komentář s odkazem čeká na schválení v `/admin#komentare`, ostatní se zveřejní hned a moderátor je může skrýt.

## Struktura

```
migrations/        schéma D1
src/index.tsx      vstupní bod Workeru
src/routes/        pages (veřejné stránky), api, admin, files (fotky, export, sitemap)
src/views/         layout a komponenty
src/domain.ts      číselníky (stavy, typy úprav, krytiny)
public/            CSS a klientský JS (mapa, formuláře, výběr Street View)
```
