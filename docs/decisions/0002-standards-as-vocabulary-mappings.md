# 0002 — Standards enter through the vocabularies

**Decided 12/10/2026.**

Every vocabulary row names the term it corresponds to in the existing
standards: Brick and IFC classes, CityGML classes, IFC property sets and bSDD
URIs, QUDT units, Haystack tags, Brick and IFC relationships. Format
libraries use these mappings to read and write models without guessing.

**Why.** The trades already speak IFC, CityGML, Brick and SensorThings. A core
with its own private language would need a translation for every one of them.
When a standard has no term for something, the row stays unmapped and keeps a
name of its own.

**Open.** Versioned, namespaced URIs for every vocabulary row
(`publisher/dictionary/version/code`, as bSDD does) arrive with the first pack
that publishes vocabulary.
