#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL must be set before starting the server}"

npx prisma migrate deploy

case "${SEED_ON_START:-false}" in
  true)
    npm run db:seed
    ;;
  false)
    ;;
  *)
    echo "SEED_ON_START must be either true or false" >&2
    exit 1
    ;;
esac

exec npm start
