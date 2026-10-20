import {
  ProfileSkillError,
  resolveProfileSkills,
  type CatalogSkillState,
} from './profile-skills';

const photography: CatalogSkillState = {
  id: 'photo-id',
  nameEn: 'Photography',
  active: true,
};
const inactive: CatalogSkillState = {
  id: 'old-id',
  nameEn: 'Retired Skill',
  active: false,
};

const skills = new Map<string, CatalogSkillState>([
  [photography.id, photography],
  [inactive.id, inactive],
]);

const terms = new Map([
  ['photographer', { skillId: photography.id, nameEn: 'Photography' }],
  ['photography', { skillId: photography.id, nameEn: 'Photography' }],
]);

describe('resolveProfileSkills', () => {
  it('stores the canonical name and ignores a fake label', () => {
    const rows = resolveProfileSkills({
      existing: [],
      mode: 'selections',
      selections: [{ skillId: photography.id }],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(rows).toEqual([{ skill: 'Photography', skillId: 'photo-id' }]);
  });

  it('keeps a custom skill unlinked', () => {
    const rows = resolveProfileSkills({
      existing: [],
      mode: 'selections',
      selections: [{ text: '  Underwater   Photography ' }],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(rows).toEqual([
      { skill: 'Underwater Photography', skillId: null },
    ]);
  });

  it('preserves mixed order and collapses a repeated canonical id', () => {
    const rows = resolveProfileSkills({
      existing: [],
      mode: 'selections',
      selections: [
        { text: 'Underwater Photography' },
        { skillId: photography.id },
        { skillId: photography.id },
      ],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(rows).toEqual([
      { skill: 'Underwater Photography', skillId: null },
      { skill: 'Photography', skillId: 'photo-id' },
    ]);
  });

  it('rejects a new custom string that matches an active term', () => {
    expect(() =>
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: [{ text: 'Photographer' }],
        skillsById: skills,
        activeTerms: terms,
      }),
    ).toThrow(ProfileSkillError);
    try {
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: [{ text: 'Photographer' }],
        skillsById: skills,
        activeTerms: terms,
      });
    } catch (error) {
      expect(error).toMatchObject({
        code: 'SKILL_MATCHES_CANONICAL',
        details: {
          text: 'Photographer',
          skillId: 'photo-id',
          nameEn: 'Photography',
        },
      });
    }
  });

  it('keeps an existing custom row even when a term now matches it', () => {
    const rows = resolveProfileSkills({
      existing: [{ skill: 'Photographer', skillId: null }],
      mode: 'selections',
      selections: [{ text: 'Photographer' }],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(rows).toEqual([{ skill: 'Photographer', skillId: null }]);
  });

  it('rejects an unknown or newly selected inactive skill', () => {
    expect(() =>
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: [{ skillId: 'missing' }],
        skillsById: skills,
        activeTerms: terms,
      }),
    ).toThrow(/Unknown skill/);
    expect(() =>
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: [{ skillId: inactive.id }],
        skillsById: skills,
        activeTerms: terms,
      }),
    ).toThrow(/no longer available/);
  });

  it('keeps an already linked inactive skill and its stored text', () => {
    const rows = resolveProfileSkills({
      existing: [{ skill: 'Old Label', skillId: inactive.id }],
      mode: 'selections',
      selections: [{ skillId: inactive.id }],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(rows).toEqual([{ skill: 'Old Label', skillId: 'old-id' }]);
  });

  it('dedupes custom case variants and prefers the canonical row', () => {
    const rows = resolveProfileSkills({
      existing: [],
      mode: 'selections',
      selections: [
        { text: 'Studio Lighting' },
        { text: 'studio lighting' },
        { text: 'Photography' },
        { skillId: photography.id },
      ],
      skillsById: skills,
      activeTerms: new Map(),
    });
    expect(rows).toEqual([
      { skill: 'Studio Lighting', skillId: null },
      { skill: 'Photography', skillId: 'photo-id' },
    ]);
  });

  it('does not auto-link a legacy string, but preserves an existing link', () => {
    const plain = resolveProfileSkills({
      existing: [],
      mode: 'legacy',
      legacyTexts: ['Photography', 'Underwater Photography'],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(plain).toEqual([
      { skill: 'Photography', skillId: null },
      { skill: 'Underwater Photography', skillId: null },
    ]);

    const kept = resolveProfileSkills({
      existing: [{ skill: 'Photography', skillId: photography.id }],
      mode: 'legacy',
      legacyTexts: ['Photography', 'Drums'],
      skillsById: skills,
      activeTerms: terms,
    });
    expect(kept).toEqual([
      { skill: 'Photography', skillId: 'photo-id' },
      { skill: 'Drums', skillId: null },
    ]);
  });

  it('rejects blank-only input as an empty list and enforces the skill cap', () => {
    expect(
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: [{ text: '   ' }],
        skillsById: skills,
        activeTerms: terms,
      }),
    ).toEqual([]);

    const many = Array.from({ length: 41 }, (_, index) => ({
      text: `Custom ${index}`,
    }));
    expect(() =>
      resolveProfileSkills({
        existing: [],
        mode: 'selections',
        selections: many,
        skillsById: skills,
        activeTerms: terms,
      }),
    ).toThrow(/at most 40/);
  });
});
