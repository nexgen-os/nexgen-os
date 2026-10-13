# `@nexgen-os/geocoding` — an address to a point, a point to an address

One interface over any geocoder: `search(text)` gives places, `reverse(lon,
lat)` gives the address at a point. Every place carries the address in the
fields every country has, the coordinates, how precise the point is
(`rooftop`, `parcel`, `street`, `postal_code`, `city`, `region`), which
geocoder said so, and the identifier the geocoder knows the place by. MIT,
like every library here; no database, no framework.

| Adapter | Data | Terms |
|---|---|---|
| `nominatim(...)` | OpenStreetMap, worldwide, both ways, ISO 3166-2 regions | ODbL; the public instance wants a named user agent and one request per second |
| `photon(...)` | OpenStreetMap, worldwide, search as you type, both ways | ODbL; no country filter on the server, applied on the answers |

A country pack adds its national address register as an adapter of the same
shape; an installation adds a commercial geocoder with its own key, and
honours that geocoder's terms on what may be stored.

```ts
import { nominatim, siteFields } from './formats/geocoding/index.js';

const geocoder = nominatim({ userAgent: 'my-app (contact@example.org)' });
const [place] = await geocoder.search('Rue de la Loi 12, Bruxelles', { country: 'BE', language: 'fr' });
await db.query('insert into sites (organisation_id, name, street, address_extra, postal_code, city, region, country, geometry, location_precision, location_source_code) values (...)', [
  organisationId, 'Office', ...Object.values(siteFields(place)),
]);

const back = await geocoder.reverse(place.lon, place.lat); // the address again
```

`siteFields(place)` gives the columns of `sites` a place fills, the point as
GeoJSON included. `addressLines(address)` gives the lines to show when no
country pack says how that country lays them out.

Decision: [0009](../../docs/decisions/0009-addresses-and-geocoding.md).
