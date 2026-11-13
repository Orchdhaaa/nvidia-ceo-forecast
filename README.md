# polymarket-nvidia-ceo-forecast-01

Per-market adaptive quantile forecaster for Polymarket's "Next CEO of
NVIDIA?" event. Forecasts each market's Yes price minute-by-minute, 4 hours
ahead (240 minutes), at quantiles 0.05 / 0.25 / 0.5 / 0.75 / 0.95.

## Model

- **Centre:** the market's last price. No drift (every drift variant tested
  scored worse).
- **Scale:** sigma = mean(|1-minute move|) over the last 1080 minutes,
  converted to a normal-consistent scale by sqrt(pi/2), floored at 0.0002
  and capped at 0.02. Mean-absolute move is used instead of the standard
  deviation because prices are a spike at zero (~88% of minutes do not move)
  plus rare jumps.
- **Regime boost:** if the last 120 minutes moved more than the last 1080,
  sigma is scaled up by `1 + 0.5 * (meanabs120 / meanabs1080 - 1)`, with the
  ratio bounded at 5, re-capped at 0.02.
- **Growth:** quantiles widen as `sigma * h^0.40` (h = minutes ahead), not
  sqrt(h) — the empirical spread grows much slower than a random walk.
- **Shape:** standard-normal quantiles; `q_tau(h) = clamp(x + z_tau * sigma *
  h^0.40, 0, 1)`, rounded to 6 decimals, non-decreasing per row.

Practice pinball loss: **0.271745** vs the house baseline's 0.363589
(-25.3%, beats the baseline on all 6 practice cases).

## Run

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22+, standard library only. Deterministic: no randomness, no clock,
no network. Reads every `<id>.in` in the input directory and writes
`<id>.out` to the output directory.

## License

MIT. See LICENSE.
