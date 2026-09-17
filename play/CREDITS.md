# Art credits

The board tiles in `play/img/tileset.png` and the piece sprites in `play/img/pieces.png` are repacked from six free pixel-art packs. Only the tiles and sprites the game uses are included; the packs themselves are not redistributed here — get them from their authors:

- **Dungeon Gathering (free version)** by SnowHex (Jose Javier) — <https://snowhex.itch.io/dungeon-gathering>  
  Free for commercial and non-commercial projects, edits allowed, credit appreciated. The pack itself may not be redistributed or resold as game assets, images or NFTs — only the tiles the game uses are repacked here.
- **Dungeon Asset Puck — 2D Pixel Dungeon Asset Pack (free version)** by pixel-poem — <https://pixel-poem.itch.io/dungeon-assetpuck>  
  Free and commercial projects, modification allowed, credit appreciated. No redistribution or resale of the pack — only the tiles the game uses are repacked here.
- **Rogue Fantasy Catacombs** by Szadi art — <https://szadiart.itch.io/rogue-fantasy-catacombs>  
  Public domain, free for personal or commercial use, edits allowed, credit appreciated. The pack may not be resold, original or changed.
- **Pixel Chess** by Dani Maccari — <https://dani-maccari.itch.io/pixel-chess>  
  Free for personal or commercial projects as long as it is attributed to DANI MACCARI; edits allowed; the assets may not be repackaged, redistributed or resold — only the twelve piece sprites the game uses are inlined here, with that attribution.
- **Chess (NullTale Chess.png)** by NullTale — <https://nulltale.itch.io/chess>  
  Creative Commons Attribution 4.0 International — free for commercial and non-commercial use with attribution; redistribution allowed under the same terms.
- **Chess Assets** by Deja View — <https://deja-view.itch.io/chess-assets>  
  "Use it in whatever you like, just don't resell it as your own assets." Credit appreciated, not required.

The remaining sprites (the crack, the edge-on door leaf every theme wears in its own door tint, and the `classic` row — the drawn set a stage without a theme wears) are drawn in-house by `phase0/lib/inhouse.mjs`. THE WALLS (47 tall autotile cases per theme, `wall-<mask>`) and the RUINS (16 cases, `ruin-<mask>` — the stub a broken wall leaves) are ONE drawing on every theme: the Catacombs frame's north band over its brick face (the two tiles listed below), composed case by case by the repack tool and worn by the hall, the castle and the classic set as exact palette swaps. The HOLE autotile (16 cases, `hole-<mask>` — the pit the gods leave, rimmed where floor meets it) is generated in each theme's colours.

## Which tile came from where

Tile coordinates are 16-px tile units on the named sheet (column, row; 0-based). Regenerate with `cd phase0 && node harness/repack-tiles.mjs` after placing the packs under `phase0/assets-src/` (gitignored).

