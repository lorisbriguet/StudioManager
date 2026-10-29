import type { UIKey } from "../i18n/ui";

/**
 * A failure with a reason the user should read ("This category is used by
 * expenses"), not a generic "Couldn't delete". Thrown from db/queries and
 * mutation hooks; `notify.error` (and so the mutation cache backstop) shows
 * `t[labelKey]` in place of its generic label, and still logs the error.
 *
 *   throw new AppError("toast_category_in_use");
 */
export class AppError extends Error {
  readonly labelKey: UIKey;
  constructor(labelKey: UIKey, message?: string) {
    super(message ?? labelKey);
    this.name = "AppError";
    this.labelKey = labelKey;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
