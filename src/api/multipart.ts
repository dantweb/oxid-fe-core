/**
 * GraphQL multipart request spec (https://github.com/jaydenseric/graphql-multipart-request-spec):
 * `operations` is the JSON request with every file replaced by null, `map` says which part fills
 * which variable path, and the files follow as parts `0`, `1` …
 *
 * Returns null when the variables hold no `File`/`Blob`: the request stays plain JSON then.
 */
export function buildMultipartBody(
  query: string,
  variables: Record<string, unknown> | undefined,
): FormData | null {
  const files = new Map<Blob, string[]>();
  const stripped = stripFiles(variables, 'variables', files);
  if (files.size === 0) {
    return null;
  }
  const body = new FormData();
  body.append('operations', JSON.stringify({ query, variables: stripped }));
  const map: Record<string, string[]> = {};
  [...files.values()].forEach((paths, index) => {
    map[String(index)] = paths;
  });
  body.append('map', JSON.stringify(map));
  [...files.keys()].forEach((blob, index) => body.append(String(index), blob));
  return body;
}

/** A copy of `value` with each Blob replaced by null; records every Blob's variable paths. */
function stripFiles(value: unknown, path: string, files: Map<Blob, string[]>): unknown {
  if (value instanceof Blob) {
    files.set(value, [...(files.get(value) ?? []), path]);
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => stripFiles(item, `${path}.${index}`, files));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        stripFiles(nested, `${path}.${key}`, files),
      ]),
    );
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}
