// Custom dropdown for the currency selects, matching the shadcn/Base-UI
// dropdown-menu design (rounded popup panel, hover-highlighted items, a
// check indicator on the selected option, scale/opacity open transition).
// This app is vanilla TS — no React — so the component wraps the existing
// native <select>: the select keeps holding state and firing 'change', all
// existing handlers stay untouched; only the visible control is replaced.

import { tokenIcon } from './token-icons';

// Small round token logo for a currency option value (usdc/strk/eth/…),
// or null when the value isn't a known token (periods, modes, types).
function tokenIconImg(value: string): HTMLImageElement | null {
  const src = tokenIcon(value);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.className = 'dd-ticon-img';
  return img;
}

const CHECK_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const CHEVRON_SVG =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

let openMenu: HTMLElement | null = null;
let openCleanup: (() => void) | null = null;

function closeOpenMenu(): void {
  if (!openMenu) return;
  const menu = openMenu;
  openMenu = null;
  openCleanup?.();
  openCleanup = null;
  menu.classList.remove('dd-open');
  setTimeout(() => menu.remove(), 130); // let the exit transition play
}

function buildMenu(select: HTMLSelectElement, trigger: HTMLElement): void {
  if (openMenu) { closeOpenMenu(); return; }
  syncTriggerLabel(select, trigger); // heal from programmatic value sets (form resets/prefills)

  const menu = document.createElement('div');
  menu.className = 'dd-menu';
  menu.setAttribute('role', 'listbox');
  // If any option is a token, reserve a fixed icon slot for EVERY option so
  // the labels left-align regardless of whether that row has an icon.
  const hasIcons = Array.from(select.options).some((o) => tokenIcon(o.textContent ?? o.value));

  for (const opt of Array.from(select.options)) {
    const item = document.createElement('div');
    item.className = 'dd-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(opt.selected));

    const check = document.createElement('span');
    check.className = 'dd-check';
    if (opt.selected) check.innerHTML = CHECK_SVG;

    const label = document.createElement('span');
    const text = opt.textContent ?? opt.value;

    if (hasIcons) {
      const slot = document.createElement('span');
      slot.className = 'dd-iconslot';
      const ic = tokenIconImg(text);
      // Fiat rows ("$ USD" / "₪ ILS") put their currency symbol in the icon
      // slot so it lines up with the token logos; text becomes just the code.
      const sym = text.match(/^([^\w\s])\s+(.+)$/);
      if (ic) { slot.appendChild(ic); label.textContent = text; }
      else if (sym) { slot.textContent = sym[1]; label.textContent = sym[2]; }
      else label.textContent = text;
      item.append(check, slot, label);
    } else {
      label.textContent = text;
      item.append(check, label);
    }
    item.addEventListener('click', () => {
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncTriggerLabel(select, trigger);
      closeOpenMenu();
    });
    menu.appendChild(item);
  }

  // Portal to <body> (the input groups clip overflow), positioned under the
  // trigger, right-aligned like the reference's align="start" popup.
  document.body.appendChild(menu);
  const r = trigger.getBoundingClientRect();
  const mw = Math.max(menu.offsetWidth, r.width);
  menu.style.minWidth = `${Math.max(128, r.width)}px`;
  menu.style.left = `${Math.min(r.left, window.innerWidth - mw - 8)}px`;
  menu.style.top = `${r.bottom + 4}px`;

  requestAnimationFrame(() => menu.classList.add('dd-open'));
  openMenu = menu;

  const onOutside = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node) && e.target !== trigger && !trigger.contains(e.target as Node)) closeOpenMenu();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeOpenMenu(); };
  const onScroll = () => closeOpenMenu();
  document.addEventListener('mousedown', onOutside);
  document.addEventListener('keydown', onKey);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  openCleanup = () => {
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  };
}

function syncTriggerLabel(select: HTMLSelectElement, trigger: HTMLElement): void {
  const label = trigger.querySelector('.dd-label');
  const ticon = trigger.querySelector('.dd-ticon');
  const text = select.selectedOptions[0]?.textContent ?? select.value;
  const ic = tokenIconImg(text);
  const sym = text.match(/^([^\w\s])\s+(.+)$/); // fiat symbol → icon slot
  if (ticon) {
    ticon.replaceChildren();
    if (ic) ticon.appendChild(ic);
    else if (sym) ticon.textContent = sym[1];
  }
  if (label) label.textContent = ic ? text : (sym ? sym[2] : text);
}

// Replaces a native select's visible control with the styled trigger.
// The select stays in the DOM (hidden) as the source of truth.
export function enhanceSelect(id: string): void {
  const select = document.getElementById(id) as HTMLSelectElement | null;
  if (!select || select.dataset.ddEnhanced) return;
  select.dataset.ddEnhanced = '1';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  // Full-width selects (.sel) get the block variant that mirrors input styling.
  trigger.className = 'dd-trigger' + (select.classList.contains('sel') ? ' dd-block' : '');
  trigger.setAttribute('aria-haspopup', 'listbox');
  const ticon = document.createElement('span');
  ticon.className = 'dd-ticon';
  const label = document.createElement('span');
  label.className = 'dd-label';
  label.textContent = select.selectedOptions[0]?.textContent ?? select.value;
  const chev = document.createElement('span');
  chev.className = 'dd-chevron';
  chev.innerHTML = CHEVRON_SVG;
  trigger.append(ticon, label, chev);
  syncTriggerLabel(select, trigger);
  trigger.addEventListener('click', (e) => { e.stopPropagation(); buildMenu(select, trigger); });

  // Keep the trigger in step when code sets select.value programmatically
  // (form resets, prefills) — those paths fire 'change' already.
  select.addEventListener('change', () => syncTriggerLabel(select, trigger));

  select.style.display = 'none';
  select.insertAdjacentElement('afterend', trigger);
  // Modals prefill selects programmatically (no 'change' event) — expose a
  // resync hook that openM calls when a modal opens.
  (select as any)._ddSync = () => syncTriggerLabel(select, trigger);
}

// Re-sync every enhanced select inside a container (called on modal open).
export function syncEnhancedSelects(root: HTMLElement): void {
  root.querySelectorAll<HTMLSelectElement>('select[data-dd-enhanced]').forEach((s) => (s as any)._ddSync?.());
}
