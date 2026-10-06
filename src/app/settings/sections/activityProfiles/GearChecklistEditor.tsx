'use client';

import { useCallback } from 'react';
import { GripVertical, ChevronUp, ChevronDown, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDragReorder } from '@/lib/hooks/useDragReorder';
import type { ActivityGearItem } from '@/types';

/**
 * Reorderable, reusable gear checklist editor for an Activity Profile.
 * Purely a controlled list of { id, label, sortOrder } — nothing here is
 * seeded; a brand-new profile starts with an empty list.
 */
export function GearChecklistEditor({
  items,
  onChange,
}: {
  items: ActivityGearItem[];
  onChange: (items: ActivityGearItem[]) => void;
}) {
  const ids = items.map((i) => i.id);

  const applyReorder = useCallback((newOrder: string[]) => {
    const byId = new Map(items.map((i) => [i.id, i]));
    onChange(newOrder.map((id, index) => ({ ...byId.get(id)!, sortOrder: index })));
  }, [items, onChange]);

  const { draggedId, getDragProps, moveUp, moveDown } = useDragReorder({ order: ids, onReorder: applyReorder });

  const addItem = () => {
    onChange([...items, { id: crypto.randomUUID(), label: '', sortOrder: items.length }]);
  };

  const updateLabel = (id: string, label: string) => {
    onChange(items.map((i) => (i.id === id ? { ...i, label } : i)));
  };

  const removeItem = (id: string) => {
    onChange(items.filter((i) => i.id !== id).map((i, index) => ({ ...i, sortOrder: index })));
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={item.id}
          {...getDragProps(item.id)}
          className={cn(
            'flex items-center gap-2 rounded-md border border-border bg-card p-2 touch-none',
            draggedId === item.id && 'opacity-50 scale-[0.98] ring-2 ring-primary/50',
          )}
        >
          <div className="flex flex-col items-center gap-0.5 shrink-0 cursor-grab active:cursor-grabbing">
            <Button variant="ghost" size="icon" className="h-5 w-5" disabled={index === 0} onClick={() => moveUp(item.id)} aria-label="Move up">
              <ChevronUp className="h-3 w-3" />
            </Button>
            <GripVertical className="h-3 w-3 text-muted-foreground/50" />
            <Button variant="ghost" size="icon" className="h-5 w-5" disabled={index === items.length - 1} onClick={() => moveDown(item.id)} aria-label="Move down">
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
          <Input
            value={item.label}
            onChange={(e) => updateLabel(item.id, e.target.value)}
            placeholder="e.g. Helmet"
            className="flex-1"
          />
          <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)} className="text-destructive shrink-0" aria-label="Remove gear item">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addItem}>
        <Plus className="h-4 w-4 mr-1.5" />
        Add gear item
      </Button>

      {items.length === 0 && (
        <p className="text-xs text-muted-foreground">No gear added yet — add the things this activity always needs, like a helmet or water bottle.</p>
      )}
    </div>
  );
}
