import { prisma } from '../lib/prisma';

async function main() {
  console.log('🌱 Starting database seed...');

  // Create bot user for AI games
  const botUser = await prisma.user.upsert({
    where: { email: 'bot@replaychess.local' },
    update: {},
    create: {
      code: 'CHESS_BOT_001',
      googleId: 'bot_system_user',
      email: 'bot@replaychess.local',
      name: 'Chess Bot',
      profilePictureUrl: null,
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
  console.log(`🤖 Created/Updated bot user: ${botUser.name} (${botUser.email}) - Reference ID: ${botUser.referenceId}`);

  // Create demo user for unauthenticated try-before-signup flow
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@replaychess.local' },
    update: {},
    create: {
      code: 'DEMO_PLAYER_001',
      googleId: 'demo_system_user',
      email: 'demo@replaychess.local',
      name: 'Demo Player',
      profilePictureUrl: null,
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
  console.log(`🎮 Created/Updated demo user: ${demoUser.name} (${demoUser.email}) - Reference ID: ${demoUser.referenceId}`);

  // Create dummy users
  const users = [
    {
      code: 'ALICE001',
      googleId: 'google_alice_123456',
      email: 'alice@replaychess.local',
      name: 'Alice Johnson',
      profilePictureUrl: 'https://i.pravatar.cc/150?img=1',
      dateOfBirth: new Date('1995-03-15'),
      isActive: true,
    },
    {
      code: 'BOB002',
      googleId: 'google_bob_789012',
      email: 'bob@replaychess.local',
      name: 'Bob Smith',
      profilePictureUrl: 'https://i.pravatar.cc/150?img=2',
      dateOfBirth: new Date('1992-07-22'),
      isActive: true,
    },
    {
      code: 'CHARLIE003',
      googleId: 'google_charlie_345678',
      email: 'charlie@replaychess.local',
      name: 'Charlie Davis',
      profilePictureUrl: 'https://i.pravatar.cc/150?img=3',
      dateOfBirth: new Date('1998-11-08'),
      isActive: true,
    },
    {
      code: 'DIANA004',
      googleId: 'google_diana_901234',
      email: 'diana@replaychess.local',
      name: 'Diana Martinez',
      profilePictureUrl: 'https://i.pravatar.cc/150?img=4',
      dateOfBirth: new Date('1994-05-30'),
      isActive: true,
    },
    {
      code: 'EVAN005',
      googleId: 'google_evan_567890',
      email: 'evan@replaychess.local',
      name: 'Evan Wilson',
      profilePictureUrl: 'https://i.pravatar.cc/150?img=5',
      dateOfBirth: new Date('1996-09-12'),
      isActive: true,
    },
  ];

  for (const userData of users) {
    const user = await prisma.user.upsert({
      where: { email: userData.email },
      update: {},
      create: {
        ...userData,
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

    console.log(`✅ Created user: ${user.name} (${user.email}) - Reference ID: ${user.referenceId}`);
  }

  // Create chess positions with famous games and puzzle positions
  const chessPositions = [
    {
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
      sideToMove: 'white',
      pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6',
      moveNumber: 4,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Italian Game - Classical Variation',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Italian Game',
        eco: 'C50',
        description: 'A classical Italian Game position with both knights developed'
      },
      featured: true,
      isActive: true,
    },
    {
      fen: 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
      sideToMove: 'black',
      pgn: '1. e4 e5 2. Nf3 Nc6 3. Bb5',
      moveNumber: 3,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Ruy Lopez Opening',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Ruy Lopez',
        eco: 'C60',
        description: 'The starting position of the famous Ruy Lopez opening'
      },
      featured: true,
      isActive: true,
    },
    {
      fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 4 4',
      sideToMove: 'white',
      pgn: '1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6',
      moveNumber: 4,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Four Knights Game',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Four Knights Game',
        eco: 'C47',
        description: 'A symmetrical opening where all four knights are developed'
      },
      featured: false,
      isActive: true,
    },
    {
      fen: 'r2qkb1r/ppp2ppp/2np1n2/4p1B1/2B1P3/2N2N2/PPPP1PPP/R2QK2R b KQkq - 0 6',
      sideToMove: 'black',
      pgn: '1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Nc3 Bc5 5. d3 d6 6. Bg5',
      moveNumber: 6,
      positionType: 'middlegame',
      whitePlayerName: 'Adolf Anderssen',
      blackPlayerName: 'Lionel Kieseritzky',
      tournamentName: 'Immortal Game',
      eventDate: new Date('1851-06-21'),
      sourceType: 'agadmator',
      gameMetadata: {
        result: '1-0',
        historicalSignificance: 'One of the most famous chess games ever played',
        notes: 'Features a spectacular queen sacrifice'
      },
      positionContext: {
        gameName: 'The Immortal Game',
        phase: 'early-middlegame',
        description: 'Position from the famous Immortal Game between Anderssen and Kieseritzky'
      },
      featured: true,
      isActive: true,
    },
    {
      fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      sideToMove: 'white',
      pgn: '1. e4 e5 2. Nf3 Nc6',
      moveNumber: 3,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Open Game',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Kings Pawn Opening',
        eco: 'C40',
        description: 'Basic open game position after 2...Nc6'
      },
      featured: false,
      isActive: true,
    },
    {
      fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
      sideToMove: 'white',
      pgn: '1. e4 e5 2. Nf3 Nf6',
      moveNumber: 3,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Petrov Defense',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Petrov Defense (Russian Game)',
        eco: 'C42',
        description: 'The starting position of the solid Petrov Defense'
      },
      featured: false,
      isActive: true,
    },
    {
      fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      sideToMove: 'white',
      positionType: 'puzzle',
      sourceType: 'manual',
      positionContext: {
        puzzleType: 'tactical',
        difficulty: 'hard',
        description: 'Complex middlegame position with multiple tactical themes',
        themes: ['pin', 'fork', 'discovered-attack']
      },
      featured: true,
      isActive: true,
    },
    {
      fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
      sideToMove: 'white',
      pgn: '1. e4 e5',
      moveNumber: 2,
      positionType: 'opening',
      whitePlayerName: 'Various',
      blackPlayerName: 'Various',
      tournamentName: 'Open Game',
      sourceType: 'manual',
      positionContext: {
        openingName: 'Kings Pawn Game',
        eco: 'C20',
        description: 'The fundamental starting position for open games'
      },
      featured: false,
      isActive: true,
    }
  ];

  for (const positionData of chessPositions) {
    const position = await prisma.chessPosition.create({
      data: positionData,
    });

    const displayName = positionData.tournamentName || positionData.positionType || 'Position';
    console.log(`♟️  Created chess position: ${displayName} - Reference ID: ${position.referenceId}`);
  }

  console.log('🎉 Database seed completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

