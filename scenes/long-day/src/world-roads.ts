// The world graph's roads and the cities' places on the world map (docs/long-day-cities.md). Drafted
// by tools/draftworld.ts; edited by hand from here on. Each road's map is its own file in roads/.
import type { WorldRoad } from "./world.ts";
import { ROAD_R0 } from "./roads/road-r0.ts";
import { ROAD_R1 } from "./roads/road-r1.ts";
import { ROAD_R2 } from "./roads/road-r2.ts";
import { ROAD_R3 } from "./roads/road-r3.ts";
import { ROAD_R4 } from "./roads/road-r4.ts";
import { ROAD_R5 } from "./roads/road-r5.ts";
import { ROAD_R6 } from "./roads/road-r6.ts";
import { ROAD_R7 } from "./roads/road-r7.ts";
import { ROAD_R8 } from "./roads/road-r8.ts";
import { ROAD_R9 } from "./roads/road-r9.ts";
import { ROAD_R10 } from "./roads/road-r10.ts";
import { ROAD_R11 } from "./roads/road-r11.ts";
import { ROAD_R12 } from "./roads/road-r12.ts";
import { ROAD_R13 } from "./roads/road-r13.ts";
import { ROAD_R14 } from "./roads/road-r14.ts";
import { ROAD_R15 } from "./roads/road-r15.ts";
import { ROAD_R16 } from "./roads/road-r16.ts";
import { ROAD_R17 } from "./roads/road-r17.ts";
import { ROAD_R18 } from "./roads/road-r18.ts";
import { ROAD_R19 } from "./roads/road-r19.ts";
import { ROAD_R20 } from "./roads/road-r20.ts";
import { ROAD_R21 } from "./roads/road-r21.ts";
import { ROAD_R22 } from "./roads/road-r22.ts";
import { ROAD_R23 } from "./roads/road-r23.ts";
import { ROAD_R24 } from "./roads/road-r24.ts";
import { ROAD_R25 } from "./roads/road-r25.ts";
import { ROAD_R26 } from "./roads/road-r26.ts";
import { ROAD_R27 } from "./roads/road-r27.ts";
import { ROAD_R28 } from "./roads/road-r28.ts";
import { ROAD_R29 } from "./roads/road-r29.ts";
import { ROAD_R30 } from "./roads/road-r30.ts";
import { ROAD_R31 } from "./roads/road-r31.ts";
import { ROAD_R32 } from "./roads/road-r32.ts";
import { ROAD_R33 } from "./roads/road-r33.ts";
import { ROAD_R34 } from "./roads/road-r34.ts";
import { ROAD_R35 } from "./roads/road-r35.ts";
import { ROAD_R36 } from "./roads/road-r36.ts";
import { ROAD_R37 } from "./roads/road-r37.ts";
import { ROAD_R38 } from "./roads/road-r38.ts";
import { ROAD_R39 } from "./roads/road-r39.ts";
import { ROAD_R40 } from "./roads/road-r40.ts";
import { ROAD_R41 } from "./roads/road-r41.ts";
import { ROAD_R42 } from "./roads/road-r42.ts";
import { ROAD_R43 } from "./roads/road-r43.ts";
import { ROAD_R44 } from "./roads/road-r44.ts";
import { ROAD_R45 } from "./roads/road-r45.ts";
import { ROAD_R46 } from "./roads/road-r46.ts";
import { ROAD_R47 } from "./roads/road-r47.ts";
import { ROAD_R48 } from "./roads/road-r48.ts";
import { ROAD_R49 } from "./roads/road-r49.ts";
import { ROAD_R50 } from "./roads/road-r50.ts";
import { ROAD_R51 } from "./roads/road-r51.ts";
import { ROAD_R52 } from "./roads/road-r52.ts";
import { ROAD_R53 } from "./roads/road-r53.ts";
import { ROAD_R54 } from "./roads/road-r54.ts";
import { ROAD_R55 } from "./roads/road-r55.ts";
import { ROAD_R56 } from "./roads/road-r56.ts";
import { ROAD_R57 } from "./roads/road-r57.ts";
import { ROAD_R58 } from "./roads/road-r58.ts";
import { ROAD_R59 } from "./roads/road-r59.ts";
import { ROAD_R60 } from "./roads/road-r60.ts";
import { ROAD_R61 } from "./roads/road-r61.ts";
import { ROAD_R62 } from "./roads/road-r62.ts";
import { ROAD_R63 } from "./roads/road-r63.ts";
import { ROAD_R64 } from "./roads/road-r64.ts";
import { ROAD_R65 } from "./roads/road-r65.ts";
import { ROAD_R66 } from "./roads/road-r66.ts";
import { ROAD_R67 } from "./roads/road-r67.ts";
import { ROAD_R68 } from "./roads/road-r68.ts";
import { ROAD_R69 } from "./roads/road-r69.ts";
import { ROAD_R70 } from "./roads/road-r70.ts";
import { ROAD_R71 } from "./roads/road-r71.ts";
import { ROAD_R72 } from "./roads/road-r72.ts";
import { ROAD_R73 } from "./roads/road-r73.ts";
import { ROAD_R74 } from "./roads/road-r74.ts";
import { ROAD_R75 } from "./roads/road-r75.ts";
import { ROAD_R76 } from "./roads/road-r76.ts";
import { ROAD_R77 } from "./roads/road-r77.ts";
import { ROAD_R78 } from "./roads/road-r78.ts";
import { ROAD_R79 } from "./roads/road-r79.ts";
import { ROAD_R80 } from "./roads/road-r80.ts";
import { ROAD_R81 } from "./roads/road-r81.ts";
import { ROAD_R82 } from "./roads/road-r82.ts";
import { ROAD_R83 } from "./roads/road-r83.ts";
import { ROAD_R84 } from "./roads/road-r84.ts";
import { ROAD_R85 } from "./roads/road-r85.ts";
import { ROAD_R86 } from "./roads/road-r86.ts";
import { ROAD_R87 } from "./roads/road-r87.ts";
import { ROAD_R88 } from "./roads/road-r88.ts";

