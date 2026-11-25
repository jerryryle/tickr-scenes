// The world (docs/fixed-cities.md): every catalogue city. This list is the catalogue: a city is
// in it once its file is imported and listed here.
import type { CityFile } from "./cityfile.ts";
import { CITY_COASTAL_BAYVIEW } from "./city-coastal/coastal-city-bayview.ts";
import { CITY_COASTAL_FOGCREST } from "./city-coastal/coastal-city-fogcrest.ts";
import { CITY_COASTAL_GOLDEN_HOLLOW } from "./city-coastal/coastal-city-golden-hollow.ts";
import { CITY_COASTAL_SEACLIFF } from "./city-coastal/coastal-city-seacliff.ts";
import { CITY_COASTAL_TWIN_PEAKS_BAY } from "./city-coastal/coastal-city-twin-peaks-bay.ts";
import { CITY_METRO_EMPIRE_POINT } from "./city-metro/metro-city-empire-point.ts";
import { CITY_METRO_GRAND_CENTRAL } from "./city-metro/metro-city-grand-central.ts";
import { CITY_METRO_METROPOLIS_HEIGHTS } from "./city-metro/metro-city-metropolis-heights.ts";
import { CITY_METRO_MIDTOWN } from "./city-metro/metro-city-midtown.ts";
import { CITY_METRO_NEW_HARBOR_CITY } from "./city-metro/metro-city-new-harbor-city.ts";
import { CITY_DESERT_DRY_GULCH } from "./city-desert/desert-city-dry-gulch.ts";
import { CITY_DESERT_PALM_VISTA } from "./city-desert/desert-city-palm-vista.ts";
import { CITY_DESERT_RED_ROCK } from "./city-desert/desert-city-red-rock.ts";
import { CITY_DESERT_SAGUARO_SPRINGS } from "./city-desert/desert-city-saguaro-springs.ts";
import { CITY_DESERT_SUN_MESA } from "./city-desert/desert-city-sun-mesa.ts";
import { CITY_BRICK_BRICKPORT } from "./city-brick/brick-city-brickport.ts";
import { CITY_BRICK_FOUNDRY_FALLS } from "./city-brick/brick-city-foundry-falls.ts";
import { CITY_BRICK_IRONWORKS } from "./city-brick/brick-city-ironworks.ts";
import { CITY_BRICK_MILLBROOK } from "./city-brick/brick-city-millbrook.ts";
import { CITY_BRICK_STEELTON } from "./city-brick/brick-city-steelton.ts";
import { CITY_MAINSTREET_CEDAR_JUNCTION } from "./city-mainstreet/mainstreet-city-cedar-junction.ts";
import { CITY_MAINSTREET_ELM_GROVE } from "./city-mainstreet/mainstreet-city-elm-grove.ts";
import { CITY_MAINSTREET_MAPLE_FALLS } from "./city-mainstreet/mainstreet-city-maple-falls.ts";
import { CITY_MAINSTREET_PLEASANTVILLE } from "./city-mainstreet/mainstreet-city-pleasantville.ts";
import { CITY_MAINSTREET_WILLOW_CREEK } from "./city-mainstreet/mainstreet-city-willow-creek.ts";
import { CITY_PORT_FERRYPORT } from "./city-port/port-city-ferryport.ts";
import { CITY_PORT_GRAY_HAVEN } from "./city-port/port-city-gray-haven.ts";
import { CITY_PORT_NORTH_HARBOR } from "./city-port/port-city-north-harbor.ts";
import { CITY_PORT_PUGET_POINT } from "./city-port/port-city-puget-point.ts";
import { CITY_PORT_RAINIER_BAY } from "./city-port/port-city-rainier-bay.ts";
import { CITY_STORYBOOK_FIZZLEBURY } from "./city-storybook/storybook-city-fizzlebury.ts";
import { CITY_STORYBOOK_HIGGLE_ON_THE_WOBBLE } from "./city-storybook/storybook-city-higgle-on-the-wobble.ts";
import { CITY_STORYBOOK_SNICKERWICK } from "./city-storybook/storybook-city-snickerwick.ts";
import { CITY_STORYBOOK_TUMBLEDOWN_TUFT } from "./city-storybook/storybook-city-tumbledown-tuft.ts";
import { CITY_STORYBOOK_WUMBLETON } from "./city-storybook/storybook-city-wumbleton.ts";

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
