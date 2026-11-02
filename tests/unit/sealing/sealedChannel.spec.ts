import { describe, expect, it, vi } from 'vitest';
import type { GraphqlClient } from '../../../src/api/GraphqlClient';
import { GraphqlError } from '../../../src/api/GraphqlError';
import {
  SEALED_CHANNEL_HEADER,
  SealedChannel,
  SealedChannelError,
  type SealedValue,
} from '../../../src/sealing/sealedChannel';
import vector from '../../fixtures/sealed-channel-vector.json';
import { ShopDouble, type Envelope } from '../../helpers/sealedChannelShop';

const subtle = globalThis.crypto.subtle;

type FakeClient = Pick<GraphqlClient, 'execute'> & { execute: ReturnType<typeof vi.fn> };

/** A GraphQL client whose "shop" is the Node double: it answers the handshake, nothing else. */
function clientWith(
  shop: ShopDouble,
  onOther?: (variables: Record<string, unknown>) => unknown,
): FakeClient {
  return {
    execute: vi.fn(async (query: string, variables: Record<string, unknown> = {}) => {
      if (query.includes('sealedChannelOpen')) {
        return {
          sealedChannelOpen: shop.open(String(variables.clientPublicKey), String(variables.app)),
        };
      }
      return onOther ? onOther(variables) : {};
    }),
  } as unknown as FakeClient;
}

const expired = () =>
  new GraphqlError('expired', 'sealed_channel_expired', [
    { message: 'expired', extensions: { errorCode: 'sealed_channel_expired' } },
  ]);

