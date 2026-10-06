#!/usr/bin/env bash
# 開発と E2E の TLS。手元専用の CA を作り、*.lumorphia.test の証明書に署名する (ADR-0002、ADR-0003)。
# 本番は Caddy が TLS を受けるので使わない。置き場所は .data/tls/ (git に入れない)。
# すでにあれば作り直さない (作り直すと、手元のブラウザに入れた CA を入れ直すことになる)。作り直すなら .data/tls を消す
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)/.data/tls"
mkdir -p "$dir"
cd "$dir"

if [ ! -f ca.pem ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem -days 3650 \
    -subj "/CN=Lumorphia development CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  echo "created $dir/ca.pem"
fi

if [ ! -f cert.pem ]; then
  openssl req -newkey rsa:2048 -nodes -keyout key.pem -out cert.csr -subj "/CN=lumorphia.test" 2>/dev/null
  cat > cert.ext <<'EXT'
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:lumorphia.test,DNS:*.lumorphia.test
EXT
  # ブラウザは 398 日より長いサーバー証明書を拒む
  openssl x509 -req -in cert.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out cert.pem \
    -days 397 -extfile cert.ext 2>/dev/null
  rm -f cert.csr cert.ext
  echo "created $dir/cert.pem (*.lumorphia.test)"
fi
