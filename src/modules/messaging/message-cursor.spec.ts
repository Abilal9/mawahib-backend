import { decodeMessageCursor, encodeMessageCursor } from './message-cursor';

describe('message cursors', () => {
  it('round-trips a sequence cursor', () => {
    const decoded = decodeMessageCursor(encodeMessageCursor(12));
    expect(decoded).toEqual({ kind: 'sequence', sequence: 12 });
  });

  it('recognizes a legacy createdAt cursor without treating it as a sequence', () => {
    const legacy = Buffer.from(
      JSON.stringify({
        createdAt: '2026-08-17T12:00:00.000Z',
        id: '11111111-1111-4111-8111-111111111111',
      }),
      'utf8',
    ).toString('base64url');
    expect(decodeMessageCursor(legacy)).toEqual({
      kind: 'legacy',
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rejects a media-style or empty cursor', () => {
    expect(decodeMessageCursor('not-json')).toBeNull();
    expect(
      decodeMessageCursor(
        Buffer.from(JSON.stringify({ v: 2, s: -1 }), 'utf8').toString(
          'base64url',
        ),
      ),
    ).toBeNull();
  });
});
