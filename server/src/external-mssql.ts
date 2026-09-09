import sql from 'mssql';
import type { AssetExternalConnection } from '@prisma/client';
import { decryptText } from './crypto.js';

export type ExternalTableInfo = {
  schemaName: string;
  tableName: string;
  objectType: 'TABLE' | 'VIEW';
  fullName: string;
};

export type ExternalColumnInfo = {
  ordinal: number;
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength: number | null;
};

export type ExternalConnectionTestResult = {
  ok: boolean;
  database: string;
  server: string;
  login: string;
  serverTime: string;
  message: string;
};

function ensureMssql(connection: AssetExternalConnection): void {
  if (connection.type.toUpperCase() !== 'MSSQL') {
    throw new Error('Bu veri tarayıcısı şu anda yalnız MS SQL Server bağlantıları için kullanılabilir.');
  }
}

function buildConfig(connection: AssetExternalConnection): sql.config {
  ensureMssql(connection);
  const password = connection.passwordEncrypted ? decryptText(connection.passwordEncrypted) : '';
  return {
    user: connection.username,
    password,
    server: connection.host,
    port: connection.port,
    database: connection.database,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
    pool: {
      max: 4,
      min: 0,
      idleTimeoutMillis: 15000,
    },
    connectionTimeout: 10000,
    requestTimeout: 120000,
  };
}

async function withPool<T>(
  connection: AssetExternalConnection,
  callback: (pool: sql.ConnectionPool) => Promise<T>,
): Promise<T> {
  const pool = new sql.ConnectionPool(buildConfig(connection));
  try {
    await pool.connect();
    return await callback(pool);
  } finally {
    await pool.close().catch(() => undefined);
  }
}

export async function testExternalMssqlConnection(
  connection: AssetExternalConnection,
): Promise<ExternalConnectionTestResult> {
  return withPool(connection, async pool => {
    const result = await pool.request().query<{
      databaseName: string;
      loginName: string;
      serverName: string;
      serverTime: Date;
    }>(`
      SELECT
        DB_NAME() AS databaseName,
        SUSER_SNAME() AS loginName,
        CAST(SERVERPROPERTY('ServerName') AS nvarchar(256)) AS serverName,
        SYSDATETIME() AS serverTime
    `);

    const row = result.recordset[0];
    return {
      ok: true,
      database: row?.databaseName ?? connection.database,
      server: row?.serverName ?? connection.host,
      login: row?.loginName ?? connection.username,
      serverTime: row?.serverTime instanceof Date ? row.serverTime.toISOString() : String(row?.serverTime ?? ''),
      message: 'Bağlantı başarılı.',
    };
  });
}

export async function listAuthorizedExternalTables(
  connection: AssetExternalConnection,
): Promise<ExternalTableInfo[]> {
  return withPool(connection, async pool => {
    const result = await pool.request().query<{
      schemaName: string;
      tableName: string;
      objectType: string;
    }>(`
      SELECT
        s.name AS schemaName,
        o.name AS tableName,
        CASE WHEN o.type = 'V' THEN 'VIEW' ELSE 'TABLE' END AS objectType
      FROM sys.objects o
      INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
      WHERE o.type IN ('U', 'V')
        AND o.is_ms_shipped = 0
        AND HAS_PERMS_BY_NAME(s.name + '.' + o.name, 'OBJECT', 'SELECT') = 1
      ORDER BY s.name, o.name
    `);

    return result.recordset.map(row => ({
      schemaName: row.schemaName,
      tableName: row.tableName,
      objectType: row.objectType === 'VIEW' ? 'VIEW' : 'TABLE',
      fullName: `${row.schemaName}.${row.tableName}`,
    }));
  });
}

