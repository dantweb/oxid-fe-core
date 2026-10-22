# @dantweb/oxid-fe-core

Shared Vue 3 library and TypeScript SDK for OXID headless frontends — the role
[vbwd-fe-core](https://github.com/VBWD-platform/vbwd-fe-core) plays for VBWD, over OXID's GraphQL
API (`graphql-base` + `graphql-storefront`) instead of REST.

## What it provides

| Module                                                            | Job                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GraphqlClient` / `GraphqlError`                                  | typed transport to `<shop-url>/graphql/`; maps `extensions.errorCode` to typed errors                                                                                                                                                                                                                                                                     |
| `ResponseCache`                                                   | opt-in request cache: `client.execute(q, vars, { cacheTtlMs })` serves an identical read from memory (key = final URL + language + token + query + variables), shares one in-flight load, clears on any successful mutation; pass `cache: new ResponseCache()` to the client                                                                              |
| `AuthService` / `TokenStorage` / jwt                              | graphql-base token lifecycle: login, **anonymous guest tokens**, expiry, logout that revokes the token, refresh tokens with silent renewal                                                                                                                                                                                                                |
| `isRejectedToken` / `onTokenRejected`                             | the shop checks the bearer token before it reads the query. When it refuses one, `AuthService` drops it (`SessionExpired` for a customer), a **query** is retried once without a token, a mutation is never replayed; `execute(…, { omitToken: true })` is used for `token` calls so a stale token cannot block a login                                   |
| `PluginRegistry` / `IPlugin`                                      | plugins contribute routes, nav items, i18n messages, config and a `setup()` — the host applies them                                                                                                                                                                                                                                                       |
| `EventBus` / `CoreEvents`                                         | decoupled host ↔ plugin communication (`auth:login`, `auth:logout`, `auth:session-expired`)                                                                                                                                                                                                                                                               |
| `createAuthGuard`                                                 | vue-router guard for `meta.requiresAuth` routes                                                                                                                                                                                                                                                                                                           |
| `createAuthStore`                                                 | Pinia mirror of the auth state for templates                                                                                                                                                                                                                                                                                                              |
| `styles/variables.css`, `applyTheme` / `clearTheme` / `loadTheme` | the `--oxfe-*` design-token contract and theme loading (parent chain, fallback to the default theme) — see oxid-fe-user `docs/theming.md`                                                                                                                                                                                                                 |
| `addressSchema` (zod), `formatPrice`                              | shared validation and formatting                                                                                                                                                                                                                                                                                                                          |
| `useLocaleSwitch` / `localeSwitchKey` / `languageName`            | the one way to change the storefront language: the host provides its locale ref + ordered locales, any switcher (host header, layout plugin) calls `switchTo`: the choice is kept under `LOCALE_STORAGE_KEY` and the page reloads, so shop content follows (like the shop's own language links); `languageName('de')` → "Deutsch" via `Intl.DisplayNames` |

## Language and shop ids

The API selects language and shop by numeric id in the query string. The host tells the client how:

```ts
client.setEndpointParamsProvider(() => ({ lang: languageIds[locale.value], shp: shopId }));
// POST /graphql/?shp=2&lang=1 — nothing is appended for a field that is undefined
```

`Accept-Language` is still sent, so shops that auto-detect the language keep working. The final URL is
part of the response-cache key.

## Errors by code

```ts
try { await api.start(basketId, options); }
catch (error) {
  switch (errorCodeOf(error)) {          // KnownErrorCode | undefined
    case 'terms_not_confirmed': …
    case 'network_error': …
    default: … // undefined: show a generic text, never error.message
  }
  providerCodeOf(error);                  // e.g. 'card_declined' — free-form, from the provider
}
```

## Sessions: login, refresh, logout

`auth.login()` uses graphql-base `login` and keeps both tokens in the `TokenStorage`. A timer renews the
access token at three quarters of its remaining lifetime (at most 60 s before `exp`); a page reload
picks the session up again; `auth.refresh()` renews on demand. The refresh token sits in `localStorage`
(`oxfe.refresh`) next to the access token: script-readable storage is the same exposure as the JWT, and
the token is useless without the HttpOnly `fingerprint` cookie the shop sets at login — so the shop must
be reached same-origin (the `/graphql/` proxy), or the cookie never comes back and `refresh` answers
"Fingerprint missing". A refused refresh drops the session and emits `SessionExpired`; a network failure
keeps it and retries. A shop without `login` is detected by the first failed `login` (a wrong password is
not that) and `token` is used from then on; `{ refreshFlow: false }` skips the detection.

`auth.logout()` ends the local session at once and revokes the token with `tokenDelete`; a shop that
cannot be reached never keeps the shopper logged in.

## Guest checkout

```ts
await checkoutApi.start(basketId, {
  returnUrl,
  cancelUrl,
  guest: {
    email,
    invoiceAddress: { firstName, lastName, street, zipCode, city, countryId },
    deliveryAddress,
  },
});
auth.isAnonymous(); // a guest token (claim `useranonymous`) is valid
```

The argument type is `GuestCheckoutInput` (payment-base); without `guest` the mutation is unchanged.

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
