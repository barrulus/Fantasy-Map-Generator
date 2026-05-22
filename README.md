# Fantasy Map Generator (barrulus fork)

A fork of Azgaar's _Fantasy Map Generator_ — a free web application that helps fantasy writers, game masters, and cartographers create and edit fantasy maps.

Upstream: [azgaar.github.io/Fantasy-Map-Generator](https://azgaar.github.io/Fantasy-Map-Generator) · [wiki](https://github.com/Azgaar/Fantasy-Map-Generator/wiki) · [Trello](https://trello.com/b/7x832DG4/fantasy-map-generator) · [_Fantasy Maps for fun and glory_](https://azgaar.wordpress.com).

## What's different in this fork

This fork pushes the generator toward larger, denser worlds and adds aerial settlements.

### High point count

The heightmap pipeline now produces proper continents at every cell density the slider exposes (up to 500k). The original `blobPower`/`linePower` tables capped at 100k, so anything above silently used the 10k-cell value and continents collapsed to scattered specks of land.

![High point count — 200k cells producing continents](docs/images/readme-image-2026-05-22_21-35-28.png)

### High burg count

The settlement generator places 6 hierarchical tiers (capital → large port → regional centre → market town → large village → small village → hamlet) with culture-aware spacing modifiers. A bug that silently dropped the entire hamlet tier at high target counts has been fixed, so dense maps actually get the hamlets they ask for.

![Dense burg coverage with hierarchical settlements](docs/images/readme-image-2026-05-22_21-48-02.png)

### Paginated burgs overview

With ~20k burgs on a map, the original overview dialog rendered every row at once and froze the UI on open. The list is now paginated (200 per page) with sort and filter operating across the full filtered set.

![Burgs overview with pagination — page 1 of 98](docs/images/readme-image-2026-05-22_21-34-33.png)

### Sky burgs and sky ports

Burgs can now fly. Toggle Flying in the burg editor (or use _Add sky burg_ from the overview) to lift a settlement above the map; toggle Sky Port to mark any ground burg as an air-route hub. Sky ports are connected to each other by airroutes (Urquhart graph), regenerated automatically whenever the set changes.

![Sky port editor with altitude field](docs/images/readme-image-2026-05-22_22-20-00.png)

---

## Upstream previews

[![preview](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/9502eae9-92e0-4d0d-9f17-a2ba4a565c01)](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/11a42446-4bd5-4526-9cb1-3ef97c868992)

[![preview](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/e751a9e5-7986-4638-b8a9-362395ef7583)](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/e751a9e5-7986-4638-b8a9-362395ef7583)

[![preview](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/b0d0efde-a0d1-4e80-8818-ea3dd83c2323)](https://github.com/Azgaar/Fantasy-Map-Generator/assets/26469650/b0d0efde-a0d1-4e80-8818-ea3dd83c2323)

Join our [Discord server](https://discordapp.com/invite/X7E84HU) and [Reddit community](https://www.reddit.com/r/FantasyMapGenerator) to share your creations, discuss the Generator, suggest ideas and get the most recent updates.

Contact me via [email](mailto:azgaar.fmg@yandex.com) if you have non-public suggestions. For bug reports please use [GitHub issues](https://github.com/Azgaar/Fantasy-Map-Generator/issues) or _#fmg-bugs_ channel on Discord. If you are facing performance issues, please read [the tips](https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Tips#performance-tips).

You can support the project on [Patreon](https://www.patreon.com/azgaar).

_Inspiration:_

- Martin O'Leary's [_Generating fantasy maps_](https://mewo2.com/notes/terrain)

- Amit Patel's [_Polygonal Map Generation for Games_](http://www-cs-students.stanford.edu/~amitp/game-programming/polygon-map-generation)

- Scott Turner's [_Here Dragons Abound_](https://heredragonsabound.blogspot.com)

## Contribution

Pull requests are highly welcomed. The codebase is messy and I will appreciate if you start with minor changes. Check out the [data model](https://github.com/Azgaar/Fantasy-Map-Generator/wiki/Data-model) before contributing.

The codebase is gradually transitioning from **vanilla JavaScript to TypeScript** while maintaining compatibility with the existing generation pipeline and old `.map` user files.

The expected **future** architecture is based on a separation between **world data**, **procedural generation**, **interactive editing**, and **rendering**. The application is conceptually divided into four main layers: world data and styles (state), generators (model), editors (controllers), renderers (view).

Flow:
settings → generators → world data → renderer
UI → editors → world data → renderer.

The data layer must contain no logic and no rendering code. Generators implement the procedural world simulation. Editors implement interactive editing tools used by the user. They perform controlled mutations of the world state. Editors can be viewed as interactive generators. The renderer converts the world state into SVG or WebGl graphics. Renderer must be pure visualization step and not modify world data.
