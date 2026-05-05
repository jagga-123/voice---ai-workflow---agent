const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const PUBLIC_DIR = path.join(__dirname, "public");

const state = {
  bolna: {
    agentId: process.env.BOLNA_AGENT_ID || null,
    agentSource: process.env.BOLNA_AGENT_ID ? "env" : "generated",
    lastSyncedAt: null
  },
  invoices: [
    seedInvoice({
      customerName: "Northwind Trading",
      contactName: "Ayesha Khan",
      phone: "+91-99999-10001",
      invoiceNumber: "INV-2041",
      amount: 240000,
      dueDate: offsetDate(-18),
      priority: "High"
    }),
    seedInvoice({
      customerName: "Vertex Retail",
      contactName: "Rohit Sharma",
      phone: "+91-99999-10002",
      invoiceNumber: "INV-2042",
      amount: 86000,
      dueDate: offsetDate(-9),
      priority: "Medium"
    }),
    seedInvoice({
      customerName: "Aster Logistics",
      contactName: "Meera Nair",
      phone: "+91-99999-10003",
      invoiceNumber: "INV-2043",
      amount: 132500,
      dueDate: offsetDate(-4),
      priority: "Low"
    })
  ],
  calls: [],
  tasks: [],
  events: [],
  demoRuns: []
};

