// Table pagination, styled after the HeroUI pagination component (chevron
// prev/next + numbered pills, accent on the active page). Vanilla — the
// host page owns its page state and re-renders on change.

export const PAGE_SIZE = 8;

export function pageSlice<T>(items: T[], page: number): { slice: T[]; page: number; pages: number; offset: number } {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);
  const offset = (p - 1) * PAGE_SIZE;
  return { slice: items.slice(offset, offset + PAGE_SIZE), page: p, pages, offset };
}

// Which page numbers to show: first, last, and a window around the current
// page, with ellipses in the gaps (HeroUI's compact pattern).
function pageList(page: number, pages: number): (number | '…')[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const set = new Set<number>([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev > 1) out.push('…');
    out.push(n);
    prev = n;
  }
  return out;
}

export function renderPager(hostId: string, page: number, pages: number, onPage: (p: number) => void): void {
  const host = document.getElementById(hostId);
  if (!host) return;
  host.replaceChildren();
  if (pages <= 1) { host.style.display = 'none'; return; }
  host.style.display = 'flex';

  const mk = (label: string, target: number | null, opts?: { active?: boolean; disabled?: boolean; ellipsis?: boolean }) => {
    if (opts?.ellipsis) {
      const dots = document.createElement('span');
      dots.className = 'pager-ellipsis';
      dots.textContent = '…';
      host.appendChild(dots);
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pager-btn' + (opts?.active ? ' active' : '');
    b.textContent = label;
    b.disabled = !!opts?.disabled;
    if (target != null && !opts?.disabled && !opts?.active) b.addEventListener('click', () => onPage(target));
    host.appendChild(b);
  };

  mk('‹', page - 1, { disabled: page <= 1 });
  for (const n of pageList(page, pages)) {
    if (n === '…') mk('…', null, { ellipsis: true });
    else mk(String(n), n, { active: n === page });
  }
  mk('›', page + 1, { disabled: page >= pages });
}
