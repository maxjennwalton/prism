/**
 * Pure decision logic for Activity Event Matching (Sports & Activity
 * Assistant, Phase 3). No I/O, no DB, no Date math — everything here is a
 * deterministic function of its inputs so Preview and Activate can share
 * the exact same engine and always agree.
 *
 * Two signals are resolved completely independently and only combined at
 * the end:
 *  - which Activity Profile (if any) the title's words match
 *  - which family member(s) the event belongs to, via a configured team/
 *    calendar identifier found in the title, or the calendar's own owning
 *    member
 * Ambiguity in either signal (or no activity-profile match at all, when the
 * title still looks like an activity) routes to `needs_review` rather than
 * guessing — this engine never silently resolves a tie.
 */

export interface MatchProfileCandidate {
  id: string;
  name: string;
  matchKeywords: string[];
}

export interface MatchTeamIdentifier {
  identifier: string;
  memberId: string;
}

export interface MatchInput {
  title: string;
  /** Active (non-archived) profiles only — callers must filter before calling. */
  activeProfiles: MatchProfileCandidate[];
  teamIdentifiers: MatchTeamIdentifier[];
  /** The member who owns the calendar/group this event came from, if any. */
  calendarGroupMemberId: string | null;
}

export type MatchOutcome = 'auto_match' | 'needs_review' | 'ignore';
export type MatchStatus = 'auto_confirmed' | 'needs_review';
export type MatchReviewReason = 'unclassified' | 'ambiguous_profile' | 'ambiguous_member' | 'ambiguous_both';

export interface ProfileCandidateResult {
  profileId: string;
  matchedPhrase: string;
}

export interface MatchResult {
  outcome: MatchOutcome;
  profileId: string | null;
  memberId: string | null;
  matchStatus: MatchStatus | null;
  reviewReason: MatchReviewReason | null;
  matchedPhrase: string | null;
  profileCandidates: ProfileCandidateResult[];
  memberCandidates: string[];
  identifiersFound: string[];
}

