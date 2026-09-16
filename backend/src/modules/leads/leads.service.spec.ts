import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { LeadsService } from './leads.service';
import { LeadStatus } from './schemas/lead.schema';

/**
 * The contact form is the only unauthenticated write in the API, so the
 * behaviour that matters is: the lead is kept whatever the mailer does, and
 * the visitor is never shown a mail failure.
 */
describe('LeadsService', () => {
  const actorId = new Types.ObjectId();
  const leadId = new Types.ObjectId();

  const build = (opts: { sendFails?: boolean; notifyEmail?: string } = {}) => {
    const updateOne = jest.fn().mockResolvedValue({});
    const create = jest.fn().mockResolvedValue({
      _id: leadId,
      name: 'Dr Jane Miller',
      email: 'jane@practice.example',
      phone: '(415) 555-0142',
      reason: 'demo',
      message: 'Two providers, moving off paper.',
      source: 'website',
      status: LeadStatus.New,
    });

    const leadModel = {
      create,
      updateOne,
      find: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([]),
      findByIdAndUpdate: jest.fn().mockResolvedValue({
        _id: leadId,
        status: LeadStatus.Contacted,
        notes: null,
        handledAt: new Date(),
      }),
    } as never;

    const send = jest.fn().mockImplementation(async () => {
      if (opts.sendFails) throw new Error('SendGrid rejected the message');
      return {};
    });

    if (opts.notifyEmail === undefined) {
      process.env.LEADS_NOTIFY_EMAIL = 'sales@digirx.online';
    } else if (opts.notifyEmail === '') {
      delete process.env.LEADS_NOTIFY_EMAIL;
    } else {
      process.env.LEADS_NOTIFY_EMAIL = opts.notifyEmail;
    }

    const service = new LeadsService(leadModel, { send } as never);
    return { service, create, updateOne, send };
  };

  const input = {
    name: '  Dr Jane Miller ',
    email: 'Jane@Practice.Example',
    message: 'Two providers, moving off paper.',
    reason: 'demo',
  };

  afterEach(() => {
    delete process.env.LEADS_NOTIFY_EMAIL;
    jest.restoreAllMocks();
  });

  it('stores the lead with the email normalised and name trimmed', async () => {
    const { service, create } = build();

    await service.create(input);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Dr Jane Miller',
        email: 'jane@practice.example',
        status: LeadStatus.New,
        source: 'website',
      }),
    );
  });

  it('emails the sales inbox and marks the lead notified', async () => {
    const { service, send, updateOne } = build();

    await service.create(input);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'sales@digirx.online', channel: 'EMAIL' }),
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: leadId },
      { $set: { notified: true } },
    );
  });

  it('still succeeds for the visitor when the mailer fails', async () => {
    const { service, updateOne } = build({ sendFails: true });

    const out = await service.create(input);

    expect(out.id).toBe(leadId.toHexString());
    // Not marked notified, so a broken mailer is visible in the inbox.
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('saves the lead even with no notification address configured', async () => {
    const { service, create, send } = build({ notifyEmail: '' });

    const out = await service.create(input);

    expect(create).toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(out.status).toBe(LeadStatus.New);
  });

  it('rejects an unknown status filter', async () => {
    const { service } = build();

    await expect(service.list({ status: 'BOGUS' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records who handled a lead when it moves past NEW', async () => {
    const { service } = build();

    await service.update(leadId.toHexString(), actorId, { status: LeadStatus.Contacted });

    const model = (service as unknown as { leadModel: { findByIdAndUpdate: jest.Mock } }).leadModel;
    const set = model.findByIdAndUpdate.mock.calls[0][1].$set;
    expect(set.status).toBe(LeadStatus.Contacted);
    expect(set.handledByUserId).toBe(actorId);
    expect(set.handledAt).toBeInstanceOf(Date);
  });

  it('refuses an update with nothing in it', async () => {
    const { service } = build();

    await expect(
      service.update(leadId.toHexString(), actorId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
