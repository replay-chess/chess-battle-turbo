# ReplayChess game-article handbook

This is the complete operating guide for producing, reviewing, previewing, and publishing a ReplayChess chess-game article like the Anand–Carlsen article.

It covers both repositories:

- chess-analysis fetches the game, runs Stockfish, asks Codex to write the article, generates the hero image with Nano Banana, validates every move reference, and creates the website draft.
- chess-battle-turbo renders the MDX article, hover move previews, interactive analysis boards, Stockfish suggestions, metadata, schema, related posts, sitemap entries, and RSS entries.

The normal workflow is automated. Do not manually calculate FENs, invent engine lines, or paste unverified moves into a generated article.

## Contents

1. Architecture
2. One-time setup
3. Generate an article from a Chess.com game
4. Understand the generated files
5. Editorial standard
6. Hover move previews
7. Interactive Stockfish boards
8. Hero-image requirements
9. Review a generated draft
10. Annotate an older generated article
11. Write an article manually
12. Validate and publish
13. Troubleshooting
14. Important implementation files
15. Daily operator checklist

## 1. Architecture

The end-to-end pipeline is:

```text
Chess.com master-game URL
        |
        v
Fetch verified metadata, moves, PGN, and starting FEN
        |
        v
Native Stockfish analyzes every position at MultiPV 3
        |
        v
Codex writes structured article JSON using only verified data
        |
        +--> required BOARD markers for critical positions
        |
        +--> verified PREVIEW markers for every numbered move/variation
        |
        v
Deterministic publisher converts markers to React MDX components
        |
        +--> Nano Banana creates a 1600 x 900 WebP hero
        |
        +--> staged copies are written under chess-analysis/output
        |
        +--> draft MDX and hero are written into chess-battle-turbo
        |
        v
Human editorial and visual review
        |
        v
Set draft to false, validate, and deploy
```

The trust boundary is deliberate:

- Chess.com supplies game facts and moves.
- Stockfish supplies evaluations and candidate lines.
- Codex decides how to explain verified material and which verified marker to use.
- Application code derives FEN, UCI, SAN, move numbers, and component props.
- Codex is never trusted to invent a FEN or a legal move sequence.
- Deterministic validation rejects unknown markers, malformed markers, illegal lines, missing critical boards, duplicate boards, and unannotated numbered moves.

## 2. One-time setup

### Repository layout

The default configuration expects sibling repositories:

```text
WebstormProjects/
├── chess-analysis/
└── chess-battle-turbo/
```

If the website is elsewhere, set REPLAYCHESS_REPO or pass --website-repo.

### Runtime requirements

- Node.js 22 or newer
- pnpm 9
- A native Stockfish executable
- Codex CLI installed and authenticated
- A Gemini API key that can use the configured image model
- Network access to the public Chess.com game page

Install dependencies in both repositories:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-analysis
pnpm install

cd /Users/rohitpandit/WebstormProjects/chess-battle-turbo
pnpm install
```

Install Stockfish on macOS if necessary:

```bash
brew install stockfish
which stockfish
```

### Analysis environment

Create chess-analysis/.env from chess-analysis/.env.example. The article pipeline uses these keys:

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
NANO_BANANA_MODEL=gemini-3.1-flash-image
STOCKFISH_PATH=/opt/homebrew/bin/stockfish
CODEX_PATH=codex
REPLAYCHESS_REPO=../chess-battle-turbo
```

Notes:

- GEMINI_API_KEY is required because article generation always creates a hero image.
- NANO_BANANA_MODEL is optional. The current default is gemini-3.1-flash-image.
- STOCKFISH_PATH is optional when stockfish is already on PATH.
- CODEX_PATH is optional when the executable is named codex and is on PATH.
- REPLAYCHESS_REPO is optional with the sibling-repository layout.
- The database, TTS, and S3 environment keys in .env.example are not required for this website-article command.
- Never commit the real .env file or API keys.

Confirm the tools are available:

```bash
stockfish
codex --version
```

Exit Stockfish after the UCI prompt check.

## 3. Generate an article from a Chess.com game

### Supported source URL

The current fetcher accepts a public Chess.com master-game URL with this exact shape:

```text
https://www.chess.com/games/view/<numeric-game-id>
```

It does not accept arbitrary analysis, live-game, archive, study, or non-Chess.com URLs.

### Golden-path command

