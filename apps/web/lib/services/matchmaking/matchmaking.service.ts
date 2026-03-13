import { prisma } from "@/lib/prisma";
import {
  CreateMatchRequestInput,
  CreateMatchRequestResult,
  MatchStatusResult,
  CancelMatchRequestResult,
  getTimeControlType,
  TimeControlType,
} from "./types";
import { selectPositionFromLegends, getDefaultFen, selectOpeningPosition } from "./position-selector";

const DEMO_USER_CODE = "DEMO_PLAYER_001";
const QUEUE_TIMEOUT_SECONDS = 60;
const TIGHT_RATING_RANGE = 200;
const WIDE_RATING_RANGE = 400;

/**
 * Creates a new matchmaking request and attempts immediate matching
 *
 * Flow:
 * 1. Search for an existing waiting player first
 * 2. If found → Match immediately (don't create queue entry for this user)
 * 3. If not found → Create queue entry and wait for polling
 */
export async function createMatchRequest(
  input: CreateMatchRequestInput
): Promise<CreateMatchRequestResult> {
  // 1. Validate user exists and get their rating
  const user = await prisma.user.findUnique({
    where: { referenceId: input.userReferenceId },
    include: { chessComProfile: true },
  });

  if (!user) {
    throw new Error("User not found");
  }

  if (user.code === DEMO_USER_CODE) {
    throw new Error("Demo accounts cannot use matchmaking");
  }

  // 2. Check for existing active queue entry (prevent duplicate searches)
  const existingEntry = await prisma.matchmakingQueue.findFirst({
    where: {
      userId: user.id,
      status: "SEARCHING",
      expiresAt: { gt: new Date() },
    },
  });

  if (existingEntry) {
    throw new Error("User already has an active queue entry");
  }

  // 3. Determine time control type and get rating
  const timeControlType = getTimeControlType(input.initialTimeSeconds);
  const rating = getRatingForTimeControl(user.chessComProfile, timeControlType);

  // 4. TRY TO FIND A MATCH FIRST (before creating our entry)
  const immediateMatch = await tryFindMatch({
    userId: user.id,
    userName: user.name,
    userProfilePictureUrl: user.profilePictureUrl,
    rating,
    timeControlSeconds: input.initialTimeSeconds,
    incrementSeconds: input.incrementSeconds,
    legendReferenceId: input.legendReferenceId || null,
    openingReferenceId: input.openingReferenceId || null,
  });

  if (immediateMatch) {
    // Match found! Return immediately without creating a queue entry
    return {
      queueEntry: {
        referenceId: immediateMatch.queueEntryRef, // The opponent's queue entry ref
        status: "MATCHED",
        expiresAt: new Date(Date.now() + QUEUE_TIMEOUT_SECONDS * 1000),
      },
      immediateMatch: {
        gameReferenceId: immediateMatch.gameReferenceId,
        opponentName: immediateMatch.opponentName,
        opponentProfilePictureUrl: immediateMatch.opponentProfilePictureUrl,
      },
    };
  }

  // 5. No match found - create queue entry and wait for someone to match with us
  const expiresAt = new Date(Date.now() + QUEUE_TIMEOUT_SECONDS * 1000);

  const queueEntry = await prisma.matchmakingQueue.create({
    data: {
      userId: user.id,
      rating,
      timeControlType,
      legendReferenceId: input.legendReferenceId || null,
      openingReferenceId: input.openingReferenceId || null,
      timeControlSeconds: input.initialTimeSeconds,
      incrementSeconds: input.incrementSeconds,
      status: "SEARCHING",
      expiresAt,
    },
  });

  return {
    queueEntry: {
      referenceId: queueEntry.referenceId,
      status: queueEntry.status,
      expiresAt: queueEntry.expiresAt,
    },
  };
}

/**
 * Try to find and match with an existing waiting player
 * Uses FOR UPDATE to lock the candidate row and prevent race conditions
 */
