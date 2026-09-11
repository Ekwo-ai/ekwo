import { CbsoInputError } from './errors.js';
import { isValidEnterpriseNumber } from './enterprise-number.js';
import type { CbsoInput, PostalAddress } from './types.js';

const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function requireText(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CbsoInputError('must be a non-empty string', path);
  }
}

function requireDate(value: unknown, path: string): void {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new CbsoInputError('must be an ISO date (YYYY-MM-DD)', path);
  }
}

function validateAddress(address: PostalAddress, path: string): void {
  requireText(address.street, `${path}.street`);
  requireText(address.number, `${path}.number`);
  requireText(address.postalCode, `${path}.postalCode`);
  requireText(address.city, `${path}.city`);
  const country = (address.country ?? 'BE').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new CbsoInputError('must be an ISO 3166-1 alpha-2 code', `${path}.country`);
  }
  if (country === 'BE' && !/^\d{4}$/.test(address.postalCode.trim())) {
    throw new CbsoInputError('a Belgian postal code has four digits', `${path}.postalCode`);
  }
}

/** Throws a {@link CbsoInputError} describing the first problem found. */
export function validateInput(input: CbsoInput): void {
  requireText(input.entityNumber, 'entityNumber');
  if (!isValidEnterpriseNumber(input.entityNumber)) {
    throw new CbsoInputError('invalid Belgian enterprise number (check digits)', 'entityNumber');
  }
  requireText(input.denomination, 'denomination');
  requireText(input.legalForm, 'legalForm');
  requireText(input.court, 'court');
  validateAddress(input.address, 'address');

  for (const key of [
    'periodStart',
    'periodEnd',
    'prevPeriodStart',
    'prevPeriodEnd',
    'gaDate',
    'deedDate',
  ] as const) {
    requireDate(input[key], key);
  }
  if (input.periodStart >= input.periodEnd) {
    throw new CbsoInputError('must be before periodEnd', 'periodStart');
  }
  if (input.prevPeriodEnd >= input.periodStart) {
    throw new CbsoInputError('must be before periodStart', 'prevPeriodEnd');
  }

  for (const [code, v] of Object.entries(input.values ?? {})) {
    for (const col of ['n', 'p'] as const) {
      const x = v?.[col];
      if (x != null && !Number.isFinite(x)) {
        throw new CbsoInputError('must be a finite number or null', `values.${code}.${col}`);
      }
    }
  }

  (input.administrators ?? []).forEach((admin, i) => {
    const path = `administrators[${i}]`;
    if (admin.kind === 'person') {
      requireText(admin.lastName, `${path}.lastName`);
      requireText(admin.firstName, `${path}.firstName`);
    } else if (admin.kind === 'company') {
      requireText(admin.name, `${path}.name`);
      if (admin.representative) {
        requireText(admin.representative.lastName, `${path}.representative.lastName`);
        requireText(admin.representative.firstName, `${path}.representative.firstName`);
      }
      const country = (admin.country ?? 'BE').toUpperCase();
      if (country === 'BE' && admin.enterpriseNumber && !isValidEnterpriseNumber(admin.enterpriseNumber)) {
        throw new CbsoInputError('invalid Belgian enterprise number (check digits)', `${path}.enterpriseNumber`);
      }
    } else {
      throw new CbsoInputError('kind must be "person" or "company"', `${path}.kind`);
    }
    validateAddress(admin, path);
  });
}
