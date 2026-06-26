# Poker Monorepo — Shared Context

## Project goal
Offline-playable Texas Hold'em PWA with LAN multiplayer, minimal/clean UI, React + Vite.

## Package dependency graph
```
poker-engine        (no deps)
poker-betting   →   poker-engine
poker-server    →   poker-engine, poker-betting
poker-ui        →   poker-engine (types only)
poker-app       →   poker-engine, poker-betting, poker-ui
poker-documentator  (no code deps — reads everything)
```

## Domain language
*Fill in as the engine takes shape.*

| Term | Definition |
|------|------------|
| Hand | 5-card combination used for showdown |
| Round | One full deal: preflop → flop → turn → river → showdown |
| Pot | Total chips committed by all players in the current round |
| Side pot | Separate pot created when a player is all-in for less than the full bet |
| Blind | Forced bet posted before cards are dealt (small blind, big blind) |
| Action | A player's decision: fold, check, call, bet, raise, all-in |
| Room | A LAN multiplayer session identified by a short code |

## Cross-package type contracts
*Fill in as types stabilise — list shared types and which package owns them.*

| Type | Owner package | Consumed by |
|------|--------------|-------------|
| `Card` | poker-engine | poker-ui, poker-betting |
| `GameState` | poker-engine | poker-betting, poker-server, poker-app |
| `BettingState` | poker-betting | poker-server, poker-app |
| `RoomMessage` | poker-server | poker-app |

## Architecture decisions
See `adr/` directory.

## Open questions
- Side pot display: show per pot or collapsed total?
- Reconnect strategy: how long does a room hold a disconnected seat?
- Blind schedule: fixed or increasing (tournament mode)?
