import {
  matchEvent,
  normalizeText,
  normalizeToTokens,
  phraseMatchesTitle,
  findMatchingProfiles,
  resolveProfileCandidate,
  extractIdentifiers,
  type MatchProfileCandidate,
  type MatchTeamIdentifier,
} from '../activityMatcher';

const hockeyPractice: MatchProfileCandidate = { id: 'p-practice', name: 'Hockey Practice', matchKeywords: ['Hockey Practice', 'Practice'] };
const hockeyGame: MatchProfileCandidate = { id: 'p-game', name: 'Hockey Game', matchKeywords: ['Hockey Game', 'Game'] };
const hockeyMill: MatchProfileCandidate = { id: 'p-mill', name: 'Hockey Mill', matchKeywords: ['Hockey Mill', 'Mill'] };
const soccer: MatchProfileCandidate = { id: 'p-soccer', name: 'Soccer Practice', matchKeywords: ['Soccer'] };

const beckhamId = 'member-beckham';
const theoId = 'member-theo';

const teamIdentifiers: MatchTeamIdentifier[] = [
  { identifier: 'U9MD', memberId: beckhamId },
  { identifier: 'U11LL1', memberId: theoId },
];

describe('normalizeText / normalizeToTokens', () => {
  it('lowercases, strips punctuation/hyphens/&, and collapses whitespace', () => {
    expect(normalizeText('Hockey  Practice -- U9MD & Friends!')).toBe('hockey practice u9md friends');
  });

  it('tokenizes on the normalized spaces', () => {
    expect(normalizeToTokens('Shared Hockey-Practice (Rink B)')).toEqual(['shared', 'hockey', 'practice', 'rink', 'b']);
  });

  it('returns an empty array for a blank/punctuation-only string', () => {
    expect(normalizeToTokens('   --- ')).toEqual([]);
  });
});

describe('phraseMatchesTitle', () => {
  it('matches a single-token phrase anywhere in the title', () => {
    expect(phraseMatchesTitle(['practice'], ['shared', 'practice', 'tonight'])).toBe(true);
  });

  it('matches a multi-word phrase only as a contiguous run', () => {
    expect(phraseMatchesTitle(['hockey', 'mill'], ['u9', 'hockey', 'mill', 'session'])).toBe(true);
    expect(phraseMatchesTitle(['hockey', 'mill'], ['hockey', 'practice', 'then', 'mill'])).toBe(false);
  });

  it('does not match a token as a substring of a different token', () => {
    expect(phraseMatchesTitle(['u9md'], ['u9mdx', 'practice'])).toBe(false);
  });

  it('a phrase longer than the title never matches', () => {
    expect(phraseMatchesTitle(['hockey', 'practice', 'tonight', 'extra'], ['hockey', 'practice'])).toBe(false);
  });
});

describe('findMatchingProfiles / resolveProfileCandidate', () => {
  it('picks a profile\'s own best (highest-specificity) keyword, not the first one', () => {
    const matches = findMatchingProfiles('Shared Hockey Practice', [hockeyPractice]);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedPhrase).toBe('Hockey Practice');
    expect(matches[0]!.specificity).toBe(2);
  });

  it('a single matching profile wins regardless of how generic its keyword is', () => {
    const matches = findMatchingProfiles('Practice tonight', [hockeyPractice]);
    const resolution = resolveProfileCandidate(matches);
    expect(resolution.winner?.profileId).toBe('p-practice');
  });

  it('two profiles matching at equal specificity are ambiguous', () => {
    // Both "Hockey Practice" and "Hockey Game" keywords are absent; only the
    // generic 1-token keywords could match simultaneously via a contrived
    // title, so use two single-token profiles tied at specificity 1 instead.
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'] };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'] };
    const matches = findMatchingProfiles('Group Session', [genericA, genericB]);
    const resolution = resolveProfileCandidate(matches);
    expect(resolution.winner).toBeNull();
  });

  it('higher specificity wins outright over a tied-plus-generic match, not treated as ambiguous', () => {
    // "Hockey Mill" (2 tokens) beats "Mill" (1 token) from a different profile.
    const genericMill: MatchProfileCandidate = { id: 'generic-mill', name: 'Generic Mill', matchKeywords: ['Mill'] };
    const matches = findMatchingProfiles('U9 Hockey Mill Session', [hockeyMill, genericMill]);
    const resolution = resolveProfileCandidate(matches);
    expect(resolution.winner?.profileId).toBe('p-mill');
    expect(resolution.winner?.matchedPhrase).toBe('Hockey Mill');
  });

  it('no matching profiles resolves to no winner, not an ambiguity', () => {
    const matches = findMatchingProfiles('Dentist appointment', [hockeyPractice, soccer]);
    expect(matches).toEqual([]);
    expect(resolveProfileCandidate(matches).winner).toBeNull();
  });
});

