// The switch between the light and the dark theme. The theme itself is set before first paint by public/theme.js:
// the saved choice, else the system setting.
const root = document.documentElement;
const button = document.querySelector<HTMLButtonElement>('#theme');

function show(): void {
  button?.setAttribute('aria-pressed', String(root.dataset.theme === 'dark'));
  // The bar of a phone's browser takes the colour of the desk, whichever theme the system asks for.
  const desk = getComputedStyle(root).getPropertyValue('--desk').trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute('content', desk);
}

if (button)
  button.onclick = () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', root.dataset.theme);
    } catch {
      // Private mode: the choice simply lasts for this visit.
    }
    show();
  };
show();
