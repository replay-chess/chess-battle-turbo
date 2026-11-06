-- AlterTable
-- Drop the inviteCode column and its unique index from the games table
DROP INDEX IF EXISTS "games_inviteCode_key";
ALTER TABLE "games" DROP COLUMN IF EXISTS "inviteCode";
