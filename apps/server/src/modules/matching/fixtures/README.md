# Matching regression data

`bangumi-data.json` contains 360 reference title cases and candidate data. It is retained as reference material; the current automated suite does not execute this corpus.

Chapter and relation matching is covered independently by `service.test.ts` and `utils/episodes.test.ts`, using protocol-level mock responses. Default confidence is 0.85 with a 0.1 margin; ambiguous matches require confirmation.

Fixture source: [Bangumi-syncer, commit 488a126](https://github.com/Apocalypsor/Bangumi-syncer/tree/488a126). The source fixtures are covered by the following MIT notice.

```text
MIT License

Copyright (c) 2024 SanaeMio

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
