const state = {
  metrics: null,
  invoices: [],
  calls: [],
  tasks: [],
  events: [],
  workflow: [],
  bolna: null,
  selectedPreset: "promise_to_pay",
  focusedInvoiceId: null,
  liveSession: {
    active: false,
    status: "Idle",
    note: "Select a scenario to preview the call path.",
    stepIndex: 0
  },
  lastFetchAt: null
};

const PRESET_CONFIG = {
  promise_to_pay: {
    outcome: "promise_to_pay",
    priority: "High",
    notes: "Customer agreed to pay after the next GRN reconciliation.",
    session: "Promise date captured and follow-up scheduled."
  },
  paid: {
    outcome: "paid",
    priority: "Medium",
    notes: "Payment confirmed during the call.",
    session: "Invoice closed because payment was confirmed."
  },
  callback_requested: {
    outcome: "callback_requested",
    priority: "Medium",
    notes: "Customer requested a later callback window.",
    session: "Callback requested for a more convenient time."
  },
  wrong_contact: {
    outcome: "wrong_contact",
    priority: "High",
    notes: "Contact details need review before the next attempt.",
    session: "Wrong contact routed to review."
  }
};

let liveActionToken = 0;
let initialInvoiceSynced = false;

const metricsEl = document.getElementById("metrics");
const workflowEl = document.getElementById("workflow");
const payloadEl = document.getElementById("payload");
const eventsEl = document.getElementById("events");
const invoiceTableEl = document.getElementById("invoiceTable");
const demoForm = document.getElementById("demoForm");
const refreshBtn = document.getElementById("refreshBtn");
const saveInvoiceBtn = document.getElementById("saveInvoiceBtn");
const heroCallBtn = document.getElementById("heroCallBtn");
const randomDemoBtn = document.getElementById("randomDemoBtn");
const metricStatEl = document.getElementById("metricStat");
const bolnaModeEl = document.getElementById("bolnaMode");
const bolnaModeCopyEl = document.getElementById("bolnaModeCopy");
const lastRefreshEl = document.getElementById("lastRefresh");
const openInvoicesCountEl = document.getElementById("openInvoicesCount");
const collectedCountEl = document.getElementById("collectedCount");
const followUpsCountEl = document.getElementById("followUpsCount");
const sessionStatusEl = document.getElementById("sessionStatus");
const sessionNoteEl = document.getElementById("sessionNote");
const sessionStepsEl = document.getElementById("sessionSteps");
const presetBarEl = document.getElementById("presetBar");
const queueLabelEl = document.getElementById("queueLabel");
const modeLabelEl = document.getElementById("modeLabel");
const nextActionLabelEl = document.getElementById("nextActionLabel");
const focusStatusEl = document.getElementById("focusStatus");
const focusCustomerEl = document.getElementById("focusCustomer");
const focusInvoiceEl = document.getElementById("focusInvoice");
const focusAmountEl = document.getElementById("focusAmount");
const focusDueEl = document.getElementById("focusDue");

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${formatDate(value)} ${date.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  })}`;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusClass(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("collect")) return "status--collected";
  if (normalized.includes("promise")) return "status--promise";
  if (normalized.includes("calling")) return "status--calling";
  if (normalized.includes("review") || normalized.includes("attempt") || normalized.includes("follow")) {
    return "status--review";
  }
  return "";
}

function eventClass(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "user") return "event--user";
  if (normalized === "web_app") return "event--web-app";
  if (normalized === "webhook") return "event--webhook";
  if (normalized === "backend") return "event--backend";
  if (normalized === "agent") return "event--agent";
  return "";
}

function eventLabel(type) {
  const labels = {
    user: "USER",
    web_app: "WEB APP",
    webhook: "WEBHOOK",
    backend: "BACKEND",
    agent: "AGENT"
  };
  return labels[String(type || "").toLowerCase()] || String(type || "").toUpperCase();
}

function outcomeToPreset(outcome) {
  const normalized = String(outcome || "").toLowerCase();
  if (normalized === "paid" || normalized === "payment_received") return "paid";
  if (normalized === "promise_to_pay") return "promise_to_pay";
  if (normalized === "callback_requested") return "callback_requested";
  if (normalized === "wrong_contact") return "wrong_contact";
  return null;
}

function getActiveInvoice() {
  return state.invoices.find((invoice) => invoice.id === state.focusedInvoiceId) || state.invoices[0] || null;
}

function syncPresetButtons() {
  if (!presetBarEl) return;
  const buttons = presetBarEl.querySelectorAll("[data-preset]");
  buttons.forEach((button) => {
    const preset = button.getAttribute("data-preset");
    button.classList.toggle("is-active", preset === state.selectedPreset);
  });
}

function setLiveSession(partial) {
  state.liveSession = {
    ...state.liveSession,
    ...partial
  };
  renderLiveSession();
}

function renderLiveSession() {
  const activeInvoice = getActiveInvoice();
  const session = state.liveSession;
  const preset = PRESET_CONFIG[state.selectedPreset] || PRESET_CONFIG.promise_to_pay;
  const steps = [
    {
      label: "Prepare invoice context",
      note: activeInvoice
        ? `Briefing the agent with ${activeInvoice.invoiceNumber} for ${activeInvoice.customerName}.`
        : "Briefing the agent with the current invoice."
    },
    {
      label: "Dial customer contact",
      note: activeInvoice
        ? `Connecting to ${activeInvoice.contactName} on ${activeInvoice.phone}.`
        : "Connecting to the selected contact."
    },
    {
      label: "Capture the outcome",
      note: `Listening for ${preset.outcome.replaceAll("_", " ")} and a clear next step.`
    },
    {
      label: "Sync webhook to backend",
      note: activeInvoice
        ? `Updating invoice ${activeInvoice.invoiceNumber} and refreshing the dashboard.`
        : "Refreshing the dashboard after the webhook lands."
    }
  ];

  sessionStatusEl.textContent = session.active ? session.status : session.status || "Idle";
  sessionNoteEl.textContent = session.note || "Select a scenario to preview the call path.";
  sessionStepsEl.innerHTML = steps
    .map((step, index) => {
      const isCurrent = index === Math.min(session.stepIndex, steps.length - 1);
      return `
        <li class="${isCurrent ? "is-current" : ""}">
          <strong>${escapeHtml(step.label)}</strong>
          <div>${escapeHtml(step.note)}</div>
        </li>
      `;
    })
    .join("");
}

function updateHeroCounters(metrics) {
  openInvoicesCountEl.textContent = String(metrics.totalInvoices ?? state.invoices.length ?? 0);
  collectedCountEl.textContent = String(metrics.collected ?? 0);
  followUpsCountEl.textContent = String(metrics.followUps ?? 0);
}

function renderExecutiveSummary() {
  const metrics = state.metrics || {};
  const bolna = state.bolna || {};
  const preset = PRESET_CONFIG[state.selectedPreset] || PRESET_CONFIG.promise_to_pay;

  if (queueLabelEl) {
    queueLabelEl.textContent = `${metrics.overdue ?? 0} overdue invoices`;
  }

  if (modeLabelEl) {
    modeLabelEl.textContent = bolna.liveConfigured ? "Live" : "Demo";
  }

  if (nextActionLabelEl) {
    nextActionLabelEl.textContent = preset.session;
  }
}

function renderFocusCard() {
  const invoice = getActiveInvoice();
  if (!invoice) return;

  if (focusStatusEl) {
    focusStatusEl.textContent = invoice.status || "Overdue";
  }
  if (focusCustomerEl) {
    focusCustomerEl.textContent = invoice.customerName || "-";
  }
  if (focusInvoiceEl) {
    focusInvoiceEl.textContent = invoice.invoiceNumber || "-";
  }
  if (focusAmountEl) {
    focusAmountEl.textContent = money(invoice.amount || 0);
  }
  if (focusDueEl) {
    focusDueEl.textContent = formatDate(invoice.promiseDate || invoice.dueDate);
  }
}

function renderMetrics() {
  const metrics = state.metrics || {};
  const cards = [
    {
      label: "Promise-to-pay rate",
      value: `${metrics.promiseToPayRate ?? 0}%`,
      hint: "Committed invoices waiting on the next payment window.",
      bar: metrics.promiseToPayRate ?? 0,
      meta: `${metrics.promises ?? 0} promises captured`
    },
    {
      label: "Value recovered",
      value: `${metrics.valueRecoveredRate ?? 0}%`,
      hint: "Cash already collected through the voice workflow.",
      bar: metrics.valueRecoveredRate ?? 0,
      meta: `${money(metrics.collectedValue ?? 0)} collected`
    },
    {
      label: "Collected invoices",
      value: `${metrics.collected ?? 0}`,
      hint: "Invoices closed with a confirmed payment outcome.",
      bar: metrics.totalInvoices ? Math.round(((metrics.collected ?? 0) / metrics.totalInvoices) * 100) : 0,
      meta: `${metrics.totalInvoices ?? 0} tracked total`
    },
    {
      label: "Outstanding value",
      value: money(metrics.totalOutstanding ?? 0),
      hint: "Receivables still waiting on follow-up.",
      bar: metrics.totalValue
        ? Math.round(((metrics.totalOutstanding ?? 0) / metrics.totalValue) * 100)
        : 0,
      meta: `${metrics.overdue ?? 0} invoices still overdue`
    }
  ];

  metricsEl.innerHTML = cards
    .map(
      (item) => `
        <article class="metric">
          <div class="metric__label">${escapeHtml(item.label)}</div>
          <div class="metric__value">${escapeHtml(item.value)}</div>
          <div class="metric__hint">${escapeHtml(item.hint)}</div>
          <span class="metric__bar" aria-hidden="true"><span style="width:${Math.max(
            0,
            Math.min(100, item.bar)
          )}%"></span></span>
          <div class="metric__meta">${escapeHtml(item.meta)}</div>
        </article>
      `
    )
    .join("");
}

function renderHeroStat() {
  const metrics = state.metrics || {};
  const bolna = state.bolna || {};
  metricStatEl.textContent = `Promise-to-pay ${metrics.promiseToPayRate ?? 0}% | Collected ${metrics.collected ?? 0} of ${
    metrics.totalInvoices ?? state.invoices.length ?? 0
  } invoices`;

  if (bolnaModeEl) {
    bolnaModeEl.textContent = bolna.liveConfigured
      ? `Bolna integration: Live mode | Agent ${bolna.agentId || "pending"}`
      : "Bolna integration: Demo mode";
  }

  if (bolnaModeCopyEl) {
    bolnaModeCopyEl.textContent = bolna.liveConfigured
      ? `Live mode is ready. Bolna will queue calls through ${bolna.apiBaseUrl || "the configured API"}.`
      : "Demo mode is active. Use the form below to simulate a live call.";
  }

  if (lastRefreshEl) {
    lastRefreshEl.textContent = state.lastFetchAt
      ? `Updated ${formatDateTime(state.lastFetchAt)}`
      : "Waiting for data";
  }

  updateHeroCounters(metrics);
}

function renderWorkflow() {
  workflowEl.innerHTML = (state.workflow || [])
    .map(
      (step) => `
        <li>
          <div>${escapeHtml(step)}</div>
        </li>
      `
    )
    .join("");
}

function renderPayload() {
  const invoice = getActiveInvoice();
  const metrics = state.metrics || {};
  payloadEl.textContent = JSON.stringify(
    {
      agent: "AR Follow-up Assistant",
      mode: state.bolna?.liveConfigured ? "live" : "demo",
      selectedPreset: state.selectedPreset,
      webhook: `${window.location.origin}/api/bolna/webhook`,
      liveSession: {
        status: state.liveSession.status,
        note: state.liveSession.note,
        active: state.liveSession.active
      },
      dashboardMetrics: {
        promiseToPayRate: metrics.promiseToPayRate ?? 0,
        valueRecoveredRate: metrics.valueRecoveredRate ?? 0,
        collected: metrics.collected ?? 0,
        outstandingValue: metrics.totalOutstanding ?? 0
      },
      sampleInvoice: invoice
    },
    null,
    2
  );
}

function renderEvents() {
  if (!state.events.length) {
    eventsEl.innerHTML = `<div class="event">No events yet.</div>`;
    return;
  }

  eventsEl.innerHTML = state.events
    .slice(0, 6)
    .map(
      (event) => `
        <article class="event ${eventClass(event.type)}">
          <div class="event__top">
            <div class="event__type">${escapeHtml(eventLabel(event.type))}</div>
            <div class="event__time">${escapeHtml(formatDateTime(event.createdAt))}</div>
          </div>
          <div class="event__message">${escapeHtml(event.message)}</div>
        </article>
      `
    )
    .join("");
}

function renderInvoices() {
  invoiceTableEl.innerHTML = state.invoices
    .map((invoice) => {
      const isActive = invoice.id === state.focusedInvoiceId;
      return `
        <tr class="${isActive ? "is-active" : ""}">
          <td>
            <div class="badge">${escapeHtml(invoice.customerName)}</div>
            <div class="subtle-line">${escapeHtml(invoice.contactName)} | ${escapeHtml(invoice.phone)}</div>
          </td>
          <td>${escapeHtml(invoice.invoiceNumber)}</td>
          <td>${escapeHtml(money(invoice.amount))}</td>
          <td><span class="${statusClass(invoice.status)}">${escapeHtml(invoice.status)}</span></td>
          <td>${escapeHtml(formatDate(invoice.promiseDate || invoice.dueDate))}</td>
          <td>${escapeHtml(invoice.lastOutcome || "-")}</td>
          <td>
            <button class="table-action" data-call-now="${escapeHtml(invoice.id)}">Call Now</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function render() {
  renderMetrics();
  renderWorkflow();
  renderPayload();
  renderEvents();
  renderInvoices();
  renderHeroStat();
  renderLiveSession();
  renderExecutiveSummary();
  renderFocusCard();
  syncPresetButtons();
}

