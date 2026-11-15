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
