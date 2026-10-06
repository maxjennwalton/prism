'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { useFamily } from '@/components/providers';
import { CalendarColorPicker } from '../../components/CalendarColorPicker';
import { PrepStepsEditor, type DraftPrepStep } from './PrepStepsEditor';
import { GearChecklistEditor } from './GearChecklistEditor';
import { TimelinePreview } from './TimelinePreview';
import {
  fetchActivityProfileDetail,
  createPrepStepRequest,
  updatePrepStepRequest,
  deletePrepStepRequest,
  type ActivityProfileListItem,
  type ActivityProfileFormInput,
} from '@/lib/hooks/useActivityProfiles';
import type { ActivityGearItem } from '@/types';

interface EditorDraft {
  name: string;
  category: string;
  color: string;
  matchKeywords: string[];
  arrivalBufferMinutes: number | null;
  travelMinutes: number | null;
  defaultLocation: string;
  gearItems: ActivityGearItem[];
  prepSteps: DraftPrepStep[];
}

const EMPTY_DRAFT: EditorDraft = {
  name: '',
  category: '',
  color: '#3B82F6',
  matchKeywords: [],
  arrivalBufferMinutes: null,
  travelMinutes: null,
  defaultLocation: '',
  gearItems: [],
  prepSteps: [],
};

