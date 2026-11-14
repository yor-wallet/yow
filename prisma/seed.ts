/**
 * DOOM | دوم — database seed (idempotent; safe to re-run).
 * Seeds reference data only: categories, brands, governorates/wilayas, ledger
 * system accounts, delivery zones WITHOUT fees, service/category campaigns and
 * the initial superadmin. Never seeds products, prices or stock.
 */
import { PrismaClient, type LedgerAccountType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { BRANDS, CAMPAIGNS, CATEGORIES, GOVERNORATES, LEDGER_SYSTEM_ACCOUNTS } from './seed-data';
import { NEIGHBORHOODS } from './neighborhoods';

// Load .env when run directly with tsx (existing env vars take precedence).
try {
  process.loadEnvFile?.('.env');
} catch {
  /* no .env file — rely on the environment */
}

const prisma = new PrismaClient();

async function seedCategories() {
  for (const [i, cat] of CATEGORIES.entries()) {
    const parent = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, icon: cat.icon, sort: i, parentId: null },
      create: { slug: cat.slug, name: cat.name, icon: cat.icon, sort: i },
    });
    for (const [j, child] of cat.children.entries()) {
      await prisma.category.upsert({
        where: { slug: child.slug },
        update: { name: child.name, icon: child.icon, sort: j, parentId: parent.id },
        create: { slug: child.slug, name: child.name, icon: child.icon, sort: j, parentId: parent.id },
      });
    }
  }
}

async function seedBrands() {
  for (const [i, b] of BRANDS.entries()) {
    await prisma.brand.upsert({
      where: { slug: b.slug },
      update: { name: b.name, nameAr: b.nameAr, isFeatured: !!b.featured, sort: i },
      create: { slug: b.slug, name: b.name, nameAr: b.nameAr, isFeatured: !!b.featured, sort: i },
    });
  }
}

/** Neighbourhoods of the main wilayas (idempotent; names are refreshed, nothing is deleted). */
async function seedNeighborhoods() {
  for (const [wilayaSlug, list] of Object.entries(NEIGHBORHOODS)) {
    const wilaya = await prisma.wilaya.findUnique({ where: { slug: wilayaSlug }, select: { id: true } });
    if (!wilaya) continue;
    for (const [i, n] of list.entries()) {
      const name = { ar: n.ar, en: n.en, fr: n.en };
      await prisma.neighborhood.upsert({
        where: { wilayaId_slug: { wilayaId: wilaya.id, slug: n.slug } },
        update: { name, sort: i },
        create: { wilayaId: wilaya.id, slug: n.slug, name, sort: i },
      });
    }
  }
}

async function seedGeography() {
  for (const [i, g] of GOVERNORATES.entries()) {
    const gov = await prisma.governorate.upsert({
      where: { code: g.code },
      update: { name: g.name, sort: i },
      create: { code: g.code, name: g.name, sort: i },
    });
    for (const [j, w] of g.wilayas.entries()) {
      const slug = `${g.code.toLowerCase()}-${w.slug}`;
      await prisma.wilaya.upsert({
        where: { slug },
        update: { name: w.name, sort: j, governorateId: gov.id },
        create: { slug, name: w.name, sort: j, governorateId: gov.id },
      });
    }
    // One delivery zone per governorate, fees deliberately NULL (admin must configure).
    const existing = await prisma.deliveryZone.findFirst({ where: { governorateId: gov.id } });
    if (!existing) {
      await prisma.deliveryZone.create({
        data: {
          governorateId: gov.id,
          wilayaSlugs: [],
          name: g.name,
          standardFeeBaisa: null,
          expressFeeBaisa: null,
          expressAvailable: false,
          sort: i,
        },
      });
    }
  }
}

async function seedLedger() {
  for (const acc of LEDGER_SYSTEM_ACCOUNTS) {
    await prisma.ledgerAccount.upsert({
      where: { code: acc.type },
      update: { name: acc.name },
      create: { code: acc.type, type: acc.type as LedgerAccountType, name: acc.name, isSystem: true },
    });
  }
}

async function seedCampaigns() {
  for (const c of CAMPAIGNS) {
    const data = {
      internalName: c.internalName,
      title: c.title,
      subtitle: c.subtitle,
      cta: c.cta,
      mediaType: c.mediaType,
      sceneKind: c.sceneKind,
      linkUrl: c.linkUrl,
      priority: c.priority,
      theme: c.theme,
      placements: c.placements,
    } as const;
    await prisma.campaign.upsert({
      where: { slug: c.slug },
      update: data,
      create: { slug: c.slug, ...data, productIds: [], isActive: true },
    });
  }
}

async function seedSuperadmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — superadmin not created.');
    return;
  }
  if (password.length < 10) throw new Error('[seed] ADMIN_PASSWORD must be at least 10 characters.');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'SUPERADMIN') {
      await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPERADMIN' } });
    }
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, passwordHash, fullName: 'DOOM Superadmin', role: 'SUPERADMIN', emailVerifiedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: { actorId: null, action: 'user.seed_superadmin', entity: 'User', entityId: user.id, after: { email, role: 'SUPERADMIN' } },
  });
}

async function main() {
  await seedCategories();
  await seedBrands();
  await seedGeography();
  await seedNeighborhoods();
  await seedLedger();
  await seedCampaigns();
  await seedSuperadmin();
  const [categories, governorates, wilayas, zones, campaigns] = await Promise.all([
    prisma.category.count(),
    prisma.governorate.count(),
    prisma.wilaya.count(),
    prisma.deliveryZone.count(),
    prisma.campaign.count(),
  ]);
  console.log(`[seed] categories=${categories} governorates=${governorates} wilayas=${wilayas} zones=${zones} campaigns=${campaigns}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