describe('SealedChannel against the shop double', () => {
  it('opens one channel, seals a value the shop can open, and counts up', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });

    const envelopes = await channel.run(async (request) => [
      await request.seal('adminLogin.password', 'pw one'),
      await request.seal('adminLogin.password', 'pw two'),
    ]);

    expect(shop.unseal(envelopes[0] as Envelope, 'adminLogin.password')).toBe('pw one');
    expect(shop.unseal(envelopes[1] as Envelope, 'adminLogin.password')).toBe('pw two');
    expect(envelopes.map((e) => e.counter)).toEqual([1, 2]);
    expect(envelopes[0].v).toBe(2);
  });

  it('sends the handshake once for many requests and never sends a value in the plain', async () => {
    const shop = new ShopDouble();
    const client = clientWith(shop);
    const channel = new SealedChannel(client, { app: 'admin' });

    await channel.run((request) => request.seal('a.b', 'secret-plaintext-value'));
    await channel.run((request) => request.seal('a.b', 'secret-plaintext-value'));

    const handshakes = client.execute.mock.calls.filter(([query]) =>
      String(query).includes('sealedChannelOpen'),
    );
    expect(handshakes).toHaveLength(1);
    expect(JSON.stringify(client.execute.mock.calls)).not.toContain('secret-plaintext-value');
    // a raw uncompressed P-256 point, base64url: 65 bytes -> 87 characters
    expect(String(handshakes[0][1].clientPublicKey)).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(handshakes[0][1].app).toBe('admin');
  });

  it('opens the handshake without a bearer token by default (admin tokens rotate)', async () => {
    const shop = new ShopDouble();
    const client = clientWith(shop);

    await new SealedChannel(client, { app: 'admin' }).run((request) => request.seal('a.b', 'x'));

    expect(client.execute.mock.calls[0][2]).toMatchObject({ omitToken: true });
  });

  it('asks for a sealed answer with the header and opens it', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });

    const plain = await channel.run(async (request) => {
      const headers = request.answerHeaders();
      const [channelId, counter] = headers[SEALED_CHANNEL_HEADER].split('.');
      shop.claim(channelId, Number(counter));
      const answer = shop.seal(
        channelId,
        Number(counter),
        'adminCustomer.sealedEmail',
        'jane@example.org',
      );
      return request.unseal(answer as SealedValue, 'adminCustomer.sealedEmail');
    });

    expect(plain).toBe('jane@example.org');
  });

  it('counts the answer header after the sealed arguments, in one sequence', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });

    const counters = await channel.run(async (request) => {
      const first = await request.seal('a.b', 'x');
      const header = request.answerHeaders()[SEALED_CHANNEL_HEADER];
      return [first.counter, Number(header.split('.')[1])];
    });

    expect(counters).toEqual([1, 2]);
  });

  it('refuses an answer of another request, another place or tampered bytes', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });
    await channel.run(async (request) => {
      const [channelId, counter] = request.answerHeaders()[SEALED_CHANNEL_HEADER].split('.');
      const good = shop.seal(channelId, Number(counter), 'x.y', 'secret');
      await expect(
        request.unseal({ ...good, counter: Number(counter) + 1 }, 'x.y'),
      ).rejects.toBeInstanceOf(SealedChannelError);
      await expect(request.unseal(good, 'x.other')).rejects.toBeInstanceOf(SealedChannelError);
      const flipped = Buffer.from(good.ct, 'base64url');
      flipped[0] ^= 1;
      await expect(
        request.unseal({ ...good, ct: flipped.toString('base64url') }, 'x.y'),
      ).rejects.toBeInstanceOf(SealedChannelError);
      expect(await request.unseal(good, 'x.y')).toBe('secret');
    });
  });

  it('refuses a request-direction envelope offered as an answer', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });
    await channel.run(async (request) => {
      const sealed = await request.seal('a.b', 'secret');
      await expect(request.unseal(sealed, 'a.b')).rejects.toBeInstanceOf(SealedChannelError);
    });
  });

  it('re-opens once when the shop says the channel expired, and runs the work again', async () => {
    const shop = new ShopDouble();
    const client = clientWith(shop);
    const channel = new SealedChannel(client, { app: 'admin' });
    let attempts = 0;

    const opened = await channel.run(async (request) => {
      attempts += 1;
      const envelope = await request.seal('a.b', 'value');
      if (attempts === 1) {
        shop.channels.clear();
        throw expired();
      }
      return envelope;
    });

    expect(attempts).toBe(2);
    expect(opened.counter).toBe(1);
    expect(
      client.execute.mock.calls.filter(([q]) => String(q).includes('sealedChannelOpen')),
    ).toHaveLength(2);
  });

  it("re-opens only once: a second expiry is the caller's error", async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });
    let attempts = 0;

    await expect(
      channel.run(async () => {
        attempts += 1;
        throw expired();
      }),
    ).rejects.toMatchObject({ errorCode: 'sealed_channel_expired' });

    expect(attempts).toBe(2);
  });

  it('does not retry other errors', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });
    let attempts = 0;

    await expect(
      channel.run(async () => {
        attempts += 1;
        throw new GraphqlError('nope', 'invalid_login');
      }),
    ).rejects.toMatchObject({ errorCode: 'invalid_login' });

    expect(attempts).toBe(1);
  });

  it('opens a new channel when the clock says the old one is over', async () => {
    const shop = new ShopDouble();
    shop.ttlSeconds = 100;
    const client = clientWith(shop);
    let nowMs = Date.now();
    const channel = new SealedChannel(client, { app: 'admin', now: () => nowMs });

    await channel.run((request) => request.seal('a.b', 'x'));
    nowMs += 200_000;
    await channel.run((request) => request.seal('a.b', 'x'));

    expect(
      client.execute.mock.calls.filter(([q]) => String(q).includes('sealedChannelOpen')),
    ).toHaveLength(2);
  });

  it('serialises sealed requests: the second waits for the first', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });
    const order: string[] = [];

    await Promise.all([
      channel.run(async (request) => {
        await request.seal('a.b', 'x');
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('first done');
      }),
      channel.run(async (request) => {
        order.push('second starts');
        await request.seal('a.b', 'y');
      }),
    ]);

    expect(order).toEqual(['first done', 'second starts']);
  });

  it('a failed request does not block the next one', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(clientWith(shop), { app: 'admin' });

    await expect(channel.run(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );

    await expect(channel.run((request) => request.seal('a.b', 'x'))).resolves.toBeDefined();
  });

  it('fails clearly without WebCrypto and when the handshake fails', async () => {
    const shop = new ShopDouble();
    await expect(
      new SealedChannel(clientWith(shop), { app: 'admin', subtle: null }).run(async () => 1),
    ).rejects.toBeInstanceOf(SealedChannelError);

    const broken = {
      execute: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as FakeClient;
    await expect(
      new SealedChannel(broken, { app: 'admin' }).run(async () => 1),
    ).rejects.toBeInstanceOf(SealedChannelError);
  });

  it('rejects a handshake with a malformed server key', async () => {
    const client = {
      execute: vi.fn().mockResolvedValue({
        sealedChannelOpen: {
          channelId: 'c',
          serverPublicKey: 'AAAA',
          salt: 'AAAA',
          binding: '',
          app: 'admin',
          expiresAt: 4_000_000_000,
        },
      }),
    } as unknown as FakeClient;

    await expect(
      new SealedChannel(client, { app: 'admin' }).run(async () => 1),
    ).rejects.toBeInstanceOf(SealedChannelError);
  });

  it('keeps the private key non-extractable', async () => {
    const shop = new ShopDouble();
    let captured: CryptoKey | undefined;
    const channel = new SealedChannel(clientWith(shop), {
      app: 'admin',
      keyPair: async () => {
        const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
          'deriveBits',
        ]);
        captured = pair.privateKey;
        const raw = await subtle.exportKey('raw', pair.publicKey);
        return {
          privateKey: pair.privateKey,
          publicKeyRaw: Buffer.from(raw).toString('base64url'),
        };
      },
    });

    await channel.run((request) => request.seal('a.b', 'x'));

    expect(captured?.extractable).toBe(false);
    await expect(subtle.exportKey('jwk', captured as CryptoKey)).rejects.toBeDefined();
  });
});

describe('known-answer vector shared with PHP', () => {
  const base64urlToBytes = (text: string) => new Uint8Array(Buffer.from(text, 'base64url'));

  async function channelFromVector() {
    const privateKey = await subtle.importKey(
      'jwk',
      vector.client.jwk,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const client = {
      execute: vi.fn().mockResolvedValue({
        sealedChannelOpen: { ...vector.handshake, expiresAt: 4_000_000_000 },
      }),
    } as unknown as FakeClient;
    // the IV the vector was made with
    const ivs = [base64urlToBytes(vector.request.envelope.iv)];
    return new SealedChannel(client, {
      app: vector.handshake.app,
      bindToToken: true,
      keyPair: async () => ({ privateKey, publicKeyRaw: vector.client.publicKeyRaw }),
      randomIv: () => ivs.shift() as Uint8Array,
    });
  }

  it('seals the request exactly like PHP did (same keys, same bytes)', async () => {
    const channel = await channelFromVector();

    const envelope = await channel.run((request) =>
      request.sealAt(
        vector.request.path,
        vector.request.plaintext,
        vector.request.envelope.counter,
      ),
    );

    expect(envelope).toEqual(vector.request.envelope);
  });

  it('opens the answer PHP sealed', async () => {
    const channel = await channelFromVector();

    const plain = await channel.run((request) =>
      request.unsealAt(
        vector.response.envelope,
        vector.response.path,
        vector.response.requestCounter,
      ),
    );

    expect(plain).toBe(vector.response.plaintext);
  });
});
