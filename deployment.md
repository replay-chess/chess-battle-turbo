
```
docker build --no-cache \
  -f apps/web/Dockerfile \
  -t replay-chess-web:latest \
  --build-arg DATABASE_URL="$DATABASE_URL" \
  --build-arg CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \
  --build-arg NEXT_PUBLIC_WEBSOCKET_URL="$NEXT_PUBLIC_WEBSOCKET_URL" \
  .
  ```


```
docker run -p 3000:3000 replay-chess-web:latest
```

## Billing rollout

Roll the paywall out in this order so no one is locked out while pieces are still missing. Every step is safe to leave in place overnight.

1. **Apply the migration.** The entitlement columns are additive. Run `pnpm --filter web prisma:migrate:deploy` (or `prisma db push` if the migration history is out of sync) against the target database. Never `prisma migrate dev` on a shared database.
2. **Create the products and set env vars.** `pnpm --filter web dodo:setup-products -- --live` prints `DODO_PRODUCT_ID_MONTHLY` and `DODO_PRODUCT_ID_YEARLY`. Set those, `DODO_LEGACY_PLAYER_PRODUCT_ID`, `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT=live_mode`, and `DODO_PAYMENTS_RETURN_URL` on the web deployment.
3. **Register the webhook.** In the Dodo dashboard point a webhook at `https://<host>/api/webhook/dodo-payments` with the `subscription.*` and `payment.succeeded` events, and set its signing secret as `DODO_PAYMENTS_WEBHOOK_KEY`.
4. **Deploy with `BILLING_PAYWALL=off`.** Checkout, the webhook, and `/api/subscription` all work while the gate stays open, so existing players are unaffected.
5. **Verify with a test account.** Subscribe from `/pricing`, then call `GET /api/subscription` as that account and confirm `entitled: true`, the expected `planKey`, and a `currentPeriodEnd` in the future. Check that an existing legacy subscriber also reports `entitled: true` (`planKey: "legacy"`).
6. **Flip the paywall on.** Set `BILLING_PAYWALL=on` (or remove the variable) and redeploy. Unsubscribed users now receive `402 subscription_required` from game-starting routes and are sent to `/pricing?reason=required`.

To roll back, set `BILLING_PAYWALL=off` and redeploy; no schema or data change is needed.

## WebSocket authentication rollout

The web app issues short-lived HMAC tokens from `GET /api/socket-token` (signed with `INTERNAL_API_SECRET`) and sends them in the Socket.IO handshake. The socket server verifies them in `apps/web-socket/utils/socketAuth.ts`.

Roll out in this order so no live game breaks:

1. Deploy the socket server with `SOCKET_AUTH_REQUIRED=false` (default). It verifies tokens when present, logs sockets that connect without one, and rejects a `join_game` whose `userReferenceId` does not match a presented token.
2. Deploy the web app, which starts sending tokens.
3. Watch the socket server logs until no tokenless sockets appear, then set `SOCKET_AUTH_REQUIRED=true` and restart. From then on unauthenticated sockets are rejected at the handshake.

`INTERNAL_API_SECRET` must be identical on both services.
