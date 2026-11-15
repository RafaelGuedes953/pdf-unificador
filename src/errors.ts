/** Erro com status HTTP e mensagem pensada para ser mostrada ao usuario. */
export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
    this.status = status;
  }
}
