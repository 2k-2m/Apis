const MSG = {
  PING: 'PING',
  START_FLOW: 'START_FLOW',
  GET_RECENT: 'GET_RECENT',
  GET_PREFS: 'GET_PREFS',
  SET_PREFS: 'SET_PREFS',
  MARK_STAGE_DONE: 'MARK_STAGE_DONE',
  SET_FLOW_STATUS: 'SET_FLOW_STATUS',
  REQUEST_ROW_KEY: 'REQUEST_ROW_KEY',
  OPEN_PANEL: 'OPEN_PANEL',
  CLOSE_PANEL: 'CLOSE_PANEL',
  REFRESH_PANEL: 'REFRESH_PANEL'
};

// Estado del panel
let panelEl = null;
let currentRowKey = null;

// Escucha mensajes desde popup/worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case MSG.REQUEST_ROW_KEY: {
        // request puede pedir ROW o TPLS; ROW devuelve rowKey actual (si hay)
        const row = detectSelectedRowKey();
        currentRowKey = row || null;

        if (message.payload?.request === 'TPLS') {
          // Plantillas están en el worker; no podemos leer directo desde content.
          // Hacemos un 'ping' al worker para que popup no se quede sin nada.
          chrome.runtime.sendMessage({ type: 'GET_RECENT' }, (res) => {
            // No es ideal, pero popup ya tiene fallback de plantillas si no llegan por aquí.
          });
          return sendResponse({ ok: !!currentRowKey, rowKey: currentRowKey, templates: null });
        }

        return sendResponse({ ok: !!currentRowKey, rowKey: currentRowKey });
      }

      case MSG.OPEN_PANEL:
        openPanel();
        sendResponse({ ok: true });
        break;

      case MSG.CLOSE_PANEL:
        closePanel();
        sendResponse({ ok: true });
        break;

      case MSG.REFRESH_PANEL:
        await refreshPanel();
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, error: 'Mensaje no manejado en content' });
    }
  })();
  return true;
});

