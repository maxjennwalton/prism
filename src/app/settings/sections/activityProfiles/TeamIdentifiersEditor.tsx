'use client';

import { useEffect, useState } from 'react';
import { Plus, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
import { useFamily } from '@/components/providers';
import { useActivityTeamIdentifiers, type ActivityTeamIdentifier } from '@/lib/hooks/useActivityTeamIdentifiers';

interface DraftRow {
  /** Local-only React list key — never sent to the server. */
  key: string;
  identifier: string;
  memberId: string | null;
}

function toDraftRows(identifiers: ActivityTeamIdentifier[]): DraftRow[] {
  return identifiers.map((i) => ({ key: crypto.randomUUID(), identifier: i.identifier, memberId: i.memberId }));
}

/**
 * Maps team codes / calendar tags (e.g. "U9MD", "Smith") to the family
 * member they belong to. Lives in Activity Profiles Settings, not Family
 * Members, because it is matching configuration, not a member attribute —
 * one member can have several identifiers, and identifiers only matter in
 * the context of activity matching.
 */
export function TeamIdentifiersEditor() {
  const { members } = useFamily();
  const { identifiers, loading, saveIdentifiers } = useActivityTeamIdentifiers();
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setRows((prev) => [...prev, { key: crypto.randomUUID(), identifier: '', memberId: null }]);
    setDirty(true);
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setDirty(true);
  };

  const handleSave = async () => {
    const trimmed = rows
      .map((r) => ({ identifier: r.identifier.trim(), memberId: r.memberId }))
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
          family member they belong to. Matching uses this to figure out who an event is for.
        </p>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-2">
            <Input
              value={row.identifier}
              onChange={(e) => updateRow(row.key, { identifier: e.target.value })}
              placeholder="e.g. U9MD"
              className="w-40"
              aria-label="Identifier"
            />
            <span className="text-sm text-muted-foreground shrink-0">&rarr;</span>
            <Select value={row.memberId ?? undefined} onValueChange={(v) => updateRow(row.key, { memberId: v })}>
              <SelectTrigger className="w-52" aria-label="Family member">
                <SelectValue placeholder="Select a member" />
              </SelectTrigger>
              <SelectContent>
                {members.filter((m) => m.id).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
