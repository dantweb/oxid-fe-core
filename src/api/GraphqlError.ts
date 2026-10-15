/**
 * One GraphQL error as the shop returns it: graphql-base and payment-base
 * put a stable machine-readable code into `extensions.errorCode`
 * (e.g. basket_not_found, invalid_token, provider_failed).
 */
export interface GraphqlErrorShape {
  message: string;
  extensions?: {
    errorCode?: string;
    category?: string;
    providerCode?: string;
    [key: string]: unknown;
  };
}

export const ERROR_CODE_UNKNOWN = 'unknown_error';
export const ERROR_CODE_HTTP = 'http_error';
export const ERROR_CODE_NETWORK = 'network_error';

export class GraphqlError extends Error {
  readonly errorCode: string;
  readonly category?: string;
  readonly providerCode?: string;
  readonly errors: GraphqlErrorShape[];

  constructor(message: string, errorCode: string, errors: GraphqlErrorShape[] = []) {
    super(message);
    this.name = 'GraphqlError';
    this.errorCode = errorCode;
    this.errors = errors;
    const first = errors[0];
    this.category = first?.extensions?.category;
    this.providerCode = first?.extensions?.providerCode;
  }

  static fromErrors(errors: GraphqlErrorShape[]): GraphqlError {
    const first = errors[0];
    const code = first?.extensions?.errorCode ?? first?.extensions?.category ?? ERROR_CODE_UNKNOWN;
    return new GraphqlError(first?.message ?? 'GraphQL request failed', code, errors);
  }
}
