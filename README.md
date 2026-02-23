# Aether Grid

## Run frontend only

```bash
cd aether-grid-app
bun run dev:game aether-grid
```

Requires [Bun](https://bun.sh).

```bash
docker run -d -p 8000:8000 stellar/quickstart \
  --local \
  --limits unlimited \
  --enable core,rpc,lab,horizon,friendbot
stellar network add local \
  --rpc-url http://localhost:8000/soroban/rpc \
  --network-passphrase "Standalone Network ; February 2017"
stellar network use local
```
