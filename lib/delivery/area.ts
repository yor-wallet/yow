import { cookies } from 'next/headers';
import { prisma } from '../db';
import type { LocalizedText } from '../localized';

/**
 * The delivery area a shopper is browsing for ("Deliver to Muscat"): the governorate they picked (cookie) or,
 * when signed in and nothing was picked, the governorate of their default address. It only changes what the
 * storefront SHOWS (delivery times and fees of that zone) — the order always uses the real address.
 */
export const AREA_COOKIE = 'doom_area';
export const AREA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type AreaOption = { code: string; name: LocalizedText };

/** What the storefront may say about delivery to the area. Anything not configured is `configured: false` — never guessed. */
export type AreaInfo = {
  code: string;
  name: LocalizedText;
  standard: { configured: boolean; hours: number; feeBaisa: number | null };
  express: { configured: boolean; hours: number; surchargeBaisa: number | null };
};

/** The 11 governorates, in their display order. */
export async function listAreaOptions(): Promise<AreaOption[]> {
  const rows = await prisma.governorate.findMany({ orderBy: { sort: 'asc' }, select: { code: true, name: true } });
  return rows.map((g) => ({ code: g.code, name: g.name as LocalizedText }));
}

const VALID_CODE = /^[A-Z]{2,3}$/;

export async function getAreaInfo(code: string): Promise<AreaInfo | null> {
  if (!VALID_CODE.test(code)) return null;
  const gov = await prisma.governorate.findUnique({
    where: { code },
    select: {
      code: true,
      name: true,
      deliveryZones: { where: { isActive: true }, orderBy: { sort: 'asc' }, take: 1 },
    },
  });
  if (!gov) return null;
  const zone = gov.deliveryZones[0];
  const standardConfigured = !!zone && zone.standardFeeBaisa !== null;
  return {
    code: gov.code,
    name: gov.name as LocalizedText,
    standard: { configured: standardConfigured, hours: zone?.standardHours ?? 24, feeBaisa: zone?.standardFeeBaisa ?? null },
    express: {
      configured: !!zone && standardConfigured && zone.expressAvailable && zone.expressFeeBaisa !== null && zone.dailyCapacityExpress !== null,
      hours: zone?.expressHours ?? 6,
      surchargeBaisa: zone?.expressFeeBaisa ?? null,
    },
  };
}

/** Chosen area (cookie) → default address' governorate → null. */
export async function getPreferredArea(userId?: string | null): Promise<AreaInfo | null> {
  const chosen = (await cookies()).get(AREA_COOKIE)?.value;
  if (chosen) {
    const info = await getAreaInfo(chosen);
    if (info) return info;
  }
  if (userId) {
    const address = await prisma.address.findFirst({
      where: { userId, isDefault: true, deletedAt: null },
      select: { governorate: { select: { code: true } } },
    });
    if (address) return getAreaInfo(address.governorate.code);
  }
  return null;
}

/**
 * The delivery promises the storefront can make in general ("Express in 6 hours"): the fastest configured
 * times across the active zones. `null` = nothing configured yet, so nothing may be promised.
 */
export async function getDeliveryHighlights(): Promise<{ standardHours: number | null; expressHours: number | null }> {
  const zones = await prisma.deliveryZone.findMany({
    where: { isActive: true, standardFeeBaisa: { not: null } },
    select: { standardHours: true, expressHours: true, expressAvailable: true, expressFeeBaisa: true, dailyCapacityExpress: true },
  });
  const standard = zones.map((z) => z.standardHours);
  const express = zones.filter((z) => z.expressAvailable && z.expressFeeBaisa !== null && z.dailyCapacityExpress !== null).map((z) => z.expressHours);
  return { standardHours: standard.length ? Math.min(...standard) : null, expressHours: express.length ? Math.min(...express) : null };
}
