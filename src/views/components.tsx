import { FACADE_COLORS, MODIFICATIONS, STATES, isKey } from '../domain';
import { addressLine, type House } from '../db';
import type { Bindings } from '../env';
import { mapyLink, mapyPanoStatic, streetViewEmbed, streetViewLink, streetViewStatic } from '../lib/streetview';

export const photoUrl = (key: string) => `/foto/${key}`;

export const StateBadge = ({ state }: { state: string }) =>
  isKey(STATES, state) ? (
    <span class="badge" style={`--c:${STATES[state].color}`}>
      {STATES[state].label}
    </span>
  ) : null;

export const ModList = ({ mods }: { mods: string[] }) =>
  mods.length ? (
    <ul class="tags">
      {mods.filter((m) => isKey(MODIFICATIONS, m)).map((m) => (
        <li>{MODIFICATIONS[m as keyof typeof MODIFICATIONS]}</li>
      ))}
    </ul>
  ) : null;

export type CardHouse = Pick<House, 'id' | 'state' | 'street' | 'house_number' | 'hide_number' | 'municipality'> & {
  photo?: string | null;
  mods?: string | null;
};

type PanoKeys = Pick<Bindings, 'MAPY_API_KEY' | 'GOOGLE_MAPS_KEY'>;
type PanoHouse = { lat: number; lng: number; country?: string; sv_heading?: number | null; sv_pitch?: number | null };

// Náhled z ulice: přednostně Mapy.com (zdarma, jen Česko), jinak Google, pokud je nastavený klíč.
export const panoUrl = (keys: PanoKeys, h: PanoHouse, small = false) => {
  if (keys.MAPY_API_KEY && h.country !== 'sk') return mapyPanoStatic(keys.MAPY_API_KEY, h, small ? 400 : 1024, small ? 260 : 640);
  if (keys.GOOGLE_MAPS_KEY) return streetViewStatic(keys.GOOGLE_MAPS_KEY, h, small ? '400x260' : '640x400');
  return null;
};

// Když panorama v okolí neexistuje, obrázek se nenačte a nahradí ho zástupný text.
const hideOnError = "this.parentElement.classList.add('pano-missing')";

export const HouseCard = ({ h, keys }: { h: CardHouse & PanoHouse; keys: PanoKeys }) => {
  const img = h.photo ? photoUrl(h.photo) : panoUrl(keys, h, true);
  return (
    <a class="card" href={`/dum/${h.id}`}>
      <div class="card-img">
        {img && <img src={img} alt="" loading="lazy" onerror={hideOnError} />}
        <div class="card-noimg">Bez fotky</div>
      </div>
      <div class="card-body">
        <strong>{addressLine(h) || h.municipality}</strong>
        <StateBadge state={h.state} />
      </div>
    </a>
  );
};

export const StreetView = ({ h, keys }: { h: House; keys: PanoKeys }) => {
  const img = panoUrl(keys, h);
  const fromMapy = !!keys.MAPY_API_KEY && h.country !== 'sk';
  return (
    <section class="streetview">
      <div class={img ? 'sv-frame' : 'sv-frame pano-missing'} data-embed={!fromMapy && keys.GOOGLE_MAPS_KEY ? streetViewEmbed(keys.GOOGLE_MAPS_KEY, h) : undefined}>
        {img && <img src={img} alt="Pohled z ulice" onerror={hideOnError} />}
        <div class="sv-placeholder">Pohled z ulice zde není k dispozici</div>
        {!fromMapy && keys.GOOGLE_MAPS_KEY && (
          <button type="button" class="btn sv-interactive">
            Procházet interaktivně
          </button>
        )}
      </div>
      <p class="sv-links">
        {fromMapy && <span class="muted">Panorama © Seznam.cz a.s. a další · </span>}
        <a href={mapyLink(h)} target="_blank" rel="noopener">
          Procházet panorama na Mapy.cz
        </a>{' '}
        · <a href={streetViewLink(h)} target="_blank" rel="noopener">Google Street View</a>
      </p>
    </section>
  );
};

export const FacadeSwatch = ({ color }: { color: string | null }) =>
  color && isKey(FACADE_COLORS, color) ? (
    <span class="facade-swatch">
      <span class="swatch" style={`--c:${FACADE_COLORS[color].hex}`}></span> {FACADE_COLORS[color].label}
    </span>
  ) : null;

// Vzorník barev fasády. V režimu picker jde barvu vybrat i kliknutím do panoramatu (viz add.js).
export const FacadeSwatches = ({ selected, picker }: { selected?: string | null; picker?: boolean }) => (
  <fieldset class="swatches" data-picker={picker ? '1' : undefined}>
    <legend>Barva fasády{picker ? ' (nepovinné)' : ''}</legend>
    {picker && (
      <p class="muted small swatch-hint">
        👆 Klikni na fasádu v obrázku z ulice a barvu vybereme za tebe. Nebo ji zvol tady.
      </p>
    )}
    <div class="swatch-list">
      <label title="Nevím">
        <input type="radio" name="facade_color" value="" checked={!selected} />
        <span class="swatch swatch-none">?</span>
      </label>
      {Object.entries(FACADE_COLORS).map(([k, f]) => (
        <label title={f.label}>
          <input type="radio" name="facade_color" value={k} checked={selected === k} />
          <span class="swatch" style={`--c:${f.hex}`}></span>
        </label>
      ))}
    </div>
    <p class="small swatch-label" aria-live="polite">
      {selected && isKey(FACADE_COLORS, selected) ? FACADE_COLORS[selected].label : 'Barva nezvolena'}
    </p>
  </fieldset>
);
