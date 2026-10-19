import { GraphqlError } from '../api/GraphqlError';

const REJECTED_TOKEN_CODE = 'invalid_token';
/** graphql-base answers these without an errorCode today; the code check is the durable one. */
const REJECTED_TOKEN_MESSAGES = ['The access token is invalid', 'Unable to parse token'];

/** True when the shop refused the request because of the bearer token it carried. */
export function isRejectedToken(error: unknown): boolean {
  if (!(error instanceof GraphqlError)) {
    return false;
  }
  return (
    error.errorCode === REJECTED_TOKEN_CODE ||
    error.errors.some(
      (entry) =>
        entry.extensions?.errorCode === REJECTED_TOKEN_CODE ||
        REJECTED_TOKEN_MESSAGES.includes(entry.message),
    )
  );
}