// Observadores para cambios en la SPA (reintentar detección)
const observer = new MutationObserver(() => {
  const rk = detectSelectedRowKey();
  if (rk && rk !== currentRowKey) {
    currentRowKey = rk;
    if (panelEl) refreshPanel();
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

// Heurística de selección de fila en Smartsheet
function detectSelectedRowKey() {
  // Heurística defensiva: busca elementos con aria-selected="true" dentro del grid
  // Esto puede requerir adaptación al DOM real de Smartsheet.
  const selected = document.querySelector('[aria-selected="true"], .is-selected, .row--selected');
  if (!selected) return null;

  // Intentamos construir un "rowKey" estable:
  // 1) data-row-id si existiera
  // 2) texto visible recortado + índice
  const rowId = selected.getAttribute?.('data-row-id');
  if (rowId) return `row:${rowId}`;

  // fallback: índice en el grid + hash de texto
  const text = selected.innerText?.trim().slice(0, 80) || 'fila';
  const idx = Array.from(selected.parentElement?.children || []).indexOf(selected);
  return `row:idx${idx}-${hash(text)}`;
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h << 5) - h + str.charCodeAt(i) | 0;
  return Math.abs(h);
}

// Crea/abre panel
function openPanel() {
  if (panelEl) { panelEl.classList.add('ssh-visible'); refreshPanel(); return; }

  panelEl = document.createElement('div');
  panelEl.className = 'ssh-panel';
  panelEl.innerHTML = `
    <div class="ssh-header">
      <div class="ssh-title">Aprobaciones</div>
      <div class="ssh-actions">
        <button class="ssh-btn" data-action="prepare">Preparar columnas</button>
        <button class="ssh-btn ssh-close" title="Cerrar">×</button>
      </div>
    </div>
    <div class="ssh-body">
      <div class="ssh-summary">
        <div><strong>Fila:</strong> <span id="ssh-row">—</span></div>
        <div><strong>Estado:</strong> <span id="ssh-status">—</span></div>
        <div><strong>Plantilla:</strong> <span id="ssh-template">—</span></div>
      </div>
      <div class="ssh-required">
        <div class="ssh-subtitle">Columnas requeridas</div>
        <ul id="ssh-columns"></ul>
      </div>
      <div class="ssh-stages">
        <div class="ssh-subtitle">Etapas</div>
        <ul id="ssh-stages"></ul>
      </div>
    </div>
  `;
  document.documentElement.appendChild(panelEl);

  panelEl.addEventListener('click', onPanelClick);
  panelEl.classList.add('ssh-visible');

  refreshPanel();
}

function closePanel() {
  if (panelEl) panelEl.classList.remove('ssh-visible');
}

function onPanelClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const action = btn.dataset.action;
  if (btn.classList.contains('ssh-close')) {
    closePanel(); return;
  }
  if (action === 'prepare') {
    // Aquí solo “simulamos” preparando columnas: mostramos checklist como cumplida
    // En un futuro, podrías automatizar pasos en la UI si Smartsheet lo permite.
    const colList = panelEl.querySelectorAll('#ssh-columns li');
    colList.forEach(li => li.classList.add('ok'));
  }
  if (action && action.startsWith('mark:')) {
    const stageId = action.split(':')[1];
    markStageDone(stageId);
  }
}

async function markStageDone(stageId) {
  if (!currentRowKey) return;
  // Pedir al worker que marque etapa
  chrome.runtime.sendMessage({ type: 'MARK_STAGE_DONE', payload: { rowKey: currentRowKey, stageId } }, (res) => {
    if (res?.ok) refreshPanel();
  });
}

async function refreshPanel() {
  const rowKey = detectSelectedRowKey();
  currentRowKey = rowKey || currentRowKey;

  // Pedir al worker el flow de esta fila
  chrome.runtime.sendMessage({ type: 'GET_RECENT' }, async (res) => {
    const items = res?.items || [];
    const flow = items.find(f => f.rowKey === currentRowKey) || null;

    // Render summary
    const rowEl = panelEl.querySelector('#ssh-row');
    const statusEl = panelEl.querySelector('#ssh-status');
    const tplEl = panelEl.querySelector('#ssh-template');
    rowEl.textContent = currentRowKey || '—';

    if (flow) {
      statusEl.textContent = flow.status === 'APPROVED' ? 'Aprobado' : 'Pendiente';
      tplEl.textContent = flow.templateId;
    } else {
      statusEl.textContent = 'Sin flujo';
      tplEl.textContent = '—';
    }

    // Columnas requeridas (simuladas desde plantilla conocida)
    let required = [];
    if (flow?.requiredColumns?.length) {
      required = flow.requiredColumns;
    } else if (flow?.templateId === 'compra-menor') {
      required = ['Firma Jefe','Fecha Aprobación Jefe','Firma Finanzas','Fecha Aprobación Finanzas','Estado General'];
    } else if (flow?.templateId === 'viaje') {
      required = ['Estado General'];
    }
    const colsUl = panelEl.querySelector('#ssh-columns');
    colsUl.innerHTML = '';
    required.forEach(c => {
      const li = document.createElement('li');
      li.textContent = c;
      colsUl.appendChild(li);
    });

    // Etapas
    const stagesUl = panelEl.querySelector('#ssh-stages');
    stagesUl.innerHTML = '';
    const stages = flow?.stages || [];
    stages.forEach(s => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="stage-label">${escapeHtml(s.label)}</span>
        <span class="stage-state ${s.done ? 'done' : 'pending'}">${s.done ? 'Hecho' : 'Pendiente'}</span>
        ${s.done ? '' : `<button class="ssh-btn" data-action="mark:${s.id}">Marcar hecho</button>`}
      `;
      stagesUl.appendChild(li);
    });
  });
}

function escapeHtml(str = '') {
  return str.replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
