// The legal notice and the privacy policy share the language switch and the footer texts with the main page.
import { lang, setLang, t, type Lang } from './i18n.js';
import './styles.css';
import './theme-switch.js';

// The page counter of a build that has one counts nothing while this is set in the local storage of the browser.
const NOT_COUNTED = 'umami.disabled';

/** Says whether visits are counted in this browser and offers to change it. A build without the counter has no such box. */
function showCounting(): void {
  const doNotTrack = [navigator.doNotTrack, (window as { doNotTrack?: string }).doNotTrack].some((value) => value === '1' || value === 'yes');
  for (const box of document.querySelectorAll<HTMLElement>('[data-optout]')) {
    const state = box.querySelector<HTMLElement>('[data-optout-state]')!;
    const toggle = box.querySelector<HTMLButtonElement>('[data-optout-toggle]')!;
    box.hidden = false;
    let off: boolean;
    try {
      off = localStorage.getItem(NOT_COUNTED) !== null;
    } catch {
      state.textContent = t('optout.blocked');
      toggle.hidden = true;
      continue;
    }
    state.textContent = t(doNotTrack ? 'optout.dnt' : off ? 'optout.off' : 'optout.on');
    toggle.hidden = doNotTrack;
    toggle.textContent = t(off ? 'optout.start' : 'optout.stop');
    toggle.onclick = () => {
      if (off) localStorage.removeItem(NOT_COUNTED);
      else localStorage.setItem(NOT_COUNTED, '1');
      showCounting();
    };
  }
}

function apply(next: Lang): void {
  setLang(next);
  showCounting();
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.onclick = () => apply(button.dataset.lang as Lang);
apply(lang);
