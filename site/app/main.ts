// The web app: it loads its parts, each of which wires up its own section of the page, and then sets the language.
// The parts are loaded in the order their sections stand on the page; each registers its listeners when it loads.
import '../shared/styles.css';
import '../shared/theme-switch.js';
import './form.js';
import './findings.js';
import './page.js';
import './open.js';
import './reading.js';
import './xml.js';
import './creating.js';
import './tabs.js';
import { countVisit } from '../shared/count.js';
import { renderNotes } from './creating.js';
import { renderForm } from './form.js';
import { lang, setLang } from '../shared/i18n.js';
import { renderModels } from './reading.js';
import { state } from './state.js';

function applyLang(next: 'de' | 'en'): void {
  setLang(next);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]'))
    button.setAttribute('aria-pressed', String(button.dataset.lang === next));
  renderModels();
  if (state.pdf) renderForm();
  renderNotes();
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]'))
  button.onclick = () => applyLang(button.dataset.lang as 'de' | 'en');
applyLang(lang);
countVisit();
