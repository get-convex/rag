# Changelog

## 0.7.0

- AI SDK v6 support

## 0.6.1

- Track bandwidth more accurately to avoid going over the limits while deleting
  chunks.

## 0.6.0

- Adds /test and /\_generated/component.js entrypoints
- Drops commonjs support
- Improves source mapping for generated files
- Changes to a statically generated component API

## 0.5.4

- Support gateway string IDs for models

## 0.5.3

- Return usage data from embedding for search/add

## 0.5.2

- Support text embedding models as a string

## 0.5.1

- Fix orphaned embeddings when replacing content

## 0.5.0 AI SDK v5 support

- Adds support for AI SDK v5

## 0.3.5

- Fix orphaned embeddings when replacing content

## 0.3.4

- ai is a regular dependency
- namespaces can be deleted if there are no entries left in them
- namespaces can be synchronously deleted from an action if there are entries in
  them

## 0.3.3

- Allow deleting an entry by key asynchronously or sync
- Deprecated: `.delete` from mutations is deprecated. `.delete` is now
  synchronous for an entry. Use `.deleteAsync` from mutations instead.
- Fix: Delete embeddings when deleting entry
- Fix: Replacing small documents by key no longer leaves them in "pending"
  state.

## 0.3.2

- query can be a string or array, instead of separate embedding argument.
- nicer examples & UI to play with
- default chunk sizes are smaller
- EntryFilterValue is now called EntryFilter
- Fixes chunker handling of empty lines
- supports sha-1 content hashing in utility
- default context formatting separates content better for LLMs
- list can take a limit instead of paginationOpts
- findExistingEntryByContentHash is renamed to drop the Existing

## 0.3.1

- Demote document titles to h2 when auto-generating prompt template
- Rename replacedVersion -> replaced{Entry,Namespace} to match onComplete
- Allow listing documents by status without specifying a namespace (e.g.
  vacuuming)
- Return replacedAt when listing documents

## 0.1.7/0.3.0

- Renamed to RAG
- Adds a default chunker, so you can pass `text` to `add[Async]`
- Adds a `generateText` with default prompt formatting for one-off generation.
- OnComplete handler now has updated status for the replaced & new
  entry/namespace
- Example showcases prompting as well as searching.

## 0.1.6

- Add VSearchEntry type for casing vSearchEntry to a type-safe version

## 0.1.5

- Add SearchEntry type with type-safe access to metadata & filter values

## 0.1.4

- Allow adding files asynchronously
- Allow passing an onComplete handler to creating entries or namespaces, that is
  called when they are no longer pending.
- Support generic type-safe metadata to be stored on the entry.
- Updated the example to also show uploading files via http.

## 0.1.3

- Renamed doc to entry
- Allows passing vectorScoreThreshold to search
- More convenient `text` returned from search
- Enables passing in your own embedding parameter to add -> Allows adding (a few
  chunks) from a mutation.

## 0.1.2

- Snips console logs

## 0.1.1

- Vector search over chunked content, with namespaces, search filters, etc.
- You can also gracefully transition between models, embedding lengths, chunking
  strategies, and versions, with automatically versioned namespaces.
- See the example for injesting pdfs, images, audio, and text!
- List namespaces by status, entries by namespace/status, and chunks by entry
- Find older versions by content hash to restore.
- Add metadata filters for searching.
