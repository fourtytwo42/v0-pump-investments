# Pump.Investments (2)

*Automatically synced with your [v0.app](https://v0.app) deployments*

[![Deployed on Vercel](https://img.shields.io/badge/Deployed%20on-Vercel-black?style=for-the-badge&logo=vercel)](https://vercel.com/spiderman1983-4323s-projects/v0-pump-investments-xn)
[![Built with v0](https://img.shields.io/badge/Built%20with-v0.app-black?style=for-the-badge)](https://v0.app/chat/ovTe3A6yYXS)

## Overview

This repository will stay in sync with your deployed chats on [v0.app](https://v0.app).
Any changes you make to your deployed app will be automatically pushed to this repository from [v0.app](https://v0.app).

## Deployment

Your project is live at:

**[https://vercel.com/spiderman1983-4323s-projects/v0-pump-investments-xn](https://vercel.com/spiderman1983-4323s-projects/v0-pump-investments-xn)**

## Build your app

Continue building your app on:

**[https://v0.app/chat/ovTe3A6yYXS](https://v0.app/chat/ovTe3A6yYXS)**

## How It Works

1. Create and modify your project using [v0.app](https://v0.app)
2. Deploy your chats from the v0 interface
3. Changes are automatically pushed to this repository
4. Vercel deploys the latest version from this repository

## PM2 Runbook

The production processes managed by PM2 are:

- `pump-investments-web`
- `pump-investments-ingest`

Use a normal restart when you only want to recycle the process:

```bash
pm2 restart pump-investments-web
pm2 restart pump-investments-ingest
```

If you changed `.env` or any other environment value, restart with `--update-env` so PM2 reloads the new values instead of reusing the old environment:

```bash
pm2 restart pump-investments-web --update-env
pm2 restart pump-investments-ingest --update-env
```

Convenience scripts are also available from the repo root:

```bash
npm run pm2:web:restart
npm run pm2:ingest:restart
npm run pm2:web:restart-env
npm run pm2:ingest:restart-env
npm run pm2:restart-env
```
