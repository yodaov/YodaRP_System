# YodaRP System — modular stable build

This project was split from the last working stable single-file HTML. Behavior was intentionally preserved; the change is organizational.

## How to run

Open `index.html` in your browser. The scripts are plain browser scripts, so no build step is required.

## File map

- `index.html` — page structure and script order.
- `css/styles.css` — all styling extracted from the original `<style>` block.
- `js/00_data_config_state.js` — embedded DEM/biome image data, constants, DOM references, mutable state, unit/building tables.
- `js/01_terrain_generation.js` — progress helpers, math/noise helpers, DEM/land/biome sampling, terrain generation/rendering.
- `js/02_empire_economy_ui.js` — resize/view setup, empire/diplomacy/economy/supply/building panels, save/load, selection panels.
- `js/03_map_rendering.js` — map symbols, settlement rendering, army rendering.
- `js/04_battle_system.js` — encounter detection, battle joining, battlepower, casualties, retreat/routing, battle panel.
- `js/05_interactions_popups_routes.js` — main draw, click/selection handling, movement routes, context menu, frozen zoom popups, animation loop.
- `js/06_init_events.js` — asset loading, startup/init, mode switching, event listeners.
- `original/yodarp_system_v12_single_file_backup.html` — untouched backup of the uploaded stable file.

## Editing notes

This is a safe split, not a deep ES-module refactor. The JavaScript files are loaded as normal browser scripts and share the same global lexical scope. That keeps the old code working while making it easier to find sections.

For future patches, edit the relevant file and keep `index.html` script order unchanged.


## V13 modular update: Harbors, ships, and wind

This version adds naval systems in `js/07_naval_harbor_wind.js` and small UI/event changes in `index.html`, `js/00_data_config_state.js`, and `js/06_init_events.js`.

New systems:
- Harbor settlement type, placeable only on land within 3 km of sea.
- Harbor ship-building menu.
- Ship groups for Fishing Boats, Light Raider Ships, Viking Longboats, Long Sailboats, Biremes, Merchant Ships, Triremes, Quadriremes, Quinqueremes, and Custom ships.
- Ship groups move only on water.
- Ground armies stop at the shore if ordered across water.
- Ships can load ground armies within 5 km and release them to the nearest shore.
- Wind / sea map mode and Refresh wind button.
- Wind affects ship movement speed.
- Fishing/merchant ships can generate food/wealth during Pass time.
