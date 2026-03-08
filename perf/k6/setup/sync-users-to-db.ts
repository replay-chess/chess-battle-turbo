/**
 * Sync perf test users to the perf Neon DB using Prisma.
 *
 * Creates User + UserStats records for each user in the manifest.
 *
 * Usage: cd perf/k6 && npx tsx setup/sync-users-to-db.ts
 *
 * Requires PERF_DATABASE_URL in perf/.env
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "../../../apps/web/app/generated/prisma";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const manifestPath = resolve(__dirname, "user-manifest.json");
const envPath = resolve(__dirname, "../../.env");

if (!existsSync(manifestPath)) {
  console.error("ERROR: user-manifest.json not found. Run create-clerk-users.ts first.");
  process.exit(1);
}

if (!existsSync(envPath)) {
  console.error("ERROR: perf/.env not found.");
  process.exit(1);
}

interface ManifestEntry {
  clerkId: string;
  email: string;
  referenceId: string;
}

// Parse env
const envContent = readFileSync(envPath, "utf-8");
function getEnv(key: string): string {
  const line = envContent.split("\n").find((l) => l.startsWith(`${key}=`));
  return line?.split("=").slice(1).join("=").replace(/['"]/g, "") || "";
}

const dbUrl = getEnv("PERF_DATABASE_URL");
if (!dbUrl) {
  console.error("ERROR: PERF_DATABASE_URL not in perf/.env");
  process.exit(1);
}

const prisma = new PrismaClient({ datasourceUrl: dbUrl });

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

async function main() {
  const fullManifest: ManifestEntry[] = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const startOffset = parseInt(process.argv[2] || "0", 10);
  const manifest = fullManifest.slice(startOffset);
  console.log(`Syncing users ${startOffset}-${startOffset + manifest.length} (${manifest.length} remaining) to perf DB...`);

  const totalStart = performance.now();
  const BATCH_SIZE = 50;
  let synced = 0;
  let skipped = 0;

  for (let i = 0; i < manifest.length; i += BATCH_SIZE) {
    const batch = manifest.slice(i, i + BATCH_SIZE);

    await Promise.all(
      batch.map(async (user, j) => {
        const globalIndex = startOffset + i + j;
        const code = `P${String(globalIndex).padStart(5, "0")}`;
        const name = user.email.split("@")[0]!.replace("perfscale-", "PerfPlayer");

        try {
          await prisma.user.upsert({
            where: { email: user.email },
            update: {
              googleId: user.clerkId,
              code,
              updatedAt: new Date(),
            },
            create: {
              googleId: user.clerkId,
              email: user.email,
              name,
              code,
              referenceId: user.referenceId,
              isActive: true,
              onboarded: true,
              stats: {
                create: {
                  totalGamesPlayed: 0,
                  gamesWon: 0,
                  gamesLost: 0,
                  gamesDrawn: 0,
                  currentWinStreak: 0,
                  longestWinStreak: 0,
                },
              },
            },
          });
          synced++;
        } catch (err: any) {
          // Stats already exist from a prior partial run — that's fine
          if (err.code === "P2002") {
            skipped++;
          } else {
            throw err;
          }
        }
      })
    );

    const done = Math.min(i + BATCH_SIZE, manifest.length);
    if (done % 500 === 0 || done === manifest.length) {
      console.log(`  Progress: ${startOffset + done}/${startOffset + manifest.length} (${elapsed(totalStart)})`);
    }
  }

  const count = await prisma.user.count();
  console.log(`\nDone in ${elapsed(totalStart)}! Synced: ${synced}, Skipped: ${skipped}`);
  console.log(`Users in DB: ${count}`);
}

main()
  .catch((err) => {
    console.error("Sync failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
