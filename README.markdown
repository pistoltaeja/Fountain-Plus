# Fountain+

Fountain+ aka Fountain-Plus implements the [Mangaplay](https://mangaplay.studio) format with [Fountain](http://fountain.io) to extend screenplay functionality and add storyboard capabilities for comics, manga, and webtoons. It is a superset of Fountain that targets storyboards.

Fountain+ also comes along with built in readers and writers for popular screenplay formats.

## Storyboard Package

The `Storyboard/` directory contains a standalone JavaScript parser package (`@fountain-plus/storyboard`) that handles:

- **Mangaplay format** — panel-based storyboard scripts with layout tags, SFX, title cards
- **Fountain format** — standard screenplay parsing and round-trip conversion
- **Superscript format** — simplified plain-text storyboard notation
- **Format detection** — automatic detection of input format

### Usage

```javascript
import { parseScript } from '@fountain-plus/storyboard';
import { detectFormat } from '@fountain-plus/storyboard';

const ast = parseScript(scriptText);
const format = detectFormat(scriptText);
```

### Structure

```
Storyboard/
├── index.js              — Public API re-exports
├── package.json
├── core/
│   ├── types.js          — Parser type definitions (JSDoc)
│   ├── format-detector.js
│   └── parser/           — All parser implementations
├── sample/               — Sample .mangaplay and .fountain files
└── tests/                — Parser unit tests
```

---

## Apps using Fountain+

- **[Fountain+ Converter](https://fountain.plus/screenplay-converter)** — Free browser-based screenplay format converter (Fountain, FDX, Fade In, PDF, Mangaplay, plain text)
- **[Fountain+ Screenplay Checker](https://fountain.plus/screenplay-checker)** — Free browser-based screenplay checker & pre-coverage reports (scene, character, location, cast)
- **[Fountain+ Exporter For Google Docs](https://workspace.google.com/marketplace/app/fountain+_exporter/189600936550)** — Google Workspace add-on that exports Google Docs screenplays to industry formats
- **[Mangaplay Studio App](https://mangaplay.studio/app)** — Manga/comic/screenplay storyboard editor with real-time panel preview
- **[Mangaplay Studio for Google Docs](https://chromewebstore.google.com/detail/script-to-storyboard-%C2%B7-go/hiidpbendbgfcdidhccnldbkgdeikibi)** — Chrome extension that turns Google Docs into a live storyboard

---

## Fountain

Fountain-Plus is built on [Fountain](http://fountain.io), the plain-text screenplay format created by John August and Nima Yousefi. The original Objective-C parser in the `Fountain/` directory is forked from [nyousefi/Fountain](https://github.com/nyousefi/Fountain) and released under the MIT license.

For the full Fountain spec and ecosystem, see [fountain.io](http://fountain.io).