// Payload budgets of P5's HTTP responses (phase-05 plan §9.4, opt §5.1), in bytes of the `{ data }` envelope as route()
// serialises it. Asserted on the contract fixtures (train.size.test.ts) and on the routes' real answers
// (apps/web test/api/train/budgets.contract.int.test.ts).
//
// What reaches the network is gzip, and every gzip figure is §9.4's own except the 50-row bank page: 5 KB, because a
// real member's bank (positions of many games: the FEN is ≈ 40 B of gzip a row) projects to ≈ 4.8 KB for 50 rows even
// after FIX-1 dropped the 25-character mistake ref per row (it was ≈ 5.3 KB, over this ceiling). The raw figures of §9.4 assumed ≈ 280 B per bank row and ≈ 1 KB per session
// item, which the contract fixed in §7.1 cannot hold (a bank row has 21 named fields, a session item 8 grade previews
// and the coach texts); `raw` is the measured worst case + ≈ 5 % and stops growth, `plan.raw` is §9.4's figure, kept
// for the record (docs/decisions.md, FIX-1 "payload budgets").
export const P5_PAYLOAD_BUDGETS = {
  today: { raw: 4_096, gzip: 1_536 },
  bank50: { raw: 24_576, gzip: 5_120, plan: { raw: 14_336, gzip: 4_096 } },
  bank300: { raw: 147_456, gzip: 25_600, plan: { raw: 81_920 } },
  session10: { raw: 17_408, gzip: 3_584, plan: { raw: 10_240 } },
  session20: { raw: 34_816, gzip: 7_168, plan: { raw: 20_480 } },
  attemptsBody50: { raw: 19_456, plan: { raw: 16_384 } },
  attemptsResult50: { raw: 12_288, gzip: 2_048, plan: { raw: 10_240 } },
  home: { raw: 6_144, gzip: 2_560 },
  badges: { raw: 100 },
} as const;
