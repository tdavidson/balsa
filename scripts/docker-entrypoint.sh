#!/bin/sh
set -eu

pnpm db:migrate
exec pnpm --filter @finance/web start