function seedInvoice(data) {
  return {
    id: `inv_${crypto.randomUUID().slice(0, 8)}`,
    customerName: data.customerName,
    contactName: data.contactName,
    phone: data.phone,
    invoiceNumber: data.invoiceNumber,
    amount: data.amount,
    dueDate: data.dueDate,
    priority: data.priority || "Medium",
    status: "Overdue",
    promiseDate: null,
    lastOutcome: null,
    lastCallId: null,
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function offsetDate(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function isBolnaLiveConfigured() {
  return Boolean(process.env.BOLNA_API_KEY);
}

function getBolnaApiBaseUrl() {
  return process.env.BOLNA_API_BASE_URL || process.env.BOLNA_API_URL || "https://api.bolna.ai";
}

function getBolnaHeaders() {
  if (!process.env.BOLNA_API_KEY) {
    throw new Error("BOLNA_API_KEY is required for live Bolna integration.");
  }

  return {
    Authorization: `Bearer ${process.env.BOLNA_API_KEY}`,
    "Content-Type": "application/json"
  };
}

async function bolnaApiRequest(pathname, options = {}) {
  const response = await fetch(`${getBolnaApiBaseUrl()}${pathname}`, {
    method: options.method || "GET",
    headers: {
      ...getBolnaHeaders(),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const responseBody = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const details =
      typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody);
    throw new Error(`Bolna API ${response.status} ${response.statusText}: ${details}`);
  }

  return responseBody;
}

function json(res, code, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function text(res, code, payload, contentType = "text/plain; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getInvoiceById(invoiceId) {
  return state.invoices.find((invoice) => invoice.id === invoiceId) || null;
}

function getInvoiceByNumber(invoiceNumber) {
  return state.invoices.find((invoice) => invoice.invoiceNumber === invoiceNumber) || null;
}

function ensureInvoice(input = {}) {
  const existing =
    (input.id && getInvoiceById(input.id)) ||
    (input.invoiceNumber && getInvoiceByNumber(input.invoiceNumber));

  if (existing) {
    return existing;
  }

  const invoice = seedInvoice({
    customerName: input.customerName || "New Customer",
    contactName: input.contactName || "Finance Contact",
    phone: input.phone || "+91-90000-00000",
    invoiceNumber: input.invoiceNumber || `INV-${Math.floor(1000 + Math.random() * 9000)}`,
    amount: Number(input.amount || 0),
    dueDate: input.dueDate || offsetDate(-7),
    priority: input.priority || "Medium"
  });

  state.invoices.unshift(invoice);
  return invoice;
}

function minutesFromNow(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function computeMetrics() {
  const totalValue = state.invoices.reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const collectedValue = state.invoices
    .filter((invoice) => invoice.status === "Collected")
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const promiseValue = state.invoices
    .filter((invoice) => invoice.status === "Promise to Pay")
    .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0);
  const totalOutstanding = state.invoices.reduce((sum, invoice) => {
    if (invoice.status === "Collected") {
      return sum;
    }
    return sum + Number(invoice.amount || 0);
  }, 0);

  const collected = state.invoices.filter((invoice) => invoice.status === "Collected").length;
  const promises = state.invoices.filter((invoice) => invoice.status === "Promise to Pay").length;
  const followUps = state.tasks.filter((task) => task.status !== "Done").length;
  const overdue = state.invoices.filter((invoice) => invoice.status === "Overdue").length;

  return {
    totalInvoices: state.invoices.length,
    totalValue,
    collectedValue,
    promiseValue,
    totalOutstanding,
    collected,
    promises,
    followUps,
    overdue,
    promiseToPayRate: state.invoices.length
      ? Math.round((promises / state.invoices.length) * 100)
      : 0,
    valueRecoveredRate: totalValue
      ? Math.round((collectedValue / totalValue) * 100)
      : 0,
    collectionRate: state.invoices.length
      ? Math.round((collected / state.invoices.length) * 100)
      : 0
  };
}

function buildBolnaSystemPrompt(invoice) {
  return [
    "You are an enterprise accounts receivable voice assistant.",
    "You call overdue invoice contacts on behalf of the finance team.",
    `The current invoice is ${invoice.invoiceNumber} for ${invoice.customerName} and the amount due is INR ${invoice.amount}.`,
    `The due date is ${invoice.dueDate} and the contact name is ${invoice.contactName}.`,
    "Your goal is to collect a payment confirmation, a promise-to-pay date, or a clear callback request.",
    "Keep the call short, calm, and professional.",
    "Never claim payment was received unless the caller explicitly confirms it.",
    "If the contact is wrong, say you will update the account and end the call politely."
  ].join(" ");
}

function buildBolnaAgentCreateRequest(invoice) {
  const webhookUrl = `${BASE_URL}/api/bolna/webhook`;
  const systemPrompt = buildBolnaSystemPrompt(invoice);

  return {
    agent_config: {
      agent_name: "AR Follow-up Assistant",
      agent_welcome_message: "Hello, this is the finance team following up on an overdue invoice.",
      webhook_url: webhookUrl,
      agent_type: "other",
      tasks: [
        {
          task_type: "conversation",
          task_config: {
            hangup_after_silence: 10,
            incremental_delay: 400,
            number_of_words_for_interruption: 2,
            hangup_after_LLMCall: false,
            backchanneling: false,
            backchanneling_message_gap: 5,
            backchanneling_start_delay: 5,
            ambient_noise_track: "office",
            call_terminate: 180,
            voicemail: false,
            inbound_limit: -1,
            whitelist_phone_numbers: null,
            disallow_unknown_numbers: false
          }
        }
      ]
    },
    agent_prompts: {
      task_1: {
        system_prompt: systemPrompt
      }
    }
  };
}

function buildBolnaCallRequest(invoice, agentId) {
  const payload = {
    agent_id: agentId,
    recipient_phone_number: invoice.phone,
    user_data: {
      customer_name: invoice.customerName,
      contact_name: invoice.contactName,
      invoice_number: invoice.invoiceNumber,
      amount_due: String(invoice.amount),
      due_date: invoice.dueDate,
      priority: invoice.priority,
      customer_id: invoice.id
    },
    agent_data: {
      voice_id: "Sam"
    }
  };

  if (process.env.BOLNA_FROM_PHONE_NUMBER) {
    payload.from_phone_number = process.env.BOLNA_FROM_PHONE_NUMBER;
  }

  return payload;
}

function buildBolnaPreview(invoice) {
  const createRequest = buildBolnaAgentCreateRequest(invoice);
  return {
    live_enabled: isBolnaLiveConfigured(),
    api_base_url: getBolnaApiBaseUrl(),
    cached_agent_id: state.bolna.agentId,
    create_request: createRequest,
    call_request_preview: buildBolnaCallRequest(invoice, state.bolna.agentId || "{{agent_id}}"),
    webhook_url: `${BASE_URL}/api/bolna/webhook`
  };
}

function logEvent(type, message, data = {}) {
  const event = {
    id: `evt_${crypto.randomUUID().slice(0, 8)}`,
    type,
    message,
    data,
    createdAt: new Date().toISOString()
  };
  state.events.unshift(event);
  state.events = state.events.slice(0, 25);
  return event;
}

function upsertTask(task) {
  const existingIndex = state.tasks.findIndex((item) => item.id === task.id);
  if (existingIndex >= 0) {
    state.tasks[existingIndex] = {
      ...state.tasks[existingIndex],
      ...task,
      updatedAt: new Date().toISOString()
    };
    return state.tasks[existingIndex];
  }

  const record = {
    id: `tsk_${crypto.randomUUID().slice(0, 8)}`,
    status: "Open",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...task
  };
  state.tasks.unshift(record);
  return record;
}

function applyOutcome(eventInput) {
  const invoice =
    getInvoiceById(eventInput.invoice_id) ||
    getInvoiceByNumber(eventInput.invoice_number) ||
    ensureInvoice(eventInput.customer_context || {});

  const callId = eventInput.call_id || `call_${crypto.randomUUID().slice(0, 8)}`;
  const outcome = String(eventInput.outcome || eventInput.call_outcome || "unknown").toLowerCase();
  const notes = eventInput.notes || eventInput.summary || "No notes provided.";

  const callRecord = {
    id: callId,
    invoiceId: invoice.id,
    status: "completed",
    outcome,
    notes,
    startedAt: eventInput.started_at || minutesFromNow(-5),
    completedAt: new Date().toISOString(),
    source: eventInput.source || "bolna_webhook"
  };

  const existingCallIndex = state.calls.findIndex((call) => call.id === callId);
  if (existingCallIndex >= 0) {
    state.calls[existingCallIndex] = {
      ...state.calls[existingCallIndex],
      ...callRecord
    };
  } else {
    state.calls.unshift(callRecord);
  }

  invoice.lastCallId = callId;
  invoice.lastOutcome = outcome;
  invoice.notes = notes;
  invoice.updatedAt = new Date().toISOString();

  switch (outcome) {
    case "paid":
    case "payment_received":
      invoice.status = "Collected";
      invoice.promiseDate = null;
      upsertTask({
        id: `task_${invoice.id}`,
        title: `Close finance loop for ${invoice.invoiceNumber}`,
        status: "Done",
        linkedInvoiceId: invoice.id,
        priority: "Low",
        dueDate: offsetDate(0),
        result: "Payment confirmed."
      });
      break;
    case "promise_to_pay":
      invoice.status = "Promise to Pay";
      invoice.promiseDate = eventInput.promise_date || offsetDate(2);
      upsertTask({
        id: `task_${invoice.id}`,
        title: `Verify promised payment for ${invoice.invoiceNumber}`,
        status: "Open",
        linkedInvoiceId: invoice.id,
        priority: "High",
        dueDate: invoice.promiseDate,
        result: "Follow up on promised payment date."
      });
      break;
    case "callback_requested":
      invoice.status = "Follow-up Needed";
      upsertTask({
        id: `task_${invoice.id}`,
        title: `Callback requested for ${invoice.invoiceNumber}`,
        status: "Open",
        linkedInvoiceId: invoice.id,
        priority: "Medium",
        dueDate: eventInput.callback_time || offsetDate(1),
        result: "Customer asked for a later callback."
      });
      break;
    case "wrong_contact":
      invoice.status = "Needs Review";
      upsertTask({
        id: `task_${invoice.id}`,
        title: `Correct contact for ${invoice.invoiceNumber}`,
        status: "Open",
        linkedInvoiceId: invoice.id,
        priority: "High",
        dueDate: offsetDate(1),
        result: "Wrong contact number or person."
      });
      break;
    default:
      invoice.status = "Attempted";
      upsertTask({
        id: `task_${invoice.id}`,
        title: `Retry outreach for ${invoice.invoiceNumber}`,
        status: "Open",
        linkedInvoiceId: invoice.id,
        priority: "Medium",
        dueDate: offsetDate(1),
        result: "No final resolution yet."
      });
  }

  state.demoRuns.unshift({
    invoiceId: invoice.id,
    callId,
    outcome,
    createdAt: new Date().toISOString()
  });
  state.demoRuns = state.demoRuns.slice(0, 15);

  logEvent("webhook", "Bolna webhook processed", {
    invoiceId: invoice.id,
    callId,
    outcome,
    notes
  });

  return {
    invoice,
    call: callRecord,
    metrics: computeMetrics(),
    latestEvents: state.events.slice(0, 8),
    tasks: state.tasks.slice(0, 8)
  };
}

async function ensureBolnaAgent(invoice) {
  if (process.env.BOLNA_AGENT_ID) {
    state.bolna.agentId = process.env.BOLNA_AGENT_ID;
    state.bolna.agentSource = "env";
    state.bolna.lastSyncedAt = new Date().toISOString();
    return {
      agentId: process.env.BOLNA_AGENT_ID,
      source: "env"
    };
  }

  if (state.bolna.agentId) {
    return {
      agentId: state.bolna.agentId,
      source: state.bolna.agentSource || "cache"
    };
  }

  const createRequest = buildBolnaAgentCreateRequest(invoice);
  const createResponse = await bolnaApiRequest("/v2/agent", {
    method: "POST",
    body: createRequest
  });

  if (!createResponse.agent_id) {
    throw new Error("Bolna agent creation did not return an agent_id.");
  }

  state.bolna.agentId = createResponse.agent_id;
  state.bolna.agentSource = "created";
  state.bolna.lastSyncedAt = new Date().toISOString();

  return {
    agentId: createResponse.agent_id,
    source: "created",
    response: createResponse,
    request: createRequest
  };
}

async function launchBolnaCall(invoice) {
  const agent = await ensureBolnaAgent(invoice);
  const callRequest = buildBolnaCallRequest(invoice, agent.agentId);
  const callResponse = await bolnaApiRequest("/call", {
    method: "POST",
    body: callRequest
  });

  return {
    agent,
    callRequest,
    callResponse
  };
}

async function handleDemoStart(body) {
  const invoice = ensureInvoice({
    customerName: body.customerName,
    contactName: body.contactName,
    phone: body.phone,
    invoiceNumber: body.invoiceNumber,
    amount: Number(body.amount || 0),
    dueDate: body.dueDate,
    priority: body.priority || "High"
  });

  const callId = `call_${crypto.randomUUID().slice(0, 8)}`;
  const payload = buildBolnaPreview(invoice);

  const callRecord = {
    id: callId,
    invoiceId: invoice.id,
    status: "in_progress",
    outcome: "pending",
    notes: "Demo session started from the web app.",
    startedAt: new Date().toISOString(),
    completedAt: null,
    source: "web_app"
  };
  state.calls.unshift(callRecord);

  invoice.lastCallId = callId;
  invoice.status = "Calling";
  invoice.updatedAt = new Date().toISOString();

  logEvent("user", "User created a call request from the web app", {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoice.amount
  });

  logEvent("web_app", "Bolna payload prepared", payload);

  if (isBolnaLiveConfigured()) {
    const liveAttempt = await launchBolnaCall(invoice);
    invoice.lastCallId = callId;
    invoice.status = "Calling";
    invoice.updatedAt = new Date().toISOString();

    callRecord.status = liveAttempt.callResponse.status || "queued";
    callRecord.outcome = "pending";
    callRecord.notes = "Live call queued in Bolna. Awaiting webhook completion.";
    callRecord.source = "bolna_live";
    callRecord.executionId = liveAttempt.callResponse.execution_id || null;
    callRecord.agentId = liveAttempt.agent.agentId;

    logEvent("agent", "Bolna call queued successfully.", {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      agentId: liveAttempt.agent.agentId,
      executionId: liveAttempt.callResponse.execution_id || null,
      status: liveAttempt.callResponse.status || "queued"
    });

    return {
      invoice,
      bolnaPayload: payload,
      callId: liveAttempt.callResponse.execution_id || callId,
      liveAttempt,
      result: null,
      metrics: computeMetrics(),
      workflow: [
        "User filled the web app form.",
        "Web app created or reused a live Bolna agent.",
        "Web app queued the outbound phone call in Bolna.",
        "Bolna will post the webhook back to the backend after the call.",
        "Backend updates invoice status and follow-up tasks when the webhook arrives."
      ]
    };
  }

  const outcome = body.outcome || "promise_to_pay";
  logEvent("agent", "Agent successfully contacted customer and captured intent.", {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    outcome
  });
  const simulatedWebhook = applyOutcome({
    invoice_id: invoice.id,
    call_id: callId,
    outcome,
    notes:
      body.notes ||
      (outcome === "promise_to_pay"
        ? "Customer committed to pay on the next business day."
        : "Demo outcome processed."),
    promise_date: body.promiseDate || offsetDate(2),
    callback_time: body.callbackTime || minutesFromNow(180),
    source: "demo_runner"
  });

  state.events.unshift({
    id: `evt_${crypto.randomUUID().slice(0, 8)}`,
    type: "backend",
    message: "Backend logic updated invoice, task, and metrics after the webhook.",
    data: {
      invoiceId: invoice.id,
      callId
    },
    createdAt: new Date().toISOString()
  });
  state.events = state.events.slice(0, 25);

  return {
    invoice,
    bolnaPayload: payload,
    callId,
    liveAttempt: null,
    result: simulatedWebhook,
    metrics: computeMetrics(),
    workflow: [
      "User filled the web app form.",
      "Web app built a structured Bolna payload.",
      "Bolna agent handled the call and sent a webhook.",
      "Backend logic updated invoice status and follow-up tasks.",
      "Web app refreshed the final outcome."
    ]
  };
}

function serveStatic(req, res, fileName) {
  const filePath = path.join(PUBLIC_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    text(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypeMap = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  const content = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeMap[ext] || "application/octet-stream",
    "Content-Length": content.length
  });
  res.end(content);
}

function routeNotFound(res) {
  json(res, 404, { error: "Route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const method = req.method || "GET";

    if (method === "GET" && url.pathname === "/") {
      return serveStatic(req, res, "index.html");
    }

    if (method === "GET" && url.pathname === "/styles.css") {
      return serveStatic(req, res, "styles.css");
    }

    if (method === "GET" && url.pathname === "/app.js") {
      return serveStatic(req, res, "app.js");
    }

    if (method === "GET" && url.pathname === "/api/state") {
      return json(res, 200, {
        metrics: computeMetrics(),
        bolna: {
          liveConfigured: isBolnaLiveConfigured(),
          apiBaseUrl: getBolnaApiBaseUrl(),
          agentId: state.bolna.agentId,
          agentSource: state.bolna.agentSource,
          lastSyncedAt: state.bolna.lastSyncedAt
        },
        invoices: state.invoices,
        calls: state.calls,
        tasks: state.tasks,
        events: state.events,
        workflow: [
          "1. User submits invoice call request in the web app.",
          "2. The app prepares a structured Bolna agent payload.",
          "3. Bolna runs the voice call and posts a webhook to the backend.",
          "4. Backend business logic updates invoice status and creates tasks.",
          "5. The web app shows the outcome to the operations team."
        ]
      });
    }

    if (method === "GET" && url.pathname === "/api/bolna/payload") {
      const invoiceId = url.searchParams.get("invoiceId");
      const invoice = invoiceId ? getInvoiceById(invoiceId) : state.invoices[0];
      return json(res, 200, buildBolnaPreview(invoice));
    }

    if (method === "POST" && url.pathname === "/api/invoices") {
      const body = await readBody(req);
      const invoice = ensureInvoice(body);
      logEvent("web_app", "Invoice saved in the dashboard", {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber
      });
      return json(res, 201, { invoice, metrics: computeMetrics() });
    }

    if (method === "POST" && url.pathname === "/api/bolna/launch") {
      const body = await readBody(req);
      if (!isBolnaLiveConfigured()) {
        return json(res, 400, {
          error: "BOLNA_API_KEY is required for live launch."
        });
      }
      const invoice = ensureInvoice(body);
      const launchResult = await launchBolnaCall(invoice);
      logEvent("web_app", "Bolna launch requested from the dashboard", {
        invoiceId: invoice.id,
        agentId: launchResult.agent.agentId,
        executionId: launchResult.callResponse.execution_id || null
      });
      return json(res, 200, {
        invoice,
        payload: buildBolnaPreview(invoice),
        launchResult,
        metrics: computeMetrics()
      });
    }

    if (method === "POST" && url.pathname === "/api/bolna/webhook") {
      const body = await readBody(req);
      const result = applyOutcome(body);
      return json(res, 200, {
        ok: true,
        message: "Webhook processed.",
        ...result
      });
    }

    if (method === "POST" && url.pathname === "/api/demo/start") {
      const body = await readBody(req);
      const result = await handleDemoStart(body);
      return json(res, 200, {
        ok: true,
        message: "Demo flow completed.",
        ...result
      });
    }

    if (method === "GET" && url.pathname === "/health") {
      return text(res, 200, "ok");
    }

    return routeNotFound(res);
  } catch (error) {
    return json(res, 500, {
      error: error.message || "Internal server error"
    });
  }
});

function start() {
  return server.listen(PORT, () => {
    console.log(`AR Voice Agent running at ${BASE_URL}`);
    console.log(`Open ${BASE_URL} in your browser.`);
  });
}

if (require.main === module) {
  start();
}

module.exports = {
  server,
  start,
  state,
  buildBolnaPreview,
  buildBolnaAgentCreateRequest,
  buildBolnaCallRequest,
  applyOutcome,
  computeMetrics
};
