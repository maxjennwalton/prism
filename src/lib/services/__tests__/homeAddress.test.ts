const mockSelect = jest.fn();
jest.mock('@/lib/db/client', () => ({ db: { select: (...a: unknown[]) => mockSelect(...a) } }));
jest.mock('@/lib/db/schema', () => ({ settings: { key: 'key', value: 'value' } }));
jest.mock('drizzle-orm', () => ({ eq: jest.fn() }));

import { getHomeAddress, HOME_ADDRESS_SETTING_KEY } from '../homeAddress';

describe('getHomeAddress', () => {
  it('returns null when nothing is configured', async () => {
    mockSelect.mockReturnValue({ from: () => ({ where: async () => [] }) });
    expect(await getHomeAddress()).toBeNull();
  });

  it('returns the stored value', async () => {
    const stored = { address: '1 Home Way', lat: 1, lon: 2 };
    mockSelect.mockReturnValue({ from: () => ({ where: async () => [{ value: stored }] }) });
    expect(await getHomeAddress()).toEqual(stored);
  });

  it('uses the expected settings key', () => {
    expect(HOME_ADDRESS_SETTING_KEY).toBe('homeAddress');
  });
});
