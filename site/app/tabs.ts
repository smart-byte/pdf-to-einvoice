// The listings for developers: one is shown at a time.
import { $ } from './dom.js';
import { copyText } from './xml.js';

const tabs = [...document.querySelectorAll<HTMLButtonElement>('.tabs [role="tab"]')];
function selectTab(tab: HTMLButtonElement): void {
  for (const other of tabs) {
    other.setAttribute('aria-selected', String(other === tab));
    other.tabIndex = other === tab ? 0 : -1;
    $(`#${other.getAttribute('aria-controls')}`).hidden = other !== tab;
  }
}
for (const [i, tab] of tabs.entries()) {
  tab.onclick = () => selectTab(tab);
  // The arrow keys move from tab to tab, as in every list of tabs.
  tab.onkeydown = (event) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    const next = tabs[(i + step + tabs.length) % tabs.length]!;
    selectTab(next);
    next.focus();
  };
}
$('#code-copy').onclick = () => copyText($('.code pre:not([hidden])'), '#code-copy span');
