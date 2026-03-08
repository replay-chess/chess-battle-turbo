import { PrismaClient } from "../apps/web/app/generated/prisma";

const PROD_URL = process.env.PROD_DATABASE_URL!;
const PERF_URL = process.env.PERF_DATABASE_URL!;

if (!PROD_URL || !PERF_URL) {
  console.error("Set PROD_DATABASE_URL and PERF_DATABASE_URL");
  process.exit(1);
}

const prod = new PrismaClient({ datasourceUrl: PROD_URL });
const perf = new PrismaClient({ datasourceUrl: PERF_URL });

function elapsed(start: number): string {
  return `${((performance.now() - start) / 1000).toFixed(1)}s`;
}

async function upsertBatch<T extends Record<string, unknown>>(
  label: string,
  items: T[],
  upsertFn: (item: T) => Promise<unknown>,
  batchSize = 50,
) {
  const start = performance.now();
  let done = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await Promise.all(batch.map(upsertFn));
    done += batch.length;
    if (done % 200 === 0 || done === items.length) {
      console.log(`  ${label}: ${done}/${items.length} (${elapsed(start)})`);
    }
  }
  console.log(`  ${label}: done — ${items.length} rows in ${elapsed(start)}`);
}

async function main() {
  const totalStart = performance.now();

  // 1. Copy legends
  console.log("\n[1/4] Fetching legends from prod...");
  let start = performance.now();
  const legends = await prod.legend.findMany();
  console.log(`  Found ${legends.length} legends (${elapsed(start)})`);

  console.log("[1/4] Upserting legends to perf...");
  await upsertBatch("legends", legends, (legend) => {
    const { id, ...data } = legend;
    return perf.legend.upsert({
      where: { referenceId: legend.referenceId },
      update: {},
      create: data,
    });
  });

  // 2. Copy openings
  console.log("\n[2/4] Fetching openings from prod...");
  start = performance.now();
  const openings = await prod.opening.findMany();
  console.log(`  Found ${openings.length} openings (${elapsed(start)})`);

  console.log("[2/4] Upserting openings to perf...");
  await upsertBatch("openings", openings, (opening) => {
    const { id, ...data } = opening;
    return perf.opening.upsert({
      where: { referenceId: opening.referenceId },
      update: {},
      create: data,
    });
  });

  // 3. Copy chess positions (need to map legend FKs)
  console.log("\n[3/4] Fetching chess positions from prod...");
  start = performance.now();
  const positions = await prod.chessPosition.findMany({
    include: { whiteLegend: true, blackLegend: true },
  });
  console.log(`  Found ${positions.length} positions (${elapsed(start)})`);

  // Pre-fetch all perf legends into a map for FK resolution (avoids N+1)
  console.log("[3/4] Building legend FK lookup map...");
  start = performance.now();
  const perfLegends = await perf.legend.findMany({
    select: { id: true, referenceId: true },
  });
  const legendMap = new Map(perfLegends.map((l) => [l.referenceId, l.id]));
  console.log(`  Built map of ${legendMap.size} legends (${elapsed(start)})`);

  console.log("[3/4] Upserting positions to perf...");
  await upsertBatch("positions", positions, (pos) => {
    const { id, whitePlayerId, blackPlayerId, whiteLegend, blackLegend, ...data } = pos;
    const perfWhiteId = whiteLegend ? (legendMap.get(whiteLegend.referenceId) ?? null) : null;
    const perfBlackId = blackLegend ? (legendMap.get(blackLegend.referenceId) ?? null) : null;

    return perf.chessPosition.upsert({
      where: { referenceId: pos.referenceId },
      update: {},
      create: {
        ...data,
        whitePlayerId: perfWhiteId,
        blackPlayerId: perfBlackId,
      },
    });
  });

  // 4. Seed bot user
  console.log("\n[4/4] Seeding bot user...");
  start = performance.now();
  await perf.user.upsert({
    where: { email: "bot@replaychess.local" },
    update: {},
    create: {
      code: "CHESS_BOT_001",
      googleId: "bot_system_user",
      email: "bot@replaychess.local",
      name: "Chess Bot",
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
  console.log(`  Bot user seeded (${elapsed(start)})`);

  // Summary
  console.log("\n=== Summary ===");
  const counts = await Promise.all([
    perf.legend.count(),
    perf.opening.count(),
    perf.chessPosition.count(),
    perf.user.count(),
  ]);
  console.log(`  Legends:    ${counts[0]}`);
  console.log(`  Openings:   ${counts[1]}`);
  console.log(`  Positions:  ${counts[2]}`);
  console.log(`  Users:      ${counts[3]}`);
  console.log(`\nTotal time: ${elapsed(totalStart)}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prod.$disconnect();
    await perf.$disconnect();
  });
