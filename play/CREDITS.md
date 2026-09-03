# Art credits

The board tiles in `play/img/tileset.png` (and the same tiles inlined in `play/tiles.css`) are repacked from three free 16×16 pixel-art packs. Only the tiles the game uses are included; the packs themselves are not redistributed here — get them from their authors:

- **Dungeon Gathering (free version)** by SnowHex (Jose Javier) — <https://snowhex.itch.io/dungeon-gathering>  
  Free for commercial and non-commercial projects, edits allowed, credit appreciated. The pack itself may not be redistributed or resold as game assets, images or NFTs — only the tiles the game uses are repacked here.
- **Dungeon Asset Puck — 2D Pixel Dungeon Asset Pack (free version)** by pixel-poem — <https://pixel-poem.itch.io/dungeon-assetpuck>  
  Free and commercial projects, modification allowed, credit appreciated. No redistribution or resale of the pack — only the tiles the game uses are repacked here.
- **Rogue Fantasy Catacombs** by Szadi art — <https://szadiart.itch.io/rogue-fantasy-catacombs>  
  Public domain, free for personal or commercial use, edits allowed, credit appreciated. The pack may not be resold, original or changed.

The remaining sprites (table, chair, shelf, the hole, the crack, and every role a theme does not override) are drawn in-house by `phase0/harness/gen-sprites.mjs`. The 16 wall autotile cases per theme (`wall-0`…`wall-15` in the atlas) are composed by the repack tool from two pack tiles — the horizontal wall (H) and the pillar or wall-top piece (V) listed below — so they carry no separate provenance.

## Which tile came from where

Tile coordinates are 16-px tile units on the named sheet (column, row; 0-based). Regenerate with `cd phase0 && node harness/repack-tiles.mjs` after placing the packs under `phase0/assets-src/` (gitignored).

| theme | role | pack | sheet | col | row |
|---|---|---|---|---|---|
| hall | floor-1 | Dungeon Asset Puck | Dungeon_Tileset.png | 8 | 1 |
| hall | floor-2 | Dungeon Asset Puck | Dungeon_Tileset.png | 6 | 0 |
| hall | floor-3 | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 2 |
| hall | wall | Dungeon Asset Puck | Dungeon_Tileset.png | 2 | 0 |
| hall | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| hall | crate | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 8 |
| hall | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 2 | 8 |
| hall | rubble | Rogue Fantasy Catacombs | mainlevbuild.png | 20 | 22 |
| hall | wall pillar/top (V) | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 2 |
| castle | floor-1 | Dungeon Gathering | Set 1.png | 10 | 3 |
| castle | floor-2 | Dungeon Gathering | Set 1.png | 11 | 2 |
| castle | floor-3 | Dungeon Gathering | Set 1.png | 13 | 2 |
| castle | wall | Dungeon Gathering | Set 1.png | 6 | 10 |
| castle | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| castle | crate | Dungeon Asset Puck | Dungeon_Tileset.png | 0 | 8 |
| castle | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 2 | 8 |
| castle | barrel | Dungeon Gathering | Set 1.png | 2 | 12 |
| castle | rubble | Dungeon Gathering | Set 1.png | 12 | 12 |
| castle | wall pillar/top (V) | Dungeon Gathering | Set 1.png | 4 | 8 |
| crypt | floor-1 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 14 |
| crypt | floor-2 | Rogue Fantasy Catacombs | mainlevbuild.png | 46 | 13 |
| crypt | floor-3 | Rogue Fantasy Catacombs | mainlevbuild.png | 47 | 15 |
| crypt | wall | Rogue Fantasy Catacombs | mainlevbuild.png | 33 | 8 |
| crypt | door | Dungeon Asset Puck | Dungeon_Tileset.png | 7 | 3 |
| crypt | crate | Rogue Fantasy Catacombs | decorative.png | 8 | 5 |
| crypt | chest | Dungeon Asset Puck | Dungeon_Tileset.png | 2 | 8 |
| crypt | barrel | Rogue Fantasy Catacombs | decorative.png | 12 | 8 |
| crypt | rubble | Rogue Fantasy Catacombs | mainlevbuild.png | 20 | 22 |
| crypt | wall pillar/top (V) | Rogue Fantasy Catacombs | mainlevbuild.png | 25 | 4 |
