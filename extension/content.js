// =====================================================
//  WHATSPROSPECT - EXTENSÃO CHROME
//  Content Script para web.whatsapp.com
// =====================================================

(async function () {
  'use strict';

  // Evitar dupla injeção
  if (document.getElementById('wbot-root')) return;

  // ===== UTILIDADES =====

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  let _cancelSleep = null;
  function cancellableSleep(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { _cancelSleep = null; resolve(); }, ms);
      _cancelSleep = () => { clearTimeout(timer); _cancelSleep = null; resolve(); };
    });
  }

  function randomEntre(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function horaAtual() {
    return new Date().toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  // ===== STORAGE =====

  function getState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (data) => resolve(data));
    });
  }

  function saveState(payload) {
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, () => resolve());
    });
  }

  // ===== ESPERAR WHATSAPP WEB CARREGAR =====

  async function waitForWhatsApp() {
    for (let i = 0; i < 120; i++) {
      const side = document.querySelector('#side');
      if (side) return true;
      await sleep(1000);
    }
    return false;
  }

  // ===== ESPERAR ELEMENTO =====

  async function waitForElement(selector, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(500);
    }
    return null;
  }

  // ===== INTERAÇÃO COM WHATSAPP WEB =====

  function getMessageInput() {
    // Seletor principal: input de mensagem no chat aberto
    return (
      document.querySelector('#main footer div[contenteditable="true"][data-tab="10"]') ||
      document.querySelector('#main footer div[contenteditable="true"]') ||
      document.querySelector('#main div[contenteditable="true"][role="textbox"]')
    );
  }

  function getSendButton() {
    // Botão de enviar
    const sendIcon = document.querySelector('#main footer span[data-icon="send"]');
    if (sendIcon) return sendIcon.closest('button') || sendIcon;

    const btns = document.querySelectorAll('#main footer button');
    for (const btn of btns) {
      if (btn.querySelector('span[data-icon="send"]')) return btn;
    }
    return null;
  }

  async function navigateToChat(numero) {
    // Busca o número na barra de pesquisa do WhatsApp (sem recarregar a página)
    const searchBox = document.querySelector('#side div[contenteditable="true"][data-tab]') ||
                      document.querySelector('#side div[contenteditable="true"]') ||
                      document.querySelector('div[title="Caixa de texto de pesquisa"]') ||
                      document.querySelector('div[title="Search input textbox"]');

    if (searchBox) {
      searchBox.focus();
      // Limpar busca anterior
      searchBox.textContent = '';
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(300);

      // Digitar o número
      document.execCommand('insertText', false, numero);
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(1500);

      // Clicar no primeiro resultado
      const results = document.querySelectorAll('#side span[title]');
      for (const r of results) {
        const title = r.getAttribute('title') || '';
        if (title.includes(numero.replace('+', '')) || title.includes(numero)) {
          r.closest('[role="listitem"], [data-testid="cell-frame-container"], [tabindex]')?.click() || r.click();
          await sleep(500);
          // Limpar busca
          searchBox.textContent = '';
          searchBox.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
      }

      // Se não encontrou resultado exato, clicar no primeiro resultado disponível
      const firstResult = document.querySelector('#side [role="listitem"]') ||
                          document.querySelector('#side [data-testid="cell-frame-container"]');
      if (firstResult) {
        firstResult.click();
        await sleep(500);
        searchBox.textContent = '';
        searchBox.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // Limpar busca se nada encontrado
      searchBox.textContent = '';
      searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Fallback: usar a API de URL via link temporário (SPA-friendly)
    const a = document.createElement('a');
    a.href = `https://web.whatsapp.com/send?phone=${numero}`;
    a.target = '_self';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function waitForChatReady(timeout = 35000) {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      // Sucesso: input de mensagem disponível
      const input = getMessageInput();
      if (input) return { status: 'ready', element: input };

      // Verificar popup de erro ("número inválido")
      const popupBtns = document.querySelectorAll(
        'div[role="dialog"] div[role="button"], div[data-animate-modal-popup] div[role="button"]'
      );
      for (const btn of popupBtns) {
        const text = btn.closest('[role="dialog"]')?.textContent || '';
        if (
          text.includes('invalid') ||
          text.includes('inválido') ||
          text.includes('não existe') ||
          text.includes("doesn't exist") ||
          text.includes('não encontrado')
        ) {
          btn.click();
          return { status: 'invalid' };
        }
      }

      // Verificar link "Continuar para o chat" / "Continue to chat"
      const links = document.querySelectorAll('a');
      for (const link of links) {
        if (link.href && link.href.includes('send?phone=')) {
          link.click();
          await sleep(2000);
          break;
        }
      }

      // Verificar botão verde de "Continuar"
      const allButtons = document.querySelectorAll('div[role="button"]');
      for (const btn of allButtons) {
        const btnText = btn.textContent?.toLowerCase() || '';
        if (
          btnText.includes('continuar') ||
          btnText.includes('continue') ||
          btnText.includes('iniciar conversa') ||
          btnText.includes('start chat')
        ) {
          btn.click();
          await sleep(2000);
          break;
        }
      }

      await sleep(500);
    }

    return { status: 'timeout' };
  }

  async function typeMessage(element, text, totalTimeMs) {
    element.focus();
    await sleep(300);

    // Limpar campo
    element.textContent = '';
    element.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(200);

    // Calcular delay por caractere
    const totalChars = text.length;
    const minDelay = 35;
    const baseDelay = totalTimeMs ? Math.max(minDelay, totalTimeMs / totalChars) : 50;

    // Digitar caractere por caractere
    for (let i = 0; i < text.length; i++) {
      if (shouldStop) return false;
      const ch = text[i];

      if (ch === '\n') {
        // Shift+Enter para nova linha no WhatsApp Web
        const enterDown = new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          shiftKey: true, bubbles: true, cancelable: true
        });
        element.dispatchEvent(enterDown);
        await sleep(50);
        const enterUp = new KeyboardEvent('keyup', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
          shiftKey: true, bubbles: true, cancelable: true
        });
        element.dispatchEvent(enterUp);
      } else {
        // Inserir caractere normal
        const inputEvent = new InputEvent('beforeinput', {
          inputType: 'insertText', data: ch, bubbles: true, cancelable: true
        });
        element.dispatchEvent(inputEvent);
        document.execCommand('insertText', false, ch);
      }

      // Delay variável para parecer humano (±40%)
      const variation = baseDelay * (0.6 + Math.random() * 0.8);
      await sleep(Math.round(variation));
    }

    await sleep(300);
    // Verificar se o texto foi inserido
    if (element.textContent.trim().length > 0) return true;

    // Fallback: colar via clipboard se digitação falhou
    element.focus();
    element.textContent = '';
    await sleep(100);
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    element.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true
    }));
    await sleep(300);
    return element.textContent.trim().length > 0;
  }

  async function clickSend() {
    await sleep(300);
    const btn = getSendButton();
    if (btn) {
      btn.click();
      return true;
    }

    // Fallback: Enter
    const input = getMessageInput();
    if (input) {
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      return true;
    }

    return false;
  }

  // ===== MOTOR DE AUTOMAÇÃO =====

  let automationRunning = false;
  let shouldStop = false;

  async function startAutomation() {
    if (automationRunning) return;
    automationRunning = true;
    shouldStop = false;

    const state = await getState();
    const config = state.config || {};
    const numeros = state.numeros || [];
    let session = state.session || {};

    if (numeros.length === 0) {
      addLog('erro', 'Nenhum número na lista. Adicione números na aba "Números".');
      automationRunning = false;
      updateControlButtons();
      return;
    }

    if (!config.mensagem || !config.mensagem.trim()) {
      addLog('erro', 'Mensagem não configurada. Configure na aba "Mensagem".');
      automationRunning = false;
      updateControlButtons();
      return;
    }

    session.active = true;
    session.stats = { enviados: 0, erros: 0, pulados: 0, total: numeros.length };
    session.currentIndex = 0;
    renderNumList(numeros, 0);
    await saveState({ session });

    updateControlButtons();
    updateStats(session.stats);

    addLog('info', `Iniciando envio para ${numeros.length - session.currentIndex} números...`);
    addLog(
      'info',
      `Delay: ${config.delayMin}s - ${config.delayMax}s | Máx: ${config.maxPorSessao}/sessão`
    );

    let msgSessao = 0;

    for (let i = session.currentIndex; i < numeros.length; i++) {
      if (shouldStop) {
        addLog('aviso', 'Envio interrompido pelo usuário.');
        break;
      }

      // Limite por sessão
      if (msgSessao >= (config.maxPorSessao || 40)) {
        addLog('aviso', `Limite de ${config.maxPorSessao} mensagens atingido.`);
        break;
      }


      const numero = numeros[i].replace(/[^\d+]/g, '');
      if (!numero) {
        session.currentIndex = i + 1;
        await saveState({ session });
        continue;
      }

      addLog('info', `[${i + 1}/${numeros.length}] Abrindo chat: ${numero}`);
      updateProgress(i, numeros.length);

      // Navegar para o chat
      await navigateToChat(numero);

      await cancellableSleep(2000);
      if (shouldStop) break;

      const result = await waitForChatReady(35000);

      if (result.status === 'invalid') {
        addLog('aviso', `${numero} — número inválido ou não está no WhatsApp. Pulando...`);
        session.stats.pulados++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        await cancellableSleep(2000);
        if (shouldStop) break;
        continue;
      }

      if (result.status === 'timeout') {
        addLog('erro', `${numero} — timeout ao abrir chat. Pulando...`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        await cancellableSleep(2000);
        if (shouldStop) break;
        continue;
      }

      // Chat pronto - simular digitação
      const todasMsg = [config.mensagem, ...(config.variacoes || [])].filter(
        (m) => m && m.trim()
      );
      const msgEscolhida = todasMsg[randomEntre(0, todasMsg.length - 1)];

      // Digitar mensagem caractere por caractere
      const minTempoNecessario = msgEscolhida.length * 35; // 35ms mínimo por caractere
      const tempoConfig = randomEntre(
        (config.digitacaoMin || 3) * 1000,
        (config.digitacaoMax || 8) * 1000
      );
      const tempoDigitacao = Math.max(tempoConfig, minTempoNecessario);
      addLog('info', `Digitando por ${(tempoDigitacao / 1000).toFixed(1)}s...`);

      const input = getMessageInput();
      if (!input) {
        addLog('erro', `${numero} — input de mensagem não encontrado.`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        continue;
      }

      const typed = await typeMessage(input, msgEscolhida, tempoDigitacao);
      if (!typed) {
        addLog('erro', `${numero} — falha ao digitar mensagem.`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        continue;
      }

      await cancellableSleep(500);
      if (shouldStop) break;

      // Enviar
      const sent = await clickSend();
      if (!sent) {
        addLog('erro', `${numero} — falha ao clicar enviar.`);
        session.stats.erros++;
      } else {
        msgSessao++;
        session.stats.enviados++;
        addLog('sucesso', `✔ Enviado para ${numero} (${msgSessao}/${config.maxPorSessao})`);
        updateNumItemStatus(i, 'Enviado');
      }

      session.currentIndex = i + 1;
      await saveState({ session });
      updateStats(session.stats);
      updateProgress(session.currentIndex, numeros.length);

      // Pausa longa a cada X mensagens
      if (
        msgSessao > 0 &&
        msgSessao % (config.pausaCada || 10) === 0 &&
        !shouldStop
      ) {
        const pausaMin = (config.pausaLongaMin || 5) * 60000;
        const pausaMax = (config.pausaLongaMax || 10) * 60000;
        const pausa = randomEntre(pausaMin, pausaMax);
        addLog('pausa', `Pausa longa de ${(pausa / 60000).toFixed(1)} min (anti-ban)...`);
        startCountdown(pausa, 'Pausa anti-ban...');
        await cancellableSleep(pausa);
        stopCountdown();
        if (shouldStop) break;
      }

      // Delay entre mensagens
      if (i < numeros.length - 1 && !shouldStop) {
        const delay = randomEntre(
          (config.delayMin || 45) * 1000,
          (config.delayMax || 180) * 1000
        );
        addLog('info', `Aguardando ${(delay / 1000).toFixed(0)}s antes da próxima...`);
        startCountdown(delay, 'Próximo envio em...');
        await cancellableSleep(delay);
        stopCountdown();
      }
    }

    // Finalizar
    stopCountdown();
    automationRunning = false;
    session.active = false;
    await saveState({ session });
    updateControlButtons();

    addLog(
      'sucesso',
      `Sessão finalizada! ${session.stats.enviados} enviados, ${session.stats.erros} erros, ${session.stats.pulados} pulados.`
    );
  }

  let _timerInterval = null;

  function startCountdown(ms, label) {
    const timerEl = $('#numTimer');
    const timerLabel = $('#timerLabel');
    const timerBar = $('#timerBar');
    const timerTime = $('#timerTime');
    if (!timerEl) return;

    timerEl.style.display = '';
    timerLabel.textContent = label || 'Próximo envio em...';
    timerBar.style.width = '100%';

    const totalSec = Math.ceil(ms / 1000);
    let remaining = totalSec;

    const formatTime = (s) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    };

    timerTime.textContent = formatTime(remaining);

    clearInterval(_timerInterval);
    _timerInterval = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(_timerInterval);
        _timerInterval = null;
        timerEl.style.display = 'none';
        return;
      }
      timerTime.textContent = formatTime(remaining);
      timerBar.style.width = `${(remaining / totalSec) * 100}%`;
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(_timerInterval);
    _timerInterval = null;
    const timerEl = shadow?.querySelector('#numTimer');
    if (timerEl) timerEl.style.display = 'none';
  }

  function stopAutomation() {
    shouldStop = true;
    if (_cancelSleep) _cancelSleep();
    stopCountdown();
    addLog('aviso', 'Parando envio...');
  }

  // ===== VERIFICAR SESSÃO ATIVA (retomar após reload) =====

  async function checkActiveSession() {
    const state = await getState();
    const session = state.session;

    if (session && session.active) {
      // Sessão ficou ativa por causa de um reload — resetar flag
      addLog('aviso', 'Sessão anterior detectada. Clique em Iniciar para retomar.');
      session.active = false;
      await saveState({ session });
      updateStats(session.stats);
    }
  }

  // ===== UI: CRIAR PAINEL =====

  function createPanel() {
    const root = document.createElement('div');
    root.id = 'wbot-root';
    root.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;z-index:99999;pointer-events:none;';
    document.body.appendChild(root);

    const shadow = root.attachShadow({ mode: 'closed' });

    shadow.innerHTML = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  :host { font-family: 'Segoe UI', Tahoma, sans-serif; }

  .toggle-btn {
    position: fixed;
    top: 50%;
    right: 0;
    transform: translateY(-50%);
    width: 36px;
    height: 80px;
    background: #00a884;
    border: none;
    border-radius: 8px 0 0 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    pointer-events: auto;
    z-index: 100000;
    transition: all 0.2s;
    box-shadow: -2px 0 10px rgba(0,0,0,0.3);
  }

  .toggle-btn:hover { width: 42px; background: #02906f; }
  .toggle-btn.open { right: 370px; }

  .panel {
    position: fixed;
    top: 0;
    right: -370px;
    width: 370px;
    height: 100vh;
    background: #111b21;
    border-left: 1px solid #313d45;
    display: flex;
    flex-direction: column;
    pointer-events: auto;
    transition: right 0.3s ease;
    z-index: 99999;
  }

  .panel.open { right: 0; }

  /* Header */
  .panel-header {
    padding: 14px 16px;
    background: #1f2c33;
    border-bottom: 1px solid #313d45;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .panel-header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .panel-header-left .icon {
    width: 34px;
    height: 34px;
    background: #00a884;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
  }

  .panel-header h2 {
    font-size: 15px;
    color: #e9edef;
    font-weight: 600;
  }

  .panel-header .sub {
    font-size: 11px;
    color: #8696a0;
  }

  .status-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 12px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
  }

  .status-pill.idle { background: rgba(134,150,160,0.15); color: #8696a0; }
  .status-pill.sending { background: rgba(0,168,132,0.15); color: #00a884; }
  .status-pill.paused { background: rgba(255,184,77,0.15); color: #ffb84d; }

  .status-pill .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .status-pill.sending .dot { animation: blink 1.2s infinite; }

  @keyframes blink {
    0%,100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  /* Stats */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    padding: 10px 12px;
    flex-shrink: 0;
  }

  .stat {
    background: #1f2c33;
    border-radius: 8px;
    padding: 8px 4px;
    text-align: center;
  }

  .stat-val {
    font-size: 20px;
    font-weight: 700;
  }

  .stat-val.green { color: #00a884; }
  .stat-val.red { color: #ff4d6a; }
  .stat-val.blue { color: #53bdeb; }
  .stat-val.yellow { color: #ffb84d; }

  .stat-lbl {
    font-size: 9px;
    color: #8696a0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    margin-top: 2px;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 2px;
    padding: 0 12px;
    background: #111b21;
    flex-shrink: 0;
  }

  .tab-btn {
    flex: 1;
    padding: 8px 4px;
    border: none;
    background: transparent;
    color: #8696a0;
    font-family: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab-btn.active { color: #00a884; border-bottom-color: #00a884; }

  /* Tab Content */
  .tab-body {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }

  .tab-body::-webkit-scrollbar { width: 5px; }
  .tab-body::-webkit-scrollbar-track { background: transparent; }
  .tab-body::-webkit-scrollbar-thumb { background: #313d45; border-radius: 3px; }

  .tab-pane { display: none; }
  .tab-pane.active { display: block; }

  /* Form */
  .form-group { margin-bottom: 12px; }

  .form-group label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    color: #8696a0;
    margin-bottom: 5px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .form-group textarea,
  .form-group input {
    width: 100%;
    background: #2a3942;
    border: 1px solid #313d45;
    border-radius: 6px;
    padding: 8px 10px;
    color: #e9edef;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }

  .form-group textarea:focus,
  .form-group input:focus {
    border-color: #00a884;
  }

  .form-group textarea {
    min-height: 80px;
    resize: vertical;
  }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  .num-count {
    font-size: 12px;
    color: #8696a0;
    margin-bottom: 8px;
  }
  .num-btn-row {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  .btn-num-action {
    background: #2a3942;
    border: 1px solid #313d45;
    border-radius: 6px;
    padding: 7px 16px;
    color: #e9edef;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-num-action:hover { background: #313d45; }
  .btn-num-clear { color: #8696a0; }
  .btn-num-clear:hover { border-color: #ff4d6a; color: #ff4d6a; }
  .num-timer {
    background: #1a2730;
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .timer-label {
    font-size: 11px;
    color: #8696a0;
    margin-bottom: 6px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    font-weight: 600;
  }
  .timer-bar-bg {
    width: 100%;
    height: 4px;
    background: #313d45;
    border-radius: 2px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .timer-bar {
    height: 100%;
    background: #00a884;
    border-radius: 2px;
    width: 100%;
    transition: width 1s linear;
  }
  .timer-time {
    font-size: 18px;
    font-weight: 700;
    color: #e9edef;
    text-align: center;
  }
  .num-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 300px;
    overflow-y: auto;
  }
  .num-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: #1a2730;
    border-radius: 8px;
    transition: background 0.15s;
  }
  .num-item:hover { background: #1e2f38; }
  .num-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 14px;
    color: #fff;
    flex-shrink: 0;
  }
  .num-info {
    flex: 1;
    font-size: 13px;
    color: #e9edef;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .num-status {
    font-size: 11px;
    color: #8696a0;
    flex-shrink: 0;
  }
  .num-status.sent { color: #00a884; }
  .num-status.error { color: #ff4d6a; }
  .num-remove {
    background: none;
    border: none;
    color: #8696a0;
    cursor: pointer;
    font-size: 16px;
    padding: 2px 4px;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .num-remove:hover { color: #ff4d6a; }

  /* Buttons */
  .btn {
    width: 100%;
    padding: 10px;
    border: none;
    border-radius: 8px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
    margin-top: 6px;
  }

  .btn:disabled { opacity: 0.35; cursor: not-allowed; }

  .btn-add {
    background: transparent;
    border: 1px dashed #8696a0;
    color: #8696a0;
    margin-bottom: 8px;
  }
  .btn-add:hover { border-color: #00a884; color: #00a884; }

  .var-item { margin-bottom: 10px; }
  .var-item .form-group { margin-bottom: 0; }
  .var-item textarea {
    width: 100%;
    background: #1a2730;
    border: 1px solid #313d45;
    border-radius: 6px;
    padding: 8px 10px;
    color: #e9edef;
    font-family: inherit;
    font-size: 13px;
    outline: none;
    min-height: 80px;
    resize: vertical;
    transition: border-color 0.2s;
  }
  .var-item textarea:focus { border-color: #00a884; }
  .var-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
  }
  .var-header label { font-size: 11px; font-weight: 600; color: #8696a0; text-transform: uppercase; letter-spacing: 0.3px; }
  .var-remove {
    background: none;
    border: none;
    color: #ff4d6a;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .var-remove:hover { background: rgba(255,77,106,0.15); }

  .btn-save {
    background: #2a3942;
    color: #53bdeb;
    border: 1px solid #313d45;
    transition: all 0.3s ease;
  }
  .btn-save:hover:not(:disabled) { background: #313d45; }
  .btn-save.btn-success {
    background: #00a884;
    color: #111b21;
    border-color: #00a884;
    animation: btnPop 0.3s ease;
  }
  .btn-reset.btn-success {
    background: #00a884;
    color: #111b21;
    border-color: #00a884;
    animation: btnPop 0.3s ease;
  }
  .btn-default {
    background: transparent;
    color: #8696a0;
    border: 1px solid #313d45;
  }
  .btn-default:hover { border-color: #53bdeb; color: #53bdeb; }
  @keyframes btnPop {
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  }

  .btn-start {
    background: #00a884;
    color: #111b21;
  }
  .btn-start:hover:not(:disabled) { background: #02906f; }

  .btn-stop {
    background: #ff4d6a;
    color: #fff;
  }
  .btn-stop:hover:not(:disabled) { opacity: 0.85; }

  .btn-reset {
    background: transparent;
    color: #8696a0;
    border: 1px solid #313d45;
    font-size: 11px;
    padding: 6px;
    margin-top: 8px;
  }

  .btn-group {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    padding: 0 12px 8px;
    flex-shrink: 0;
  }

  /* Log */
  .log-box {
    background: #0b141a;
    border: 1px solid #313d45;
    border-radius: 6px;
    height: 160px;
    overflow-y: auto;
    padding: 8px;
    font-family: 'Consolas', 'Courier New', monospace;
    font-size: 11px;
    line-height: 1.7;
  }

  .log-box::-webkit-scrollbar { width: 4px; }
  .log-box::-webkit-scrollbar-thumb { background: #313d45; border-radius: 2px; }

  .log-entry { display: flex; gap: 6px; }
  .log-time { color: #8696a0; white-space: nowrap; font-size: 10px; }
  .log-msg { word-break: break-word; }

  .log-entry.info .log-msg { color: #53bdeb; }
  .log-entry.sucesso .log-msg { color: #00a884; }
  .log-entry.erro .log-msg { color: #ff4d6a; }
  .log-entry.aviso .log-msg { color: #ffb84d; }
  .log-entry.pausa .log-msg { color: #a78bfa; }

  /* Progress */
  .progress-wrap {
    padding: 6px 12px;
    flex-shrink: 0;
  }

  .progress-bg {
    width: 100%;
    height: 6px;
    background: #2a3942;
    border-radius: 3px;
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #00a884, #53bdeb);
    border-radius: 3px;
    transition: width 0.4s ease;
    width: 0%;
  }

  .progress-text {
    font-size: 10px;
    color: #8696a0;
    text-align: right;
    margin-top: 3px;
  }

  /* Toast */
  .toast {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    padding: 8px 18px;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 500;
    z-index: 100001;
    opacity: 0;
    animation: toastIn 0.3s forwards, toastOut 0.3s 2.5s forwards;
    pointer-events: none;
  }

  .toast.success { background: rgba(0,168,132,0.9); color: #fff; }
  .toast.error { background: rgba(255,77,106,0.9); color: #fff; }

  @keyframes toastIn {
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
  @keyframes toastOut {
    to { opacity: 0; transform: translateX(-50%) translateY(20px); }
  }
</style>

<!-- TOGGLE BUTTON -->
<button class="toggle-btn" id="toggleBtn">🤖</button>

<!-- PANEL -->
<div class="panel" id="panel">

  <!-- Header -->
  <div class="panel-header">
    <div class="panel-header-left">
      <div class="icon">💬</div>
      <div>
        <h2>WhatsProspect</h2>
        <div class="sub">By @Neexll</div>
      </div>
    </div>
    <div class="status-pill idle" id="statusPill">
      <div class="dot"></div>
      <span id="statusLabel">Parado</span>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-row">
    <div class="stat">
      <div class="stat-val green" id="stEnviados">0</div>
      <div class="stat-lbl">Enviados</div>
    </div>
    <div class="stat">
      <div class="stat-val red" id="stErros">0</div>
      <div class="stat-lbl">Erros</div>
    </div>
    <div class="stat">
      <div class="stat-val blue" id="stTotal">0</div>
      <div class="stat-lbl">Total</div>
    </div>
    <div class="stat">
      <div class="stat-val yellow" id="stPulados">0</div>
      <div class="stat-lbl">Pulados</div>
    </div>
  </div>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab-btn active" data-tab="tabMsg">💬 Mensagem</button>
    <button class="tab-btn" data-tab="tabNums">📱 Números</button>
    <button class="tab-btn" data-tab="tabCfg">⚙️ Config</button>
    <button class="tab-btn" data-tab="tabLog">📋 Log</button>
  </div>

  <!-- Tab Content -->
  <div class="tab-body">

    <!-- Mensagem -->
    <div class="tab-pane active" id="tabMsg">
      <div class="form-group">
        <label>Mensagem Principal</label>
        <textarea id="inMsg" placeholder="Digite sua mensagem..."></textarea>
      </div>
      <div id="varContainer"></div>
      <button class="btn btn-add" id="btnAddVar">＋ Adicionar Variação</button>
      <button class="btn btn-save" id="btnSaveMsg">💾 Salvar Mensagem</button>
    </div>

    <!-- Números -->
    <div class="tab-pane" id="tabNums">
      <div class="num-count" id="numCount">0 contatos</div>
      <div class="form-group">
        <textarea id="inNums" placeholder="Cole números (um por linha)&#10;+5511999998888&#10;+5521988887777" style="min-height:100px;font-family:Consolas,monospace;"></textarea>
      </div>
      <div class="num-btn-row">
        <button class="btn-num-action" id="btnNumAdd">+ Adicionar</button>
        <button class="btn-num-action btn-num-clear" id="btnNumClear">Limpar</button>
      </div>
      <div class="num-timer" id="numTimer" style="display:none">
        <div class="timer-label" id="timerLabel">Próximo envio em...</div>
        <div class="timer-bar-bg"><div class="timer-bar" id="timerBar"></div></div>
        <div class="timer-time" id="timerTime">00:00</div>
      </div>
      <div class="num-list" id="numList"></div>
    </div>

    <!-- Config -->
    <div class="tab-pane" id="tabCfg">
      <div class="form-row">
        <div class="form-group">
          <label>Delay Mín (seg)</label>
          <input type="number" id="cfgDelayMin" value="45" min="10">
        </div>
        <div class="form-group">
          <label>Delay Máx (seg)</label>
          <input type="number" id="cfgDelayMax" value="180" min="30">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Digitação Mín (seg)</label>
          <input type="number" id="cfgDigMin" value="3" min="1">
        </div>
        <div class="form-group">
          <label>Digitação Máx (seg)</label>
          <input type="number" id="cfgDigMax" value="8" min="2">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Máx / Sessão</label>
          <input type="number" id="cfgMaxSessao" value="40" min="1">
        </div>
        <div class="form-group">
          <label>Pausa a cada</label>
          <input type="number" id="cfgPausaCada" value="10" min="1">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Pausa Mín (min)</label>
          <input type="number" id="cfgPausaMin" value="5" min="1">
        </div>
        <div class="form-group">
          <label>Pausa Máx (min)</label>
          <input type="number" id="cfgPausaMax" value="10" min="1">
        </div>
      </div>
      <button class="btn btn-save" id="btnSaveCfg">💾 Salvar Configurações</button>
      <button class="btn btn-default" id="btnDefault">⚙ Padrão Recomendado</button>
      <button class="btn btn-reset" id="btnReset">🔄 Resetar Configuração</button>
    </div>

    <!-- Log -->
    <div class="tab-pane" id="tabLog">
      <div class="log-box" id="logBox">
        <div class="log-entry info">
          <span class="log-time">[--:--:--]</span>
          <span class="log-msg">Painel carregado. Configure e inicie o envio.</span>
        </div>
      </div>
    </div>

  </div>

  <!-- Progress -->
  <div class="progress-wrap">
    <div class="progress-bg"><div class="progress-fill" id="progressBar"></div></div>
    <div class="progress-text" id="progressText">0 / 0</div>
  </div>

  <!-- Controls -->
  <div class="btn-group">
    <button class="btn btn-start" id="btnStart">▶ Iniciar</button>
    <button class="btn btn-stop" id="btnStop" disabled>⏹ Parar</button>
  </div>

</div>
`;

    return shadow;
  }

  // ===== UI: REFERÊNCIAS E EVENTOS =====

  let shadow;
  const $ = (sel) => shadow.querySelector(sel);
  const $$ = (sel) => shadow.querySelectorAll(sel);

  const avatarColors = ['#6b5ce7', '#e6a817', '#e74c3c', '#2ecc71', '#3498db', '#e67e22', '#1abc9c', '#9b59b6'];

  function renderNumList(numeros, sentIndex) {
    const list = $('#numList');
    list.innerHTML = '';
    $('#numCount').textContent = `${numeros.length} contatos`;
    const sent = typeof sentIndex === 'number' ? sentIndex : 0;
    numeros.forEach((num, idx) => {
      const item = document.createElement('div');
      item.className = 'num-item';
      item.setAttribute('data-idx', idx);
      const color = avatarColors[idx % avatarColors.length];
      const letter = num.replace(/[^a-zA-Z0-9]/g, '').charAt(0).toUpperCase() || '#';
      const isSent = idx < sent;
      item.innerHTML = `
        <div class="num-avatar" style="background:${color}">${letter}</div>
        <div class="num-info">${num}</div>
        <div class="num-status ${isSent ? 'sent' : ''}">${isSent ? 'Enviado' : 'Pendente'}</div>
        <button class="num-remove" title="Remover">✕</button>
      `;
      item.querySelector('.num-remove').addEventListener('click', async () => {
        const state = await getState();
        const nums = state.numeros || [];
        const sess = state.session || {};
        nums.splice(idx, 1);
        // Ajustar currentIndex se removeu um já enviado
        if (sess.currentIndex && idx < sess.currentIndex) {
          sess.currentIndex = Math.max(0, sess.currentIndex - 1);
          await saveState({ numeros: nums, session: sess });
        } else {
          await saveState({ numeros: nums });
        }
        renderNumList(nums, sess.currentIndex || 0);
        updateProgress(sess.currentIndex || 0, nums.length);
        if (sess.stats) {
          sess.stats.total = nums.length;
          updateStats(sess.stats);
        }
      });
      list.appendChild(item);
    });
  }

  function updateNumItemStatus(idx, status) {
    const item = shadow.querySelector(`.num-item[data-idx="${idx}"]`);
    if (!item) return;
    const el = item.querySelector('.num-status');
    if (el) {
      el.textContent = status;
      el.className = 'num-status' + (status === 'Enviado' ? ' sent' : status === 'Erro' ? ' error' : '');
    }
  }

  function addVariationField(container, value, num) {
    const wrap = document.createElement('div');
    wrap.className = 'var-item';
    wrap.innerHTML = `
      <div class="var-header">
        <label>Variação ${num} (opcional)</label>
        <button class="var-remove" title="Remover">✕</button>
      </div>
      <textarea placeholder="Digite uma variação da mensagem...">${value || ''}</textarea>
    `;
    wrap.querySelector('.var-remove').addEventListener('click', () => {
      wrap.remove();
      // Renumerar
      [...container.querySelectorAll('.var-item')].forEach((item, idx) => {
        item.querySelector('label').textContent = `Variação ${idx + 1} (opcional)`;
      });
    });
    container.appendChild(wrap);
  }

  function setupUI() {
    // Toggle panel
    $('#toggleBtn').addEventListener('click', () => {
      const panel = $('#panel');
      const btn = $('#toggleBtn');
      panel.classList.toggle('open');
      btn.classList.toggle('open');
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.type !== 'OPEN_PANEL') return false;
      const panel = $('#panel');
      const btn = $('#toggleBtn');
      if (panel) panel.classList.add('open');
      if (btn) btn.classList.add('open');
      sendResponse({ ok: true });
      return true;
    });

    // Tabs
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-pane').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#${btn.dataset.tab}`).classList.add('active');
      });
    });

    // Adicionar variação
    $('#btnAddVar').addEventListener('click', () => {
      const container = $('#varContainer');
      const count = container.querySelectorAll('.var-item').length;
      addVariationField(container, '', count + 1);
    });

    // Adicionar números do textarea à lista
    $('#btnNumAdd').addEventListener('click', async () => {
      const raw = $('#inNums').value;
      const novos = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
      if (novos.length === 0) return;
      const state = await getState();
      const numeros = state.numeros || [];
      const session = state.session || {};
      numeros.push(...novos);
      await saveState({ numeros });
      renderNumList(numeros, session.currentIndex || 0);
      updateProgress(session.currentIndex || 0, numeros.length);
      if (session.stats) {
        session.stats.total = numeros.length;
        updateStats(session.stats);
      }
      $('#inNums').value = '';
    });

    // Limpar todos
    $('#btnNumClear').addEventListener('click', async () => {
      await saveState({ numeros: [] });
      renderNumList([], 0);
      updateProgress(0, 0);
    });

    // Salvar mensagem
    $('#btnSaveMsg').addEventListener('click', async () => {
      const state = await getState();
      const config = state.config || {};
      config.mensagem = $('#inMsg').value;
      config.variacoes = [...$$('#varContainer textarea')].map((t) => t.value).filter((v) => v.trim());
      await saveState({ config });
      flashButton($('#btnSaveMsg'), '✔ Salvo com sucesso!');
    });

    // Salvar config
    $('#btnSaveCfg').addEventListener('click', async () => {
      const state = await getState();
      const config = state.config || {};
      config.delayMin = parseInt($('#cfgDelayMin').value) || 45;
      config.delayMax = parseInt($('#cfgDelayMax').value) || 180;
      config.digitacaoMin = parseInt($('#cfgDigMin').value) || 3;
      config.digitacaoMax = parseInt($('#cfgDigMax').value) || 8;
      config.maxPorSessao = parseInt($('#cfgMaxSessao').value) || 40;
      config.pausaCada = parseInt($('#cfgPausaCada').value) || 10;
      config.pausaLongaMin = parseInt($('#cfgPausaMin').value) || 5;
      config.pausaLongaMax = parseInt($('#cfgPausaMax').value) || 10;
      await saveState({ config });
      flashButton($('#btnSaveCfg'), '✔ Salvo com sucesso!');
    });

    // Resetar configuração
    $('#btnReset').addEventListener('click', async () => {
      $('#cfgDelayMin').value = '';
      $('#cfgDelayMax').value = '';
      $('#cfgDigMin').value = '';
      $('#cfgDigMax').value = '';
      $('#cfgMaxSessao').value = '';
      $('#cfgPausaCada').value = '';
      $('#cfgPausaMin').value = '';
      $('#cfgPausaMax').value = '';
      const config = {
        mensagem: '',
        variacoes: [],
        delayMin: 0,
        delayMax: 0,
        digitacaoMin: 0,
        digitacaoMax: 0,
        maxPorSessao: 0,
        pausaCada: 0,
        pausaLongaMin: 0,
        pausaLongaMax: 0,
      };
      await saveState({ config });
      flashButton($('#btnReset'), '✔ Resetado!');
    });

    // Padrão recomendado
    $('#btnDefault').addEventListener('click', () => {
      $('#cfgDelayMin').value = 45;
      $('#cfgDelayMax').value = 180;
      $('#cfgDigMin').value = 3;
      $('#cfgDigMax').value = 8;
      $('#cfgMaxSessao').value = 40;
      $('#cfgPausaCada').value = 10;
      $('#cfgPausaMin').value = 5;
      $('#cfgPausaMax').value = 10;
      flashButton($('#btnDefault'), '✔ Valores restaurados!');
    });

    // Iniciar
    $('#btnStart').addEventListener('click', () => {
      startAutomation();
    });

    // Parar
    $('#btnStop').addEventListener('click', () => {
      stopAutomation();
    });
  }

  // ===== UI: FUNÇÕES AUXILIARES =====

  function addLog(tipo, msg) {
    const logBox = $('#logBox');
    if (!logBox) return;

    // Mudar para aba Log automaticamente quando enviando
    const entry = document.createElement('div');
    entry.className = `log-entry ${tipo}`;
    entry.innerHTML = `<span class="log-time">[${horaAtual()}]</span><span class="log-msg">${msg}</span>`;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;

    // Manter apenas últimas 200 entradas
    while (logBox.children.length > 200) {
      logBox.removeChild(logBox.firstChild);
    }
  }

  function updateStats(stats) {
    if (!stats) return;
    const el = (id) => $(`#${id}`);
    if (el('stEnviados')) el('stEnviados').textContent = stats.enviados || 0;
    if (el('stErros')) el('stErros').textContent = stats.erros || 0;
    if (el('stTotal')) el('stTotal').textContent = stats.total || 0;
    if (el('stPulados')) el('stPulados').textContent = stats.pulados || 0;
  }

  function updateProgress(current, total) {
    const bar = $('#progressBar');
    const text = $('#progressText');
    if (!bar || !text) return;

    if (total > 0) {
      const pct = ((current / total) * 100).toFixed(1);
      bar.style.width = pct + '%';
      text.textContent = `${current} / ${total} (${pct}%)`;
    } else {
      bar.style.width = '0%';
      text.textContent = '0 / 0';
    }
  }

  function updateControlButtons() {
    const btnStart = $('#btnStart');
    const btnStop = $('#btnStop');
    const pill = $('#statusPill');
    const label = $('#statusLabel');

    if (automationRunning) {
      btnStart.disabled = true;
      btnStop.disabled = false;
      pill.className = 'status-pill sending';
      label.textContent = 'Enviando...';
    } else {
      btnStart.disabled = false;
      btnStop.disabled = true;
      pill.className = 'status-pill idle';
      label.textContent = 'Parado';
    }
  }

  function flashButton(btn, msg, duration = 1800) {
    const original = btn.textContent;
    btn.textContent = msg;
    btn.classList.add('btn-success');
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('btn-success');
      btn.disabled = false;
    }, duration);
  }

  function showToast(msg, type = 'success') {
    const existing = shadow.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    shadow.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  async function loadSavedData() {
    const state = await getState();
    const config = state.config || {};
    const numeros = state.numeros || [];
    const session = state.session || {};

    // Mensagem
    $('#inMsg').value = config.mensagem || '';
    // Carregar variações dinâmicas
    const container = $('#varContainer');
    container.innerHTML = '';
    const vars = config.variacoes || [];
    if (vars.length === 0) {
      addVariationField(container, '', 1);
    } else {
      vars.forEach((v, idx) => addVariationField(container, v, idx + 1));
    }

    // Números
    renderNumList(numeros, session.currentIndex || 0);

    // Progress
    updateProgress(session.currentIndex || 0, numeros.length);
    if (session.stats) {
      session.stats.total = numeros.length;
    }

    // Config
    $('#cfgDelayMin').value = config.delayMin || 45;
    $('#cfgDelayMax').value = config.delayMax || 180;
    $('#cfgDigMin').value = config.digitacaoMin || 3;
    $('#cfgDigMax').value = config.digitacaoMax || 8;
    $('#cfgMaxSessao').value = config.maxPorSessao || 40;
    $('#cfgPausaCada').value = config.pausaCada || 10;
    $('#cfgPausaMin').value = config.pausaLongaMin || 5;
    $('#cfgPausaMax').value = config.pausaLongaMax || 10;

    // Stats
    if (session.stats) updateStats(session.stats);
  }

  // ===== INICIALIZAÇÃO =====

  async function init() {
    // Esperar WhatsApp Web carregar
    const ready = await waitForWhatsApp();
    if (!ready) {
      console.log('[Bot WA] WhatsApp Web não carregou a tempo.');
      return;
    }

    // Criar painel
    shadow = createPanel();

    // Setup UI
    setupUI();

    // Carregar dados salvos
    await loadSavedData();

    addLog('sucesso', 'WhatsApp Web detectado! Painel pronto.');

    // Verificar sessão ativa (retomar após reload)
    await checkActiveSession();
  }

  init();
})();