describe('extractIdentifiers', () => {
  it('finds a configured identifier at a token boundary', () => {
    const found = extractIdentifiers('U9MD Practice', teamIdentifiers);
    expect(found).toEqual([{ identifier: 'U9MD', memberId: beckhamId }]);
  });

  it('does not match an identifier that is only a substring of a title token', () => {
    const found = extractIdentifiers('U9MDX Practice', teamIdentifiers);
    expect(found).toEqual([]);
  });

  it('finds multiple distinct identifiers in one title', () => {
    const found = extractIdentifiers('U9MD vs U11LL1 scrimmage', teamIdentifiers);
    expect(found.map((f) => f.identifier).sort()).toEqual(['U11LL1', 'U9MD']);
  });

  it('last entry wins for a technically-duplicated identifier text', () => {
    const dup: MatchTeamIdentifier[] = [
      { identifier: 'U9MD', memberId: beckhamId },
      { identifier: 'U9MD', memberId: theoId },
    ];
    const found = extractIdentifiers('U9MD Practice', dup);
    expect(found).toEqual([{ identifier: 'U9MD', memberId: theoId }]);
  });

  it('finds no identifiers when none are configured or present', () => {
    expect(extractIdentifiers('Dentist appointment', teamIdentifiers)).toEqual([]);
  });
});

describe('matchEvent', () => {
  const profiles = [hockeyPractice, hockeyGame, hockeyMill, soccer];

  it('auto-matches: unambiguous profile + exactly one resolved member via identifier', () => {
    const result = matchEvent({
      title: 'U9MD Hockey Practice',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.matchStatus).toBe('auto_confirmed');
    expect(result.reviewReason).toBeNull();
    expect(result.profileId).toBe('p-practice');
    expect(result.memberId).toBe(beckhamId);
    expect(result.matchedPhrase).toBe('Hockey Practice');
  });

  it('auto-matches via the calendar\'s own owning member when no identifier is present', () => {
    const result = matchEvent({
      title: 'Hockey Practice',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: beckhamId,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.memberId).toBe(beckhamId);
  });

  it('auto-matches when the identifier and the calendar-group member agree (deduped, not a conflict)', () => {
    const result = matchEvent({
      title: 'U9MD Hockey Practice',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: beckhamId,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.memberId).toBe(beckhamId);
    expect(result.memberCandidates).toEqual([beckhamId]);
  });

  it('ignores a title that matches no profile and contains no configured identifier', () => {
    const result = matchEvent({
      title: 'Dentist appointment',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('ignore');
    expect(result.profileId).toBeNull();
    expect(result.memberId).toBeNull();
    expect(result.matchStatus).toBeNull();
    expect(result.reviewReason).toBeNull();
  });

  it('flags needs_review/unclassified when the title contains an identifier but matches no profile', () => {
    const result = matchEvent({
      title: 'U9MD team photos',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.matchStatus).toBe('needs_review');
    expect(result.reviewReason).toBe('unclassified');
    expect(result.profileId).toBeNull();
    expect(result.memberId).toBe(beckhamId);
  });

  it('flags needs_review/ambiguous_profile when two profiles tie at top specificity but the member is resolved', () => {
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'] };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'] };
    const result = matchEvent({
      title: 'U9MD Group Session',
      activeProfiles: [genericA, genericB],
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_profile');
    expect(result.profileId).toBeNull();
    expect(result.memberId).toBe(beckhamId);
    expect(result.profileCandidates.map((c) => c.profileId).sort()).toEqual(['a', 'b']);
  });

  it('flags needs_review/ambiguous_member when the profile is unambiguous but no member resolves', () => {
    const result = matchEvent({
      title: 'Hockey Practice',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_member');
    expect(result.profileId).toBe('p-practice');
    expect(result.memberId).toBeNull();
  });

  it('flags needs_review/ambiguous_member when the identifier and calendar-group member disagree', () => {
    const result = matchEvent({
      title: 'U9MD Hockey Practice',
      activeProfiles: profiles,
      teamIdentifiers,
      calendarGroupMemberId: theoId,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_member');
    expect(result.profileId).toBe('p-practice');
    expect(result.memberId).toBeNull();
    expect(result.memberCandidates.sort()).toEqual([beckhamId, theoId].sort());
  });

  it('flags needs_review/ambiguous_both when both signals are unresolved', () => {
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'] };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'] };
    const result = matchEvent({
      title: 'Group Session',
      activeProfiles: [genericA, genericB],
      teamIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_both');
    expect(result.profileId).toBeNull();
    expect(result.memberId).toBeNull();
  });

  it('distinguishes Hockey Practice / Hockey Game / Hockey Mill by their own specific keywords', () => {
    const practice = matchEvent({ title: 'U9MD Hockey Practice', activeProfiles: profiles, teamIdentifiers, calendarGroupMemberId: null });
    const game = matchEvent({ title: 'U9MD Hockey Game', activeProfiles: profiles, teamIdentifiers, calendarGroupMemberId: null });
    const mill = matchEvent({ title: 'U9MD Hockey Mill', activeProfiles: profiles, teamIdentifiers, calendarGroupMemberId: null });

    expect(practice.profileId).toBe('p-practice');
    expect(game.profileId).toBe('p-game');
    expect(mill.profileId).toBe('p-mill');
  });

  it('is a pure function: calling it twice with the same input gives the same result', () => {
    const input = { title: 'U9MD Hockey Practice', activeProfiles: profiles, teamIdentifiers, calendarGroupMemberId: beckhamId };
    expect(matchEvent(input)).toEqual(matchEvent(input));
  });
});
