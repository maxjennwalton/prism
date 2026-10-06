'use client';

import { useCallback } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDragReorder } from '@/lib/hooks/useDragReorder';
import { PREP_STEP_ANCHORS, PREP_STEP_ANCHOR_LABELS, type PrepStepAnchor } from '@/lib/constants/activityProfiles';

export interface DraftPrepStep {
  id: string;
  label: string;
  anchor: PrepStepAnchor;
  offsetMinutes: number;
  isCheckable: boolean;
  linksGear: boolean;
  assignedMemberId: string | null;
}

interface FamilyMemberOption {
  id: string;
  name: string;
}

/**
 * Add/reorder/edit/remove preparation steps for an Activity Profile.
 * Every control is phrased in plain language — no "anchor"/"offsetMinutes"
 * shown anywhere — e.g. "Get dressed — 30 minutes before Leave Home".
 */
export function PrepStepsEditor({
  steps,
  onChange,
  familyMembers,
}: {
  steps: DraftPrepStep[];
  onChange: (steps: DraftPrepStep[]) => void;
  familyMembers: FamilyMemberOption[];
}) {
  const ids = steps.map((s) => s.id);

  const applyReorder = useCallback((newOrder: string[]) => {
    const byId = new Map(steps.map((s) => [s.id, s]));
    onChange(newOrder.map((id) => byId.get(id)!));
  }, [steps, onChange]);

  const { draggedId, getDragProps, moveUp, moveDown } = useDragReorder({ order: ids, onReorder: applyReorder });

  const addStep = () => {
    onChange([
      ...steps,
      {
        id: `temp:${crypto.randomUUID()}`,
        label: '',
        anchor: 'leave_home',
        offsetMinutes: 15,
        isCheckable: true,
        linksGear: false,
        assignedMemberId: null,
      },
    ]);
  };

  const updateStep = (id: string, patch: Partial<DraftPrepStep>) => {
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeStep = (id: string) => {
    onChange(steps.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-3">
      {steps.map((step, index) => (
        <div
          key={step.id}
          {...getDragProps(step.id)}
          className={cn(
            'rounded-md border border-border bg-card p-3 touch-none space-y-2.5',
            draggedId === step.id && 'opacity-50 scale-[0.98] ring-2 ring-primary/50',
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-center gap-0.5 shrink-0 pt-1 cursor-grab active:cursor-grabbing">
              <Button variant="ghost" size="icon" className="h-5 w-5" disabled={index === 0} onClick={() => moveUp(step.id)} aria-label="Move up">
                <ChevronUp className="h-3 w-3" />
              </Button>
              <GripVertical className="h-3 w-3 text-muted-foreground/50" />
              <Button variant="ghost" size="icon" className="h-5 w-5" disabled={index === steps.length - 1} onClick={() => moveDown(step.id)} aria-label="Move down">
                <ChevronDown className="h-3 w-3" />
              </Button>
            </div>

            <div className="flex-1 min-w-0 space-y-2.5">
              <Input
                value={step.label}
                onChange={(e) => updateStep(step.id, { label: e.target.value })}
                placeholder="e.g. Get dressed"
              />

              {/* Human-readable sentence: "[30] minutes before [Leave Home]" */}
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  value={step.offsetMinutes}
                  onChange={(e) => updateStep(step.id, { offsetMinutes: Math.max(0, Number(e.target.value) || 0) })}
                  className="w-20"
                  aria-label="Minutes before"
                />
                <span>minutes before</span>
                <Select value={step.anchor} onValueChange={(v) => updateStep(step.id, { anchor: v as PrepStepAnchor })}>
                  <SelectTrigger className="w-40" aria-label="Milestone">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PREP_STEP_ANCHORS.map((a) => (
                      <SelectItem key={a} value={a}>{PREP_STEP_ANCHOR_LABELS[a]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-0.5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={step.isCheckable} onCheckedChange={(v) => updateStep(step.id, { isCheckable: v })} />
                  {step.isCheckable ? 'Checkable action' : 'Informational note only'}
                </label>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={step.linksGear} onCheckedChange={(v) => updateStep(step.id, { linksGear: v === true })} />
                  Links to gear checklist
                </label>

                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground whitespace-nowrap">Usually done by:</span>
                  <Select
                    value={step.assignedMemberId ?? 'none'}
                    onValueChange={(v) => updateStep(step.id, { assignedMemberId: v === 'none' ? null : v })}
                  >
                    <SelectTrigger className="w-52" aria-label="Usually done by">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not assigned</SelectItem>
                      {familyMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <Button variant="ghost" size="icon" onClick={() => removeStep(step.id)} className="text-destructive shrink-0" aria-label="Remove step">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addStep}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add preparation step
      </Button>

      {steps.length === 0 && (
        <p className="text-xs text-muted-foreground">No steps yet — add what needs to happen before you leave, like getting dressed or packing the bag.</p>
      )}
    </div>
  );
}
