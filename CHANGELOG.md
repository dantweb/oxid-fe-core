# Changelog

## Unreleased

### Added

- `step_up_password_required` in the admin error codes (`errorCodeOf`): the admin GraphQL module answers it
  instead of `step_up_required` when it runs with the second factor disabled (`oeGqlAdminMfaDisabled`), and the
  client steps up with the password.

## 0.11.0

Sprint C01 — the generic seams a back-office (admin) app needs. Every seam is opt-in: with no new
option the behaviour is exactly that of 0.10.0 (token keys `oxfe.token` / `oxfe.refresh`, localStorage,
anonymous fallback, store id `oxfe-auth`). Nothing admin-specific lives in core.

### Added

- **C01-1 — token storage.** `new TokenStorage(storage, { namespace })` (keys `<namespace>.token` /
  `<namespace>.refresh`, default `oxfe`) and the exported `MemoryStorage` (a `Storage` that never
  leaves the page).
- **C01-2 — auth mode.** `AuthServiceOptions.anonymousFallback: false` — `ensureSession()` never
  mints an anonymous token. `AuthServiceOptions.refreshStrategy` (`RefreshStrategy`: `hasCredentials()`,
  `canRenew()`, `renew()`); the default `FingerprintRefreshStrategy` is the 0.10.0 refresh.
  `adoptToken()` now (re)plans the silent renewal when the strategy can renew the adopted token.
- **C01-3 — rights.** `createRightsGuard(hasRight, forbiddenPath)` reads `meta.requiredRight`;
  `NavItem.requiredRight` / `children` / `section`; `PluginRegistry.navTree(hasRight)` returns the
  sorted tree cut down to the allowed items (a group without remaining children is dropped).
- **C01-4 — override slots.** `OverrideSlot` is now `string`; `STOREFRONT_SLOTS` and `StorefrontSlot`
  name the storefront ones; `IPlugin<TSlot>` and `PluginRegistry<TSlot>` take the slot union of a host
  (default `string`).
- **C01-5 — error codes.** `AdminErrorCode` in `KnownErrorCode`: `admin_session_required`,
  `admin_session_revoked`, `mfa_required`, `mfa_invalid`, `step_up_required`, `permission_denied`,
  `not_found`, `validation_failed`, `conflict`, `not_deletable`, `rate_limited`.
- **C01-6 — idle timer.** `createIdleTimer({ timeoutMs, warnMs, events, target, throttleMs, now,
setTimer, clearTimer, channel, onWarn, onResume, onTimeout })` with `start` / `stop` / `reset` /
  `remainingMs`; cross-tab sync through an injected `BroadcastChannel`.
- **C01-7 — transport.** `execute(…, { signal, timeoutMs, headers })`; a `File`/`Blob` anywhere in the
  variables sends the request as GraphQL multipart (`operations` / `map` / files).
- **C01-8 — isolation.** `createAuthStore(auth, events, { id })`; coverage threshold (lines ≥ 90) is
  enforced by `vite.config.ts`.
- **A01b — theme tooling.** Node-side export `@dantweb/oxid-fe-core/theme-tools` (and the
  `oxfe-build-themes` bin): `buildThemes({ srcDir, outDir, only?, tokenPrefixes? })` compiles
  `<srcDir>/<id>/{config.json, styles/styles.less, images/, fonts/}` into `<outDir>/<id>/` (LESS, parent
  chains, one error listing every problem), `validateThemeConfig`, `validateParentChains`,
  `stageThemeSources`, `DEFAULT_TOKEN_PREFIXES`. `tokenPrefixes` (default `['--oxfe-']`) names the custom
  property prefixes a theme may set; an admin app passes `['--oxfe-', '--oxadm-']`. `less` is a dependency
  of this export only; the browser bundle never imports it. The code is the one of oxid-fe-user's
  `scripts/theme-*.mjs` (which keeps its copy until it switches).
- **A01b — `loadTheme({ tokenPrefixes })`.** Opt-in: tokens whose name starts with none of the prefixes
  are dropped before they are applied (for a host that serves themes it did not build). Without it the
  behaviour is unchanged.

### Security (SEC-1)