async function tryFindMatch(params: {
  userId: bigint;
  userName: string;
  userProfilePictureUrl: string | null;
  rating: number | null;
  timeControlSeconds: number;
  incrementSeconds: number;
  legendReferenceId: string | null;
  openingReferenceId: string | null;
  // When called from polling, lock the caller's queue entry to prevent
  // duplicate games: if two polls overlap, each SKIP LOCKEDs the other's row.
  callerQueueEntryId?: bigint;
}): Promise<{
  gameReferenceId: string;
  queueEntryRef: string;
  opponentName: string;
  opponentProfilePictureUrl: string | null;
} | null> {
  // Use a transaction to atomically find and match
  const result = await prisma.$transaction(async (tx) => {
    // When retrying from a poll, lock caller's entry first and verify still SEARCHING.
    // This prevents duplicate games when two entries poll simultaneously:
    // both lock their own row, then SKIP LOCKED skips the other's locked row.
    if (params.callerQueueEntryId) {
      const locked = await tx.$queryRaw<{ status: string }[]>`
        SELECT status FROM matchmaking_queue
        WHERE id = ${params.callerQueueEntryId}
        FOR UPDATE
      `;
      if (!locked[0] || locked[0].status !== 'SEARCHING') {
        return null;
      }
    }
    // Find the best opponent with FOR UPDATE SKIP LOCKED
    // Rating filtering and closest-rating ordering is done in SQL
    type QueueCandidate = {
      id: bigint;
      referenceId: string;
      userId: bigint;
      rating: number | null;
      legendReferenceId: string | null;
    };

    const opponents = params.rating !== null
      ? await tx.$queryRaw<QueueCandidate[]>`
          SELECT id, "referenceId", "userId", rating, "legendReferenceId"
          FROM matchmaking_queue
          WHERE status = 'SEARCHING'
            AND "userId" != ${params.userId}
            AND "timeControlSeconds" = ${params.timeControlSeconds}
            AND "incrementSeconds" = ${params.incrementSeconds}
            AND "expiresAt" > NOW()
            AND (
              rating IS NULL
              OR rating BETWEEN ${params.rating - WIDE_RATING_RANGE}
                             AND ${params.rating + WIDE_RATING_RANGE}
            )
          ORDER BY
            CASE
              WHEN rating IS NULL THEN 0
              WHEN ABS(rating - ${params.rating}) <= ${TIGHT_RATING_RANGE} THEN 1
              ELSE 2
            END,
            ABS(COALESCE(rating, ${params.rating}) - ${params.rating})
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `
      : await tx.$queryRaw<QueueCandidate[]>`
          SELECT id, "referenceId", "userId", rating, "legendReferenceId"
          FROM matchmaking_queue
          WHERE status = 'SEARCHING'
            AND "userId" != ${params.userId}
            AND "timeControlSeconds" = ${params.timeControlSeconds}
            AND "incrementSeconds" = ${params.incrementSeconds}
            AND "expiresAt" > NOW()
          ORDER BY
            CASE WHEN rating IS NULL THEN 0 ELSE 1 END,
            "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        `;

    const opponent = opponents[0] ?? null;
    if (!opponent) {
      return null;
    }

    // Get opponent's user info
    const opponentUser = await tx.user.findUnique({
      where: { id: opponent.userId },
      select: { id: true, name: true, profilePictureUrl: true },
    });

    if (!opponentUser) {
      return null;
    }

    // Check if either player has an opening selected
    const openingRef = params.openingReferenceId || null;
    let openingData = null;

    if (openingRef) {
      openingData = await selectOpeningPosition(openingRef);
    }

    // Select position from either legend (only if no opening)
    const position = openingData ? null : await selectPositionFromLegends(
      params.legendReferenceId,
      opponent.legendReferenceId
    );

    // Random color assignment (for both legend and opening quick matches)
    const newPlayerIsWhite = Math.random() < 0.5;
    const whiteUserId = newPlayerIsWhite ? params.userId : opponent.userId;
    const blackUserId = newPlayerIsWhite ? opponent.userId : params.userId;

    // Build gameData based on opening vs legend
    const startingFen = openingData?.fen || position?.fen || getDefaultFen();
    const chessPositionId = openingData ? null : (position?.id || null);

    const positionInfo = openingData
      ? {
          whitePlayerName: null,
          blackPlayerName: null,
          tournamentName: null,
          openingName: openingData.name,
          openingEco: openingData.eco,
          whitePlayerImageUrl: null,
          blackPlayerImageUrl: null,
        }
      : position
        ? {
            whitePlayerName: position.whitePlayerName ?? null,
            blackPlayerName: position.blackPlayerName ?? null,
            tournamentName: position.tournamentName ?? null,
            whitePlayerImageUrl: position.whiteLegend?.profilePhotoUrl ?? null,
            blackPlayerImageUrl: position.blackLegend?.profilePhotoUrl ?? null,
          }
        : null;

    // Create the game
    const game = await tx.game.create({
      data: {
        creatorId: whiteUserId,
        opponentId: blackUserId,
        chessPositionId,
        openingId: openingData?.id ?? null,
        startingFen,
        initialTimeSeconds: params.timeControlSeconds,
        incrementSeconds: params.incrementSeconds,
        creatorTimeRemaining: params.timeControlSeconds,
        opponentTimeRemaining: params.timeControlSeconds,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        status: "IN_PROGRESS",
        startedAt: new Date(),
        gameData: {
          gameMode: "quick",
          playAsLegend: !!params.legendReferenceId || !!opponent.legendReferenceId,
          player1Legend: params.legendReferenceId,
          player2Legend: opponent.legendReferenceId,
          matchedAt: new Date().toISOString(),
          positionInfo,
          ...(openingData && {
            selectedOpening: openingRef,
            openingInfo: {
              referenceId: openingData.referenceId,
              name: openingData.name,
              eco: openingData.eco,
              pgn: openingData.pgn,
              moveCount: openingData.moveCount,
            },
          }),
        },
      },
    });

    // Update opponent's queue entry to MATCHED
    await tx.matchmakingQueue.update({
      where: { id: opponent.id },
      data: {
        status: "MATCHED",
        matchedAt: new Date(),
        matchedGameRef: game.referenceId,
      },
    });

    // When called from polling, also update caller's queue entry
    if (params.callerQueueEntryId) {
      await tx.matchmakingQueue.update({
        where: { id: params.callerQueueEntryId },
        data: {
          status: "MATCHED",
          matchedAt: new Date(),
          matchedGameRef: game.referenceId,
        },
      });
    }

    return {
      gameReferenceId: game.referenceId,
      queueEntryRef: opponent.referenceId,
      opponentName: opponentUser.name,
      opponentProfilePictureUrl: opponentUser.profilePictureUrl,
    };
  }, {
    timeout: 15000, // 15 second timeout
  });

  return result;
}

