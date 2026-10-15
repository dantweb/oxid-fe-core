import {
  ERROR_CODE_HTTP,
  ERROR_CODE_NETWORK,
  GraphqlError,
  type GraphqlErrorShape,
} from './GraphqlError';

export interface GraphqlResponse<TData = unknown> {
  data?: TData;
  errors?: GraphqlErrorShape[];
}

export type TokenProvider = () => string | null;
export type ResponseInterceptor = (response: GraphqlResponse) => void;

export interface GraphqlClientOptions {
  /** Absolute or same-origin URL of the shop's GraphQL endpoint, e.g. `/graphql/`. */
  url: string;
  /** Injectable for tests and non-browser runtimes. */
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * Thin typed transport to the OXID GraphQL endpoint (graphql-base).
 * Knows how to send a document and map errors; knows nothing about
 * routes, stores or any specific query — that is the callers' job.
 */
export class GraphqlClient {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;
  private tokenProvider: TokenProvider = () => null;
  private readonly responseInterceptors: ResponseInterceptor[] = [];

  constructor(options: GraphqlClientOptions) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
  }

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  /** Runs on every response body before errors are thrown (e.g. session-expiry detection). */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  async execute<TData>(query: string, variables?: Record<string, unknown>): Promise<TData> {
    let response: Response;
    try {
      response = await this.fetchFn(this.url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ query, variables }),
      });
    } catch (cause) {
      throw new GraphqlError(`GraphQL endpoint unreachable: ${String(cause)}`, ERROR_CODE_NETWORK);
    }

    const body = (await this.parseBody(response)) as GraphqlResponse<TData>;

    for (const interceptor of this.responseInterceptors) {
      interceptor(body);
    }

    if (body.errors?.length) {
      throw GraphqlError.fromErrors(body.errors);
    }

    if (!response.ok || body.data === undefined || body.data === null) {
      throw new GraphqlError(`HTTP ${response.status} without data`, ERROR_CODE_HTTP);
    }

    return body.data;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };
    const token = this.tokenProvider();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
  }

  private async parseBody(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new GraphqlError(`HTTP ${response.status}: response is not JSON`, ERROR_CODE_HTTP);
    }
  }
}
