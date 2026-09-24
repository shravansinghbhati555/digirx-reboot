import { IsMongoId, IsOptional } from 'class-validator';

/**
 * Base class for create-DTOs that accept a client-minted `_id`.
 *
 * Offline-capable clients mint their own ObjectIds so that a record created
 * without a network can be referenced by records created after it — an
 * encounter needs a `patientId` before either document has reached the
 * server. ObjectIds are safe to generate off-server: 4-byte timestamp,
 * 5-byte per-process random value, 3-byte counter.
 *
 * `_id` stays optional, so online clients omit it and the server mints as
 * before. Every existing caller keeps working unchanged.
 *
 * Note the global ValidationPipe runs with `forbidNonWhitelisted: true`, so a
 * create-DTO that does *not* extend this rejects a body carrying `_id` with a
 * 400. That is deliberate: entities which cannot be created offline should
 * refuse client-supplied ids rather than quietly ignoring them. Extending
 * this class is therefore an explicit opt-in, and the only declaration a
 * feature module makes about offline creation.
 */
export class ClientIdDto {
  @IsOptional()
  @IsMongoId()
  _id?: string;
}
