# `xa` — Examplia, the fixture pack

A country that does not exist (XA is a user-assigned ISO 3166 code, XTS the
ISO 4217 code reserved for tests), written to exercise `nexgen-os pack build`
and `pack check` on every section of a pack. Its seed,
`../../supabase/seed/10_pack_xa.sql`, is the committed output the tests
compare against. Off-peak hours are null on purpose: a value that depends on
the contract is null with its reference.
