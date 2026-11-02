import { FALLBACK_CLIENT_KEY, normalizeClientAddress, resolveClientKey } from './public-client-address';

describe('public client address', () => {
  it('folds IPv4-mapped IPv6 to IPv4 before any subnet grouping', () => {
    expect(normalizeClientAddress('::ffff:192.0.2.1')).toBe('4:192.0.2.1');
    expect(normalizeClientAddress('::FFFF:192.0.2.1')).toBe('4:192.0.2.1');
    expect(normalizeClientAddress('::ffff:c000:201')).toBe('4:192.0.2.1');
    expect(normalizeClientAddress('0:0:0:0:0:ffff:c000:201')).toBe('4:192.0.2.1');
    expect(normalizeClientAddress('::ffff:192.0.2.1')).not.toBe('6:0:0:0:0::/64');
  });

  it('groups equivalent IPv6 text into the same /64 and splits the next subnet', () => {
    const prefix = '6:2001:db8:0:0::/64';
    expect(normalizeClientAddress('2001:db8::1')).toBe(prefix);
    expect(normalizeClientAddress('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(prefix);
    expect(normalizeClientAddress('2001:DB8:0:0:ffff:ffff:ffff:ffff')).toBe(prefix);
    expect(normalizeClientAddress('2001:db8:0:1::1')).toBe('6:2001:db8:0:1::/64');
  });

  it('rejects duplicate, comma-separated, malformed, port, and zone forms', () => {
    expect(normalizeClientAddress('203.0.113.1, 203.0.113.2')).toBeNull();
    expect(normalizeClientAddress('203.0.113.1,203.0.113.1')).toBeNull();
    expect(normalizeClientAddress('203.0.113.1:443')).toBeNull();
    expect(normalizeClientAddress('[2001:db8::1]:443')).toBeNull();
    expect(normalizeClientAddress('fe80::1%eth0')).toBeNull();
    expect(normalizeClientAddress('999.1.1.1')).toBeNull();
    expect(normalizeClientAddress('192.168.001.1')).toBeNull();
    expect(normalizeClientAddress('203.0. 113.1')).toBeNull();
    expect(normalizeClientAddress(':::')).toBeNull();
    expect(normalizeClientAddress('')).toBeNull();
    expect(normalizeClientAddress(' 203.0.113.8 ')).toBe('4:203.0.113.8');
  });

  it('uses the socket peer in socket mode and ignores forwarding headers', () => {
    expect(
      resolveClientKey('socket', {
        remoteAddress: '::ffff:10.1.2.3',
        realIpHeader: '203.0.113.9',
      }),
    ).toEqual({ key: '4:10.1.2.3', identity: 'client' });
    expect(
      resolveClientKey('socket', {
        remoteAddress: '10.0.0.8',
        realIpHeader: ['203.0.113.1', '203.0.113.2'],
      }),
    ).toEqual({ key: '4:10.0.0.8', identity: 'client' });
  });

  it('uses only a single X-Real-IP in edge mode', () => {
    expect(
      resolveClientKey('edge', {
        remoteAddress: '10.0.0.8',
        realIpHeader: '203.0.113.9',
      }),
    ).toEqual({ key: '4:203.0.113.9', identity: 'client' });
    expect(
      resolveClientKey('edge', {
        remoteAddress: '203.0.113.9',
        realIpHeader: undefined,
      }),
    ).toEqual({ key: FALLBACK_CLIENT_KEY, identity: 'fallback' });
    expect(
      resolveClientKey('edge', {
        remoteAddress: '203.0.113.9',
        realIpHeader: ['203.0.113.9', '198.51.100.1'],
      }),
    ).toEqual({ key: FALLBACK_CLIENT_KEY, identity: 'fallback' });
    expect(
      resolveClientKey('edge', {
        remoteAddress: '10.0.0.8',
        realIpHeader: '203.0.113.1, 198.51.100.2',
      }),
    ).toEqual({ key: FALLBACK_CLIENT_KEY, identity: 'fallback' });
  });

  it('shares one fallback key for a missing socket address', () => {
    expect(resolveClientKey('socket', { remoteAddress: undefined })).toEqual({
      key: FALLBACK_CLIENT_KEY,
      identity: 'fallback',
    });
    expect(resolveClientKey('socket', { remoteAddress: 'not-an-ip' })).toEqual({
      key: FALLBACK_CLIENT_KEY,
      identity: 'fallback',
    });
  });
});
