// The world (docs/fixed-cities.md): every catalogue city, and the country roads joining them
// (world-roads.ts). This list is the catalogue: a city is in it once its file is imported and
// listed here.
import type { CityFile } from "./cityfile.ts";
import type { RoadMap } from "./roadmap.ts";

// A country road (requirements 10 and 11): it joins gate `a.gate` of city `a.city` to gate `b.gate`
// of `b.city`, each gate serving this road alone. `map`: the road itself (roadmap.ts), its length
// among it; how long the drive takes follows from the truck's speed and its stops on the way
// (country.ts). `key`: what the drafting tool's rules hashed. `oneway`: driven only from a to b
// (into a freeway city's way in, where the freeway runs out of town).
export interface WorldRoad { id: string; a: { city: string; gate: string }; b: { city: string; gate: string }; key: number; oneway?: true; map: RoadMap }
import { CITY_COASTAL_BAYVIEW } from "./city-coastal/bayview/bayview.ts";
import { CITY_COASTAL_FOGCREST } from "./city-coastal/fogcrest/fogcrest.ts";
import { CITY_COASTAL_GOLDEN_HOLLOW } from "./city-coastal/golden-hollow/golden-hollow.ts";
import { CITY_COASTAL_SEACLIFF } from "./city-coastal/seacliff/seacliff.ts";
import { CITY_COASTAL_TWIN_PEAKS_BAY } from "./city-coastal/twin-peaks-bay/twin-peaks-bay.ts";
import { CITY_METRO_EMPIRE_POINT } from "./city-metro/empire-point/empire-point.ts";
import { CITY_METRO_GRAND_CENTRAL } from "./city-metro/grand-central/grand-central.ts";
import { CITY_METRO_METROPOLIS_HEIGHTS } from "./city-metro/metropolis-heights/metropolis-heights.ts";
import { CITY_METRO_MIDTOWN } from "./city-metro/midtown/midtown.ts";
import { CITY_METRO_NEW_HARBOR_CITY } from "./city-metro/new-harbor-city/new-harbor-city.ts";
import { CITY_DESERT_DRY_GULCH } from "./city-desert/dry-gulch/dry-gulch.ts";
import { CITY_DESERT_PALM_VISTA } from "./city-desert/palm-vista/palm-vista.ts";
import { CITY_DESERT_RED_ROCK } from "./city-desert/red-rock/red-rock.ts";
import { CITY_DESERT_SAGUARO_SPRINGS } from "./city-desert/saguaro-springs/saguaro-springs.ts";
import { CITY_DESERT_SUN_MESA } from "./city-desert/sun-mesa/sun-mesa.ts";
import { CITY_BRICK_BRICKPORT } from "./city-brick/brickport/brickport.ts";
import { CITY_BRICK_FOUNDRY_FALLS } from "./city-brick/foundry-falls/foundry-falls.ts";
import { CITY_BRICK_IRONWORKS } from "./city-brick/ironworks/ironworks.ts";
import { CITY_BRICK_MILLBROOK } from "./city-brick/millbrook/millbrook.ts";
import { CITY_BRICK_STEELTON } from "./city-brick/steelton/steelton.ts";
import { CITY_MAINSTREET_CEDAR_JUNCTION } from "./city-mainstreet/cedar-junction/cedar-junction.ts";
import { CITY_MAINSTREET_ELM_GROVE } from "./city-mainstreet/elm-grove/elm-grove.ts";
import { CITY_MAINSTREET_MAPLE_FALLS } from "./city-mainstreet/maple-falls/maple-falls.ts";
import { CITY_MAINSTREET_PLEASANTVILLE } from "./city-mainstreet/pleasantville/pleasantville.ts";
import { CITY_MAINSTREET_WILLOW_CREEK } from "./city-mainstreet/willow-creek/willow-creek.ts";
import { CITY_PORT_FERRYPORT } from "./city-port/ferryport/ferryport.ts";
import { CITY_PORT_GRAY_HAVEN } from "./city-port/gray-haven/gray-haven.ts";
import { CITY_PORT_NORTH_HARBOR } from "./city-port/north-harbor/north-harbor.ts";
import { CITY_PORT_PUGET_POINT } from "./city-port/puget-point/puget-point.ts";
import { CITY_PORT_RAINIER_BAY } from "./city-port/rainier-bay/rainier-bay.ts";
import { CITY_STORYBOOK_FIZZLEBURY } from "./city-storybook/fizzlebury/fizzlebury.ts";
import { CITY_STORYBOOK_HIGGLE_ON_THE_WOBBLE } from "./city-storybook/higgle-on-the-wobble/higgle-on-the-wobble.ts";
import { CITY_STORYBOOK_SNICKERWICK } from "./city-storybook/snickerwick/snickerwick.ts";
import { CITY_STORYBOOK_TUMBLEDOWN_TUFT } from "./city-storybook/tumbledown-tuft/tumbledown-tuft.ts";
import { CITY_STORYBOOK_WUMBLETON } from "./city-storybook/wumbleton/wumbleton.ts";

export const CATALOGUE: CityFile[] = [
  CITY_COASTAL_BAYVIEW,
  CITY_COASTAL_FOGCREST,
  CITY_COASTAL_GOLDEN_HOLLOW,
  CITY_COASTAL_SEACLIFF,
  CITY_COASTAL_TWIN_PEAKS_BAY,
  CITY_METRO_EMPIRE_POINT,
  CITY_METRO_GRAND_CENTRAL,
  CITY_METRO_METROPOLIS_HEIGHTS,
  CITY_METRO_MIDTOWN,
  CITY_METRO_NEW_HARBOR_CITY,
  CITY_DESERT_DRY_GULCH,
  CITY_DESERT_PALM_VISTA,
  CITY_DESERT_RED_ROCK,
  CITY_DESERT_SAGUARO_SPRINGS,
  CITY_DESERT_SUN_MESA,
  CITY_BRICK_BRICKPORT,
  CITY_BRICK_FOUNDRY_FALLS,
  CITY_BRICK_IRONWORKS,
  CITY_BRICK_MILLBROOK,
  CITY_BRICK_STEELTON,
  CITY_MAINSTREET_CEDAR_JUNCTION,
  CITY_MAINSTREET_ELM_GROVE,
  CITY_MAINSTREET_MAPLE_FALLS,
  CITY_MAINSTREET_PLEASANTVILLE,
  CITY_MAINSTREET_WILLOW_CREEK,
  CITY_PORT_FERRYPORT,
  CITY_PORT_GRAY_HAVEN,
  CITY_PORT_NORTH_HARBOR,
  CITY_PORT_PUGET_POINT,
  CITY_PORT_RAINIER_BAY,
  CITY_STORYBOOK_FIZZLEBURY,
  CITY_STORYBOOK_HIGGLE_ON_THE_WOBBLE,
  CITY_STORYBOOK_SNICKERWICK,
  CITY_STORYBOOK_TUMBLEDOWN_TUFT,
  CITY_STORYBOOK_WUMBLETON,
];
