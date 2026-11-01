import type { SealedRequest, SealedValue } from './sealedChannel';

/**
 * The glue between the GraphQL client and the sealed channel (SEAL-1).
 *
 * Arguments: a call names the variables that travel sealed (`sealedArguments`); each is replaced by its
 * `SealedValueInput` under the name the document declares. Answers: a document that selects a `sealed…` twin field
 * (`sealedPii`, `sealedAddress`, `sealedUrl`, `sealedEnrolment`, `sealedRecoveryCodes`) gets a sealed answer; the
 * sealed fields are opened and put back into the shape the rest of the app always saw (the plain names), so no screen
 * knows about the channel.
 */
export interface SealedArgument {
  /** Where the shop opens it: `<operation>.<argument>`, e.g. `adminLogin.password`. */
  path: string;
  /** The variable the document declares as `SealedValueInput`. */
  into: string;
}

/** Variable name → how it is sealed. The order is the order of the operation's arguments on the shop. */
export type SealedArguments = Record<string, SealedArgument>;

export interface SealedRunner {
  run<T>(work: (request: SealedRequest) => Promise<T>): Promise<T>;
}

/** The fields of a sealed value, as a document selects them. */
export const SEALED_ENVELOPE = 'v channelId counter iv ct';

const SEALED_FIELD = /^sealed[A-Z]/;
const SEALED_SELECTION = /\bsealed[A-Z]\w*\s*\{/;

export function needsSealedAnswers(query: string): boolean {
  return SEALED_SELECTION.test(query);
}

export async function sealArguments(
  request: SealedRequest,
  variables: Record<string, unknown>,
  spec: SealedArguments,
): Promise<Record<string, unknown>> {
  const sealed: Record<string, unknown> = { ...variables };
  for (const [name, { path, into }] of Object.entries(spec)) {
    const value = variables[name];
    delete sealed[name];
    if (typeof value === 'string') {
      sealed[into] = await request.seal(path, value);
    }
  }
  return sealed;
}

function isSealedValue(value: unknown): value is SealedValue {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.v === 'number' &&
    typeof candidate.channelId === 'string' &&
    typeof candidate.counter === 'number' &&
    typeof candidate.iv === 'string' &&
    typeof candidate.ct === 'string'
  );
}

/** `sealedRecoveryCodes` → `recoveryCodes`, `sealedUrl` → `url`. */
function plainName(sealedName: string): string {
  const name = sealedName.slice('sealed'.length);
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** Opens every sealed field of an answer in place (depth first, the path is the response keys joined by dots). */
export async function openAnswers(request: SealedRequest, data: unknown, path = ''): Promise<void> {
  if (Array.isArray(data)) {
    for (const [index, item] of data.entries()) {
      await openAnswers(request, item, `${path}.${index}`);
    }
    return;
  }
  if (typeof data !== 'object' || data === null) {
    return;
  }
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const here = path === '' ? key : `${path}.${key}`;
    const value = record[key];
    if (SEALED_FIELD.test(key) && isSealedValue(value)) {
      const opened: unknown = JSON.parse(await request.unseal(value, here));
      delete record[key];
      if (typeof opened === 'object' && opened !== null && !Array.isArray(opened)) {
        Object.assign(record, opened);
      } else {
        record[plainName(key)] = opened;
      }
      continue;
    }
    await openAnswers(request, value, here);
  }
}
