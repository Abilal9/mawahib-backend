import { normalizeSkillTerm } from './normalize-skill-term';

describe('normalizeSkillTerm', () => {
  it('folds case and surrounding whitespace to one term', () => {
    expect(normalizeSkillTerm('Photography')).toBe('photography');
    expect(normalizeSkillTerm(' photography ')).toBe('photography');
    expect(normalizeSkillTerm('PHOTOGRAPHY')).toBe('photography');
    expect(normalizeSkillTerm('  Photo   Graphy ')).toBe('photo graphy');
  });

  it('keeps punctuation that changes the meaning', () => {
    expect(normalizeSkillTerm('UI/UX Design')).toBe('ui/ux design');
    expect(normalizeSkillTerm('C++')).toBe('c++');
    expect(normalizeSkillTerm('Node.js')).toBe('node.js');
  });

  it('uses NFC so composed and decomposed letters match', () => {
    expect(normalizeSkillTerm('Café')).toBe(normalizeSkillTerm('Cafe\u0301'));
    expect(normalizeSkillTerm('Café')).toBe('café');
  });

  it('does not stem or fuzzy-match related words', () => {
    expect(normalizeSkillTerm('Videography')).not.toBe(
      normalizeSkillTerm('Video Editing'),
    );
    expect(normalizeSkillTerm('UI Design')).not.toBe(
      normalizeSkillTerm('UX Design'),
    );
  });
});