Run this from chess-analysis:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-analysis

pnpm article:game -- \
  --url https://www.chess.com/games/view/17139651
```

The command may take several minutes. Depth-20 MultiPV analysis is intentionally thorough, and the pipeline may run an additional same-root Stockfish search whenever the played move was not already among the top three.

### Available options

| Option             | Required | Default                          | Purpose                                          |
| ------------------ | -------- | -------------------------------- | ------------------------------------------------ |
| --url              | Yes      | None                             | Public Chess.com master-game URL                 |
| --output           | No       | output/game-{id}                 | Analysis artifact directory                      |
| --depth            | No       | 20                               | Stockfish depth, integer from 1 through 20       |
| --model            | No       | gpt-5.5                          | Codex model used for article writing             |
| --reasoning-effort | No       | high                             | Codex reasoning effort                           |
| --website-repo     | No       | REPLAYCHESS_REPO or sibling repo | Website repository path                          |
| --verbose          | No       | false                            | Show Stockfish progress and Codex process output |

Example with explicit paths and verbose output:

```bash
pnpm article:game -- \
  --url https://www.chess.com/games/view/17139651 \
  --depth 20 \
  --model gpt-5.5 \
  --reasoning-effort high \
  --website-repo /Users/rohitpandit/WebstormProjects/chess-battle-turbo \
  --output output/game-17139651 \
  --verbose
```

### What the command does

1. Downloads the Chess.com page and extracts the embedded game data.
2. Reconstructs every legal move with chess.js.
3. Writes normalized metadata, a PGN, and the exact starting and final FENs.
4. Runs Stockfish on every pre-move position with the top three variations.
5. Runs a forced search for a played move when that move is outside the initial MultiPV results.
6. Computes centipawn loss, played-move rank, classification, evaluation swings, and critical moments.
7. Builds a verified catalog of actual-game and engine move sequences.
8. Gives Codex the complete verified analysis and strict editorial instructions.
9. Validates Codex's structured JSON output.
10. Replaces required critical-position markers with InteractiveAnalysisBoard.
11. Replaces verified move markers with MoveSequencePreview.
12. Generates the editorial hero image using Nano Banana.
13. Resizes the hero to 1600 by 900 and writes an optimized WebP at quality 88.
14. Writes staging artifacts under chess-analysis/output.
15. Writes the final draft MDX and hero image directly into the website repository.

The publisher refuses to overwrite an existing article or hero. When the proposed slug already exists, it first tries a slug with the game ID appended. It fails rather than overwriting when both names already exist.

## 4. Understand the generated files

For game 17139651, the default analysis directory is:

```text
chess-analysis/output/game-17139651/
```

Expected artifacts:

| File                      | Meaning                                                         |
| ------------------------- | --------------------------------------------------------------- |
| game.json                 | Normalized Chess.com metadata, source URL, moves, FENs, and PGN |
| game.pgn                  | Reconstructed portable game notation                            |
| analysis.json             | Complete Stockfish output and per-move scoring                  |
| article-content.json      | Validated structured article written by Codex                   |
| article-metadata.json     | Model, source, slug, website paths, and generation metadata     |
| website-draft/{slug}.mdx  | Staged website MDX                                              |
| website-draft/{slug}.webp | Staged 1600 by 900 hero image                                   |

The live draft copies are written to:

```text
chess-battle-turbo/apps/web/content/blog/{slug}.mdx
chess-battle-turbo/apps/web/public/images/blog/{slug}.webp
```

The staged files are useful for comparison and recovery. The website files are the copies that will be rendered and committed.

## 5. Editorial standard

### Non-negotiable factual rules

- Use only facts present in the Chess.com data.
- Do not invent a tournament, venue, round, rating, date, time control, game duration, quote, player intention, biography, or historical context.
- If a field is absent or Unknown, omit it from the prose instead of guessing.
- Treat Stockfish as the source of truth for evaluations and candidate moves.
- Evaluations are normalized from White's perspective.
- Centipawns are hundredths of a pawn.
- Distinguish the engine's tactical fact from an interpretation of why a human may have chosen a move.
- Link the Chess.com source naturally in the opening when useful.
- Do not add a standalone “game source,” “engine depth,” score-perspective, or centipawn-definition paragraph.

### Required game-analysis coverage

A strong generated article should contain:

1. A useful opening hook that names the players and the game's central story.
2. The opening and the plans each side adopted.
3. The first meaningful divergence or decision.
4. A compact “Evaluation swing scorecard.”
5. Every move with centipawn loss of at least 30 in that scorecard.
6. Chronological explanation of every scorecard move.
7. For each swing:
   - what the played move allowed;
   - the concrete response or plan;
   - the tactical target or positional motif;
   - how the best line avoids the problem.
8. The conclusion of the game and why the result followed.
9. Practical lessons tied directly to this game.

Variations are evidence, not filler. Prefer one short line that proves the point over a long engine dump.

### Writing style

- Write for an improving chess player, not for a search crawler.
- Explain the board idea before presenting a variation.
- Use concrete nouns: king, file, diagonal, defender, pawn break, square, tempo.
- Avoid empty phrases such as “a fascinating battle,” “in the world of chess,” and “this teaches us that chess is complex.”
- Do not repeat the same evaluation in several consecutive paragraphs.
- Avoid claiming that a move is a blunder merely because it is not first choice; use the computed loss and resulting position.
- End sections with insight, not a generic summary sentence.
- Do not put an H1 in the MDX body. The page renders the metadata title as its only H1.

### SEO metadata constraints

The website validates metadata at load time:

| Field         | Rule                                                |
| ------------- | --------------------------------------------------- |
| title         | 10 to 110 characters                                |
| description   | 50 to 180 characters                                |
| slug/filename | Lowercase kebab-case, at most 100 characters        |
| publishedAt   | ISO date in YYYY-MM-DD form                         |
| updatedAt     | Optional ISO date, never earlier than publishedAt   |
| authorId      | Must exist in apps/web/lib/blog.ts                  |
| hero alt      | At least 8 characters                               |
| tags          | At most 8                                           |
| category      | One of the registered categories                    |
| draft         | true during review; false or omitted when published |

Generated game articles use category famous-games-players and author rohit-pandit.

## 6. Hover move previews

Concrete numbered moves and variations in generated prose are interactive. Hovering, focusing with a keyboard, or tapping the move text opens a small board at the exact position before the cited sequence.

### Generated-article pipeline

Codex never writes the final component props. It selects opaque markers from a catalog, for example:

```text
[[PREVIEW:game-20-3]]
```

The catalog is built from:

- every contiguous actual-game window;
- the top three Stockfish lines at editorial moments;
- the evaluated line beginning with the played move at editorial moments;
- every legal prefix from 1 through 12 plies.

The publisher resolves the marker deterministically:

```mdx
<MoveSequencePreview
  fen={"r1bqk1r1/pp1n1p1p/4pn1Q/2p5/3Pp3/P1P3N1/2P2PPP/R1B1KB1R b KQq - 3 10"}
  moves={["d8a5", "c1d2", "a5a4"]}
