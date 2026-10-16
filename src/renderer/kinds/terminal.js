const TERMINAL_PALETTES = {
  dark: {
    background: '#1e1e1e', foreground: '#f5f5f7', cursor: '#0a84ff', cursorAccent: '#1e1e1e', selectionBackground: '#0a84ff4d',
    black: '#3a3a3c', red: '#ff453a', green: '#32d74b', yellow: '#ffd60a', blue: '#0a84ff', magenta: '#bf5af2', cyan: '#64d2ff', white: '#d1d1d6',
    brightBlack: '#636366', brightRed: '#ff6961', brightGreen: '#5ee07a', brightYellow: '#ffe066', brightBlue: '#409cff', brightMagenta: '#da8fff', brightCyan: '#8ae0ff', brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff', foreground: '#1d1d1f', cursor: '#007aff', cursorAccent: '#ffffff', selectionBackground: '#007aff33',
    black: '#1d1d1f', red: '#d70015', green: '#248a3d', yellow: '#b25000', blue: '#0040dd', magenta: '#8944ab', cyan: '#0071a4', white: '#6e6e73',
    brightBlack: '#8e8e93', brightRed: '#ff3b30', brightGreen: '#30d158', brightYellow: '#c93400', brightBlue: '#007aff', brightMagenta: '#af52de', brightCyan: '#32ade6', brightWhite: '#3a3a3c',
  },
  midnight: {
    background: '#0b0f1a', foreground: '#c8d3f5', cursor: '#82aaff', cursorAccent: '#0b0f1a', selectionBackground: '#2f3b6a99',
    black: '#1b2036', red: '#ff757f', green: '#c3e88d', yellow: '#ffc777', blue: '#82aaff', magenta: '#c099ff', cyan: '#86e1fc', white: '#c8d3f5',
    brightBlack: '#444a73', brightRed: '#ff98a4', brightGreen: '#c7fb6d', brightYellow: '#ffd89e', brightBlue: '#9bb8ff', brightMagenta: '#d3b5ff', brightCyan: '#a4ecff', brightWhite: '#ffffff',
  },
  solarized: {
    background: '#002b36', foreground: '#93a1a1', cursor: '#93a1a1', cursorAccent: '#002b36', selectionBackground: '#073642',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  },
};

const prefersDark = matchMedia('(prefers-color-scheme: dark)');
const terminalTheme = (name) => TERMINAL_PALETTES[name === 'system' || !TERMINAL_PALETTES[name] ? (prefersDark.matches ? 'dark' : 'light') : name];

