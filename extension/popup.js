// Verifica se o WhatsApp Web está aberto em alguma aba
chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (tabs) => {
  const statusEl = document.getElementById('status');
  const statusText = document.getElementById('statusText');
  const btn = document.getElementById('btnOpen');

  // Garante que o content script está injetado e depois abre o painel
  async function ensureContentScriptAndOpenPanel(tabId) {
    try {
      // Tenta mandar mensagem primeiro (content script já rodando)
      await chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL' });
    } catch {
      // Content script não está rodando — injeta programaticamente
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      // Espera o script inicializar (ele tem um init() async)
      await new Promise((r) => setTimeout(r, 3000));
      // Agora manda abrir o painel
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'OPEN_PANEL' });
      } catch {
        // Ignora se ainda não respondeu
      }
    }
    window.close();
  }

  if (tabs.length > 0) {
    statusEl.className = 'status ok';
    statusText.textContent = 'WhatsApp Web aberto - Painel ativo';
    btn.textContent = 'Abrir Painel';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      btn.textContent = 'Abrindo...';
      btn.style.opacity = '0.7';
      await chrome.tabs.update(tabs[0].id, { active: true });
      await ensureContentScriptAndOpenPanel(tabs[0].id);
    });
  } else {
    statusEl.className = 'status off';
    statusText.textContent = 'WhatsApp Web não está aberto';

    btn.textContent = 'Abrir Painel';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      btn.textContent = 'Abrindo...';
      btn.style.opacity = '0.7';
      chrome.tabs.create({ url: 'https://web.whatsapp.com/' }, (tab) => {
        const tabId = tab.id;
        const listener = async (updatedTabId, info) => {
          if (updatedTabId !== tabId) return;
          if (info.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(listener);
          await ensureContentScriptAndOpenPanel(tabId);
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    });
  }
});
