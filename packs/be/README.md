# Pack `be` — Belgium

Belgium decides most things per region: Flanders (`BE-VLG`), Brussels
(`BE-BRU`) and Wallonia (`BE-WAL`) each keep their own address register,
building identifiers, grid operators and rules. Every row of this pack that
applies to part of the country says which region in `regions`, and the
geocoders return the region of each place they find
([decision 0009](../../docs/decisions/0009-addresses-and-geocoding.md), "the regional level").

| Section | What it says | Source |
|---|---|---|
| identifiers | `nis`: the 5-digit municipality code of Statbel (also INS or REFNIS), the level at which a distribution operator, local planning rules and most datasets are decided; `vlaanderen_address` and `vlaanderen_building` (the `gebouwID`): the persistent identifiers of the Flemish address and building registers (Flanders); `urbis_building`: a building of UrbIS-Adm (Brussels); `icar_address`: a house number in ICAR (Wallonia, which keeps no building register) | Statbel; Basisregisters Vlaanderen; UrbIS; ICAR |
| identifiers — metering point | A Belgian **EAN** (the 18-digit code on an energy bill, starting with `54`, the GS1 Belgium & Luxembourg prefix) is a GS1 Global Service Relation Number: it uses the core `gs1_gsrn` scheme. The pack adds no scheme of its own for it. | GS1 |
| sources | `geopunt` (`BE-VLG`, `BE-BRU`), `basisregisters_vlaanderen` (`BE-VLG`), `urbis` (`BE-BRU`), `icar` (`BE-WAL`), `rmi_aws` (whole country) — see below | |

## Sources

Checked on 13/10/2026, one real call each (the answers are recorded in `tests/fixtures/`).

| Code | Endpoint | Licence | Key | What was verified |
|---|---|---|---|---|
| `geopunt` | `https://geo.api.vlaanderen.be/geolocation/v4/Location?q=…` (`latlon=lat,lon` for reverse) | The service page states none; its data are the Flemish base registers (Modellicentie Gratis Hergebruik, per the address register's metadata on metadata.vlaanderen.be) and UrbIS-Adm (CC0) | none | Endpoint, fields `Lat_WGS84`, `Lon_WGS84`, `LocationType`, `ID` (the address identifier of Basisregisters). It also answers Brussels addresses (`urbis_*` types). It finds nothing in Wallonia. It does not give the NIS code. It answers `Korenmarkt 10` for `Korenmarkt 1`: the adapter keeps the street only, at precision `street`, when the number matched is not one typed. |
| `basisregisters_vlaanderen` | `https://api.basisregisters.vlaanderen.be/v2/` | Modellicentie Gratis Hergebruik | none for reading an address or a building | An address read without a key gives the NIS code of its municipality (`gemeente.objectId`); not used by the adapters yet. |
| `urbis` | `https://geoservices.irisnet.be/localization/Rest/Localize/getaddresses?language=…&spatialReference=4326&address=…` | CC0-1.0 (Geobru catalogue record of the service) | none | It matches a street name only in the language it is asked in (`fr` or `nl`), and answers any query, even outside Brussels, with its nearest name: the adapter asks each language in turn and keeps only places whose street name was found. Reverse lookup (`getaddressfromxy`) works in Belgian Lambert 72 only: `urbis().reverse` returns null and Geopunt answers reverse lookups in Brussels. No NIS code. |
| `icar` | `https://geoservices.wallonie.be/geocodeWS/geocode?address=…&crs=EPSG:4326` (`/revgeocode` for reverse) | "Free and open access for all"; terms of use "being drafted" by the Service public de Wallonie (Metawal record of the service). **Licence not verified**: `redistributable` is false until the terms are published. | none | Gives the NIS code of the municipality (`city.ident`) and a score per level; answers a Flemish query with a fuzzy municipality, which the adapter drops. A `lang` parameter restricts the match to one language, so the adapter does not send it. |
| `rmi_aws` | `https://opendata.meteo.be/service/aws/wfs` (OGC WFS) | CC-BY-4.0 as stated by the Belgian Climate Centre catalogue; **not verified** on opendata.meteo.be, whose pages are rendered by script | none | 14 automatic weather stations, 10-minute, hourly and daily observations, global irradiance included. |

## Weather

No `weather.rules` row. The open data of the Royal Meteorological Institute
(RMI — KMI/IRM) is a network of 14 stations with observations of the past:
it is the reference for a site next to a station, but for any other site the
core defaults (gridded reanalysis and PVGIS) are closer than a station tens
of kilometres away, and the RMI publishes no open forecast or typical-year
API. The source is declared so a connector can read a station; a rule would
need a weather model per station (`weather.models`, `grid_deg` null) and a
reason to prefer it, which a later version of the pack can bring.

## Not covered yet

- The NIS code of a Flemish or Brussels place: neither Geopunt nor UrbIS
  gives it. Basisregisters gives it for Flemish addresses; the 19 Brussels
  municipalities (codes `21001` to `21019`) would need a table from the
  municipality name UrbIS returns.
- Building identifiers from the geocoders: none of the three returns one.

Checked by: nobody yet.

The three regional address registers answer as geocoders in
[`formats/geocoding/belgium.ts`](../../formats/geocoding/belgium.ts)
(`geopunt()` BE-VLG, `urbis()` BE-BRU, `walloon()` BE-WAL, `belgium()` keyed
by region); the pack names them as sources.
