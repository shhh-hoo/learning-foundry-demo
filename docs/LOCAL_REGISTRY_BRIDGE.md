# Local registry bridge

`scripts/demo-registry-server.ts` runs on `127.0.0.1:4175` and exposes `GET /health`, `GET /manifest`, `GET /components`, `GET /components/:id`, `POST /components` and `DELETE /session`.

The in-memory session starts from the bundled published snapshots. POST accepts only canonical `PUBLISHED` components with a supported schema, expert review, publication metadata and a matching canonical content hash. Malformed, unsupported, unpublished and hash-mismatched snapshots receive structured errors.

CORS is restricted to localhost/127.0.0.1 on ports 4173 and 4174. This is a deterministic local demonstration boundary, not a production registry: it has no database, authentication, durable multi-user state or remote deployment.

Standard Trainer loads bundled snapshots first, then validated local snapshots. Exact id/version entries are deduplicated, and the highest compatible semantic version is the default for a component id. If the local service is absent or rejects content, the online-safe static registry remains authoritative.