/**
 * Gets the current status of a queue entry
 */
export async function getMatchStatus(
  referenceId: string
): Promise<MatchStatusResult> {
  const entry = await prisma.matchmakingQueue.findUnique({
    where: { referenceId },
    include: {
      user: {
        select: {
          id: true,
          referenceId: true,
          name: true,
          profilePictureUrl: true,
        },
      },
    },
  });

  if (!entry) {
    throw new Error("Queue entry not found");
  }

  const now = new Date();

  // Check if expired
  if (entry.status === "SEARCHING" && entry.expiresAt < now) {
    await prisma.matchmakingQueue.update({
      where: { id: entry.id },
      data: { status: "EXPIRED" },
    });

    return {
      status: "EXPIRED",
      matchedGameRef: null,
      timeRemaining: 0,
    };
  }

  // Calculate time remaining
  const timeRemaining = Math.max(
    0,
    Math.floor((entry.expiresAt.getTime() - now.getTime()) / 1000)
  );

  // If already matched, return the match info
  if (entry.status === "MATCHED" && entry.matchedGameRef) {
    const game = await prisma.game.findUnique({
      where: { referenceId: entry.matchedGameRef },
      include: {
        creator: { select: { id: true, name: true, profilePictureUrl: true } },
        opponent: { select: { id: true, name: true, profilePictureUrl: true } },
      },
    });

    let opponentInfo = undefined;
    if (game) {
      const isCreator = game.creatorId === entry.userId;
      const opponent = isCreator ? game.opponent : game.creator;
      if (opponent) {
        opponentInfo = {
          name: opponent.name,
          profilePictureUrl: opponent.profilePictureUrl,
        };
      }
    }

    return {
      status: "MATCHED",
      matchedGameRef: entry.matchedGameRef,
      timeRemaining,
      opponentInfo,
    };
  }

  // If cancelled or expired, return status
  if (entry.status !== "SEARCHING") {
    return {
      status: entry.status,
      matchedGameRef: entry.matchedGameRef,
      timeRemaining,
    };
  }

  // Still searching — retry matching on each poll to catch cases where two
  // players queued simultaneously and missed each other's initial tryFindMatch.
  const match = await tryFindMatch({
    userId: entry.userId,
    userName: entry.user.name,
    userProfilePictureUrl: entry.user.profilePictureUrl,
    rating: entry.rating,
    timeControlSeconds: entry.timeControlSeconds,
    incrementSeconds: entry.incrementSeconds,
    legendReferenceId: entry.legendReferenceId,
    openingReferenceId: entry.openingReferenceId,
    callerQueueEntryId: entry.id,
  });

  if (match) {
    return {
      status: "MATCHED",
      matchedGameRef: match.gameReferenceId,
      timeRemaining,
      opponentInfo: {
        name: match.opponentName,
        profilePictureUrl: match.opponentProfilePictureUrl,
      },
    };
  }

  return {
    status: "SEARCHING",
    matchedGameRef: null,
    timeRemaining,
  };
}

