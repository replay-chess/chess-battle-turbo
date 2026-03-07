-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_gameId_fkey";

-- DropForeignKey
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "transactions_userId_fkey";

-- DropForeignKey
ALTER TABLE "wallets" DROP CONSTRAINT IF EXISTS "wallets_userId_fkey";

-- AlterTable
ALTER TABLE "games" DROP COLUMN IF EXISTS "platformFeeAmount",
DROP COLUMN IF EXISTS "platformFeePercentage",
DROP COLUMN IF EXISTS "stakeAmount",
DROP COLUMN IF EXISTS "totalPot";

-- AlterTable
ALTER TABLE "user_stats" DROP COLUMN IF EXISTS "netProfit",
DROP COLUMN IF EXISTS "totalMoneyLost",
DROP COLUMN IF EXISTS "totalMoneyWon",
DROP COLUMN IF EXISTS "totalPlatformFeesPaid";

-- DropTable
DROP TABLE IF EXISTS "transactions";

-- DropTable
DROP TABLE IF EXISTS "wallets";

-- DropEnum
DROP TYPE IF EXISTS "TransactionStatus";

-- DropEnum
DROP TYPE IF EXISTS "TransactionType";
