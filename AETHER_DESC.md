# Technical Documentation: Aether Grid Project

## 1. Overall Purpose

The **Aether Grid** project is a two-player decentralized game built on the Stellar Soroban smart contract platform. The application uses a decoupled abstraction design: the frontend presents a complex "treasure hunt" mini-game featuring movement, radar scanning, and drilling mechanics fueled by "energy", while the underlying smart contract interprets the game strictly as a simple number-guessing match (between 1 and 10). The player whose energy score translates to a guess closest to an on-chain generated pseudo-random number wins the game and the staked points.

## 2. System Architecture and Main Components

The system operates entirely via a client-side web application and on-chain robust smart contracts, eliminating the need for a centralized backend:

- **Smart Contract (`aether-grid-app/contracts/aether-grid`)**: A Rust-based Soroban contract responsible for maintaining the transient state of active sessions, accepting player point commitments, registering integer guesses (1-10), and determining the winner using deterministic Soroban PRNG.
- **Frontend Application (`aether-grid-app/aether-grid-frontend`)**: A React Single Page Application (SPA) managing two core duties: handling the complex off-chain board game mechanics (via Zustand state management) and managing the asynchronous multi-signature XDR lifecycle required to start a game.
- **Game Hub Integration (`mock-game-hub`)**: An external Soroban contract invoked by `aether-grid` via cross-contract calls. It functions as the ledger for player point balances, locking stakes at the start of a session and unlocking them upon winner revelation.

## 3. Interaction Between Internal Modules

- **Game Initiation (Multi-Sig)**: Player 1 prepares a `start_game` transaction locally and signs a `SorobanAuthorizationEntry` (Auth Entry). This signature is exported as an XDR payload. Player 2 imports this XDR, reconstructs the transaction, injects Player 1's signature, signs their own portion, and submits the finalized transaction to the network.
- **Gameplay to Smart Contract**: Players navigate the grid in the UI. Finding the hidden object accumulates a total 'energy' expenditure score. The frontend converts this score via modulo arithmetic (`energy % 10 || 10`) into a valid integer guess and submits it to the `aether-grid` smart contract via the `make_guess` function.
- **Cross-Contract Settlements**: Upon `reveal_winner` being called, the `aether-grid` contract calculates the outcome and immediately triggers `end_game` on the `GameHubClient`, forwarding the results to resolve point exchanges.

## 4. Main Implemented Features

- **Frontend-driven Multi-sig Authorization**: Secure creation of game sessions using shared transaction XDR payloads across separated clients.
- **Asymmetric Game Design**: Complex client-side gameplay logically bounded to lightweight on-chain dispute resolution.
- **On-chain Pseudo-Randomness**: Winner determination utilizes `env.prng()`, tightly seeded using deterministic variables (Session ID, player addresses, and committed guesses) to ensure consistent outcomes between simulations and submissions.
- **Transient State Lifecycle**: Active game sessions are stored within Soroban's temporary storage layer (`env.storage().temporary()`) with a 30-day Ledger Time-To-Live (TTL) to prevent permanent ledger state bloat.

## 5. Technologies and Frameworks Used

- **Smart Contract Ecosystem**: Rust, Stellar Soroban SDK.
- **Client Application**: React (Vite build system), TailwindCSS for styling.
- **State Management**: `zustand` (specifically for local ephemeral board tracking and persistence).
- **Blockchain Connectivity**: `@stellar/stellar-sdk` and `@stellar/freighter-api` for deep XDR manipulation, contract invocations, and wallet interactions.
- **Development Toolchain**: Bun (for script execution and fast dependency management).

## 6. Relevant Folder Structure

- `aether-grid-app/contracts/aether-grid/`: The core Soroban rust contract implementation detailing the guessing logic, auth requirements, and hub integrations.
- `aether-grid-app/aether-grid-frontend/src/components/aether-board/`: UI components rendering the grid visually, alongside `gameStore.ts` tracking the off-chain game state, radar pings, and energy costs.
- `aether-grid-app/aether-grid-frontend/src/games/aether-grid/`: Interaction services (`aetherGridService.ts`) containing the structural wrappers for XDR parsing, authentication entry extractions, and client-side transaction building.

## 7. Primary Execution Flows

1. **Matchmaking (Off-chain / On-chain)**: Player 1 initiates a session, locking their parameters in an exported Auth Entry XDR string. Player 2 completes the transaction and broadcasts it, locking points in the Game Hub.
2. **Local Client Gameplay**: Both players load the session. Off-chain UI tracking monitors movements, limits tool usages (scanners, impulses), and maintains an energy penalty metric.
3. **Guess Submission**: Once a player drills the correct tile, the frontend transforms their final energy integer into a 1-10 range guess and submits a `make_guess` transaction.
4. **Conclusion and Resolution**: Once both players submit their guess, `reveal_winner` is executed. The contract seeds the PRNG, generates the target number, calculates mathematical distance from each player's guess, declares the winner, and notifies the Hub.

## 8. Architectural Decisions and Design Patterns

- **Gameplay-to-Contract Abstraction**: Instead of verifying grid paths on-chain (which is computationally expensive), the game relies on an abstraction pattern. The heavy lifting of the visual game translates into a normalized variable (energy), reducing on-chain logic to minimal comparison operations.
- **Stateless Off-chain Matchmaking**: Eliminates backend servers by utilizing Soroban's powerful `require_auth_for_args` feature, allowing XDR text copying/pasting as a robust peer-to-peer session handshake.
- **Storage Economics**: Strict adherence to temporary storage guarantees that abandoned games will be gracefully purged from the Stellar validators, optimizing rent fees for the contract deployer.

## 9. Assumptions, Constraints, and Project Boundaries

- **Project Boundaries**: This architecture explicitly isolates itself from zero-knowledge setups. The directories `./circuits` and `./verifiers` apply to a separate conceptual phase (`eather-grid`) and do not interact with the implementation documented here.
- **Constraints**: The deterministic PRNG seed assumes fairness by requiring both players to commit guesses before resolution constraints are generated. However, it operates under the constraint that blockchain timestamps/ledgers cannot be used, ensuring deterministic behavior between simulation and execution.
- **Assumptions**: The frontend application trusts local browser `localStorage` caching logic to maintain board states (like previously drilled tiles), assuming sessions won't be easily cleared mid-game natively. The implementation assumes the presence and availability of the mock game hub contract for any point-staking mechanisms to function.
