# Drone CI/CD findings for ShareTally

Research date: 2026-09-13. Sources are official Drone and Testcontainers documentation or their upstream repositories, fetched on this date.

## Pipeline triggers and execution

- Drone receives SCM webhooks for pushes, pull requests, and tags. `trigger.event` accepts `push` and `pull_request`; `trigger.branch` uses glob matching, and for pull requests it evaluates the target branch. When multiple trigger fields are present, all must match. Therefore a pipeline intended for pushes and PRs targeting `main` can use `trigger: { event: [push, pull_request], branch: [main] }`. [Drone trigger syntax](https://docs.drone.io/pipeline/docker/syntax/trigger/) (official source: [`content/pipeline/docker/syntax/trigger.md`](https://raw.githubusercontent.com/drone/docs/master/content/pipeline/docker/syntax/trigger.md)).
- Docker pipeline steps run sequentially by default; a dependency graph with `depends_on` can fan out and fan in. The Docker runner executes steps in ephemeral containers and is Drone's general-purpose default. [Docker parallelism](https://docs.drone.io/pipeline/docker/syntax/parallelism/), [Docker runner overview](https://docs.drone.io/runner/docker/overview/).
- The Docker runner's `DRONE_RUNNER_CAPACITY` limits concurrent pipelines on that runner; its documented default is 2. This is runner capacity, not a per-repository cancellation or deduplication policy. [Docker runner capacity reference](https://docs.drone.io/runner/docker/configuration/reference/drone-runner-capacity/).
- The Docker pipeline YAML specification also defines an optional top-level `concurrency` object with a numeric `limit` for the named pipeline. This is the pipeline-level setting to use when the goal is limiting simultaneous executions of that pipeline; the runner capacity remains a separate host-wide limit. [Docker YAML specification](https://docs.drone.io/yaml/docker/).
- Exec pipelines execute shell commands directly on the host without isolation and are disabled on Drone Cloud; Drone recommends Docker for projects by default. [Exec pipeline overview](https://docs.drone.io/pipeline/exec/overview/), [Exec runner overview](https://docs.drone.io/runner/exec/overview/).

## Workspace, secrets, and substitutions

- Drone creates an ephemeral workspace volume, defaults it to `/drone/src`, and shares filesystem changes between steps; it destroys the workspace after the pipeline. [Docker workspace](https://docs.drone.io/pipeline/docker/syntax/workspace/).
- Repository secrets can be mapped into step environment variables with `from_secret` or into plugin settings. They are not exposed to pull requests by default; enabling PR access is an explicit security tradeoff. [Repository secrets](https://docs.drone.io/secret/repository/).
- Drone evaluates `${...}` parameter expressions before parsing YAML. To pass a shell expression through to the step, escape it as `$${...}`. Quote substitutions when their expanded value could affect YAML parsing. [Environment substitution](https://docs.drone.io/pipeline/environment/substitution/).

## Docker socket and trust boundary

- A host volume mount must use an absolute host path and is available only to trusted repositories because it exposes the host filesystem. Drone's official Docker example mounts `/var/run/docker.sock` into a step and explicitly calls host socket mounting highly insecure and suitable only for trusted environments. [Host volumes](https://docs.drone.io/pipeline/docker/syntax/volumes/host/), [Docker socket example](https://docs.drone.io/pipeline/docker/examples/services/docker/).
- `privileged: true` maps to Docker `--privileged`, is available only to trusted repositories, and effectively grants the container root access to the host. A Docker-in-Docker service uses both a privileged service and a temporary volume in Drone's example. [Step syntax](https://docs.drone.io/pipeline/docker/syntax/steps/), [Docker-in-Docker example](https://docs.drone.io/pipeline/docker/examples/services/docker_dind/).
- The Docker runner itself needs access to the host Docker daemon; its Linux installation example mounts `/var/run/docker.sock` into the runner container. [Docker runner Linux installation](https://docs.drone.io/runner/docker/installation/linux/).

## Service containers and Testcontainers networking

- Drone service containers are reachable from pipeline steps by a hostname equal to the service name; `localhost` and `127.0.0.1` must not be used for that service connection. Services can take time to initialize, so the docs recommend a health check or wait. [Drone services](https://docs.drone.io/pipeline/docker/syntax/services/).
- Testcontainers for Node can create a Docker network, attach containers to it, and use network aliases for container-to-container communication. Its docs also say bind mounts are not portable and do not work with Docker-in-Docker or a remote Docker agent. [Testcontainers networking](https://node.testcontainers.org/features/networking/), [Testcontainers containers](https://node.testcontainers.org/features/containers/).
- Practical implication: a Testcontainers test running inside a Drone step needs a reachable Docker API (usually the trusted host socket or a deliberately configured Docker-in-Docker daemon). Containers created by Testcontainers should share an explicitly configured network when they need to talk to each other. A Drone service's hostname is guaranteed for Drone's pipeline network; do not assume a Testcontainers-created container can resolve that name unless both sides are attached to the same Docker network. This last sentence is an integration inference from the two official networking models, not a Drone promise.

## Recommendation for this repository

Use a Docker pipeline triggered by repository pushes. The owner chose automatic deployment only for pushes to `main`; feature-branch pushes run checks. This host uses a trusted Docker socket pipeline, so this configuration excludes `pull_request` events. Keep credentials in repository secrets, and keep shell scripts in checked-in files to avoid Drone's YAML substitution layer. Integration tests run in an image using host networking plus `TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1`, so their dynamically published PostgreSQL ports are reachable on this Linux runner. Validate this arrangement by running the actual test image.

## Local evidence

Read-only inspection found `drone/drone:2.27.2`, `drone/drone-runner-docker:1.8.5`, and runner mounts for `/var/run/docker.sock` and `/opt/repo`. Existing `.drone.yml` files in `/home/simon/Dev/simianwang.me` and `/opt/repo/who-in-dc-backend` build GHCR images and deploy with host Docker Compose. ShareTally uses the same tools but deploys immutable commit SHA tags from Drone's checkout, with no persistent host git reset.

The shared PostgreSQL service is `1Panel-postgresql-kXBk`, running PostgreSQL 17.6 on Docker network `1panel-network`. Recommended separate database: `share_tally_production`, owner role `share_tally_app`. These are configuration proposals, not a claim that the database or role has been created.
