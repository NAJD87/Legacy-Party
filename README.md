# Legacy Party

A mobile-first multiplayer web game built with Node.js and WebSocket.

## Getting Started

### Prerequisites
- Node.js 14+
- npm

### Installation

```bash
npm install
```

### Running the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `PORT` environment variable).

## Features

- Real-time multiplayer rooms
- WebSocket-based communication
- Host-based game management
- Mobile-first responsive design
- Arabic RTL support

## Deployment

This project is ready for deployment on Render. Configure with:
- Build command: `npm install`
- Start command: `npm start`


## Current implementation
- Phase 1: room system and host transfer
- Phase 2: host-only game selection
- Phase 3: bomb word game
- Phase 4A/4B: thief game, discussion, voting and results
- Phase 5: multi-round flow, persistent room scores, random game per round, round tracking, automatic round endings
- Phase 6: mobile UI polish, responsive layouts, premium cards, ranking display and Legacy logo asset