/**
 * Cancels a matchmaking request (idempotent)
 * Returns success for already-processed entries without throwing
 */
export async function cancelMatchRequest(
  queueReferenceId: string,
  userReferenceId: string
): Promise<CancelMatchRequestResult> {
  const user = await prisma.user.findUnique({
    where: { referenceId: userReferenceId },
  });

  if (!user) {
    throw new Error("User not found");
  }

  const entry = await prisma.matchmakingQueue.findUnique({
    where: { referenceId: queueReferenceId },
  });

  if (!entry) {
    // Entry not found - treat as already cancelled (idempotent)
    return { status: "already_cancelled" };
  }

  if (entry.userId !== user.id) {
    throw new Error("Unauthorized");
  }

  // Handle terminal states idempotently
  if (entry.status === "CANCELLED") {
    return { status: "already_cancelled" };
  }

  if (entry.status === "EXPIRED") {
    return { status: "already_expired" };
  }

  if (entry.status === "MATCHED") {
    return {
      status: "already_matched",
      matchedGameRef: entry.matchedGameRef || undefined,
    };
  }

  // Entry is SEARCHING - cancel it
  await prisma.matchmakingQueue.update({
    where: { id: entry.id },
    data: { status: "CANCELLED" },
  });

  return { status: "cancelled" };
}

/**
 * Marks expired queue entries
 */
export async function cleanupExpiredEntries(): Promise<number> {
  const result = await prisma.matchmakingQueue.updateMany({
    where: {
      status: "SEARCHING",
      expiresAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });

  return result.count;
}

/**
 * Gets the rating from ChessComProfile based on time control type
 */
function getRatingForTimeControl(
  profile: {
    bulletRating: number | null;
    blitzRating: number | null;
    rapidRating: number | null;
    dailyRating: number | null;
  } | null,
  timeControlType: TimeControlType
): number | null {
  if (!profile) return null;

  switch (timeControlType) {
    case "bullet":
      return profile.bulletRating;
    case "blitz":
      return profile.blitzRating;
    case "rapid":
      return profile.rapidRating;
    case "daily":
      return profile.dailyRating;
    default:
      return null;
  }
}
