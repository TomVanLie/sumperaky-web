for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
}

// Zkratky při schvalování: A schválit, Z zamítnout, šipka doprava přeskočit.
const review = document.querySelector('.review');
if (review) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select')) return;
    const key = e.key.toLowerCase();
    if (key === 'a') review.querySelector('form[action$="/approve"]')?.requestSubmit();
    else if (key === 'z') review.querySelector('form[action$="/reject"][data-confirm]')?.requestSubmit();
    else if (e.key === 'ArrowRight') review.querySelector('[data-key="skip"]')?.click();
  });
}
