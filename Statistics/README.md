# fountain-statistics

Lean, zero-dependency statistics library for Fountain and Mangaplay screenplays.

Inspired by [Better Fountain](https://github.com/piersdeseilligny/betterfountain) by Piers Deseilligny.

## API

```javascript
import { computeStatistics } from './index.js';

const stats = computeStatistics(tokens, { isMangaplay: false });
// stats.outline, stats.characters, stats.locations,
// stats.duration, stats.length, stats.readability, stats.warnings
```

### Individual functions

```javascript
import { computeOutline, computeCharacters, computeLocations, computeDuration, computeLength, computeReadability } from './index.js';
```

Each accepts `(tokens, options)` and returns its slice of the statistics.

## Input

Flat token array from parser. Each token: `{ type, text, line, depth?, character? }`.

Set `isMangaplay: true` for Mangaplay AST tokens.

## License

MIT
