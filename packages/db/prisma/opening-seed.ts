import { PrismaClient } from "#generated";
import { Chess } from "chess.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

interface ParsedOpening {
  eco: string;
  name: string;
  pgn: string;
  fen: string;
  sideToMove: string;
  moveCount: number;
}

function parseTsvFile(filePath: string): ParsedOpening[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");

  // Skip header line
  const openings: ParsedOpening[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    const parts = line.split("\t");
    if (parts.length < 3) {
      console.warn(`Skipping malformed line ${i + 1} in ${path.basename(filePath)}`);
      continue;
    }

    const eco = parts[0]!.trim();
    const name = parts[1]!.trim();
    const pgn = parts[2]!.trim();

    try {
      const chess = new Chess();
      chess.loadPgn(pgn);
      const fen = chess.fen();
      const fenParts = fen.split(" ");
      const sideToMove = fenParts[1] === "b" ? "black" : "white";
      const moveCount = chess.history().length;

      openings.push({ eco, name, pgn, fen, sideToMove, moveCount });
    } catch (error) {
      console.warn(`Failed to parse PGN on line ${i + 1} in ${path.basename(filePath)}: ${pgn}`);
    }
  }

  return openings;
}

async function main() {
  // The opening TSVs ship with the web app (apps/web/public/openings).
  const openingsDir = path.join(__dirname, "..", "..", "..", "apps", "web", "public", "openings");
  const files = ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"];

  let totalInserted = 0;

  for (const file of files) {
    const filePath = path.join(openingsDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    console.log(`Parsing ${file}...`);
    const openings = parseTsvFile(filePath);
    console.log(`  Parsed ${openings.length} openings from ${file}`);

    if (openings.length === 0) continue;

    // Batch insert with skipDuplicates for safe re-runs
    const result = await prisma.opening.createMany({
      data: openings,
      skipDuplicates: true,
    });

    console.log(`  Inserted ${result.count} new openings from ${file}`);
    totalInserted += result.count;
  }

  console.log(`\nDone! Total openings inserted: ${totalInserted}`);
  const totalCount = await prisma.opening.count();
  console.log(`Total openings in database: ${totalCount}`);
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
