/**
 * Pure decision logic for Activity Event Matching (Sports & Activity
 * Assistant, Phase 3). No I/O, no DB, no Date math — everything here is a
 * deterministic function of its inputs so Preview and Activate can share
 * the exact same engine and always agree.
 *
 * Three signals feed the decision, resolved independently and only
 * combined at the end:
 *  - which Activity Profile (if any) the title's words match
 *  - which family member(s) the event belongs to, via a configured team/
 *    calendar identifier found in the title, or the calendar's own owning
 *    member
 *  - which activity category (if any) the title's matched identifier(s)
 *    imply (e.g. "Hockey") — when exactly one resolves, it's an
 *    AUTHORITATIVE constraint on which profiles are even considered, so a
 *    generic phrase like "game" can never cross from one sport to another.
 *    See matchEvent's doc comment for the full category rules.
 * Ambiguity in any signal (or no activity-profile match at all, when the
 * title still looks like an activity) routes to `needs_review` rather than
 * guessing — this engine never silently resolves a tie.
 */

export interface MatchProfileCandidate {
  id: string;
  name: string;
  matchKeywords: string[];
  category: string | null;
}

export interface MatchTeamIdentifier {
  identifier: string;
  memberId: string;
  /**
   * Which sport/activity this identifier belongs to (e.g. "Hockey"),
   * compared against Activity Profiles' own category field. Null/omitted
   * means "no category context" — the conservative, backwards-compatible
   * default (see matchEvent).
   */
  category: string | null;
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
export type MatchReviewReason = 'unclassified' | 'ambiguous_profile' | 'ambiguous_member' | 'ambiguous_both' | 'ambiguous_category';

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
  /**
   * The single category resolved from this event's matched identifiers, if
   * exactly one distinct category was found — null when no identifier
   * carried a category, or when 2+ conflicted (see categoryCandidates).
   * Independent of memberId/memberCandidates: both are derived from the
   * same matched identifiers, but neither influences the other.
   */
  resolvedCategory: string | null;
  /** Every distinct category found among this event's matched identifiers (0, 1, or 2+ — 2+ means conflict). */
  categoryCandidates: string[];
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

interface CategoryContext {
  /** The single resolved category (original casing/spacing as configured), or null if none or conflicting. */
  resolved: string | null;
  /** True when 2+ distinct (normalized) categories were found among the matched identifiers. */
  conflict: boolean;
  /** Every distinct category found, original casing — for display/debugging, not matching. */
  candidates: string[];
}

/**
 * Resolves the category context from this event's matched identifiers only
 * (never from calendar-group ownership — there's no group->category signal
 * today). Distinctness is by normalized (case/whitespace-insensitive) text,
 * same as the equality check used to narrow profiles below; the first
 * original-cased spelling seen for each distinct value is kept for display.
 */
function resolveCategoryContext(identifierMatches: MatchTeamIdentifier[]): CategoryContext {
  const seen = new Map<string, string>();
  for (const m of identifierMatches) {
    if (!m.category) continue;
    const normalized = normalizeText(m.category);
    if (normalized.length === 0) continue;
    if (!seen.has(normalized)) seen.set(normalized, m.category);
  }
  const candidates = Array.from(seen.values());
  if (candidates.length === 0) return { resolved: null, conflict: false, candidates };
  if (candidates.length === 1) return { resolved: candidates[0]!, conflict: false, candidates };
  return { resolved: null, conflict: true, candidates };
}

/** True if a profile's category equals the resolved category, compared case/whitespace-insensitively. */
function categoryMatches(profileCategory: string | null, resolvedCategory: string): boolean {
  return profileCategory !== null && normalizeText(profileCategory) === normalizeText(resolvedCategory);
}

/**
 * Resolves the full decision for one event title. See the module doc for
 * the two-independent-signals design (profile vs. member); category is a
 * third signal, resolved from the same matched identifiers as member but
 * kept conceptually separate — it never changes memberId/memberCandidates,
 * and member resolution never changes it.
 *
 * Category behavior:
 *  - No identifier matched, or none of the matched identifiers carry a
 *    category -> no context; every active profile is a candidate, exactly
 *    as before this feature existed (backwards compatible default).
 *  - Exactly one distinct category resolved -> AUTHORITATIVE constraint:
 *    only profiles whose own category normalizes-equal to it are
 *    considered. There is no fallback to the full profile set if that
 *    narrows the candidates to zero — a title that matches a keyword on a
 *    profile outside the resolved category must never match it, and an
 *    empty candidate set after narrowing falls through to the normal "no
 *    profile match" handling below (ignore, or needs_review/unclassified
 *    when the title still looks like an activity).
 *  - 2+ distinct categories resolved (conflicting identifiers) ->
 *    needs_review/ambiguous_category immediately, profileId null. This is
 *    checked before any profile matching is attempted, since the category
 *    signal itself is unreliable.
 *
 * The branches below (unchanged from before this feature, now operating on
 * the category-narrowed candidate pool when one applies):
 *  - no profile match at all:
 *      - title contains a configured identifier -> needs_review/unclassified
 *      - otherwise -> ignore (no row should be created)
 *  - profile matched (unambiguous or not): needs_review if the profile is
 *    ambiguous and/or the member can't be resolved to exactly one person,
 *    otherwise auto_match.
 */
export function matchEvent(input: MatchInput): MatchResult {
  const identifierMatches = extractIdentifiers(input.title, input.teamIdentifiers);
  const identifierMemberIds = identifierMatches.map((m) => m.memberId);
  const allMembers = dedup([
    ...identifierMemberIds,
    ...(input.calendarGroupMemberId ? [input.calendarGroupMemberId] : []),
  ]);
  const memberCandidates = allMembers;
  const identifiersFound = identifierMatches.map((m) => m.identifier);
  const resolvedMemberId = allMembers.length === 1 ? allMembers[0]! : null;

  const categoryContext = resolveCategoryContext(identifierMatches);

  if (categoryContext.conflict) {
    // The category signal is unreliable, but still show what the title's
    // words alone would have matched (over every profile, unnarrowed) so a
    // human reviewing this has something to go on.
    const unnarrowedMatches = findMatchingProfiles(input.title, input.activeProfiles);
    return {
      outcome: 'needs_review',
      profileId: null,
      memberId: resolvedMemberId,
      matchStatus: 'needs_review',
      reviewReason: 'ambiguous_category',
      matchedPhrase: null,
      profileCandidates: unnarrowedMatches.map((m) => ({ profileId: m.profileId, matchedPhrase: m.matchedPhrase })),
      memberCandidates,
      identifiersFound,
      resolvedCategory: null,
      categoryCandidates: categoryContext.candidates,
    };
  }

  const candidateProfiles = categoryContext.resolved !== null
    ? input.activeProfiles.filter((p) => categoryMatches(p.category, categoryContext.resolved!))
    : input.activeProfiles;

  const profileMatches = findMatchingProfiles(input.title, candidateProfiles);
  const profileResolution = resolveProfileCandidate(profileMatches);

  const profileCandidates: ProfileCandidateResult[] = profileMatches.map((m) => ({
    profileId: m.profileId,
    matchedPhrase: m.matchedPhrase,
  }));

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
        resolvedCategory: categoryContext.resolved,
        categoryCandidates: categoryContext.candidates,
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
      resolvedCategory: categoryContext.resolved,
      categoryCandidates: categoryContext.candidates,
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
      resolvedCategory: categoryContext.resolved,
      categoryCandidates: categoryContext.candidates,
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
    resolvedCategory: categoryContext.resolved,
    categoryCandidates: categoryContext.candidates,
  };
}
