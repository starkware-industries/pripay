const history: string[] = [];
const pageRenders: Record<string, () => void> = {};

// Called after every nav so the page shows fresh on-chain data without an F5.
// Registered from main.ts to avoid a core→pages import.
let onNavigate: ((name: string) => void) | null = null;
export function setOnNavigate(cb: (name: string) => void): void {
  onNavigate = cb;
}

export function registerPage(name: string, render: () => void): void {
  pageRenders[name] = render;
}

// Returns false to block navigation to a page (wallet not connected, or non-admin).
// Registered from main.ts to avoid a core→state import. Blocked navigations fall
// back to the dashboard.
let navGuard: ((name: string) => boolean) | null = null;
export function setNavGuard(cb: (name: string) => boolean): void {
  navGuard = cb;
}

export function nav(name: string, pushHistory = true): void {
  if (navGuard && name !== 'dashboard' && !navGuard(name)) {
    name = 'dashboard';
    pushHistory = false;
  }
  const cur = document.querySelector('.page.active');
  if (pushHistory && cur && cur.id !== 'page-' + name) {
    history.push(cur.id.replace('page-', ''));
  }
  document.querySelectorAll<HTMLElement>('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name)?.classList.add('active');
  document.querySelector<Element>(`.nav-item[data-page="${name}"]`)?.classList.add('active');
  document.getElementById('backBtn')?.classList.toggle('visible', history.length > 0);
  pageRenders[name]?.();
  onNavigate?.(name);
}

export function navBack(): void {
  if (!history.length) return;
  nav(history.pop()!, false);
}
