const SUMP = window.SUMP;

const MAX_SIDE = 2000;

// Zmenšení fotky v prohlížeči. Překreslení do canvasu zároveň zahodí EXIF včetně GPS.
const shrinkPhoto = async (file) => {
  if (!file || !file.size) return new File([], '');
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    return new File([blob], 'foto.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
};

// Sloty pro fotky: výběr souboru, fáze, rok a popisek.
const photoRow = () => {
  const row = document.createElement('div');
  row.className = 'photo-row';
  row.innerHTML = `
    <input type="file" name="photo[]" accept="image/*" />
    <select name="photo_phase[]">
      ${Object.entries(SUMP.photoPhases).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
    </select>
    <input type="number" name="photo_year[]" placeholder="Rok" min="1960" max="${new Date().getFullYear()}" />
    <input type="text" name="photo_caption[]" placeholder="Popisek (nepovinné)" maxlength="200" />`;
  return row;
};

for (const slots of document.querySelectorAll('.photo-slots')) {
  const max = Number(slots.dataset.slots) || 1;
  slots.append(photoRow());
  if (max > 1) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn-sm';
    add.textContent = '+ Další fotka';
    add.addEventListener('click', () => {
      add.before(photoRow());
      if (slots.querySelectorAll('.photo-row').length >= max) add.hidden = true;
    });
    slots.append(add);
  }
}

const turnstileToken = async (form) => {
  const input = () => form.querySelector('[name="cf-turnstile-response"]');
  for (let i = 0; i < 50 && !input()?.value; i++) await new Promise((r) => setTimeout(r, 100));
  return input()?.value;
};

const resetTurnstile = (form) => {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile) window.turnstile.reset(widget);
};

for (const form of document.querySelectorAll('form.ajax')) {
  const msg = form.querySelector('.form-msg');
  const show = (text, ok) => {
    if (!msg) return;
    msg.textContent = text;
    msg.className = `form-msg ${ok ? 'ok' : 'err'}`;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const check = form.dataset.validate && window[form.dataset.validate];
    const problem = check ? check(form) : null;
    if (problem) return show(problem, false);

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    show('Odesílám…', true);
    try {
      if (!(await turnstileToken(form))) throw new Error('Ověření proti spamu se nenačetlo. Obnov stránku.');

      const data = new FormData(form);
      const files = form.querySelectorAll('input[type="file"][name="photo[]"]');
      if (files.length) {
        data.delete('photo[]');
        for (const input of files) data.append('photo[]', await shrinkPhoto(input.files[0]));
      }

      const res = await fetch(form.action, { method: 'POST', body: data });
      const body = await res.json().catch(() => ({ ok: false, message: 'Server neodpověděl správně.' }));
      if (body.ok) form.dispatchEvent(new CustomEvent('ajax:success', { detail: body }));
      if (body.redirect) return void (location.href = body.redirect);
      show(body.message ?? (body.ok ? 'Hotovo.' : 'Něco se pokazilo.'), body.ok);
      if (body.ok && typeof body.count === 'number') form.querySelector('.count').textContent = body.count;
      else if (body.ok) form.reset();
    } catch (err) {
      show(err.message || 'Odeslání selhalo. Zkontroluj připojení.', false);
    } finally {
      button.disabled = false;
      resetTurnstile(form);
    }
  });
}

// Porovnání před a po.
for (const fig of document.querySelectorAll('figure.compare')) {
  const range = fig.querySelector('input[type="range"]');
  range.addEventListener('input', () => fig.style.setProperty('--pos', `${range.value}%`));
}

// Statický náhled Street View se po kliknutí nahradí interaktivním.
for (const frame of document.querySelectorAll('.sv-frame')) {
  frame.querySelector('.sv-interactive')?.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = frame.dataset.embed;
    iframe.loading = 'lazy';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.title = 'Google Street View';
    frame.replaceChildren(iframe);
  });
}

// Vzorník barev fasády: popisek vybrané barvy.
for (const box of document.querySelectorAll('.swatches')) {
  const label = box.querySelector('.swatch-label');
  box.addEventListener('change', (e) => {
    const key = e.target.value;
    label.textContent = key ? SUMP.facadeColors[key].label : 'Barva nezvolena';
  });
}
