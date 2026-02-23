# AETHER — Strategic Energy Optimization Game

Juego de estrategia por turnos en una cuadrícula 7×7: localizas un núcleo de energía oculto. Cada acción (movimiento, radar, taladro) consume energía; **quien lo encuentra con menos energía total gana**. Integra pruebas de conocimiento cero (ZK) para verificación justa y corre sobre Stellar.

---

## Cómo correrlo en local

### Requisitos

| Herramienta     | Versión      |
|-----------------|--------------|
| **Stellar CLI** | 25.1.0       |
| **Noir (nargo)**| 1.0.0-beta.9 |
| **Bun**         | [bun.sh](https://bun.sh) |
| **Docker**      | Para la red local |

### Instalar herramientas

**Stellar CLI (macOS / Linux):**
```bash
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
# o: brew install stellar-cli
# o: cargo install --locked stellar-cli@25.1.0
```

**Noir (nargo):**
```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup --version v1.0.0-beta.9
```
Si no reconoce `nargo`, abre de nuevo la terminal o ejecuta `source ~/.zshrc`.

**Bun:** [bun.sh](https://bun.sh)

---

### Pasos

**1. Red local de Stellar**

Si el puerto 8000 ya está en uso:
```bash
docker ps -a
docker stop stellar-local
docker rm stellar-local
```

Levantar la red (**necesaria** `--limits unlimited` para el verificador ZK):
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

**2. Wallet (alice)**

```bash
stellar keys generate --global alice
stellar keys fund alice --network local
```
Si acabas de reiniciar el contenedor, ejecuta de nuevo `stellar keys fund alice --network local`.

**3. App: verificador, build, deploy y frontend**

```bash
cd aether-grid-app
bun run deploy:verifier
bun run build:local
bun run deploy:local
bun run dev:game aether-grid
```

El juego se abre en **http://localhost:3000**.

---

### Errores frecuentes

| Error | Qué hacer |
|-------|-----------|
| `port is already allocated` | Para y borra el contenedor Stellar (paso 1). |
| `Account not found` | Ejecuta `stellar keys fund alice --network local`. |
| `Budget, ExceededLimit` | Levanta la red con `--limits unlimited`. |
| `Failed to resolve import "@aztec/bb.js"` | Desde `aether-grid-app/aether-grid-frontend`: `bun install`. |
