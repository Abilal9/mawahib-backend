import {
  DEFAULT_PROFILE_TITLE,
  normalizeProfileTitle,
} from './profile-title';

describe('profile-title', () => {
  it('uses Creative Professional as the canonical default', () => {
    expect(DEFAULT_PROFILE_TITLE).toBe('Creative Professional');
  });

  it('returns the default for null, undefined, empty, and whitespace', () => {
    expect(normalizeProfileTitle(null)).toBe(DEFAULT_PROFILE_TITLE);
    expect(normalizeProfileTitle(undefined)).toBe(DEFAULT_PROFILE_TITLE);
    expect(normalizeProfileTitle('')).toBe(DEFAULT_PROFILE_TITLE);
    expect(normalizeProfileTitle('   ')).toBe(DEFAULT_PROFILE_TITLE);
  });

  it('preserves a real custom title', () => {
    expect(normalizeProfileTitle('Head Creative Exec')).toBe(
      'Head Creative Exec',
    );
    expect(normalizeProfileTitle('  Designer  ')).toBe('Designer');
  });
});
