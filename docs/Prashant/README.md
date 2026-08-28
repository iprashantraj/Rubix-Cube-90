# docs/Prashant/

Change notes for work I land, one file per change set. The permanent spec stays where it
lives — `docs/Master-Technical-Reference.md`, `docs/Application-Architecture.md`,
`docs/app/*.md` — and gets edited in place when a change makes it stale. These files are the
*record of the change*: what moved, why, what it broke, what it did not close.

Read the spec to know how the system works. Read these to know what changed and when.

| Date | File | What |
|---|---|---|
| 2026-08-28 | [F3-pricing-inputs.md](F3-pricing-inputs.md) | Unit-aware number parsing + the sixth voice question (material cost) |
| 2026-08-28 | [F3-post-price.md](F3-post-price.md) | `POST /price` implemented — the floor guard now actually runs |
| 2026-08-28 | [F3-comparables.md](F3-comparables.md) | Market comparables from our own marketplace, and a trim that never ran on small samples |
| 2026-08-28 | [F3-price-snapshot.md](F3-price-snapshot.md) | Snapshot loader + collection protocol for the sources with no API — numbers deliberately left to a human |
| 2026-08-28 | [dev-setup-and-theme-check.md](dev-setup-and-theme-check.md) | A self-check that failed on every load, and the undocumented Python 3.10+ requirement |
