/**
 * Deterministic SkillTerm normalization.
 *
 * Rule, in order:
 * 1. Unicode NFC, so composed and decomposed look-alikes share one term.
 * 2. Trim leading and trailing whitespace.
 * 3. Collapse every internal whitespace run to a single space.
 * 4. Case-fold with String.prototype.toLowerCase (not locale-sensitive).
 *
 * Punctuation, slashes, plus signs, and digits stay. There is no stemming
 * and no fuzzy matching. Postgres lower() is not used.
 *
 * Examples:
 * - "Photography", " photography ", and "PHOTOGRAPHY" → "photography"
 * - "UI/UX Design" → "ui/ux design"
 */
export function displaySkillTerm(input: string): string {
  return input.normalize('NFC').trim().replace(/\s+/g, ' ');
}

export function normalizeSkillTerm(input: string): string {
  return displaySkillTerm(input).toLowerCase();
}
