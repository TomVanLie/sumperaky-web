// Kopíruje MapLibre z node_modules do public/vendor, aby se mapa načítala z vlastní domény.
import { cpSync, mkdirSync } from 'node:fs';

const src = 'node_modules/maplibre-gl/dist';
const dest = 'public/vendor/maplibre';
mkdirSync(dest, { recursive: true });
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl.css']) {
  cpSync(`${src}/${f}`, `${dest}/${f}`);
}
