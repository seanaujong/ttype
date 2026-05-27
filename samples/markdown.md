# Markdown v2 dogfood

A short intro paragraph with inline `code`, **bold**, and _italic_ so the
older inline spans render alongside the new ones.

> a quoted line — the `> ` prefix should be gray and skipped
> a second quoted line

- first bullet — the `- ` marker should be gray, the text typeable
- second bullet
  - a nested bullet (its indent is skipped; only `- ` is cosmetic)

1. ordered one — the `1. ` marker should be gray
2. ordered two

Edge cases that must NOT be treated as list markers: a `**bold**` lead-in,
and a thematic break below.

---

````ts
const verbatim = 'fenced code stays typeable; the ``` lines are gray';
````
