# `@nexgen-os/viewer` — the scene of a place

What a viewer of Nexgen OS draws, read from the description of the
[`building`](../../modules/building/README.md) module as the person who
opens it, under row level security. It writes nothing, and keeps nothing of
its own in the database: a view, a camera path or a scene is the viewer's
state, never a row
([0008](../../docs/decisions/0008-the-building-module-describes-what-is-built.md)).

```ts
import { placeScene } from '@nexgen-os/viewer';

const scene = await placeScene(db, participantId);
// scene.sites      the ground: outlines, in metres
// scene.buildings  footprints with their base and top, in metres
// scene.models     each file with the 4 × 4 matrix that places it
```

- **One frame of metres.** `localFrame(origin)` takes a point of WGS 84 to
  metres east and north on the tangent plane of the place, exactly, and up
  as the height above the origin's. The scene starts at the centre of the
  participant's place, at the lowest elevation of its buildings.
- **A building** is its footprint at its elevation (`base`), raised by its
  height (`top`, null when no height is described).
- **A model** is the file its row points to (`uri`, `format`, `bounds`) and
  a column-major matrix from its own coordinates and units to the frame,
  the order WebGL and three.js read. The matrix is read from
  `building.model_to_world()`, at four points of the model 100 m apart: the
  one placement of a model, never computed again from its file.
- `readPlace(db, participant)` gives the rows, `sceneOf(rows)` the scene
  from them with no database; `placeScene()` does both. Refusals by name:
  `participant_not_found` (absent, or out of the person's reach),
  `place_required` (nothing of the place has a geometry),
  `module_not_installed`.

Not here yet: the renderer (three.js), the terrain and the aerial
photograph from the sources of the place's pack, and the photographs of the
place seen from the pose their files give. The package is not published
until it draws.

AGPL-3.0, as the core.
