import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv } from './env';
import { admin } from './routes/admin';
import { api } from './routes/api';
import { files } from './routes/files';
import { pages } from './routes/pages';
import { Layout } from './views/layout';

const app = new Hono<AppEnv>();

// www.sumperaky.cz -> sumperaky.cz
app.use('*', async (c, next) => {
  const u = new URL(c.req.url);
  if (u.hostname.startsWith('www.')) {
    u.hostname = u.hostname.slice(4);
    return c.redirect(u.toString(), 301);
  }
  return next();
});

// Lokálně testovací klíč Turnstile, produkční funguje jen na sumperaky.cz.
app.use('*', async (c, next) => {
  if (c.env.ENVIRONMENT === 'development') c.env.TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
  return next();
});

app.use('*', secureHeaders({ referrerPolicy: 'strict-origin-when-cross-origin', crossOriginEmbedderPolicy: false }));

app.route('/api', api);
app.route('/admin', admin);
app.route('/', files);
app.route('/', pages);

app.notFound((c) =>
  c.html(
    <Layout env={c.env} path={c.req.path} title="Stránka nenalezena">
      <div class="page">
        <h1>Tady nic není</h1>
        <p>
          Stránka neexistuje. <a href="/">Zpět na mapu</a>
        </p>
      </div>
    </Layout>,
    404,
  ),
);

app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  console.error(err);
  if (c.req.path.startsWith('/api/')) return c.json({ ok: false, message: 'Něco se pokazilo. Zkus to prosím znovu.' }, 500);
  return c.text('Něco se pokazilo. Zkus to prosím znovu.', 500);
});

export default app;
