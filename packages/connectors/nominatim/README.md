# `@nexgen-os/nominatim` — OpenStreetMap geocoder

An address to a point and a point to an address on [Nominatim](https://nominatim.org), worldwide, with the ISO 3166-2 region. Source `nominatim`. MIT; the data is OpenStreetMap's, under the ODbL. The public instance asks for a user agent that names the application and one request per second; an installation running its own Nominatim may give any base URL.

```ts
import { nominatim } from '@nexgen-os/nominatim';

const geocoder = nominatim({ userAgent: 'my-app (contact@example.org)' });
const [place] = await geocoder.search('Rue de la Loi 12, Bruxelles');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `placeFields(place)` gives the place columns of `participants` it fills.
Decision [0009](../../../docs/decisions/0009-what-applies-follows-the-region.md).

