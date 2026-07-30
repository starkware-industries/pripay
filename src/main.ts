import { fetchNISRates, renderFxRateChip } from './core/prices';
import { hydrateFromDB, state } from './core/state';
import { nav, registerPage, setOnNavigate, setNavGuard } from './core/nav';
import { openM, closeM } from './core/modals';
import { connectWithWallet, disconnectWallet, renderNetworkPill, renderWalletPicker } from './core/wallet';
import { renderCompanyCard, renderStats, saveCompany, renderOnchainCard, dismissSetup, startOnboarding, submitDeposit, refreshDepositBalance, setDepCurrency, prepareDepositModal, submitWithdraw, refreshWithdrawBalance, setWdCurrency, prepareWithdrawModal, submitSwap, refreshSwapBalance, setSwFromCurrency, setSwToCurrency, prepareConvertModal, refreshTreasuryBalance, refreshAuditLog, shieldContractBalance, withdrawContractBalance } from './pages/dashboard';
import { renderSettings, submitPaymasterKey, loadLocalPaymaster, configureAvnuPaymaster, clearPaymaster, signHelloMessage } from './pages/settings';
import { renderProfiles, selectProfile, closeProfileDetail, addToRecurrent, goOneTime, saveProfile, populatePickProfile, renderPickProfileList, prefillOneTime, setPickProfileTarget, invokePickProfileTarget, openEditProfile, enterDetailEdit, cancelDetailEdit, saveDetailEdit, isDetailEditing, flashDetailEditError, removeProfile, toggleProfileSelectAll, toggleProfileRow, bulkRemoveProfiles, resetAddProfileForm, confirmRemoveProfile, handleAbDrop, parseAbCsvFile, importAbDone, saveCompleteImportedProfiles, downloadProfilesCsvTemplate, setProfileTypeFilter, exportPeopleCsv, resetProfilePage } from './pages/profiles';
import { renderRec, openEditOrder, recomputeEoTransferred, setEoCurrency, saveOrder, removeOrder, recomputeAoTransferred, saveNewOrder, executeAll, prefillAddOrderFromProfile, resetAddOrderForm, clearAddOrderRecipient, setAoCurrency, toggleSelectAll, toggleOrderRow, bulkToggleSelected, bulkRemoveSelected, exportCsv, toggleOrderActive, setRecStatusFilter, probeRegistrationsForOrders, prefillEditOrderFromProfile, clearEditOrderRecipient } from './pages/recurrent';
import { saveCompanyInfo, saveRecOrders } from './core/state';
import { EXPECTED_NETWORK_NAME } from './sdk_integration/client';
import { handleDrop, parseCSVFile, importCsvDone, resetImportCsvForm, downloadPayrollCsvTemplate } from './pages/import';
import { renderOnetime, onOtAddrInput, calcOT, doOneTime, renderRecentTransfers, setOtCurrency, setOtMode } from './pages/onetime';
import { renderAudit, filterAudit, openAuditDetail, openAuditDetailByTx, setAuditTypeFilter, exportAuditCsv, toggleAuditSelectAll, toggleAuditRow, generateInvoiceForRow, generateInvoiceForTx, generateInvoiceForSelected } from './pages/audit';
import { initOperationsPanel } from './pages/operations-panel';
import { initProfilePop } from './core/profile-pop';
import { initLoginGate } from './core/login-gate';
import { enhanceSelect } from './core/dropdown';
import { loadTokenIcons, onIconsLoaded } from './core/token-icons';
import { initMotion, animatePageEnter } from './core/motion';

function $ <T extends HTMLElement>(id: string) { return document.getElementById(id) as T | null; }
function on(id: string, event: string, fn: EventListener) { $(id)?.addEventListener(event, fn); }

