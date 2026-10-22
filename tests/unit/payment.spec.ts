import { describe, expect, it, vi } from 'vitest';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import type { IPlugin } from '../../src/plugins/types';
import {
  createProviderCheckoutApi,
  isPaymentPlugin,
  type GuestDetails,
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

  it('forwards mapped return-URL params as extra return arguments', async () => {
    const client = clientAnswering({ stripeCheckoutReturn: { status: 'committed' } });
    const api = createProviderCheckoutApi(client, 'stripe', {
      returnArguments: { session_id: 'checkoutSessionId' },
    });

    await api.checkoutReturn('c1', 't1', { session_id: 'cs_test_1', contract_id: 'ignored' });

    const [document, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).toContain('$checkoutSessionId: String');
    expect(document).toContain('checkoutSessionId: $checkoutSessionId');
    expect(variables).toEqual({
      contractId: 'c1',
      contractToken: 't1',
      checkoutSessionId: 'cs_test_1',
    });
  });

  it('omits mapped arguments the return URL did not carry', async () => {
    const client = clientAnswering({ stripeCheckoutReturn: { status: 'pending' } });
    const api = createProviderCheckoutApi(client, 'stripe', {
      returnArguments: { session_id: 'checkoutSessionId' },
    });

    await api.checkoutReturn('c1', 't1', {});

    const [document, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).not.toContain('checkoutSessionId');
    expect(variables).toEqual({ contractId: 'c1', contractToken: 't1' });
  });

  it('forwards mapped provider options as extra start arguments', async () => {
    const client = clientAnswering({ mollieCheckoutStart: { contractId: 'c1' } });
    const api = createProviderCheckoutApi(client, 'mollie', {
      startArguments: { cardToken: 'cardToken', method: 'method' },
    });

    await api.start('b1', {
      returnUrl: 'https://app/return',
      uiMode: 'embedded',
      providerOptions: { cardToken: 'tkn_1', ignored: 'x' },
    });

    const [document, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).toContain('$cardToken: String');
    expect(document).toContain('cardToken: $cardToken');
    expect(document).not.toContain('$method');
    expect(variables).toMatchObject({ cardToken: 'tkn_1' });
    expect(variables).not.toHaveProperty('ignored');
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

describe('createProviderCheckoutApi — guest checkout (140c C2)', () => {
  const guest: GuestDetails = {
    email: 'guest@example.test',
    invoiceAddress: {
      salutation: 'MR',
      firstName: 'Ada',
      lastName: 'Lovelace',
      street: 'Main Street',
      streetNumber: '1',
      zipCode: '79098',
      city: 'Freiburg',
      countryId: 'a7c40f631fc920687.20179984',
    },
  };

  function startedWith(options: Record<string, unknown>) {
    const client = clientAnswering({ stripeCheckoutStart: { contractId: 'c1' } });
    const api = createProviderCheckoutApi(client, 'stripe');
    return api
      .start('b', { returnUrl: 'r', ...options })
      .then(() => (client.execute as ReturnType<typeof vi.fn>).mock.calls[0]);
  }

  it('start_guestProvided_declaresAndPassesTheGuestArgument', async () => {
    const [document, variables] = await startedWith({ guest });

    expect(document).toContain('$guest: GuestCheckoutInput');
    expect(document).toContain('guest: $guest');
    expect(variables.guest).toEqual(guest);
  });

  it('start_guestWithDeliveryAddress_passesBothAddresses', async () => {
    const deliveryAddress = { ...guest.invoiceAddress, firstName: 'Grace' };

    const [, variables] = await startedWith({ guest: { ...guest, deliveryAddress } });

    expect(variables.guest).toEqual({ ...guest, deliveryAddress });
  });

  it('start_noGuest_documentAndVariablesCarryNoGuestArgument', async () => {
    const [document, variables] = await startedWith({});

    expect(document).not.toContain('guest');
    expect(variables).not.toHaveProperty('guest');
  });

  it('start_guestAndProviderOptions_bothArePassed', async () => {
    const client = clientAnswering({ mollieCheckoutStart: { contractId: 'c1' } });
    const api = createProviderCheckoutApi(client, 'mollie', {
      startArguments: { method: 'method' },
    });

    await api.start('b', { returnUrl: 'r', guest, providerOptions: { method: 'ideal' } });

    const [document, variables] = (client.execute as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(document).toContain('guest: $guest');
    expect(document).toContain('method: $method');
    expect(variables).toMatchObject({ method: 'ideal', guest });
  });
});
