export type ClosurePayment = { status: string; provider: string };

/**
 * Every payment row must be inspected. An empty list is allowed: no payment
 * exists. Pending and processing are refused. Only mock failed, cancelled,
 * or succeeded rows may remain, and this check does not change them.
 */
export function staffClosurePaymentRefusal(rows: ClosurePayment[]): string | null {
  if (rows.some((row) => row.provider !== 'mock')) {
    return 'This work has a payment that is not a simulated payment.';
  }
  if (rows.some((row) => row.status === 'pending' || row.status === 'processing')) {
    return 'A payment is still in progress. This action does not change it.';
  }
  const supported = new Set(['failed', 'cancelled', 'succeeded']);
  if (rows.some((row) => !supported.has(row.status))) {
    return 'This payment history cannot be closed by Mawahib.';
  }
  return null;
}

export type UnpaidAttempt = {
  status: string;
  provider: string;
  providerReference: string | null;
};

/**
 * Every payment row is inspected. Empty history is allowed. Only mock
 * failed, cancelled, or unstarted pending rows may remain. Processing,
 * succeeded, a pending provider reference, and any non-mock row are refused.
 * This check does not change the payments.
 */
export function unpaidCancellationRefusal(rows: UnpaidAttempt[]): string | null {
  if (rows.some((row) => row.provider !== 'mock')) {
    return 'This payment history is not supported for staff cancellation.';
  }
  if (rows.some((row) => row.status === 'processing' || row.status === 'succeeded')) {
    return 'A payment is processing or has succeeded. This action does not issue a refund.';
  }
  if (rows.some((row) => row.status === 'pending' && row.providerReference)) {
    return 'A payment attempt already has a provider reference.';
  }
  const supported = new Set(['pending', 'failed', 'cancelled']);
  if (rows.some((row) => !supported.has(row.status))) {
    return 'This payment history is not supported for staff cancellation.';
  }
  return null;
}
