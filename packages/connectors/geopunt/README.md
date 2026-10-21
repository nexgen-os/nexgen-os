# `@nexgen-os/geopunt` — the Flemish address register

The Geolocation API of Digitaal Vlaanderen on the Flemish base registers, which also serves the Brussels UrbIS addresses (region `BE-BRU` on those answers). Source `geopunt`. MIT; open, no key. Its matching is loose on house numbers (it answers `Korenmarkt 10` for `Korenmarkt 1`): a place whose number is not the one typed keeps the street only, at precision `street`.

```ts
import { geopunt } from '@nexgen-os/geopunt';

const geocoder = geopunt();
const [place] = await geocoder.search('Korenmarkt 10, 9000 Gent');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `placeFields(place)` gives the place columns of `participants` it fills.
Decision [0009](../../../docs/decisions/0009-addresses-and-geocoding.md).

