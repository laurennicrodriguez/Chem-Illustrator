# Third-party notices

Chem Illustrator ships the following open-source software.

| Package | Used for | Licence |
|---|---|---|
| [RDKit](https://www.rdkit.org) (`@rdkit/rdkit`, MinimalLib WebAssembly build) | Chemistry: formula, masses, stereo, SMILES | BSD-3-Clause (full text below) |
| [Tauri](https://tauri.app) (`tauri` crate, `@tauri-apps/api`) | Desktop app shell | MIT or Apache-2.0 |
| About 260 Rust crates that Tauri uses (listed in `src-tauri/Cargo.lock`) | Desktop app shell | Mostly MIT or Apache-2.0; a few are Unicode-3.0, BSD-3-Clause, Zlib or MPL-2.0. All are free and open source; MPL-2.0 only asks that changes to those crates' own files be shared. |
| Microsoft Edge WebView2 (part of Windows, not bundled) | Shows the app's window contents on Windows | Microsoft software licence, free to use |

Used only to build and test, not shipped: TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), Playwright (Apache-2.0), Tauri CLI (MIT or Apache-2.0).

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