/** Lowercase, punctuation/hyphens/& collapsed to spaces, whitespace collapsed. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeToTokens(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.length > 0 ? normalized.split(' ') : [];
}

/** True if `phraseTokens` appears as a contiguous run within `titleTokens`. */
export function phraseMatchesTitle(phraseTokens: string[], titleTokens: string[]): boolean {
  if (phraseTokens.length === 0 || phraseTokens.length > titleTokens.length) return false;
  for (let start = 0; start <= titleTokens.length - phraseTokens.length; start++) {
    let matched = true;
    for (let i = 0; i < phraseTokens.length; i++) {
      if (titleTokens[start + i] !== phraseTokens[i]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

interface ProfileMatch {
  profileId: string;
  matchedPhrase: string;
  specificity: number;
}

/**
 * For each profile, finds its best (highest-specificity, i.e. most tokens)
 * matching keyword. A profile with several matching keywords contributes
 * only that one best match — specificity ties are only ever compared
 * *across* profiles, never within one.
 */
export function findMatchingProfiles(title: string, activeProfiles: MatchProfileCandidate[]): ProfileMatch[] {
  const titleTokens = normalizeToTokens(title);
  const matches: ProfileMatch[] = [];

  for (const profile of activeProfiles) {
    let best: { phrase: string; specificity: number } | null = null;
    for (const keyword of profile.matchKeywords) {
      const phraseTokens = normalizeToTokens(keyword);
      if (phraseTokens.length === 0) continue;
      if (!phraseMatchesTitle(phraseTokens, titleTokens)) continue;
      if (best === null || phraseTokens.length > best.specificity) {
        best = { phrase: keyword, specificity: phraseTokens.length };
      }
    }
    if (best !== null) {
      matches.push({ profileId: profile.id, matchedPhrase: best.phrase, specificity: best.specificity });
    }
  }

  return matches;
}

interface ProfileResolution {
  /** Null when there's no match, or when 2+ profiles tie at the highest specificity. */
  winner: ProfileMatch | null;
}

/**
 * 0 matches -> no winner (not ambiguous, just nothing).
 * 1 match -> that's the winner, however generic its keyword.
 * 2+ matches -> the strictly-highest-specificity match wins outright; a tie
 * at the top specificity is ambiguous (winner: null).
 */
export function resolveProfileCandidate(matches: ProfileMatch[]): ProfileResolution {
  if (matches.length === 0) return { winner: null };
  if (matches.length === 1) return { winner: matches[0]! };

  const maxSpecificity = Math.max(...matches.map((m) => m.specificity));
  const atMax = matches.filter((m) => m.specificity === maxSpecificity);
  return { winner: atMax.length === 1 ? atMax[0]! : null };
}

/**
 * Literal, token-boundary lookup of every configured identifier that
 * appears in the title. Built via a Map keyed by identifier text so a
 * technically-duplicate identifier list (same text, different member) is
 * still handled deterministically (last entry wins) even though the
 * Settings UI is expected to prevent that case at save time.
 */
export function extractIdentifiers(title: string, teamIdentifiers: MatchTeamIdentifier[]): MatchTeamIdentifier[] {
  const titleTokens = normalizeToTokens(title);
  const byIdentifier = new Map<string, MatchTeamIdentifier>();
  for (const entry of teamIdentifiers) {
    byIdentifier.set(entry.identifier, entry);
  }

  const found: MatchTeamIdentifier[] = [];
  for (const entry of byIdentifier.values()) {
    const phraseTokens = normalizeToTokens(entry.identifier);
    if (phraseTokens.length === 0) continue;
    if (phraseMatchesTitle(phraseTokens, titleTokens)) {
      found.push(entry);
    }
  }
  return found;
}

function dedup(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

/**
 * Resolves the full decision for one event title. See the module doc for
 * the two-independent-signals design; the branches below are:
 *  - no profile match at all:
 *      - title contains a configured identifier -> needs_review/unclassified
 *      - otherwise -> ignore (no row should be created)
 *  - profile matched (unambiguous or not): needs_review if the profile is
 *    ambiguous and/or the member can't be resolved to exactly one person,
 *    otherwise auto_match.
 */
export function matchEvent(input: MatchInput): MatchResult {
  const profileMatches = findMatchingProfiles(input.title, input.activeProfiles);
  const profileResolution = resolveProfileCandidate(profileMatches);

  const identifierMatches = extractIdentifiers(input.title, input.teamIdentifiers);
  const identifierMemberIds = identifierMatches.map((m) => m.memberId);
  const allMembers = dedup([
    ...identifierMemberIds,
    ...(input.calendarGroupMemberId ? [input.calendarGroupMemberId] : []),
  ]);

  const profileCandidates: ProfileCandidateResult[] = profileMatches.map((m) => ({
    profileId: m.profileId,
    matchedPhrase: m.matchedPhrase,
  }));
  const memberCandidates = allMembers;
  const identifiersFound = identifierMatches.map((m) => m.identifier);
  const resolvedMemberId = allMembers.length === 1 ? allMembers[0]! : null;

  if (profileMatches.length === 0) {
    const potentialActivity = identifierMatches.length > 0;
    if (!potentialActivity) {
      return {
        outcome: 'ignore',
        profileId: null,
        memberId: null,
        matchStatus: null,
        reviewReason: null,
        matchedPhrase: null,
        profileCandidates,
        memberCandidates,
        identifiersFound,
      };
    }
    return {
      outcome: 'needs_review',
      profileId: null,
      memberId: resolvedMemberId,
      matchStatus: 'needs_review',
      reviewReason: 'unclassified',
      matchedPhrase: null,
      profileCandidates,
      memberCandidates,
      identifiersFound,
    };
  }

  const profileAmbiguous = profileResolution.winner === null;
  const memberUnresolved = allMembers.length !== 1;

  if (profileAmbiguous || memberUnresolved) {
    const reviewReason: MatchReviewReason =
      profileAmbiguous && memberUnresolved ? 'ambiguous_both' : profileAmbiguous ? 'ambiguous_profile' : 'ambiguous_member';
    return {
      outcome: 'needs_review',
      profileId: profileAmbiguous ? null : profileResolution.winner!.profileId,
      memberId: resolvedMemberId,
      matchStatus: 'needs_review',
      reviewReason,
      matchedPhrase: profileAmbiguous ? null : profileResolution.winner!.matchedPhrase,
      profileCandidates,
      memberCandidates,
      identifiersFound,
    };
  }

  return {
    outcome: 'auto_match',
    profileId: profileResolution.winner!.profileId,
    memberId: allMembers[0]!,
    matchStatus: 'auto_confirmed',
    reviewReason: null,
    matchedPhrase: profileResolution.winner!.matchedPhrase,
    profileCandidates,
    memberCandidates,
    identifiersFound,
  };
}
