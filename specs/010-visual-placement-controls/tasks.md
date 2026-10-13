# Tasks: Visual placement controls

- [x] T001 Lock renderer/CSS regressions: no horizontal dialogue-bar border; 48 px split gutter remains; mirror and pan compose per panel.
- [x] T002 Lock placement validation: finite bounds, partial updates, reset defaults, no cross-panel write.
- [x] T003 Lock API isolation: pan, zoom, reset, and mirror make zero provider calls and zero generation attempts.
- [x] T004 Lock UI gestures: one commit at drag end, zoom/pan retention, reset and mirror target the selected panel, failure does not claim success.
- [x] T005 Persist `mirrored`, return it from load, and copy it forward for an unchanged panel.
- [x] T006 Remove the hairline, render mirror, and bind detail drag, zoom, reset, and mirror through the placement operation.
- [x] T007 Run focused tests, the storyboard-web offline suite, and the PostgreSQL verifier when `comics_test` is available.
