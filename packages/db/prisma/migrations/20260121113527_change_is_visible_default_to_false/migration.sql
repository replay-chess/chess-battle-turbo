-- AlterTable
ALTER TABLE "legends" ALTER COLUMN "isVisible" SET DEFAULT false;

-- Update existing records to false
UPDATE "legends" SET "isVisible" = false WHERE "isVisible" = true;
