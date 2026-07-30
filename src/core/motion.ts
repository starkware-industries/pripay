// App-wide GSAP micro-interactions (GSAP is vendored in pripay/vendor).
// Everything here is decorative: guarded behind prefers-reduced-motion and
// a window.gsap check, and every tween clears its inline props on finish.
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const g = () => (window as any).gsap;

export function initMotion(): void {
  if (reduced) return;

  // Springy press on buttons, pills, wallet options (nav items have their
  // own selected-grow animation, so they're excluded here).
  document.addEventListener('pointerdown', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('.btn, .cur-pill, .act, .lg-option, .wallet-opt, .hbtn, .pp-signout, #onboardBtn, .topbar-mode button, .pager-btn');
    if (!el || (el as HTMLButtonElement).disabled) return;
    g()?.to(el, { scale: 0.96, duration: 0.1, ease: 'power2.out' });
    const release = () => g()?.to(el, { scale: 1, duration: 0.3, ease: 'back.out(2.5)', clearProps: 'transform' });
    el.addEventListener('pointerup', release, { once: true });
    el.addEventListener('pointerleave', release, { once: true });
  });

  // Text boxes keep it minimal: the CSS focus transition (border color +
  // soft ring) is the whole animation — no scale/lift.
}

// Staggered fade-up of a page's sections when it becomes active.
export function animatePageEnter(page: HTMLElement): void {
  if (reduced) return;
  let host: HTMLElement = page;
  const visibleKids = () => Array.from(host.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement && !c.classList.contains('hidden'));
  // Dashboard nests everything in one wrapper — animate inside it.
  let kids = visibleKids();
  if (kids.length === 1 && kids[0].children.length > 1) { host = kids[0]; kids = visibleKids(); }
  if (kids.length === 0) return;
  g()?.fromTo(kids,
    { opacity: 0, y: 10 },
    { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out', clearProps: 'opacity,transform' });
}

// Modal pop-in.
export function animateModalOpen(overlay: HTMLElement): void {
  if (reduced) return;
  const modal = overlay.querySelector('.modal');
  if (modal) {
    g()?.fromTo(modal,
      { opacity: 0, scale: 0.96, y: 8 },
      { opacity: 1, scale: 1, y: 0, duration: 0.24, ease: 'power3.out', clearProps: 'opacity,transform' });
  }
}

// Slide-down reveal for the People detail panel. It's shown via `display`
// (not a class), so CSS transitions can't run — GSAP does the reveal each
// time a person is selected.
export function animateDetailReveal(el: HTMLElement): void {
  if (reduced) return;
  g()?.fromTo(el,
    { opacity: 0, y: -14 },
    { opacity: 1, y: 0, duration: 0.32, ease: 'power3.out', clearProps: 'opacity,transform' });
}

// Modal close — reverse of the pop-in. Calls `done` when the tween finishes
// (or immediately when motion is off / GSAP is absent) so the caller hides
// the overlay only after the animation has played.
export function animateModalClose(overlay: HTMLElement, done: () => void): void {
  const modal = overlay.querySelector('.modal') as HTMLElement | null;
  const gsap = g();
  if (reduced || !gsap || !modal) { done(); return; }
  gsap.to(modal, {
    opacity: 0, scale: 0.96, y: 8, duration: 0.16, ease: 'power2.in',
    onComplete: () => { done(); gsap.set(modal, { clearProps: 'opacity,transform' }); },
  });
}
