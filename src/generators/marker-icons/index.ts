import battlefields from "./mk-battlefields.svg?raw";
import bridges from "./mk-bridges.svg?raw";
import brigands from "./mk-brigands.svg?raw";
import canoes from "./mk-canoes.svg?raw";
import caves from "./mk-caves.svg?raw";
import circuses from "./mk-circuses.svg?raw";
import dances from "./mk-dances.svg?raw";
import disturbedBurials from "./mk-disturbed-burials.svg?raw";
import dungeons from "./mk-dungeons.svg?raw";
import encounters from "./mk-encounters.svg?raw";
import fairs from "./mk-fairs.svg?raw";
import hillMonsters from "./mk-hill-monsters.svg?raw";
import hotSprings from "./mk-hot-springs.svg?raw";
import inns from "./mk-inns.svg?raw";
import jousts from "./mk-jousts.svg?raw";
import lakeMonsters from "./mk-lake-monsters.svg?raw";
import libraries from "./mk-libraries.svg?raw";
import lighthouses from "./mk-lighthouses.svg?raw";
import migration from "./mk-migration.svg?raw";
import mines from "./mk-mines.svg?raw";
import mirage from "./mk-mirage.svg?raw";
import necropolises from "./mk-necropolises.svg?raw";
import party from "./mk-party.svg?raw";
import pirates from "./mk-pirates.svg?raw";
import portals from "./mk-portals.svg?raw";
import rifts from "./mk-rifts.svg?raw";
import ruins from "./mk-ruins.svg?raw";
import sacredForests from "./mk-sacred-forests.svg?raw";
import sacredMountains from "./mk-sacred-mountains.svg?raw";
import sacredPalmGroves from "./mk-sacred-palm-groves.svg?raw";
import sacredPineries from "./mk-sacred-pineries.svg?raw";
import seaMonsters from "./mk-sea-monsters.svg?raw";
import statues from "./mk-statues.svg?raw";
import volcanoes from "./mk-volcanoes.svg?raw";
import waterSources from "./mk-water-sources.svg?raw";
import waterfalls from "./mk-waterfalls.svg?raw";

const sources: Record<string, string> = {
  battlefields,
  bridges,
  brigands,
  canoes,
  caves,
  circuses,
  dances,
  "disturbed-burials": disturbedBurials,
  dungeons,
  encounters,
  fairs,
  "hill-monsters": hillMonsters,
  "hot-springs": hotSprings,
  inns,
  jousts,
  "lake-monsters": lakeMonsters,
  libraries,
  lighthouses,
  migration,
  mines,
  mirage,
  necropolises,
  party,
  pirates,
  portals,
  rifts,
  ruins,
  "sacred-forests": sacredForests,
  "sacred-mountains": sacredMountains,
  "sacred-palm-groves": sacredPalmGroves,
  "sacred-pineries": sacredPineries,
  "sea-monsters": seaMonsters,
  statues,
  volcanoes,
  "water-sources": waterSources,
  waterfalls
};

const dataUris: Record<string, string> = {};
for (const [type, svg] of Object.entries(sources)) {
  dataUris[type] = `data:image/svg+xml;base64,${btoa(svg)}`;
}

export function markerIcon(type: string, fallback: string): string {
  return dataUris[type] || fallback;
}
