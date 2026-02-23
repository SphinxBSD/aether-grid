# Aether Grid

## Requisitos

| Herramienta     | Versión      | Notas                    |
|-----------------|--------------|--------------------------|
| **Stellar CLI** | 25.1.0       | Ver instalación más abajo |
| **Noir (nargo)**| 1.0.0-beta.9 | Ver instalación más abajo |
| **Bun**         | —            | [bun.sh](https://bun.sh)  |

---

## Instalación

### Stellar CLI (macOS / Linux)

**Script:**
```bash
curl -fsSL https://github.com/stellar/stellar-cli/raw/main/install.sh | sh
```

**Homebrew:**
```bash
brew install stellar-cli
```

**Desde código (cargo):**
```bash
cargo install --locked stellar-cli@25.1.0
```

### Noir (nargo)

```bash
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup --version v1.0.0-beta.9
```

Si no reconoce `nargo`, cierra la terminal y ábrela de nuevo (o ejecuta `source ~/.zshrc` / `source ~/.bashrc`).

### Bun

Instala desde [bun.sh](https://bun.sh).

---

## Pasos a seguir

Para tener el proyecto corriendo en tu máquina:

**1. Levantar la red local de Stellar**

Si ves **"port is already allocated"** o el puerto 8000 está ocupado, primero para y elimina los contenedores de Stellar y los que queden huérfanos:

```bash
# Ver contenedores (busca el que tenga 8000->8000 en PORTS; suele llamarse stellar-local)
docker ps -a

# Parar y eliminar el contenedor Stellar por nombre (o usa el CONTAINER ID de la lista)
docker stop stellar-local
docker rm stellar-local
```

Luego levanta la red (con `--limits unlimited` para el verificador ZK):

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

> **Importante:** `--limits unlimited` es obligatorio para el verificador ZK. Si ves `HostError: Error(Budget, ExceededLimit)` al hacer `deploy:verifier`, reinicia el contenedor con ese flag.

**2. Crear y fondear la wallet (alice)**

```bash
stellar keys generate --global alice
stellar keys fund alice --network local
```

> Si acabas de reiniciar el contenedor de Stellar, la red está vacía: **vuelve a ejecutar** `stellar keys fund alice --network local` antes de `deploy:verifier`. Si no, verás "Account not found".

**3. Entrar en la app, desplegar verificador, build, deploy y frontend**

```bash
cd aether-grid-app
bun run deploy:verifier
bun run build:local
bun run deploy:local
bun run dev:game aether-grid
```

Con eso deberías tener el proyecto funcionando en local.