function formPayload(overrides = {}) {
  const formData = new FormData(demoForm);
  const payload = Object.fromEntries(formData.entries());
  payload.amount = Number(payload.amount || 0);
  return { ...payload, ...overrides };
}

function syncFormFromInvoice(invoice) {
  if (!invoice) return;
  demoForm.customerName.value = invoice.customerName || "";
  demoForm.contactName.value = invoice.contactName || "";
  demoForm.phone.value = invoice.phone || "";
  demoForm.invoiceNumber.value = invoice.invoiceNumber || "";
  demoForm.amount.value = invoice.amount ?? 0;
  demoForm.dueDate.value = invoice.dueDate || demoForm.dueDate.value;
  demoForm.priority.value = invoice.priority || "Medium";

  const preset = outcomeToPreset(invoice.lastOutcome || invoice.status);
  if (preset) {
    state.selectedPreset = preset;
    demoForm.outcome.value = preset;
  }

  demoForm.notes.value = invoice.notes || PRESET_CONFIG[state.selectedPreset]?.notes || demoForm.notes.value;
  syncPresetButtons();
  renderPayload();
  renderFocusCard();
}

function applyPreset(preset) {
  const config = PRESET_CONFIG[preset];
  if (!config) return;

  state.selectedPreset = preset;
  demoForm.outcome.value = config.outcome;
  demoForm.priority.value = config.priority;
  demoForm.notes.value = config.notes;
  setLiveSession({
    active: false,
    status: "Ready",
    note: config.session,
    stepIndex: 0
  });
  syncPresetButtons();
  renderPayload();
  renderExecutiveSummary();
}

