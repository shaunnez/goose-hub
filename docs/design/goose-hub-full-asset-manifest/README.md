
# Goose Hub — Full Asset Manifest

Purpose:
Generate ALL runtime assets required to reproduce the canonical Goose Hub Office Mode gameplay target.

This pack is intended for:
- Claude orchestration loops
- AI image generation pipelines
- PixelLab workflows
- Phaser runtime integration

Recommended workflow:
1. Generate tiles/walls first
2. Generate room props second
3. Generate goose sprites third
4. Generate ticket/UI assets fourth
5. Generate overlays/effects last
6. Iterate in-engine rapidly

All assets should:
- remain Phaser-compatible
- remain pixel perfect
- avoid anti-aliasing
- preserve runtime readability over detail

Target resolution assumptions:
- tile size: 16x16
- goose sprites: 12x16 or 16x16
- desks: 32x24 or 48x32
- overlays/icons: 8x8 to 32x32

The office is a visualization layer for real orchestration state.
