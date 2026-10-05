import { getAvailableViews, resolveMultiWeek, VIEW_OPTIONS } from '../useCalendarWidgetPrefs';

describe('getAvailableViews — afterSchool availability', () => {
  it('offers afterSchool at every grid size that offers day', () => {
    const sizes: [number, number][] = [[48, 27], [27, 48], [36, 36], [16, 16], [40, 30]];
    for (const [w, h] of sizes) {
      const views = getAvailableViews(w, h);
      expect(views.includes('afterSchool')).toBe(views.includes('day'));
    }
  });

  it('does not offer afterSchool on a widget too small for day (agenda-only)', () => {
    const views = getAvailableViews(8, 8);
    expect(views).toEqual(['agenda']);
    expect(views).not.toContain('afterSchool');
  });
});

describe('resolveMultiWeek — afterSchool passthrough', () => {
  it('resolves afterSchool to itself (not folded into a multiWeek variant)', () => {
    expect(resolveMultiWeek('afterSchool')).toEqual({ baseView: 'afterSchool', weekCount: 2 });
  });
});

describe('VIEW_OPTIONS', () => {
  it('includes an afterSchool entry with its own label key', () => {
    const entry = VIEW_OPTIONS.find((o) => o.value === 'afterSchool');
    expect(entry).toBeDefined();
    expect(entry?.labelKey).toBe('afterSchool');
  });
});
