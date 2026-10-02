# Share financial calculations through a domain package

The browser previews and the server both computed exact claim fractions, draft receipt pricing and frozen item corrections, so every pricing change had to be made twice and kept in step by parity tests. During the first structure stage of #159 the owner chose to move these calculations and the JSON wire contracts into one dependency-free package that both applications link, even though #159 had deferred a cross-package library to a later delivery. The duplicated arithmetic was the larger risk to financial correctness than the added build step.

The server still validates every input and recomputes every persisted amount; a browser preview never authorizes a saved value. Server database types stay internal, and compile-time checks verify that server projections serialize to the shared contracts. The benchmark's frozen baseline remains independent of the package.

## Consequences

Each application compiles the package with its own TypeScript compiler before dev, build and test commands, and the Docker images copy the compiled package beside the server. A future runtime dependency in the package would require installing it in both applications and in the production image.

## Considered Options

- Keep separate browser and server implementations with shared known-input, expected-output examples: rejected because a missed edit in one runtime is caught only if an example happens to cover it.
- Adopt a full monorepo workspace: rejected because the applications keep separate installations, lockfiles and builds.
