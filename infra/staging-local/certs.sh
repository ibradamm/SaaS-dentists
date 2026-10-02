#!/usr/bin/env bash
# Autorité de test et certificat « localhost » (90 jours) pour la pile staging locale.
# Usage : infra/staging-local/certs.sh <dossier>  — puis NODE_EXTRA_CA_CERTS=<dossier>/ca.pem
set -euo pipefail
dir=${1:?dossier de sortie}
mkdir -p "$dir"
cd "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 90 -subj "/CN=Autorite de test staging local" \
  -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout key.pem -out cert.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\n' > ext.cnf
openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 90 \
  -extfile ext.cnf -out cert.pem 2>/dev/null
rm -f cert.csr ext.cnf ca.srl ca-key.pem
chmod 644 key.pem cert.pem ca.pem
