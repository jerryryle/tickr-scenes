// Dock doors and levellers in motion: at the bay the truck is using, the roll-up door goes up as
// the truck backs in (the dark inside showing from the floor up over the closed door the city
// draws), stays up through the stop and comes down as the truck pulls out; the leveller's lip
// swings out onto the truck's floor once it is docked and back as it leaves. A pure function of
// the journey state, so a scrub shows the same thing.
import * as THREE from "three@0.187.0";
import { ease } from "./truck.ts";
import { DOOR_H, shade } from "./city.ts";
import { CURB_H } from "./grid.ts";
import { DOCK_PLATFORM } from "./facilities.ts";
import type { DockDoor } from "./route.ts";
import { Journey } from "./journey.ts";

export class DockFx {
  private hole: THREE.Mesh;
  private lip: THREE.Group;
  constructor(scene: THREE.Scene) {
    this.hole = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x121416 }));
    this.hole.visible = false; scene.add(this.hole);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 2.0), new THREE.MeshLambertMaterial({ color: 0x70757a }));
    plate.position.x = 0.225;
    this.lip = new THREE.Group(); this.lip.add(plate); this.lip.visible = false; scene.add(this.lip);
  }

  update(j: Journey) {
    const st = j.st, dock = st.mode === "reverse" || st.mode === "dwell" ? j.dock : null;
    let door: DockDoor | undefined, H = 0, open = 0, lip = 0;
    // Along the bay path, as the truck is drawn (between steps); its leading axle, a tractor's
    // trailer's, is `trail` short of it, docked at 0.
    const s = st.s - (1 - j.alpha) * j.lastStep;
    if (dock) {
      door = dock.geom.door; H = dock.H;
      if (st.mode === "reverse") {
        open = THREE.MathUtils.clamp((13.5 - (s - dock.trail)) / 9, 0, 1);   // all the way up 4.5 m out
      } else {
        open = 1;
        const ph = j.dwellPhase();
        lip = ph.phase === "park" ? ease(ph.t / ph.len) : ph.phase === "enter" ? 1 - ease(ph.t / ph.len) : ph.phase === "startup" ? 0 : 1;
      }
    } else if (st.mode === "drive") {
      // Waiting in the bay for the route out (dockExit), the door stays up; pulling out, it comes
      // down behind the truck, from where the route starts in the bay (a tractor's trail along).
      // On the way to a dock stop, its door is shut and the lip hangs ready; from one bay to
      // another, the lip moves to the next half way there, once (the way only goes forward).
      const k = st.dockExit?.geom ?? st.route?.dock;
      if (k?.door) {
        door = k.door; H = k.H;
        open = st.dockExit ? 1 : 1 - THREE.MathUtils.clamp((s - k.trail) / 14, 0, 1);
      }
      const next = st.dockExit || open > 0.01 ? null : j.dock, nd = next?.geom.door;
      if (nd && (!k?.door || s >= (k.trail + st.stopS) / 2)) {
        door = nd; H = next!.H; open = 0;
      }
    }
    this.hole.visible = !!door && open > 0.01;
    // The lip, hanging but for the stop, from when the route to the bay starts to when the route
    // out ends: it comes and goes away from the truck, never popping in or out beside it.
    this.lip.visible = !!door;
    if (!door) return;
    const fx = Math.cos(H), fz = -Math.sin(H), P = DOCK_PLATFORM;
    if (this.hole.visible) {
      const h = door.h * ease(open);
      this.hole.position.set(door.x + fx * 0.12, P + h / 2, door.z + fz * 0.12);
      this.hole.rotation.set(0, H, 0);
      this.hole.scale.set(0.04, h, door.w * 2);
    }
    if (this.lip.visible) {
      this.lip.position.set(door.lx, P - 0.02, door.lz);
      this.lip.rotation.set(0, H, -Math.PI / 2 + (Math.PI / 2 - 0.2) * ease(lip), "YXZ");   // hanging, then out onto the truck's floor
    }
  }
}

// A kerb stop's front door (journey.kerbDoor): it swings open into the building as the driver
// reaches it, stays open while the load goes in or comes out, and closes before the driver turns
// away; it also opens for the worker of a team lift going in or out, and for the forklift at a
// flatbed (`forkOpen`, from the crew). Drawn over the closed door the city draws (city.ts
// entranceDoor): the dark doorway, and each leaf as it is seen swung in, a narrowing strip of it
// on its hinge side (the walls are solid, so it is drawn in the doorway). A wide service door has
// two leaves, hinged at either side.
export class FrontDoorFx {
  private hole: THREE.Mesh;
  private leaves: THREE.Mesh[];
  private pmat = new THREE.MeshLambertMaterial({ color: 0x7a2b22 });
  constructor(scene: THREE.Scene) {
    this.hole = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x15161a }));
    this.leaves = [0, 1].map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.pmat));
    this.hole.visible = false;
    for (const l of this.leaves) l.visible = false;
    scene.add(this.hole, ...this.leaves);
  }

  update(j: Journey, worker: THREE.Object3D | null, forkOpen = 0) {
    const d = j.st.mode === "dwell" ? j.kerbDoor : null;
    let open = 0;
    if (d) {
      open = j.frontDoorOpen;
      if (worker?.visible) open = Math.max(open, THREE.MathUtils.clamp((2.0 - Math.hypot(worker.position.x - d.x, worker.position.z - d.z)) / 0.9, 0, 1));
      open = Math.max(open, forkOpen);
    }
    const show = !!d && open > 0.01;
    this.hole.visible = show;
    const two = !!d && d.wide;
    this.leaves[0].visible = show; this.leaves[1].visible = show && two;
    if (!d || !show) return;
    const tx = -d.nz, tz = d.nx, yaw = Math.atan2(-tz, tx), y0 = d.y ?? CURB_H, W = d.half * 2, H = d.h;   // t: along the wall
    this.hole.position.set(d.x + d.nx * 0.1, y0 + H / 2, d.z + d.nz * 0.1);
    this.hole.rotation.set(0, yaw, 0);
    this.hole.scale.set(W, H, 0.02);
    // Swung in by up to ~80 degrees: from outside a leaf covers its width cos(angle), in shade.
    const LW = two ? d.half : W, w = Math.max(0.04, LW * Math.cos(1.4 * ease(open)));
    (two ? [-1, 1] : [-1]).forEach((k, i) => {
      const off = k * (d.half - w / 2), leaf = this.leaves[i];
      leaf.position.set(d.x + d.nx * 0.115 + tx * off, y0 + H / 2, d.z + d.nz * 0.115 + tz * off);
      leaf.rotation.set(0, yaw, 0);
      leaf.scale.set(w, H, 0.02);
    });
    this.pmat.color.setHex(shade(d.panel, 0.6 + 0.4 * (w / LW)));
  }
}
