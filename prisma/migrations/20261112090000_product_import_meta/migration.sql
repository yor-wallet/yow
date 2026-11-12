-- Admin-only notes kept on a product created by a catalogue import (candidate colours and
-- capacities to verify, official source URL, import batch). Nullable and unused by the storefront.
-- Reversible: ALTER TABLE "Product" DROP COLUMN "importMeta";
ALTER TABLE "Product" ADD COLUMN "importMeta" JSONB;
