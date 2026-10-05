import {
  AFTER_SCHOOL_HOUR_RANGE,
  AFTER_SCHOOL_GROUP_NAMES,
  expandHourRange,
  orderAfterSchoolGroups,
} from '../afterSchoolView';

describe('expandHourRange', () => {
  it('expands a [start, end) range into hour-of-day numbers', () => {
    expect(expandHourRange({ start: 15, end: 22 })).toEqual([15, 16, 17, 18, 19, 20, 21]);
  });

  it('matches the After School view default: 3:00 PM through 10:00 PM', () => {
    const hours = expandHourRange(AFTER_SCHOOL_HOUR_RANGE);
    expect(hours[0]).toBe(15); // 3:00 PM
    expect(hours[hours.length - 1]).toBe(21); // last visible hour, 9–10 PM
    expect(hours).toHaveLength(7);
  });

  it('returns an empty array when start equals end', () => {
    expect(expandHourRange({ start: 9, end: 9 })).toEqual([]);
  });
});

describe('orderAfterSchoolGroups', () => {
  const group = (name: string) => ({ id: name.toLowerCase(), name, color: '#000000' });

  it('orders groups as Family, Theo, Beckham, Max, Jenn regardless of input order', () => {
    const input = [group('Jenn'), group('Max'), group('Beckham'), group('Theo'), group('Family')];
    expect(orderAfterSchoolGroups(input).map((g) => g.name)).toEqual([
      'Family', 'Theo', 'Beckham', 'Max', 'Jenn',
    ]);
  });

  it('excludes the Boys group (and any other group not in the fixed set)', () => {
    const input = [group('Family'), group('Boys'), group('Theo'), group('Beckham'), group('Max'), group('Jenn')];
    const result = orderAfterSchoolGroups(input);
    expect(result.map((g) => g.name)).not.toContain('Boys');
    expect(result).toHaveLength(5);
  });

  it('skips a missing group instead of erroring', () => {
    const input = [group('Family'), group('Theo')];
    expect(orderAfterSchoolGroups(input).map((g) => g.name)).toEqual(['Family', 'Theo']);
  });

  it('returns an empty array when none of the fixed names are present', () => {
    expect(orderAfterSchoolGroups([group('Boys'), group('Work')])).toEqual([]);
  });

  it('preserves every field of the original group objects (e.g. color, userId)', () => {
    const family = { id: 'f1', name: 'Family', color: '#F59E0B', userId: null };
    expect(orderAfterSchoolGroups([family])).toEqual([family]);
  });

  it('covers exactly the five names the view is defined for', () => {
    expect(AFTER_SCHOOL_GROUP_NAMES).toEqual(['Family', 'Theo', 'Beckham', 'Max', 'Jenn']);
  });
});
