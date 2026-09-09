import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const password = process.env.OPERIS_CI_PASSWORD || 'OperisCi123!';
const userId = '00000000-0000-4000-8000-000000000001';
const membershipId = '00000000-0000-4000-8000-000000000002';

try {
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: { companyName: 'OPERIS CI' },
    create: { id: 1, companyName: 'OPERIS CI' },
  });

  await prisma.branch.upsert({
    where: { code: '100' },
    update: { name: 'Merkez', isHeadOffice: true, active: true },
    create: { code: '100', name: 'Merkez', isHeadOffice: true, active: true },
  });

  await prisma.user.upsert({
    where: { username: 'balamir' },
    update: {
      displayName: 'OPERIS CI Administrator',
      email: 'operis-ci@example.com',
      passwordHash,
      active: true,
      isAdmin: true,
      mustChangePassword: false,
    },
    create: {
      id: userId,
      username: 'balamir',
      displayName: 'OPERIS CI Administrator',
      email: 'operis-ci@example.com',
      passwordHash,
      active: true,
      isAdmin: true,
      mustChangePassword: false,
    },
  });

  await prisma.userBranch.upsert({
    where: {
      userId_branchCode: {
        userId,
        branchCode: '100',
      },
    },
    update: { isPrimary: true, assignedById: userId },
    create: {
      id: membershipId,
      userId,
      branchCode: '100',
      isPrimary: true,
      assignedById: userId,
    },
  });

  await prisma.systemMigration.upsert({
    where: { key: 'ci-synthetic-migration' },
    update: { note: 'Synthetic SQLite to PostgreSQL validation record' },
    create: {
      key: 'ci-synthetic-migration',
      note: 'Synthetic SQLite to PostgreSQL validation record',
    },
  });

  await prisma.helpDeskGlobalSetting.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });

  console.log('SYNTHETIC_SQLITE_SEED_PASS');
} finally {
  await prisma.$disconnect();
}
