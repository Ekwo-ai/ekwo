/**
 * A JSON Schema validator small enough to read in one sitting.
 *
 * `packs/schema/pack.1.json` is a real draft 2020-12 schema — an editor, a
 * contributor and a CI elsewhere can all use it — but this CLI is handed a
 * database password and a service_role key, so it has one runtime dependency
 * and that dependency is the Postgres driver. Ajv would be the eleventh
 * package in the tree of the thing that holds the secrets.
 *
 * So this walks the subset the pack schema actually uses: `$ref` inside the
 * document, `type`, `enum`, `const`, `required`, `properties`,
 * `additionalProperties`, `items`, `minItems`, `minLength`, `maxLength`,
 * `pattern`, `minimum`, `maximum`. Anything else in a schema is ignored
 * rather than guessed at — a keyword this does not know must not silently
 * pass as validation it never did, so the pack schema is tested against this
 * validator, not against a promise.
 */

export interface Issue {
  path: string;
  message: string;
}

type Schema = Record<string, unknown>;

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const;
type TypeName = (typeof TYPES)[number];

/** Every way `value` fails `schema`, deepest path first. Empty means valid. */
export function validate(value: unknown, schema: Schema, root: Schema = schema, path = ''): Issue[] {
  const resolved = schema['$ref'] !== undefined ? deref(String(schema['$ref']), root) : schema;
  const issues: Issue[] = [];
  const at = path === '' ? '(root)' : path;

  const type = resolved['type'];
  if (type !== undefined) {
    const names = (Array.isArray(type) ? type : [type]).map(String) as TypeName[];
    if (!names.some((name) => isType(value, name))) {
      issues.push({ path: at, message: `expected ${names.join(' or ')}, got ${kindOf(value)}` });
      return issues; // every further keyword would repeat this one failure
    }
  }

  const enumeration = resolved['enum'];
  if (Array.isArray(enumeration) && !enumeration.some((option) => same(option, value))) {
    issues.push({ path: at, message: `not one of ${enumeration.map((o) => JSON.stringify(o)).join(', ')}` });
  }

  if ('const' in resolved && !same(resolved['const'], value)) {
    issues.push({ path: at, message: `must be ${JSON.stringify(resolved['const'])}` });
  }

  if (typeof value === 'string') {
    const pattern = resolved['pattern'];
    if (typeof pattern === 'string' && !new RegExp(pattern, 'u').test(value)) {
      issues.push({ path: at, message: `does not match ${pattern}` });
    }
    const min = resolved['minLength'];
    if (typeof min === 'number' && value.length < min) {
      issues.push({ path: at, message: `shorter than ${min} character(s)` });
    }
    const max = resolved['maxLength'];
    if (typeof max === 'number' && value.length > max) {
      issues.push({ path: at, message: `longer than ${max} character(s)` });
    }
  }

  if (typeof value === 'number') {
    const min = resolved['minimum'];
    if (typeof min === 'number' && value < min) issues.push({ path: at, message: `below ${min}` });
    const max = resolved['maximum'];
    if (typeof max === 'number' && value > max) issues.push({ path: at, message: `above ${max}` });
  }

  if (Array.isArray(value)) {
    const min = resolved['minItems'];
    if (typeof min === 'number' && value.length < min) {
      issues.push({ path: at, message: `needs at least ${min} item(s)` });
    }
    const items = resolved['items'];
    if (isSchema(items)) {
      value.forEach((item, index) => {
        issues.push(...validate(item, items, root, `${path}[${index}]`));
      });
    }
  }

  if (isObject(value)) {
    const required = resolved['required'];
    if (Array.isArray(required)) {
      for (const name of required) {
        if (!(String(name) in value)) {
          issues.push({ path: at, message: `missing "${String(name)}"` });
        }
      }
    }
    const properties = isObject(resolved['properties']) ? resolved['properties'] : {};
    for (const [name, child] of Object.entries(value)) {
      const sub = properties[name];
      if (isSchema(sub)) {
        issues.push(...validate(child, sub, root, path === '' ? name : `${path}.${name}`));
        continue;
      }
      const extra = resolved['additionalProperties'];
      if (extra === false) {
        issues.push({ path: at, message: `unknown field "${name}"` });
      } else if (isSchema(extra)) {
        issues.push(...validate(child, extra, root, path === '' ? name : `${path}.${name}`));
      }
    }
  }

  return issues;
}

function deref(pointer: string, root: Schema): Schema {
  if (!pointer.startsWith('#/')) throw new Error(`pack_schema: only local $ref is supported, got ${pointer}`);
  let node: unknown = root;
  for (const raw of pointer.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) || !(key in node)) throw new Error(`pack_schema: $ref ${pointer} points at nothing`);
    node = node[key];
  }
  if (!isSchema(node)) throw new Error(`pack_schema: $ref ${pointer} is not a schema`);
  return node;
}

function isType(value: unknown, name: TypeName): boolean {
  switch (name) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'null':
      return value === null;
    default:
      return false;
  }
}

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSchema(value: unknown): value is Schema {
  return isObject(value);
}