| theme | role | pack | sheet | col | row |
|---|---|---|---|---|---|
| hall | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| hall | crate | Dungeon Asset Puck | Dungeon_Tileset.png | 3 | 8 |
| hall | crate-2 | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 8 |
| hall | crate-3 | Dungeon Asset Puck | box_2_4.png | 0 | 0 |
| hall | crate-4 | Dungeon Asset Puck | mini_box_2_4.png | 0 | 0 |
| hall | crate-5 | Rogue Fantasy Catacombs | decorative.png | 8 | 5 |
| hall | crate-6 | Rogue Fantasy Catacombs | decorative.png | 9 | 5 |
| hall | crate-7 | Rogue Fantasy Catacombs | decorative.png | 9 | 4 |
| hall | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 8 |
| hall | chest-2 | Dungeon Asset Puck | Dungeon_Tileset.png | 5 | 8 |
| hall | chest-3 | Dungeon Asset Puck | chest_2.png | 0 | 0 |
| hall | chest-4 | Dungeon Asset Puck | mini_chest_2.png | 0 | 0 |
| hall | barrel | Dungeon Gathering | Set 1.png | 2 | 12 |
| hall | barrel-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 7 |
| hall | barrel-3 | Rogue Fantasy Catacombs | decorative.png | 10 | 8 |
| hall | barrel-4 | Rogue Fantasy Catacombs | decorative.png | 12 | 8 |
| hall | barrel-5 | Rogue Fantasy Catacombs | decorative.png | 13 | 8 |
| hall | wreckage | Rogue Fantasy Catacombs | decorative.png | 8 | 6 |
| hall | wreckage-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 6 |
| hall | wreckage-3 | Rogue Fantasy Catacombs | decorative.png | 9 | 9 |
| hall | wreckage-4 | Rogue Fantasy Catacombs | decorative.png | 10 | 9 |
| hall | wreckage-5 | Rogue Fantasy Catacombs | decorative.png | 11 | 9 |
| hall | wreckage-6 | Rogue Fantasy Catacombs | decorative.png | 9 | 12 |
| hall | wreckage-7 | Rogue Fantasy Catacombs | decorative.png | 10 | 12 |
| hall | rubble | Rogue Fantasy Catacombs | mainlevbuild.png | 20 | 22 |
| hall | torch | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 9 |
| hall | candle | Dungeon Asset Puck | Dungeon_Tileset.png | 3 | 9 |
| hall | web | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 6 |
| hall | bones | Dungeon Asset Puck | Dungeon_Tileset.png | 8 | 6 |
| hall | skull | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 7 |
| hall | chain | Dungeon Asset Puck | Dungeon_Tileset.png | 5 | 7 |
| hall | banner | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 7 |
| hall | door2-l | Dungeon Asset Puck | Dungeon_Tileset.png | 6 | 6 |
| hall | door2-r | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 6 |
| hall | floor-1 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 14 |
| hall | floor-2 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 13 |
| hall | floor-3 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 15 |
| hall | floor-4 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 14 |
| hall | floor-5 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 13 |
| hall | floor-6 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 15 |
| hall | wall roof (the frame's north band, palette-swapped to the hall) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 3 |
| hall | wall face (the brick face, palette-swapped to the hall) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 9 |
| castle | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| castle | crate | Rogue Fantasy Catacombs | decorative.png | 8 | 5 |
| castle | crate-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 5 |
| castle | crate-3 | Rogue Fantasy Catacombs | decorative.png | 9 | 4 |
| castle | crate-4 | Dungeon Asset Puck | Dungeon_Tileset.png | 3 | 8 |
| castle | crate-5 | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 8 |
| castle | crate-6 | Dungeon Asset Puck | box_2_4.png | 0 | 0 |
| castle | crate-7 | Dungeon Asset Puck | mini_box_2_4.png | 0 | 0 |
| castle | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 8 |
| castle | chest-2 | Dungeon Asset Puck | Dungeon_Tileset.png | 5 | 8 |
| castle | chest-3 | Dungeon Asset Puck | chest_2.png | 0 | 0 |
| castle | chest-4 | Dungeon Asset Puck | mini_chest_2.png | 0 | 0 |
| castle | barrel | Dungeon Gathering | Set 1.png | 2 | 12 |
| castle | barrel-2 | Rogue Fantasy Catacombs | decorative.png | 12 | 8 |
| castle | barrel-3 | Rogue Fantasy Catacombs | decorative.png | 13 | 8 |
| castle | barrel-4 | Rogue Fantasy Catacombs | decorative.png | 11 | 11 |
| castle | wreckage | Rogue Fantasy Catacombs | decorative.png | 8 | 6 |
| castle | wreckage-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 6 |
| castle | wreckage-3 | Rogue Fantasy Catacombs | decorative.png | 9 | 9 |
| castle | wreckage-4 | Rogue Fantasy Catacombs | decorative.png | 10 | 9 |
| castle | wreckage-5 | Rogue Fantasy Catacombs | decorative.png | 11 | 9 |
| castle | wreckage-6 | Rogue Fantasy Catacombs | decorative.png | 9 | 12 |
| castle | wreckage-7 | Rogue Fantasy Catacombs | decorative.png | 10 | 12 |
| castle | rubble | Dungeon Gathering | Set 1.png | 12 | 12 |
| castle | torch | Dungeon Asset Puck | Dungeon_Tileset.png | 1 | 9 |
| castle | candle | Dungeon Asset Puck | Dungeon_Tileset.png | 5 | 9 |
| castle | web | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 6 |
| castle | bones | Dungeon Asset Puck | Dungeon_Tileset.png | 8 | 6 |
| castle | skull | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 7 |
| castle | chain | Dungeon Asset Puck | Dungeon_Tileset.png | 6 | 7 |
| castle | banner | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 7 |
| castle | door2-l | Dungeon Asset Puck | Dungeon_Tileset.png | 6 | 6 |
| castle | door2-r | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 6 |
| castle | floor-1 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 14 |
| castle | floor-2 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 13 |
| castle | floor-3 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 15 |
| castle | floor-4 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 14 |
| castle | floor-5 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 13 |
| castle | floor-6 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 15 |
| castle | wall roof (the frame's north band, palette-swapped to the castle) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 3 |
| castle | wall face (the brick face, palette-swapped to the castle) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 9 |
| crypt | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| crypt | crate | Rogue Fantasy Catacombs | decorative.png | 8 | 5 |
| crypt | crate-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 5 |
| crypt | crate-3 | Rogue Fantasy Catacombs | decorative.png | 9 | 4 |
| crypt | crate-4 | Dungeon Asset Puck | Dungeon_Tileset.png | 3 | 8 |
| crypt | crate-5 | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 8 |
| crypt | crate-6 | Dungeon Asset Puck | box_2_4.png | 0 | 0 |
| crypt | crate-7 | Dungeon Asset Puck | mini_box_2_4.png | 0 | 0 |
| crypt | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 8 |
| crypt | chest-2 | Dungeon Asset Puck | Dungeon_Tileset.png | 5 | 8 |
| crypt | chest-3 | Dungeon Asset Puck | chest_2.png | 0 | 0 |
| crypt | chest-4 | Dungeon Asset Puck | mini_chest_2.png | 0 | 0 |
| crypt | barrel | Rogue Fantasy Catacombs | decorative.png | 9 | 7 |
| crypt | barrel-2 | Rogue Fantasy Catacombs | decorative.png | 10 | 8 |
| crypt | barrel-3 | Rogue Fantasy Catacombs | decorative.png | 11 | 8 |
| crypt | barrel-4 | Rogue Fantasy Catacombs | decorative.png | 12 | 8 |
| crypt | barrel-5 | Rogue Fantasy Catacombs | decorative.png | 13 | 8 |
| crypt | barrel-6 | Rogue Fantasy Catacombs | decorative.png | 9 | 10 |
| crypt | barrel-7 | Rogue Fantasy Catacombs | decorative.png | 10 | 11 |
| crypt | barrel-8 | Rogue Fantasy Catacombs | decorative.png | 11 | 11 |
| crypt | barrel-9 | Rogue Fantasy Catacombs | decorative.png | 12 | 11 |
| crypt | barrel-10 | Rogue Fantasy Catacombs | decorative.png | 13 | 11 |
| crypt | wreckage | Rogue Fantasy Catacombs | decorative.png | 8 | 6 |
| crypt | wreckage-2 | Rogue Fantasy Catacombs | decorative.png | 9 | 6 |
| crypt | wreckage-3 | Rogue Fantasy Catacombs | decorative.png | 9 | 9 |
| crypt | wreckage-4 | Rogue Fantasy Catacombs | decorative.png | 10 | 9 |
| crypt | wreckage-5 | Rogue Fantasy Catacombs | decorative.png | 11 | 9 |
| crypt | wreckage-6 | Rogue Fantasy Catacombs | decorative.png | 9 | 12 |
| crypt | wreckage-7 | Rogue Fantasy Catacombs | decorative.png | 10 | 12 |
| crypt | rubble | Rogue Fantasy Catacombs | mainlevbuild.png | 20 | 22 |
| crypt | torch | Rogue Fantasy Catacombs | torch_1.png | 0 | 0 |
| crypt | candle | Rogue Fantasy Catacombs | candleA_01.png | 0 | 0 |
| crypt | chain | Rogue Fantasy Catacombs | decorative.png | 8 | 1 |
| crypt | web | Dungeon Asset Puck | Dungeon_Tileset.png | 4 | 6 |
| crypt | bones | Dungeon Asset Puck | Dungeon_Tileset.png | 8 | 6 |
| crypt | skull | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 7 |
| crypt | door2-l | Dungeon Asset Puck | Dungeon_Tileset.png | 6 | 6 |
| crypt | door2-r | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 6 |
| crypt | floor-1 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 14 |
| crypt | floor-2 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 13 |
| crypt | floor-3 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 15 |
| crypt | floor-4 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 14 |
| crypt | floor-5 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 13 |
| crypt | floor-6 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 15 |
| crypt | wall roof (the frame's north band) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 3 |
| crypt | wall face (the brick face) | Rogue Fantasy Catacombs | mainlevbuild.png | 5 | 9 |
| pieces | pixel-chess | Pixel Chess | WhitePieces.png + BlackPieces.png | — | — |
| pieces | pixel-chess-wood | Pixel Chess | WhitePieces_Wood.png + BlackPieces_Wood.png | — | — |
| pieces | nulltale | Chess | NullTale Chess.png | — | — |
| pieces | nulltale-dread | Chess | NullTale Chess.png | — | — |
| pieces | deja-view | Chess Assets | ChessAssets.png | — | — |