>
  10...Qa5 11.Bd2 Qa4
</MoveSequencePreview>
```

The rendered label, FEN, and UCI moves all come from chess.js and verified analysis. The final MDX may be formatted onto one line by the publisher; both forms are equivalent.

### Playback behavior

- The board begins at the exact pre-sequence FEN.
- A move advances every 1.4 seconds.
- A sequence with more than one move loops.
- A multi-move sequence rests for 1.8 seconds at the final position before restarting.
- A one-move sequence plays once and remains on the resulting position.
- Closing and reopening the preview restarts it from the original FEN.
- The last move is highlighted.
- Orientation defaults to the side to move in the supplied FEN.
- There are no controls or Stockfish inside the hover board.
- Reduced-motion users see a static starting position.
- Invalid FENs or illegal UCI lines degrade to readable text rather than breaking the article.
- The popup is clamped to the viewport and flips below the text when there is insufficient space above.
- Keyboard focus, Escape, blur, outside pointer presses, and touch pinning are supported.

### Authoring rule

Every concrete numbered move and every continuous numbered variation in a generated article must be represented by one verified preview marker before publishing. This includes:

- prose;
- headings;
- scorecard table cells;
- parentheses;
- practical-lesson sections.

Prefer one longest matching marker for a continuous line. Never concatenate marker IDs, edit an ID, put emphasis inside a marker, or invent FEN/UCI data.

## 7. Interactive Stockfish boards

InteractiveAnalysisBoard is for important positions, not every move mention.

### Automatic board selection

The generated pipeline requires a board whenever the played move was not one of Stockfish's top three:

- playedMoveRank is null; or
- playedMoveRank is greater than 3.

Codex receives one required BOARD marker for every such position and must place each marker exactly once in the relevant chronological section. The deterministic publisher replaces it with:

- the exact FEN before the played move;
- the first legal Stockfish continuation, capped at six plies;
- an explanatory title naming the move that was about to be played.

### Reader experience

While the authored continuation is playing:

- the board appears on the left;
- numbered full-move rows appear on the right;
- White and Black moves occupy separate columns;
- the current move is highlighted;
- controls appear in the bottom toolbar;
- the move list scrolls within the board height.

The bottom toolbar contains reset, undo, flip, and play/pause controls.

When the reader pauses:

- the shared browser Stockfish worker analyzes the current position;
- the top three moves appear with evaluation, primary move, and principal variation;
- candidate arrows appear on the board;
- the reader can click or drag a legal move;
- after the reader explores a move, Stockfish shows the top five replies;
- undo and reset return to earlier positions.

The article page owns one ArticleStockfishProvider, so multiple boards share the same engine pipeline rather than loading one worker per board.

### Manual component contract

```mdx
<InteractiveAnalysisBoard
  fen={"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
  moves={["e2e4", "e7e5", "g1f3"]}
  title={"The stronger central continuation"}
/>
```

Optional props:

- orientation: "auto", "white", or "black"
- moveIntervalMs: delay between authored moves
- loopDelayMs: delay before the authored line restarts

Use six-field FEN and legal lowercase UCI moves. Promotions include the promotion piece, such as e7e8q.

## 8. Hero-image requirements

The generated hero uses Nano Banana through the Google GenAI SDK.

The publisher adds these constraints even when Codex's heroPrompt is less specific:

- wide 16:9 editorial illustration;
- chess pieces and the strategic mood of the game;
- restrained warm neutral colors;
- dramatic but clean lighting;
- no people or faces;
- no player likenesses;
- no logos or brand marks;
- no letters, numbers, captions, watermarks, or visible text.

The result is center-cropped to 1600 by 900 and encoded as WebP at quality 88.

Review the actual image before publishing:

- It should communicate the game's motif, not merely show random pieces.
- Board geometry and piece placement may be illustrative, but nothing should imply a false historical scene.
- It must not contain garbled text.
- Alt text must describe what is visible, not repeat the article title or stuff keywords.
- The MDX image path, generated filename, and actual WebP filename must match.

## 9. Review a generated draft

### Start the website with draft preview enabled

Stop any existing Next.js dev or build process first. Then run:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-battle-turbo
BLOG_PREVIEW_DRAFTS=true pnpm --filter web dev
```

Open:

```text
http://localhost:3000/blog/{slug}
```

Draft preview is intentionally available only in development when BLOG_PREVIEW_DRAFTS is exactly true. A draft returns 404 without that setting.

### Editorial review

Compare the article with game.json and analysis.json.

Check:

- player names and colors;
- result;
- date, event, round, ratings, opening, and time control only when present;
- every scorecard move with centipawn loss of at least 30;
- every claimed best move against topMoves in analysis.json;
- every description of the played move against playedMoveLine;
- score direction from White's perspective;
- chronology;
- no fabricated intent or quotation;
- useful opening, turning-point, conclusion, and lesson sections;
- no source/Stockfish methodology boilerplate.

### Interaction review

For several hover previews:

1. Confirm the displayed position is before the printed move.
2. Confirm the exact printed moves play in order.
3. Confirm a one-move preview stops after one move.
4. Confirm a multi-move preview loops slowly.
5. Test keyboard focus and Escape.
6. Test tap-to-pin on a narrow viewport.

For every large analysis board:

1. Confirm the board begins before the cited mistake or alternative.
2. Confirm White and Black moves share one numbered row.
3. Confirm the active move highlight follows autoplay.
4. Confirm all controls are in the bottom toolbar.
5. Pause and wait for three Stockfish candidates.
6. Play a legal move and wait for five opponent replies.
7. Test reset, undo, flip, and play.
8. Confirm legal-move dots remain visible on light and dark squares.

### Layout review

- No board should overflow the article or viewport.
- The interactive board should remain compact and centered.
- The move panel should not make the component taller than the board on desktop.
- Long lines should scroll or truncate without shifting layout.
- Tables should scroll horizontally on small screens.
- Hero image and article images should not cause layout shift.

## 10. Annotate an older generated article

Use article:annotate when a structured article was generated before move previews existed, or when article-content.json contains prose with raw numbered moves.

The command needs the original analysis JSON and structured article JSON. It does not accept arbitrary MDX as its article input.

Example:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-analysis

pnpm article:annotate -- \
  --analysis output/game-17139651/analysis.json \
  --article output/game-17139651/article-content.json \
  --output output/game-17139651/article-content.annotated.json \
  --mdx-output output/game-17139651/website-draft/anand-carlsen-french-queen-raid-perpetual-check.annotated.mdx \
  --slug anand-carlsen-french-queen-raid-perpetual-check \
  --published-at 2026-07-14 \
  --verbose
```

Optional flags:

- --model
- --reasoning-effort
- --slug
- --published-at
- --verbose

The annotator:

1. Gives Codex the existing prose and verified preview catalog.
2. Allows only move-text-to-marker replacement.
3. Preserves prose, headings, tables, links, punctuation, and BOARD markers.
4. Validates the result deterministically.
5. Retries up to three times when raw numbered moves or invalid markers remain.
6. Writes annotated structured JSON and regenerated MDX.

Review the annotated MDX against the existing website article before copying it. The annotation command writes the requested MDX output but does not automatically overwrite the website article.

Never solve a validation error by hand-inventing a preview marker. Rerun the annotation or extend the verified catalog in code.

## 11. Write an article manually

Automatic generation is preferred for game-analysis articles. Manual MDX remains useful for evergreen lessons, product news, or carefully edited articles.

### File and URL

Create one lowercase kebab-case MDX file:

```text
apps/web/content/blog/how-to-improve-calculation.mdx
```

Its filename is its permanent URL:

```text
/blog/how-to-improve-calculation
```

Renaming the file changes the public URL. Add a permanent redirect if a published slug must change.

### Metadata template

```mdx
export const metadata = {
  title: "A descriptive article title",
  description:
    "A useful one- or two-sentence summary between 50 and 180 characters.",
  publishedAt: "2026-07-14",
  updatedAt: "2026-07-14",
  category: "strategy-improvement",
  authorId: "rohit-pandit",
  heroImage: {
    src: "/images/blog/descriptive-image-name.webp",
    alt: "A factual description of the image",
    width: 1600,
    height: 900,
  },
  tags: ["calculation", "chess improvement"],
  featured: false,
  draft: true,
};

;
```

Omit updatedAt until the published article changes materially.

Available categories:

- strategy-improvement
- openings
- famous-games-players
- replaychess-news

### Standard Markdown

Use normal Markdown for:

- H2 and H3 headings;
- paragraphs;
- ordered and unordered lists;
- internal and external links;
- blockquotes;
- tables;
- strong emphasis;
- horizontal rules.

Do not add an H1 to the body.

### Position lesson

```mdx
<PositionLesson title="Name the idea">
  Explain what the reader should notice, why it matters, and how it changes the
  decision.
</PositionLesson>
```

### Article image

Place the image under apps/web/public/images/blog and reference it from the site root:

```mdx
<ArticleImage
  src="/images/blog/minority-attack.webp"
  alt="White pawns advancing against Black's queenside pawn chain"
  width={1200}
  height={675}
  caption="The b-pawn creates a target on c6."
/>
```

### Manual move previews

When a manual article needs a hover preview, derive the exact pre-move FEN and legal UCI sequence with chess.js or the analysis pipeline. Never ask a language model to guess them.

```mdx
<MoveSequencePreview
  fen={"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"}
  moves={["e2e4", "e7e5"]}
>
  1.e4 e5
</MoveSequencePreview>
```

Keep the visible SAN label consistent with the supplied line.

## 12. Validate and publish

### Analysis repository checks

Run these after changing the generator, analysis, marker catalog, annotator, or publisher:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-analysis
pnpm typecheck
pnpm test
pnpm build
```

### Website checks

Run these after changing MDX, blog components, Stockfish integration, metadata, or styling:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-battle-turbo
pnpm --filter web check-types
pnpm --filter web test:unit
pnpm --filter web build
git diff --check
```

Do not run pnpm --filter web build while pnpm --filter web dev is running in the same checkout. Both use apps/web/.next and can corrupt the development cache.

For a targeted lint check:

```bash
cd /Users/rohitpandit/WebstormProjects/chess-battle-turbo/apps/web
pnpm exec eslint \
  app/blog/_components/InteractiveAnalysisBoard.tsx \
  app/blog/_components/MoveSequencePreview.tsx \
  mdx-components.tsx
```

### Route check

With draft preview running:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/blog/{slug}
```

Expected result:

```text
200
```

### Publish the article

After editorial, interaction, image, and validation review:

1. Change draft: true to draft: false, or remove the draft field.
2. Confirm publishedAt is the intended publication date.
3. Add updatedAt only for a material update after publication.
4. Confirm the hero file is committed with the MDX.
5. Confirm title, description, canonical URL, Open Graph image, and visible H1.
6. Confirm BlogPosting JSON-LD contains the correct author, dates, image, section, and keywords.
7. Confirm the article appears in the blog, category page, author page, sitemap, and RSS feed.
8. Run the production build with no dev server active.

The SEO smoke test currently uses explicit publishedSlugs and draftSlugs arrays in apps/web/scripts/seo-check.ts. When publishing a new article:

1. Add its slug to publishedSlugs.
2. Remove it from draftSlugs if it was listed there.
3. Update any expected RSS item count through the publishedSlugs list.
4. Start the site.
5. Run:

```bash
pnpm --filter web test:seo -- http://localhost:3000
```

Draft articles are excluded from normal blog lists, static parameters, RSS, sitemap publication, and related-post results.

## 13. Troubleshooting

### Chess.com data cannot be found

Typical error:

```text
Could not find game data on the Chess.com page.
```

Check:

- the URL is public;
- it matches /games/view/{numeric-id};
- it is a standard game rather than a variant with drop moves;
- Chess.com has not changed the embedded page-data format;
- the request is not being blocked.

Do not replace missing metadata with guesses.

### Stockfish not found

Typical error:

```text
Stockfish not found. Set STOCKFISH_PATH or install Stockfish.
```

Fix:

```bash
which stockfish
STOCKFISH_PATH=/absolute/path/to/stockfish pnpm article:game -- --url {url}
```

The engine also checks /opt/homebrew/bin/stockfish, /usr/local/bin/stockfish, and /usr/bin/stockfish.

### Stockfish analysis times out

Each native engine search has a 120-second timeout. Confirm the binary is executable and healthy. Use --verbose to identify the position. A lower depth can help during development, but production articles should normally use depth 20.

### Codex is unavailable or times out

Check:

```bash
codex --version
which codex
```

Set CODEX_PATH when necessary. Article writing and annotation each have a 15-minute timeout. Use --verbose to expose process errors.

### Unknown or malformed PREVIEW marker

Do not edit marker IDs manually.

The likely causes are:

- Codex changed a marker;
- prose contains a raw numbered move;
- analysis.json and article-content.json came from different games;
- the move catalog changed after the article was generated.

Regenerate the article or rerun article:annotate with matching inputs.

### Missing or duplicated BOARD marker

Every required board marker must appear exactly once. Regenerate the article. Do not remove a critical board merely to make validation pass.

### Nano Banana returns no image

Check GEMINI_API_KEY and NANO_BANANA_MODEL. Confirm the selected model supports image output. The article is not committed transactionally unless both MDX and image generation succeed.

### Article or image already exists

The publisher intentionally refuses to overwrite. Review the existing file. Choose a new slug only when it is genuinely a different article; otherwise edit the existing draft carefully.

### Draft route returns 404

Restart the dev server with:

```bash
BLOG_PREVIEW_DRAFTS=true pnpm --filter web dev
```

The variable must be present when Next.js starts.

### Development server reports missing .next chunks

This usually means a production build and dev server used apps/web/.next concurrently.

1. Stop both processes.
2. Remove only the generated cache:

```bash
rm -rf apps/web/.next
```

3. Restart one mode:

```bash
BLOG_PREVIEW_DRAFTS=true pnpm --filter web dev
```

Never delete article source or public images while clearing this cache.

### Hover text appears but no board opens

The component intentionally falls back to text when FEN parsing or move replay fails. Validate:

- six-field FEN;
- correct side to move;
- lowercase UCI coordinates;
- promotion suffix when required;
- every move is legal from the preceding position.

### Browser Stockfish fails after pausing

Check:

- the console error from lib/hooks/useStockfish.ts;
- the Stockfish worker and WASM assets under public;
- that only the active board owns the shared analysis request;
- that the article is being served through the application rather than opened as a local file;
- relevant response headers and asset paths.

The authored autoplay does not require browser Stockfish. Stockfish loads when a reader pauses a large analysis board.

## 14. Important implementation files

### chess-analysis

| File                                      | Responsibility                                                    |
| ----------------------------------------- | ----------------------------------------------------------------- |
| src/publish-game-article.ts               | article:game CLI and pipeline orchestration                       |
| src/game/chess-com.ts                     | Chess.com URL validation, metadata extraction, move decoding, PGN |
| src/analysis/full-game.ts                 | complete Stockfish analysis and move scoring                      |
| src/stockfish/engine.ts                   | native UCI Stockfish process                                      |
| src/agent/codex-website-article-writer.ts | article prompt, JSON schema, BOARD/PREVIEW validation             |
| src/article/move-preview.ts               | verified move catalog, FEN/UCI/SAN materialization                |
| src/article/website-publisher.ts          | MDX rendering, Nano Banana hero, transactional website write      |
| src/agent/codex-move-preview-annotator.ts | mechanical annotation and retry logic                             |
| src/annotate-website-article.ts           | article:annotate CLI                                              |
| src/article/website-publisher.test.ts     | publisher and marker pipeline tests                               |

### chess-battle-turbo

| File                                                        | Responsibility                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| apps/web/content/blog/\*.mdx                                | article source files                                           |
| apps/web/public/images/blog/\*.webp                         | article hero and body images                                   |
| apps/web/mdx-components.tsx                                 | MDX typography and registered components                       |
| apps/web/lib/blog.ts                                        | metadata validation, draft filtering, read time, related posts |
| apps/web/app/blog/[slug]/page.tsx                           | article page, metadata, JSON-LD, Stockfish provider            |
| apps/web/app/blog/\_components/MoveSequencePreview.tsx      | hover/focus/touch preview board                                |
| apps/web/app/blog/\_components/InteractiveAnalysisBoard.tsx | large board, move rows, controls, Stockfish UI                 |
| apps/web/app/blog/\_components/ArticleStockfishProvider.tsx | shared per-article engine ownership                            |
| apps/web/lib/hooks/useStockfish.ts                          | browser Stockfish worker protocol                              |
| apps/web/scripts/seo-check.ts                               | published-route, metadata, schema, RSS, sitemap smoke tests    |

## 15. Daily operator checklist

### Generate

- [ ] Confirm the Chess.com URL is the intended public master game.
- [ ] Run article:game from chess-analysis.
- [ ] Keep the depth at 20 for the production draft.
- [ ] Confirm MDX and WebP were written to both staging and website paths.

### Review

- [ ] Compare player names, colors, result, and metadata with game.json.
- [ ] Review every 30+ centipawn-loss move.
- [ ] Verify important claims against analysis.json.
- [ ] Check that no fact, quote, event, duration, or intention was invented.
- [ ] Review the title, description, slug, tags, and hero alt.
- [ ] Inspect the Nano Banana hero for text, logos, artifacts, and relevance.
- [ ] Test representative hover previews.
- [ ] Confirm one-move hover previews stop.
- [ ] Confirm multi-move hover previews loop slowly.
- [ ] Test every interactive board and bottom toolbar.
- [ ] Pause a board and confirm top-three Stockfish candidates.
- [ ] Explore a move and confirm top-five replies.
- [ ] Test desktop, narrow viewport, keyboard, and touch behavior.

### Validate

- [ ] Analysis typecheck passes.
- [ ] Analysis tests pass.
- [ ] Analysis build passes.
- [ ] Website typecheck passes.
- [ ] Website unit tests pass.
- [ ] Targeted lint passes.
- [ ] Website production build passes with the dev server stopped.
- [ ] Draft route returns HTTP 200 with BLOG_PREVIEW_DRAFTS=true.
- [ ] git diff --check passes.

### Publish

- [ ] Change draft to false or remove it.
- [ ] Confirm publishedAt.
- [ ] Update the SEO smoke-test slug lists.
- [ ] Verify canonical metadata and BlogPosting JSON-LD.
- [ ] Verify sitemap and RSS.
- [ ] Commit the MDX and matching WebP together.
