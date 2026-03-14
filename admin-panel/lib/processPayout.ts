import { CommissionPayout } from '@/lib/models';
import type { Document } from 'mongoose';

export interface ProcessPayoutResult {
  success: boolean;
  paid: boolean; // true only when txid was received (actual send)
  txid?: string;
  error?: string;
  message?: string;
}

/**
 * Call Python payout service and update payout document.
 * Only sets status to 'paid' when response includes txid (provider actually sent).
 * Otherwise leaves status 'approved' and stores instructions in notes.
 */
export async function processOnePayout(
  payout: Document & { _id: string; walletAddress?: string; amount: number; currency?: string; status: string; notes?: string; processedAt?: Date; processedBy?: string },
  processedBy?: string
): Promise<ProcessPayoutResult> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

  if (!payout.walletAddress) {
    return { success: false, paid: false, error: 'Wallet address is required' };
  }

  try {
    const sendResponse = await fetch(`${pythonServiceUrl}/api/payout/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payout_id: payout._id.toString(),
        to_address: payout.walletAddress,
        amount_btc: payout.amount,
        currency: (payout.currency as string) || 'BTC',
      }),
    });

    const sendResult = await sendResponse.json().catch(() => ({}));

    if (!sendResponse.ok) {
      const err = (sendResult as { error?: string }).error || sendResponse.statusText;
      payout.notes = `Error: ${err}`;
      await payout.save();
      return { success: false, paid: false, error: err };
    }

    if (!(sendResult as { success?: boolean }).success) {
      const err = (sendResult as { error?: string }).error || 'Unknown error';
      payout.notes = `Error: ${err}`;
      await payout.save();
      return { success: false, paid: false, error: err };
    }

    const txid = (sendResult as { txid?: string }).txid;
    const message = (sendResult as { message?: string }).message;

    // Only mark as paid when we got a real txid (provider actually sent)
    if (txid) {
      payout.status = 'paid';
      payout.processedAt = new Date();
      payout.processedBy = processedBy || 'system';
      payout.notes = `Transaction ID: ${txid}`;
      await payout.save();
      return { success: true, paid: true, txid, message };
    }

    // Success but no txid (e.g. manual instructions from Blockonomics)
    payout.notes = message || 'Instructions sent; complete manually and mark paid.';
    await payout.save();
    return { success: true, paid: false, message };
  } catch (error: unknown) {
    const err = error instanceof Error ? error.message : String(error);
    payout.notes = `Error: ${err}`;
    await payout.save();
    return { success: false, paid: false, error: err };
  }
}
