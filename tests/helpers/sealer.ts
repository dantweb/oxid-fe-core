import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

const ALG = 'ECDH-P256+HKDF-SHA256+A256GCM';
// SPKI prefix of an uncompressed P-256 point, to turn the 65 raw bytes into a key Node can use
const SPKI_P256 = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');

export interface SealInput {
  clientPublicKey: string;
  provider: string;
  tokenId: string;
  values: Record<string, string | boolean>;
  issuedAt: number;
}

/** What the shop's PHP sealer does (docs/payments-keys.md), for tests only. */
export function sealLikeTheShop(input: SealInput) {
  const server = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const peer = createPublicKey({
    key: Buffer.concat([SPKI_P256, Buffer.from(input.clientPublicKey, 'base64url')]),
    format: 'der',
    type: 'spki',
  });
  const secret = diffieHellman({ privateKey: server.privateKey, publicKey: peer });
  const aad = ['oxid-pcc', 'v1', input.provider, input.issuedAt, input.tokenId].join('|');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const key = Buffer.from(hkdfSync('sha256', secret, salt, Buffer.from(aad), 32));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.values), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const jwk = server.publicKey.export({ format: 'jwk' });
  const serverPublicKey = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, 'base64url'),
    Buffer.from(jwk.y!, 'base64url'),
  ]);
  return {
    v: 1,
    alg: ALG,
    serverPublicKey: serverPublicKey.toString('base64url'),
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    issuedAt: input.issuedAt,
    ciphertext: ciphertext.toString('base64url'),
  };
}
