import type { GraphqlClient } from '../api/GraphqlClient';
import type { IPlugin } from './types';

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

export interface PaymentStartOptions {
  returnUrl: string;
  cancelUrl?: string;
  uiMode?: string;
  /** Provider-specific extras a concrete plugin may support (e.g. Mollie's `method`). */
  providerOptions?: Record<string, unknown>;
}

/** A plugin that handles one contract-first OXID payment id. */
export interface PaymentPlugin extends IPlugin {
  paymentId: string;
  start(basketId: string, options: PaymentStartOptions): Promise<CheckoutStartResult>;
  checkoutReturn(contractId: string, contractToken: string): Promise<CheckoutReturnResult>;
  cancel(contractId: string, contractToken: string): Promise<CheckoutCancelResult>;
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
  checkoutReturn(contractId: string, contractToken: string): Promise<CheckoutReturnResult>;
  cancel(contractId: string, contractToken: string): Promise<CheckoutCancelResult>;
}

/**
 * The three mutations differ between providers only by their prefix
 * (`paypalCheckoutStart`, `stripeCheckoutStart`, …) — one factory serves all,
 * so a provider plugin is a few lines of configuration.
 */
export function createProviderCheckoutApi(
  client: GraphqlClient,
  prefix: string,
): ProviderCheckoutApi {
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

    async checkoutReturn(contractId, contractToken) {
      const document = `mutation checkoutReturn($contractId: String!, $contractToken: String!) {
        ${returnField}(contractId: $contractId, contractToken: $contractToken) { ${RESULT_FIELDS.return} }
      }`;
      const data = await client.execute<Record<string, CheckoutReturnResult>>(document, {
        contractId,
        contractToken,
      });
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
