import { Controller, INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_FILTER } from '@nestjs/core';
import { Public } from '../../common/public.decorator';
import { CLIENT_ID_EXISTS } from './client-id.util';
import { ClientIdConflictFilter } from './filters/client-id-conflict.filter';

/**
 * The unit spec mocks `BaseExceptionFilter.catch`, so it proves the decision
 * logic but not that the filter actually works once Nest wires it up through
 * `APP_FILTER` with a real HTTP adapter. This boots a minimal app to cover
 * exactly that gap — no database, no other modules.
 */

const DUP = Object.assign(new Error('E11000 duplicate key error'), {
  code: 11000,
  keyPattern: { _id: 1 },
});

const OTHER_DUP = Object.assign(new Error('E11000 duplicate key error'), {
  code: 11000,
  keyPattern: { clinicId: 1, queueDate: 1 },
});

@Controller('patients')
class ThrowingController {
  @Post()
  @Public()
  create() {
    throw DUP;
  }
}

@Controller('appointments')
class OtherDupController {
  @Post()
  @Public()
  create() {
    throw OTHER_DUP;
  }
}

describe('ClientIdConflictFilter (wired)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Registers the filter the same way OfflineModule does, but without
    // pulling in that module's Mongoose models — this spec is about the
    // filter reaching a real HTTP adapter, not about the database.
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController, OtherDupController],
      providers: [{ provide: APP_FILTER, useClass: ClientIdConflictFilter }],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('turns a duplicate _id into a 409 with the replay code', async () => {
    const res = await request(app.getHttpServer())
      .post('/patients')
      .send({ _id: '507f1f77bcf86cd799439011', fullName: 'Ada' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe(CLIENT_ID_EXISTS);
    expect(res.body.entity).toBe('patient');
    expect(res.body._id).toBe('507f1f77bcf86cd799439011');
  });

  it('leaves a duplicate _id with no client-supplied id as a 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/patients')
      .send({ fullName: 'Ada' });

    expect(res.status).toBe(500);
  });

  it('leaves a duplicate on another index alone', async () => {
    const res = await request(app.getHttpServer())
      .post('/appointments')
      .send({ _id: '507f1f77bcf86cd799439011' });

    expect(res.status).toBe(500);
  });
});
