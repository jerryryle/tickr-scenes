// The tickr scene API, as the workspace's scene_api_types returns it (toolkit 1.3.13).
// Refresh this file when the toolkit's release changes.

declare global {
  /** Runtime facilities handed to every scene. */
  interface SceneSys {
    /** Canvas width in pixels. Size what you draw from it so the scene scales with the screen; the supported screen size is 384x128. */
    readonly width: number;
    /** Canvas height in pixels. Size what you draw from it so the scene scales with the screen; the supported screen size is 384x128. */
    readonly height: number;
    /** Print to the app console (debugging). */
    log(...args: unknown[]): void;
    /** Optional: tell the player the scene has reached its natural end. An "OR until done" entry ends at once, an "AND until done" entry once its duration has also passed, and a scene that is a sequence's only entry or is played on its own starts again from the beginning. Stops nothing, and only the first call counts. */
    done(): void;
    /** Aborted at shutdown — pass to fetch / timers so in-flight work cancels. */
    readonly signal: AbortSignal;
    /** true in the browser preview, false on the display. Secrets are null in preview. */
    readonly isPreview: boolean;
    /** JSON values kept between runs: `shared` for every board playing the scene, `board` for this board. Read and write inside `transaction`; `limits` holds the bounds. */
    readonly storage: SceneStorage;
    /** Values kept for a while, which can be lost: the same API as `storage`, where a full namespace evicts the keys written longest ago and `set` takes a `ttl`. */
    readonly cache: SceneCache;
    /** The scene's WebGL2 context for 3D and shaders, created on the first call; every later call returns the same one, whatever it passes. Its drawing buffer is antialiased unless the first call passes `{ antialias: false }`, which suits thin lines, pixel art and edges that flicker between LEDs; it ignores every other attribute. Its `canvas` is fixed at the display size. Show its output by drawing `gl.canvas` into `ctx` with `drawImage`: 2D drawn before lands under it, and 2D drawn after lands on top. Throws when no WebGL2 context can be had, which ends the scene. */
    gl(attributes?: WebGLContextAttributes): WebGL2RenderingContext;
    /** Open an audience that phones in the room join by QR code, on a board only. `media` lists the asset names a page may load by relative URL. Resolves with the audience already open; wire its listeners right after the `await`. Rejects in the preview, while another audience is opening or open, when the cloud refuses, or when a listed name is missing. */
    openAudience(options?: { media?: string[] }): Promise<SceneAudience>;
  }

  /** The code a `StorageError` carries. */
  type StorageErrorCode =
    | "ended" | "nested" | "busy" | "expired" | "invalid" | "too_large" | "offline" | "unavailable";

  /** The error every failed storage or cache call rejects or throws with. Branch on `code`. */
  interface StorageError extends Error {
    readonly name: "StorageError";
    readonly code: StorageErrorCode;
  }

  /** The object a storage transaction's callback receives. It refuses every call once the transaction has ended. */
  interface StorageTransaction {
    /** The stored value parsed from JSON, or undefined when the key is absent. Sees this transaction's own pending writes. */
    get<T = any>(key: string): Promise<T | undefined>;
    /** Set `key` to `value`, written when the callback resolves. Throws a `StorageError` at once for a malformed key or a value with no JSON form or too large a one. */
    set(key: string, value: unknown): void;
    /** Delete `key` when the callback resolves. */
    delete(key: string): void;
    /** Every key, sorted, this transaction's pending writes included. */
    keys(): Promise<string[]>;
  }

  /** The object a cache transaction's callback receives. */
  interface CacheTransaction extends StorageTransaction {
    /** Set `key` to `value`, written when the callback resolves. `ttl` is whole seconds, from 1 to 30 days, after which the key is gone; a set without it keeps the key until it is evicted. */
    set(key: string, value: unknown, options?: { ttl?: number }): void;
  }

  /** One namespace, reached only through `transaction`. */
  interface StorageNamespace<Tx> {
    /** Run `callback` holding the namespace's lock. Its writes commit together when it resolves, and none commit when it throws. Resolves with what the callback returns; rejects with a `StorageError`, or with what the callback threw. */
    transaction<T>(callback: (tx: Tx) => T | Promise<T>): Promise<Awaited<T>>;
  }

  /** The bounds of `sys.storage`, the same in the preview as on a board. Frozen: assigning to a field throws. */
  interface StorageLimits {
    /** The most keys one namespace holds. */
    readonly maxKeys: number;
    /** The longest key, in UTF-8 bytes. */
    readonly maxKeyBytes: number;
    /** The largest value, in UTF-8 bytes of its JSON. */
    readonly maxValueBytes: number;
    /** The most changed keys one transaction commits. */
    readonly maxTransactionKeys: number;
    /** The largest commit, in bytes of its encoded request. */
    readonly maxRequestBytes: number;
    /** The longest a transaction holds its lock, in seconds; past it the transaction fails `expired`. */
    readonly lockHoldSeconds: number;
  }

  /** The bounds of `sys.cache`. A commit sets at most `maxKeys` new keys, so there is no `maxTransactionKeys`. Frozen: assigning to a field throws. */
  interface CacheLimits {
    /** The most keys one namespace holds before it evicts the keys written longest ago. */
    readonly maxKeys: number;
    /** The longest key, in UTF-8 bytes. */
    readonly maxKeyBytes: number;
    /** The largest value, in UTF-8 bytes of its JSON. */
    readonly maxValueBytes: number;
    /** The largest commit, in bytes of its encoded request. */
    readonly maxRequestBytes: number;
    /** The longest a transaction holds its lock, in seconds; past it the transaction fails `expired`. */
    readonly lockHoldSeconds: number;
    /** The longest `ttl` a set takes, in seconds. */
    readonly maxTtlSeconds: number;
  }

  /** `sys.storage`: the scene's stored values. */
  interface SceneStorage {
    /** One namespace that every board playing the scene reads and writes. */
    readonly shared: StorageNamespace<StorageTransaction>;
    /** One namespace for each board, which only that board reads and writes. */
    readonly board: StorageNamespace<StorageTransaction>;
    /** The bounds every namespace of `sys.storage` enforces. */
    readonly limits: StorageLimits;
  }

  /** `sys.cache`: the scene's cache, in the same two namespaces. */
  interface SceneCache {
    readonly shared: StorageNamespace<CacheTransaction>;
    readonly board: StorageNamespace<CacheTransaction>;
    /** The bounds every namespace of `sys.cache` enforces. */
    readonly limits: CacheLimits;
  }

  /** A decoded animated-GIF clip (from assets.<name>.loadAnimation()). */
  interface Clip {
    /** The frame for scene time `seconds`, looping on the clip's duration. */
    frameAt(seconds: number): CanvasImageSource;
    readonly duration: number;
    readonly frameCount: number;
    readonly fps: number;
  }

  /** A handle to one uploaded asset, reached as assets.<name>. */
  interface AssetHandle {
    /** Category hint from the file type. */
    readonly type: "image" | "animation" | "font" | "text" | "binary";
    /** Decode as an image (await in setup); throws if the bytes aren't an image. */
    loadImage(): Promise<CanvasImageSource>;
    /** Decode an animated GIF into a clip; await in setup, draw clip.frameAt(t) per frame. */
    loadAnimation(): Promise<Clip>;
    /** Register as a font family (defaults to the asset name), returns it. */
    registerFont(family?: string): string;
    /** Raw bytes of the asset. */
    readonly bytes: Uint8Array;
    /** UTF-8 text; throws on invalid UTF-8. */
    readonly text: string;
  }

  /** Per-frame timing passed to render(). */
  interface Frame {
    /** Seconds since the scene started — use for animation. A scrub in the preview can move it
     *  to any time, earlier or later. */
    readonly t: number;
    /** Seconds since the previous frame: negative after a scrub back, large after a jump ahead. */
    readonly dt: number;
    /** Integer frame counter. */
    readonly frameIndex: number;
  }

  /** Resolved config variables (keys declared per-scene). Loosely typed. */
  type SceneEnv = Record<string, any>;
  /** Configured secrets; each declared key is null in the browser preview. */
  type SceneSecrets = Record<string, string | null>;
  /** Uploaded assets, keyed by the name you gave them. */
  type SceneAssets = Record<string, AssetHandle>;

  /** A phone in the scene's audience. */
  interface AudienceMember {
    /** The member's id within this audience. */
    readonly id: string;
    /** The phone's hint: the same each time this phone joins this audience, so a phone that drops and rejoins can be recognised. */
    readonly phone: string;
    /** Replace the member's page with an HTML string (an HTML asset's `.text` works); `data` is the page's `tickr.data`. Throws a RangeError past 64 KiB. */
    show(html: string, data?: unknown): void;
    /** Message the member's page, which receives it through `tickr.on("message", cb)`. At most once, in order. */
    send(msg: unknown): void;
    /** Remove the member and show its phone the reason. */
    kick(reason?: string): void;
  }

  /** An audience's limits, read from `audience.limits`. Frozen, and kept once the audience closes. */
  interface AudienceLimits {
    /** The most members the audience admits: the member limit in force when it opened, which a later change to the setting leaves alone. */
    readonly maxMembers: number;
    /** The largest frame a `show`, `send`, `broadcast` or `kick` writes, in UTF-8 bytes of its JSON with its envelope included; past it the call throws a RangeError. */
    readonly maxSceneMessageBytes: number;
    /** The largest message a member's page sends, in UTF-8 bytes of its frame; past it the cloud closes that phone's connection. */
    readonly maxMemberMessageBytes: number;
    /** How many messages a second one member's page sends before the cloud slows it to that rate. */
    readonly memberMessagesPerSecond: number;
  }

  /** One audience phones join by QR code, from `sys.openAudience()` until it ends. A closed audience never opens again; call `sys.openAudience()` for a new one. */
  interface SceneAudience {
    /** The join URL. A closed audience keeps the URL it had, which no phone can join. */
    readonly url: string;
    /** The join URL's QR matrix. A closed audience keeps it too. */
    readonly qr: { readonly size: number; isDark(x: number, y: number): boolean };
    /** true once the audience has ended. Check it before drawing the code, because a closed audience still draws the code it had. */
    readonly closed: boolean;
    /** The audience's limits. */
    readonly limits: AudienceLimits;
    /** Draw the join code into the square at (x, y), whole pixels per module, centred; returns the square drawn. Throws a RangeError if the square is too small. */
    drawQr(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colors: { dark: string; light: string }): { x: number; y: number; size: number };
    on(event: "join", cb: (member: AudienceMember) => void): void;
    on(event: "message", cb: (member: AudienceMember, msg: unknown) => void): void;
    on(event: "leave", cb: (member: AudienceMember, reason: "left" | "kicked" | "evicted" | "ended") => void): void;
    /** The audience ended, once: `close()`, the scene's socket closed, a deploy, or a dropped connection. */
    on(event: "closed", cb: () => void): void;
    /** The members, in join order. */
    readonly members: AudienceMember[];
    /** Message every member. */
    broadcast(msg: unknown): void;
    /** End the audience now. Does nothing once it has closed. */
    close(): void;
  }

  /** The four inputs handed once to the scene factory. */
  interface SceneInputs {
    sys: SceneSys;
    assets: SceneAssets;
    env: SceneEnv;
    secrets: SceneSecrets;
  }

  /** The lifecycle a scene factory returns. Only render is required. */
  interface Scene {
    /** Runs once, awaited before the first frame. Do slow loading / first fetch here. */
    setup?(): void | Promise<void>;
    /** Called every frame; draw the whole frame. Must be synchronous and fast. */
    render(ctx: CanvasRenderingContext2D, frame: Frame): void;
    /** Awaited on a graceful stop, within the stop budget, as best effort. Release timers / connections; it may still save to storage and show an open audience a last page, and `signal` has already aborted. */
    teardown?(): void | Promise<void>;
  }

  /** A scene module's default export. */
  type SceneFactory = (inputs: SceneInputs) => Scene;
}

export {};
