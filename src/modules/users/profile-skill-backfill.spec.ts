import { decideProfileSkillBackfill, type BackfillTarget } from './profile-skill-backfill';

const photography: BackfillTarget = {
  slug: 'photography',
  id: 'photo-id',
  nameEn: 'Photography',
  active: true,
};

const targets = new Map<string, BackfillTarget>([['photography', photography]]);

describe('decideProfileSkillBackfill', () => {
  it('links an approved alias and leaves ambiguous text alone', () => {
    const decisions = decideProfileSkillBackfill(
      [
        { userId: 'u1', skill: 'Photographer', skillId: null, position: 0 },
        { userId: 'u1', skill: 'Motion Design', skillId: null, position: 1 },
        { userId: 'u1', skill: 'Drums', skillId: null, position: 2 },
      ],
      targets,
    );
    expect(decisions).toEqual([
      {
        userId: 'u1',
        skill: 'Photographer',
        position: 0,
        action: 'link',
        skillId: 'photo-id',
        nextText: 'Photography',
      },
      {
        userId: 'u1',
        skill: 'Motion Design',
        position: 1,
        action: 'leave',
        reason: 'unmatched',
      },
      {
        userId: 'u1',
        skill: 'Drums',
        position: 2,
        action: 'leave',
        reason: 'unmatched',
      },
    ]);
  });

  it('does not delete or relink when the canonical skill is already present', () => {
    const decisions = decideProfileSkillBackfill(
      [
        { userId: 'u1', skill: 'Photography', skillId: 'photo-id', position: 0 },
        { userId: 'u1', skill: 'Photographer', skillId: null, position: 1 },
      ],
      targets,
    );
    expect(decisions.map((row) => row.action)).toEqual(['leave', 'leave']);
    expect(decisions[1]?.reason).toBe('duplicate-canonical');
  });

  it('does not create a case-variant duplicate of the canonical name', () => {
    const decisions = decideProfileSkillBackfill(
      [
        { userId: 'u1', skill: 'Photographer', skillId: null, position: 0 },
        { userId: 'u1', skill: 'photography', skillId: null, position: 1 },
      ],
      targets,
    );
    expect(decisions.map((row) => [row.skill, row.action, row.reason])).toEqual([
      ['Photographer', 'leave', 'text-collision'],
      ['photography', 'link', undefined],
    ]);
    expect(decisions[1]?.nextText).toBe('Photography');
  });

  it('is idempotent once a row is linked', () => {
    const second = decideProfileSkillBackfill(
      [
        {
          userId: 'u1',
          skill: 'Photography',
          skillId: 'photo-id',
          position: 4,
        },
      ],
      targets,
    );
    expect(second).toEqual([
      {
        userId: 'u1',
        skill: 'Photography',
        position: 4,
        action: 'leave',
        reason: 'already-linked',
      },
    ]);
  });
});
