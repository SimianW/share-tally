# Keep note photos apart from receipt photos

Initiators can attach up to three note photos to a bill, for example of the products or how they were divided. The existing receipt photo storage was the obvious place to put them, but receipt photos exist to be read: each draft holds one base64 photo that expires after six months together with its receipt evidence (ADR-0010). Note photos are only looked at, never read for receipt contents, and members expect them to last as long as the bill. They therefore have their own storage: one row per photo holding the compressed bytes, attached to a bill draft before initiation and to the bill after it. They never expire and are physically purged only when their group is deleted (ADR-0013). Adding or removing one changes no bill revision and invalidates no confirmation.

## Considered Options

- **Reuse the receipt photo storage.** Rejected because it holds one photo per draft and its six-month expiry is tied to receipt evidence that note photos do not have.
- **Store base64 text, as receipt photos do.** Rejected because raw bytes take about a quarter less space, and the two kinds of photo already need separate storage.
- **Store files on disk and keep only paths in the database.** Rejected because group deletion could then no longer purge photos in the same transaction as the rest of the group's data.
