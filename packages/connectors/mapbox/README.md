# `@nexgen-os/mapbox`

[Mapbox](https://www.mapbox.com) as a geocoder of Nexgen OS, on its
[Geocoding API v6](https://docs.mapbox.com/api/search/geocoding/): the
commercial service an installation pays for, asked after the register of the
country and the open fallback. MIT; the data is Mapbox's.

```ts
import { mapbox } from '@nexgen-os/mapbox';

const geocoder = mapbox({ accessToken });             // the token the connectors row names
await geocoder.search('rue de la loi 16', { country: 'be' }); // search as you type, best first
await geocoder.forward('Rue de la Loi 16, 1000 Bruxelles');   // the best place for a full address
await geocoder.reverse(4.3521, 50.8467);                       // the full address at a point
```

Every answer is a place in the standard shape of
[`@nexgen-os/core`](../../core/src/address.ts): the address in the fields
every country has, the region in ISO 3166-2 (`region_code_full`), the point,
its precision and the source `mapbox`.

| Mapbox | `location_precision` |
|---|---|
| an address at `rooftop` or `point` accuracy | `rooftop` |
| an address at `parcel` accuracy | `parcel` |
| an address `interpolated` or `approximate`, a street | `street` |
| a postcode | `postal_code` |
| a place, a locality | `city` |
| a region, a country | `region` |

Mapbox does not publish the country's own municipality code: a place it
gives keeps `municipality_code` empty, and the country's register (`ban`,
`geopunt`, `urbis`, `icar`), asked first, is the one that fills it.

## In the chain

`geocoderChain()` of the core keeps the order the
[decision 0009](../../../docs/decisions/0009-what-applies-follows-the-region.md)
gives: the register of the country or its regions, then the open fallback
(`nominatim`, `photon`), then the commercial service. Which worldwide
geocoder is the commercial one is read from its `sources` row
(`redistributable = false`), not from the order it is named in.

## Terms, licence and retention

The package ships its `sources` row, [`source.json`](source.json)
(`mapboxSource`; write it with `registerSource()` of the core): kind `api`,
`auth = 'api_key'`, worldwide, not redistributable. Mapbox's terms tell two
modes apart:

- **temporary geocoding**, the default of the API: results may be shown, not
  stored;
- **permanent geocoding** (`permanent=true`, billed per request): results may
  be stored by the customer, never redistributed as a dataset.

A place a participant keeps is stored, so the connector asks the permanent
mode by default; `permanent: false` is for a lookup shown and thrown away.
`retention_days` is empty: in the permanent mode Mapbox sets no limit; check
the [product terms](https://www.mapbox.com/legal/service-terms) in force
for the installation's plan before relying on it.

## Configuration

An organisation's `connectors` row names the source `mapbox` and its access
token by `secret_ref`; the vault holds it, the caller resolves it and passes
it as `accessToken`. The token travels in the query string of each request
and is never written in an error.

## Licence

MIT.
