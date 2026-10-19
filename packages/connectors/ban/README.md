# `@nexgen-os/ban` — the French national address base

The Base Adresse Nationale of France: search as you type and reverse geocoding with house-number precision, the ISO 3166-2 subdivision of the department as region (`FR-34`; Paris is `FR-75C`). Source `ban`. MIT; the data is under the Licence Ouverte 2.0, no key. The country pack `fr` names the register as a source; the code lives here.

```ts
import { ban } from '@nexgen-os/ban';

const geocoder = ban();
const [place] = await geocoder.search('20 avenue de Ségur, Paris');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `siteFields(place)` gives the columns of `sites` it fills.
Decision [0009](../../../docs/decisions/0009-addresses-and-geocoding.md).

