# `@nexgen-os/icar` — the Walloon address register

The ICAR geocoding service of the Service public de Wallonie, with a match score per level and the NIS code of the municipality. Source `icar`. MIT; its terms of use are still being drafted, so what it returns is not passed on. It guesses a municipality for anything it does not know: ask it last.

```ts
import { icar } from '@nexgen-os/icar';

const geocoder = icar();
const [place] = await geocoder.search('Place Saint-Lambert 18, 4000 Liège');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `placeFields(place)` gives the place columns of `participants` it fills.
Decision [0009](../../../docs/decisions/0009-what-applies-follows-the-region.md).

