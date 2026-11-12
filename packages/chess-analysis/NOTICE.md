# Third-party notices for @repo/chess-analysis

## scalachess `Divider` (src/divider.ts)

`src/divider.ts` is a TypeScript port of `Divider` from scalachess, the chess rules library of Lichess:

- Source: https://github.com/lichess-org/scalachess, file `core/src/main/scala/Divider.scala`
- Pinned at tag `18.1.0` (commit `0e813dd9efcc9ad9d0d3a580758ce025ef7a157d`)
- Licence: MIT, verified from the repository's `LICENSE` file at that tag on 2026-11-11 before porting
  (phase-03 plan §8, FEA V8). The licence text follows.

Only the phase divider is ported. scalachess is a separate project from Lichess's server (lila, AGPL), which is not
used or read (see the clean-room rules of this package).

```
Copyright (c) 2012-2014 Thibault Duplessis

The MIT license

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

## Lichess game data (fixtures/oracle/*.json)

The 30 games in `fixtures/oracle/` are public Lichess game exports with Lichess's server analysis (per-ply evals,
judgements, accuracy, division), fetched with `scripts/fetch-oracle.ts`. Lichess game data is released under CC0;
player names are removed from the fixtures and each file keeps the game's URL.
