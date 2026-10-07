'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useFamily } from '@/components/providers';
import { useActivityTeamIdentifiers, type ActivityTeamIdentifier } from '@/lib/hooks/useActivityTeamIdentifiers';
import { useActivityProfiles } from '@/lib/hooks/useActivityProfiles';

interface DraftRow {
  /** Local-only React list key — never sent to the server. */
  key: string;
  identifier: string;
  memberId: string | null;
  category: string;
}

const CATEGORY_SUGGESTIONS_LIST_ID = 'activity-identifier-category-suggestions';

function toDraftRows(identifiers: ActivityTeamIdentifier[]): DraftRow[] {
  return identifiers.map((i) => ({
    key: crypto.randomUUID(),
    identifier: i.identifier,
    memberId: i.memberId,
    category: i.category ?? '',
  }));
}

/**
 * Maps team codes / calendar tags (e.g. "U9MD", "Smith") to the family
 * member they belong to, and optionally to an activity category (e.g.
 * "Hockey"). Lives in Activity Profiles Settings, not Family Members,
 * because it is matching configuration, not a member attribute — one
 * member can have several identifiers, and identifiers only matter in the
 * context of activity matching.
 *
 * Category is optional: a household with only one sport never needs it.
 * Once configured, it becomes an authoritative constraint on matching for
 * that identifier's events — see activityMatcher.ts.
 */
export function TeamIdentifiersEditor() {
  const { members } = useFamily();
  const { identifiers, loading, saveIdentifiers } = useActivityTeamIdentifiers();
  const { profiles } = useActivityProfiles();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Existing profile categories, offered as suggestions (not a fixed list —
  // free text is still allowed, so a category can be set up here before its
  // first Activity Profile exists).
  const categorySuggestions = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const p of profiles) {
      const trimmed = p.category?.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(trimmed);
    }
    return result;
  }, [profiles]);

  useEffect(() => {
    if (!loading) {
      setRows(toDraftRows(identifiers));
      setDirty(false);
    }
    // Only re-sync from the server on load/refresh, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const addRow = () => {
    setRows((prev) => [...prev, { key: crypto.randomUUID(), identifier: '', memberId: null, category: '' }]);
    setDirty(true);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setDirty(true);
  };

  const handleSave = async () => {
    const trimmed = rows
      .map((r) => ({ identifier: r.identifier.trim(), memberId: r.memberId, category: r.category.trim() || null }))
      .filter((r): r is ActivityTeamIdentifier => r.identifier.length > 0 && Boolean(r.memberId));

    const seen = new Set<string>();
    for (const r of trimmed) {
      const key = r.identifier.toLowerCase();
      if (seen.has(key)) {
        toast({
          title: `"${r.identifier}" is listed more than once`,
          description: 'Each identifier can only map to one family member.',
          variant: 'destructive',
        });
        return;
      }
      seen.add(key);
    }

    setSaving(true);
    try {
      await saveIdentifiers(trimmed);
      setDirty(false);
      toast({ title: 'Team & calendar identifiers saved' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to save identifiers', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Team &amp; Calendar Identifiers</h3>
        <p className="text-sm text-muted-foreground">
          Map the team codes or calendar tags your activity calendars use (like &quot;U9MD&quot; or &quot;Smith&quot;) to the
          family member they belong to. Add a category (like &quot;Hockey&quot;) when the same phrase — &quot;game&quot;,
          &quot;practice&quot; — is used for more than one sport, so matching knows which profiles to consider.
        </p>
      </div>

      <datalist id={CATEGORY_SUGGESTIONS_LIST_ID}>
        {categorySuggestions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex flex-wrap items-center gap-2">
            <Input
              value={row.identifier}
              onChange={(e) => updateRow(row.key, { identifier: e.target.value })}
              placeholder="e.g. U9MD"
              className="w-40"
              aria-label="Identifier"
            />
            <span className="text-sm text-muted-foreground shrink-0">&rarr;</span>
            <Select value={row.memberId ?? undefined} onValueChange={(v) => updateRow(row.key, { memberId: v })}>
              <SelectTrigger className="w-44" aria-label="Family member">
                <SelectValue placeholder="Select a member" />
              </SelectTrigger>
              <SelectContent>
                {members.filter((m) => m.id).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground shrink-0">&rarr;</span>
            <Input
              value={row.category}
              onChange={(e) => updateRow(row.key, { category: e.target.value })}
              placeholder="Category (optional)"
              className="w-44"
              aria-label="Category"
              list={CATEGORY_SUGGESTIONS_LIST_ID}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeRow(row.key)}
              className="text-destructive shrink-0"
              aria-label="Remove identifier"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No identifiers yet — add one for each team code or calendar tag you want matching to recognize.
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add identifier
        </Button>
        <Button type="button" size="sm" onClick={handleSave} disabled={!dirty || saving}>
          <Save className="h-4 w-4 mr-1.5" />
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
