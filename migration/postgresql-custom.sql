-- OPERIS PostgreSQL custom database objects not expressible in Prisma schema.
-- Keep aligned with server/src/index.ts ensureAssetIdentifierUniqueIndexes().

-- AppSettings is a singleton row. Create it before Node startup so concurrent
-- schedulers/readers cannot race on first-use upsert and terminate the process.
INSERT INTO "AppSettings" ("id", "updatedAt")
VALUES (1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_serialNumber_unique"
ON "Asset" ("serialNumber")
WHERE "serialNumber" <> '' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_barcode_unique"
ON "Asset" ("barcode")
WHERE "barcode" <> '' AND "deletedAt" IS NULL;
