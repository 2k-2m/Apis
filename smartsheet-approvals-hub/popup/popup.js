import { MSG } from '../common/messaging.js';

// Tabs básicas
const tabs = Array.from(document.querySelectorAll('.tab'));
const panes = {
  firmas: document.getElementById('tab-firmas'),
  notas: document.getElementById('tab-notas'),
  ajustes: document.getElementById('tab-ajustes')
};
tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    Object.values(panes).forEach(p => p.classList.remove('active'));
    panes[btn.dataset.tab].classList.add('active');
  });
});

// UI refs
const tplSel = document.getElementById('tpl');
const recentUl = document.getElementById('recent');
const btnStart = document.getElementById('btn-start');
const btnOpenPanel = document.getElementById('btn-open-panel');

// Ajustes
const remEnabled = document.getElementById('reminders-enabled');
const remEvery = document.getElementById('reminder-every');
const quietEnabled = document.getElementById('quiet-enabled');
const quietFrom = document.getElementById('quiet-from');
const quietTo = document.getElementById('quiet-to');
const btnSavePrefs = document.getElementById('save-prefs');

// Notas demo
const notesArea = document.getElementById('notes');
const btnSaveNotes = document.getElementById('save-notes');

// Helpers
async function sendToWorker(type, payload) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, payload }, resolve);
  });
}
async function sendToActiveTab(type, payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, error: 'No active tab' };
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tab.id, { type, payload }, resolve);
  });
}

// Carga inicial
(async function init() {
  // Ping
  await sendToWorker(MSG.PING);

  // Plantillas (el worker almacena en sync; aquí pedimos vía mensaje GET_PREFS sólo para prefs,
  // para plantillas podríamos pedir al content o al worker; usaremos content que lee del worker cuando inicie panel)
  // Para simplificar: pedimos recientes y prefs, y content nos devuelve rowKey cuando se lo solicitemos.

  // Recientes
  const rec = await sendToWorker(MSG.GET_RECENT);
  renderRecent(rec?.items || []);

  // Prefs
  const prefs = (await sendToWorker(MSG.GET_PREFS))?.prefs;
  if (prefs) {
    remEnabled.checked = !!prefs.remindersEnabled;
    remEvery.value = prefs.reminderEveryHours || 24;
    quietEnabled.checked = !!prefs.quietHours?.enabled;
    quietFrom.value = prefs.quietHours?.from ?? 22;
    quietTo.value = prefs.quietHours?.to ?? 7;
  }

  // Plantillas: pedimos al content que pregunte al worker y renderice localmente
  const tpls = await sendToActiveTab(MSG.REQUEST_ROW_KEY, { request: 'TPLS' })
    .catch(() => null);
  // Si el content responde con templates, úsalos; si no, pedimos al worker directos
  let templates = tpls?.templates;
  if (!templates) {
    // fallback: pedir al worker recientes y extraer plantillas no está disponible,
    // así que pedimos al content otra vez al abrir panel
    templates = [
      { id: 'compra-menor', name: 'Compra menor' },
      { id: 'viaje', name: 'Viaje' }
    ];
  }
  renderTemplates(templates);
})();

// Render helpers
function renderTemplates(templates) {
  tplSel.innerHTML = '';
  templates.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    tplSel.appendChild(opt);
  });
}
function renderRecent(items) {
  recentUl.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'Sin solicitudes recientes.';
    recentUl.appendChild(li);
    return;
  }
  for (const it of items) {
    const li = document.createElement('li');
    const left = document.createElement('div');
    const right = document.createElement('div');
    left.innerHTML = `<strong>Fila</strong> ${escapeHtml(it.rowKey)}<br><small>${escapeHtml(it.templateId)}</small>`;
    right.className = 'status';
    right.textContent = it.status === 'APPROVED' ? 'Aprobado' : 'Pendiente';
    li.appendChild(left);
    li.appendChild(right);
    recentUl.appendChild(li);
  }
}
function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

// Acciones
btnOpenPanel.addEventListener('click', async () => {
  await sendToActiveTab(MSG.OPEN_PANEL);
  window.close();
});

btnStart.addEventListener('click', async () => {
  const templateId = tplSel.value;

  // 1) Intentar obtener rowKey del content
  const res = await sendToActiveTab(MSG.REQUEST_ROW_KEY, { request: 'ROW' }).catch(() => null);

  let rowKey = res?.ok && res.rowKey ? res.rowKey : null;

  if (!rowKey) {
    // Preguntar si quiere forzar inicio sin fila detectada
    const ok = confirm('No detecté una fila seleccionada.\n¿Quieres iniciar igual (fila manual)?');
    if (!ok) return;
    rowKey = `row:manual-${Date.now()}`;
  }

  // 2) Iniciar flujo en el worker
  const started = await sendToWorker(MSG.START_FLOW, { rowKey, templateId });
  if (!started?.ok) {
    alert('No se pudo iniciar el flujo.');
    return;
  }

  // 3) Abrir/actualizar panel
  await sendToActiveTab(MSG.OPEN_PANEL);
  setTimeout(() => window.close(), 200);
});

// Guardar prefs
btnSavePrefs.addEventListener('click', async () => {
  const prefs = {
    remindersEnabled: remEnabled.checked,
    reminderEveryHours: parseInt(remEvery.value || '24', 10),
    quietHours: {
      enabled: quietEnabled.checked,
      from: parseInt(quietFrom.value || '22', 10),
      to: parseInt(quietTo.value || '7', 10)
    }
  };
  await sendToWorker(MSG.SET_PREFS, prefs);
  alert('Ajustes guardados.');
});

// Notas demo locales
btnSaveNotes.addEventListener('click', async () => {
  await chrome.storage.local.set({ hub_notes: notesArea.value || '' });
  alert('Notas guardadas.');
});
chrome.storage.local.get('hub_notes', (d) => { notesArea.value = d.hub_notes || ''; });
