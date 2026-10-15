# @dantweb/oxid-fe-core

Shared Vue 3 library and TypeScript SDK for OXID headless frontends — the role
[vbwd-fe-core](https://github.com/VBWD-platform/vbwd-fe-core) plays for VBWD, over OXID's GraphQL
API (`graphql-base` + `graphql-storefront`) instead of REST.

## What it provides

| Module                                                            | Job                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `GraphqlClient` / `GraphqlError`                                  | typed transport to `<shop-url>/graphql/`; maps `extensions.errorCode` to typed errors                                                     |
| `AuthService` / `TokenStorage` / jwt                              | graphql-base token lifecycle: login, **anonymous guest tokens**, expiry, logout (refresh tokens: planned)                                 |
| `PluginRegistry` / `IPlugin`                                      | plugins contribute routes, nav items, i18n messages, config and a `setup()` — the host applies them                                       |
| `EventBus` / `CoreEvents`                                         | decoupled host ↔ plugin communication (`auth:login`, `auth:logout`, `auth:session-expired`)                                               |
| `createAuthGuard`                                                 | vue-router guard for `meta.requiresAuth` routes                                                                                           |
| `createAuthStore`                                                 | Pinia mirror of the auth state for templates                                                                                              |
| `styles/variables.css`, `applyTheme` / `clearTheme` / `loadTheme` | the `--oxfe-*` design-token contract and theme loading (parent chain, fallback to the default theme) — see oxid-fe-user `docs/theming.md` |
| `addressSchema` (zod), `formatPrice`                              | shared validation and formatting                                                                                                          |

## Development

oxid-fe-core is a **library**, not a service: it has no container of its own. It is built with
Node ≥ 22 (`npm ci && npm run build`) and consumed by `oxid-fe-user`, whose SDK container mounts
this checkout at `/oxid-fe-core` (the app's `file:../oxid-fe-core` dependency). To work on both
inside the OXID Docker SDK use the `oxid-fe-user` service:

```bash
make file=services/oxid-fe-user.yml addservice   # once
make up
docker compose exec oxid-fe-user sh -c 'cd /oxid-fe-core && npm ci && npm test'
```

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
