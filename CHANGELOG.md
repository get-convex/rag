# Changelog

## 0.2.0

- Renamed to RAG
- Adds a default chunker, so you can pass `text` to `add[Async]`
- Adds a `generateText` with default prompt formatting for one-off generation.
- OnComplete handler now has updated status for the replaced & new entry/namespace
- Example showcases prompting as well as searching.

## 0.1.6

- Add VSearchEntry type for casing vSearchEntry to a type-safe version

## 0.1.5

- Add SearchEntry type with type-safe access to metadata & filter values

## 0.1.4

- Allow adding files asynchronously
- Allow passing an onComplete handler to creating entries
  or namespaces, that is called when they are no longer pending.
- Support generic type-safe metadata to be stored on the entry.
- Updated the example to also show uploading files via http.

## 0.1.3

- Renamed doc to entry
- Allows passing vectorScoreThreshold to search
- More convenient `text` returned from search
- Enables passing in your own embedding parameter to add
  -> Allows adding (a few chunks) from a mutation.

## 0.1.2

- Snips console logs

## 0.1.1

- Vector search over chunked content, with namespaces, search filters, etc.
- You can also gracefully transition between models, embedding lengths,
  chunking strategies, and versions, with automatically versioned namespaces.
- See the example for injesting pdfs, images, audio, and text!
- List namespaces by status, entries by namespace/status, and chunks by entry
- Find older versions by content hash to restore.
- Add metadata filters for searching.
