import { DomainError } from '@/domain/errors'

/** Datos no legibles/inválidos en `Storage` (JSON corrupto o forma desconocida). */
export class CorruptedStorageError extends DomainError {
  constructor(reason: string, key: string, cause?: unknown) {
    super(
      'CorruptedStorageError',
      `Datos corruptos en "${key}": ${reason}`,
      cause !== undefined ? { cause } : undefined,
    )
  }
}
