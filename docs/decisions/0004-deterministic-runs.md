# 0004 — Modules hand results back as immutable, reproducible runs

**Decided 12/10/2026.**

A module writes into the core through one function, `record_run()`. A run
records the inputs, the engine version and the results. Its identity is the
hash of all three. The same identity returns the same run, and a finished run
never changes.

**Why.** A figure shown to an owner, a bank or an administration has to be
traceable to what produced it, and reproducible years later. The same rule
keeps the core free of any model call: a module that uses one records it in
its engine version and its inputs.
