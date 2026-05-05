# AR Voice Agent Bolna Demo

This project is a lightweight enterprise demo for a real workflow:

- Problem: finance teams spend too much manual time chasing overdue invoices.
- Workflow: user creates a call in the web app, Bolna runs the voice agent, the webhook posts back the outcome, and backend logic updates invoice status and follow-up tasks.
- Outcome metric: promise-to-pay rate, collected invoices, and outstanding value reduced.

## Folder name

Use this folder: `ar-voice-agent-bolna`

## What is included

- A responsive web app dashboard
- A Bolna-ready structured voice agent payload
- A webhook endpoint for call outcomes
- A demo mode that simulates the full flow end-to-end
- Backend business logic for invoice status updates and task creation

## Run locally

1. Open the folder:

```bash
cd ar-voice-agent-bolna
```

2. Start the server:

```bash
npm start
```

3. Open:

```text
http://localhost:3000
```

## How to complete the task

1. Select the enterprise use case: AR follow-up for overdue invoices.
2. Show the dashboard and explain the metric: promise-to-pay rate.
3. Run the demo form once.
4. Show that the app builds a Bolna payload.
5. Show the webhook event being processed.
6. Show the invoice status and follow-up task update.
7. Record the screen and upload the repo plus deployment link.

## How to connect to real Bolna

1. Set `BOLNA_API_KEY` in `.env`.
2. Optional: set `BOLNA_AGENT_ID` if you already created an agent in Bolna.
3. Optional: set `BOLNA_FROM_PHONE_NUMBER` if your account uses a dedicated outbound number.
4. Optional: set `BOLNA_API_BASE_URL` if you want to override the default `https://api.bolna.ai`.
5. Point Bolna webhooks to:

```text
POST /api/bolna/webhook
```

6. Use the `/api/bolna/launch` endpoint to send the live call to Bolna.

When `BOLNA_API_KEY` is present, the server will:

- create an agent with `/v2/agent` if `BOLNA_AGENT_ID` is not already set
- place the outbound call with `/call`
- wait for Bolna webhook updates at `/api/bolna/webhook`

## Demo flow

User -> Web app -> Bolna agent -> Webhook -> Backend logic -> Output

The output is visible in:

- invoice status
- promise date
- follow-up tasks
- event log
- live Bolna agent ID when configured

## Deployment

This code is plain Node.js, so you can deploy it to any platform that runs a Node server:

- Render
- Railway
- Fly.io
- your own VPS

Set `PUBLIC_BASE_URL` to the deployed URL so the webhook URL is correct.
