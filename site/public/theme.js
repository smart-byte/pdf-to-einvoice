// Runs before first paint, so the page never flashes in the wrong theme: the saved choice, else the system setting.
// A file of its own and not a few lines in the page, so that the site needs no inline script.
(() => {
  let saved;
  try {
    saved = localStorage.getItem('theme');
  } catch {
    // Private mode: the system setting decides.
  }
  document.documentElement.dataset.theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
})();
