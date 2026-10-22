# Changelog

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