export const WORLD_ROADS: WorldRoad[] = [
  { id: "r0", a: { city: "desert-sun-mesa", gate: "g7" }, b: { city: "coastal-fogcrest", gate: "g0" }, key: 1080527854, oneway: true, map: ROAD_R0 },
  { id: "r1", a: { city: "desert-dry-gulch", gate: "g1" }, b: { city: "coastal-golden-hollow", gate: "g0" }, key: 1755547491, oneway: true, map: ROAD_R1 },
  { id: "r2", a: { city: "desert-dry-gulch", gate: "g4" }, b: { city: "metro-grand-central", gate: "g0" }, key: 107996358, oneway: true, map: ROAD_R2 },
  { id: "r3", a: { city: "port-puget-point", gate: "g9" }, b: { city: "metro-new-harbor-city", gate: "g0" }, key: 238166157, oneway: true, map: ROAD_R3 },
  { id: "r4", a: { city: "port-gray-haven", gate: "g1" }, b: { city: "desert-palm-vista", gate: "g0" }, key: 931009280, oneway: true, map: ROAD_R4 },
  { id: "r5", a: { city: "coastal-twin-peaks-bay", gate: "g3" }, b: { city: "desert-red-rock", gate: "g0" }, key: 2069349943, oneway: true, map: ROAD_R5 },
  { id: "r6", a: { city: "coastal-seacliff", gate: "g6" }, b: { city: "desert-saguaro-springs", gate: "g0" }, key: 1918441399, oneway: true, map: ROAD_R6 },
  { id: "r7", a: { city: "coastal-golden-hollow", gate: "g5" }, b: { city: "desert-sun-mesa", gate: "g0" }, key: 1426325961, oneway: true, map: ROAD_R7 },
  { id: "r8", a: { city: "port-rainier-bay", gate: "g1" }, b: { city: "brick-foundry-falls", gate: "g0" }, key: 468094128, oneway: true, map: ROAD_R8 },
  { id: "r9", a: { city: "port-rainier-bay", gate: "g6" }, b: { city: "brick-ironworks", gate: "g0" }, key: 2074374049, oneway: true, map: ROAD_R9 },
  { id: "r10", a: { city: "storybook-wumbleton", gate: "g7" }, b: { city: "brick-steelton", gate: "g0" }, key: 1729899044, oneway: true, map: ROAD_R10 },
  { id: "r11", a: { city: "metro-new-harbor-city", gate: "g12" }, b: { city: "port-gray-haven", gate: "g0" }, key: 543470743, oneway: true, map: ROAD_R11 },
  { id: "r12", a: { city: "storybook-tumbledown-tuft", gate: "g7" }, b: { city: "port-puget-point", gate: "g0" }, key: 701501974, oneway: true, map: ROAD_R12 },
  { id: "r13", a: { city: "mainstreet-maple-falls", gate: "g4" }, b: { city: "port-rainier-bay", gate: "g0" }, key: 1461257090, oneway: true, map: ROAD_R13 },
  { id: "r14", a: { city: "metro-metropolis-heights", gate: "g4" }, b: { city: "mainstreet-cedar-junction", gate: "g0" }, key: 1666715639, map: ROAD_R14 },
  { id: "r15", a: { city: "port-ferryport", gate: "g1" }, b: { city: "brick-brickport", gate: "g0" }, key: 1023884293, map: ROAD_R15 },
  { id: "r16", a: { city: "metro-midtown", gate: "g1" }, b: { city: "mainstreet-elm-grove", gate: "g0" }, key: 2085876337, map: ROAD_R16 },
  { id: "r17", a: { city: "metro-empire-point", gate: "g10" }, b: { city: "mainstreet-pleasantville", gate: "g1" }, key: 103763242, map: ROAD_R17 },
  { id: "r18", a: { city: "coastal-bayview", gate: "g5" }, b: { city: "mainstreet-willow-creek", gate: "g1" }, key: 851153385, map: ROAD_R18 },
  { id: "r19", a: { city: "storybook-higgle-on-the-wobble", gate: "g10" }, b: { city: "brick-millbrook", gate: "g1" }, key: 1651723201, map: ROAD_R19 },
  { id: "r20", a: { city: "storybook-snickerwick", gate: "g4" }, b: { city: "port-north-harbor", gate: "g0" }, key: 552266199, map: ROAD_R20 },
  { id: "r21", a: { city: "storybook-fizzlebury", gate: "g7" }, b: { city: "brick-steelton", gate: "g1" }, key: 140643635, map: ROAD_R21 },
  { id: "r22", a: { city: "desert-red-rock", gate: "g1" }, b: { city: "mainstreet-elm-grove", gate: "g4" }, key: 1997032871, map: ROAD_R22 },
  { id: "r23", a: { city: "coastal-seacliff", gate: "g1" }, b: { city: "mainstreet-cedar-junction", gate: "g4" }, key: 628152180, map: ROAD_R23 },
  { id: "r24", a: { city: "metro-grand-central", gate: "g3" }, b: { city: "coastal-fogcrest", gate: "g1" }, key: 1958709963, map: ROAD_R24 },
  { id: "r25", a: { city: "metro-metropolis-heights", gate: "g2" }, b: { city: "brick-foundry-falls", gate: "g4" }, key: 1229767608, map: ROAD_R25 },
  { id: "r26", a: { city: "coastal-twin-peaks-bay", gate: "g5" }, b: { city: "port-north-harbor", gate: "g1" }, key: 1120848083, map: ROAD_R26 },
  { id: "r27", a: { city: "storybook-higgle-on-the-wobble", gate: "g8" }, b: { city: "metro-empire-point", gate: "g0" }, key: 1057372410, map: ROAD_R27 },
  { id: "r28", a: { city: "coastal-bayview", gate: "g7" }, b: { city: "metro-midtown", gate: "g2" }, key: 1609877267, map: ROAD_R28 },
  { id: "r29", a: { city: "mainstreet-willow-creek", gate: "g11" }, b: { city: "desert-palm-vista", gate: "g1" }, key: 77727519, map: ROAD_R29 },
  { id: "r30", a: { city: "mainstreet-maple-falls", gate: "g8" }, b: { city: "brick-millbrook", gate: "g0" }, key: 1072004546, map: ROAD_R30 },
  { id: "r31", a: { city: "storybook-wumbleton", gate: "g2" }, b: { city: "port-ferryport", gate: "g4" }, key: 1027554057, map: ROAD_R31 },
  { id: "r32", a: { city: "brick-brickport", gate: "g9" }, b: { city: "mainstreet-pleasantville", gate: "g0" }, key: 2127298515, map: ROAD_R32 },
  { id: "r33", a: { city: "storybook-snickerwick", gate: "g0" }, b: { city: "brick-ironworks", gate: "g1" }, key: 618593974, map: ROAD_R33 },
  { id: "r34", a: { city: "desert-saguaro-springs", gate: "g7" }, b: { city: "mainstreet-maple-falls", gate: "g0" }, key: 1074977758, map: ROAD_R34 },
  { id: "r35", a: { city: "storybook-tumbledown-tuft", gate: "g1" }, b: { city: "mainstreet-cedar-junction", gate: "g5" }, key: 1259798642, map: ROAD_R35 },
  { id: "r36", a: { city: "storybook-fizzlebury", gate: "g1" }, b: { city: "desert-dry-gulch", gate: "g0" }, key: 970529478, map: ROAD_R36 },
  { id: "r37", a: { city: "metro-new-harbor-city", gate: "g10" }, b: { city: "desert-saguaro-springs", gate: "g1" }, key: 756068682, map: ROAD_R37 },
  { id: "r38", a: { city: "desert-sun-mesa", gate: "g2" }, b: { city: "brick-steelton", gate: "g4" }, key: 1974318028, map: ROAD_R38 },
  { id: "r39", a: { city: "coastal-golden-hollow", gate: "g6" }, b: { city: "mainstreet-pleasantville", gate: "g2" }, key: 1763334117, map: ROAD_R39 },
  { id: "r40", a: { city: "brick-ironworks", gate: "g6" }, b: { city: "metro-midtown", gate: "g0" }, key: 1154797495, map: ROAD_R40 },
  { id: "r41", a: { city: "metro-metropolis-heights", gate: "g10" }, b: { city: "coastal-bayview", gate: "g1" }, key: 234941237, map: ROAD_R41 },
  { id: "r42", a: { city: "coastal-fogcrest", gate: "g6" }, b: { city: "mainstreet-elm-grove", gate: "g1" }, key: 831624933, map: ROAD_R42 },
  { id: "r43", a: { city: "metro-grand-central", gate: "g8" }, b: { city: "port-ferryport", gate: "g0" }, key: 295751542, map: ROAD_R43 },
  { id: "r44", a: { city: "coastal-twin-peaks-bay", gate: "g9" }, b: { city: "brick-millbrook", gate: "g2" }, key: 1518869403, map: ROAD_R44 },
  { id: "r45", a: { city: "metro-empire-point", gate: "g1" }, b: { city: "brick-foundry-falls", gate: "g5" }, key: 2086148408, map: ROAD_R45 },
  { id: "r46", a: { city: "port-north-harbor", gate: "g5" }, b: { city: "desert-red-rock", gate: "g2" }, key: 1187911560, map: ROAD_R46 },
  { id: "r47", a: { city: "storybook-fizzlebury", gate: "g0" }, b: { city: "port-gray-haven", gate: "g4" }, key: 1643917862, map: ROAD_R47 },
  { id: "r48", a: { city: "mainstreet-willow-creek", gate: "g7" }, b: { city: "port-puget-point", gate: "g1" }, key: 2029190895, map: ROAD_R48 },
  { id: "r49", a: { city: "storybook-higgle-on-the-wobble", gate: "g5" }, b: { city: "coastal-seacliff", gate: "g0" }, key: 1775373261, map: ROAD_R49 },
  { id: "r50", a: { city: "brick-brickport", gate: "g6" }, b: { city: "desert-palm-vista", gate: "g2" }, key: 996074528, map: ROAD_R50 },
  { id: "r51", a: { city: "storybook-tumbledown-tuft", gate: "g12" }, b: { city: "metro-midtown", gate: "g3" }, key: 582522569, map: ROAD_R51 },
  { id: "r52", a: { city: "storybook-wumbleton", gate: "g1" }, b: { city: "coastal-bayview", gate: "g0" }, key: 1488234659, map: ROAD_R52 },
  { id: "r53", a: { city: "storybook-snickerwick", gate: "g2" }, b: { city: "metro-grand-central", gate: "g4" }, key: 1365844524, map: ROAD_R53 },
  { id: "r54", a: { city: "coastal-golden-hollow", gate: "g9" }, b: { city: "brick-brickport", gate: "g1" }, key: 155872799, map: ROAD_R54 },
  { id: "r55", a: { city: "desert-sun-mesa", gate: "g8" }, b: { city: "mainstreet-pleasantville", gate: "g3" }, key: 1445000377, map: ROAD_R55 },
  { id: "r56", a: { city: "metro-new-harbor-city", gate: "g7" }, b: { city: "brick-steelton", gate: "g2" }, key: 1850891266, map: ROAD_R56 },
  { id: "r57", a: { city: "brick-foundry-falls", gate: "g2" }, b: { city: "coastal-twin-peaks-bay", gate: "g4" }, key: 1896446212, map: ROAD_R57 },
  { id: "r58", a: { city: "port-rainier-bay", gate: "g9" }, b: { city: "desert-red-rock", gate: "g3" }, key: 1424179210, map: ROAD_R58 },
  { id: "r59", a: { city: "metro-empire-point", gate: "g8" }, b: { city: "coastal-seacliff", gate: "g2" }, key: 595228278, map: ROAD_R59 },
  { id: "r60", a: { city: "storybook-snickerwick", gate: "g12" }, b: { city: "desert-saguaro-springs", gate: "g2" }, key: 1186106799, map: ROAD_R60 },
  { id: "r61", a: { city: "storybook-fizzlebury", gate: "g11" }, b: { city: "mainstreet-willow-creek", gate: "g0" }, key: 1721362483, map: ROAD_R61 },
  { id: "r62", a: { city: "brick-ironworks", gate: "g8" }, b: { city: "mainstreet-maple-falls", gate: "g1" }, key: 384375913, map: ROAD_R62 },
  { id: "r63", a: { city: "port-gray-haven", gate: "g7" }, b: { city: "brick-millbrook", gate: "g3" }, key: 695036096, map: ROAD_R63 },
  { id: "r64", a: { city: "storybook-higgle-on-the-wobble", gate: "g3" }, b: { city: "mainstreet-cedar-junction", gate: "g6" }, key: 1433149746, map: ROAD_R64 },
  { id: "r65", a: { city: "mainstreet-elm-grove", gate: "g11" }, b: { city: "port-puget-point", gate: "g2" }, key: 871146650, map: ROAD_R65 },
  { id: "r66", a: { city: "storybook-wumbleton", gate: "g6" }, b: { city: "metro-metropolis-heights", gate: "g0" }, key: 230464388, map: ROAD_R66 },
  { id: "r67", a: { city: "coastal-fogcrest", gate: "g9" }, b: { city: "port-ferryport", gate: "g2" }, key: 1454003873, map: ROAD_R67 },
  { id: "r68", a: { city: "desert-palm-vista", gate: "g11" }, b: { city: "metro-grand-central", gate: "g1" }, key: 640095248, map: ROAD_R68 },
  { id: "r69", a: { city: "storybook-tumbledown-tuft", gate: "g11" }, b: { city: "desert-dry-gulch", gate: "g2" }, key: 1226843942, map: ROAD_R69 },
  { id: "r70", a: { city: "port-north-harbor", gate: "g3" }, b: { city: "metro-metropolis-heights", gate: "g5" }, key: 1684689693, map: ROAD_R70 },
  { id: "r71", a: { city: "coastal-bayview", gate: "g6" }, b: { city: "port-rainier-bay", gate: "g2" }, key: 391675941, map: ROAD_R71 },
  { id: "r72", a: { city: "desert-sun-mesa", gate: "g4" }, b: { city: "port-ferryport", gate: "g3" }, key: 1567272513, map: ROAD_R72 },
  { id: "r73", a: { city: "mainstreet-cedar-junction", gate: "g3" }, b: { city: "port-north-harbor", gate: "g4" }, key: 852550121, map: ROAD_R73 },
  { id: "r74", a: { city: "coastal-twin-peaks-bay", gate: "g8" }, b: { city: "mainstreet-maple-falls", gate: "g2" }, key: 1671579365, map: ROAD_R74 },
  { id: "r75", a: { city: "desert-dry-gulch", gate: "g6" }, b: { city: "brick-millbrook", gate: "g7" }, key: 1807400043, map: ROAD_R75 },
  { id: "r76", a: { city: "desert-red-rock", gate: "g8" }, b: { city: "metro-midtown", gate: "g4" }, key: 1159911059, map: ROAD_R76 },
  { id: "r77", a: { city: "brick-foundry-falls", gate: "g7" }, b: { city: "desert-palm-vista", gate: "g3" }, key: 54917204, map: ROAD_R77 },
  { id: "r78", a: { city: "brick-steelton", gate: "g3" }, b: { city: "mainstreet-elm-grove", gate: "g5" }, key: 1436222951, map: ROAD_R78 },
  { id: "r79", a: { city: "coastal-golden-hollow", gate: "g1" }, b: { city: "port-puget-point", gate: "g4" }, key: 1874575877, map: ROAD_R79 },
  { id: "r80", a: { city: "metro-new-harbor-city", gate: "g3" }, b: { city: "coastal-fogcrest", gate: "g2" }, key: 81341855, map: ROAD_R80 },
  { id: "r81", a: { city: "brick-brickport", gate: "g11" }, b: { city: "metro-empire-point", gate: "g2" }, key: 1798143862, map: ROAD_R81 },
  { id: "r82", a: { city: "brick-ironworks", gate: "g12" }, b: { city: "desert-saguaro-springs", gate: "g3" }, key: 1515575488, map: ROAD_R82 },
  { id: "r83", a: { city: "storybook-tumbledown-tuft", gate: "g6" }, b: { city: "coastal-seacliff", gate: "g3" }, key: 1299944142, map: ROAD_R83 },
  { id: "r84", a: { city: "mainstreet-pleasantville", gate: "g10" }, b: { city: "port-gray-haven", gate: "g2" }, key: 146076198, map: ROAD_R84 },
  { id: "r85", a: { city: "storybook-wumbleton", gate: "g8" }, b: { city: "mainstreet-willow-creek", gate: "g2" }, key: 1035321973, map: ROAD_R85 },
  { id: "r86", a: { city: "storybook-snickerwick", gate: "g8" }, b: { city: "coastal-seacliff", gate: "g4" }, key: 166916099, map: ROAD_R86 },
  { id: "r87", a: { city: "storybook-higgle-on-the-wobble", gate: "g6" }, b: { city: "port-puget-point", gate: "g3" }, key: 257544775, map: ROAD_R87 },
  { id: "r88", a: { city: "storybook-fizzlebury", gate: "g5" }, b: { city: "metro-new-harbor-city", gate: "g1" }, key: 277164085, map: ROAD_R88 },
];

