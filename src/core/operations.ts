// In-memory store of long-running operations (Shield / Unshield / Convert /
// Transfer / Recurrent). The bottom-of-screen Operations panel subscribes to
// the store and re-renders on every change, so flows can run in the
// background while the user navigates between pages.

export type OperationKind = 'shield' | 'unshield' | 'transfer' | 'recurrent' | 'convert';

export type OperationStatus =
  | 'funding_contract'        // shield only: wallet signs transfer + approve
  | 'building_proof'
  | 'signing_message'         // wallet SNIP-12 signature popup pending
  | 'generating_proof'
  | 'awaiting_fee'            // user must confirm paymaster fee
  | 'submitting'
  | 'done'
  | 'cancelled'
  | 'error';

export interface Operation {
  id: string;
  kind: OperationKind;
  status: OperationStatus;
  startedAt: number;
  updatedAt: number;
  // One-line description ("Shield 10 USDC", "Send 5 STRK to Bob").
  summary: string;
  // Populated when status === 'done'.
  resultTx?: string;
  // Populated when status === 'error'.
  error?: string;
  // Callback the panel wires to the Confirm-fee button when the op is paused
  // on that step. Set by the flow when it queues the op.
  onConfirmFee?: () => void;
}

const ops: Operation[] = [];
const listeners = new Set<() => void>();

function emit(): void { for (const l of listeners) l(); }

export function getOperations(): readonly Operation[] {
  return ops;
}

let counter = 0;
export function createOperation(input: Omit<Operation, 'id' | 'startedAt' | 'updatedAt'>): Operation {
  counter += 1;
  const op: Operation = {
    ...input,
    id: `op-${Date.now()}-${counter}`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  ops.unshift(op);
  emit();
  return op;
}

export function updateOperation(id: string, patch: Partial<Omit<Operation, 'id'>>): void {
  const op = ops.find((o) => o.id === id);
  if (!op) return;
  Object.assign(op, patch, { updatedAt: Date.now() });
  emit();
}

export function dismissOperation(id: string): void {
  const i = ops.findIndex((o) => o.id === id);
  if (i >= 0) ops.splice(i, 1);
  emit();
}

export function dismissTerminal(): void {
  for (let i = ops.length - 1; i >= 0; i--) {
    if (isTerminal(ops[i].status)) ops.splice(i, 1);
  }
  emit();
}

export function subscribeOperations(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function statusLabel(s: OperationStatus): string {
  switch (s) {
    case 'funding_contract':     return 'Moving funds';
    case 'building_proof':       return 'Preparing';
    case 'signing_message':      return 'Waiting for your signature';
    case 'generating_proof':     return 'Securing';
    case 'awaiting_fee':         return 'Confirm the fee';
    case 'submitting':           return 'Sending';
    case 'done':                 return 'Done';
    case 'cancelled':            return 'Cancelled';
    case 'error':                return 'Error';
  }
}

export function isTerminal(s: OperationStatus): boolean {
  return s === 'done' || s === 'cancelled' || s === 'error';
}

// Maps a phase string emitted by run-{deposit,withdraw,transfer,swap}.ts to
// the corresponding operation status.
export function phaseToStatus(phase: string): OperationStatus {
  switch (phase) {
    case 'funding_contract':      return 'funding_contract';
    case 'building_proof':        return 'building_proof';
    case 'signing_message':       return 'signing_message';
    case 'generating_proof':      return 'generating_proof';
    case 'awaiting_confirmation': return 'submitting';
    case 'submitting':            return 'submitting';
    default:                       return 'building_proof';
  }
}
