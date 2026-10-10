# pearl-engine

`pearl-engine` is a small, zero-dependency Node.js (>=22, ESM) library that powers the OpenPearl self-healing research benchmark. It is built from small, deterministic modules (clocks and RNG are injected, never real) that are each exported by name from `src/index.js`, and its tests run with `node --test test`.
