import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ExploreServiceQueryDto, ExploreTalentQueryDto } from '../explore/dto/explore-query.dto';
import { ListJobListingsQueryDto } from '../marketplace/dto/marketplace.dto';
import {
  EXPLORE_MAX_CATEGORY_FILTERS,
  EXPLORE_MAX_FILTER_TOKENS,
  parseExploreIdList,
} from './explore-taxonomy-filter';

function uuid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

async function rejection(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return JSON.stringify((error as BadRequestException).getResponse());
  }
  throw new Error('expected a 400');
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

describe('parseExploreIdList', () => {
  const a = uuid(1);
  const b = uuid(2);

  it('omits an empty value and collapses duplicates', () => {
    expect(parseExploreIdList(undefined, 11)).toEqual({ ok: true });
    expect(parseExploreIdList('', 11)).toEqual({ ok: true });
    expect(parseExploreIdList(' , ', 11)).toEqual({ ok: true });
    expect(parseExploreIdList(`${b},${a},${b}`, 11)).toEqual({
      ok: true,
      ids: [a, b],
    });
    expect(parseExploreIdList([`${b},${a}`, b.toUpperCase()], 11)).toEqual({
      ok: true,
      ids: [a, b],
    });
  });

  it('rejects malformed ids, unknown shapes, and over-limit lists', () => {
    expect(parseExploreIdList('design', 11).ok).toBe(false);
    expect(parseExploreIdList('00000000-0000-1000-8000-000000000001', 11).ok).toBe(
      false,
    );
    expect(parseExploreIdList(12, 11)).toEqual({ ok: false, reason: 'malformed' });
    expect(parseExploreIdList([a, 4], 11)).toEqual({
      ok: false,
      reason: 'malformed',
    });
    expect(
      parseExploreIdList(
        Array.from({ length: EXPLORE_MAX_CATEGORY_FILTERS + 1 }, (_, index) =>
          uuid(index + 1),
        ),
        EXPLORE_MAX_CATEGORY_FILTERS,
      ),
    ).toEqual({ ok: false, reason: 'too_many' });
    expect(
      parseExploreIdList(
        Array.from({ length: EXPLORE_MAX_FILTER_TOKENS + 1 }, () => a),
        11,
      ),
    ).toEqual({ ok: false, reason: 'too_many' });
  });
});

describe('explore taxonomy query pipe', () => {
  const types = [
    ExploreTalentQueryDto,
    ExploreServiceQueryDto,
    ListJobListingsQueryDto,
  ];
  const a = uuid(1);
  const b = uuid(2);

  it.each(types)('accepts a comma list and a repeated list on %p', async (metatype) => {
    const comma = await pipe.transform(
      { categoryIds: `${b},${a},${a}` },
      { type: 'query', metatype },
    );
    expect(comma.categoryIds).toEqual([a, b]);
    expect(comma).not.toHaveProperty('skillIds');

    const repeated = await pipe.transform(
      { categoryIds: [b, a, a] },
      { type: 'query', metatype },
    );
    expect(repeated.categoryIds).toEqual([a, b]);
  });

  it('omits an empty category facet', async () => {
    const dto = await pipe.transform({}, { type: 'query', metatype: ExploreTalentQueryDto });
    expect(dto.categoryIds).toBeUndefined();
    expect(dto).not.toHaveProperty('skillIds');
  });

  it('rejects a public skillIds filter instead of applying it', async () => {
    for (const metatype of types) {
      const body = await rejection(
        pipe.transform({ skillIds: a }, { type: 'query', metatype }),
      );
      expect(body).toContain('skillIds');
      expect(body).not.toContain(a);
    }
  });

  it('rejects a malformed category and bracket syntax', async () => {
    await expect(
      pipe.transform(
        { categoryIds: 'not-a-uuid' },
        { type: 'query', metatype: ExploreTalentQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      pipe.transform(
        { 'categoryIds[]': a },
        { type: 'query', metatype: ListJobListingsQueryDto },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts the category maximum and rejects one past it', async () => {
    const categories = Array.from(
      { length: EXPLORE_MAX_CATEGORY_FILTERS },
      (_, index) => uuid(index + 1),
    );
    const ok = await pipe.transform(
      { categoryIds: categories.join(',') },
      { type: 'query', metatype: ExploreTalentQueryDto },
    );
    expect(ok.categoryIds).toHaveLength(EXPLORE_MAX_CATEGORY_FILTERS);

    const tooManyCategories = await rejection(
      pipe.transform(
        { categoryIds: [...categories, uuid(40)].join(',') },
        { type: 'query', metatype: ExploreServiceQueryDto },
      ),
    );
    expect(tooManyCategories).toContain('Too many category filters.');
  });

  it('does not echo the bad value in the validation message', async () => {
    const secret = 'not-a-real-category';
    const body = await rejection(
      pipe.transform(
        { categoryIds: secret },
        { type: 'query', metatype: ExploreServiceQueryDto },
      ),
    );
    expect(body).toContain('Invalid category filter.');
    expect(body).not.toContain(secret);
  });
});
