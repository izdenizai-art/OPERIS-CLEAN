import 'dotenv/config';
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const confirm = process.env.OPERIS_CONFIRM_STAGING_LOAD_SEED;
const output = process.env.OPERIS_LOAD_USERS_FILE;
const url = new URL(process.env.DATABASE_URL || '');
const schema = url.searchParams.get('schema') || 'public';

if (confirm !== 'YES') throw new Error('Staging load seed confirmation missing');
if (!/^operis_stage_[a-z0-9_]+$/.test(schema)) throw new Error('Refusing load seed outside operis_stage_* schema');
if (!output) throw new Error('OPERIS_LOAD_USERS_FILE missing');

try {
  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      domainSyncEnabled: false,
      reminderEmailEnabled: false,
      smtpEnabled: false,
      graphEnabled: false,
    },
  });
  await prisma.networkMonitor.updateMany({ data: { active: false } });
  await prisma.assetExternalConnection.updateMany({ data: { enabled: false } });

  await prisma.branch.upsert({
    where: { code: '100' },
    update: { active: true },
    create: { code: '100', name: 'Staging Load 100', isHeadOffice: true, active: true },
  });

  const existing = await prisma.user.count({ where: { username: { startsWith: 'load75bb_' } } });
  if (existing !== 0) throw new Error('Staging load users already exist');

  const generatedSecret = crypto.randomBytes(24).toString('base64url') + '!Aa1';
  const passwordHash = await bcrypt.hash(generatedSecret, 10);
  const credentials = [];

  for (let i = 1; i <= 100; i += 1) {
    const username = 'load75bb_' + String(i).padStart(3, '0');
    const user = await prisma.user.create({
      data: {
        username,
        displayName: 'Staging Load User ' + i,
        passwordHash,
        active: true,
        isAdmin: true,
        mustChangePassword: false,
        directorySource: 'STAGING_LOAD',
      },
      select: { id: true },
    });

    await prisma.userBranch.create({
      data: {
        userId: user.id,
        branchCode: '100',
        isPrimary: true,
        assignedById: 'STAGING_LOAD',
      },
    });

    credentials.push({ username, password: generatedSecret });
  }

  fs.writeFileSync(output, JSON.stringify(credentials));
  console.log('STAGING_LOAD_USERS_CREATED=100');
  console.log('STAGING_LOAD_SCHEMA=' + schema);
} finally {
  await prisma.$disconnect();
}
