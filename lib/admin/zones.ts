import { z } from 'zod';
import { prisma } from '@/lib/db';
import { idSchema } from '@/lib/validation';
import type { LocalizedText } from '@/lib/localized';
import { NotFoundError, ValidationError } from './actor';
import { changedFields, defineMutation } from './mutation';
import { zBool, zInt, zIntOpt, zMoneyOpt } from './zod';

/**
 * Delivery zones & rates. The storefront only promises what is configured here: an empty standard
 * fee means "not configured" (delivery unavailable in that zone), and express needs its surcharge
 * AND a daily capacity. Every change is audited.
 */

export type AdminZoneRow = {
  id: string;
  governorateName: LocalizedText;
  name: LocalizedText;
  wilayaCount: number;
  isActive: boolean;
  standardFeeBaisa: number | null;
  expressFeeBaisa: number | null;
  expressAvailable: boolean;
  standardHours: number;
  expressHours: number;
  perKgBaisa: number | null;
  perLitreBaisa: number | null;
  freeStandardFromBaisa: number | null;
  dailyCapacityStandard: number | null;
  dailyCapacityExpress: number | null;
};

export async function listAdminZones(): Promise<AdminZoneRow[]> {
  const rows = await prisma.deliveryZone.findMany({
    orderBy: [{ governorate: { sort: 'asc' } }, { sort: 'asc' }, { id: 'asc' }],
    include: { governorate: { select: { name: true } } },
  });
  return rows.map((z) => ({
    id: z.id,
    governorateName: z.governorate.name as LocalizedText,
    name: z.name as LocalizedText,
    wilayaCount: z.wilayaSlugs.length,
    isActive: z.isActive,
    standardFeeBaisa: z.standardFeeBaisa,
    expressFeeBaisa: z.expressFeeBaisa,
    expressAvailable: z.expressAvailable,
    standardHours: z.standardHours,
    expressHours: z.expressHours,
    perKgBaisa: z.perKgBaisa,
    perLitreBaisa: z.perLitreBaisa,
    freeStandardFromBaisa: z.freeStandardFromBaisa,
    dailyCapacityStandard: z.dailyCapacityStandard,
    dailyCapacityExpress: z.dailyCapacityExpress,
  }));
}

const zoneSchema = z.object({
  id: idSchema,
  isActive: zBool,
  standardFeeBaisa: zMoneyOpt(),
  standardHours: zInt(1, 240),
  freeStandardFromBaisa: zMoneyOpt(),
  dailyCapacityStandard: zIntOpt(0, 100_000),
  expressAvailable: zBool,
  expressFeeBaisa: zMoneyOpt(),
  expressHours: zInt(1, 72),
  dailyCapacityExpress: zIntOpt(0, 100_000),
  perKgBaisa: zMoneyOpt(),
  perLitreBaisa: zMoneyOpt(),
});

export const updateZone = defineMutation({
  name: 'zone.update',
  permission: 'zones:write',
  schema: zoneSchema,
  async run({ tx, input, audit }) {
    const before = await tx.deliveryZone.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError('DeliveryZone');
    // Express cannot be offered on promises the zone cannot keep.
    if (input.expressAvailable) {
      const fields: Record<string, string[]> = {};
      if (input.standardFeeBaisa === null) fields.standardFeeBaisa = ['required'];
      if (input.expressFeeBaisa === null) fields.expressFeeBaisa = ['required'];
      if (input.dailyCapacityExpress === null) fields.dailyCapacityExpress = ['required'];
      if (input.expressHours > input.standardHours) fields.expressHours = ['out_of_range'];
      if (Object.keys(fields).length > 0) throw new ValidationError(fields);
    }
    const { id, ...data } = input;
    const diff = changedFields(before, data);
    if (Object.keys(diff.after).length === 0) return { id };
    await tx.deliveryZone.update({ where: { id }, data });
    await audit({ action: 'zone.update', entity: 'DeliveryZone', entityId: id, before: diff.before, after: diff.after });
    return { id };
  },
});
