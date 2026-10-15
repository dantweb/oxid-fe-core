import { describe, expect, it, vi } from 'vitest';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import type { IPlugin } from '../../src/plugins/types';
import {
  createProviderCheckoutApi,
  isPaymentPlugin,
  type PaymentPlugin,
} from '../../src/plugins/payment';

function clientAnswering(data: unknown): GraphqlClient {
  return { execute: vi.fn().mockResolvedValue(data) } as unknown as GraphqlClient;
}

describe('isPaymentPlugin', () => {
  it('recognizes a payment plugin and rejects a plain plugin', () => {
    const plain: IPlugin = { name: 'shop', version: '1' };
    const payment: PaymentPlugin = {
      name: 'payment-paypal',
      version: '1',
      paymentId: 'oe_payments_paypal',
      start: vi.fn(),
      checkoutReturn: vi.fn(),
      cancel: vi.fn(),
    };

    expect(isPaymentPlugin(plain)).toBe(false);
    expect(isPaymentPlugin(payment)).toBe(true);
  });
});

describe('createProviderCheckoutApi', () => {
  it('starts with the provider-prefixed mutation and hosted default', async () => {
    const client = clientAnswering({
      paypalCheckoutStart: { contractId: 'c1', contractToken: 't1', renderMode: 'redirect' },
    });
    const api = createProviderCheckoutApi(client, 'paypal');

    const result = await api.start('basket-1', { returnUrl: 'https://app/return' });

    expect(result.contractId).toBe('c1');
    const [document, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).toContain('paypalCheckoutStart(');
    expect(document).toContain('confirmTermsAndConditions: $confirm');
    expect(variables).toMatchObject({
      basketId: 'basket-1',
      confirm: true,
      returnUrl: 'https://app/return',
      cancelUrl: null,
      uiMode: 'hosted',
    });
  });

  it('passes cancelUrl and uiMode through', async () => {
    const client = clientAnswering({ stripeCheckoutStart: { contractId: 'c' } });
    const api = createProviderCheckoutApi(client, 'stripe');

    await api.start('b', { returnUrl: 'r', cancelUrl: 'c', uiMode: 'embedded' });

    const [, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(variables).toMatchObject({ cancelUrl: 'c', uiMode: 'embedded' });
  });

  it('reads return and cancel results from the prefixed fields', async () => {
    const client = clientAnswering({
      mollieCheckoutReturn: { status: 'committed', orderId: 'o1', contractState: 'fulfilled' },
    });
    const api = createProviderCheckoutApi(client, 'mollie');

    const result = await api.checkoutReturn('c1', 't1');
    expect(result.status).toBe('committed');

    const cancelClient = clientAnswering({
      mollieCheckoutCancel: { cancelled: true, contractId: 'c1', contractState: 'cancelled' },
    });
    const cancelApi = createProviderCheckoutApi(cancelClient, 'mollie');
    expect((await cancelApi.cancel('c1', 't1')).cancelled).toBe(true);
  });
});
