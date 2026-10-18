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
      if (shortcutIsGlobal(e)) return false;
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
    const STATUS_LABELS = { restored: 'Restored', idle: 'Idle', starting: 'Starting', running: 'Running', exited: 'Exited', error: 'Error' };
    const dot = h('span', { class: 'status-dot', 'data-status': 'starting', title: 'Starting' });
    head.querySelector('.title').before(dot);
    let status = 'starting';
    const setStatus = (s) => {
      status = s; dot.dataset.status = s; dot.title = STATUS_LABELS[s] + (el.classList.contains('attention') ? ' • needs attention' : '');
      dispatchEvent(new Event('terminal-status'));
    };
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
      if (node.data.maestro) parts.push(skillCovers(node.data.command) ? 'You are the Maestro of this OrchestrAI canvas. Follow the orchestrai skill (not any maestri-* skill) to direct other terminals.' : MAESTRO_PRIMER);
      return parts.join('\n\n');
    };
    const screenTail = () => { const b = term.buffer.active; const out = []; for (let i = b.baseY; i < b.baseY + term.rows; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out.join('\n'); };
    let launchTimer = null;
    const stopLaunch = () => { launch = null; clearInterval(launchTimer); };
    const launchTick = () => {
      if (!launch || exited) { stopLaunch(); return; }
      const quiet = Date.now() - lastChunk;
      // Never type into a confirmation menu (Claude's "trust this folder", for one): Enter would pick its default.
      // Wait for the user to answer it, and give the launch a fresh time budget.
      if (/Enter to confirm|trust this folder|Do you trust/i.test(screenTail())) { launch.started = Date.now(); return; }
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

    let replayed = false;
    async function start() {
      exited = false;
      setStatus('starting');
      if (typeof accountsReady !== 'undefined') await accountsReady;
      // A Maestro needs its agent to know the CLI before it starts (skills are read at launch), so install the skill first.
      const skillTarget = node.data.maestro ? skillTargetFor(node.data.command) : null;
      if (skillTarget && !skillCovers(node.data.command)) { try { await call('skills:install', skillTarget); await refreshSkillStatus(); } catch {} }
      const { profile, typed, remote, notice, reattached } = await resolveLaunch(node);
      const label = profile?.label || (await loadProfiles()).fallback.label;
      if (profileBtn) profileBtn.textContent = label + ' ▾';
      // Output saved from the previous run is shown once; a reattached tmux session redraws its own screen.
      if (!replayed) {
        replayed = true;
        const saved = S().restoreScrollback && !reattached && state.scrollback?.[node.id];
        // Scroll the restored text out of the viewport so the new shell's startup screen-clear cannot erase it.
        if (saved) term.write(saved + '\r\n\x1b[2m— previous session —\x1b[0m\r\n' + '\r\n'.repeat(term.rows));
      }
      if (notice) term.write(`\x1b[33m${notice}\x1b[0m\r\n`);
      const startDir = node.data.cwd || cwd();
      const r = await call('pty:spawn', {
        id: node.id, cols: term.cols, rows: term.rows, profile,
        accountId: remote || profile?.cdFlag ? undefined : effectiveAccountId(node),
        cwd: remote ? undefined : startDir,
        maestro: !!node.data.maestro && !remote && !(profile?.cdFlag),
        peer: !remote && !(profile?.cdFlag),
      });
      if (r.ok && reattached) { setStatus('restored'); term.write('\x1b[2m— reattached to the running tmux session —\x1b[0m\r\n'); }
      if (!r.ok) {
        exited = true;
        setStatus('error');
        term.write(`\r\n\x1b[31mCould not start ${label} (${r.error})\x1b[0m\r\nPress Enter to retry, or edit the terminal settings.\r\n`);
        return;
      }
      lastChunk = 0;
      stopLaunch();
      // A reattached session already has its agent running; do not type the command or role again.
      const prime = !reattached && (node.data.command || '').trim() ? priming() : '';
      launch = (typed || prime) ? { stage: typed ? 'shell' : 'agent', typed, prime, started: Date.now(), typedAt: Date.now() } : null;
      if (launch) launchTimer = setInterval(launchTick, 300);
    }
    async function restart() {
      api.ptyKill(node.id);
      stopLaunch();
      term.write('\r\n\x1b[2m— restarting —\x1b[0m\r\n');
      // Restart means a fresh process, so a persistent terminal's old tmux session must go first.
      const t = tmuxTarget(node);
      if (t) await call('app:tmuxKill', t);
      start();
    }
    term.onData((d) => {
      if (exited) { if (d === '\r') restart(); return; }
      api.ptyWrite(node.id, d);
    });
    // A sandbox terminal that hits a network policy says so in plain text; point at the suggested fix once.
    let denialTail = '', denialShown = false;
    const watchDenial = (d) => {
      if (denialShown || node.data.runsOn?.kind !== 'sandbox') return;
      denialTail = (denialTail + d).slice(-4000);
      const hit = findSandboxDenial(denialTail.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, ''));
      if (!hit) return;
      denialShown = true;
      term.write(`\r\n\x1b[33m[OrchestrAI] The sandbox policy denied something.${hit.fix ? ' Suggested fix: ' + hit.fix : ' Open the terminal settings and use Test connection for details.'}\x1b[0m\r\n`);
    };
    const offData = api.on('pty:data', (id, d) => { if (id === node.id) { term.write(d); noteOutput(d.length); watchDenial(d); } });
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

    // ---------- chat face (the agent's transcript as a conversation; the process keeps running underneath) ----------
    const chatFace = createChatFace({
      node, save,
      cwd: () => node.data.cwd || cwd() || '',
      sendText: (t) => entry.api.send(t.includes('\n') ? `\x1b[200~${t}\x1b[201~` : t),
      interrupt: () => call('pty:send', node.id, '\x03'),
    });
    body.append(chatFace.el);
    const faceBtn = addButton('\u{1F4AC}', 'Switch between the Terminal and Chat faces', () => setFace(node.data.face === 'chat' ? 'terminal' : 'chat'));
    chatFace.onUnread((u) => faceBtn.classList.toggle('unread', u));
    function setFace(f, persist = true) {
      node.data.face = f;
      body.classList.toggle('chat-face', f === 'chat');
      faceBtn.classList.toggle('active', f === 'chat');
      chatFace.show(f === 'chat');
      if (f !== 'chat') { try { fit.fit(); api.ptyResize(node.id, term.cols, term.rows); } catch {} term.focus(); }
      if (persist) save();
    }
    entry.api.setFace = setFace;
    if (node.data.face === 'chat') setFace('chat', false);

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
    entry.api.lastOutput = () => lastChunk;
    entry.api.interrupt = () => call('pty:send', node.id, String.fromCharCode(3));
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
      ro.disconnect(); offData(); offExit(); chatFace.destroy();
      try { state.scrollback[node.id] = serialize.serialize({ scrollback: 300 }); } catch {}
      api.ptyKill(node.id);
      // The node is being closed (not the app), so its persistent session ends with it.
      const t = tmuxTarget(node);
      if (t) call('app:tmuxKill', t);
      term.dispose();
    };
  },
};
