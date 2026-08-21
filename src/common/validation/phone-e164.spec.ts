import { isValidPhoneE164 } from './phone-e164';

describe('isValidPhoneE164', () => {
  it('accepts Saudi mobile +9665XXXXXXXX', () => {
    expect(isValidPhoneE164('+966560900600')).toBe(true);
    expect(isValidPhoneE164('+966501234567')).toBe(true);
  });

  it('rejects Saudi numbers that do not start with 5 after country code', () => {
    expect(isValidPhoneE164('+966460900600')).toBe(false);
  });

  it('rejects Saudi numbers with wrong length', () => {
    expect(isValidPhoneE164('+96656090060')).toBe(false); // too short
    expect(isValidPhoneE164('+9665609006000')).toBe(false); // too long
  });

  it('accepts UAE mobile +9715XXXXXXXX', () => {
    expect(isValidPhoneE164('+971501234567')).toBe(true);
    expect(isValidPhoneE164('+971521234567')).toBe(true);
  });

  it('rejects UAE numbers that do not start with 5 after country code', () => {
    expect(isValidPhoneE164('+971401234567')).toBe(false);
  });

  it('rejects UAE numbers with wrong length', () => {
    expect(isValidPhoneE164('+97150123456')).toBe(false); // too short
    expect(isValidPhoneE164('+9715012345678')).toBe(false); // too long
  });

  it('still accepts other non-GCC E.164 shapes', () => {
    expect(isValidPhoneE164('+14155552671')).toBe(true);
  });

  it('rejects malformed E.164', () => {
    expect(isValidPhoneE164('560900600')).toBe(false);
    expect(isValidPhoneE164('+966')).toBe(false);
  });
});
