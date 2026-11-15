// Dock doors and levellers in motion: at the bay the truck is using, the roll-up door goes up as
// the truck backs in (the dark inside showing from the floor up over the closed door the city
// draws), stays up through the stop and comes down as the truck pulls out; the leveller's lip
// swings out onto the truck's floor once it is docked and back as it leaves. A pure function of
// the journey state, so a scrub shows the same thing.
import * as THREE from "three@0.187.0";
import { ease } from "./truck.ts";
import { DOOR_H, DOOR_HALF, shade } from "./city.ts";
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
    const st = j.st, dock = st.mode === "reverse" || st.mode === "dwell" || st.mode === "drive" ? j.dock : null;
    let door: DockDoor | undefined, H = 0, open = 0, lip = 0;
    if (dock && (st.mode === "reverse" || st.mode === "dwell")) {
      door = dock.geom.door; H = dock.H;
      if (st.mode === "reverse") {
        const d = Math.hypot(j.pose.x - dock.edge.x, j.pose.z - dock.edge.z);
        open = THREE.MathUtils.clamp((16 - d) / 9, 0, 1);
      } else {
        open = 1;
        const ph = j.dwellPhase();
        lip = ph.phase === "park" ? ease(ph.t / ph.len) : ph.phase === "enter" ? 1 - ease(ph.t / ph.len) : ph.phase === "startup" ? 0 : 1;
      }
    } else if (st.mode === "drive" && st.route?.dock?.door) {
      // Pulling out of the bay: the door comes down behind the truck.
      door = st.route.dock.door; H = st.route.dock.H;
      open = 1 - THREE.MathUtils.clamp(st.s / 14, 0, 1);
    }
    this.hole.visible = !!door && open > 0.01;
    this.lip.visible = !!door && (st.mode === "dwell" || st.mode === "reverse");
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
// away; it also opens for the worker of a team lift going in or out. Drawn over the closed door
// the city draws (city.ts entranceDoor): the dark doorway, and the panel as it is seen swung in,
// a narrowing strip of it on the hinge side (the walls are solid, so it is drawn in the doorway).
export class FrontDoorFx {
  private hole: THREE.Mesh;
  private panel: THREE.Mesh;
  private pmat = new THREE.MeshLambertMaterial({ color: 0x7a2b22 });
  constructor(scene: THREE.Scene) {
    this.hole = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x15161a }));
    this.panel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.pmat);
    this.hole.visible = this.panel.visible = false;
    scene.add(this.hole, this.panel);
  }

  update(j: Journey, worker: THREE.Object3D | null) {
    const d = j.st.mode === "dwell" ? j.kerbDoor : null;
    let open = 0;
    if (d) {
      const ph = j.dwellPhase(), c = ph.chore;
      if (c?.kind === "fetch") { const u = ph.ct / c.len; open = THREE.MathUtils.smoothstep(u, 0.05, 0.3) * (1 - THREE.MathUtils.smoothstep(u, 0.7, 0.95)); }
      if (worker?.visible) open = Math.max(open, THREE.MathUtils.clamp((2.0 - Math.hypot(worker.position.x - d.x, worker.position.z - d.z)) / 0.9, 0, 1));
    }
    this.hole.visible = this.panel.visible = !!d && open > 0.01;
    if (!d || !this.hole.visible) return;
    const tx = -d.nz, tz = d.nx, yaw = Math.atan2(-tz, tx), y0 = CURB_H, W = DOOR_HALF * 2;   // t: along the wall
    this.hole.position.set(d.x + d.nx * 0.1, y0 + DOOR_H / 2, d.z + d.nz * 0.1);
    this.hole.rotation.set(0, yaw, 0);
    this.hole.scale.set(W, DOOR_H, 0.02);
    // Swung in by up to ~80 degrees: from outside it covers W cos(angle) of the doorway, in shade.
    const w = Math.max(0.04, W * Math.cos(1.4 * ease(open)));
    this.panel.position.set(d.x + d.nx * 0.115 - tx * (DOOR_HALF - w / 2), y0 + DOOR_H / 2, d.z + d.nz * 0.115 - tz * (DOOR_HALF - w / 2));
    this.panel.rotation.set(0, yaw, 0);
    this.panel.scale.set(w, DOOR_H, 0.02);
    this.pmat.color.setHex(shade(d.panel, 0.6 + 0.4 * (w / W)));
  }
}
