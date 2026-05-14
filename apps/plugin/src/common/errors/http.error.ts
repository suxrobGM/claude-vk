/**
 * Errors thrown from Elysia handlers (admin API + webhook). Mirrors the
 * ogstack HttpError shape so the standard error response schema in
 * `@/types/response` works without translation.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class BadRequestError extends HttpError {
  constructor(message = "Bad request") {
    super(400, "bad_request", message);
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = "Unauthorized") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class ConflictError extends HttpError {
  constructor(message = "Conflict") {
    super(409, "conflict", message);
  }
}