// --- Page access gates ------------------------------------------------------
// Dashboard is always open. profiles/recurrent/onetime/audit need a connected
// wallet; Settings needs admin (and is wallet-independent). Enforced in nav() via
// setNavGuard, and mirrored in the sidebar/dashboard UI by updateNavAccess().
function pageAllowed(name: string): boolean {
  if (name === 'dashboard') return true;
  // Settings hosts the company card (viewable/editable per canEditCompany),
  // so it's open to everyone; the admin-only tools inside it are gated
  // separately via .js-admin-only.
  if (name === 'settings') return true;
  return !!state.walletConnected;
}

function updateNavAccess(): void {
  document.querySelectorAll<HTMLElement>('.nav-item[data-page], .module-card[data-page]').forEach((el) => {
    const page = el.dataset.page!;
    el.classList.toggle('disabled', !pageAllowed(page));
  });
  // Admin-only tools inside Settings (paymaster, connection test).
  document.querySelectorAll<HTMLElement>('.js-admin-only').forEach((el) =>
    el.classList.toggle('hidden', !state.isAdmin));
  // The dashboard's content is all wallet-dependent — show it only when connected,
  // otherwise show the connect prompt.
  const connected = !!state.walletConnected;
  ['companyCard', 'dashStats', 'dashQuickAccess'].forEach((id) =>
    document.getElementById(id)?.classList.toggle('hidden', !connected));
  document.getElementById('dashConnectPrompt')?.classList.toggle('hidden', connected);
  // If the page we're on just became off-limits (e.g. wallet disconnected), leave.
  const active = document.querySelector('.page.active')?.id.replace('page-', '');
  if (active && !pageAllowed(active)) nav('dashboard');
}