- **BREAKING: zod 4.** `zod` is now `^4.6.7` (was `^3.24.0`), patching GHSA-mrhx-c7xc-m3w5 (memory exhaustion
  validating oversized constrained collections). Hosts that share zod with core (peer-deduped in vite) must
  be on zod 4 too: `z.record(valueSchema)` becomes `z.record(keySchema, valueSchema)`, object defaults use
  `.prefault({})`, and `z.ZodType<T, z.ZodTypeDef, unknown>` becomes `z.ZodType<T, unknown>`.
- **`configureZodForCsp()`** (new export, also the subpath `@dantweb/oxid-fe-core/zod-csp`, which creates no schema): sets `z.config({ jitless: true })`. Zod 4 compiles object parsers
  with `new Function`, which a CSP without 'unsafe-eval' or with Trusted Types refuses and reports. Core
  never changes zod's global config itself; a host under such a CSP calls it as the first import of its entry
  point (zod decides when a schema is created). A test proves core's schemas make no `new Function` call once
  it ran.
- happy-dom (dev dependency) `^21.0.4`, patching GHSA-834v-8h66-3h79.

### Changed

- `PluginRegistry.overrideFor` / `IPlugin.overrides` are typed by the registry's slot parameter
  (default `string`, so a host that names `OverrideSlot` compiles unchanged).
- `SessionRefresher` takes a `RefreshStrategy` instead of the client (internal; not exported).
- An abort of the caller's `signal` is rethrown as the runtime's `AbortError`; a `timeoutMs` expiry is a
  `network_error` GraphqlError (a transport failure: the session is kept).

## 0.10.0

Sprints 139b, 138f, 138e, 140c (core parts). All additions are backward compatible for a host that
does not use them, with one exception noted under 138e.

### Added

- **139b B1 — `?lang=` / `?shp=`.** `GraphqlClient.setEndpointParamsProvider(() => ({ lang?, shp? }))`
  appends the documented numeric ids to the endpoint of every request (`/graphql/?shp=2&lang=1`; `&`
  when the endpoint already has a query; nothing when the provider returns nothing). `Accept-Language`
  is still sent. The final URL is part of the `ResponseCache` key.
- **138f F1 — errors by code.** `errorCodeOf(error)` / `providerCodeOf(error)` and the `KnownErrorCode`
  union (`basket_not_found`, `payment_not_supported`, `terms_not_confirmed`, `return_url_rejected`,
  `provider_failed`, `contract_not_found`, `invalid_token`, `invalid_login`, `account_exists`,
  `guest_details_required`, `network_error`, `http_error`). An unknown code or a non-`GraphqlError`
  gives `undefined`.
- **138e E2 — refresh tokens.** `AuthService.login` uses graphql-base `login` and stores the access and
  the refresh token (`TokenStorage.getRefreshToken` / `setRefreshToken` / `clearRefreshToken`, key
  `oxfe.refresh`); a scheduler (`SessionRefresher`) renews the access token before `exp`;
  `AuthService.refresh()`; `ensureSession()` and `checkExpiry()` renew an expired session instead of
  dropping it. A refused refresh drops the session (`SessionExpired`); a network failure keeps it and
  retries. A shop that refuses `login` is detected on the first login and `token` is used instead;
  `new AuthService(client, storage, events, { refreshFlow: false })` skips the detection.
- **140c C2 — guest checkout.** `PaymentStartOptions.guest` (`GuestDetails`: `email`, `invoiceAddress`,
  optional `deliveryAddress`; `GuestAddress`) is sent as the `guest` argument of
  `<provider>CheckoutStart`. `AuthService.isAnonymous()` reads the token's `useranonymous` claim (as before).
- `OxidJwtPayload.fingerprintHash`.

### Changed

- **138e E1 — `AuthService.logout()` revokes the token** (`tokenDelete(tokenId)`, id from the `tokenid`
  claim) and now returns `Promise<void>`. The local session ends synchronously, as before; the promise
  settles when the revoke did and never rejects. Hosts that ignore the return value need no change
  (a lint rule against floating promises will ask for `void auth.logout()`).
- `TokenStorage.clear()` also removes the refresh token.
- `AuthService.adoptToken()` and `loginAnonymous()` drop the refresh token of the replaced session.
