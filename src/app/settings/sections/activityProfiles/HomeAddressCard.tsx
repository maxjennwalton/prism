'use client';

import { useEffect, useRef, useState } from 'react';
import { MapPin, X } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';

interface GeocodeCandidate {
  placeId: number;
  displayName: string;
  fullName: string;
  latitude: number;
  longitude: number;
}

interface HomeAddress {
  address: string;
  lat: number;
  lon: number;
}

/**
 * The household's default departure address for Phase 4B's automatic
 * driving-time calculations. Deliberately its own setting — never the
 * weather widget's city-level `location`, which is too coarse to route
 * from. Lives in Activity Profiles settings because travel time only
 * matters there today, even though the address itself is a household-wide
 * setting, not an activity-specific one.
 *
 * The parent always picks one specific geocode candidate from the search
 * dropdown — this component never auto-selects or saves free-typed text
 * as if it were a resolved address, so an ambiguous query can never
 * silently become the wrong Home address.
 */
export function HomeAddressCard() {
  const [homeAddress, setHomeAddress] = useState<HomeAddress | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/homeAddress');
        const data = await res.json();
        setHomeAddress(data.homeAddress ?? null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/travel/geocode?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data.results ?? []);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query]);

  const selectCandidate = async (candidate: GeocodeCandidate) => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/homeAddress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: candidate.fullName, lat: candidate.latitude, lon: candidate.longitude }),
      });
      if (!res.ok) throw new Error('Failed to save Home address');
      const data = await res.json();
      setHomeAddress(data.homeAddress);
      setQuery('');
      setResults([]);
      toast({ title: 'Home address saved' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to save Home address', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const clearHomeAddress = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/homeAddress', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear Home address');
      setHomeAddress(null);
      toast({ title: 'Home address cleared' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : 'Failed to clear Home address', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Home Address</CardTitle>
        <CardDescription>
          The default departure point for calculating drive times to activities. Only used for routing — never shown on the dashboard.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!loading && homeAddress && (
          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate text-sm">{homeAddress.address}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={clearHomeAddress} disabled={saving} aria-label="Clear Home address">
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {!loading && !homeAddress && (
          <div className="relative">
            <Input
              placeholder="Search for your home address..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              disabled={saving}
            />
            {searching && <p className="text-xs text-muted-foreground mt-1">Searching...</p>}
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
                {results.map((r) => (
                  <button
                    key={r.placeId}
                    type="button"
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
                    onClick={() => selectCandidate(r)}
                    disabled={saving}
                  >
                    {r.fullName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
