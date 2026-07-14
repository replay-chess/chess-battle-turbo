export const BLOG_CATEGORIES = {
  "strategy-improvement": {
    label: "Strategy & Improvement",
    description:
      "Practical chess strategy and improvement lessons that turn calculation, pawn structures, planning, and sound principles into better decisions over the board.",
  },
  openings: {
    label: "Openings",
    description:
      "Learn chess openings through development, move orders, pawn structures, tactical warnings, model games, and the middlegame plans that follow them.",
  },
  "famous-games-players": {
    label: "Famous Games & Players",
    description:
      "Study landmark chess games and famous players through practical explanations of their attacks, endgames, strategic habits, and critical decisions.",
  },
  "replaychess-news": {
    label: "ReplayChess News",
    description:
      "Read verified ReplayChess product releases, publishing notes, and important platform updates directly from the team building the application.",
  },
} as const;

export type BlogCategory = keyof typeof BLOG_CATEGORIES;

export interface BlogImage {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface BlogPostMetadata {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt?: string;
  category: BlogCategory;
  authorId: string;
  heroImage: BlogImage;
  tags?: string[];
  featured?: boolean;
  draft?: boolean;
}

export interface BlogPostSummary extends BlogPostMetadata {
  slug: string;
  readTime: string;
}

export interface BlogAuthor {
  id: string;
  name: string;
  bio: string;
  profilePath: string;
  socialUrl: string;
  image: BlogImage;
}
