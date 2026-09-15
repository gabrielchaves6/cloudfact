# CloudFacts brand assets

Used by the pages cloudfact generates (the catalog page today). Copied into a deploy as-is, so the page
carries its own typography and mark and depends on nothing external.

| File                                                          | What it is                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `CloudFactsSans-Regular.woff2`, `CloudFactsSans-Medium.woff2` | CloudFacts Sans 0.1, weights 400 and 500. Derived from Inter 4.001 by The Inter Project Authors. |
| `OFL.txt`                                                     | SIL Open Font License 1.1, which covers both files above and must travel with them.              |
| `symbol.png`                                                  | The mark, flattened to the brand off-white `#F4F4F1` and reduced to 128 px.                      |

Only weights 400 and 500 exist: asking for 600 or 700 makes the browser fake a bold and the shapes fall
apart. The mark is off-white on a dark surface; do not recolour it.

The font is OFL, the rest of cloudfact is MIT. Keep `OFL.txt` next to the `.woff2` files wherever they go.
