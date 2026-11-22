import { Injectable } from '@nestjs/common';
import { ChatPushSender, PushSendOutcome } from './push.service';
import { classifyReceipt, classifyTicket } from './push-policy';

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPT_URL = 'https://exp.host/--/api/v2/push/getReceipts';

@Injectable()
export class ExpoPushClient implements ChatPushSender {
  async send(input: {
    to: string;
    body: string;
    data: { v: '1'; type: 'chat_message'; conversationId: string; recipientUserId: string };
  }): Promise<PushSendOutcome> {
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    let response: Response;
    try {
      response = await fetch(SEND_URL, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          to: input.to,
          body: input.body,
          sound: 'default',
          channelId: 'messages',
          data: input.data,
        }),
      });
    } catch {
      return { outcome: 'unknown' };
    }
    if (response.status === 429) return { outcome: 'retry' };
    if (response.status >= 500) return { outcome: 'unknown' };
    if (response.status >= 400) return { outcome: 'rejected' };
    const payload = (await response.json()) as {
      data?: { status?: string; id?: string; details?: { error?: string } } | Array<{
        status?: string;
        id?: string;
        details?: { error?: string };
      }>;
    };
    const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;
    const classified = classifyTicket({
      httpStatus: response.status,
      requestSent: true,
      ticketStatus: ticket?.status === 'ok' ? 'ok' : ticket ? 'error' : undefined,
      ticketId: ticket?.id,
      errorCode: ticket?.details?.error,
    });
    if (classified.outcome === 'accepted') return classified;
    if (classified.outcome === 'device_not_registered') return classified;
    if (classified.outcome === 'retry') return classified;
    if (classified.outcome === 'unknown') return classified;
    return { outcome: 'rejected' };
  }

  async receipts(ticketIds: string[]) {
    if (ticketIds.length === 0) return {};
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    const response = await fetch(RECEIPT_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({ ids: ticketIds.slice(0, 1000) }),
    });
    if (!response.ok) return {};
    const payload = (await response.json()) as {
      data?: Record<string, { status?: string; details?: { error?: string } }>;
    };
    const data = payload.data ?? {};
    return Object.fromEntries(
      ticketIds.map((id) => {
        const receipt = data[id];
        if (!receipt) return [id, null];
        const classified = classifyReceipt({
          ageMs: 0,
          found: true,
          status: receipt.status === 'ok' ? 'ok' : 'error',
          errorCode: receipt.details?.error,
        });
        if (classified === 'ok') return [id, { status: 'ok' as const }];
        return [id, { status: 'error' as const, code: receipt.details?.error ?? 'receipt_failed' }];
      }),
    );
  }
}
