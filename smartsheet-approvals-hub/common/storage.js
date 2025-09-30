export const FLOW_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED'
};

const KEYS = {
  TEMPLATES: 'templates',
  PREFS: 'prefs',
  FLOWS: 'flows' // diccionario por rowKey
};

// Utilidades genéricas
async function getAll() {
  return new Promise(resolve => chrome.storage.local.get(null, resolve));
}
async function setObj(obj) {
  return new Promise(resolve => chrome.storage.local.set(obj, resolve));
}
async function getSync(key) {
  return new Promise(resolve => chrome.storage.sync.get(key, resolve));
}
async function setSync(obj) {
  return new Promise(resolve => chrome.storage.sync.set(obj, resolve));
}

// Plantillas (sync)
export async function getTemplates() {
  const data = await getSync(KEYS.TEMPLATES);
  return data[KEYS.TEMPLATES] || [];
}
export async function setTemplates(templates) {
  await setSync({ [KEYS.TEMPLATES]: templates });
}

// Preferencias (sync)
export async function getPrefs() {
  const data = await getSync(KEYS.PREFS);
  // Defaults por si acaso
  return data[KEYS.PREFS] || {
    remindersEnabled: true,
    reminderEveryHours: 24,
    quietHours: { enabled: false, from: 22, to: 7 }
  };
}
export async function setPrefs(prefs) {
  await setSync({ [KEYS.PREFS]: prefs });
}

// Flows (local) => por fila
export async function getFlowsDict() {
  const all = await getAll();
  return all[KEYS.FLOWS] || {};
}
export async function setFlowsDict(dict) {
  await setObj({ [KEYS.FLOWS]: dict });
}

export async function upsertFlow(flow) {
  const dict = await getFlowsDict();
  dict[flow.rowKey] = { ...dict[flow.rowKey], ...flow };
  await setFlowsDict(dict);
  return dict[flow.rowKey];
}

export async function getFlowByKey(rowKey) {
  const dict = await getFlowsDict();
  return dict[rowKey] || null;
}

export async function getRecentFlows(limit = 5) {
  const dict = await getFlowsDict();
  const items = Object.values(dict);
  items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return items.slice(0, limit);
}

export async function setFlowStatus(rowKey, status) {
  const dict = await getFlowsDict();
  if (!dict[rowKey]) return;
  dict[rowKey].status = status;
  dict[rowKey].updatedAt = Date.now();
  await setFlowsDict(dict);
}
