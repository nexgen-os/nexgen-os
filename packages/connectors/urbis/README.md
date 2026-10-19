# `@nexgen-os/urbis` — the Brussels address register

The UrbIS geolocation service of Paradigm, the address register of the Brussels-Capital Region, in French or Dutch. Source `urbis`. MIT; open, no key.

```ts
import { urbis } from '@nexgen-os/urbis';

const geocoder = urbis({ languages: ['fr', 'nl'] });
const [place] = await geocoder.search('Wetstraat 16, 1000 Brussel');
```

The place is the standard shape of `@nexgen-os/core` (address, WGS 84 point,
precision, source); `siteFields(place)` gives the columns of `sites` it fills.
Decision [0009](../../../docs/decisions/0009-addresses-and-geocoding.md).

