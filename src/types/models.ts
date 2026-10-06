import type { DayOfWeek } from '@/lib/constants/days';
export type { DayOfWeek };
import type { PrepStepAnchor } from '@/lib/constants/activityProfiles';
export type { PrepStepAnchor };

export interface FamilyMember {
  id: string;
  /** Ordinal position in the sorted member list. Present in unauthenticated context; id will be ''. */
  loginIndex?: number;
  name: string;
  color: string;
  avatarUrl?: string | null;
  role?: 'parent' | 'child' | 'guest';
  hasPin?: boolean;
  /** Number of digits this member's PIN pad requires (4/5/6). Not sensitive — exposed even unauthenticated. */
  pinLength?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  dueDate?: Date;
  priority: 'high' | 'medium' | 'low';
  category?: string;
  completedAt?: string | null;
  source?: string;
  listId?: string | null;
  taskSourceId?: string | null;
  assignedTo?: {
    id: string;
    name: string;
    color: string;
    avatarUrl?: string | null;
  };
  createdAt?: string | Date;
  updatedAt?: string;
}

export interface Chore {
  id: string;
  title: string;
  description?: string;
  category: 'cleaning' | 'laundry' | 'dishes' | 'yard' | 'pets' | 'trash' | 'other';
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semi-annually' | 'annually' | 'custom';
  customIntervalDays?: number;
  startDay?: string | null;
  lastCompleted?: Date | string;
  nextDue?: string;
  /** Optional HH:mm time-of-day; null/undefined → floats above the time grid. */
  nextDueTime?: string | null;
  enabled: boolean;
  requiresApproval: boolean;
  pointValue: number;
  assignedTo?: {
    id: string;
    name: string;
    color: string;
    avatarUrl?: string | null;
  };
  createdAt: Date | string;
  updatedAt?: string;
  pendingApproval?: {
    completionId: string;
    completedAt: string;
    completedBy: {
      id: string;
      name: string;
      color: string;
    };
  };
}

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
  checked: boolean;
  notes?: string;
  addedBy?: {
    id: string;
    name: string;
    color: string;
  };
  source?: string;
  /** Kroger productId cached from the last "Send to Kroger" pick. */
  krogerProductId?: string | null;
  createdAt: Date | string;
}

export interface ShoppingList {
  id: string;
  name: string;
  description?: string;
  icon?: string | null;
  color?: string | null;
  listType?: 'grocery' | 'hardware' | 'general' | 'other';
  visibleCategories?: string[] | null;
  sortOrder: number;
  assignedTo?: string;
  items: ShoppingItem[];
  createdBy?: {
    id: string;
    name: string;
    color: string;
  };
  createdAt: Date | string;
}

export interface WishItem {
  id: string;
  memberId: string;
  name: string;
  url?: string | null;
  notes?: string | null;
  sortOrder: number;
  claimed: boolean;
  claimedBy?: { id: string; name: string; color: string } | null;
  claimedAt?: string | null;
  addedBy?: { id: string; name: string; color: string } | null;
  createdAt: string;
}

export interface GiftIdea {
  id: string;
  createdBy: { id: string; name: string; color: string };
  forUserId: string;
  forUser: { id: string; name: string; color: string };
  name: string;
  url?: string | null;
  notes?: string | null;
  price?: string | null;
  purchased: boolean;
  purchasedAt?: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface Meal {
  id: string;
  name: string;
  description?: string | null;
  recipe?: string | null;
  recipeUrl?: string | null;
  recipeId?: string | null;
  prepTime?: number | null;
  cookTime?: number | null;
  servings?: number | null;
  ingredients?: string | null;
  weekOf: string;
  /** Absolute calendar date (YYYY-MM-DD). Stable across "week starts on"
   *  changes; the week views query/filter by this. */
  date?: string;
  dayOfWeek: DayOfWeek;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  /** Optional HH:mm time-of-day for time-grid placement; null/undefined → default by mealType. */
  mealTime?: string | null;
  cookedAt?: Date | string | null;
  cookedBy?: { id: string; name: string; color: string } | null;
  createdBy?: { id: string; name: string; color: string } | null;
  createdAt: Date | string;
}

// ============================================================================
// Sports & Activity Assistant — Activity Profiles (Phase 1: data model only)
// ============================================================================

/** One entry in an ActivityProfile's reusable gear checklist template. */
export interface ActivityGearItem {
  id: string;
  label: string;
  sortOrder: number;
}

/** A reusable activity template (e.g. "Hockey Practice"), shared across whichever family members do that activity. */
export interface ActivityProfile {
  id: string;
  name: string;
  category?: string | null;
  color?: string | null;
  /** Title keywords used for automatic event matching (a later phase). */
  matchKeywords: string[];
  /** Minutes to arrive before the event starts. Null until configured — never assumed. */
  arrivalBufferMinutes: number | null;
  /** Manual v1 travel-time estimate in minutes. Null until configured. */
  travelMinutes: number | null;
  defaultLocation?: string | null;
  gearItems: ActivityGearItem[];
  archived: boolean;
  createdBy?: { id: string; name: string; color: string } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** An ordered, reusable preparation step belonging to an ActivityProfile. */
export interface ActivityProfilePrepStep {
  id: string;
  activityProfileId: string;
  label: string;
  sortOrder: number;
  /** Which system-calculated milestone this step's offset counts back from. */
  anchor: PrepStepAnchor;
  /** Minutes before the anchor this step happens. */
  offsetMinutes: number;
  /** true = a checkable action; false = an informational milestone marker only. */
  isCheckable: boolean;
  /** UI affordance only — marks this as "the gear-packing step"; does not drive gear-completion state. */
  linksGear: boolean;
  assignedMember?: { id: string; name: string; color: string } | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * One matched event OCCURRENCE — links Prism's local copy of a synced
 * calendar event to an ActivityProfile, with per-occurrence overrides. Never
 * written back to the synced event itself.
 */
export interface ActivityEventLink {
  id: string;
  eventId: string;
  /** Null means a human confirmed "this is not an activity". */
  activityProfileId: string | null;
  assignedMember?: { id: string; name: string; color: string } | null;
  /** Reserved for a future driver/parent-assignment feature — unused in Phase 1. */
  responsibleAdult?: { id: string; name: string; color: string } | null;
  /** Null = inherit the profile's value. */
  arrivalBufferMinutesOverride: number | null;
  travelMinutesOverride: number | null;
  locationOverride?: string | null;
  /** true until a human edits anything on this row. */
  autoMatched: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Per-occurrence checked state for one gear item, so checking "helmet" for one practice never checks it for another. */
export interface ActivityGearCompletion {
  id: string;
  activityEventLinkId: string;
  gearItemId: string;
  checked: boolean;
  checkedBy?: { id: string; name: string; color: string } | null;
  checkedAt?: Date | string | null;
  createdAt: Date | string;
}
