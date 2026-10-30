export type Bindings = {
  DB: D1Database;
  PHOTOS: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  ENVIRONMENT?: string;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET: string;
  IP_SALT: string;
  ADMIN_PASSWORD?: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  // Mapy.com API klíč (omezený na doménu sumperaky.cz): statické náhledy panoramat zdarma.
  MAPY_API_KEY?: string;
  // Klíč pro prohlížeč (omezený na doménu sumperaky.cz): Embed API + Street View Static API.
  GOOGLE_MAPS_KEY?: string;
  // Klíč pro server (omezený jen na Street View Static API): bezplatná metadata panoramat.
  GOOGLE_MAPS_SERVER_KEY?: string;
};

export type Variables = {
  clientHash: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
