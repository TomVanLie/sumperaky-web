import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import { clientConfig } from '../domain';
import type { Bindings } from '../env';

type LayoutProps = {
  env: Bindings;
  title?: string;
  description?: string;
  path: string;
  image?: string;
  map?: boolean;
  turnstile?: boolean;
  scripts?: string[];
  bodyClass?: string;
  children?: Child;
};

const NAV = [
  ['/', 'Mapa'],
  ['/obce', 'Obce'],
  ['/promeny', 'Proměny'],
  ['/statistiky', 'Statistiky'],
  ['/o-projektu', 'O projektu'],
] as const;

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export const Layout = (p: LayoutProps) => {
  const fullTitle = p.title ? `${p.title} | Šumperáky.cz` : 'Šumperáky.cz: mapa šumperáků v Česku a na Slovensku';
  const description =
    p.description ??
    'Komunitní mapa šumperáků, typových rodinných domů ze 70. a 80. let. Přidej šumperák ve svém okolí, fotky před a po rekonstrukci a inspiraci pro úpravy.';
  const canonical = new URL(p.path, p.env.SITE_URL).toString();
  const config = {
    ...clientConfig(),
    turnstileSiteKey: p.env.TURNSTILE_SITE_KEY,
    mapyKey: p.env.MAPY_API_KEY || null,
  };

  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="cs">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{fullTitle}</title>
          <meta name="description" content={description} />
          <link rel="canonical" href={canonical} />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="Šumperáky.cz" />
          <meta property="og:title" content={fullTitle} />
          <meta property="og:description" content={description} />
          <meta property="og:url" content={canonical} />
          {p.image && <meta property="og:image" content={new URL(p.image, p.env.SITE_URL).toString()} />}
          <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
          <link rel="stylesheet" href="/styles.css" />
          {p.map && <link rel="stylesheet" href="/vendor/maplibre/maplibre-gl.css" />}
          {raw(`<script>window.SUMP = ${json(config)};</script>`)}
          {p.turnstile && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>}
          <script type="module" src="/js/forms.js"></script>
          {p.scripts?.map((s) => <script type="module" src={s}></script>)}
        </head>
        <body class={p.bodyClass}>
          <header class="site-header">
            <a class="brand" href="/">
              <img src="/favicon.svg" alt="" width="28" height="28" />
              <span>Šumperáky.cz</span>
            </a>
            <nav class="site-nav">
              {NAV.map(([href, label]) => (
                <a href={href} class={href === p.path ? 'active' : undefined}>
                  {label}
                </a>
              ))}
            </nav>
            <a class="btn btn-primary" href="/pridat">
              + Přidat šumperák
            </a>
          </header>
          <main>{p.children}</main>
          <footer class="site-footer">
            <p>
              Šumperáky.cz: komunitní mapa typových domů. Data jsou k dispozici pod licencí{' '}
              <a href="/data">CC BY-SA 4.0</a>.
            </p>
            <p>
              <a href="/soukromi">Ochrana soukromí a žádost o skrytí domu</a> · <a href="/data">Otevřená data</a> ·{' '}
              Mapové podklady © <a href="https://openfreemap.org">OpenFreeMap</a>,{' '}
              <a href="https://www.openstreetmap.org/copyright">přispěvatelé OpenStreetMap</a>
            </p>
          </footer>
        </body>
      </html>
    </>
  );
};

export const Turnstile = ({ siteKey }: { siteKey: string }) => (
  <div class="cf-turnstile" data-sitekey={siteKey} data-appearance="interaction-only" data-language="cs"></div>
);
