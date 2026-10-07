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

const hockeyPractice: MatchProfileCandidate = { id: 'p-practice', name: 'Hockey Practice', matchKeywords: ['Hockey Practice', 'Practice'], category: null };
const hockeyGame: MatchProfileCandidate = { id: 'p-game', name: 'Hockey Game', matchKeywords: ['Hockey Game', 'Game'], category: null };
const hockeyMill: MatchProfileCandidate = { id: 'p-mill', name: 'Hockey Mill', matchKeywords: ['Hockey Mill', 'Mill'], category: null };
const soccer: MatchProfileCandidate = { id: 'p-soccer', name: 'Soccer Practice', matchKeywords: ['Soccer'], category: null };

const beckhamId = 'member-beckham';
const theoId = 'member-theo';

const teamIdentifiers: MatchTeamIdentifier[] = [
  { identifier: 'U9MD', memberId: beckhamId, category: null },
  { identifier: 'U11LL1', memberId: theoId, category: null },
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
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'], category: null };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'], category: null };
    const matches = findMatchingProfiles('Group Session', [genericA, genericB]);
    const resolution = resolveProfileCandidate(matches);
    expect(resolution.winner).toBeNull();
  });

  it('higher specificity wins outright over a tied-plus-generic match, not treated as ambiguous', () => {
    // "Hockey Mill" (2 tokens) beats "Mill" (1 token) from a different profile.
    const genericMill: MatchProfileCandidate = { id: 'generic-mill', name: 'Generic Mill', matchKeywords: ['Mill'], category: null };
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
    expect(found).toEqual([{ identifier: 'U9MD', memberId: beckhamId, category: null }]);
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
      { identifier: 'U9MD', memberId: beckhamId, category: null },
      { identifier: 'U9MD', memberId: theoId, category: null },
    ];
    const found = extractIdentifiers('U9MD Practice', dup);
    expect(found).toEqual([{ identifier: 'U9MD', memberId: theoId, category: null }]);
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
    expect(result.resolvedCategory).toBeNull();
    expect(result.categoryCandidates).toEqual([]);
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
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'], category: null };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'], category: null };
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
    const genericA: MatchProfileCandidate = { id: 'a', name: 'A', matchKeywords: ['Session'], category: null };
    const genericB: MatchProfileCandidate = { id: 'b', name: 'B', matchKeywords: ['Session'], category: null };
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

