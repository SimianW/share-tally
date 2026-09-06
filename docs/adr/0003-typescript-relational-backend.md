# Use TypeScript and a relational backend within the learning budget

Use React, Vite, and TypeScript for the frontend, with one Node.js/Express backend and PostgreSQL. The owner chose a shared language over learning Spring Boot or using FastAPI for this project so the limited delivery budget can focus on relational modeling, permissions, and transactions.

Use Drizzle ORM and Drizzle Kit for database access and migrations. The owner prefers typed, higher-level SQL tooling over writing all queries directly through `pg`, while retaining ownership of the schema and reviewing generated SQL. This tooling choice does not select an authentication service or determine the deployment topology.
