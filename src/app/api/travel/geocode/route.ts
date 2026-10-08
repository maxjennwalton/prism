/**
 * ENDPOINT: /api/travel/geocode
 * Proxy for Nominatim geocoding (OpenStreetMap).
 * Avoids CORS issues and hides the User-Agent requirement from the client.
 *
 * GET /api/travel/geocode?q=Paris+France
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDisplayAuth } from '@/lib/auth';
import { rateLimitGuard } from '@/lib/cache/rateLimit';
import { geocodeAddress, type GeocodeResult } from '@/lib/integrations/geocode';

export async function GET(request: NextRequest) {
  const auth = await getDisplayAuth();
  if (!auth) return NextResponse.json({ results: [] });

  const limited = await rateLimitGuard(auth.userId, 'geocode', 10, 60);
  if (limited) return limited;

  const { searchParams } = new URL(request.url);
  const rawQ = searchParams.get('q');
  if (!rawQ || rawQ.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  // Normalize special characters and common colloquial aliases
  const ALIASES: Record<string, string> = {
    'big island':         'Hawaii Island, Hawaii, United States',
    'big island hawaii':  'Hawaii Island, Hawaii, United States',
    'big island hi':      'Hawaii Island, Hawaii, United States',
    'the big island':     'Hawaii Island, Hawaii, United States',
    'hawaii island':      'Hawaii Island, Hawaii, United States',
    'island of hawaii':   'Hawaii Island, Hawaii, United States',
    'maui island':        'Maui, Hawaii, United States',
    'oahu':               'Oahu, Hawaii, United States',
    'the big island of hawaii': 'Hawaii Island, Hawaii, United States',
  };
  const normalized = rawQ
    .trim()
    // Replace Hawaiian ʻokina (U+02BB) and similar special apostrophes with nothing
    .replace(/[\u02BB\u02BC\u0060\u00B4]/g, '')
    // Smart/curly apostrophes → straight
    .replace(/[\u2018\u2019]/g, "'");
  const q = ALIASES[normalized.toLowerCase()] ?? normalized;

  const data = await geocodeAddress(q, 5);

  // When searching for a national park/monument, prefer boundary results over
  // natural features (peaks, volcanoes) which often have wrong centroids.
  const isNationalParkSearch = /national (park|monument|recreation area)/i.test(q);
  if (isNationalParkSearch) {
    data.sort((a, b) => {
      const score = (r: GeocodeResult) =>
        r.type === 'national_park' ? 0 :
        r.class === 'boundary' ? 1 :
        r.class === 'leisure' ? 2 : 3;
      return score(a) - score(b) || b.importance - a.importance;
    });
  }

  const results = data.map(({ placeId, displayName, fullName, latitude, longitude }) => ({
    placeId, displayName, fullName, latitude, longitude,
  }));

  return NextResponse.json({ results });
}
