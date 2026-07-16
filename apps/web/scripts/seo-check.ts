import assert from "node:assert/strict";

const baseUrl =
  process.argv.slice(2).find((argument) => argument.startsWith("http")) ??
  "http://localhost:3000";
const publishedSlugs = [
  "morphy-anderssen-kings-gambit-rook-invasion",
  "kasparov-karpov-valencia-2009-nf6-sacrifice",
];
const draftSlugs = ["kasparov-karpov-knight-sacrifice-valencia-2009"];

function match(html: string, expression: RegExp, message: string) {
  const result = html.match(expression)?.[1];
  assert.ok(result, message);
  return result;
}

async function fetchPage(pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`, { redirect: "manual" });
  return { response, body: await response.text() };
}

async function checkIndexablePage(pathname: string) {
  const { response, body } = await fetchPage(pathname);
  assert.equal(response.status, 200, `${pathname} must return 200`);
  assert.ok(!response.headers.get("location"), `${pathname} must not redirect`);
  assert.match(body, /<title>[^<]+<\/title>/, `${pathname} needs a title`);
  assert.match(
    body,
    /<meta name="description" content="[^"]+"\/>/,
    `${pathname} needs a description`,
  );
  assert.match(
    body,
    /<meta name="robots" content="index, follow"\/>/,
    `${pathname} must be indexable`,
  );
  assert.match(
    body,
    /<h1(?:\s[^>]*)?>[^<]+<\/h1>/,
    `${pathname} needs one visible H1`,
  );

  const canonical = match(
    body,
    /<link rel="canonical" href="([^"]+)"\/>/,
    `${pathname} needs a canonical`,
  );
  assert.equal(
    new URL(canonical).pathname.replace(/\/$/, "") || "/",
    pathname.replace(/\/$/, "") || "/",
  );
}

await checkIndexablePage("/blog");
await checkIndexablePage("/try");
await checkIndexablePage("/learn/openings");
await checkIndexablePage("/learn/legends");
await checkIndexablePage("/blog/author/rohit-pandit");
await checkIndexablePage("/blog/editorial-policy");

const home = await fetchPage("/");
assert.equal(home.response.status, 200);
assert.ok(
  !home.body.includes('"@type":"AggregateRating"'),
  "Homepage must not publish unsupported aggregate ratings",
);
assert.ok(
  !home.body.includes('"@type":"FAQPage"'),
  "Homepage must not mark up a hidden FAQ",
);

const pricing = await fetchPage("/pricing");
assert.equal(pricing.response.status, 200);
assert.ok(
  !pricing.body.includes('"@type":"AggregateRating"'),
  "Pricing must not publish unsupported aggregate ratings",
);
assert.match(pricing.body, /"@type":"FAQPage"/);

const help = await fetchPage("/help");
assert.equal(help.response.status, 200);
assert.match(help.body, /"@type":"FAQPage"/);
assert.match(help.body, /Can I try ReplayChess without creating an account/);

const tryPage = await fetchPage("/try");
assert.match(tryPage.body, /Train the decision, not just the move/);
assert.match(tryPage.body, /"@type":"WebApplication"/);

for (const pathname of ["/community", "/docs/api", "/careers"]) {
  const page = await fetchPage(pathname);
  assert.equal(page.response.status, 200);
  assert.match(
    page.body,
    /<meta name="robots" content="noindex, follow"\/>/,
    `${pathname} must remain out of the index until it has a live product`,
  );
}

for (const slug of publishedSlugs) {
  const pathname = `/blog/${slug}`;
  await checkIndexablePage(pathname);
  const { body } = await fetchPage(pathname);
  assert.match(
    body,
    /"@type":"BlogPosting"/,
    `${pathname} needs BlogPosting JSON-LD`,
  );
  assert.match(
    body,
    /"@type":"Person","name":"Rohit Pandit"/,
    `${pathname} needs named author schema`,
  );
  assert.match(
    body,
    /\/images\/authors\/rohit-pandit\.webp/,
    `${pathname} needs the optimized author image`,
  );
  assert.match(
    body,
    /\/blog\/author\/rohit-pandit/,
    `${pathname} must link its byline to the internal author profile`,
  );
}

for (const slug of draftSlugs) {
  const { response } = await fetchPage(`/blog/${slug}`);
  assert.equal(response.status, 404, `Draft ${slug} must return 404`);
}

for (const category of [
  "strategy-improvement",
  "openings",
  "replaychess-news",
]) {
  const thinCategory = await fetchPage(`/blog/category/${category}`);
  assert.equal(thinCategory.response.status, 200);
  assert.match(
    thinCategory.body,
    /<meta name="robots" content="noindex, follow"\/>/,
  );
}

const populatedCategory = await fetchPage(
  "/blog/category/famous-games-players",
);
assert.equal(populatedCategory.response.status, 200);
assert.match(
  populatedCategory.body,
  /<meta name="robots" content="index, follow"\/>/,
);

const rss = await fetchPage("/blog/rss.xml");
assert.equal(rss.response.status, 200);
assert.match(
  rss.response.headers.get("content-type") ?? "",
  /application\/rss\+xml/,
);
assert.equal((rss.body.match(/<item>/g) ?? []).length, publishedSlugs.length);
for (const slug of draftSlugs)
  assert.ok(!rss.body.includes(slug), `RSS must exclude draft ${slug}`);

const sitemap = await fetchPage("/sitemap.xml");
assert.equal(sitemap.response.status, 200);
assert.ok(
  !sitemap.body.includes("/status"),
  "Sitemap must exclude the missing status page",
);
assert.ok(
  !sitemap.body.includes("/play</loc>"),
  "Sitemap must exclude auth-redirected /play",
);
assert.ok(sitemap.body.includes("/try</loc>"), "Sitemap must include /try");
for (const pathname of [
  "/learn/openings",
  "/learn/legends",
  "/blog/author/rohit-pandit",
  "/blog/editorial-policy",
]) {
  assert.ok(
    sitemap.body.includes(`${pathname}</loc>`),
    `Sitemap must include ${pathname}`,
  );
}
for (const pathname of ["/community", "/docs/api", "/careers"]) {
  assert.ok(
    !sitemap.body.includes(`${pathname}</loc>`),
    `Sitemap must exclude ${pathname}`,
  );
}
for (const slug of publishedSlugs)
  assert.ok(sitemap.body.includes(`/blog/${slug}</loc>`));
for (const slug of draftSlugs)
  assert.ok(!sitemap.body.includes(slug), `Sitemap must exclude draft ${slug}`);

console.log(`SEO checks passed against ${baseUrl}`);
