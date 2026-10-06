import {
  createActivityProfileSchema,
  updateActivityProfileSchema,
  activityGearItemSchema,
  createActivityProfilePrepStepSchema,
  updateActivityProfilePrepStepSchema,
  updateActivityEventLinkSchema,
  setActivityGearCompletionSchema,
} from '../index';

describe('createActivityProfileSchema — no invented timing defaults', () => {
  it('accepts a profile with only a name — no timing fields required', () => {
    const result = createActivityProfileSchema.safeParse({ name: 'Hockey Practice' });
    expect(result.success).toBe(true);
  });

  it('never fills in arrivalBufferMinutes or travelMinutes when omitted', () => {
    const result = createActivityProfileSchema.safeParse({ name: 'Hockey Practice' });
    expect(result.success).toBe(true);
    if (result.success) {
      // Zod must not have injected a default value for either field — the
      // key should be entirely absent from the parsed output, not present
      // with some guessed number.
      expect('arrivalBufferMinutes' in result.data).toBe(false);
      expect('travelMinutes' in result.data).toBe(false);
    }
  });

  it('accepts an explicit null for arrivalBufferMinutes/travelMinutes (still "not configured")', () => {
    const result = createActivityProfileSchema.safeParse({
      name: 'Hockey Practice',
      arrivalBufferMinutes: null,
      travelMinutes: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts explicit timing values when the household configures them', () => {
    const result = createActivityProfileSchema.safeParse({
      name: 'Hockey Game',
      arrivalBufferMinutes: 30,
      travelMinutes: 20,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing name', () => {
    expect(createActivityProfileSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a negative buffer/travel value', () => {
    expect(createActivityProfileSchema.safeParse({ name: 'X', arrivalBufferMinutes: -5 }).success).toBe(false);
    expect(createActivityProfileSchema.safeParse({ name: 'X', travelMinutes: -1 }).success).toBe(false);
  });

  it('validates gearItems entries', () => {
    const ok = createActivityProfileSchema.safeParse({
      name: 'Hockey Practice',
      gearItems: [{ id: 'g1', label: 'Helmet', sortOrder: 0 }],
    });
    expect(ok.success).toBe(true);

    const bad = createActivityProfileSchema.safeParse({
      name: 'Hockey Practice',
      gearItems: [{ id: 'g1', label: '', sortOrder: 0 }],
    });
    expect(bad.success).toBe(false);
  });
});

describe('updateActivityProfileSchema — PATCH semantics', () => {
  it('allows a partial update with just one field', () => {
    expect(updateActivityProfileSchema.safeParse({ color: '#3B82F6' }).success).toBe(true);
  });

  it('allows clearing a configured buffer back to null', () => {
    const result = updateActivityProfileSchema.safeParse({ arrivalBufferMinutes: null });
    expect(result.success).toBe(true);
  });

  it('allows archiving', () => {
    expect(updateActivityProfileSchema.safeParse({ archived: true }).success).toBe(true);
  });
});

describe('activityGearItemSchema', () => {
  it('requires a non-empty label', () => {
    expect(activityGearItemSchema.safeParse({ id: 'g1', label: 'Helmet', sortOrder: 0 }).success).toBe(true);
    expect(activityGearItemSchema.safeParse({ id: 'g1', label: '', sortOrder: 0 }).success).toBe(false);
  });
});

describe('createActivityProfilePrepStepSchema — anchors', () => {
  const base = {
    activityProfileId: '11111111-1111-1111-1111-111111111111',
    label: 'Pack hockey bag',
    offsetMinutes: 30,
  };

  it('accepts each of the three supported anchors', () => {
    for (const anchor of ['event_start', 'arrival', 'leave_home'] as const) {
      const result = createActivityProfilePrepStepSchema.safeParse({ ...base, anchor });
      expect(result.success).toBe(true);
    }
  });

  it('rejects an anchor outside the fixed set', () => {
    const result = createActivityProfilePrepStepSchema.safeParse({ ...base, anchor: 'arrival_plus_five' });
    expect(result.success).toBe(false);
  });

  it('rejects a negative offset', () => {
    const result = createActivityProfilePrepStepSchema.safeParse({ ...base, anchor: 'leave_home', offsetMinutes: -10 });
    expect(result.success).toBe(false);
  });

  it('defaults isCheckable to true and linksGear to false', () => {
    const result = createActivityProfilePrepStepSchema.safeParse({ ...base, anchor: 'leave_home' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isCheckable).toBe(true);
      expect(result.data.linksGear).toBe(false);
    }
  });

  it('requires a valid activityProfileId (uuid)', () => {
    const result = createActivityProfilePrepStepSchema.safeParse({ ...base, activityProfileId: 'not-a-uuid', anchor: 'event_start' });
    expect(result.success).toBe(false);
  });
});

describe('updateActivityProfilePrepStepSchema', () => {
  it('does not require activityProfileId (a step cannot be reparented via this schema)', () => {
    const result = updateActivityProfilePrepStepSchema.safeParse({ offsetMinutes: 15 });
    expect(result.success).toBe(true);
  });
});

describe('updateActivityEventLinkSchema', () => {
  it('allows dismissing a match by setting activityProfileId to null', () => {
    expect(updateActivityEventLinkSchema.safeParse({ activityProfileId: null }).success).toBe(true);
  });

  it('allows setting a per-event travel-time override', () => {
    expect(updateActivityEventLinkSchema.safeParse({ travelMinutesOverride: 25 }).success).toBe(true);
  });

  it('rejects a non-uuid assignedMemberId', () => {
    expect(updateActivityEventLinkSchema.safeParse({ assignedMemberId: 'theo' }).success).toBe(false);
  });
});

describe('setActivityGearCompletionSchema', () => {
  it('requires gearItemId and checked', () => {
    expect(setActivityGearCompletionSchema.safeParse({ gearItemId: 'g1', checked: true }).success).toBe(true);
    expect(setActivityGearCompletionSchema.safeParse({ gearItemId: 'g1' }).success).toBe(false);
    expect(setActivityGearCompletionSchema.safeParse({ checked: true }).success).toBe(false);
  });
});
