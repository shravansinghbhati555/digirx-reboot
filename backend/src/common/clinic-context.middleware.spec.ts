import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { ClinicContextMiddleware } from './clinic-context.middleware';
import type { AppRequest } from './types';

describe('ClinicContextMiddleware', () => {
  let jwt: jest.Mocked<JwtService>;
  let middleware: ClinicContextMiddleware;

  beforeEach(() => {
    jwt = { verify: jest.fn() } as unknown as jest.Mocked<JwtService>;
    middleware = new ClinicContextMiddleware(jwt);
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_DEV_AUTH_HEADERS;
  });

  function mockRes() {
    return { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
  }

  function mockReq(headers: Record<string, string>): AppRequest {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
      header: (name: string) => lower[name.toLowerCase()],
      headers: lower,
    } as unknown as AppRequest;
  }

  it('accepts a valid Bearer token', () => {
    const clinicId = new Types.ObjectId().toHexString();
    const userId = new Types.ObjectId().toHexString();
    jwt.verify.mockReturnValue({ clinicId, sub: userId } as any);

    const req = mockReq({ authorization: 'Bearer good-token' });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.clinicId.toHexString()).toBe(clinicId);
    expect(req.context?.actorUserId?.toHexString()).toBe(userId);
  });

  it('rejects missing Bearer in production even with x-clinic-id header', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';

    const req = mockReq({ 'x-clinic-id': new Types.ObjectId().toHexString() });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects dev-header fallback when ALLOW_DEV_AUTH_HEADERS is unset', () => {
    process.env.NODE_ENV = 'development';

    const req = mockReq({ 'x-clinic-id': new Types.ObjectId().toHexString() });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts dev headers when NODE_ENV=development and ALLOW_DEV_AUTH_HEADERS=true', () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_DEV_AUTH_HEADERS = 'true';

    const clinicId = new Types.ObjectId().toHexString();
    const req = mockReq({ 'x-clinic-id': clinicId });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.context?.clinicId.toHexString()).toBe(clinicId);
  });

  it('returns 400 on an invalid Bearer token', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const req = mockReq({ authorization: 'Bearer bad' });
    const res = mockRes();
    const next = jest.fn();

    middleware.use(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
