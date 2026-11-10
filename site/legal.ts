// The legal notice and the privacy policy share the language switch and the footer texts with the main page.
import { lang, setLang, type Lang } from './i18n.js';
import './styles.css';

function apply(next: Lang): void {
  setLang(next);
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === next));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) button.onclick = () => apply(button.dataset.lang as Lang);
apply(lang);
