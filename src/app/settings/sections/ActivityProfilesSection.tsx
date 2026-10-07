'use client';

import { useState } from 'react';
import { Plus, Pencil, Copy, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useConfirmDialog } from '@/lib/hooks/useConfirmDialog';
import { RemovedItemsManager } from '@/components/settings/RemovedItemsManager';
import { useActivityProfiles, type ActivityProfileListItem } from '@/lib/hooks/useActivityProfiles';
import { ActivityProfileEditorModal } from './activityProfiles/ActivityProfileEditorModal';
import { ActivityMatchingCard } from './activityProfiles/ActivityMatchingCard';

function summaryLine(p: ActivityProfileListItem): string {
  const parts: string[] = [];
  if (p.category) parts.push(p.category);
  parts.push(`${p.matchKeywordCount} keyword${p.matchKeywordCount === 1 ? '' : 's'}`);
  parts.push(p.arrivalBufferMinutes != null ? `Arrive ${p.arrivalBufferMinutes}m early` : 'Arrival not set');
  parts.push(p.travelMinutes != null ? `~${p.travelMinutes}m travel` : 'Travel not set');
  parts.push(`${p.prepStepCount} step${p.prepStepCount === 1 ? '' : 's'}`);
  parts.push(`${p.gearItemCount} gear item${p.gearItemCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

export function ActivityProfilesSection() {
  const { profiles: active, refresh: refreshActive, archiveProfile, duplicateProfile } = useActivityProfiles();
  const { profiles: archived, refresh: refreshArchived, restoreProfile } = useActivityProfiles({ includeArchived: true });
  const archivedOnly = archived.filter((p) => p.archived);

  const [editingId, setEditingId] = useState<string | null | undefined>(undefined); // undefined = closed, null = new
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();

  const refreshAll = async () => { await Promise.all([refreshActive(), refreshArchived()]); };

  const handleArchive = async (p: ActivityProfileListItem) => {
    if (!await confirm(`Archive "${p.name}"?`, 'You can restore it later from the archived list below.')) return;
    try {
      await archiveProfile(p.id);
      await refreshAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to archive profile', variant: 'destructive' });
    }
  };

  const handleRestore = async (id: string) => {
    setRestoringId(id);
    try {
      await restoreProfile(id);
      await refreshAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to restore profile', variant: 'destructive' });
    } finally {
      setRestoringId(null);
    }
  };

  const handleDuplicate = async (p: ActivityProfileListItem) => {
    try {
      await duplicateProfile(p.id);
      await refreshAll();
      toast({ title: `Duplicated "${p.name}"` });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to duplicate profile', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <ActivityMatchingCard />

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Activity Profiles</h2>
          <p className="text-muted-foreground">
            Reusable templates for sports and activities — timing, preparation steps, and gear you set up once and reuse.
          </p>
        </div>
        <Button onClick={() => setEditingId(null)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Profile
        </Button>
      </div>

      <div className="space-y-3">
        {active.filter((p) => !p.archived).map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: p.color ?? '#9CA3AF' }} />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{p.name}</span>
                    <Badge variant="default">Active</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{summaryLine(p)}</div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" onClick={() => setEditingId(p.id)} aria-label="Edit profile">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleDuplicate(p)} aria-label="Duplicate profile">
                  <Copy className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => handleArchive(p)} className="text-destructive" aria-label="Archive profile">
                  <Archive className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}

        {active.filter((p) => !p.archived).length === 0 && (
          <p className="text-sm text-muted-foreground">No activity profiles yet. Create one for each sport or activity your family does regularly.</p>
        )}
      </div>

      <RemovedItemsManager
        title="Archived profiles"
        description="Profiles you've archived. Restore one to make it reusable again."
        items={archivedOnly.map((p) => ({ id: p.id, name: p.name }))}
        onRestore={handleRestore}
        restoringId={restoringId}
      />

      {editingId !== undefined && (
        <ActivityProfileEditorModal
          profileId={editingId}
          onClose={() => setEditingId(undefined)}
          onSaved={refreshAll}
        />
      )}

      <ConfirmDialog {...confirmDialogProps} />
    </div>
  );
}
