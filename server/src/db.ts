import { PrismaClient } from '@prisma/client';

const databaseUrl = String(process.env.DATABASE_URL ?? '').trim();
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  throw new Error('OPERIS PostgreSQL-only: DATABASE_URL must use postgresql:// or postgres://.');
}

export const prisma = new PrismaClient();
