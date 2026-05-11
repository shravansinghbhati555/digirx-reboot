import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

type Ctor<T> = new (...args: any[]) => T;

/**
 * Assert the given plain object fails class-validator validation when cast to Cls,
 * with at least one error on `onProperty`. Returns the full error array for further
 * assertions if needed.
 */
// `onProperty` is `keyof T` for top-level fields, plus `string` so callers
// can target nested fields (the implementation already walks `errors.children`
// via findErrorByProperty). The widened type lets DTOs with array-of-object
// fields assert on the inner property name (e.g. `'quantity'` inside `items`).
export async function expectInvalid<T extends object>(
  Cls: Ctor<T>,
  plain: unknown,
  onProperty: keyof T | (string & {}),
): Promise<ValidationError[]> {
  const instance = plainToInstance(Cls, plain);
  const errors = await validate(instance as object);
  const matching = findErrorByProperty(errors, String(onProperty));
  if (!matching) {
    throw new Error(
      `Expected a validation error on property "${String(onProperty)}", got: ${JSON.stringify(
        errors,
        null,
        2,
      )}`,
    );
  }
  return errors;
}

export async function expectValid<T extends object>(
  Cls: Ctor<T>,
  plain: unknown,
): Promise<void> {
  const instance = plainToInstance(Cls, plain);
  const errors = await validate(instance as object);
  if (errors.length > 0) {
    throw new Error(
      `Expected no validation errors, got: ${JSON.stringify(errors, null, 2)}`,
    );
  }
}

function findErrorByProperty(errors: ValidationError[], property: string): ValidationError | undefined {
  for (const e of errors) {
    if (e.property === property) return e;
    if (e.children && e.children.length > 0) {
      const nested = findErrorByProperty(e.children, property);
      if (nested) return nested;
    }
  }
  return undefined;
}
