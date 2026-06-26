# ADR 001 — Monorepo structure with pnpm workspaces

**Status:** Accepted  
**Date:** 2026-06-26

## Decision
Split the poker PWA into 5 functional packages + 1 documentation package inside a single pnpm monorepo.

## Reasoning
- Shared TypeScript types (Card, GameState) flow from engine → betting → server → app without npm publishing
- Each agent/developer can own one package with a clear contract boundary
- `workspace:*` protocol resolves local packages without manual linking

## Packages and their single responsibility
| Package | Responsibility |
|---------|---------------|
| poker-engine | Card dealing, hand evaluation, game state machine |
| poker-betting | Pot, blinds, bet validation, side pots |
| poker-server | WebSocket server, lobby, room, reconnect |
| poker-ui | React component library, zero game logic |
| poker-app | PWA shell, routing, wires all packages |
| poker-documentator | Living CONTEXT.md + ADRs |
