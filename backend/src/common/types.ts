import { RequestContext } from './request-context';
import { Request } from 'express';

export type AppRequest = Request & {
  context?: RequestContext;
};