function init() {
  // Register page renderers so nav() triggers them
  registerPage('dashboard', renderCompanyCard);
  registerPage('profiles',  renderProfiles);
  registerPage('recurrent', renderRec);
  registerPage('onetime',   renderOnetime);
  registerPage('audit',     renderAudit);
  registerPage('settings',  () => { renderSettings(); renderCompanyCard(); });

  // Refresh on-chain data on every page switch so the user doesn't reach for F5.
  // No-op until a wallet is connected + the SDK client is built.
  setOnNavigate(() => {
    // FX-rate display is wallet-independent (it's a fiat reference rate),
    // so refresh it on every nav before short-circuiting on no wallet.
    renderFxRateChip();
    const active = document.querySelector<HTMLElement>('.page.active');
    if (active) animatePageEnter(active);
    if (!state.walletConnected || !state.transfers) return;
    void refreshTreasuryBalance();
    void refreshAuditLog();
  });

  // Topbar
  on('walletBtn',        'click', () => { renderWalletPicker(); openM('walletPicker'); });
  initMotion();
  initProfilePop();
  initLoginGate();
  on('disconnectWalletBtn', 'click', () => disconnectWallet());
  on('onboardBtn', 'click', () => startOnboarding());
  on('paymasterKeyBtn', 'click', () => submitPaymasterKey());

  // Settings page: paymaster configuration
  on('setPmBtn', 'click', () => openM('paymasterKey'));
  on('setPmClear', 'click', (e) => { e.preventDefault(); clearPaymaster(); });
  on('setSignDemoBtn', 'click', () => void signHelloMessage());
  on('refreshTreasuryBtn', 'click', async () => {
    const btn = $('refreshTreasuryBtn');
    btn?.classList.add('spinning');
    await refreshTreasuryBalance();
    btn?.classList.remove('spinning');
  });
  // Hide/show amounts across the dashboard (session-only, cosmetic).
  on('balEyeBtn', 'click', () => {
    const dash = $('dashStats');
    const masked = dash?.classList.toggle('masked-balance') ?? false;
    $('balEyeBtn')?.setAttribute('title', masked ? 'Show amounts' : 'Hide amounts');
  });
  // Plain nav shortcuts (stat cards, balance-card Send button).
  document.querySelectorAll<HTMLElement>('.navlink[data-page]').forEach((el) => {
    el.addEventListener('click', () => nav(el.dataset.page!));
  });
  // Every dropdown uses the styled menu (native selects stay as state).
  ['otAmountUnit', 'otSendCurrency', 'aoAmountUnit', 'aoSendCurrency', 'eoAmountUnit', 'eoSendCurrency',
   'aoPeriod', 'eoPeriod', 'eoMode', 'npType', 'npMode'].forEach(enhanceSelect);
  // Token logos in the currency dropdowns (AVNU list — cosmetic, async).
  void loadTokenIcons();
  onIconsLoaded(() => document.querySelectorAll<HTMLSelectElement>('select[data-dd-enhanced]').forEach((s) => (s as unknown as { _ddSync?: () => void })._ddSync?.()));
  // Header: global Private/Public default for new payments. Applies to the
  // Send pills and to the defaults of the add-order / add-person forms;
  // existing orders keep their own saved mode.
  const applyPayMode = () => {
    // Single Private button: lit (coral + glow) when private, greyed in
    // public. The lit/greyed styling is driven by body.public-mode in CSS.
    document.body.classList.toggle('public-mode', state.payMode === 'unshielded');
    renderOnchainCard(); // the "set up private payments" nudge hides in public mode
    setOtMode(state.payMode);
    const ao = $('aoTransferMode') as HTMLSelectElement | null;
    if (ao) { ao.value = state.payMode; ao.dispatchEvent(new Event('change', { bubbles: true })); }
    const np = $('npMode') as HTMLSelectElement | null;
    if (np) np.value = state.payMode;
    renderStats(); // chart reads the accent at draw time — repaint it
  };
  $('payModeToggle')?.addEventListener('click', () => {
    state.payMode = state.payMode === 'shielded' ? 'unshielded' : 'shielded';
    applyPayMode();
  });

  // Header: static date chip — shows today's date and year, nothing opens.
  const today = $('todayChip');
  if (today) today.textContent = new Date().toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  // Header: light/dark switch (session-only, cosmetic).
  on('darkModeBtn', 'click', () => {
    const light = document.body.classList.toggle('light');
    $('darkModeBtn')?.setAttribute('title', light ? 'Switch to dark mode' : 'Switch to light mode');
  });
  // Header: settings gear (top-right) navigates to the Settings page.
  on('settingsBtn', 'click', () => nav('settings'));
  on('setupDismiss', 'click', () => dismissSetup());
  // Suppress Chrome's autofill/address suggestions on every text input.
  document.querySelectorAll('input, textarea').forEach((el) => {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'off');
    el.setAttribute('spellcheck', 'false');
  });
  // Header: notification bell is inert for now (no popover wired yet).
  // The operations panel still appears on its own while a payment runs.
  on('depositBtn', 'click', () => { prepareDepositModal(); openM('deposit'); void refreshDepositBalance(); void refreshTreasuryBalance(); });
  on('depositConfirmBtn', 'click', () => submitDeposit());
  // Deposit currency pills (replaces the old dep-token select)
  $('depCurrencyPills')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-currency]');
    if (pill) setDepCurrency(pill.dataset.currency!);
  });
  // Withdraw (unshield to wallet)
  on('withdrawBtn', 'click', () => { prepareWithdrawModal(); openM('withdraw'); void refreshWithdrawBalance(); void refreshTreasuryBalance(); });
  on('withdrawConfirmBtn', 'click', () => submitWithdraw());
  $('wdCurrencyPills')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-currency]');
    if (pill) setWdCurrency(pill.dataset.currency!);
  });
  // Contract (stranded) balance recovery
  on('contractShieldBtn', 'click', () => void shieldContractBalance());
  on('contractWithdrawBtn', 'click', () => void withdrawContractBalance());
  // Convert (in-pool swap)
  on('convertConfirmBtn', 'click', () => submitSwap());
  $('swFromPills')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-currency]');
    if (pill) setSwFromCurrency(pill.dataset.currency!);
  });
  $('swToPills')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-currency]');
    if (pill) setSwToCurrency(pill.dataset.currency!);
  });

  // Audit log refreshes are driven by a custom DOM event so the audit page
  // updates when the indexer-backed history finishes loading, even if the
  // user is sitting on it.
  document.addEventListener('audit-updated', () => {
    renderAudit();
    renderRec();
    renderProfiles();
    renderRecentTransfers();
    renderStats(); // dashboard: payments-this-month + recent activity
    if (state.selectedProfileId) {
      // Re-render the open profile detail so its tx list pulls the fresh
      // entries from auditTxs.
      selectProfile(state.selectedProfileId);
    }
  });

  // Sidebar nav items — the selected one grows via GSAP (back-out ease),
  // the others settle back to normal size.
  // Nav selection is a clean CSS pill (no scale/pop) — just switch the page.
  document.querySelectorAll<HTMLElement>('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => nav(el.dataset.page!));
  });

  // Dashboard: quick-access module cards
  document.querySelectorAll<HTMLElement>('.module-card[data-page]').forEach(el => {
    el.addEventListener('click', () => nav(el.dataset.page!));
  });

  // Page-access gates: block non-dashboard pages without a wallet, hide Settings
  // from non-admins. nav() enforces; updateNavAccess() reflects it in the UI.
  setNavGuard(pageAllowed);
  updateNavAccess();
  // Resolve admin identity from IAP (via /api/me), then refresh the gates.
  // Admin identity now comes from the authenticated SIWS session (the server maps
  // the connected wallet → isAdmin via ADMIN_WALLETS). A session only exists after
  // sign-in, so resolve at startup AND whenever the wallet changes.
  const refreshIdentity = () => {
    void fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((me) => {
      state.isAdmin = !!(me && me.isAdmin);
      updateNavAccess();
    }).catch(() => {});
  };
  refreshIdentity();
  document.addEventListener('wallet-changed', () => { updateNavAccess(); refreshIdentity(); });
  // Paymaster activation is tied to the wallet session, not to page load: the
  // /api/paymaster proxy requires a SIWS session, so probing during init() only ever
  // got a 401 and silently dropped everyone onto the paste-key submitter. By the time
  // wallet-changed fires on connect, walletSignIn has already set the session cookie.
  // The local dev override runs after, so paymaster.local.json still wins.
  document.addEventListener('wallet-changed', () => {
    if (!state.walletConnected) {
      clearPaymaster();   // session is gone; an AVNU submitter would only 401
      return;
    }
    void configureAvnuPaymaster()
      .catch((err) => console.warn('[paymaster] activation failed:', err))
      .finally(() => void loadLocalPaymaster());
  });
  // Admin edited a wallet's company in Settings → refresh the registered-wallets list.
  document.addEventListener('companies-updated', () => { if (state.isAdmin) renderSettings(); });

  // Profiles page
  on('profileSearch',    'input',  () => { resetProfilePage(); renderProfiles(); });
  on('profileSelectAll', 'change', (e) => toggleProfileSelectAll((e.target as HTMLInputElement).checked));
  on('profileBulkRemoveBtn', 'click', () => bulkRemoveProfiles());
  $('profileGrid')?.addEventListener('change', (e) => {
    const cb = (e.target as Element).closest<HTMLInputElement>('.profile-cb');
    if (cb) toggleProfileRow(cb.dataset.profileId!, cb.checked);
  });
  on('importAbCsvBtn', 'click', () => openM('importProfilesCsv'));
  const abDropzone = $('abDropzone');
  abDropzone?.addEventListener('click',    () => $<HTMLInputElement>('abCsvFile')?.click());
  abDropzone?.addEventListener('dragover', (e) => { e.preventDefault(); abDropzone.classList.add('drag'); });
  abDropzone?.addEventListener('dragleave',() => abDropzone.classList.remove('drag'));
  abDropzone?.addEventListener('drop',     (e) => handleAbDrop(e as DragEvent));
  on('abCsvFile',       'change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) { parseAbCsvFile(f); (e.target as HTMLInputElement).value = ''; } });
  on('abImportDoneBtn', 'click',  () => importAbDone());
  on('downloadProfilesTemplateBtn', 'click', () => downloadProfilesCsvTemplate());
  on('addProfileBtn',    'click',  () => {
    resetAddProfileForm();
    const np = $('npMode') as HTMLSelectElement | null;
    if (np) np.value = state.payMode; // header Private/Public default
    openM('addProfile');
  });
  on('profileClearBtn',  'click',  () => { ($('profileSearch') as HTMLInputElement).value = ''; renderProfiles(); });
  on('exportPeopleBtn',  'click',  () => exportPeopleCsv());
  $('profileTypeFilter')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-ptype]');
    if (pill) setProfileTypeFilter(pill.dataset.ptype!);
  });
  on('goOneTimeBtn',     'click',  () => goOneTime());
  on('addToRecurrentBtn','click',  () => addToRecurrent());
  on('pdEditBtn',        'click',  () => enterDetailEdit());
  on('pdCloseBtn',       'click',  () => closeProfileDetail());
  on('pdCancelEditBtn',  'click',  () => cancelDetailEdit());
  on('pdSaveEditBtn',    'click',  () => void saveDetailEdit());

  // Profiles table: delegated row click + per-row action buttons. Edit
  // and delete buttons live inside the row, so stopPropagation prevents
  // a row-level selectProfile firing when one of them is clicked.
  // Single reusable ⋯ row-action menu (body-appended so it never clips
  // inside the scrolling table). Rows carry a [data-row-menu] toggle.
  const rowMenu = document.createElement('div');
  rowMenu.className = 'row-menu';
  rowMenu.innerHTML =
    '<button class="row-menu-item" data-rm="send">Send</button>' +
    '<button class="row-menu-item" data-rm="order">Add order</button>' +
    '<button class="row-menu-item" data-rm="edit">Edit profile</button>' +
    '<button class="row-menu-item danger" data-rm="remove">Remove</button>';
  document.body.appendChild(rowMenu);
  const closeRowMenu = () => rowMenu.classList.remove('open');
  rowMenu.addEventListener('click', (e) => {
    const item = (e.target as Element).closest<HTMLElement>('[data-rm]');
    const id = rowMenu.dataset.forId;
    if (!item || !id) return;
    closeRowMenu();
    if (item.dataset.rm === 'send') { selectProfile(id); goOneTime(); }
    else if (item.dataset.rm === 'order') addToRecurrent(id);
    else if (item.dataset.rm === 'edit') openEditProfile(id);
    else if (item.dataset.rm === 'remove') removeProfile(id);
  });
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[data-row-menu]')) return;
    if (!(e.target as Element).closest('.row-menu')) closeRowMenu();
  });
  window.addEventListener('scroll', closeRowMenu, true);

  $('profileGrid')?.addEventListener('click', (e) => {
    if ((e.target as Element).closest('.profile-cb')) return;
    const rowMenuBtn = (e.target as Element).closest<HTMLElement>('[data-row-menu]');
    if (rowMenuBtn) {
      e.stopPropagation();
      const id = rowMenuBtn.dataset.rowMenu!;
      const wasOpen = rowMenu.classList.contains('open') && rowMenu.dataset.forId === id;
      closeRowMenu();
      if (!wasOpen) {
        rowMenu.dataset.forId = id;
        rowMenu.classList.add('open');
        const r = rowMenuBtn.getBoundingClientRect();
        rowMenu.style.top = `${r.bottom + 6}px`;
        rowMenu.style.left = `${Math.max(8, r.right - rowMenu.offsetWidth)}px`;
      }
      return;
    }
    const editBtn = (e.target as Element).closest<HTMLElement>('[data-edit-profile]');
    if (editBtn) { e.stopPropagation(); openEditProfile(editBtn.dataset.editProfile!); return; }
    const removeBtn = (e.target as Element).closest<HTMLElement>('[data-remove-profile]');
    if (removeBtn) { e.stopPropagation(); removeProfile(removeBtn.dataset.removeProfile!); return; }
    const recBtn = (e.target as Element).closest<HTMLElement>('[data-add-recurrent]');
    if (recBtn) { e.stopPropagation(); addToRecurrent(recBtn.dataset.addRecurrent!); return; }
    const sendBtn = (e.target as Element).closest<HTMLElement>('[data-send-profile]');
    if (sendBtn) { e.stopPropagation(); selectProfile(sendBtn.dataset.sendProfile!); goOneTime(); return; }
    const row = (e.target as Element).closest<HTMLElement>('[data-profile-id]');
    if (row) {
      // Block switching while the inline detail editor is open — clicking
      // away would silently drop the in-progress edits. Flash a red note
      // under Save so the operator knows why nothing happened.
      if (isDetailEditing()) {
        flashDetailEditError('Save or Cancel the open edit first');
        return;
      }
      selectProfile(row.dataset.profileId!);
    }
  });

  // Profile detail tx history: expand past tx -> audit detail modal;
  // expand upcoming recurrent row -> edit order modal.
  $('pdTxTable')?.addEventListener('click', (e) => {
    const auditBtn = (e.target as Element).closest<HTMLElement>('[data-pd-expand-audit]');
    if (auditBtn) { openAuditDetailByTx(auditBtn.dataset.pdExpandAudit!); return; }
    const invBtn = (e.target as Element).closest<HTMLElement>('[data-pd-invoice-audit]');
    if (invBtn) { generateInvoiceForTx(invBtn.dataset.pdInvoiceAudit!); return; }
    const orderBtn = (e.target as Element).closest<HTMLElement>('[data-pd-expand-order]');
    if (orderBtn) { openEditOrder(parseInt(orderBtn.dataset.pdExpandOrder!, 10)); return; }
  });

  // Recurrent page
  on('recImportCsvBtn', 'click', () => { resetImportCsvForm(); openM('importCsv'); });
  on('exportCsvBtn',    'click', () => exportCsv());
  on('addOrderBtn',     'click', () => {
    resetAddOrderForm();
    const ao = $('aoTransferMode') as HTMLSelectElement | null;
    if (ao) ao.value = state.payMode; // header Private/Public default
    openM('addOrder');
  });
  on('aoRecipientClearBtn', 'click', () => clearAddOrderRecipient());
  on('eoRecipientClearBtn', 'click', () => clearEditOrderRecipient());
  // Add Order amount selector: mirror the one-time form's two-rectangle
  // pattern — amount + unit on the left, derived transferred amount +
  // on-chain currency on the right. Any of the three controls firing
  // re-derives the transferred preview.
  on('aoAmount',       'input',  () => recomputeAoTransferred());
  on('aoAmountUnit',   'change', () => recomputeAoTransferred());
  on('aoSendCurrency', 'change', () => setAoCurrency(($<HTMLSelectElement>('aoSendCurrency')!).value));
  on('executeAllBtn',   'click', () => executeAll());
  on('recBulkToggleBtn', 'click', () => bulkToggleSelected());
  on('recBulkRemoveBtn', 'click', () => bulkRemoveSelected());
  on('recSelectAll',    'change', (e) => toggleSelectAll((e.target as HTMLInputElement).checked));

  // Recurrent table: delegated edit/remove/toggle/checkbox/view-profile
  $('recTable')?.addEventListener('click', (e) => {
    const viewBtn   = (e.target as Element).closest<HTMLElement>('[data-view-profile]');
    const editBtn   = (e.target as Element).closest<HTMLElement>('[data-edit-order]');
    const removeBtn = (e.target as Element).closest<HTMLElement>('[data-remove-order]');
    const toggleBtn = (e.target as Element).closest<HTMLElement>('[data-toggle-order]');
    if (viewBtn)   { selectProfile(viewBtn.dataset.viewProfile!); return; }
    if (toggleBtn) { toggleOrderActive(parseInt(toggleBtn.dataset.toggleOrder!, 10)); return; }
    if (editBtn)   openEditOrder(parseInt(editBtn.dataset.editOrder!, 10));
    if (removeBtn) removeOrder(parseInt(removeBtn.dataset.removeOrder!, 10));
  });
  $('recStatusFilter')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-rec-status]');
    if (pill) setRecStatusFilter(pill.dataset.recStatus as 'all' | 'active' | 'inactive');
  });
  $('recTable')?.addEventListener('change', (e) => {
    const cb = (e.target as Element).closest<HTMLInputElement>('.rec-cb');
    if (cb) toggleOrderRow(parseInt(cb.dataset.idx!, 10), cb.checked);
  });

  // Import CSV modal (recurrent)
  const dropzone = $('dropzone');
  dropzone?.addEventListener('click',      () => $<HTMLInputElement>('csvFile')?.click());
  dropzone?.addEventListener('dragover',   (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone?.addEventListener('dragleave',  () => dropzone.classList.remove('drag'));
  dropzone?.addEventListener('drop',       (e) => handleDrop(e as DragEvent));
  on('csvFile',       'change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) parseCSVFile(f); });
  on('importDoneBtn', 'click',  () => importCsvDone());
  on('downloadPayrollTemplateBtn', 'click', () => downloadPayrollCsvTemplate());

  // One-time page
  on('otAddr',         'input',  () => onOtAddrInput());
  on('otSendCurrency', 'change', () => setOtCurrency(($<HTMLSelectElement>('otSendCurrency')!).value));
  $('otModePills')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-mode]');
    if (pill) setOtMode(pill.dataset.mode as 'shielded' | 'unshielded');
  });
  on('otCryptoAmt',    'input',  () => calcOT());
  on('otAmountUnit',   'change', () => calcOT());
  on('otDesc',         'input',  () => calcOT());
  on('pickNameBtn',  'click',  () => { setPickProfileTarget(prefillOneTime); populatePickProfile(); openM('pickProfile'); });
  on('aoPickNameBtn','click',  () => { setPickProfileTarget(prefillAddOrderFromProfile); populatePickProfile(); openM('pickProfile'); });
  on('eoPickNameBtn','click',  () => { setPickProfileTarget(prefillEditOrderFromProfile); populatePickProfile(); openM('pickProfile'); });
  on('otBtn',        'click',  () => doOneTime());

  // Audit page
  on('auditFilter',       'input',  () => filterAudit());
  on('auditClearBtn',     'click',  () => { $<HTMLInputElement>('auditFilter')!.value = ''; filterAudit(); });
  on('exportAuditBtn',    'click',  () => exportAuditCsv());
  on('generateInvoiceBtn','click',  () => generateInvoiceForSelected());
  on('auditSelectAll',    'change', (e) => toggleAuditSelectAll((e.target as HTMLInputElement).checked));
  $('auditTable')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-audit-expand]');
    if (btn) openAuditDetail(parseInt(btn.dataset.auditExpand!, 10));
    const invBtn = (e.target as Element).closest<HTMLElement>('[data-audit-invoice]');
    if (invBtn) generateInvoiceForRow(parseInt(invBtn.dataset.auditInvoice!, 10));
  });
  $('auditTable')?.addEventListener('change', (e) => {
    const cb = (e.target as Element).closest<HTMLInputElement>('.audit-cb');
    if (cb) toggleAuditRow(parseInt(cb.dataset.idx!, 10), cb.checked);
  });
  // Audit type-filter pills: data-audit-type attr matches AuditTx.type
  // values (OneTime/Deposit/Onboard) or 'all'.
  $('auditTypeFilter')?.addEventListener('click', (e) => {
    const pill = (e.target as Element).closest<HTMLElement>('[data-audit-type]');
    if (pill) setAuditTypeFilter(pill.dataset.auditType!);
  });

  // Modal: global close-modal delegated listener
  document.addEventListener('click', (e) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-close-modal]');
    if (el) closeM(el.dataset.closeModal!);
  });

  // Click the dimmed backdrop (outside the modal card) to close it.
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.classList?.contains('moverlay') && t.classList.contains('open')) {
      closeM(t.id.replace(/^modal-/, ''));
    }
  });

  // Modal: save buttons
  on('saveProfileBtn', 'click', () => saveProfile());
  on('rmProfileConfirmBtn', 'click', () => confirmRemoveProfile());
  on('cipSaveBtn', 'click', () => saveCompleteImportedProfiles());

  on('saveOrderBtn',       'click',  () => saveOrder());
  // Edit Order amount selector — same two-rectangle pattern as add-order
  // and the one-time form.
  on('eoAmount',           'input',  () => recomputeEoTransferred());
  on('eoAmountUnit',       'change', () => recomputeEoTransferred());
  on('eoSendCurrency',     'change', () => setEoCurrency(($<HTMLSelectElement>('eoSendCurrency')!).value));

  on('saveNewOrderBtn',    'click',  () => saveNewOrder());

  on('saveCompanyBtn', 'click', () => saveCompany());

  // Pick profile modal: delegated listener
  $('pickProfileList')?.addEventListener('click', (e) => {
    const card = (e.target as Element).closest<HTMLElement>('[data-pick-profile]');
    // Whoever opened the modal previously called setPickProfileTarget with
    // a one-shot callback; route the picked profile id through it. Falls
    // back to prefillOneTime so legacy openers (none currently) still work.
    if (card) {
      invokePickProfileTarget(card.dataset.pickProfile!);
    }
  });
  on('pickProfileSearch', 'input', () => renderPickProfileList());

  // Wallet picker: delegated listener
  document.getElementById('modal-walletPicker')?.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-wallet]');
    if (btn) connectWithWallet(btn.dataset.wallet!);
  });

  // Initial render
  renderNetworkPill();
  renderCompanyCard();
  renderOnchainCard();
  renderSettings();
  renderProfiles();
  renderRec();
  renderAudit();

  // Bottom-of-screen Operations panel — tracks Shield / Unshield / Convert /
  // Transfer in the background so the user isn't blocked by the 10-block wait.
  initOperationsPanel();

  // NOTE: paymaster activation deliberately does NOT happen here. /api/paymaster
  // requires a SIWS session, which does not exist yet at init(). It runs off
  // wallet-changed instead — see the listener above.
}

// Fetch live prices then init; fall back to defaults instantly if slow
fetchNISRates().finally(() => { renderFxRateChip(); init(); });

// After init, hydrate from the DB server — re-renders if server has newer data
hydrateFromDB(() => {
  // Heal stale network label: older builds let wallet.applyNetwork
  // overwrite companyInfo.network with the wallet's chain, so a mainnet
  // wallet could persist "Starknet Mainnet" into the store while the
  // rest of PriPay stayed on Sepolia. Force it back to truth on load.
  if (state.companyInfo.network !== EXPECTED_NETWORK_NAME) {
    state.companyInfo.network = EXPECTED_NETWORK_NAME;
    saveCompanyInfo();
  }
  renderCompanyCard();
  renderProfiles();
  renderRec();
  renderAudit();
  // Pre-flight pool registry for any persisted order that hasn't been
  // probed yet, then re-render so unregistered rows get badged.
  void probeRegistrationsForOrders(state.recOrders).then(() => {
    saveRecOrders();
    renderRec();
  });
});
