// polymarket-nvidia-ceo-forecast-01 — per-market adaptive quantile forecaster.
//
// Model (fitted on the six practice cases, p00-p05; practice pinball loss
// 0.271745 vs the house baseline's 0.363589):
//   - Centre: the market's last price (no drift — every drift variant tested
//     scored worse than no drift, 0.397+ vs 0.274).
//   - Scale: sigma = mean(|1-min move|) over the last 1080 minutes, converted
//     to a normal-consistent scale by sqrt(pi/2), floored at 0.0002 and capped
//     at 0.02 price units per sqrt-minute. Mean-absolute move is used instead
//     of the standard deviation because the price process is a spike at zero
//     plus rare jumps: ~88% of minutes do not move at all, and a plain std is
//     dominated by a handful of jumps (std-based variants scored 0.59-0.89).
//   - Regime boost: if the last 120 minutes moved more than the last 1080
//     (volatility clustering), sigma is scaled up by
//     1 + 0.5 * (meanabs120 / meanabs1080 - 1), re-capped at 0.02.
//   - Growth: quantiles widen as sigma * h^0.40, not sqrt(h). The empirical
//     spread grows much slower than a random walk (sigma per sqrt-minute
//     falls ~3x from h=1 to h=240), because most large moves are jumps that
//     do not keep compounding.
//   - Shape: standard-normal quantiles z_tau; q_tau(h) = clamp(x + z_tau *
//     sigma * h^0.40, 0, 1), rounded to 6 decimals. An empirical-quantile
//     variant was tried and scored worse (0.324-0.356), so the parametric
//     form is kept. No cross-market terms: 1-min moves are essentially
//     uncorrelated across markets (mean pairwise rho ~0.00).
//
// Node 22, standard library only. Deterministic: no randomness, no clock,
// no network. Reads every <id>.in in the input directory and writes
// <id>.out to the output directory:
//   mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The standard normal's quantile at each level. */
const Z = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];

/** Long window for the scale estimate, in minutes (one-minute moves). */
const LONG_WIN = 1080;
/** Short window for the volatility-regime ratio, in minutes. */
const SHORT_WIN = 120;
/** Smallest scale allowed, price units per sqrt-minute (keeps dead markets
 *  near-degenerate without ever giving a zero-width interval). */
const SIGMA_FLOOR = 0.0002;
/** Largest scale allowed, price units per sqrt-minute. */
const SIGMA_CAP = 0.02;
/** How fast the interval widens with horizon h (minutes): sigma * h^ALPHA. */
const ALPHA = 0.4;
/** Regime-boost strength: sigma *= 1 + BOOST_K * max(0, short/long - 1). */
const BOOST_K = 0.5;
/** sqrt(pi/2): converts E|N(0, sigma)| to sigma. */
const MEANABS_TO_SIGMA = Math.sqrt(Math.PI / 2);

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

/** Mean absolute value of the last `win` one-minute moves of `prices`. */
function meanAbsMove(prices: number[], win: number): number {
  const n = prices.length;
  if (n < 2) return 0;
  const take = Math.min(win, n - 1);
  let s = 0;
  for (let i = n - take; i < n; i++) s += Math.abs(prices[i] - prices[i - 1]);
  return s / take;
}

/** The forecast of one market: horizon rows of the five quantiles. */
function forecast(m: CaseMarket, horizon: number): number[][] {
  if (m.prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1] as number;
  let sigma = meanAbsMove(m.prices, LONG_WIN) * MEANABS_TO_SIGMA;
  sigma = Math.min(SIGMA_CAP, Math.max(SIGMA_FLOOR, sigma));
  const ratio = meanAbsMove(m.prices, SHORT_WIN) / Math.max(meanAbsMove(m.prices, LONG_WIN), 1e-12);
  // Bound the regime ratio: a market with an (almost) frozen long window
  // and one recent tick would otherwise get an unbounded boost, up to the
  // cap, for a single tick. The largest ratio seen in the practice is 4.64.
  const boundedRatio = Math.min(ratio, 5);
  if (boundedRatio > 1) sigma = Math.min(SIGMA_CAP, sigma * (1 + BOOST_K * (boundedRatio - 1)));
  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const spread = sigma * Math.pow(h, ALPHA);
    const row = Z.map((z) => price6(x + z * spread));
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}
