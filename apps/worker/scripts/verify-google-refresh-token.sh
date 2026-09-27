#!/usr/bin/env bash

set -euo pipefail

cleanup() {
  unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN
}
trap cleanup EXIT

read -r -p "Google client ID: " GOOGLE_CLIENT_ID
read -r -s -p "Google client secret: " GOOGLE_CLIENT_SECRET
printf '\n'
read -r -s -p "Google refresh token: " GOOGLE_REFRESH_TOKEN
printf '\n'

export GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_REFRESH_TOKEN

node --input-type=module <<'NODE'
const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
});

const token = await tokenResponse.json();

if (!tokenResponse.ok || !token.access_token) {
  console.error(`Refresh token validation failed: ${token.error_description ?? token.error ?? `HTTP ${tokenResponse.status}`}`);
  process.exit(1);
}

const tokenInfoResponse = await fetch(
  `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token.access_token)}`,
);
const tokenInfo = await tokenInfoResponse.json();

if (!tokenInfoResponse.ok) {
  console.error(`Access token inspection failed: ${tokenInfo.error_description ?? tokenInfo.error ?? `HTTP ${tokenInfoResponse.status}`}`);
  process.exit(1);
}

const scopes = String(tokenInfo.scope ?? '').split(/\s+/).filter(Boolean);
const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';

if (!scopes.includes(gmailSendScope)) {
  console.error('The refresh token is valid, but it does not include the gmail.send permission.');
  console.error(`Granted scopes: ${scopes.join(', ') || '(none)'}`);
  process.exit(1);
}

console.log('The refresh token is valid and includes the gmail.send permission.');
NODE
