import { OTHER_CATEGORY_ID, seedId } from './taxonomy-ids';

describe('taxonomy ids', () => {
  it('pins the Other category id to the seed namespace', () => {
    expect(seedId('category:other')).toBe(
      '124770be-76a7-4d70-839b-11a71bdee1cb',
    );
    expect(OTHER_CATEGORY_ID).toBe('124770be-76a7-4d70-839b-11a71bdee1cb');
  });
});
