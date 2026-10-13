# Pack `fr` — France

| Section | What it says | Source |
|---|---|---|
| identifiers | `prm`: the 14-digit metering point of the distribution grid (PRM, also called PDL); `insee`: the municipality code, the level at which the distribution operator (Enedis or one of the local ones), the planning rules and most datasets are decided; `ban_address`: the identifier of an address in the national address base | Enedis; INSEE; BAN |
| sources | `ban`: Base Adresse Nationale, the national address register, open, worldwide-free API; `geo_api_gouv`: the administrative divisions API (communes, departments, regions) | Licence Ouverte 2.0 |
| geocoding | `ban()` — the address register as a `Geocoder`: search as you type, reverse, precision `rooftop` for a house number, `street`, `city`; region as the ISO 3166-2 department code | https://adresse.data.gouv.fr/api-doc/adresse |

Checked by: nobody yet.
