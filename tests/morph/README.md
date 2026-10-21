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

`turns/` holds cdxmorph's example of a molecule turned in 3-D (`decalone addition.cdxml`: a flat
drawing and a chair joined by an equivalency sign, each under a 3-D structure ChemDraw built from a
crystal file, then two reactions), with what `cdxmorph check` reports for the whole page.
