import {
  ERROR_CODE_HTTP,
  ERROR_CODE_NETWORK,
  GraphqlError,
  type GraphqlErrorShape,
} from './GraphqlError';
import { isRejectedToken } from '../auth/rejectedToken';
import type { ResponseCache } from './ResponseCache';
import { stableStringify } from './stableStringify';

export interface GraphqlResponse<TData = unknown> {
  data?: TData;
  errors?: GraphqlErrorShape[];
}

export type TokenProvider = () => string | null;
/** The storefront's active locale (`de`, `en`, …) — the shop answers in that language. */
export type LanguageProvider = () => string | null;
/**
 * Language and shop as the API documents them: numeric ids in the query string
 * (`/graphql/?shp=2&lang=1`). Nothing set → nothing appended.
 */
export interface EndpointParams {
  lang?: number;
  shp?: number;
}
export type EndpointParamsProvider = () => EndpointParams;
export type ResponseInterceptor = (response: GraphqlResponse) => void;
/** Called when the shop refused the request's bearer token; the owner of the token drops it. */
export type TokenRejectedHandler = () => void;

export interface GraphqlClientOptions {
  /** Absolute or same-origin URL of the shop's GraphQL endpoint, e.g. `/graphql/`. */
  url: string;
  /** Injectable for tests and non-browser runtimes. */
  fetchFn?: typeof fetch;
  headers?: Record<string, string>;
  /** Answers of calls that opt in with `cacheTtlMs`; without it nothing is cached. */
  cache?: ResponseCache;
}

export interface ExecuteOptions {
  /** Serve an identical read from memory for this long. Reads (queries) only. */
  cacheTtlMs?: number;
  /** Send no Authorization header — for the calls that replace a token (login, guest token). */
  omitToken?: boolean;
}

const MUTATION = /^\s*mutation\b/;

/**
 * Thin typed transport to the OXID GraphQL endpoint (graphql-base).
 * Knows how to send a document and map errors; knows nothing about
 * routes, stores or any specific query — that is the callers' job.
 */
export class GraphqlClient {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly cache: ResponseCache | undefined;
  private tokenProvider: TokenProvider = () => null;
  private languageProvider: LanguageProvider = () => null;
  private endpointParamsProvider: EndpointParamsProvider = () => ({});
  private readonly responseInterceptors: ResponseInterceptor[] = [];
  private tokenRejectedHandler: TokenRejectedHandler | null = null;

  constructor(options: GraphqlClientOptions) {
    this.url = options.url;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.headers = options.headers ?? {};
    this.cache = options.cache;
  }

  setTokenProvider(provider: TokenProvider): void {
    this.tokenProvider = provider;
  }

  /**
   * OXID answers in the language of the request's `Accept-Language`. Without this the BROWSER's
   * language decides — a German storefront would show an English visitor English product data.
   */
  setLanguageProvider(provider: LanguageProvider): void {
    this.languageProvider = provider;
  }

  /**
   * Selects language and shop the documented way: `?shp=<id>&lang=<id>` on every request.
   * `Accept-Language` is still sent, so shops that auto-detect the language keep working.
   */
  setEndpointParamsProvider(provider: EndpointParamsProvider): void {
    this.endpointParamsProvider = provider;
  }

  /**
   * The shop checks the bearer token before it reads the query. When it refuses one, the handler
   * drops it and a query is retried once without a token (a mutation is never replayed).
   */
  setTokenRejectedHandler(handler: TokenRejectedHandler): void {
    this.tokenRejectedHandler = handler;
  }

  /** Runs on every response body before errors are thrown (e.g. session-expiry detection). */
  addResponseInterceptor(interceptor: ResponseInterceptor): void {
    this.responseInterceptors.push(interceptor);
  }

  async execute<TData>(
    query: string,
    variables?: Record<string, unknown>,
    options: ExecuteOptions = {},
  ): Promise<TData> {
    const { cacheTtlMs } = options;
    if (MUTATION.test(query)) {
      if (cacheTtlMs !== undefined) {
        throw new Error('A mutation must not be cached');
      }
      const data = await this.sendGuarded<TData>(query, variables, options, false);
      // whatever was read before may be stale now (basket, login, address …)
      this.cache?.clear();
      return data;
    }
    if (cacheTtlMs === undefined || !this.cache) {
      return this.sendGuarded<TData>(query, variables, options, true);
    }
    return this.cache.remember(this.cacheKey(query, variables), cacheTtlMs, () =>
      this.sendGuarded<TData>(query, variables, options, true),
    );
  }

  /** Sends; if the shop refuses the token we sent, lets its owner drop it and (queries only) retries once. */
  private async sendGuarded<TData>(
    query: string,
    variables: Record<string, unknown> | undefined,
    options: ExecuteOptions,
    retryable: boolean,
  ): Promise<TData> {
    const tokenSent = !options.omitToken && this.tokenProvider() !== null;
    try {
      return await this.send<TData>(query, variables, options.omitToken === true);
    } catch (error) {
      if (!tokenSent || !this.tokenRejectedHandler || !isRejectedToken(error)) {
        throw error;
      }
      this.tokenRejectedHandler();
      if (!retryable) {
        throw error;
      }
      return this.send<TData>(query, variables, false);
    }
  }

  /** The final URL, language and token are part of the key: the shop answers per language, shop and user. */
  private cacheKey(query: string, variables?: Record<string, unknown>): string {
    return [
      this.endpointUrl(),
      this.languageProvider() ?? '',
      this.tokenProvider() ?? '',
      query,
      stableStringify(variables ?? {}),
    ].join('\n');
  }

  private async send<TData>(
    query: string,
    variables: Record<string, unknown> | undefined,
    omitToken: boolean,
  ): Promise<TData> {
    let response: Response;
    try {
      response = await this.fetchFn(this.endpointUrl(), {
        method: 'POST',
        headers: this.buildHeaders(omitToken),
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

  private endpointUrl(): string {
    const { shp, lang } = this.endpointParamsProvider();
    const pairs = [
      ...(shp === undefined ? [] : [`shp=${shp}`]),
      ...(lang === undefined ? [] : [`lang=${lang}`]),
    ];
    if (pairs.length === 0) {
      return this.url;
    }
    return `${this.url}${this.url.includes('?') ? '&' : '?'}${pairs.join('&')}`;
  }

  private buildHeaders(omitToken: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.headers,
    };
    const language = this.languageProvider();
    if (language) {
      headers['Accept-Language'] = language;
    }
    const token = omitToken ? null : this.tokenProvider();
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