export function ActivityProfileEditorModal({
  profileId,
  onClose,
  onSaved,
}: {
  /** null = creating a new profile */
  profileId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { members } = useFamily();
  const [draft, setDraft] = useState<EditorDraft>(EMPTY_DRAFT);
  const [originalStepIds, setOriginalStepIds] = useState<Set<string>>(new Set());
  const [keywordInput, setKeywordInput] = useState('');
  const [loading, setLoading] = useState(Boolean(profileId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let active = true;
    fetchActivityProfileDetail(profileId)
      .then((detail) => {
        if (!active) return;
        setDraft({
          name: detail.name,
          category: detail.category ?? '',
          color: detail.color ?? '#3B82F6',
          matchKeywords: detail.matchKeywords,
          arrivalBufferMinutes: detail.arrivalBufferMinutes,
          travelMinutes: detail.travelMinutes,
          defaultLocation: detail.defaultLocation ?? '',
          gearItems: detail.gearItems,
          prepSteps: detail.prepSteps.map((s) => ({
            id: s.id,
            label: s.label,
            anchor: s.anchor,
            offsetMinutes: s.offsetMinutes,
            isCheckable: s.isCheckable,
            linksGear: s.linksGear,
            assignedMemberId: s.assignedMemberId,
          })),
        });
        setOriginalStepIds(new Set(detail.prepSteps.map((s) => s.id)));
      })
      .catch((err) => {
        toast({ title: err instanceof Error ? err.message : 'Failed to load activity profile', variant: 'destructive' });
        onClose();
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [profileId, onClose]);

  const familyMemberOptions = useMemo(
    () => members.map((m) => ({ id: m.id, name: m.name })),
    [members],
  );

  const addKeyword = () => {
    const kw = keywordInput.trim();
    if (!kw || draft.matchKeywords.includes(kw)) { setKeywordInput(''); return; }
    setDraft((d) => ({ ...d, matchKeywords: [...d.matchKeywords, kw] }));
    setKeywordInput('');
  };

  const removeKeyword = (kw: string) => {
    setDraft((d) => ({ ...d, matchKeywords: d.matchKeywords.filter((k) => k !== kw) }));
  };

  const handleSave = async () => {
    if (!draft.name.trim()) {
      toast({ title: 'Name is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const payload: ActivityProfileFormInput = {
        name: draft.name.trim(),
        category: draft.category.trim() || null,
        color: draft.color,
        matchKeywords: draft.matchKeywords,
        arrivalBufferMinutes: draft.arrivalBufferMinutes,
        travelMinutes: draft.travelMinutes,
        defaultLocation: draft.defaultLocation.trim() || null,
        gearItems: draft.gearItems.filter((g) => g.label.trim().length > 0),
      };

      const targetId = profileId ?? await (async () => {
        const res = await fetch('/api/activity-profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to create activity profile');
        const created = (await res.json()) as ActivityProfileListItem;
        return created.id;
      })();

      if (profileId) {
        const res = await fetch(`/api/activity-profiles/${profileId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Failed to update activity profile');
      }

      // Prep steps: the whole list is a staged draft until Save. Diff
      // against what was originally loaded (deletes), then persist every
      // remaining step with its final sortOrder (new -> POST, existing ->
      // PATCH). A handful of rows per profile, so a full re-save per step is
      // simpler and just as correct as fine-grained change tracking.
      const currentIds = new Set(draft.prepSteps.filter((s) => !s.id.startsWith('temp:')).map((s) => s.id));
      const toDelete = [...originalStepIds].filter((id) => !currentIds.has(id));
      await Promise.all(toDelete.map((id) => deletePrepStepRequest(targetId, id)));

      for (let index = 0; index < draft.prepSteps.length; index++) {
        const step = draft.prepSteps[index]!;
        const stepInput = {
          label: step.label.trim(),
          sortOrder: index,
          anchor: step.anchor,
          offsetMinutes: step.offsetMinutes,
          isCheckable: step.isCheckable,
          linksGear: step.linksGear,
          assignedMemberId: step.assignedMemberId,
        };
        if (!stepInput.label) continue;
        if (step.id.startsWith('temp:')) {
          await createPrepStepRequest(targetId, stepInput);
        } else {
          await updatePrepStepRequest(targetId, step.id, stepInput);
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to save activity profile', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const previewPrepSteps = draft.prepSteps
    .filter((s) => s.label.trim())
    .map((s) => ({ id: s.id, label: s.label, anchor: s.anchor, offsetMinutes: s.offsetMinutes, isCheckable: s.isCheckable }));

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-5xl max-h-[85vh] overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{profileId ? 'Edit Activity Profile' : 'Create Activity Profile'}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">Loading…</div>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timeline Preview</CardTitle>
                <CardDescription>Adjust the sample time to see how your timing settings play out. This is for preview only — nothing here is saved.</CardDescription>
              </CardHeader>
              <CardContent>
                <TimelinePreview
                  arrivalBufferMinutes={draft.arrivalBufferMinutes}
                  travelMinutes={draft.travelMinutes}
                  prepSteps={previewPrepSteps}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Basic Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <CalendarColorPicker color={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="ap-name">Profile name</Label>
                    <Input id="ap-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. Hockey Practice" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ap-category">Category (optional)</Label>
                  <Input id="ap-category" value={draft.category} onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} placeholder="e.g. Hockey" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Automatic Matching</CardTitle>
                <CardDescription>
                  These phrases will eventually help Prism recognize matching calendar events automatically — you&apos;ll always be able to review and correct every match. This isn&apos;t active yet; for now it just saves your keywords.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={keywordInput}
                    onChange={(e) => setKeywordInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addKeyword(); } }}
                    placeholder="e.g. hockey practice"
                  />
                  <Button type="button" variant="outline" onClick={addKeyword}><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {draft.matchKeywords.map((kw) => (
                    <Badge key={kw} variant="secondary" className="gap-1">
                      {kw}
                      <button onClick={() => removeKeyword(kw)} aria-label={`Remove ${kw}`}><X className="h-3 w-3" /></button>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Timing</CardTitle>
                <CardDescription>All optional — nothing is assumed until you set it.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm">Arrive</span>
                  <Input
                    type="number" min={0} max={1440} className="w-20"
                    value={draft.arrivalBufferMinutes ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, arrivalBufferMinutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }))}
                  />
                  <span className="text-sm">minutes before the event</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">Usually takes</span>
                  <Input
                    type="number" min={0} max={1440} className="w-20"
                    value={draft.travelMinutes ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, travelMinutes: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) }))}
                  />
                  <span className="text-sm">minutes to get there</span>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ap-location">Default location (optional)</Label>
                  <Input id="ap-location" value={draft.defaultLocation} onChange={(e) => setDraft((d) => ({ ...d, defaultLocation: e.target.value }))} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Preparation Steps</CardTitle>
              </CardHeader>
              <CardContent>
                <PrepStepsEditor
                  steps={draft.prepSteps}
                  onChange={(prepSteps) => setDraft((d) => ({ ...d, prepSteps }))}
                  familyMembers={familyMemberOptions}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Gear</CardTitle>
              </CardHeader>
              <CardContent>
                <GearChecklistEditor
                  items={draft.gearItems}
                  onChange={(gearItems) => setDraft((d) => ({ ...d, gearItems }))}
                />
              </CardContent>
            </Card>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>{saving ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
