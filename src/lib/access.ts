import { createRemoteJWKSet, jwtVerify } from 'jose';
import { basicAuth } from 'hono/basic-auth';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksDomain = '';

// /admin chrání heslo (ADMIN_PASSWORD, uživatel "admin"), nebo Cloudflare Access, pokud je nastavený.
// Bez obojího je moderace zavřená.
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.env.ENVIRONMENT === 'development') return next();

  if (c.env.ADMIN_PASSWORD) {
    return basicAuth({ username: 'admin', password: c.env.ADMIN_PASSWORD, realm: 'Sumperaky moderace' })(c, next);
  }

  const team = c.env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!team || !c.env.ACCESS_AUD || !token) return c.text('Přístup odepřen', 403);

  if (!jwks || jwksDomain !== team) {
    jwks = createRemoteJWKSet(new URL(`https://${team}/cdn-cgi/access/certs`));
    jwksDomain = team;
  }
  try {
    await jwtVerify(token, jwks, { issuer: `https://${team}`, audience: c.env.ACCESS_AUD });
  } catch {
    return c.text('Přístup odepřen', 403);
  }
  return next();
};
