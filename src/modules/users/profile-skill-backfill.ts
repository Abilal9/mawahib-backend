import { normalizeSkillTerm } from '../taxonomy/normalize-skill-term';

/**
 * Explicit one-time map for profile skills. A string is linked only when it
 * appears here. Other SkillTerm hits stay free text.
 */
export const APPROVED_PROFILE_SKILL_MAP: Readonly<Record<string, string>> = {
  photography: 'photography',
  photographer: 'photography',
  branding: 'branding',
  'brand designer': 'branding',
  'ui design': 'ui-design',
  'ux design': 'ux-design',
  figma: 'figma',
  illustration: 'illustration',
  'video editing': 'video-editing',
  'video editor': 'video-editing',
  copywriting: 'copywriting',
  '3d modeling': '3d-modeling',
  seo: 'seo',
  prototyping: 'prototyping',
  'design systems': 'design-systems',
  'campaign design': 'campaign-design',
  'art direction': 'art-direction',
  'content strategy': 'content-strategy',
  'brand systems': 'brand-systems',
  'icon design': 'icon-design',
  'ux research': 'ux-research',
  'after effects': 'after-effects',
  'react native': 'react-native',
  typescript: 'typescript',
  retouching: 'retouching',
};

export interface BackfillSkillRow {
  userId: string;
  skill: string;
  skillId: string | null;
  position: number;
}

export interface BackfillTarget {
  slug: string;
  id: string;
  nameEn: string;
  active: boolean;
}

export interface BackfillDecision {
  userId: string;
  skill: string;
  position: number;
  action: 'link' | 'leave';
  skillId?: string;
  nextText?: string;
  reason?: string;
}

export function decideProfileSkillBackfill(
  rows: readonly BackfillSkillRow[],
  targets: ReadonlyMap<string, BackfillTarget>,
): BackfillDecision[] {
  const decisions: BackfillDecision[] = [];
  const byUser = new Map<string, BackfillSkillRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }

  for (const [userId, userRows] of byUser) {
    const ordered = [...userRows].sort((a, b) => a.position - b.position);
    const claimedIds = new Set(
      ordered.map((row) => row.skillId).filter((id): id is string => Boolean(id)),
    );
    const claimedNorms = new Set(
      ordered
        .map((row) => normalizeSkillTerm(row.skill))
        .filter((value) => value.length > 0),
    );
    const claimedFromEarlier = new Set<string>();

    for (const row of ordered) {
      if (row.skillId) {
        decisions.push({
          userId,
          skill: row.skill,
          position: row.position,
          action: 'leave',
          reason: 'already-linked',
        });
        continue;
      }
      const slug = APPROVED_PROFILE_SKILL_MAP[normalizeSkillTerm(row.skill)];
      const target = slug ? targets.get(slug) : undefined;
      if (!slug || !target) {
        decisions.push({
          userId,
          skill: row.skill,
          position: row.position,
          action: 'leave',
          reason: slug ? 'target-missing' : 'unmatched',
        });
        continue;
      }
      if (!target.active) {
        decisions.push({
          userId,
          skill: row.skill,
          position: row.position,
          action: 'leave',
          reason: 'target-inactive',
        });
        continue;
      }
      if (claimedIds.has(target.id) || claimedFromEarlier.has(target.id)) {
        decisions.push({
          userId,
          skill: row.skill,
          position: row.position,
          action: 'leave',
          reason: 'duplicate-canonical',
        });
        continue;
      }
      const nameNorm = normalizeSkillTerm(target.nameEn);
      const rowNorm = normalizeSkillTerm(row.skill);
      const otherRowOwnsName = ordered.some(
        (other) =>
          other !== row && normalizeSkillTerm(other.skill) === nameNorm,
      );
      if (otherRowOwnsName || (nameNorm !== rowNorm && claimedNorms.has(nameNorm))) {
        decisions.push({
          userId,
          skill: row.skill,
          position: row.position,
          action: 'leave',
          reason: 'text-collision',
        });
        continue;
      }
      decisions.push({
        userId,
        skill: row.skill,
        position: row.position,
        action: 'link',
        skillId: target.id,
        nextText: target.nameEn,
      });
      claimedIds.add(target.id);
      claimedFromEarlier.add(target.id);
      if (nameNorm) claimedNorms.add(nameNorm);
    }
  }

  return decisions;
}
