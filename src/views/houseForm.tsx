import { DESIGNS, MODIFICATIONS, ROOFS, STATES } from '../domain';
import type { House } from '../db';
import { FacadeSwatches } from './components';

// Údaje o domě sdílené formulářem návrhu úprav, přidáním domu a moderací.
export const HouseFields = ({ house, mods, withState = true }: { house?: Partial<House>; mods?: string[]; withState?: boolean }) => (
  <>
    {withState && (
      <label>
        Stav domu
        <select name="state" required>
          <option value="">Vyber…</option>
          {Object.entries(STATES).map(([k, s]) => (
            <option value={k} selected={house?.state === k}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
    )}
    {withState && (
      <label>
        Návrh
        <select name="design">
          {Object.entries(DESIGNS).map(([k, l]) => (
            <option value={k} selected={(house?.design ?? 'original') === k}>
              {l}
            </option>
          ))}
        </select>
      </label>
    )}
    <fieldset class="mods">
      <legend>Typ úprav (lze vybrat více)</legend>
      {Object.entries(MODIFICATIONS).map(([k, l]) => (
        <label class="check">
          <input type="checkbox" name="modifications[]" value={k} checked={mods?.includes(k)} /> {l}
        </label>
      ))}
    </fieldset>
    <div class="row">
      <label>
        Rok stavby
        <input name="year_built" type="number" min={1950} max={2030} value={house?.year_built ?? ''} />
      </label>
      <label>
        Rok rekonstrukce
        <input name="year_renovated" type="number" min={1960} max={2030} value={house?.year_renovated ?? ''} />
      </label>
    </div>
    <div class="row">
      <label>
        Střešní krytina
        <select name="roof">
          <option value="">Nevím</option>
          {Object.entries(ROOFS).map(([k, l]) => (
            <option value={k} selected={house?.roof === k}>
              {l}
            </option>
          ))}
        </select>
      </label>
    </div>
    {withState && <FacadeSwatches selected={house?.facade_color} />}
    <label>
      Poznámka
      <textarea name="note" rows={3} maxlength={2000}>
        {house?.note ?? ''}
      </textarea>
    </label>
    <label>
      Odkaz (článek, inzerát, blog o rekonstrukci)
      <input name="link" type="url" maxlength={1000} value={house?.link ?? ''} />
    </label>
  </>
);
