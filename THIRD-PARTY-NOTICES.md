# Third-party notices

Chem Illustrator ships the following open-source software.

| Package | Used for | Licence |
|---|---|---|
| [RDKit](https://www.rdkit.org) (`@rdkit/rdkit`, MinimalLib WebAssembly build) | Chemistry: formula, masses, stereo, SMILES | BSD-3-Clause (full text below) |
| [OPSIN](https://github.com/dan2097/opsin) 2.9.0, compiled to JavaScript (`src/vendor/opsin/opsin.js`, data in `public/opsin/opsin-data.dat`) | Name to Structure, offline | MIT (full text below) |
| [dk.brics.automaton](https://www.brics.dk/automaton/) 1.12-4 (part of the OPSIN build) | OPSIN's name grammar | BSD-3-Clause (full text below) |
| [TeaVM](https://teavm.org) 0.16.0 runtime and class library (part of the OPSIN build) | Runs OPSIN's Java code as JavaScript | Apache-2.0; includes code from Apache Harmony (Apache-2.0). Notice: "This product includes software developed by Alexey Andreev (http://teavm.org). This product includes software developed by The Apache Software Foundation (http://www.apache.org/)." |
| StAX API 1.0.1 (`stax:stax-api`, interfaces only, part of the OPSIN build) | Lets OPSIN read its XML word lists | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) 0.8.2 | Packing and unpacking PowerPoint (.pptx) files, and compressing PDF pages | MIT (full text below) |
| [Tauri](https://tauri.app) (`tauri` crate, `@tauri-apps/api`) | Desktop app shell | MIT or Apache-2.0 |
| Tauri dialog plugin (`tauri-plugin-dialog` crate, `@tauri-apps/plugin-dialog`) | The desktop app's Open and Save dialogs | MIT or Apache-2.0 |
| [windows-sys](https://github.com/microsoft/windows-rs) crate (Windows only) | The desktop app's clipboard on Windows (pictures for Word and PowerPoint) | MIT or Apache-2.0 |
| About 260 Rust crates that Tauri uses (listed in `src-tauri/Cargo.lock`) | Desktop app shell | Mostly MIT or Apache-2.0; a few are Unicode-3.0, BSD-3-Clause, Zlib or MPL-2.0. All are free and open source; MPL-2.0 only asks that changes to those crates' own files be shared. |
| English word list from [pyspellchecker](https://github.com/barrust/pyspellchecker) 0.8.1 (`public/dict/english.txt`) | Spell check: ordinary English words, most common first (for suggestions) | MIT (full text below). The list was built by pyspellchecker from word counts in the OpenSubtitles2018 corpus (P. Lison and J. Tiedemann, LREC 2016). |
| [Open Source Chemistry Dictionary](https://www.sciencebase.com/chem-dic.zip) v3.0 by Adam M. Azman (`public/dict/chemistry.txt`) | Spell check: chemistry words | CC BY 3.0 US. Credits, source and changes in `public/dict/chemistry-LICENSE.txt`. A. M. Azman, *J. Chem. Educ.* 2012, 89, 412–413. |
| Chemistry word lists from Chem SI Assistant by Nathan O'Hare (`public/dict/lab-words.txt`) | Spell check: lab terms, name reactions and other chemistry words | The project owner's own work |
| Microsoft Edge WebView2 (part of Windows, not bundled) | Shows the app's window contents on Windows | Microsoft software licence, free to use |

Used only to build and test, not shipped: TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), jsdom (MIT), Playwright (Apache-2.0), Tauri CLI (MIT or Apache-2.0). Rebuilding the OPSIN files (`opsin-js/`, rarely needed) also uses Java, Maven (Apache-2.0) and the TeaVM compiler (Apache-2.0).

`src/text-metrics.ts` holds the standard character widths of Helvetica/Arial, regular and bold (the widths in Adobe's freely distributed Helvetica font metrics), so saved files and copied pictures place text as ChemDraw does. No font files are included.

Copied pictures are written as Enhanced Metafiles (EMF) and Windows bitmaps from Microsoft's published format specifications ([MS-EMF], BMP); no Microsoft code is included.

PowerPoint files (.pptx) are read and written from the published Office Open XML standard (ECMA-376); PDF files from the published PDF specification (ISO 32000), using only the standard 14 PDF fonts. No Microsoft or Adobe code is included.

The CDXML and CDX formats are read and written from CambridgeSoft's published CDX/CDXML format documentation and from example files; no ChemDraw code or documentation is included.

## RDKit licence

```
BSD 3-Clause License

Copyright (c) 2006-2015, Rational Discovery LLC, Greg Landrum, and Julie Penzotti and others
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## OPSIN licence

```
Copyright 2017 Daniel Lowe

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

The Apache License 2.0, which covers TeaVM and the StAX API, is in `opsin-js/licences/Apache-2.0.txt`.

Chem Illustrator replaces two of OPSIN's classes (`ResourceGetter` and `AutomatonInitialiser`, which load OPSIN's data files) and stands in for the Log4j logging calls; see `opsin-js/README.md`. The rest of OPSIN is unchanged.

## dk.brics.automaton licence

```
Copyright (c) 2001-2022 Anders Moeller
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. The name of the author may not be used to endorse or promote products
   derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## pyspellchecker licence

```
MIT License

Copyright (c) 2018-2021 Tyler Barrus

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## fflate licence

```
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
