# contract/

The data shapes, authored once.

- **`entities/`** — what the system stores and the screens render. Consumed by the TypeScript
  generator and by fixture validation. These may use `$ref` between each other.
- **`agents/`** — what a model is *forced to return*. Fed straight to Vertex `responseSchema`,
  so each one is **self-contained and stays inside the OpenAPI 3.0 subset**: no `$ref`, no
  `oneOf`/`anyOf`/`allOf`, no `additionalProperties`. `contract/check.mjs` enforces that.

Every field carries a `description`. Vertex passes descriptions to the model as part of the
schema, so they are prompt surface, not just documentation — write them as instructions.

```bash
node contract/check.mjs        # schemas parse, refs resolve, agent schemas are Vertex-safe
node contract/build-types.mjs  # writes contract/types.ts
```

**Shape rule: flat with a discriminator.** A `Field` carries every possible slot with most of
them null, and `kind` says which ones are meaningful. It is uglier to read than a tagged union
and it works identically in TypeScript, Kotlin and Vertex — a model cannot get it wrong, and
there is no projection step to maintain. The ugliness lives in one file nobody reads often.

Kotlin is hand-written from these (see the spec, §4). Nothing generates it.
