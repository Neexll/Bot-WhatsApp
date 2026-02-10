// =====================================================
//  BOT WHATSAPP - EXTENSÃO CHROME
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
    // Usa a URL do WhatsApp Web para abrir conversa com o número
    const url = `https://web.whatsapp.com/send?phone=${numero}`;
    window.location.href = url;
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

  async function typeMessage(element, text) {
    element.focus();
    await sleep(300);

    // Método 1: execCommand (mais confiável com React)
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    document.execCommand('insertText', false, text);

    await sleep(300);

    // Verificar se o texto foi inserido
    if (element.textContent.trim().length > 0) return true;

    // Método 2: fallback com InputEvent
    element.textContent = '';
    element.focus();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true,
      })
    );
    await sleep(300);

    if (element.textContent.trim().length > 0) return true;

    // Método 3: último fallback
    element.focus();
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
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
    session.stats = session.stats || { enviados: 0, erros: 0, pulados: 0, total: numeros.length };
    session.stats.total = numeros.length;
    session.currentIndex = session.currentIndex || 0;
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

      // Horário
      const horaAgora = new Date().getHours();
      if (horaAgora < (config.horaInicio || 8) || horaAgora >= (config.horaFim || 20)) {
        addLog('pausa', `Fora do horário (${config.horaInicio}h-${config.horaFim}h). Aguardando...`);
        while (true) {
          await sleep(60000);
          const h = new Date().getHours();
          if (h >= (config.horaInicio || 8) && h < (config.horaFim || 20)) break;
          if (shouldStop) break;
        }
        if (shouldStop) break;
      }

      const numero = numeros[i].replace(/\D/g, '');
      if (!numero) {
        session.currentIndex = i + 1;
        await saveState({ session });
        continue;
      }

      addLog('info', `[${i + 1}/${numeros.length}] Abrindo chat: ${numero}`);
      updateProgress(i, numeros.length);

      // Navegar para o chat
      navigateToChat(numero);

      // Esperar chat carregar (a página pode recarregar aqui)
      // Se a página recarregar, o content script será re-injetado
      // e vai detectar a sessão ativa no storage para continuar
      // Mas se for SPA routing (não recarrega), continuamos aqui

      await sleep(3000); // Dar tempo para o WhatsApp processar a URL

      const result = await waitForChatReady(35000);

      if (result.status === 'invalid') {
        addLog('aviso', `${numero} — número inválido ou não está no WhatsApp. Pulando...`);
        session.stats.pulados++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        await sleep(2000);
        continue;
      }

      if (result.status === 'timeout') {
        addLog('erro', `${numero} — timeout ao abrir chat. Pulando...`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        await sleep(2000);
        continue;
      }

      // Chat pronto - simular digitação
      const todasMsg = [config.mensagem, ...(config.variacoes || [])].filter(
        (m) => m && m.trim()
      );
      const msgEscolhida = todasMsg[randomEntre(0, todasMsg.length - 1)];

      // Simular "digitando..."
      const tempoDigitacao = randomEntre(
        (config.digitacaoMin || 3) * 1000,
        (config.digitacaoMax || 8) * 1000
      );
      addLog('info', `Digitando por ${(tempoDigitacao / 1000).toFixed(1)}s...`);
      await sleep(tempoDigitacao);

      if (shouldStop) break;

      // Digitar mensagem
      const input = getMessageInput();
      if (!input) {
        addLog('erro', `${numero} — input de mensagem não encontrado.`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        continue;
      }

      const typed = await typeMessage(input, msgEscolhida);
      if (!typed) {
        addLog('erro', `${numero} — falha ao digitar mensagem.`);
        session.stats.erros++;
        session.currentIndex = i + 1;
        await saveState({ session });
        updateStats(session.stats);
        continue;
      }

      await sleep(500);

      // Enviar
      const sent = await clickSend();
      if (!sent) {
        addLog('erro', `${numero} — falha ao clicar enviar.`);
        session.stats.erros++;
      } else {
        msgSessao++;
        session.stats.enviados++;
        addLog('sucesso', `✔ Enviado para ${numero} (${msgSessao}/${config.maxPorSessao})`);
      }

      session.currentIndex = i + 1;
      await saveState({ session });
      updateStats(session.stats);

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
        await sleep(pausa);
      }

      // Delay entre mensagens
      if (i < numeros.length - 1 && !shouldStop) {
        const delay = randomEntre(
          (config.delayMin || 45) * 1000,
          (config.delayMax || 180) * 1000
        );
        addLog('info', `Aguardando ${(delay / 1000).toFixed(0)}s antes da próxima...`);
        await sleep(delay);
      }
    }

    // Finalizar
    automationRunning = false;
    session.active = false;
    await saveState({ session });
    updateControlButtons();

    addLog(
      'sucesso',
      `Sessão finalizada! ${session.stats.enviados} enviados, ${session.stats.erros} erros, ${session.stats.pulados} pulados.`
    );
  }

  function stopAutomation() {
    shouldStop = true;
    addLog('aviso', 'Parando após a operação atual...');
  }

  // ===== VERIFICAR SESSÃO ATIVA (retomar após reload) =====

  async function checkActiveSession() {
    const state = await getState();
    const session = state.session;

    if (session && session.active) {
      // Há uma sessão ativa — o content script foi recarregado durante o envio
      addLog('info', 'Sessão ativa detectada. Retomando envio...');
      updateStats(session.stats);

      // Esperar WhatsApp carregar
      await sleep(3000);

      // Verificar se estamos numa URL /send?phone=
      const urlParams = new URLSearchParams(window.location.search);
      const phone = urlParams.get('phone');

      if (phone) {
        // Estamos no meio de um envio — esperar chat carregar e enviar
        const result = await waitForChatReady(35000);

        if (result.status === 'ready') {
          const config = state.config || {};
          const todasMsg = [config.mensagem, ...(config.variacoes || [])].filter(
            (m) => m && m.trim()
          );
          const msgEscolhida = todasMsg[randomEntre(0, todasMsg.length - 1)];

          const tempoDigitacao = randomEntre(
            (config.digitacaoMin || 3) * 1000,
            (config.digitacaoMax || 8) * 1000
          );
          await sleep(tempoDigitacao);

          const input = getMessageInput();
          if (input) {
            await typeMessage(input, msgEscolhida);
            await sleep(500);
            await clickSend();
            session.stats.enviados++;
            addLog('sucesso', `✔ Enviado para ${phone} (retomado)`);
          }
        } else {
          session.stats.pulados++;
          addLog('aviso', `${phone} — não foi possível enviar (${result.status}).`);
        }

        session.currentIndex++;
        await saveState({ session });
        updateStats(session.stats);
      }

      // Continuar com o resto da fila
      await sleep(2000);
      startAutomation();
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
    font-size: 11px;
    color: #8696a0;
    margin-top: 4px;
  }

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

  .btn-save {
    background: #2a3942;
    color: #53bdeb;
    border: 1px solid #313d45;
  }
  .btn-save:hover:not(:disabled) { background: #313d45; }

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
        <h2>Bot WhatsApp</h2>
        <div class="sub">Prospecção</div>
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
      <div class="form-group">
        <label>Variação 1 (opcional)</label>
        <textarea id="inVar1" placeholder="Uma variação..." style="min-height:55px"></textarea>
      </div>
      <div class="form-group">
        <label>Variação 2 (opcional)</label>
        <textarea id="inVar2" placeholder="Outra variação..." style="min-height:55px"></textarea>
      </div>
      <button class="btn btn-save" id="btnSaveMsg">💾 Salvar Mensagem</button>
    </div>

    <!-- Números -->
    <div class="tab-pane" id="tabNums">
      <div class="form-group">
        <label>Lista de Números (um por linha)</label>
        <textarea id="inNums" placeholder="5511999998888&#10;5521988887777&#10;5531977776666" style="min-height:200px;font-family:Consolas,monospace;"></textarea>
        <div class="num-count" id="numCount">0 números</div>
      </div>
      <button class="btn btn-save" id="btnSaveNums">💾 Salvar Números</button>
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
      <div class="form-row">
        <div class="form-group">
          <label>Hora Início</label>
          <input type="number" id="cfgHoraIni" value="8" min="0" max="23">
        </div>
        <div class="form-group">
          <label>Hora Fim</label>
          <input type="number" id="cfgHoraFim" value="20" min="0" max="23">
        </div>
      </div>
      <button class="btn btn-save" id="btnSaveCfg">💾 Salvar Configurações</button>
      <button class="btn btn-reset" id="btnReset">🔄 Resetar Progresso</button>
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

  function setupUI() {
    // Toggle panel
    $('#toggleBtn').addEventListener('click', () => {
      const panel = $('#panel');
      const btn = $('#toggleBtn');
      panel.classList.toggle('open');
      btn.classList.toggle('open');
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

    // Contar números
    $('#inNums').addEventListener('input', () => {
      const count = $('#inNums')
        .value.split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#')).length;
      $('#numCount').textContent = `${count} números`;
    });

    // Salvar mensagem
    $('#btnSaveMsg').addEventListener('click', async () => {
      const state = await getState();
      const config = state.config || {};
      config.mensagem = $('#inMsg').value;
      config.variacoes = [$('#inVar1').value, $('#inVar2').value].filter((v) => v.trim());
      await saveState({ config });
      showToast('Mensagem salva!');
    });

    // Salvar números
    $('#btnSaveNums').addEventListener('click', async () => {
      const raw = $('#inNums').value;
      const numeros = raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
      await saveState({ numeros });
      showToast(`${numeros.length} números salvos!`);
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
      config.horaInicio = parseInt($('#cfgHoraIni').value) || 8;
      config.horaFim = parseInt($('#cfgHoraFim').value) || 20;
      await saveState({ config });
      showToast('Configurações salvas!');
    });

    // Resetar progresso
    $('#btnReset').addEventListener('click', async () => {
      const session = {
        active: false,
        currentIndex: 0,
        stats: { enviados: 0, erros: 0, pulados: 0, total: 0 },
        logs: [],
      };
      await saveState({ session });
      updateStats(session.stats);
      updateProgress(0, 0);
      $('#logBox').innerHTML = '';
      addLog('info', 'Progresso resetado.');
      showToast('Progresso resetado!');
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
    $('#inVar1').value = (config.variacoes && config.variacoes[0]) || '';
    $('#inVar2').value = (config.variacoes && config.variacoes[1]) || '';

    // Números
    $('#inNums').value = numeros.join('\n');
    $('#numCount').textContent = `${numeros.length} números`;

    // Config
    $('#cfgDelayMin').value = config.delayMin || 45;
    $('#cfgDelayMax').value = config.delayMax || 180;
    $('#cfgDigMin').value = config.digitacaoMin || 3;
    $('#cfgDigMax').value = config.digitacaoMax || 8;
    $('#cfgMaxSessao').value = config.maxPorSessao || 40;
    $('#cfgPausaCada').value = config.pausaCada || 10;
    $('#cfgPausaMin').value = config.pausaLongaMin || 5;
    $('#cfgPausaMax').value = config.pausaLongaMax || 10;
    $('#cfgHoraIni').value = config.horaInicio || 8;
    $('#cfgHoraFim').value = config.horaFim || 20;

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
