/** Safe error types shared by the transport and learner-facing recovery UI. */
export class ApiError extends Error {
  readonly status: number;
  readonly detail?: unknown;

  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

/** A shipped build without its public API URL must never masquerade as offline. */
export class ApiConfigurationError extends Error {
  constructor() {
    super('App setup is incomplete. Please install the latest app update.');
    this.name = 'ApiConfigurationError';
  }
}
