export class ApiHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiHttpError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new ApiHttpError(400, 'bad_request', message, details);
