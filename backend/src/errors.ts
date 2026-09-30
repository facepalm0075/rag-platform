// api-error.ts

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly isApiError: boolean = true;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    
    Object.setPrototypeOf(this, ApiError.prototype);
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string = 'Bad Request', code?: string): never {
    throw new ApiError(400, message, code);
  }

  static unauthorized(message: string = 'Unauthorized', code?: string): never {
    throw new ApiError(401, message, code);
  }

  static forbidden(message: string = 'Forbidden', code?: string): never {
    throw new ApiError(403, message, code);
  }

  static notFound(message: string = 'Not Found', code?: string): never {
    throw new ApiError(404, message, code);
  }

  static conflict(message: string = 'Conflict', code?: string): never {
    throw new ApiError(409, message, code);
  }

  static internal(message: string = 'Internal Server Error', code?: string): never {
    throw new ApiError(500, message, code);
  }

  static validation(message: string = 'Validation Error', code?: string): never {
    throw new ApiError(422, message, code);
  }

  static tooManyRequests(message: string = 'Too Many Requests', code?: string): never {
    throw new ApiError(429, message, code);
  }
}

// Type guard
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError || 
         (typeof error === 'object' && 
          error !== null && 
          'isApiError' in error && 
          error.isApiError === true);
}