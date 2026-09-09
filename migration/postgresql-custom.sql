-- OPERIS PostgreSQL custom database objects not expressible in Prisma schema.
-- Keep aligned with server/src/index.ts ensureAssetIdentifierUniqueIndexes().

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_serialNumber_unique"
ON "Asset" ("serialNumber")
WHERE "serialNumber" <> '' AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Asset_active_barcode_unique"
ON "Asset" ("barcode")
WHERE "barcode" <> '' AND "deletedAt" IS NULL;