NodeKinds.terminal = {
  label: 'Terminal', w: 560, h: 340,
  mount({ node, body, cwd, entry, addButton, save, floor, el, head }) {
    const S = () => terminalSettings();
    // Per-terminal overrides (Appearance tab) win over the global terminal settings.
    const eff = () => ({ fontFamily: node.data.fontFamily || S().fontFamily, fontSize: node.data.fontSize || S().fontSize, theme: terminalTheme(node.data.theme || S().theme) });
    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: eff().fontFamily, fontSize: eff().fontSize, lineHeight: S().lineHeight,
      cursorStyle: S().cursorStyle, cursorBlink: S().cursorBlink, scrollback: S().scrollback,
      theme: eff().theme,
    });
    const fit = new FitAddon.FitAddon();
    const search = new SearchAddon.SearchAddon();
    const serialize = new SerializeAddon.SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(serialize);
    term.loadAddon(new Unicode11Addon.Unicode11Addon());
    term.unicode.activeVersion = '11';
    term.loadAddon(new WebLinksAddon.WebLinksAddon((_e, uri) => call('app:openExternal', uri)));

    const nodeEl = () => body.closest('.node');
    let exited = false;

    // ---------- clipboard ----------
    const copy = () => {
      const text = term.getSelection();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      return !!text;
    };
    const paste = () => navigator.clipboard.readText().then((t) => t && term.paste(t)).catch(() => {});
    term.onSelectionChange(() => { if (S().copyOnSelect && term.hasSelection()) copy(); });

    term.attachCustomKeyEventHandler((e) => {
      // Let app-level navigation shortcuts through instead of sending them to the shell.
      if ((e.altKey && (e.key === '[' || e.key === ']')) || (e.ctrlKey && (e.key === 'PageUp' || e.key === 'PageDown'))) return false;
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && k === 'c') { copy(); return false; }
      if (e.ctrlKey && e.shiftKey && k === 'v') { paste(); return false; }
      if (e.ctrlKey && e.shiftKey && k === 'f') { openFind(); return false; }
      if (S().windowsKeys && e.ctrlKey && !e.shiftKey && !e.altKey) {
        if (k === 'c' && term.hasSelection()) { copy(); term.clearSelection(); return false; }
        if (k === 'v') { paste(); return false; }
      }
      return true;
    });

    // ---------- find ----------
    const findInput = h('input', { placeholder: 'Find in terminal', style: 'width:170px' });
    const findCount = h('span', { class: 'muted', style: 'min-width:48px;text-align:center;font-size:11px' });
    let caseSensitive = false;
    const decorations = { matchBackground: '#ffd60a55', activeMatchBackground: '#ff9f0a', matchOverviewRuler: '#ffd60a', activeMatchColorOverviewRuler: '#ff9f0a' };
    const doFind = (dir) => {
      const q = findInput.value;
      if (!q) { search.clearDecorations(); findCount.textContent = ''; return; }
      const opts = { caseSensitive, decorations };
      const found = dir < 0 ? search.findPrevious(q, opts) : search.findNext(q, opts);
      if (!found) findCount.textContent = 'none';
    };
    search.onDidChangeResults(({ resultIndex, resultCount }) => { findCount.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : 'none'; });
    const caseBtn = h('button', { title: 'Match case', onclick: () => { caseSensitive = !caseSensitive; caseBtn.classList.toggle('active', caseSensitive); doFind(1); } }, 'Aa');
    const findBar = h('div', { class: 'find-bar hidden' }, findInput, findCount, caseBtn,
      h('button', { title: 'Previous (Shift+Enter)', onclick: () => doFind(-1) }, '↑'),
      h('button', { title: 'Next (Enter)', onclick: () => doFind(1) }, '↓'),
      h('button', { title: 'Close (Esc)', onclick: () => closeFind() }, '✕'));
    function openFind() {
      findBar.classList.remove('hidden');
      const sel = term.getSelection();
      if (sel && !sel.includes('\n')) findInput.value = sel;
      findInput.focus();
      findInput.select();
      doFind(1);
    }
    function closeFind() {
      findBar.classList.add('hidden');
      search.clearDecorations();
      findCount.textContent = '';
      term.focus();
    }
    findInput.addEventListener('input', () => doFind(1));
    findInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doFind(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(); }
    });

    // ---------- process lifecycle ----------
    let profileBtn;

    // ---------- status, activity monitoring and attention ----------
    const STATUS_LABELS = { idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };
    const dot = h('span', { class: 'status-dot', 'data-status': 'starting', title: 'Starting' });
    head.querySelector('.title').before(dot);
    let status = 'starting';
    const setStatus = (s) => { status = s; dot.dataset.status = s; dot.title = STATUS_LABELS[s] + (el.classList.contains('attention') ? ' • needs attention' : ''); };
    let burstStart = 0, burstBytes = 0, lastChunk = 0, quietTimer = null;
    const clearAttention = () => { el.classList.remove('attention'); setStatus(status); };
    const flagFinished = () => {
      const visible = document.hasFocus() && floor.id === state.active && el.classList.contains('selected');
      if (visible) return;
      el.classList.add('attention');
      setStatus(status);
      if (!document.hasFocus()) call('app:notify', { title: `${node.title} finished`, body: 'The terminal output went quiet.' });
    };
    const noteOutput = (len) => {
      const now = Date.now();
      if (now - lastChunk > 2500) { burstStart = now; burstBytes = 0; }
      burstBytes += len;
      lastChunk = now;
      if (!exited) setStatus('running');
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (!exited) setStatus('idle');
        // "Finished" = a real burst of output (not just a prompt echo) followed by quiet.
        if (node.data.monitor && burstBytes > 300 && lastChunk - burstStart > 2500) flagFinished();
        burstBytes = 0;
      }, 4000);
    };
    addEventListener('focus', () => { if (el.classList.contains('selected') && floor.id === state.active) clearAttention(); });

    // ---------- launch: typed command, role and Maestro priming ----------
    // After the shell prints its first output and goes quiet we type the Command; once the agent it starts goes quiet
    // we paste the role instructions / Maestro primer as its first message.
    let launch = null; // { stage: 'shell' | 'agent', typed, prime, started, quietSince }
    const priming = () => {
      const parts = [];
      const role = roleById(node.data.roleId);
      if (role) parts.push(rolePrompt(role));
      if (node.data.maestro) parts.push(MAESTRO_PRIMER);
      return parts.join('\n\n');
    };
    let launchTimer = null;
    const stopLaunch = () => { launch = null; clearInterval(launchTimer); };
    const launchTick = () => {
      if (!launch || exited) { stopLaunch(); return; }
      const quiet = Date.now() - lastChunk;
      if (Date.now() - launch.started > 45000) { stopLaunch(); return; }
      if (launch.stage === 'shell') {
        if (lastChunk >= launch.started && quiet > 700) {
          call('pty:send', node.id, launch.typed + '\r');
          if (!launch.prime) { stopLaunch(); return; }
          launch.stage = 'agent';
          launch.typedAt = Date.now();
        }
      } else if (lastChunk >= launch.typedAt && quiet > 3500) {
        term.paste(launch.prime);
        setTimeout(() => call('pty:send', node.id, '\r'), 200);
        stopLaunch();
      }
    };

    async function start() {
      exited = false;
      setStatus('starting');
      const { profile, typed, remote } = await resolveLaunch(node);
      const label = profile?.label || (await loadProfiles()).fallback.label;
      if (profileBtn) profileBtn.textContent = label + ' ▾';
      const startDir = node.data.cwd || cwd();
      const r = await call('pty:spawn', {
        id: node.id, cols: term.cols, rows: term.rows, profile,
        cwd: remote ? undefined : startDir,
        maestro: !!node.data.maestro && !remote && !(profile?.cdFlag),
      });
      if (!r.ok) {
        exited = true;
        setStatus('error');
        term.write(`\r\n\x1b[31mCould not start ${label} (${r.error})\x1b[0m\r\nPress Enter to retry, or edit the terminal settings.\r\n`);
        return;
      }
      lastChunk = 0;
      stopLaunch();
      const prime = (node.data.command || '').trim() ? priming() : '';
      launch = (typed || prime) ? { stage: typed ? 'shell' : 'agent', typed, prime, started: Date.now(), typedAt: Date.now() } : null;
      if (launch) launchTimer = setInterval(launchTick, 300);
    }
    function restart() {
      api.ptyKill(node.id);
      stopLaunch();
      term.write('\r\n\x1b[2m— restarting —\x1b[0m\r\n');
      start();
    }
    term.onData((d) => {
      if (exited) { if (d === '\r') restart(); return; }
      api.ptyWrite(node.id, d);
    });
    const offData = api.on('pty:data', (id, d) => { if (id === node.id) { term.write(d); noteOutput(d.length); } });
    const offExit = api.on('pty:exit', (id, code) => {
      if (id !== node.id) return;
      exited = true;
      stopLaunch();
      setStatus('exited');
      term.write(`\r\n\x1b[2m[process exited with code ${code} — press Enter to restart]\x1b[0m\r\n`);
      if (node.data.monitor && burstBytes > 300) flagFinished();
    });
    term.onBell(() => {
      const el = nodeEl();
      if (!el) return;
      el.classList.add('bell');
      setTimeout(() => el.classList.remove('bell'), 350);
    });

    // ---------- layout ----------
    term.open(body);
    body.append(findBar);
    fit.fit();
    const saved = S().restoreScrollback && state.scrollback?.[node.id];
    // Scroll the restored text out of the viewport so the new shell's startup screen-clear cannot erase it.
    if (saved) term.write(saved + '\r\n\x1b[2m— previous session —\x1b[0m\r\n' + '\r\n'.repeat(term.rows));
    start();
    const ro = new ResizeObserver(() => {
      if (!body.offsetWidth) return; // hidden floor
      try { fit.fit(); api.ptyResize(node.id, term.cols, term.rows); } catch {}
    });
    ro.observe(body);

    // ---------- header buttons and context menu ----------
    const edit = () => terminalDialog({ mode: 'edit', floor, node });
    profileBtn = addButton('Shell \u25BE', 'Terminal settings (runs on, command, role\u2026)', edit);
    profileBtn.classList.add('profile-btn');
    addButton('\u2315', 'Find (Ctrl+Shift+F)', openFind);
    addButton('\u27F3', 'Restart the process', restart);

    body.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      popupMenu(e.clientX, e.clientY, [
        { label: 'Terminal settings\u2026', onClick: edit },
        { separator: true },
        { label: 'Copy', disabled: !term.hasSelection(), onClick: copy },
        { label: 'Paste', onClick: paste },
        { label: 'Select all', onClick: () => term.selectAll() },
        { separator: true },
        { label: 'Find\u2026', onClick: openFind },
        { label: 'Clear', onClick: () => term.clear() },
        { label: 'Restart', onClick: restart },
      ]);
    });

    // ---------- appearance: icon, accent color, theme and font overrides ----------
    const applyAppearance = () => {
      const kind = head.querySelector('.kind');
      if (kind) kind.textContent = node.data.icon || '\u276F_';
      el.style.setProperty('--tint', node.data.color || '');
      el.classList.toggle('tinted', !!node.data.color);
      const e = eff();
      Object.assign(term.options, { fontFamily: e.fontFamily, fontSize: e.fontSize, theme: e.theme });
      try { fit.fit(); api.ptyResize(node.id, term.cols, term.rows); } catch {}
    };
    applyAppearance();
    dot.title = 'Starting';

    // ---------- hooks used by other parts of the app ----------
    entry.api.send = (text) => call('pty:send', node.id, text + '\r');
    entry.api.focus = () => term.focus();
    entry.api.readScreen = () => { const b = term.buffer.active; const lines = []; for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? ''); return lines.join('\n').trimEnd(); };
    entry.api.options = () => ({ fontSize: term.options.fontSize, fontFamily: term.options.fontFamily, cursorStyle: term.options.cursorStyle, scrollback: term.options.scrollback, background: term.options.theme?.background });
    entry.api.snapshot = () => serialize.serialize({ scrollback: 300 });
    entry.api.restart = restart;
    entry.api.status = () => status;
    entry.api.clearAttention = clearAttention;
    entry.api.applyAppearance = applyAppearance;
    entry.api.applySettings = () => {
      const s = S();
      Object.assign(term.options, { lineHeight: s.lineHeight, cursorStyle: s.cursorStyle, cursorBlink: s.cursorBlink, scrollback: s.scrollback });
      applyAppearance();
    };
    const onScheme = () => { if ((node.data.theme || S().theme) === 'system') term.options.theme = terminalTheme('system'); };
    prefersDark.addEventListener('change', onScheme);

    return () => {
      prefersDark.removeEventListener('change', onScheme);
      clearInterval(launchTimer); clearTimeout(quietTimer);
      ro.disconnect(); offData(); offExit();
      try { state.scrollback[node.id] = serialize.serialize({ scrollback: 300 }); } catch {}
      api.ptyKill(node.id);
      term.dispose();
    };
  },
};
