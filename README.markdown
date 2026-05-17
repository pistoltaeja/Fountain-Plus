# Fountain-Plus

Fountain-Plus extends the [Fountain](http://fountain.io) screenplay format with manga, webtoon, and storyboard capabilities. It is a superset of Fountain: any valid Fountain document is a valid Fountain-Plus document.

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

## Fountain

Fountain-Plus is built on [Fountain](http://fountain.io), the plain-text screenplay format created by John August and Nima Yousefi. The original Objective-C parser in the `Fountain/` directory is forked from [nyousefi/Fountain](https://github.com/nyousefi/Fountain) and released under the MIT license.

For the full Fountain spec and ecosystem, see [fountain.io](http://fountain.io).