export async function getAuthorizedExternalColumns(
  connection: AssetExternalConnection,
  schemaName: string,
  tableName: string,
): Promise<ExternalColumnInfo[]> {
  await assertAuthorizedExternalTable(connection, schemaName, tableName);
  return withPool(connection, async pool => {
    const request = pool.request();
    request.input('schemaName', sql.NVarChar(128), schemaName);
    request.input('tableName', sql.NVarChar(128), tableName);

    const result = await request.query<{
      ordinal: number;
      name: string;
      dataType: string;
      nullable: boolean;
      maxLength: number | null;
    }>(`
      SELECT
        c.column_id AS ordinal,
        c.name AS name,
        t.name AS dataType,
        c.is_nullable AS nullable,
        CASE
          WHEN c.max_length = -1 THEN NULL
          WHEN t.name IN ('nvarchar', 'nchar') THEN c.max_length / 2
          ELSE c.max_length
        END AS maxLength
      FROM sys.columns c
      INNER JOIN sys.objects o ON o.object_id = c.object_id
      INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
      INNER JOIN sys.types t ON t.user_type_id = c.user_type_id
      WHERE s.name = @schemaName
        AND o.name = @tableName
        AND o.type IN ('U', 'V')
      ORDER BY c.column_id
    `);

    return result.recordset.map(row => ({
      ordinal: Number(row.ordinal),
      name: row.name,
      dataType: row.dataType,
      nullable: Boolean(row.nullable),
      maxLength: row.maxLength == null ? null : Number(row.maxLength),
    }));
  });
}

export async function countAuthorizedExternalRows(
  connection: AssetExternalConnection,
  schemaName: string,
  tableName: string,
): Promise<number> {
  await assertAuthorizedExternalTable(connection, schemaName, tableName);
  const quoted = quoteTwoPartIdentifier(schemaName, tableName);

  return withPool(connection, async pool => {
    const result = await pool.request().query<{ total: string | number }>(
      `SELECT COUNT_BIG(1) AS total FROM ${quoted}`,
    );
    return Number(result.recordset[0]?.total ?? 0);
  });
}

export async function readAuthorizedExternalRows(
  connection: AssetExternalConnection,
  schemaName: string,
  tableName: string,
  offset: number,
  limit: number,
): Promise<Record<string, unknown>[]> {
  await assertAuthorizedExternalTable(connection, schemaName, tableName);

  if (!Number.isInteger(offset) || offset < 0) throw new Error('Geçersiz başlangıç kaydı.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('Tek istekte en fazla 5000 kayıt alınabilir.');

  const quoted = quoteTwoPartIdentifier(schemaName, tableName);

  return withPool(connection, async pool => {
    const request = pool.request();
    request.input('offset', sql.Int, offset);
    request.input('limit', sql.Int, limit);

    const result = await request.query<Record<string, unknown>>(`
      SELECT *
      FROM ${quoted}
      ORDER BY (SELECT NULL)
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `);

    return result.recordset.map(row => normalizeRow(row));
  });
}

export async function assertAuthorizedExternalTable(
  connection: AssetExternalConnection,
  schemaName: string,
  tableName: string,
): Promise<void> {
  if (!/^[\p{L}\p{N}_@$#.\- ]{1,128}$/u.test(schemaName)) {
    throw new Error('Geçersiz şema adı.');
  }
  if (!/^[\p{L}\p{N}_@$#.\- ]{1,128}$/u.test(tableName)) {
    throw new Error('Geçersiz tablo adı.');
  }

  const tables = await listAuthorizedExternalTables(connection);
  if (!tables.some(table => table.schemaName === schemaName && table.tableName === tableName)) {
    throw new Error('SQL kullanıcısının bu tablo/view üzerinde SELECT yetkisi yok.');
  }
}

function quoteIdentifier(value: string): string {
  return `[${value.replace(/]/g, ']]')}]`;
}

function quoteTwoPartIdentifier(schemaName: string, tableName: string): string {
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`;
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      normalized[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      normalized[key] = value.toString();
    } else if (Buffer.isBuffer(value)) {
      normalized[key] = (value as Buffer).toString('base64');
    } else {
      normalized[key] = value;
    }
  }
  return normalized;
}