function chooseRandomPreset() {
  const keys = Object.keys(PRESET_CONFIG);
  const preset = keys[Math.floor(Math.random() * keys.length)];
  applyPreset(preset);

  const invoice = state.invoices[Math.floor(Math.random() * state.invoices.length)] || null;
  if (invoice) {
    state.focusedInvoiceId = invoice.id;
    demoForm.customerName.value = invoice.customerName || "";
    demoForm.contactName.value = invoice.contactName || "";
    demoForm.phone.value = invoice.phone || "";
    demoForm.invoiceNumber.value = invoice.invoiceNumber || "";
    demoForm.amount.value = invoice.amount ?? 0;
    demoForm.dueDate.value = invoice.dueDate || demoForm.dueDate.value;
    demoForm.priority.value = invoice.priority || demoForm.priority.value;
    renderPayload();
    render();
  }
}

async function fetchState() {
  const response = await fetch("/api/state");
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Failed to load dashboard state.");
  }

  state.metrics = data.metrics;
  state.invoices = data.invoices;
  state.calls = data.calls;
  state.tasks = data.tasks;
  state.events = data.events;
  state.workflow = data.workflow;
  state.bolna = data.bolna || null;
  state.lastFetchAt = new Date().toISOString();

  if (!initialInvoiceSynced && state.invoices.length) {
    initialInvoiceSynced = true;
    state.focusedInvoiceId = state.invoices[0].id;
    syncFormFromInvoice(state.invoices[0]);
  } else if (!state.focusedInvoiceId && state.invoices.length) {
    state.focusedInvoiceId = state.invoices[0].id;
  }

  render();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

