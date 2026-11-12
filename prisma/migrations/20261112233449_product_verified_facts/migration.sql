-- Verified catalogue facts (series, year, sources, per-variant storage/RAM/part number).
-- All columns are nullable or defaulted: no existing row changes.
-- Reversible: DROP INDEX "Product_brandId_series_modelYear_idx";
--   ALTER TABLE "Product" DROP COLUMN "modelYear", DROP COLUMN "series", DROP COLUMN "sourceCheckedAt", DROP COLUMN "sourceLinks", DROP COLUMN "specsVerified";
--   ALTER TABLE "ProductVariant" DROP COLUMN "mpn", DROP COLUMN "ramGb", DROP COLUMN "storageGb";
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "modelYear" INTEGER,
ADD COLUMN     "series" TEXT,
ADD COLUMN     "sourceCheckedAt" TIMESTAMP(3),
ADD COLUMN     "sourceLinks" JSONB,
ADD COLUMN     "specsVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "mpn" TEXT,
ADD COLUMN     "ramGb" INTEGER,
ADD COLUMN     "storageGb" INTEGER;

-- CreateIndex
CREATE INDEX "Product_brandId_series_modelYear_idx" ON "Product"("brandId", "series", "modelYear");
