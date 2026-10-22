const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value) => typeof value === 'string' && UUID.test(value);

// Maps a ZodError into { fieldName: message } for form rendering.
export function fieldErrors(zodError) {
  const errors = {};
  for (const issue of zodError.issues) {
    const key = issue.path[0] ?? '_form';
    errors[key] ??= issue.message;
  }
  return errors;
}

export const optionalText = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
