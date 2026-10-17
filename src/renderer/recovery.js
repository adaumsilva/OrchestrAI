// Recovery screen: shown when the interface process crashes or fails to load. Terminals are owned by the main process,
// so they are still running; Reload loads the interface again and it reattaches to them.
const T = {
  en: {
    title: 'The interface stopped', reload: 'Reload', report: 'Save diagnostic report…', safe: 'Your workspace is saved. Reloading brings the interface back and reconnects to the terminals.',
    terminals: (n) => (n === 1 ? '1 terminal is still running.' : `${n} terminals are still running.`), none: 'No terminals were running.', saved: (p) => `Report saved to ${p}`, failed: 'Could not save the report.',
  },
  pt: {
    title: 'A interface parou', reload: 'Recarregar', report: 'Salvar relatório de diagnóstico…', safe: 'Seu espaço de trabalho está salvo. Recarregar traz a interface de volta e reconecta aos terminais.',
    terminals: (n) => (n === 1 ? '1 terminal continua em execução.' : `${n} terminais continuam em execução.`), none: 'Nenhum terminal estava em execução.', saved: (p) => `Relatório salvo em ${p}`, failed: 'Não foi possível salvar o relatório.',
  },
};
const L = T[(navigator.language || 'en').toLowerCase().startsWith('pt') ? 'pt' : 'en'];
const $ = (id) => document.getElementById(id);
$('title').textContent = L.title;
$('reload').textContent = L.reload;
$('report').textContent = L.report;
$('safe').textContent = L.safe;
$('reason').textContent = new URLSearchParams(location.search).get('reason') || '';

window.orchestrai.call('app:ptyCount').then((n) => { $('terminals').textContent = n ? L.terminals(n) : L.none; }).catch(() => {});
$('reload').onclick = () => window.orchestrai.call('app:reloadApp');
$('report').onclick = async () => {
  try {
    const r = await window.orchestrai.call('app:saveDiagnostics');
    $('status').textContent = r && r.path ? L.saved(r.path) : '';
  } catch { $('status').textContent = L.failed; }
};
