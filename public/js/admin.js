for (const form of document.querySelectorAll('form[data-confirm]')) {
  form.addEventListener('submit', (e) => {
    if (!confirm(form.dataset.confirm)) e.preventDefault();
  });
}

// Zkratky při schvalování: A schválit (i s úpravami), Z zamítnout, šipka doprava přeskočit.
const review = document.querySelector('.review');
if (review) {
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, .maplibregl-map')) return;
    const key = e.key.toLowerCase();
    if (key === 'a') review.querySelector('[data-key="approve"]')?.click();
    else if (key === 'z') review.querySelector('[data-key="reject"]')?.click();
    else if (e.key === 'ArrowRight') review.querySelector('[data-key="skip"]')?.click();
  });
}
