import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { JwtContextGuard } from './jwt.guard';

const SECRET = 'test_secret';
const CLAIMS = {
  sub: '6ac87b9d82e492318657f21d',
  clinicId: '6ab3c9b1dc0207ebea1fd658',
  branchId: '6ab3c9b1dc0207ebea1fd659',
};
const DEVICE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function ctxFor(headers: Record<string, string>) {
  const req: any = {
    header: (name: string) => headers[name.toLowerCase()],
  };
  return {
    req,
    exec: { switchToHttp: () => ({ getRequest: () => req }) } as any,
  };
}

describe('JwtContextGuard', () => {
  const jwt = new JwtService({});
  const guard = new JwtContextGuard(jwt);
  let token: string;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;
    token = await jwt.signAsync(CLAIMS, { secret: SECRET });
  });

  it('keeps the device id when it rebuilds the context from the token', async () => {
    // Regression: the guard used to drop it, so every token-authenticated
    // lease or unlock-code upload failed with "Send x-device-id".
    const { req, exec } = ctxFor({ authorization: `Bearer ${token}`, 'x-device-id': DEVICE });
    await expect(guard.canActivate(exec)).resolves.toBe(true);
    expect(req.context.deviceId).toBe(DEVICE);
    expect(req.context.clinicId.toHexString()).toBe(CLAIMS.clinicId);
    expect(req.context.actorUserId.toHexString()).toBe(CLAIMS.sub);
  });

  it('drops a malformed device id rather than trusting it', async () => {
    const { req, exec } = ctxFor({ authorization: `Bearer ${token}`, 'x-device-id': 'not a device' });
    await guard.canActivate(exec);
    expect(req.context.deviceId).toBeUndefined();
  });

  it('rejects a bad token', async () => {
    const { exec } = ctxFor({ authorization: 'Bearer nope' });
    await expect(guard.canActivate(exec)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('lets header-only dev requests through untouched', async () => {
    const { req, exec } = ctxFor({});
    await expect(guard.canActivate(exec)).resolves.toBe(true);
    expect(req.context).toBeUndefined();
  });
});
