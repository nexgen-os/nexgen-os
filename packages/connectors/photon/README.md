# `@nexgen-os/photon` — OpenStreetMap search as you type

Search as you type and reverse geocoding on [Photon](https://github.com/komoot/photon), worldwide. Source `photon`. MIT; the data is OpenStreetMap's, under the ODbL. Photon has no country filter on the server: the filter is applied on the answers.

```ts
import { photon } from '@nexgen-os/photon';

const geocoder = photon();
const [place] = await geocoder.search('Rue de la Loi 12, Bruxelles');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `siteFields(place)` gives the columns of `sites` it fills.
Decision [0009](../../../docs/decisions/0009-addresses-and-geocoding.md).

