#!/usr/bin/env bash
set -euo pipefail

: "${OPERIS_SQLITE_FILE:?OPERIS_SQLITE_FILE zorunludur}"
: "${OPERIS_POSTGRES_URL:?OPERIS_POSTGRES_URL zorunludur}"

for tool in sqlite3 psql cmp diff; do
  command -v "$tool" >/dev/null 2>&1 || {
    echo "Gerekli araç eksik: $tool" >&2
    exit 2
  }
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

separator=$'\x1f'
failed=0

compare_dataset() {
  local name="$1"
  local sqlite_sql="$2"
  local postgres_sql="$3"

  sqlite3 -separator "$separator" "$OPERIS_SQLITE_FILE" "$sqlite_sql" > "$tmp/$name.sqlite"
  psql "$OPERIS_POSTGRES_URL" -v ON_ERROR_STOP=1 -At -F "$separator" -c "$postgres_sql" > "$tmp/$name.postgres"

  if cmp -s "$tmp/$name.sqlite" "$tmp/$name.postgres"; then
    echo "CRITICAL_DATA_PASS: $name"
  else
    echo "CRITICAL_DATA_MISMATCH: $name" >&2
    diff -u "$tmp/$name.sqlite" "$tmp/$name.postgres" | head -200 >&2 || true
    failed=1
  fi
}

compare_dataset "users" \
  'SELECT id, username, COALESCE(email, ""), CASE WHEN active THEN 1 ELSE 0 END, CASE WHEN isAdmin THEN 1 ELSE 0 END, directorySource FROM "User" ORDER BY id;' \
  'SELECT "id", "username", COALESCE("email", '"'"''"'"'), CASE WHEN "active" THEN 1 ELSE 0 END, CASE WHEN "isAdmin" THEN 1 ELSE 0 END, "directorySource" FROM "User" ORDER BY "id";'

compare_dataset "branches" \
  'SELECT code, name, CASE WHEN active THEN 1 ELSE 0 END, CASE WHEN isHeadOffice THEN 1 ELSE 0 END FROM "Branch" ORDER BY code;' \
  'SELECT "code", "name", CASE WHEN "active" THEN 1 ELSE 0 END, CASE WHEN "isHeadOffice" THEN 1 ELSE 0 END FROM "Branch" ORDER BY "code";'

compare_dataset "user_branches" \
  'SELECT id, userId, branchCode, CASE WHEN isPrimary THEN 1 ELSE 0 END FROM "UserBranch" ORDER BY id;' \
  'SELECT "id", "userId", "branchCode", CASE WHEN "isPrimary" THEN 1 ELSE 0 END FROM "UserBranch" ORDER BY "id";'

compare_dataset "assets" \
  'SELECT id, assetCode, branchCode, serialNumber, barcode, status, quantity FROM "Asset" ORDER BY id;' \
  'SELECT "id", "assetCode", "branchCode", "serialNumber", "barcode", "status", "quantity" FROM "Asset" ORDER BY "id";'

compare_dataset "helpdesk_tickets" \
  'SELECT id, ticketNo, trackingId, branchCode, requesterId, categoryId, priorityId, statusId, COALESCE(assignedUserId, "") FROM "HelpDeskTicket" ORDER BY id;' \
  'SELECT "id", "ticketNo", "trackingId", "branchCode", "requesterId", "categoryId", "priorityId", "statusId", COALESCE("assignedUserId", '"'"''"'"') FROM "HelpDeskTicket" ORDER BY "id";'

compare_dataset "messages" \
  'SELECT id, branchCode, senderId, recipientId FROM "Message" ORDER BY id;' \
  'SELECT "id", "branchCode", "senderId", "recipientId" FROM "Message" ORDER BY "id";'

compare_dataset "announcements" \
  'SELECT id, branchCode, senderId, priority, audienceType, audienceValue, CASE WHEN active THEN 1 ELSE 0 END FROM "Announcement" ORDER BY id;' \
  'SELECT "id", "branchCode", "senderId", "priority", "audienceType", "audienceValue", CASE WHEN "active" THEN 1 ELSE 0 END FROM "Announcement" ORDER BY "id";'

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "CRITICAL_BUSINESS_DATA_VALIDATION_PASS"
