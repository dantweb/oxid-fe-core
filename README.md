# @dantweb/oxid-fe-core

Shared Vue 3 library and TypeScript SDK for OXID headless frontends — the role
[vbwd-fe-core](https://github.com/VBWD-platform/vbwd-fe-core) plays for VBWD, over OXID's GraphQL
API (`graphql-base` + `graphql-storefront`) instead of REST.

## What it provides

| Module                               | Job                                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `GraphqlClient` / `GraphqlError`     | typed transport to `<shop-url>/graphql/`; maps `extensions.errorCode` to typed errors                     |
| `AuthService` / `TokenStorage` / jwt | graphql-base token lifecycle: login, **anonymous guest tokens**, expiry, logout (refresh tokens: planned) |
| `PluginRegistry` / `IPlugin`         | plugins contribute routes, nav items, i18n messages, config and a `setup()` — the host applies them       |
| `EventBus` / `CoreEvents`            | decoupled host ↔ plugin communication (`auth:login`, `auth:logout`, `auth:session-expired`)               |
| `createAuthGuard`                    | vue-router guard for `meta.requiresAuth` routes                                                           |
| `createAuthStore`                    | Pinia mirror of the auth state for templates                                                              |
| `addressSchema` (zod), `formatPrice` | shared validation and formatting                                                                          |

## Development (inside the OXID Docker SDK)

The SDK ships an `oxid-fe-core` service (see `services/oxid-fe-core.yml` in the SDK root):

```bash
make file=services/oxid-fe-core.yml addservice   # once
make up
docker compose exec oxid-fe-core npm ci
docker compose exec oxid-fe-core npm test
```

Host-side: Node ≥ 22, then `npm ci`.

## Commands

```bash
npm run build          # vite lib build + rolled-up d.ts into dist/
npm test               # vitest
npm run test:coverage  # with v8 coverage (target ≥ 90% lines)
npm run lint           # eslint + prettier --check
npm run type-check     # vue-tsc --noEmit
npm run knip           # dead code / unused exports & deps
npm run evaluate       # violations report (suppressions, coverage, outdated)
```

All of these are the quality gate — see `docs/dev_log` in oxid-fe-user for the binding
engineering requirements (SOLID, DRY, clean code, TDD, no overengineering, no dead code,
regular evaluation of violations, quality guards).

## Consuming

```bash
npm install @dantweb/oxid-fe-core   # GitHub Packages (scope @dantweb)
```

For local two-repo development the SDK layout keeps `oxid-fe-core` and `oxid-fe-user` as siblings
and oxid-fe-user depends on `file:../oxid-fe-core` — run `npm run build` here after changes.

## License

BUSL-1.1 (Business Source License), following the reference platform's licensing.
