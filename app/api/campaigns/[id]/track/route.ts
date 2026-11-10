import { z } from 'zod';
import { apiHandler, HttpError, json, jsonError, parseJson } from '@/lib/http';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';

/**
 * Campaign statistics (SPEC: impressions and clicks are recorded server-side).
 *   POST /api/campaigns/:id/track   { "type": "impression" | "click" }
 * One `CampaignStat` row per campaign per Muscat day, incremented atomically (upsert).
 * Public by design (visitors see ads), so: same-origin only, crawlers ignored, rate limited
 * per IP and per IP + campaign + type. Unknown or inactive campaigns are not counted.
 */
const bodySchema = z.object({ type: z.enum(['impression', 'click']) });
const idSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/);
const BOT_UA = /bot\b|crawl|spider|slurp|facebookexternalhit|lighthouse/i;

export const POST = apiHandler<{ params: Promise<{ id: string }> }>(
  async (req, { params }) => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) throw new HttpError(404, 'not_found');
    const { type } = await parseJson(req, bodySchema);
    const { ip, userAgent } = await getRequestMeta();
    if (userAgent && BOT_UA.test(userAgent)) return json({ ok: true, counted: false });
    if (ip) {
      const [global, perAd] = await Promise.all([
        rateLimit(`campaign:ip:${ip}`, 240, 60_000),
        rateLimit(`campaign:${type}:${ip}:${id.data}`, type === 'impression' ? 6 : 30, 60 * 60_000),
      ]);
      if (!global.ok) return jsonError(429, 'rate_limited');
      if (!perAd.ok) return json({ ok: true, counted: false });
    }
    const impressions = type === 'impression' ? 1 : 0;
    const clicks = type === 'click' ? 1 : 0;
    const counted = await prisma.$executeRaw`
      INSERT INTO "CampaignStat" ("id", "campaignId", "date", "impressions", "clicks")
      SELECT gen_random_uuid()::text, c."id", (now() AT TIME ZONE 'Asia/Muscat')::date, ${impressions}, ${clicks}
      FROM "Campaign" c
      WHERE c."id" = ${id.data} AND c."isActive" = true
        AND (c."startsAt" IS NULL OR c."startsAt" <= now()) AND (c."endsAt" IS NULL OR c."endsAt" > now())
      ON CONFLICT ("campaignId", "date") DO UPDATE SET
        "impressions" = "CampaignStat"."impressions" + ${impressions},
        "clicks" = "CampaignStat"."clicks" + ${clicks}`;
    return json({ ok: true, counted: counted > 0 });
  },
  { sameOrigin: true },
);
