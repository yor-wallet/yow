import { z } from 'zod';
import { apiHandler, json, jsonError, parseJson } from '@/lib/http';
import { prisma } from '@/lib/db';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';

/**
 * Campaign statistics (SPEC: impressions and clicks are recorded server-side).
 * One row per campaign per Muscat day; counters are incremented atomically.
 * Public and unauthenticated by design, so it is same-origin only and rate limited per IP.
 */
const schema = z.object({
  id: z.string().trim().min(1).max(64),
  type: z.enum(['impression', 'click']),
});

export const POST = apiHandler(
  async (req) => {
    const body = await parseJson(req, schema);
    const { ip } = await getRequestMeta();
    if (ip && !(await rateLimit(`campaign:ip:${ip}`, 240, 60_000)).ok) return jsonError(429, 'rate_limited');
    const impressions = body.type === 'impression' ? 1 : 0;
    const clicks = body.type === 'click' ? 1 : 0;
    // Only active campaigns are counted; an unknown id inserts nothing.
    await prisma.$executeRaw`
      INSERT INTO "CampaignStat" ("id", "campaignId", "date", "impressions", "clicks")
      SELECT gen_random_uuid()::text, c."id", (now() AT TIME ZONE 'Asia/Muscat')::date, ${impressions}, ${clicks}
      FROM "Campaign" c WHERE c."id" = ${body.id} AND c."isActive" = true
      ON CONFLICT ("campaignId", "date") DO UPDATE SET
        "impressions" = "CampaignStat"."impressions" + ${impressions},
        "clicks" = "CampaignStat"."clicks" + ${clicks}`;
    return json({ ok: true });
  },
  { sameOrigin: true },
);
