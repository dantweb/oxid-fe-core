import {
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

// SPKI prefix of an uncompressed P-256 point, to turn the 65 raw bytes into a key Node can use
const SPKI_P256 = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

export interface Envelope {
  v: number;
  channelId: string;
  counter: number;
  iv: string;
  ct: string;
}

interface Channel {
  c2s: Buffer;
  s2c: Buffer;
  lastCounter: number;
  expiresAt: number;
  binding: string;
}

/**
 * The shop side of the sealed channel written against docs/envelope-v2.md in Node crypto, for tests only: an
 * independent second implementation next to the PHP one (the shared vector ties the three together).
 */
export class ShopDouble {
  readonly channels = new Map<string, Channel>();
  ttlSeconds = 1800;
  now = () => Math.floor(Date.now() / 1000);

  open(clientPublicKey: string, app: string, binding = '') {
    const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const peer = createPublicKey({
      key: Buffer.concat([SPKI_P256, Buffer.from(clientPublicKey, 'base64url')]),
      format: 'der',
      type: 'spki',
    });
    const secret = diffieHellman({ privateKey: server.privateKey, publicKey: peer });
    const channelId = randomBytes(16).toString('base64url');
    const salt = randomBytes(32);
    const info = Buffer.from(`oxid-sc|v2|${channelId}|${binding}|${app}`);
    const material = Buffer.from(hkdfSync('sha256', secret, salt, info, 64));
    const expiresAt = this.now() + this.ttlSeconds;
    this.channels.set(channelId, {
      c2s: material.subarray(0, 32),
      s2c: material.subarray(32),
      lastCounter: 0,
      expiresAt,
      binding,
    });
    const jwk = server.publicKey.export({ format: 'jwk' });
    const raw = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x as string, 'base64url'),
      Buffer.from(jwk.y as string, 'base64url'),
    ]);
    return {
      channelId,
      serverPublicKey: raw.toString('base64url'),
      salt: salt.toString('base64url'),
      binding,
      app,
      expiresAt,
    };
  }

  /** @throws Error('sealed_channel_expired' | 'sealed_value_invalid') */
  unseal(envelope: Envelope, path: string): string {
    const channel = this.alive(envelope.channelId);
    const box = Buffer.from(envelope.ct, 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      channel.c2s,
      Buffer.from(envelope.iv, 'base64url'),
    );
    decipher.setAAD(
      Buffer.from(`oxid-sc|v2|req|${envelope.channelId}|${path}|${envelope.counter}`),
    );
    decipher.setAuthTag(box.subarray(box.length - 16));
    let plain: string;
    try {
      plain = Buffer.concat([
        decipher.update(box.subarray(0, box.length - 16)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('sealed_value_invalid');
    }
    this.consume(envelope.channelId, envelope.counter);
    return plain;
  }

  claim(channelId: string, counter: number): void {
    this.alive(channelId);
    this.consume(channelId, counter);
  }

  seal(channelId: string, requestCounter: number, path: string, plaintext: string): Envelope {
    const channel = this.alive(channelId);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', channel.s2c, iv);
    cipher.setAAD(Buffer.from(`oxid-sc|v2|res|${channelId}|${path}|${requestCounter}`));
    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      v: 2,
      channelId,
      counter: requestCounter,
      iv: iv.toString('base64url'),
      ct: ct.toString('base64url'),
    };
  }

  private alive(channelId: string): Channel {
    const channel = this.channels.get(channelId);
    if (!channel || channel.expiresAt <= this.now()) {
      throw new Error('sealed_channel_expired');
    }
    return channel;
  }

  private consume(channelId: string, counter: number): void {
    const channel = this.alive(channelId);
    if (counter < 1 || counter <= channel.lastCounter) {
      throw new Error('sealed_value_invalid');
    }
    channel.lastCounter = counter;
  }
}
