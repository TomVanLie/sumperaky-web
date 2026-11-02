// Stránka domu: úpravy, fotky a nahlášení. Odkaz s kotvou (#nahlasit…) rovnou otevře příslušný panel.
const target = location.hash && document.getElementById(location.hash.slice(1));
if (target?.tagName === 'DETAILS') {
  target.open = true;
  target.scrollIntoView({ block: 'start' });
}
