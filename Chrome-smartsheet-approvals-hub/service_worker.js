const MSG = {
  PING: 'PING',
  START_FLOW: 'START_FLOW',
  GET_RECENT: 'GET_RECENT',
  GET_PREFS: 'GET_PREFS',
  SET_PREFS: 'SET_PREFS',
  MARK_STAGE_DONE: 'MARK_STAGE_DONE',
  SET_FLOW_STATUS: 'SET_FLOW_STATUS'
};

const FLOW_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED' };
const KEYS = { TEMPLATES: 'templates', PREFS: 'prefs', FLOWS: 'flows' };

function lsGet(allKeys = null) {
  return new Promise(res => chrome.storage.local.get(allKeys, res));
}
function lsSet(obj) {
  return new Promise(res => chrome.storage.local.set(obj, res));
}
function ssGet(key) {
  return new Promise(res => chrome.storage.sync.get(key, res));
}
function ssSet(obj) {
  return new Promise(res => chrome.storage.sync.set(obj, res));
}

// Templates (sync)
async function getTemplates() {
  const d = await ssGet(KEYS.TEMPLATES);
  return d[KEYS.TEMPLATES] || [];
}
async function setTemplates(tpls) { await ssSet({ [KEYS.TEMPLATES]: tpls }); }

// Prefs (sync)
async function getPrefs() {
  const d = await ssGet(KEYS.PREFS);
  return d[KEYS.PREFS] || {
    remindersEnabled: true,
    reminderEveryHours: 24,
    quietHours: { enabled: false, from: 22, to: 7 }
  };
}
async function setPrefs(p) { await ssSet({ [KEYS.PREFS]: p }); }

// Flows (local)
async function getFlowsDict() {
  const d = await lsGet(KEYS.FLOWS);
  return d[KEYS.FLOWS] || {};
}
async function setFlowsDict(dict) { await lsSet({ [KEYS.FLOWS]: dict }); }
async function upsertFlow(flow) {
  const dict = await getFlowsDict();
  dict[flow.rowKey] = { ...dict[flow.rowKey], ...flow };
  await setFlowsDict(dict);
  return dict[flow.rowKey];
}
async function getFlowByKey(rowKey) { return (await getFlowsDict())[rowKey] || null; }
async function getRecentFlows(limit = 5) {
  const items = Object.values(await getFlowsDict());
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items.slice(0, limit);
}
async function setFlowStatus(rowKey, status) {
  const dict = await getFlowsDict();
  if (!dict[rowKey]) return;
  dict[rowKey].status = status;
  dict[rowKey].updatedAt = Date.now();
  await setFlowsDict(dict);
}

// ===== Install defaults =====
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    await setTemplates([
      {
        id: 'compra-menor',
        name: 'Compra menor',
        stages: [
          { id: 'jefe', label: 'Aprobación Jefe' },
          { id: 'finanzas', label: 'Aprobación Finanzas' }
        ],
        requiredColumns: [
          'Firma Jefe', 'Fecha Aprobación Jefe',
          'Firma Finanzas', 'Fecha Aprobación Finanzas',
          'Estado General'
        ]
      },
      {
        id: 'viaje',
        name: 'Viaje',
        stages: [
          { id: 'jefe', label: 'Aprobación Jefe' },
          { id: 'rrhh', label: 'Aprobación RR.HH.' },
          { id: 'finanzas', label: 'Aprobación Finanzas' }
        ],
        requiredColumns: ['Estado General']
      }
    ]);

    await setPrefs({
      remindersEnabled: true,
      reminderEveryHours: 24,
      quietHours: { enabled: false, from: 22, to: 7 }
    });
  }
});

// ===== Messaging =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MSG.PING:
        sendResponse({ ok: true, ts: Date.now() });
        break;

      case MSG.START_FLOW: {
        const { rowKey, templateId } = message.payload || {};
        const tpl = (await getTemplates()).find(t => t.id === templateId);
        if (!tpl || !rowKey) return sendResponse({ ok: false, error: 'Datos inválidos' });

        const flow = await upsertFlow({
          rowKey,
          templateId,
          stages: tpl.stages.map(s => ({ ...s, done: false, doneAt: null })),
          status: FLOW_STATUS.PENDING,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          requiredColumns: tpl.requiredColumns || []
        });

        await ensureAlarmScheduled();
        await notify({ title: 'Flujo iniciado', message: `Plantilla “${tpl.name}” en fila ${rowKey}.` });
        sendResponse({ ok: true, flow });
        break;
      }

      case MSG.GET_RECENT:
        sendResponse({ ok: true, items: await getRecentFlows(5) });
        break;

      case MSG.GET_PREFS:
        sendResponse({ ok: true, prefs: await getPrefs() });
        break;

      case MSG.SET_PREFS:
        await setPrefs(message.payload);
        await ensureAlarmScheduled();
        sendResponse({ ok: true });
        break;

      case MSG.MARK_STAGE_DONE: {
        const { rowKey, stageId } = message.payload || {};
        const flow = await getFlowByKey(rowKey);
        if (!flow) return sendResponse({ ok: false, error: 'Flow no encontrado' });
        const st = flow.stages.find(s => s.id === stageId);
        if (!st) return sendResponse({ ok: false, error: 'Etapa inválida' });

        if (!st.done) { st.done = true; st.doneAt = Date.now(); flow.updatedAt = Date.now(); }
        const allDone = flow.stages.every(s => s.done);
        if (allDone) flow.status = FLOW_STATUS.APPROVED;
        await upsertFlow(flow);

        if (allDone) await notify({ title: 'Flujo aprobado', message: `Fila ${rowKey} completada.` });
        sendResponse({ ok: true, flow });
        break;
      }

      case MSG.SET_FLOW_STATUS: {
        const { rowKey, status } = message.payload || {};
        await setFlowStatus(rowKey, status);
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Mensaje no manejado' });
    }
  })();
  return true; // mantener el puerto abierto para respuestas async
});

// ===== Alarms & notifications =====
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm?.name !== 'reminder-tick') return;
  const prefs = await getPrefs();
  if (!prefs.remindersEnabled) return;

  // Quiet hours
  const hour = new Date().getHours();
  if (prefs.quietHours?.enabled) {
    const { from, to } = prefs.quietHours;
    const withinQuiet = from < to ? (hour >= from && hour < to) : (hour >= from || hour < to);
    if (withinQuiet) return;
  }

  const pending = (await getRecentFlows(50)).filter(f => f.status === 'PENDING' && f.stages.some(s => !s.done));
  if (!pending.length) return;

  await notify({ title: 'Recordatorio de firmas', message: `${pending.length} flujo(s) pendientes.` });
});

async function ensureAlarmScheduled() {
  const prefs = await getPrefs();
  await chrome.alarms.clear('reminder-tick');
  if (!prefs.remindersEnabled) return;
  const periodInMinutes = Math.max(15, (prefs.reminderEveryHours || 24) * 60);
  await chrome.alarms.create('reminder-tick', { when: Date.now() + 60 * 1000, periodInMinutes });
}

async function notify({ title, message }) {
  try {
    await chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon48.png', title, message });
  } catch (e) { /* puede fallar si no hay permiso del SO */ }
}
