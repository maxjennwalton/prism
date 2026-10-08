/**
 * The household's default departure address (Phase 4B, Automatic Travel).
 * Shared between /api/settings/homeAddress (the parent-facing read/write
 * route) and the travel calculation batch job, so both read the exact same
 * settings key and shape rather than each hardcoding the string 'homeAddress'.
 */
import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '@/lib/db/client';
import { settings } from '@/lib/db/schema';

export const HOME_ADDRESS_SETTING_KEY = 'homeAddress';

export interface HomeAddress {
  address: string;
  lat: number;
  lon: number;
}

export async function getHomeAddress(executor: DbExecutor = db): Promise<HomeAddress | null> {
  const [row] = await executor.select().from(settings).where(eq(settings.key, HOME_ADDRESS_SETTING_KEY));
  return (row?.value as HomeAddress) ?? null;
}
