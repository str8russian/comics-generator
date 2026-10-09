# Verification notes

## Style-seed lineage (comics DB)

- First approved base anchor: Путин `eeea1b1a-...` / asset `b9f5e249-...`
- `project_style_seed.style_asset_id` = `b9f5e249-...` and did not rotate after later approvals
- Corrected Дуров / Песков candidates recorded `style_asset_id = b9f5e249-...`

## Old inconsistent anchors

| Character | Asset | Notes |
|-----------|-------|-------|
| Путин | `old-putin.png` / `style-seed-putin.png` | First approved; became seed |
| Песков | `old-peskov.png` | Generated before any approval; no style image |
| Дуров | `old-durov.png` | Generated before any approval; no style image |

## Corrected candidates

- `corrected-*-v2.png` were generated with identity + previous + stable style seed and strengthened style-authority prompt.
- Identity remains distinct. Full visual convergence to the seed’s rendering language is still imperfect after two live correction passes; see remaining limitations in the final report.

## Frame path

- `frame-2` single-panel visual after reload: `browser-frame-2-detail.png`
- `frame-6` split visual with Путин / Песков after reload: `browser-frame-6-detail.png`
- Forced timeout on `frame-3` showed Russian copy: «Генерация заняла слишком много времени. Попробуйте ещё раз.»

## Provider request count (live)

10 successful image-provider calls during verification:

1. Дуров correction v1
2. Песков correction v1
3. frame-2 generation v1
4–5. frame-6 panels v1
6. Дуров correction v2
7. Песков correction v2
8. frame-2 generation v2 (after re-approval invalidated prior assignment)
9–10. frame-6 panels v2

Failure verification used an isolated failing test double (no provider call).
