# OPSIN for Chem Illustrator

Structure > Name to Structure uses [OPSIN](https://github.com/dan2097/opsin) (MIT licence) to read
chemical names. OPSIN is written in Java; this folder turns it into JavaScript with
[TeaVM](https://teavm.org) so the app can read names **without an internet connection** and
without shipping Java.

You only need this folder to update OPSIN. The finished files are kept in the repository, so
building, testing and running the app need no Java:

| File | What it is |
|---|---|
| `src/vendor/opsin/opsin.js` | OPSIN as JavaScript (about 0.7 MB). Generated: don't edit it by hand. |
| `public/opsin/opsin-data.dat` | OPSIN's word lists and ready-made grammar tables, gzip-compressed (about 1.4 MB). |
| `tests/opsin-expected.json` | What real Java OPSIN gives for about 50 names; `tests/names.test.ts` checks the JavaScript build gives exactly the same. |

## Rebuilding

Needs Java 11 or newer and Maven. From this folder:

```
mvn process-classes
```

That downloads OPSIN and TeaVM, writes the three files above, and checks the data on the way
(every packed table must equal the original, and a few names must come out right). Then run
`npm test` in the app folder. To move to a newer OPSIN, change `opsin.version` in `pom.xml`.

## What is changed, and why

OPSIN itself is unchanged except for the parts that load its data, which a browser can't do the
Java way:

- `uk/ac/cam/ch/wwmm/opsin/ResourceGetter.java` replaces OPSIN's file reader: files come from the
  data pack held in memory (`OpsinData`), and XML is read by `SimpleXmlReader` instead of Woodstox.
- `uk/ac/cam/ch/wwmm/opsin/AutomatonInitialiser.java` replaces OPSIN's automaton loader: OPSIN's
  ready-made automata are stored as plain number tables (Java object serialisation isn't available
  in JavaScript). As in OPSIN, a stored automaton is only used if its regex hash still matches.
- `org/apache/logging/log4j/` is a silent stand-in for the Log4j logging calls.
- `dk/brics/automaton/RunAutomatonData.java` reads and writes an automaton's tables; the automaton
  library itself is unchanged.
- `PackData.java` (run at build time on normal Java) writes the data pack and the test answers.
- `OpsinJs.java` is what the JavaScript exports: `load(bytes)` and `parse(name)`, which answers in
  JSON with OPSIN's SMILES (with CXSMILES attachment points) or its reason for failing.

In the app, `src/worker/opsin-worker.ts` runs OPSIN in a background worker, started the first
time a name is read (about 1–2 s), and `src/chem/names.ts` passes the SMILES to RDKit to be drawn.

Licences: OPSIN (MIT), dk.brics.automaton (BSD), TeaVM and the StAX API (Apache 2.0); texts in
`licences/` and in `THIRD-PARTY-NOTICES.md`.
