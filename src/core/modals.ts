import { animateModalOpen, animateModalClose } from './motion';
import { syncEnhancedSelects } from './dropdown';

export function openM(name: string): void {
  const overlay = document.getElementById(`modal-${name}`);
  if (!overlay) return;
  overlay.classList.add('open');
  syncEnhancedSelects(overlay); // prefilled selects show the right label
  animateModalOpen(overlay);
}

export function closeM(name: string): void {
  const overlay = document.getElementById(`modal-${name}`);
  if (!overlay || !overlay.classList.contains('open')) return;
  // Play the close animation, then hide the overlay.
  animateModalClose(overlay, () => overlay.classList.remove('open'));
}
