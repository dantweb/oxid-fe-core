import type { GraphqlClient } from '../api/GraphqlClient';
import type { IPlugin, ViewLoader } from './types';

/**
 * payment-base headless checkout contract (per provider module):
 *   <provider>CheckoutStart / <provider>CheckoutReturn / <provider>CheckoutCancel
 * — see payment-base docs/graphql-headless-checkout.md.
 */
export interface CheckoutStartResult {
  contractId: string;
  contractToken: string;
  orderNumber: string | null;
  redirectUrl: string | null;
  clientSecret: string | null;
  renderMode: string;
  providerName?: string;
}

export interface CheckoutReturnResult {
  status: string; // committed · pending · failed
  orderId: string | null;
  orderNumber: string | null;
  contractState: string;
}

export interface CheckoutCancelResult {
  cancelled: boolean;
  contractId: string;
  contractState: string;
}

/** Query parameters the PSP appended to the return URL (e.g. Stripe's `session_id`). */
export type ReturnParams = Record<string, string>;

export interface PaymentStartOptions {
  returnUrl: string;
  cancelUrl?: string;
  uiMode?: string;
  /** Provider-specific extras a concrete plugin may support (e.g. Mollie's `method`). */
  providerOptions?: Record<string, unknown>;
}

/**
 * Inline ("iframe mode") payments: a plugin may supply a component that renders the provider's own
 * payment UI inside the checkout page, like the standard checkout's iframe mode. The checkout
 * mounts it once a method is chosen and the terms are confirmed.
 *
 * Props the checkout passes: {@link InlinePaymentProps}. Events the component emits:
 *  - `attempt(InlinePaymentAttempt)` — a payment attempt exists (the checkout remembers it: the
 *    shopper may leave for the provider and come back to the return route)
 *  - `settled()` — the provider finished inside the page; the checkout continues to the return route
 *  - `failed(message)` — show the message, the shopper can retry
 *  - `cancelled()` — the shopper backed out; the attempt was retired
 */
export interface InlinePaymentProps {
  basketId: string;
  /** the frontend return route for this provider (absolute URL) */
  returnUrl: string;
  cancelUrl: string;
}

export interface InlinePaymentAttempt {
  contractId: string;
  contractToken: string;
  orderNumber: string | null;
}

/** A plugin that handles one contract-first OXID payment id. */
export interface PaymentPlugin extends IPlugin {
  paymentId: string;
  start(basketId: string, options: PaymentStartOptions): Promise<CheckoutStartResult>;
  checkoutReturn(
    contractId: string,
    contractToken: string,
    returnParams?: ReturnParams,
  ): Promise<CheckoutReturnResult>;
  cancel(contractId: string, contractToken: string): Promise<CheckoutCancelResult>;
  /**
   * The inline (iframe-mode) component, or null when this instance uses the hosted page
   * (plugin config `mode: redirect`) or the provider has no embeddable UI.
   */
  inlineComponent?(): ViewLoader | null;
}

export function isPaymentPlugin(plugin: IPlugin): plugin is PaymentPlugin {
  const candidate = plugin as Partial<PaymentPlugin>;
  return (
    typeof candidate.paymentId === 'string' &&
    typeof candidate.start === 'function' &&
    typeof candidate.checkoutReturn === 'function' &&
    typeof candidate.cancel === 'function'
  );
}

const RESULT_FIELDS = {
  start: 'contractId contractToken orderNumber redirectUrl clientSecret renderMode providerName',
  return: 'status orderId orderNumber contractState',
  cancel: 'cancelled contractId contractState',
} as const;

export interface ProviderCheckoutApi {
  start(basketId: string, options: PaymentStartOptions): Promise<CheckoutStartResult>;
  checkoutReturn(
    contractId: string,
    contractToken: string,
    returnParams?: ReturnParams,
  ): Promise<CheckoutReturnResult>;
  cancel(contractId: string, contractToken: string): Promise<CheckoutCancelResult>;
}

export interface ProviderCheckoutOptions {
  /**
   * Return-URL query parameter → name of the `<provider>CheckoutReturn` argument
   * (String). Stripe: `{ session_id: 'checkoutSessionId' }` — its resolver needs the
   * session to settle the payment when no webhook committed the order first.
   */
  returnArguments?: Record<string, string>;
}

/**
 * The three mutations differ between providers only by their prefix
 * (`paypalCheckoutStart`, `stripeCheckoutStart`, …) — one factory serves all,
 * so a provider plugin is a few lines of configuration.
 */
export function createProviderCheckoutApi(
  client: GraphqlClient,
  prefix: string,
  options: ProviderCheckoutOptions = {},
): ProviderCheckoutApi {
  const returnArguments = options.returnArguments ?? {};
  const startField = `${prefix}CheckoutStart`;
  const returnField = `${prefix}CheckoutReturn`;
  const cancelField = `${prefix}CheckoutCancel`;

  return {
    async start(basketId, options) {
      const document = `mutation start($basketId: ID!, $confirm: Boolean!, $returnUrl: String!, $cancelUrl: String, $uiMode: String!) {
        ${startField}(basketId: $basketId, confirmTermsAndConditions: $confirm, returnUrl: $returnUrl, cancelUrl: $cancelUrl, uiMode: $uiMode) { ${RESULT_FIELDS.start} }
      }`;
      const data = await client.execute<Record<string, CheckoutStartResult>>(document, {
        basketId,
        confirm: true,
        returnUrl: options.returnUrl,
        cancelUrl: options.cancelUrl ?? null,
        uiMode: options.uiMode ?? 'hosted',
      });
      return data[startField];
    },

    async checkoutReturn(contractId, contractToken, returnParams = {}) {
      const extra = Object.entries(returnArguments).filter(([param]) => returnParams[param]);
      const declarations = extra.map(([, argument]) => `, $${argument}: String`).join('');
      const passes = extra.map(([, argument]) => `, ${argument}: $${argument}`).join('');
      const document = `mutation checkoutReturn($contractId: String!, $contractToken: String!${declarations}) {
        ${returnField}(contractId: $contractId, contractToken: $contractToken${passes}) { ${RESULT_FIELDS.return} }
      }`;
      const variables: Record<string, unknown> = { contractId, contractToken };
      for (const [param, argument] of extra) {
        variables[argument] = returnParams[param];
      }
      const data = await client.execute<Record<string, CheckoutReturnResult>>(document, variables);
      return data[returnField];
    },

    async cancel(contractId, contractToken) {
      const document = `mutation cancel($contractId: String!, $contractToken: String!) {
        ${cancelField}(contractId: $contractId, contractToken: $contractToken) { ${RESULT_FIELDS.cancel} }
      }`;
      const data = await client.execute<Record<string, CheckoutCancelResult>>(document, {
        contractId,
        contractToken,
      });
      return data[cancelField];
    },
  };
}
