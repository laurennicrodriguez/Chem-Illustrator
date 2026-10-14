# Third-party notices

Chem Illustrator is licensed under the GNU General Public License, version 3 or later (see `LICENSE`). It ships the following open-source software, each part under its own licence, all of which allow it to be shipped with a GPL-3.0 program. (Apache-2.0 parts need GPL version 3, which is why the app uses version 3 or later rather than version 2.)

| Package | Used for | Licence |
|---|---|---|
| [RDKit](https://www.rdkit.org) (`@rdkit/rdkit`, MinimalLib WebAssembly build) | Chemistry: formula, masses, stereo, SMILES | BSD-3-Clause (full text below) |
| [OPSIN](https://github.com/dan2097/opsin) 2.9.0, compiled to JavaScript (`src/vendor/opsin/opsin.js`, data in `public/opsin/opsin-data.dat`) | Name to Structure, offline | MIT (full text below) |
| [dk.brics.automaton](https://www.brics.dk/automaton/) 1.12-4 (part of the OPSIN build) | OPSIN's name grammar | BSD-3-Clause (full text below) |
| [TeaVM](https://teavm.org) 0.16.0 runtime and class library (part of the OPSIN build) | Runs OPSIN's Java code as JavaScript | Apache-2.0; includes code from Apache Harmony (Apache-2.0). Notice: "This product includes software developed by Alexey Andreev (http://teavm.org). This product includes software developed by The Apache Software Foundation (http://www.apache.org/)." |
| StAX API 1.0.1 (`stax:stax-api`, interfaces only, part of the OPSIN build) | Lets OPSIN read its XML word lists | Apache-2.0 |
| [fflate](https://github.com/101arrowz/fflate) 0.8.2 | Packing and unpacking PowerPoint, Excel and Word files (.pptx, .xlsx, .docx), and compressing PDF pages | MIT (full text below) |
| Free fonts from [Google Fonts](https://fonts.google.com), packaged by [Fontsource](https://fontsource.org) 5.3 (`@fontsource/*`): Inter, Source Sans 3, IBM Plex Sans, Lato, Source Serif 4, Merriweather, Libre Baskerville, Montserrat, Oswald, Bebas Neue, Archivo Black, Barlow Condensed, JetBrains Mono, IBM Plex Mono (Latin, Latin-extended and Greek letters, regular and bold) | The font boxes in every mode; put inside saved Word and PowerPoint files that use them | SIL Open Font License 1.1 (copyright lines and full text below) |
| [Tauri](https://tauri.app) (`tauri` crate, `@tauri-apps/api`) | Desktop app shell | MIT or Apache-2.0 |
| Tauri dialog plugin (`tauri-plugin-dialog` crate, `@tauri-apps/plugin-dialog`) | The desktop app's Open and Save dialogs | MIT or Apache-2.0 |
| Tauri updater and process plugins (`tauri-plugin-updater`, `tauri-plugin-process` crates, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`) | File ▸ Check for Updates: downloading a newer version, checking its signature, installing it and restarting | MIT or Apache-2.0 |
| Tauri opener plugin (`tauri-plugin-opener` crate, `@tauri-apps/plugin-opener`) | Opening a compound's PubChem page in the browser | MIT or Apache-2.0 |
| [windows-sys](https://github.com/microsoft/windows-rs) crate (Windows only) | The desktop app's clipboard on Windows (pictures for Word and PowerPoint) | MIT or Apache-2.0 |
| About 260 Rust crates that Tauri uses (listed in `src-tauri/Cargo.lock`) | Desktop app shell | Mostly MIT or Apache-2.0; a few are ISC, Unicode-3.0, BSD-3-Clause, Zlib, MPL-2.0 or CDLA-Permissive-2.0 (the list of trusted web certificates the updater uses). All are free and open source; MPL-2.0 only asks that changes to those crates' own files be shared. |
| English word list from [pyspellchecker](https://github.com/barrust/pyspellchecker) 0.8.1 (`public/dict/english.txt`) | Spell check: ordinary English words, most common first (for suggestions) | MIT (full text below). The list was built by pyspellchecker from word counts in the OpenSubtitles2018 corpus (P. Lison and J. Tiedemann, LREC 2016). |
| [Open Source Chemistry Dictionary](https://www.sciencebase.com/chem-dic.zip) v3.0 by Adam M. Azman (`public/dict/chemistry.txt`) | Spell check: chemistry words | CC BY 3.0 US. Credits, source and changes in `public/dict/chemistry-LICENSE.txt`. A. M. Azman, *J. Chem. Educ.* 2012, 89, 412–413. |
| Chemistry word lists from Chem SI Assistant by Nathan O'Hare (`public/dict/lab-words.txt`) | Spell check: lab terms, name reactions and other chemistry words | The project owner's own work |
| Microsoft Edge WebView2 (part of Windows, not bundled) | Shows the app's window contents on Windows | Microsoft software licence, free to use |

Used only to build and test, not shipped: TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), jsdom (MIT), Playwright (Apache-2.0), Tauri CLI (MIT or Apache-2.0). Rebuilding the OPSIN files (`opsin-js/`, rarely needed) also uses Java, Maven (Apache-2.0) and the TeaVM compiler (Apache-2.0).
Remaking the font width tables (`scripts/font-widths.py`, rarely needed) uses Python and fontTools (MIT).

`src/text-metrics.ts` holds the standard character widths of Helvetica/Arial, regular and bold (the widths in Adobe's freely distributed Helvetica font metrics), so saved files and copied pictures place text as ChemDraw does. No font files are included.

`src/text/font-widths.ts` holds the width of every character in the Liberation fonts (Liberation Serif, Sans and Mono 2.x; Digitized data copyright (c) 2010 Google Corporation with Reserved Font Arimo, Tinos and Cousine; copyright (c) 2012 Red Hat, Inc. with Reserved Font Name Liberation), licensed under the [SIL Open Font License 1.1](https://openfontlicense.org). The Liberation fonts have the same widths as Times New Roman, Arial and Courier New, so documents break their lines in the same places on every computer, in PDFs and in Word. Only the widths are used; no font files or glyph outlines are included.

The ready-made palette rows (Edit ▸ Colour Palettes) include the colour-blind-safe set of M. Okabe and K. Ito (*Color Universal Design*, 2008) and steps of the Blues and OrRd schemes from [ColorBrewer](https://colorbrewer2.org) by Cynthia A. Brewer, Pennsylvania State University (Apache-2.0). Only the colour values are used.

Copied pictures are written as Enhanced Metafiles (EMF) and Windows bitmaps from Microsoft's published format specifications ([MS-EMF], BMP); no Microsoft code is included.

PowerPoint (.pptx), Excel (.xlsx) and Word (.docx) files are read and written from the published Office Open XML standard (ECMA-376); ChemDraw drawings embedded in Word files are read from the published compound file format ([MS-CFB]) and the CDX format documentation; PDF files from the published PDF specification (ISO 32000), using only the standard 14 PDF fonts. No Microsoft or Adobe code is included.

The CDXML and CDX formats are read and written from CambridgeSoft's published CDX/CDXML format documentation and from example files; no ChemDraw code or documentation is included.

## Font copyrights and licence

The bundled fonts are used unchanged (only the Latin, Latin-extended and Greek parts of each, as Fontsource provides them).

- Inter: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)
- Source Sans 3: © 2023 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'
- IBM Plex Sans: Copyright 2019 IBM Corp. All rights reserved.
- Lato: Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato"
- Source Serif 4: © 2014-2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name 'Source'
- Merriweather: Copyright 2024 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4) with Reserved Font Name "Merriweather"
- Libre Baskerville: Copyright 2012 The Libre Baskerville Project Authors (https://github.com/impallari/Libre-Baskerville)
- Montserrat: Copyright 2011 The Montserrat Project Authors (https://github.com/JulietaUla/Montserrat)
- Oswald: Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont)
- Bebas Neue: Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue)
- Archivo Black: Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack)
- Barlow Condensed: Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)
- JetBrains Mono: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)
- IBM Plex Mono: Copyright 2017 IBM Corp. All rights reserved.

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

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