describe('matchEvent — category-constrained matching', () => {
  const hockeyGameCat: MatchProfileCandidate = { id: 'p-hockey-game', name: 'Hockey Game', matchKeywords: ['Game'], category: 'Hockey' };
  const hockeyPracticeCat: MatchProfileCandidate = { id: 'p-hockey-practice', name: 'Hockey Practice', matchKeywords: ['Practice'], category: 'Hockey' };
  const soccerGameCat: MatchProfileCandidate = { id: 'p-soccer-game', name: 'Soccer Game', matchKeywords: ['Game'], category: 'Soccer' };
  const soccerPracticeCat: MatchProfileCandidate = { id: 'p-soccer-practice', name: 'Soccer Practice', matchKeywords: ['Practice'], category: 'Soccer' };

  const u9mdHockey: MatchTeamIdentifier = { identifier: 'U9MD', memberId: beckhamId, category: 'Hockey' };
  const u11ll1Hockey: MatchTeamIdentifier = { identifier: 'U11LL1', memberId: theoId, category: 'Hockey' };
  const thunderSoccer: MatchTeamIdentifier = { identifier: 'Thunder U10', memberId: beckhamId, category: 'Soccer' };

  const allSportsProfiles = [hockeyGameCat, hockeyPracticeCat, soccerGameCat, soccerPracticeCat];
  const allIdentifiers = [u9mdHockey, u11ll1Hockey, thunderSoccer];

  it('worked example: "U9MD - Game vs Wasaga Beach Stars" with U9MD -> Beckham -> Hockey resolves to Hockey Game', () => {
    const result = matchEvent({
      title: 'U9MD - Game vs Wasaga Beach Stars',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-hockey-game');
    expect(result.memberId).toBe(beckhamId);
    expect(result.resolvedCategory).toBe('Hockey');
  });

  it('REGRESSION: a Hockey-categorized identifier + "game" can never select Soccer Game, even though both profiles match the keyword equally', () => {
    const result = matchEvent({
      title: 'U9MD Game Tonight',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-hockey-game');
    expect(result.profileId).not.toBe('p-soccer-game');
    // Soccer Game must not even appear as a candidate — it was filtered out
    // before phrase-matching ran, not merely out-scored by it.
    expect(result.profileCandidates.map((c) => c.profileId)).not.toContain('p-soccer-game');
    expect(result.profileCandidates.map((c) => c.profileId)).toEqual(['p-hockey-game']);
  });

  it('a Soccer-categorized identifier similarly resolves "game" only to Soccer Game', () => {
    const result = matchEvent({
      title: 'Thunder U10 Game Tonight',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-soccer-game');
    expect(result.profileCandidates.map((c) => c.profileId)).not.toContain('p-hockey-game');
  });

  it('Hockey Practice and Soccer Practice both safely use "practice", disambiguated by their identifier\'s category', () => {
    const hockeyResult = matchEvent({
      title: 'U9MD Practice',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    const soccerResult = matchEvent({
      title: 'Thunder U10 Practice',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(hockeyResult.profileId).toBe('p-hockey-practice');
    expect(soccerResult.profileId).toBe('p-soccer-practice');
  });

  it('no profiles in the resolved category -> needs_review/unclassified, never falls back to the full profile set', () => {
    const result = matchEvent({
      title: 'U9MD Game Tonight',
      // Only Soccer profiles exist — no Hockey profile to match, even though
      // "Game" would match Soccer Game if narrowing fell back to the full set.
      activeProfiles: [soccerGameCat, soccerPracticeCat],
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('unclassified');
    expect(result.profileId).toBeNull();
    expect(result.resolvedCategory).toBe('Hockey');
  });

  it('a category-matching profile exists but its keywords don\'t match the title -> needs_review/unclassified, not a fallback match', () => {
    const result = matchEvent({
      title: 'U9MD Tournament Registration',
      // Hockey Practice exists (category matches) but "tournament registration" matches no keyword.
      activeProfiles: [hockeyPracticeCat],
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('unclassified');
    expect(result.profileId).toBeNull();
  });

  it('two identifiers in one title with conflicting categories -> needs_review/ambiguous_category, profile never guessed', () => {
    const result = matchEvent({
      title: 'U9MD vs Thunder U10 Game',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_category');
    expect(result.profileId).toBeNull();
    expect(result.matchStatus).toBe('needs_review');
    expect(result.resolvedCategory).toBeNull();
    expect(result.categoryCandidates.slice().sort()).toEqual(['Hockey', 'Soccer']);
  });

  it('a category conflict does not corrupt member resolution — memberCandidates/identifiersFound still reflect the real matches', () => {
    const result = matchEvent({
      title: 'U9MD vs Thunder U10 Game',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    // Both identifiers resolve to the SAME member (Beckham) here, so member
    // resolution still succeeds even though category is in conflict —
    // proving the two signals are genuinely independent outputs.
    expect(result.identifiersFound.slice().sort()).toEqual(['Thunder U10', 'U9MD']);
    expect(result.memberCandidates).toEqual([beckhamId]);
  });

  it('two identifiers in one title with the SAME category is not treated as a conflict', () => {
    const result = matchEvent({
      title: 'U9MD vs U11LL1 Game',
      activeProfiles: allSportsProfiles,
      teamIdentifiers: allIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.categoryCandidates).toEqual(['Hockey']);
    expect(result.reviewReason).not.toBe('ambiguous_category');
  });

  it('category equality is case/whitespace-insensitive', () => {
    const looseIdentifier: MatchTeamIdentifier = { identifier: 'U9MD', memberId: beckhamId, category: '  hockey  ' };
    const result = matchEvent({
      title: 'U9MD Game',
      activeProfiles: [hockeyGameCat, soccerGameCat],
      teamIdentifiers: [looseIdentifier],
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-hockey-game');
  });

  it('no category configured on the matched identifier is still "no category evidence" — a generic phrase that only matches categorized profiles is category_unresolved, never ambiguous_profile', () => {
    // An identifier matched (so this clearly looks like an activity), but it
    // carries no category — exactly as uninformative about category as no
    // identifier matching at all. Both Hockey Game and Soccer Game are
    // categorized, so neither may compete; this is not the old
    // "ambiguous_profile" tie, it's "the category couldn't be determined".
    const noCategoryIdentifier: MatchTeamIdentifier = { identifier: 'U9MD', memberId: beckhamId, category: null };
    const result = matchEvent({
      title: 'U9MD Game',
      activeProfiles: [hockeyGameCat, soccerGameCat],
      teamIdentifiers: [noCategoryIdentifier],
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('category_unresolved');
    expect(result.profileId).toBeNull();
    expect(result.profileCandidates.map((c) => c.profileId).sort()).toEqual(['p-hockey-game', 'p-soccer-game']);
    expect(result.resolvedCategory).toBeNull();
  });
});

describe('matchEvent — a categorized profile must not claim a category-unknown event (real bug report)', () => {
  const hockeyGameCat: MatchProfileCandidate = { id: 'p-hockey-game', name: 'Hockey Game', matchKeywords: ['Game'], category: 'Hockey' };
  const hockeyPracticeCat: MatchProfileCandidate = { id: 'p-hockey-practice', name: 'Hockey Practice', matchKeywords: ['Practice'], category: 'Hockey' };
  const soccerGameCat: MatchProfileCandidate = { id: 'p-soccer-game', name: 'Soccer Game', matchKeywords: ['Game'], category: 'Soccer' };

  const u9mdHockey: MatchTeamIdentifier = { identifier: 'U9MD', memberId: beckhamId, category: 'Hockey' };
  const u11ll1Hockey: MatchTeamIdentifier = { identifier: 'U11LL1', memberId: theoId, category: 'Hockey' };

  // Only Hockey profiles + Hockey identifiers are configured — mirrors the
  // real household's setup at the time the bug was reported, before any
  // Soccer identifier existed.
  const hockeyOnlyProfiles = [hockeyGameCat, hockeyPracticeCat];
  const hockeyOnlyIdentifiers = [u9mdHockey, u11ll1Hockey];

  it('REGRESSION: a real soccer calendar title containing "Game" cannot be assigned Hockey Game when no Hockey identifier is present', () => {
    // The exact title shape reported: no U9MD/U11LL1 anywhere in it, so no
    // identifier matches and no category context resolves at all.
    const result = matchEvent({
      title: '2026/27 Youth Sports Programs - Soccer Programs - Grasshoppers vs Sharks - Game',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });

    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('category_unresolved');
    // The crux of the bug: Hockey Game must never be assigned.
    expect(result.profileId).toBeNull();
    expect(result.matchedPhrase).toBeNull();
    expect(result.profileId).not.toBe('p-hockey-game');
    // Still surfaced for a human to see what triggered the review (Preview
    // shows this), without it ever being treated as an assigned match.
    expect(result.profileCandidates.map((c) => c.profileId)).toContain('p-hockey-game');
    expect(result.resolvedCategory).toBeNull();
    expect(result.identifiersFound).toEqual([]);
  });

  it('a category-unknown title matching several categorized profiles lists all of them as candidates, still unassigned', () => {
    const result = matchEvent({
      title: 'Youth Sports Programs - Game Night',
      activeProfiles: [hockeyGameCat, soccerGameCat],
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.reviewReason).toBe('category_unresolved');
    expect(result.profileId).toBeNull();
    expect(result.profileCandidates.map((c) => c.profileId).sort()).toEqual(['p-hockey-game', 'p-soccer-game']);
  });

  it('a category-unknown title that matches no profile at all (not even a categorized one) still falls through to ignore, unchanged', () => {
    const result = matchEvent({
      title: 'Random Soccer Programs Newsletter',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(result.outcome).toBe('ignore');
    expect(result.reviewReason).toBeNull();
    expect(result.profileCandidates).toEqual([]);
  });

  it('REGRESSION: existing U9MD/U11LL1 Hockey matching is completely unchanged by this fix', () => {
    const u9mdResult = matchEvent({
      title: 'U9MD - Game vs Wasaga Beach Stars',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(u9mdResult.outcome).toBe('auto_match');
    expect(u9mdResult.profileId).toBe('p-hockey-game');
    expect(u9mdResult.memberId).toBe(beckhamId);
    expect(u9mdResult.resolvedCategory).toBe('Hockey');

    const u11ll1Result = matchEvent({
      title: 'U11LL1 Practice',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });
    expect(u11ll1Result.outcome).toBe('auto_match');
    expect(u11ll1Result.profileId).toBe('p-hockey-practice');
    expect(u11ll1Result.memberId).toBe(theoId);
    expect(u11ll1Result.resolvedCategory).toBe('Hockey');
  });

  it('REGRESSION: the SAME profile set correctly auto-matches a real Hockey event and flags the real Soccer event for review, side by side', () => {
    const hockeyEvent = matchEvent({
      title: 'U9MD - Game vs Wasaga Beach Stars',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });
    const soccerEvent = matchEvent({
      title: '2026/27 Youth Sports Programs - Soccer Programs - Grasshoppers vs Sharks - Game',
      activeProfiles: hockeyOnlyProfiles,
      teamIdentifiers: hockeyOnlyIdentifiers,
      calendarGroupMemberId: null,
    });

    expect(hockeyEvent.outcome).toBe('auto_match');
    expect(hockeyEvent.profileId).toBe('p-hockey-game');

    expect(soccerEvent.outcome).toBe('needs_review');
    expect(soccerEvent.reviewReason).toBe('category_unresolved');
    expect(soccerEvent.profileId).toBeNull();
  });
});

describe('matchEvent — uncategorized Activity Profiles continue to work normally', () => {
  const familyOuting: MatchProfileCandidate = { id: 'p-family-outing', name: 'Family Outing', matchKeywords: ['Outing', 'Trip'], category: null };
  const gameNight: MatchProfileCandidate = { id: 'p-game-night', name: 'Game Night', matchKeywords: ['Game'], category: null };
  const hockeyGameCat: MatchProfileCandidate = { id: 'p-hockey-game', name: 'Hockey Game', matchKeywords: ['Game'], category: 'Hockey' };

  it('an uncategorized profile auto-matches a category-unknown title exactly as before category matching existed', () => {
    const result = matchEvent({
      title: 'Family Trip to the Cottage',
      activeProfiles: [familyOuting],
      teamIdentifiers: [],
      calendarGroupMemberId: 'member-1',
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-family-outing');
  });

  it('a household with no categories adopted anywhere is fully unaffected: ambiguity among uncategorized profiles still resolves the same way', () => {
    const ambiguousPair: MatchProfileCandidate = { id: 'p-game-night-2', name: 'Trivia Game Night', matchKeywords: ['Game'], category: null };
    const result = matchEvent({
      title: 'Game Night at the Community Center',
      activeProfiles: [gameNight, ambiguousPair],
      teamIdentifiers: [],
      calendarGroupMemberId: 'member-1',
    });
    // Both are uncategorized and both match "Game" with equal specificity —
    // this is an ordinary tie, nothing to do with category_unresolved.
    expect(result.outcome).toBe('needs_review');
    expect(result.reviewReason).toBe('ambiguous_profile');
  });

  it('mixed household: when a categorized profile and an uncategorized profile both match a category-unknown title, the uncategorized one wins — the categorized one is excluded, not merely outscored', () => {
    const result = matchEvent({
      title: 'Game Night',
      activeProfiles: [hockeyGameCat, gameNight],
      teamIdentifiers: [],
      calendarGroupMemberId: 'member-1',
    });
    expect(result.outcome).toBe('auto_match');
    expect(result.profileId).toBe('p-game-night');
    expect(result.profileCandidates.map((c) => c.profileId)).not.toContain('p-hockey-game');
  });
});
