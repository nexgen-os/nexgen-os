# `@nexgen-os/evcc` — the device templates of evcc ⇄ plain shapes

[evcc](https://evcc.io) (MIT) keeps one YAML template per way of talking
to a device: a charging station, a heat pump or a switch socket (its
`charger` templates), a grid meter, an inverter or a battery (its `meter`
templates), a vehicle. Each template names the products it drives. This
library reads a template file into plain shapes any tool can use, and
folds many templates into the connectors each brand can be reached
through. MIT; one dependency, [`yaml`](https://eemeli.org/yaml/) (ISC); no
connection, no database.

| Template | Shape | Notes |
|---|---|---|
| `template`, the directory of the file | `template`, `class` | evcc says the class by where the file is: the caller gives it |
| `products` | `EvccProduct[]` | brand, model, every description; the model is the `generic` description, else the one in the first of the `languages` asked for, else the first given; a brand without a model keeps a null model |
| `group` | `group` | `heating`, `switchsockets` for a `charger` template, else null |
| `capabilities` | `capabilities` | `1p3p`, `rfid`, `battery-control`, `curtail`… as written |
| the `choice` of the `usage` parameter | `usages` | the uses a meter template serves: `grid`, `pv`, `battery`, `charge`, `aux` |
| `requirements.evcc`, `requirements.description` | `evccRequirements`, `sponsored`, `requirements` | `sponsored` is true when evcc asks for a sponsorship to drive the device |
| `discovery` | `EvccDiscovery` | DNS-SD services, host name patterns, MAC prefixes (upper-case hexadecimal) |
| `covers` | `covers` | the templates this one replaces |

```ts
import { readEvccTemplate, connectorsByBrand } from '@nexgen-os/evcc';

const template = readEvccTemplate(text, 'charger', { languages: ['en'] });
const brands = connectorsByBrand(templates);   // brand → [{ class, template, group, sponsored }]
```

A file that is not a template is refused by name: `template_invalid`
(not YAML, not a mapping), `template_missing` (no `template` name),
`products_missing` (no product with a brand).

What it never does: render a template, read its parameters into a
configuration, speak to a device, or decide which device type of a model
a template is. Writing the products into a catalogue is an importer's job:
`importEvccCatalogue()` in [`@nexgen-os/core`](../../core/README.md).

## Where the templates come from

The templates are evcc's, in `templates/definition/<class>/` of
[evcc-io/evcc](https://github.com/evcc-io/evcc), under the MIT licence of
evcc.io. The test fixtures are nine of them, copied unchanged at commit
`c0e578a`, with evcc's licence beside them.
