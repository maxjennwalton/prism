/**
 * ENDPOINT: /api/settings/homeAddress
 *
 * Phase 4B (Automatic Travel): the household's default departure address
 * for driving-time calculations. Deliberately separate from the weather
 * widget's city-level `location` setting (too coarse for routing) and
 * stored privately — this is a street address, which GET requires auth for
 * (unlike the Travel globe's geocode proxy, which is display-auth-only
 * because place names there aren't sensitive).
 *
 * A parent picks the address from this project's existing geocode proxy
 * (/api/travel/geocode) client-side, then POSTs the one candidate they
 * selected — this route never geocodes or guesses on its own, so an
 * ambiguous free-text address can never silently resolve to the wrong
 * place (same rule Phase 4B applies to event destinations).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requireRole } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logActivity } from '@/lib/services/auditLog';
import { logError } from '@/lib/utils/logError';
import { getHomeAddress, HOME_ADDRESS_SETTING_KEY, type HomeAddress } from '@/lib/services/homeAddress';

const KEY = HOME_ADDRESS_SETTING_KEY;

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json({ homeAddress: await getHomeAddress() });
  } catch (error) {
    logError('Error fetching home address:', error);
    return NextResponse.json({ homeAddress: null });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = requireRole(auth, 'canModifySettings');
  if (forbidden) return forbidden;

  try {
    const body = await request.json();
    const address = typeof body?.address === 'string' ? body.address.trim() : '';
    const lat = Number(body?.lat);
    const lon = Number(body?.lon);

    if (!address || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: 'A valid address and coordinates are required' }, { status: 400 });
    }

    const homeAddress: HomeAddress = { address, lat, lon };

    await db
      .insert(settings)
      .values({ key: KEY, value: homeAddress })
      .onConflictDoUpdate({ target: settings.key, set: { value: homeAddress } });

    logActivity({
      userId: auth.userId,
      action: 'update',
      entityType: 'setting',
      summary: 'Updated setting: Home address',
    });

    return NextResponse.json({ success: true, homeAddress });
  } catch (error) {
    logError('Error saving home address:', error);
    return NextResponse.json({ error: 'Failed to save home address' }, { status: 500 });
  }
}

export async function DELETE() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const forbidden = requireRole(auth, 'canModifySettings');
  if (forbidden) return forbidden;

  try {
    await db.delete(settings).where(eq(settings.key, KEY));
    logActivity({
      userId: auth.userId,
      action: 'update',
      entityType: 'setting',
      summary: 'Cleared setting: Home address',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    logError('Error clearing home address:', error);
    return NextResponse.json({ error: 'Failed to clear home address' }, { status: 500 });
  }
}
