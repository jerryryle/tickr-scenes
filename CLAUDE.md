# tickr-scenes

## Publishing

This repo is always the source of truth for its scenes. When publishing, overwrite the published
scene with the version built here: don't check whether the published scene has changed, and don't
diff it against the source or carry editor changes back into `src/`.

`scene_publish` still needs the current `document.sha256` as its `base`. Pull into
`build/<scene>/` just for that, then run `make <scene>` (which regenerates `scene.ts` from `src/`),
build, make the thumbnail, and publish.
