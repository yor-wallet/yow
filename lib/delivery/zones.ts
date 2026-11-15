import { prisma } from '../db';
import type { LocalizedText } from '../localized';
import { getDeliverySettings } from './settings';

/**
 * Public view of the configured delivery zones (DOOM EXPRESS info page). Shows real
 * configuration only: a zone without a fee is reported as "not configured".
 */
export type ZoneSummary = {
  id: string;
  governorateName: LocalizedText;
  zoneName: LocalizedText;
  wilayaCount: number;
  isActive: boolean;
  standard: { configured: boolean; feeBaisa: number | null; hours: number; freeFromBaisa: number | null };
  express: { configured: boolean; surchargeBaisa: number | null; hours: number };
  perKgBaisa: number | null;
};

export async function listZoneSummaries(): Promise<{ zones: ZoneSummary[]; expressCutoffHour: number | null; includedWeightGrams: number }> {
  const [zones, settings] = await Promise.all([
    prisma.deliveryZone.findMany({
      orderBy: [{ governorate: { sort: 'asc' } }, { sort: 'asc' }],
      include: { governorate: { select: { name: true } } },
    }),
    getDeliverySettings(),
  ]);
  return {
    expressCutoffHour: settings.expressCutoffHour,
    includedWeightGrams: settings.includedWeightGrams,
    zones: zones.map((z) => {
      const standardConfigured = z.isActive && z.standardFeeBaisa !== null;
      return {
        id: z.id,
        governorateName: z.governorate.name as LocalizedText,
        zoneName: z.name as LocalizedText,
        wilayaCount: z.wilayaSlugs.length,
        isActive: z.isActive,
        standard: { configured: standardConfigured, feeBaisa: z.standardFeeBaisa, hours: z.standardHours, freeFromBaisa: z.freeStandardFromBaisa },
        express: {
          configured: standardConfigured && z.expressAvailable && z.expressFeeBaisa !== null && z.dailyCapacityExpress !== null,
          surchargeBaisa: z.expressFeeBaisa,
          hours: z.expressHours,
        },
        perKgBaisa: z.perKgBaisa,
      };
    }),
  };
}

/**
 * The order amount from which standard delivery is free in EVERY area we deliver to, or null when at
 * least one area has no such rule (the storefront must not promise more than the checkout applies).
 */
export async function freeStandardDeliveryFrom(): Promise<number | null> {
  const zones = await prisma.deliveryZone.findMany({ where: { isActive: true, standardFeeBaisa: { not: null } }, select: { freeStandardFromBaisa: true } });
  if (zones.length === 0) return null;
  let max = 0;
  for (const zone of zones) {
    if (zone.freeStandardFromBaisa === null) return null;
    max = Math.max(max, zone.freeStandardFromBaisa);
  }
  return max;
}
