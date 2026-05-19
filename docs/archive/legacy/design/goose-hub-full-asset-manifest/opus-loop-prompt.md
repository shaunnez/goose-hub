
# Goose Hub — Asset Generation + Integration Loop

Use the supplied canonical gameplay target image as the PRIMARY visual reference.

Your task:
1. derive missing assets from the gameplay target
2. generate assets incrementally
3. wire them into Phaser progressively
4. preserve runtime readability
5. avoid redesigning the office layout

Use:
- asset-manifest.md
- prompt-pack.md
- canonical gameplay target image

Pipeline:
1. generate placeholders
2. integrate in Phaser
3. compare against canonical image
4. refine weak areas
5. repeat

Priority order:
1. floors/walls/corridors
2. room props
3. goose sprites
4. ticket sprites
5. HUD overlays
6. effects
7. polish

Do NOT:
- redesign room order
- redesign geometry
- invent new systems
- expand scope
- add simulation mechanics

The office remains:
a visualization layer for real orchestration state.
