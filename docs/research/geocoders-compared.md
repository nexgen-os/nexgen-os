# Geocoders compared — open registers and OpenStreetMap against a commercial API

Measured on 13/10/2026 from one machine, one query per address and per
service, public instances. Twelve queries: eleven real addresses of public
buildings in France, Belgium and the Netherlands, one address that does not
exist (a street name that is not in that village), one partial query typed
the way a user types (`rue de la loi 16 brux`).

| Service | Data | Terms | Latency seen |
|---|---|---|---|
| BAN (`api-adresse.data.gouv.fr`) | the French national address register | Licence Ouverte, no key | 80–250 ms |
| Geopunt (`geo.api.vlaanderen.be/geolocation`) | the Flemish address register | open, no key | 50–460 ms |
| Nominatim (public instance) | OpenStreetMap, worldwide | ODbL, one request per second | 180–1 030 ms |
| Photon (public instance of komoot) | OpenStreetMap, worldwide, search as you type | ODbL | 1.5–3.4 s |
| Mapbox Geocoding v5 | proprietary + open data, worldwide | paid above the free tier, results may not be stored | 140–490 ms |

## What came out

**On real addresses, everyone agrees.** On the eleven real addresses the
services that answered put the point within a few metres of each other
(0–13 m), with two exceptions: Photon placed one Montpellier address at the
street (102 m) rather than the number, and Geopunt answered `Korenmarkt 10`
for `Korenmarkt 1` in Ghent (85 m): its matching is loose on house numbers,
which the import must check (the answer carries the number it matched).

**House-number precision.** BAN: every French address at the number.
Mapbox: every address at `rooftop` or `point`. Photon: every real address at
the number. Nominatim: most, but two Brussels addresses came back at the
postcode or not at all; its public instance is the weakest on Brussels.

**The address that does not exist** is where services differ most. BAN
answered the nearest existing street of the village with a low score (the
score says so). Nominatim answered nothing. Photon answered the village
church. **Mapbox answered a confident `address` two kilometres away in
another village**: a form built on it would place the site at a wrong place
that looks right. This is the strongest argument for showing the precision
and the source next to a located site, whatever the geocoder.

**The partial query** (`rue de la loi 16 brux`) is found by Mapbox and
Photon, not by Nominatim nor Geopunt: search-as-you-type needs a service
built for it (Photon, BAN with `autocomplete=1`, the commercial ones).

**Latency.** The national registers are the fastest; the public Photon is
the slowest by far, which a self-hosted Photon (a Docker image, OSM
extracts per country) removes.

## What it means for the core

- The open chain — a country's register when a pack brings it, Photon or
  Nominatim otherwise — answers the eleven real addresses as well as the
  commercial service, at the house number, and refuses or flags what does
  not exist instead of inventing it.
- A commercial geocoder remains a choice of an installation for the typing
  comfort on countries without a register in a pack; its answers are
  stored under its terms (`sources.retention_days`, `redistributable`) and
  shown with their precision like any other.
- Belgium needs its three regional registers (Flanders, Brussels, Wallonia)
  keyed by region in the chain; the Flemish one is in, the other two are the
  next pack sections.