async function playLiveSequence(payload, token) {
  const steps = [
    {
      status: "Preparing",
      note: `Building a short call brief for ${payload.contactName || "the contact"}.`
    },
    {
      status: "Dialing",
      note: `Calling ${payload.phone || "the target number"} with the finance team context.`
    },
    {
      status: "Listening",
      note: `Waiting for ${String(payload.outcome || "promise_to_pay").replaceAll("_", " ")}.`
    },
    {
      status: "Syncing",
      note: `Webhook updates will refresh invoice ${payload.invoiceNumber || "-"} in the dashboard.`
    }
  ];

  for (let index = 0; index < steps.length; index += 1) {
    if (token !== liveActionToken) return;
    const step = steps[index];
    setLiveSession({
      active: true,
      status: step.status,
      note: step.note,
      stepIndex: index
    });
    await sleep(260);
  }
}

async function triggerVoiceCall(payload) {
  const token = ++liveActionToken;
  setLiveSession({
    active: true,
    status: "Launching",
    note: `Starting the call for ${payload.contactName || payload.customerName || "the invoice contact"}.`,
    stepIndex: 0
  });

  try {
    const requestPromise = postJson("/api/demo/start", payload);
    const animationPromise = playLiveSequence(payload, token);
    const [response] = await Promise.all([requestPromise, animationPromise]);

    if (token !== liveActionToken) return response;

    if (response.invoice?.id) {
      state.focusedInvoiceId = response.invoice.id;
      syncFormFromInvoice(response.invoice);
    }

    state.lastFetchAt = new Date().toISOString();
    setLiveSession({
      active: false,
      status: "Complete",
      note: `${response.invoice?.invoiceNumber || payload.invoiceNumber || "Invoice"} updated with ${
        response.invoice?.status || "the final"
      } status.`,
      stepIndex: 3
    });

    await fetchState();
    state.focusedInvoiceId = response.invoice?.id || state.focusedInvoiceId;
    render();
    return response;
  } catch (error) {
    liveActionToken += 1;
    setLiveSession({
      active: false,
      status: "Error",
      note: error.message || "The call flow could not be started.",
      stepIndex: 0
    });
    throw error;
  }
}