// (Each city's place, x east and z south, in arbitrary units: for the world map only.)
export const WORLD_PLACES: Record<string, [number, number]> = {
  "coastal-bayview": [3190, 3461],
  "coastal-fogcrest": [0, 2337],
  "coastal-golden-hollow": [524, 493],
  "coastal-seacliff": [982, 1680],
  "coastal-twin-peaks-bay": [2026, 2536],
  "metro-empire-point": [1732, 340],
  "metro-grand-central": [381, 2138],
  "metro-metropolis-heights": [2945, 2717],
  "metro-midtown": [2042, 3896],
  "metro-new-harbor-city": [1225, 2340],
  "desert-dry-gulch": [964, 1198],
  "desert-palm-vista": [2455, 1456],
  "desert-red-rock": [1797, 3856],
  "desert-saguaro-springs": [765, 3373],
  "desert-sun-mesa": [157, 1195],
  "brick-brickport": [1105, 355],
  "brick-foundry-falls": [2905, 1970],
  "brick-ironworks": [1333, 4166],
  "brick-millbrook": [1986, 1415],
  "brick-steelton": [1680, 2648],
  "mainstreet-cedar-junction": [1714, 1644],
  "mainstreet-elm-grove": [1174, 3352],
  "mainstreet-maple-falls": [1793, 3407],
  "mainstreet-pleasantville": [981, 0],
  "mainstreet-willow-creek": [3077, 2303],
  "port-ferryport": [336, 1686],
  "port-gray-haven": [2185, 900],
  "port-north-harbor": [1562, 2970],
  "port-puget-point": [1473, 1829],
  "port-rainier-bay": [2581, 3852],
  "storybook-fizzlebury": [2212, 1857],
  "storybook-higgle-on-the-wobble": [1661, 867],
  "storybook-snickerwick": [448, 3148],
  "storybook-tumbledown-tuft": [1134, 2047],
  "storybook-wumbleton": [2595, 2864],
};
