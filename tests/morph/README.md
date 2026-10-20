# Reaction animation test schemes

These schemes come from the examples shipped with [cdxmorph](https://github.com/rshenvi/cdxmorph) 1.47.0
by Ryan Shenvi (MIT; licence text in `THIRD-PARTY-NOTICES.md`), used with permission.

For each scheme:

- `*.cdxml`: the drawing.
- `*.mapping.json`: cdxmorph's pairing file for it (atoms by ChemDraw atom number).
- `*.check.json`: what `python -m cdxmorph check` reports with that pairing.
- `*.auto.json`: what it reports with automatic matching only (the scheme on its own in a folder).

`tests/morph.test.ts` checks that our port finds the same bonds breaking and forming and the same
unpaired atoms.