async function saveInvoice(payload) {
  const response = await postJson("/api/invoices", payload);
  if (response.invoice?.id) {
    state.focusedInvoiceId = response.invoice.id;
    syncFormFromInvoice(response.invoice);
  }
  setLiveSession({
    active: false,
    status: "Saved",
    note: `Invoice ${response.invoice?.invoiceNumber || payload.invoiceNumber || ""} saved without starting a call.`,
    stepIndex: 0
  });
  await fetchState();
}

function updateDefaultDueDate() {
  demoForm.dueDate.value = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

demoForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await triggerVoiceCall(formPayload());
});

saveInvoiceBtn.addEventListener("click", async () => {
  await saveInvoice(formPayload());
});

refreshBtn.addEventListener("click", async () => {
  await fetchState();
});

heroCallBtn.addEventListener("click", async () => {
  await triggerVoiceCall(
    formPayload({
      notes: "Triggered from the hero action."
    })
  );
});

randomDemoBtn.addEventListener("click", () => {
  chooseRandomPreset();
});

presetBarEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;
  applyPreset(button.getAttribute("data-preset"));
});

demoForm.addEventListener("input", () => {
  renderPayload();
});

demoForm.outcome.addEventListener("change", () => {
  state.selectedPreset = demoForm.outcome.value;
  syncPresetButtons();
  renderPayload();
});

invoiceTableEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-call-now]");
  if (!button) return;
  const invoiceId = button.getAttribute("data-call-now");
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) return;

  state.focusedInvoiceId = invoice.id;
  syncFormFromInvoice(invoice);

  await triggerVoiceCall({
    customerName: invoice.customerName,
    contactName: invoice.contactName,
    phone: invoice.phone,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoice.amount,
    dueDate: invoice.dueDate,
    priority: invoice.priority || "High",
    outcome: "promise_to_pay",
    notes: "Call triggered directly from the invoice row."
  });
});

updateDefaultDueDate();
applyPreset(state.selectedPreset);

fetchState().catch((error) => {
  setLiveSession({
    active: false,
    status: "Error",
    note: error.message || "Unable to load the dashboard.",
    stepIndex: 0
  });
});
