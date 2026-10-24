import { describe, expect, it, vi } from 'vitest';
import { buildMultipartBody } from '../../src/api/multipart';

const QUERY = 'mutation up($file: Upload!) { upload(file: $file) }';

function file(name: string, content = 'x'): File {
  return new File([content], name, { type: 'text/plain' });
}

function parts(body: FormData) {
  return {
    operations: JSON.parse(body.get('operations') as string),
    map: JSON.parse(body.get('map') as string),
  };
}

describe('buildMultipartBody (GraphQL multipart request spec)', () => {
  it('returns null when the variables hold no file', () => {
    expect(buildMultipartBody(QUERY, { id: 1, nested: { a: [1, 2] } })).toBeNull();
    expect(buildMultipartBody(QUERY, undefined)).toBeNull();
  });

  it('builds operations, map and the file part for one Upload variable', () => {
    const upload = file('a.txt');

    const body = buildMultipartBody(QUERY, { file: upload, note: 'hi' });

    expect(body).toBeInstanceOf(FormData);
    const { operations, map } = parts(body as FormData);
    expect(operations).toEqual({ query: QUERY, variables: { file: null, note: 'hi' } });
    expect(map).toEqual({ '0': ['variables.file'] });
    expect((body as FormData).get('0')).toBeInstanceOf(Blob);
    expect(((body as FormData).get('0') as File).name).toBe('a.txt');
  });

  it('orders the entries: operations, map, then the files', () => {
    const appended = vi.spyOn(FormData.prototype, 'append');

    buildMultipartBody(QUERY, { file: file('a') });

    expect(appended.mock.calls.map(([name]) => name)).toEqual(['operations', 'map', '0']);
    appended.mockRestore();
  });

  it('addresses files in arrays and nested objects by path', () => {
    const body = buildMultipartBody(QUERY, {
      files: [file('a'), file('b')],
      input: { attachment: file('c'), label: 'l' },
    }) as FormData;

    const { operations, map } = parts(body);
    expect(map).toEqual({
      '0': ['variables.files.0'],
      '1': ['variables.files.1'],
      '2': ['variables.input.attachment'],
    });
    expect(operations.variables).toEqual({
      files: [null, null],
      input: { attachment: null, label: 'l' },
    });
    expect((body.get('2') as File).name).toBe('c');
  });

  it('sends a file used twice once, with both paths', () => {
    const shared = file('shared');

    const body = buildMultipartBody(QUERY, { a: shared, b: [shared] }) as FormData;

    expect(parts(body).map).toEqual({ '0': ['variables.a', 'variables.b.0'] });
    expect(body.getAll('0')).toHaveLength(1);
  });

  it('accepts a plain Blob as an Upload', () => {
    const body = buildMultipartBody(QUERY, { file: new Blob(['x']) }) as FormData;

    expect(parts(body).map).toEqual({ '0': ['variables.file'] });
  });

  it('does not modify the caller variables', () => {
    const variables = { file: file('a') };

    buildMultipartBody(QUERY, variables);

    expect(variables.file).toBeInstanceOf(File);
  });
});
