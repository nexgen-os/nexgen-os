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
| `ban(...)` ([ban.ts](ban.ts)) | Base Adresse Nationale, France, both ways, house-number precision, the department as region | Licence Ouverte 2.0; no key |
| `geopunt(...)`, `urbis(...)`, `walloon(...)`, `belgium()` ([belgium.ts](belgium.ts)) | the Flemish, Brussels and Walloon address registers, one adapter each, `belgium()` keyed by region for `geocoderFor` | open; no key |

A national address register is an adapter of the same shape, kept here with
the others: a country pack names the register as a source and never holds
code. One adapter per region when the country keeps one register per
region, keyed `BE-VLG`, `BE-BRU`, `BE-WAL`; an installation adds a commercial
geocoder with its own key, and honours that geocoder's terms on what may be
stored.
`geocoderFor({ national, fallback, commercial })` chains them: the register
of the country or its regions first, the open fallback next, the commercial
one last. Each place says which one answered, and gives the region and the
municipality code when the register knows them. Measured against each
other: [docs/research/geocoders-compared.md](../../docs/research/geocoders-compared.md).

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
