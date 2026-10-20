import { displaySkillTerm, normalizeSkillTerm } from '../taxonomy/normalize-skill-term';

export const SKILL_TEXT_MAX = 60;
export const SKILL_LIST_MAX = 40;

export type ProfileSkillCode =
  | 'SKILL_MATCHES_CANONICAL'
  | 'SKILL_INVALID'
  | 'SKILL_INACTIVE'
  | 'SKILL_LIMIT'
  | 'SKILL_TEXT'
  | 'SKILL_SHAPE';

export class ProfileSkillError extends Error {
  constructor(
    readonly code: ProfileSkillCode,
    message: string,
    readonly details: Record<string, string | null> = {},
  ) {
    super(message);
    this.name = 'ProfileSkillError';
  }
}

export interface StoredProfileSkill {
  skill: string;
  skillId: string | null;
}

export interface CatalogSkillState {
  id: string;
  nameEn: string;
  /** Skill and its category are both active. */
  active: boolean;
}

export interface ActiveSkillTerm {
  skillId: string;
  nameEn: string;
}

export type SkillSelectionInput =
  | { skillId: string; text?: undefined }
  | { text: string; skillId?: undefined };

export interface ResolvedProfileSkill {
  skill: string;
  skillId: string | null;
}

interface Draft extends ResolvedProfileSkill {
  canonical: boolean;
}

function assertLimit(rows: ResolvedProfileSkill[]): ResolvedProfileSkill[] {
  if (rows.length > SKILL_LIST_MAX) {
    throw new ProfileSkillError(
      'SKILL_LIMIT',
      `A profile can have at most ${SKILL_LIST_MAX} skills`,
    );
  }
  return rows;
}

function collapse(drafts: Draft[]): ResolvedProfileSkill[] {
  const kept: Draft[] = [];
  const seenIds = new Set<string>();

  for (const draft of drafts) {
    const norm = normalizeSkillTerm(draft.skill);
    if (draft.canonical && draft.skillId) {
      if (seenIds.has(draft.skillId)) continue;
      const customAt = kept.findIndex(
        (row) => !row.canonical && normalizeSkillTerm(row.skill) === norm,
      );
      if (customAt >= 0) {
        kept.splice(customAt, 1, draft);
      } else {
        kept.push(draft);
      }
      seenIds.add(draft.skillId);
      continue;
    }

    if (seenIds.size > 0) {
      const covered = kept.some(
        (row) => row.canonical && normalizeSkillTerm(row.skill) === norm,
      );
      if (covered) continue;
    }
    const duplicateCustom = kept.some(
      (row) => !row.canonical && normalizeSkillTerm(row.skill) === norm,
    );
    if (duplicateCustom) continue;
    kept.push(draft);
  }

  return assertLimit(kept.map(({ skill, skillId }) => ({ skill, skillId })));
}

function existingCustomNorms(existing: readonly StoredProfileSkill[]): Set<string> {
  return new Set(
    existing
      .filter((row) => row.skillId == null)
      .map((row) => normalizeSkillTerm(row.skill))
      .filter(Boolean),
  );
}

function linkedByText(
  existing: readonly StoredProfileSkill[],
  skillsById: ReadonlyMap<string, CatalogSkillState>,
): Map<string, StoredProfileSkill> {
  const linked = new Map<string, StoredProfileSkill>();
  for (const row of existing) {
    if (!row.skillId) continue;
    const stored = normalizeSkillTerm(row.skill);
    if (stored) linked.set(stored, row);
    const current = skillsById.get(row.skillId);
    const name = current ? normalizeSkillTerm(current.nameEn) : '';
    if (name) linked.set(name, row);
  }
  return linked;
}

/**
 * Resolve one profile-skill save.
 *
 * Canonical rows always store the active skill's current English name.
 * A custom string is rejected only when it is new and matches an active term.
 * An existing custom row stays custom even if a later alias would match it.
 * A legacy string list never creates a new canonical link, and it keeps a
 * link the user already has when the text still matches that row.
 */
export function resolveProfileSkills(input: {
  existing: readonly StoredProfileSkill[];
  mode: 'legacy' | 'selections';
  legacyTexts?: readonly string[];
  selections?: readonly SkillSelectionInput[];
  skillsById: ReadonlyMap<string, CatalogSkillState>;
  activeTerms: ReadonlyMap<string, ActiveSkillTerm>;
}): ResolvedProfileSkill[] {
  const drafts: Draft[] = [];
  const customs = existingCustomNorms(input.existing);
  const linked = linkedByText(input.existing, input.skillsById);

  if (input.mode === 'legacy') {
    for (const raw of input.legacyTexts ?? []) {
      const text = displaySkillTerm(raw);
      const norm = normalizeSkillTerm(text);
      if (!norm) continue;
      const match = linked.get(norm);
      if (!match?.skillId) {
        if (text.length > SKILL_TEXT_MAX) {
          const already = input.existing.some(
            (row) => normalizeSkillTerm(row.skill) === norm,
          );
          if (!already) {
            throw new ProfileSkillError(
              'SKILL_TEXT',
              `Skill text must be at most ${SKILL_TEXT_MAX} characters`,
            );
          }
        }
        drafts.push({ skill: text, skillId: null, canonical: false });
        continue;
      }
      const catalog = input.skillsById.get(match.skillId);
      if (catalog?.active) {
        drafts.push({
          skill: catalog.nameEn,
          skillId: match.skillId,
          canonical: true,
        });
      } else {
        drafts.push({
          skill: match.skill,
          skillId: match.skillId,
          canonical: true,
        });
      }
    }
    return collapse(drafts);
  }

  for (const item of input.selections ?? []) {
    if ('skillId' in item && item.skillId) {
      const catalog = input.skillsById.get(item.skillId);
      const already = input.existing.some((row) => row.skillId === item.skillId);
      if (!catalog) {
        throw new ProfileSkillError('SKILL_INVALID', 'Unknown skill', {
          skillId: item.skillId,
        });
      }
      if (!catalog.active && !already) {
        throw new ProfileSkillError(
          'SKILL_INACTIVE',
          'That skill is no longer available',
          { skillId: item.skillId },
        );
      }
      if (catalog.active) {
        drafts.push({
          skill: catalog.nameEn,
          skillId: catalog.id,
          canonical: true,
        });
      } else {
        const stored = input.existing.find((row) => row.skillId === item.skillId);
        drafts.push({
          skill: stored?.skill ?? catalog.nameEn,
          skillId: catalog.id,
          canonical: true,
        });
      }
      continue;
    }

    const text = displaySkillTerm(
      'text' in item && item.text ? item.text : '',
    );
    const norm = normalizeSkillTerm(text);
    if (!norm) continue;
    if (text.length > SKILL_TEXT_MAX && !customs.has(norm)) {
      throw new ProfileSkillError(
        'SKILL_TEXT',
        `Skill text must be at most ${SKILL_TEXT_MAX} characters`,
      );
    }
    if (!customs.has(norm)) {
      const term = input.activeTerms.get(norm);
      if (term) {
        throw new ProfileSkillError(
          'SKILL_MATCHES_CANONICAL',
          `Use the ${term.nameEn} skill`,
          { text, skillId: term.skillId, nameEn: term.nameEn },
        );
      }
    }
    drafts.push({ skill: text, skillId: null, canonical: false });
  }

  return collapse(drafts);
}
